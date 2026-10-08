package com.claimshield.gateway.brief;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Turns a VALIDATED brief into its human-readable form: placeholders are replaced with the pack's own number
 * renderings, citations stay attached to every line, and a Markdown copy is produced for export.
 * Never call this on a brief that has not passed {@link BriefValidator}.
 */
@Component
public class BriefRenderer {

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{([A-Za-z0-9_.]+)}}");

  /** The seven official elements first, in order, then the working aids. */
  private static final List<String[]> SECTIONS = List.of(
      new String[] {"summary", "1. Evidence"},
      new String[] {"timeline_notes", "2. Timeline"},
      new String[] {"network_notes", "3. Network context"},
      new String[] {"confidence", "4. Confidence"},
      new String[] {"limitations", "5. Limitations"},
      new String[] {"action", "6. Recommended human-review action"},
      new String[] {"case_context", "7. Supporting case and risk context"},
      new String[] {"precedent_notes", "Precedents"},
      new String[] {"investigator_checklist", "Investigator checklist"},
      new String[] {"what_would_change_my_mind", "What would change this assessment"});

  private final JsonMapper mapper;

  public BriefRenderer(JsonMapper mapper) {
    this.mapper = mapper;
  }

  public ObjectNode render(JsonNode out, JsonNode pack) {
    PackIndex px = new PackIndex(pack);
    ObjectNode r = mapper.createObjectNode();
    r.set("headline", line(out.get("headline"), px, "evidence_ids"));
    r.put("hypothesis", out.get("hypothesis").asString());
    r.put("recommendedAction", out.get("recommended_action").asString());
    r.put("insufficientEvidence", out.get("insufficient_evidence").asBoolean());
    ArrayNode sections = r.putArray("sections");
    StringBuilder md = new StringBuilder("# Investigation brief: ").append(pack.get("caseId").asString())
        .append("\n\n").append(r.get("headline").get("text").asString()).append("\n\n");
    for (String[] s : SECTIONS) {
      ArrayNode items = mapper.createArrayNode();
      switch (s[0]) {
        case "confidence" -> items.add(line(out.get("confidence_statement"), px, "evidence_ids"));
        case "action" -> {
          ObjectNode act = mapper.createObjectNode();
          act.put("text", "Recommended action: " + out.get("recommended_action").asString() + ". Pattern: "
              + out.get("hypothesis").asString() + ".");
          act.set("cites", out.get("action_rationale").get("evidence_ids"));
          items.add(act);
          items.add(line(out.get("action_rationale"), px, "evidence_ids"));
        }
        case "limitations" -> out.get("limitations").forEach(l -> items.add(line(l, px, "limitation_ids")));
        default -> out.get(s[0]).forEach(n -> items.add(line(n, px, "evidence_ids")));
      }
      if (items.isEmpty() && "precedent_notes".equals(s[0])) {
        continue;   // nothing to show; the seven required elements are never skipped
      }
      ObjectNode sec = sections.addObject();
      sec.put("key", s[0]);
      sec.put("title", s[1]);
      sec.set("items", items);
      md.append("## ").append(s[1]).append("\n");
      items.forEach(i -> md.append("- ").append(i.get("text").asString()).append(" [")
          .append(String.join(", ", i.get("cites").valueStream().map(JsonNode::asString).toList())).append("]\n"));
      md.append("\n");
    }
    md.append("_Indicators for human review, not findings. All data is synthetic._\n");
    r.put("markdown", md.toString());
    return r;
  }

  private ObjectNode line(JsonNode sentence, PackIndex px, String idField) {
    ObjectNode o = mapper.createObjectNode();
    o.put("text", substitute(sentence.get("text").asString(), px));
    o.set("cites", sentence.get(idField));
    return o;
  }

  static String substitute(String text, PackIndex px) {
    Matcher m = PLACEHOLDER.matcher(text);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String v = px.numbers.get(m.group(1));
      if (v == null) {
        throw new IllegalStateException("Unvalidated placeholder " + m.group(1));
      }
      m.appendReplacement(sb, Matcher.quoteReplacement(v));
    }
    m.appendTail(sb);
    return sb.toString();
  }
}
