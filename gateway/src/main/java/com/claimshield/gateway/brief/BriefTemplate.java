package com.claimshield.gateway.brief;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Deterministic brief built only from the evidence pack. It is the L2 fallback in the failure ladder and the
 * baseline an LLM brief must meet. Nothing here is invented: wording is fixed, facts come from pack text, and every
 * number is a {{ID.key}} placeholder resolved from the pack registry at render time.
 */
@Component
public class BriefTemplate {

  static final Map<String, String> ACTION_TEXT = Map.of(
      "REQUEST_RECORDS", "request the supporting medical and billing records from the provider",
      "PROVIDER_EDUCATION", "send the provider education on the billing rule involved",
      "MONITOR", "keep the provider on the watch list and re-check when new data arrives",
      "PREPAY_REVIEW_FLAG", "place the provider's claims on prepayment review",
      "REFER_EXTERNAL", "refer the matter to the external compliance team");

  private final JsonMapper mapper;

  public BriefTemplate(JsonMapper mapper) {
    this.mapper = mapper;
  }

  public ObjectNode build(JsonNode pack) {
    PackIndex px = new PackIndex(pack);
    List<String> evidence = new ArrayList<>(px.evidenceIds);
    List<String> tierReasons = new ArrayList<>(px.tierReasonIds);
    JsonNode primary = pack.get("evidence").get(0);
    String primaryId = primary.get("id").asString();
    ObjectNode out = mapper.createObjectNode();

    // ---- headline
    String head = primary.get("name").asString();
    if (px.numbers.containsKey(primaryId + ".dollars")) {
      head += ": {{" + primaryId + ".dollars}} in recorded amounts needs human review";
    } else {
      head += ": flagged for human review";
    }
    out.set("headline", sentence(head, List.of(primaryId)));

    // ---- 1 evidence
    ArrayNode summary = mapper.createArrayNode();
    for (JsonNode e : pack.get("evidence")) {
      summary.add(sentence(e.get("template").asString(), List.of(e.get("id").asString())));
      if (e.hasNonNull("firstServiceDt") && e.hasNonNull("lastServiceDt")
          && !e.get("firstServiceDt").asString().isBlank()) {
        summary.add(sentence("The flagged services run from " + e.get("firstServiceDt").asString() + " to "
            + e.get("lastServiceDt").asString() + ".", List.of(e.get("id").asString())));
      }
    }
    for (JsonNode p : pack.get("policies")) {
      summary.add(sentence("Policy reference: " + p.get("title").asString() + ".", List.of(p.get("id").asString())));
    }
    out.set("summary", summary);

    // ---- 7 supporting case and risk context
    ArrayNode context = mapper.createArrayNode();
    StringBuilder risk = new StringBuilder();
    if (px.numbers.containsKey("S.dollars")) {
      risk.append("Recorded dollars in scope: {{S.dollars}}");
      if (px.numbers.containsKey("S.members")) {
        risk.append(" across {{S.members}} members");
      }
      risk.append(". ");
    }
    if (px.numbers.containsKey("S.risk")) {
      risk.append("Risk signal {{S.risk}}");
      List<String> parts = new ArrayList<>();
      for (String[] f : new String[][] {{"S.severity", "severity"}, {"S.memberImpact", "member impact"},
          {"S.evidenceStrength", "evidence strength"}}) {
        if (px.numbers.containsKey(f[0])) {
          parts.add(f[1] + " {{" + f[0] + "}}");
        }
      }
      if (!parts.isEmpty()) {
        risk.append(" (").append(String.join(", ", parts)).append(")");
      }
      risk.append(".");
    }
    if (!risk.isEmpty() && !tierReasons.isEmpty()) {
      context.add(sentence(risk.toString().trim(), tierReasons));
    }
    List<String> subj = new ArrayList<>();
    for (JsonNode s : pack.get("subjects")) {
      subj.add(s.get("id").asString() + " (" + s.get("role").asString().toLowerCase() + ", "
          + s.get("specialty").asString().toLowerCase().replace('_', ' ') + ")");
    }
    context.add(sentence("Subjects in scope: " + String.join(", ", subj) + ".", evidence));
    for (JsonNode r : pack.get("scores").get("tierReasons")) {
      context.add(sentence("Tier basis: " + r.get("text").asString(), List.of(r.get("id").asString())));
    }
    out.set("case_context", context);

    // ---- 2 timeline
    ArrayNode timeline = mapper.createArrayNode();
    List<JsonNode> events = new ArrayList<>();
    pack.get("timeline").forEach(events::add);
    events.sort(Comparator.comparing((JsonNode t) -> t.get("date").asString()).thenComparing(t -> t.get("id").asString()));
    for (JsonNode t : events) {
      timeline.add(sentence(t.get("date").asString() + ": " + t.get("text").asString() + ".",
          List.of(t.get("id").asString())));
    }
    if (timeline.isEmpty()) {
      timeline.add(sentence("The evidence pack records no dated events for this case.", List.of(primaryId)));
    }
    out.set("timeline_notes", timeline);

    // ---- 3 network context
    ArrayNode network = mapper.createArrayNode();
    for (JsonNode n : pack.get("network")) {
      String text = n.hasNonNull("statement") ? n.get("statement").asString() : n.path("text").asString();
      network.add(sentence(text, List.of(n.get("id").asString())));
    }
    if (network.isEmpty()) {
      network.add(sentence("No network or relationship evidence is available in this build, so network context "
          + "cannot be assessed.", List.of(limitationAbout(pack, "network"))));
    }
    out.set("network_notes", network);

    ArrayNode precedents = mapper.createArrayNode();
    for (JsonNode n : pack.get("precedents")) {
      String text = n.hasNonNull("statement") ? n.get("statement").asString() : n.path("text").asString();
      precedents.add(sentence(text, List.of(n.get("id").asString())));
    }
    out.set("precedent_notes", precedents);

    // ---- 4 confidence
    boolean insufficient = "LOW".equals(px.tier) || px.insufficientRequired;
    StringBuilder conf = new StringBuilder("The computed confidence tier is ").append(px.tier)
        .append(". It comes from fixed rules over independent evidence channels, not from a model");
    if (px.numbers.containsKey("S.evidenceStrength")) {
      conf.append("; evidence strength is {{S.evidenceStrength}}");
    }
    conf.append(". This is an indicator that needs human review, not a finding.");
    if (insufficient) {
      conf.append(" The evidence is not sufficient to open a case.");
    }
    out.set("confidence_statement", sentence(conf.toString(), tierReasons.isEmpty() ? evidence : tierReasons));

    // ---- 6 recommended human-review action
    String action = px.permittedActions.contains(pack.get("defaultAction").asString())
        ? pack.get("defaultAction").asString() : px.permittedActions.get(0);
    String needs = needs(pack, action);
    out.put("hypothesis", pack.get("hypotheses").get(0).asString());
    out.put("recommended_action", action);
    StringBuilder why = new StringBuilder("Suggested next step for a human reviewer: ").append(ACTION_TEXT.get(action))
        .append(" (").append(action).append(").");
    if ("SUPERVISOR".equals(needs)) {
      why.append(" This step needs supervisor approval.");
    }
    why.append(" Allowed for this tier: ").append(String.join(", ", px.permittedActions))
        .append(". Nothing is applied until a person decides.");
    List<String> cites = new ArrayList<>(List.of(primaryId));
    cites.addAll(tierReasons.stream().limit(1).toList());
    out.set("action_rationale", sentence(why.toString(), cites));

    ArrayNode checklist = mapper.createArrayNode();
    checklist.add(sentence("Open each flagged claim line for evidence " + primaryId
        + " and confirm the recorded details against the source claim.", List.of(primaryId)));
    for (JsonNode p : pack.get("policies")) {
      checklist.add(sentence("Compare the lines with policy " + p.get("id").asString() + ": "
          + p.get("title").asString() + ".", List.of(p.get("id").asString())));
    }
    checklist.add(sentence("Look for a documented clinical or billing explanation before any action is taken.",
        List.of(primaryId)));
    checklist.add(sentence("Record the decision with a reason code so the case can be audited.", List.of(primaryId)));
    out.set("investigator_checklist", checklist);

    ArrayNode change = mapper.createArrayNode();
    change.add(sentence("Records showing a legitimate, documented reason for the flagged lines would lower concern.",
        List.of(primaryId)));
    change.add(sentence("Independent signals such as peer comparison, trend or network evidence would raise "
        + "confidence; they are not available in this build.", List.of(limitationAbout(pack, "not available"))));
    out.set("what_would_change_my_mind", change);

    // ---- 5 limitations (every pack limitation, verbatim)
    ArrayNode lims = mapper.createArrayNode();
    for (JsonNode l : pack.get("limitations")) {
      ObjectNode o = mapper.createObjectNode();
      o.put("text", l.get("text").asString());
      o.set("limitation_ids", mapper.createArrayNode().add(l.get("id").asString()));
      lims.add(o);
    }
    out.set("limitations", lims);
    out.put("insufficient_evidence", insufficient);
    return out;
  }

  private ObjectNode sentence(String text, List<String> ids) {
    ObjectNode o = mapper.createObjectNode();
    o.put("text", text);
    ArrayNode a = o.putArray("evidence_ids");
    ids.forEach(a::add);
    return o;
  }

  /** The first limitation whose wording contains the phrase, else the first mandatory one. */
  private static String limitationAbout(JsonNode pack, String phrase) {
    for (JsonNode l : pack.get("limitations")) {
      if (l.get("text").asString().toLowerCase().contains(phrase)) {
        return l.get("id").asString();
      }
    }
    for (JsonNode l : pack.get("limitations")) {
      if (l.get("mandatory").asBoolean()) {
        return l.get("id").asString();
      }
    }
    return pack.get("limitations").get(0).get("id").asString();
  }

  private static String needs(JsonNode pack, String action) {
    for (JsonNode a : pack.get("permittedActions")) {
      if (a.get("action").asString().equals(action)) {
        return a.get("needs").asString();
      }
    }
    return "NONE";
  }
}
