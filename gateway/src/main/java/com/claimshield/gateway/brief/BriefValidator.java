package com.claimshield.gateway.brief;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * Deterministic validator for an investigation brief against the closed evidence pack. Java is the only path from
 * generated text to a user, so every brief (template or, later, LLM) passes through here.
 *
 * Checks V1..V15 follow docs/ClaimShield_Nexus_AI_Second_Brain.md section 7. V16 (optional LLM verifier) is not
 * implemented. BLOCK failures reject the brief; WARN findings are shown to the reviewer.
 *
 * Numbers: every number must be a {{ID.key}} placeholder from the pack registry. A digit is allowed in free text
 * only inside a date, entity ID, code, policy ID or evidence ID listed in the pack, or inside the verbatim pack text
 * of an item the same sentence cites.
 */
@Component
public class BriefValidator {

  static final String SCHEMA_RESOURCE = "/schemas/brief_output.schema.json";
  static final Set<String> NORMAL_STOP = Set.of("end_turn", "tool_use", "stop_sequence", "template");

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{([A-Za-z0-9_.]+)}}");
  private static final Pattern ENTITY = Pattern.compile(
      "(?<![A-Za-z0-9])(?:P|M|C|F|O|INV|PRC|EXC|CASE)-[A-Za-z0-9]+");
  private static final Pattern TIER_UPPER = Pattern.compile("\\b(HIGH|MEDIUM|LOW)\\b");
  private static final Pattern TIER_WORDS = Pattern.compile("\\b(high|medium|low)[ -](?:confidence|tier|risk)\\b",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern INJECTION = Pattern.compile(
      "\\b(?:ignore|disregard|forget)\\b.{0,40}\\b(?:previous|above|prior|instructions?|rules?|all)\\b",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern MARKUP = Pattern.compile("https?://|www\\.|\\]\\(|<\\s*/?[A-Za-z]|`|&[a-z]+;",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern CERTAINTY = Pattern.compile(
      "\\b(?:proves?|proven|definitely|certainly|undoubtedly|clearly shows?|conclusively|beyond doubt)\\b",
      Pattern.CASE_INSENSITIVE);
  /** Stems checked in addition to the pack's own forbiddenTerms. */
  static final List<String> EXTRA_FORBIDDEN = List.of("defraud", "conspir", "bribe", "embezzl", "crime", "unlawful",
      "illicit", "cheat", "swindl", "misappropriat", "perjur", "malicious");

  private final Schema schema;

  public BriefValidator() {
    try (InputStream in = BriefValidator.class.getResourceAsStream(SCHEMA_RESOURCE)) {
      if (in == null) {
        throw new IllegalStateException("Missing classpath resource " + SCHEMA_RESOURCE);
      }
      String text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      this.schema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12).getSchema(text);
    } catch (IOException e) {
      throw new IllegalStateException("Cannot load " + SCHEMA_RESOURCE, e);
    }
  }

  // ------------------------------------------------------------------------------------------------ result
  public record Check(String id, String name, String severity, String status, List<String> details) {
    public boolean failed() {
      return "FAIL".equals(status);
    }
  }

  public record Result(boolean passed, List<Check> checks) {
    public List<String> blockerIds() {
      return checks.stream().filter(Check::failed).map(Check::id).toList();
    }

    public int warnings() {
      return (int) checks.stream().filter(c -> "WARN".equals(c.status())).count();
    }
  }

  /** One text unit that must be supported: its text plus the IDs it cites. */
  private record Sentence(String path, String text, List<String> ids, boolean limitation) {}

  // ------------------------------------------------------------------------------------------------ entry
  public Result validate(JsonNode out, JsonNode pack, String stopReason) {
    List<Check> checks = new ArrayList<>();

    List<String> v1 = new ArrayList<>();
    if (stopReason == null || !NORMAL_STOP.contains(stopReason)) {
      v1.add("stop reason '" + stopReason + "' is not a normal completion (refusal or truncation)");
    }
    if (out == null || !out.isObject()) {
      v1.add("output is not a JSON object");
    } else {
      for (Error e : schema.validate(out)) {
        v1.add(e.getInstanceLocation() + ": " + e.getMessage());
      }
    }
    checks.add(check("V1", "Schema and stop reason", "BLOCK", v1));
    if (!v1.isEmpty()) {
      return new Result(false, checks);   // the structure cannot be walked safely
    }

    PackIndex px = new PackIndex(pack);
    List<Sentence> sentences = sentences(out);

    checks.add(check("V2", "Every text block cites at least one ID", "BLOCK", v2(sentences)));
    checks.add(check("V3", "Every cited ID exists in the evidence pack", "BLOCK", v3(sentences, px)));
    checks.add(check("V4", "Number placeholders exist and their owner is cited", "BLOCK", v4(sentences, px)));
    checks.add(check("V5", "No free-typed numbers", "BLOCK", v5(sentences, px)));
    checks.add(check("V6", "Every entity ID exists in the pack", "BLOCK", v6(sentences, px)));
    checks.add(check("V7", "Forbidden wording, links and instructions", "BLOCK", v7(sentences, px)));
    checks.add(check("V8", "Hypothesis is one the case allows", "BLOCK", v8(out, px)));
    checks.add(check("V9", "Recommended action is permitted for this tier", "BLOCK", v9(out, px)));
    checks.add(check("V10", "Tier wording matches the computed tier", "BLOCK", v10(sentences, px)));
    checks.add(check("V11", "Insufficient-evidence rule and LOW-tier action", "BLOCK", v11(out, px)));
    checks.add(check("V12", "Mandatory limitations are present", "BLOCK", v12(out, px)));
    checks.add(check("V13", "All seven required elements are present", "BLOCK", v13(out)));
    checks.add(check("V14", "No certainty language", "WARN", v14(sentences)));
    checks.add(check("V15", "Citations fit the topic", "WARN", v15(out, px)));
    boolean passed = checks.stream().noneMatch(Check::failed);
    return new Result(passed, checks);
  }

  private static Check check(String id, String name, String severity, List<String> problems) {
    String status = problems.isEmpty() ? "PASS" : ("BLOCK".equals(severity) ? "FAIL" : "WARN");
    return new Check(id, name, severity, status, List.copyOf(problems));
  }

  // ------------------------------------------------------------------------------------------------ sentences
  static final List<String> SENTENCE_LISTS = List.of("summary", "case_context", "timeline_notes", "network_notes",
      "precedent_notes", "investigator_checklist", "what_would_change_my_mind");
  static final List<String> SENTENCE_SINGLES = List.of("headline", "confidence_statement", "action_rationale");

  private static List<Sentence> sentences(JsonNode out) {
    List<Sentence> all = new ArrayList<>();
    for (String k : SENTENCE_SINGLES) {
      all.add(sentence(k, out.get(k), false));
    }
    for (String k : SENTENCE_LISTS) {
      JsonNode arr = out.get(k);
      for (int i = 0; arr != null && i < arr.size(); i++) {
        all.add(sentence(k + "[" + i + "]", arr.get(i), false));
      }
    }
    JsonNode lims = out.get("limitations");
    for (int i = 0; lims != null && i < lims.size(); i++) {
      all.add(sentence("limitations[" + i + "]", lims.get(i), true));
    }
    return all;
  }

  private static Sentence sentence(String path, JsonNode n, boolean limitation) {
    List<String> ids = new ArrayList<>();
    n.get(limitation ? "limitation_ids" : "evidence_ids").forEach(x -> ids.add(x.asString()));
    return new Sentence(path, n.get("text").asString(), ids, limitation);
  }

  // ------------------------------------------------------------------------------------------------ checks
  private static List<String> v2(List<Sentence> ss) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      if (s.ids().isEmpty()) {
        p.add(s.path() + " cites nothing");
      }
      if (s.text().isBlank()) {
        p.add(s.path() + " is empty");
      }
    }
    return p;
  }

  private static List<String> v3(List<Sentence> ss, PackIndex px) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      for (String id : s.ids()) {
        if (!px.ids.contains(id)) {
          p.add(s.path() + " cites unknown ID " + id);
        } else if (s.limitation() && !px.limitationIds.contains(id)) {
          p.add(s.path() + " cites " + id + ", which is not a limitation ID");
        }
      }
    }
    return p;
  }

  private static List<String> v4(List<Sentence> ss, PackIndex px) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      Matcher m = PLACEHOLDER.matcher(s.text());
      while (m.find()) {
        String key = m.group(1);
        if (!px.numbers.containsKey(key)) {
          p.add(s.path() + " uses unknown number {{" + key + "}}");
          continue;
        }
        String owner = key.substring(0, Math.max(0, key.indexOf('.')));
        boolean cited = "S".equals(owner)
            ? s.ids().stream().anyMatch(px.tierReasonIds::contains)
            : s.ids().contains(owner);
        if (!cited) {
          p.add(s.path() + " uses {{" + key + "}} without citing " + ("S".equals(owner) ? "a tier reason" : owner));
        }
      }
      String rest = PLACEHOLDER.matcher(s.text()).replaceAll(" ");
      if (rest.contains("{{") || rest.contains("}}")) {
        p.add(s.path() + " has a malformed placeholder");
      }
    }
    return p;
  }

  private static List<String> v5(List<Sentence> ss, PackIndex px) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      String t = stripTrusted(s, px);
      t = PLACEHOLDER.matcher(t).replaceAll(" ");
      for (String token : px.allowedTokens) {
        t = removeToken(t, token);
      }
      Matcher m = Pattern.compile("[$]?\\d[\\d,.]*").matcher(t);
      if (m.find()) {
        p.add(s.path() + " contains the unregistered number '" + m.group() + "' (use a {{ID.key}} placeholder)");
      }
    }
    return p;
  }

  private static List<String> v6(List<Sentence> ss, PackIndex px) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      Matcher m = ENTITY.matcher(stripTrusted(s, px));
      while (m.find()) {
        if (!px.entities.contains(m.group())) {
          p.add(s.path() + " names unsupported entity " + m.group());
        }
      }
    }
    return p;
  }

  private static List<String> v7(List<Sentence> ss, PackIndex px) {
    List<String> terms = new ArrayList<>(px.forbidden);
    terms.addAll(EXTRA_FORBIDDEN);
    List<Pattern> patterns = terms.stream()
        .map(t -> Pattern.compile("\\b" + Pattern.quote(t.toLowerCase()) + "\\w*", Pattern.CASE_INSENSITIVE)).toList();
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      for (Pattern pat : patterns) {
        Matcher m = pat.matcher(s.text());
        if (m.find()) {
          p.add(s.path() + " uses forbidden wording '" + m.group() + "'");
        }
      }
      if (MARKUP.matcher(s.text()).find()) {
        p.add(s.path() + " contains a link, markup or code");
      }
      if (INJECTION.matcher(s.text()).find()) {
        p.add(s.path() + " contains an instruction to the reader");
      }
    }
    return p;
  }

  private static List<String> v8(JsonNode out, PackIndex px) {
    String h = out.get("hypothesis").asString();
    return px.hypotheses.contains(h) ? List.of() : List.of("hypothesis '" + h + "' is not one of " + px.hypotheses);
  }

  private static List<String> v9(JsonNode out, PackIndex px) {
    String a = out.get("recommended_action").asString();
    return px.permittedActions.contains(a) ? List.of()
        : List.of("action " + a + " is not permitted for tier " + px.tier + " (permitted: " + px.permittedActions + ")");
  }

  private static List<String> v10(List<Sentence> ss, PackIndex px) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      String t = stripTrusted(s, px);
      Matcher u = TIER_UPPER.matcher(t);
      while (u.find()) {
        if (!u.group(1).equals(px.tier)) {
          p.add(s.path() + " says " + u.group(1) + " but the computed tier is " + px.tier);
        }
      }
      Matcher w = TIER_WORDS.matcher(t);
      while (w.find()) {
        if (!w.group(1).toUpperCase().equals(px.tier)) {
          p.add(s.path() + " says '" + w.group() + "' but the computed tier is " + px.tier);
        }
      }
    }
    return p;
  }

  private static List<String> v11(JsonNode out, PackIndex px) {
    List<String> p = new ArrayList<>();
    boolean insufficient = out.get("insufficient_evidence").asBoolean();
    boolean mustBe = "LOW".equals(px.tier) || px.insufficientRequired;
    if (insufficient != mustBe) {
      p.add("insufficient_evidence is " + insufficient + " but the pack requires " + mustBe);
    }
    if ("LOW".equals(px.tier) && !"MONITOR".equals(out.get("recommended_action").asString())) {
      p.add("a LOW-tier item may only be MONITOR");
    }
    return p;
  }

  private static List<String> v12(JsonNode out, PackIndex px) {
    Set<String> present = new LinkedHashSet<>();
    out.get("limitations").forEach(l -> l.get("limitation_ids").forEach(i -> present.add(i.asString())));
    List<String> p = new ArrayList<>();
    for (String id : px.mandatoryLimitations) {
      if (!present.contains(id)) {
        p.add("mandatory limitation " + id + " is missing");
      }
    }
    return p;
  }

  private static List<String> v13(JsonNode out) {
    Map<String, String> elements = new LinkedHashMap<>();
    elements.put("summary", "evidence");
    elements.put("timeline_notes", "timeline");
    elements.put("network_notes", "network context");
    elements.put("confidence_statement", "confidence");
    elements.put("limitations", "limitations");
    elements.put("action_rationale", "recommended human-review action");
    elements.put("case_context", "supporting case and risk context");
    List<String> p = new ArrayList<>();
    elements.forEach((key, label) -> {
      JsonNode n = out.get(key);
      boolean empty = n == null || (n.isArray() && n.isEmpty())
          || (n.isObject() && (n.get("text") == null || n.get("text").asString().isBlank()))
          || (n.isArray() && n.valueStream().allMatch(x -> x.get("text").asString().isBlank()));
      if (empty) {
        p.add("required element '" + label + "' (" + key + ") is empty");
      }
    });
    if (out.get("recommended_action").asString().isBlank()) {
      p.add("required element 'recommended human-review action' (recommended_action) is empty");
    }
    return p;
  }

  private static List<String> v14(List<Sentence> ss) {
    List<String> p = new ArrayList<>();
    for (Sentence s : ss) {
      Matcher m = CERTAINTY.matcher(s.text());
      if (m.find()) {
        p.add(s.path() + " uses certainty language '" + m.group() + "'");
      }
    }
    return p;
  }

  private static List<String> v15(JsonNode out, PackIndex px) {
    List<String> p = new ArrayList<>();
    JsonNode summary = out.get("summary");
    summary.forEach(n -> {
      if (n.get("evidence_ids").valueStream().noneMatch(i -> px.evidenceIds.contains(i.asString())
          || px.policyIds.contains(i.asString()))) {
        p.add("an evidence sentence cites no evidence item or policy");
      }
    });
    out.get("timeline_notes").forEach(n -> {
      if (n.get("evidence_ids").valueStream().noneMatch(i -> px.timelineIds.contains(i.asString())
          || px.evidenceIds.contains(i.asString()))) {
        p.add("a timeline sentence cites no timeline or evidence item");
      }
    });
    out.get("network_notes").forEach(n -> {
      if (n.get("evidence_ids").valueStream().noneMatch(i -> px.networkIds.contains(i.asString())
          || px.limitationIds.contains(i.asString()))) {
        p.add("a network sentence cites no network item or limitation");
      }
    });
    return p;
  }

  // ------------------------------------------------------------------------------------------------ helpers
  /** The sentence with verbatim pack text of the items it cites removed (pack text is trusted as written). */
  private static String stripTrusted(Sentence s, PackIndex px) {
    String t = s.text();
    List<String> texts = new ArrayList<>();
    for (String id : s.ids()) {
      texts.addAll(px.textById.getOrDefault(id, List.of()));
    }
    texts.sort(Comparator.comparingInt(String::length).reversed());
    for (String x : texts) {
      if (!x.isBlank()) {
        t = t.replace(x, " ");
      }
    }
    return t;
  }

  private static String removeToken(String text, String token) {
    return text.replaceAll("(?<![A-Za-z0-9])" + Pattern.quote(token) + "(?![A-Za-z0-9])", " ");
  }
}
