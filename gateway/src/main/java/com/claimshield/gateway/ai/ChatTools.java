package com.claimshield.gateway.ai;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.QueueService;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.brief.BriefTemplate;
import com.claimshield.gateway.brief.ChatValidator.Sentence;
import com.claimshield.gateway.config.Json;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * The chatbot's read-only tools. Each tool returns FACTS: English sentences that already cite the IDs the tool
 * returned, with numbers as placeholders resolved from the tool's own registry. Case facts are taken from the same
 * validated template brief the workbench shows, so an answer can never say more than the evidence pack does.
 * Nothing here changes any data.
 */
@Component
public class ChatTools {

  public enum Intent {
    CASE_SUMMARY, CASE_WHY_RANKED, CASE_EVIDENCE, CASE_TIMELINE, CASE_NETWORK, CASE_CONFIDENCE, CASE_ACTION,
    CASE_OUTLOOK, CASE_PRECEDENTS, GLOSSARY, POLICY, PLATFORM_HELP, QUEUE_SUMMARY, RUN_CHANGES, NEEDS_CLARIFICATION,
    REFUSE_MEDICAL, REFUSE_LEGAL, REFUSE_ACTION, REFUSE_INJECTION, REFUSE_EVASION
  }

  /** The result of a tool call: what the answer may say, and the closed world it may cite. */
  public record Facts(Intent intent, List<Sentence> sentences, JsonNode pack, Set<String> sourceIds,
      Map<String, String> numbers, Map<String, List<String>> trusted, Set<String> entities,
      List<Map<String, String>> links, List<String> tools, boolean insufficient) {}

  private static final Pattern CASE_ID = Pattern.compile("(?i)\\bCASE-(\\d{4})\\b");
  private static final Pattern POLICY_ID = Pattern.compile("(?i)\\b((?:DME-)?POL-[A-Z]*-?[0-9.]+|DME-POL-[0-9.]+)\\b");

  private static final Pattern INJECTION = Pattern.compile(
      "(?i)ignore (all |any |the |your )?(previous|above|prior)|system prompt|reveal your|developer message|"
          + "jailbreak|pretend (to be|you)|act as (a|an) (?!reviewer)|disregard (the )?(rules|instructions)");
  private static final Pattern MEDICAL = Pattern.compile(
      "(?i)diagnos|prescrib|medication|dosage|treatment plan|should (the )?patient|symptom|clinical advice|"
          + "medical advice|what drug");
  private static final Pattern LEGAL = Pattern.compile(
      "(?i)\\bcriminal|\\bguilty|\\bfraud(?!ulent)?\\b.*\\b(is|was|did|committed)|\\b(is|was) .* (a )?fraud|"
          + "committ?ed fraud|arrest|prosecut|\\bsue\\b|lawsuit|intent(ion)? to|did (he|she|they|it) (steal|cheat)");
  private static final Pattern EVASION = Pattern.compile(
      "(?i)avoid (being )?(detect|flag|caught)|evade|get away with|hide (it )?from|bypass (the )?(rule|detect)");
  private static final Pattern ACTION = Pattern.compile(
      "(?i)\\b(approve|reject|close|delete|remove|override|update|edit|modify)\\b.*\\b(case|tier|score|rank|exception|"
          + "precedent|action|record|audit)\\b|\\bset (the )?(tier|score|risk|rank)\\b|\\bchange (the )?(tier|score)");

  private final ServingRepository serving;
  private final JdbcTemplate jdbc;
  private final Json json;
  private final QueueService queue;
  private final BriefTemplate template;

  public ChatTools(ServingRepository serving, JdbcTemplate jdbc, Json json, QueueService queue,
      BriefTemplate template) {
    this.serving = serving;
    this.jdbc = jdbc;
    this.json = json;
    this.queue = queue;
    this.template = template;
  }

  // -------------------------------------------------------------------------------------------------- routing
  public Intent route(String text, boolean hasCase) {
    String t = text == null ? "" : text.toLowerCase(Locale.ROOT);
    if (INJECTION.matcher(t).find()) {
      return Intent.REFUSE_INJECTION;
    }
    if (MEDICAL.matcher(t).find()) {
      return Intent.REFUSE_MEDICAL;
    }
    if (EVASION.matcher(t).find()) {
      return Intent.REFUSE_EVASION;
    }
    if (LEGAL.matcher(t).find()) {
      return Intent.REFUSE_LEGAL;
    }
    if (ACTION.matcher(t).find()) {
      return Intent.REFUSE_ACTION;
    }
    if (POLICY_ID.matcher(text == null ? "" : text).find() || has(t, "policy", "policies", "rule say", "what does the rule")) {
      return Intent.POLICY;
    }
    boolean caseish = hasCase || CASE_ID.matcher(t).find();
    if (caseish) {
      if (has(t, "predict", "outlook", "next month", "likely", "future", "thirty", "sixty", "ninety")
          || t.matches(".*\\b(30|60|90)\\b.*")) {
        return Intent.CASE_OUTLOOK;
      }
      if (has(t, "precedent", "seen this", "similar", "before", "history", "earlier case")) {
        return Intent.CASE_PRECEDENTS;
      }
      if (has(t, "network", "owner", "referr", "connected", "relationship", "ring", "building", "phone")) {
        return Intent.CASE_NETWORK;
      }
      if (has(t, "timeline", "when did", "since when", "began", "start date", "dates")) {
        return Intent.CASE_TIMELINE;
      }
      if (has(t, "confiden", "tier", "sure", "certain", "limitation", "caveat", "reliable", "trust")) {
        return Intent.CASE_CONFIDENCE;
      }
      if (has(t, "recommend", "next step", "what should", "do next", "suggested action", "action")) {
        return Intent.CASE_ACTION;
      }
      if (has(t, "why", "rank", "first", "priorit", "top", "order", "score", "risk")) {
        return Intent.CASE_WHY_RANKED;
      }
      if (has(t, "evidence", "claim", "duplicate", "lines", "proof", "which", "dollar", "amount", "exposure")) {
        return Intent.CASE_EVIDENCE;
      }
    }
    if (!caseish && has(t, "this case", "this provider", "is it ranked", "it ranked", "why is it")) {
      return Intent.NEEDS_CLARIFICATION;
    }
    if (has(t, "changed", "difference", "last run", "since the last", "what's new", "diff")) {
      return Intent.RUN_CHANGES;
    }
    if (has(t, "queue", "how many", "capacity", "funnel", "monitor list", "how much")) {
      return Intent.QUEUE_SUMMARY;
    }
    if (matchGlossary(t) != null || has(t, "what does", "what is", "meaning", "mean")) {
      return matchGlossary(t) != null ? Intent.GLOSSARY : (bestHelp(t) != null ? Intent.PLATFORM_HELP
          : Intent.NEEDS_CLARIFICATION);
    }
    if (bestHelp(t) != null || has(t, "how do i", "how can i", "how to")) {
      return Intent.PLATFORM_HELP;
    }
    return caseish ? Intent.CASE_SUMMARY : Intent.NEEDS_CLARIFICATION;
  }

  private static boolean has(String t, String... needles) {
    for (String n : needles) {
      if (t.contains(n)) {
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------- the tools
  public Facts run(Intent intent, String englishText, String contextCaseId, int horizon) {
    Matcher m = CASE_ID.matcher(englishText == null ? "" : englishText);
    String caseId = m.find() ? "CASE-" + m.group(1) : contextCaseId;
    return switch (intent) {
      case CASE_SUMMARY, CASE_WHY_RANKED, CASE_EVIDENCE, CASE_TIMELINE, CASE_NETWORK, CASE_CONFIDENCE, CASE_ACTION,
          CASE_PRECEDENTS -> caseFacts(intent, caseId);
      case CASE_OUTLOOK -> outlook(caseId);
      case GLOSSARY -> glossary(englishText);
      case POLICY -> policy(englishText);
      case PLATFORM_HELP -> help(englishText);
      case QUEUE_SUMMARY -> queueSummary(horizon);
      case RUN_CHANGES -> runChanges();
      default -> new Facts(intent, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(), List.of(), true);
    };
  }

  private Facts caseFacts(Intent intent, String caseId) {
    if (caseId == null) {
      return new Facts(Intent.NEEDS_CLARIFICATION, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_case_summary"), true);
    }
    String run = serving.requireRunId();
    JsonNode pack;
    try {
      serving.caseRow(run, caseId);
      pack = json.tree((String) serving.packRow(run, caseId).get("pack_json"));
    } catch (ApiException e) {
      return new Facts(Intent.NEEDS_CLARIFICATION, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_case_summary"), true);
    }
    JsonNode brief = template.build(pack);
    List<Sentence> out = new ArrayList<>();
    switch (intent) {
      case CASE_EVIDENCE -> {
        add(out, brief.get("summary"), 6);
      }
      case CASE_TIMELINE -> add(out, brief.get("timeline_notes"), 6);
      case CASE_NETWORK -> {
        add(out, brief.get("network_notes"), 4);
        add(out, brief.get("precedent_notes"), 0);
      }
      case CASE_CONFIDENCE -> {
        out.add(one(brief.get("confidence_statement")));
        add(out, brief.get("limitations"), 3, "limitation_ids");
      }
      case CASE_ACTION -> {
        out.add(one(brief.get("action_rationale")));
        add(out, brief.get("investigator_checklist"), 2);
      }
      case CASE_WHY_RANKED -> {
        out.add(one(brief.get("confidence_statement")));
        add(out, brief.get("case_context"), 3);
      }
      case CASE_PRECEDENTS -> {
        add(out, brief.get("precedent_notes"), 4);
        if (out.isEmpty()) {
          out.add(new Sentence("No earlier closed case was similar enough to cite for this case.",
              List.of(pack.get("limitations").get(0).get("id").asString())));
        }
      }
      default -> {
        out.add(one(brief.get("headline")));
        out.add(one(brief.get("confidence_statement")));
        out.add(one(brief.get("action_rationale")));
      }
    }
    List<Map<String, String>> links = new ArrayList<>();
    links.add(Map.of("type", "CASE", "id", caseId));
    return new Facts(intent, out.stream().limit(6).toList(), pack, new LinkedHashSet<>(), Map.of(), Map.of(),
        new LinkedHashSet<>(List.of(caseId)), links, List.of("get_case_summary", "get_case_evidence"), false);
  }

  private static void add(List<Sentence> out, JsonNode arr, int max) {
    add(out, arr, max, "evidence_ids");
  }

  private static void add(List<Sentence> out, JsonNode arr, int max, String idField) {
    if (arr == null) {
      return;
    }
    for (int i = 0; i < arr.size() && (max == 0 || i < max); i++) {
      out.add(one(arr.get(i), idField));
    }
  }

  private static Sentence one(JsonNode n) {
    return one(n, "evidence_ids");
  }

  private static Sentence one(JsonNode n, String idField) {
    List<String> ids = new ArrayList<>();
    n.get(idField).forEach(x -> ids.add(x.asString()));
    return new Sentence(n.get("text").asString(), ids);
  }

  private Facts outlook(String caseId) {
    if (caseId == null) {
      return caseFacts(Intent.CASE_SUMMARY, null);
    }
    JsonNode head;
    try {
      head = json.tree((String) serving.caseRow(serving.requireRunId(), caseId).get("header_json"));
    } catch (ApiException e) {
      return caseFacts(Intent.CASE_SUMMARY, null);
    }
    JsonNode o = head.get("outlook");
    if (o == null || !o.path("available").asBoolean()) {
      return new Facts(Intent.CASE_OUTLOOK, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_outlook"), true);
    }
    Map<String, String> numbers = new LinkedHashMap<>();
    for (String h : List.of("30", "60", "90")) {
      numbers.put("OUTLOOK.p" + h, Math.round(o.get("horizons").get(h).get("probability").asDouble() * 100) + "%");
    }
    List<String> labels = new ArrayList<>();
    o.get("horizons").get("90").path("factors").forEach(f -> labels.add(f.get("label").asString()));
    List<Sentence> out = new ArrayList<>();
    out.add(new Sentence("Over the next thirty days the model estimates a {{OUTLOOK.p30}} chance of repeat or escalating "
        + "activity, {{OUTLOOK.p60}} over sixty days and {{OUTLOOK.p90}} over ninety days.", List.of("OUTLOOK")));
    if (!labels.isEmpty()) {
      out.add(new Sentence("The factors most associated with the ninety-day estimate are "
          + String.join(", ", labels) + "; this is an association, not a cause.", List.of("OUTLOOK")));
    }
    out.add(new Sentence(o.path("caveat").asString(), List.of("OUTLOOK")));
    return new Facts(Intent.CASE_OUTLOOK, out, null, Set.of("OUTLOOK"), numbers,
        Map.of("OUTLOOK", List.of(o.path("caveat").asString(), String.join(", ", labels))), Set.of(caseId),
        List.of(Map.of("type", "CASE", "id", caseId)), List.of("get_outlook"), false);
  }

  private Facts glossary(String text) {
    String t = text.toLowerCase(Locale.ROOT);
    Map<String, Object> row = matchGlossary(t);
    if (row == null) {
      return new Facts(Intent.GLOSSARY, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_glossary"), true);
    }
    String id = "glossary:" + row.get("term_id");
    String s = row.get("term") + ": " + row.get("definition");
    return new Facts(Intent.GLOSSARY, List.of(new Sentence(s, List.of(id))), null, Set.of(id), Map.of(),
        Map.of(id, List.of(s)), Set.of(), List.of(), List.of("get_glossary"), false);
  }

  private Map<String, Object> matchGlossary(String t) {
    Map<String, Object> best = null;
    int bestLen = 0;
    for (Map<String, Object> r : jdbc.queryForList("SELECT term_id, term, definition FROM serving_glossary")) {
      String term = ((String) r.get("term")).toLowerCase(Locale.ROOT);
      if (t.contains(term) && term.length() > bestLen) {
        best = r;
        bestLen = term.length();
      }
    }
    return best;
  }

  private Facts policy(String text) {
    Matcher m = POLICY_ID.matcher(text);
    List<Map<String, Object>> rows = new ArrayList<>();
    if (m.find()) {
      rows = jdbc.queryForList("SELECT section_id, title, body FROM serving_policy_section WHERE UPPER(section_id) "
          + "= ?", m.group(1).toUpperCase(Locale.ROOT));
    }
    if (rows.isEmpty()) {
      String t = text.toLowerCase(Locale.ROOT);
      for (Map<String, Object> r : jdbc.queryForList("SELECT section_id, title, body FROM serving_policy_section")) {
        String title = ((String) r.get("title")).toLowerCase(Locale.ROOT);
        if (t.contains(title) || overlap(t, title) >= 2) {
          rows.add(r);
          break;
        }
      }
    }
    if (rows.isEmpty()) {
      return new Facts(Intent.POLICY, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_policy"), true);
    }
    Map<String, Object> r = rows.get(0);
    String id = (String) r.get("section_id");
    String s = r.get("title") + ": " + r.get("body");
    return new Facts(Intent.POLICY, List.of(new Sentence(s, List.of(id))), null, Set.of(id), Map.of(),
        Map.of(id, List.of(s, (String) r.get("title"))), Set.of(id), List.of(Map.of("type", "POLICY", "id", id)),
        List.of("get_policy"), false);
  }

  private Map<String, Object> bestHelp(String t) {
    Map<String, Object> best = null;
    int score = 1;
    for (Map<String, Object> r : jdbc.queryForList("SELECT article_id, title, body FROM serving_help_article")) {
      int s = overlap(t, ((String) r.get("title")).toLowerCase(Locale.ROOT)) * 2
          + overlap(t, ((String) r.get("body")).toLowerCase(Locale.ROOT)) / 4;
      if (s > score) {
        best = r;
        score = s;
      }
    }
    return best;
  }

  private static int overlap(String a, String b) {
    Set<String> stop = Set.of("the", "a", "an", "is", "are", "of", "to", "how", "do", "i", "what", "does", "in", "for",
        "and", "or", "this", "that", "it", "my", "me", "can", "you");
    Set<String> bw = new LinkedHashSet<>(List.of(b.split("\\W+")));
    int n = 0;
    for (String w : a.split("\\W+")) {
      if (w.length() > 2 && !stop.contains(w) && bw.contains(w)) {
        n++;
      }
    }
    return n;
  }

  private Facts help(String text) {
    Map<String, Object> r = bestHelp(text.toLowerCase(Locale.ROOT));
    if (r == null) {
      return new Facts(Intent.PLATFORM_HELP, List.of(), null, Set.of(), Map.of(), Map.of(), Set.of(), List.of(),
          List.of("get_platform_help"), true);
    }
    String id = "help:" + r.get("article_id");
    String s = r.get("title") + ". " + r.get("body");
    return new Facts(Intent.PLATFORM_HELP, List.of(new Sentence(s, List.of(id))), null, Set.of(id), Map.of(),
        Map.of(id, List.of(s, (String) r.get("title"), (String) r.get("body"))), Set.of(), List.of(),
        List.of("get_platform_help"), false);
  }

  private JsonNode funnel() {
    return json.tree(serving.singleJson("serving_funnel", "funnel_json", serving.requireRunId()));
  }

  private Facts queueSummary(int horizon) {
    JsonNode f = funnel();
    Map<String, String> n = new LinkedHashMap<>();
    for (JsonNode s : f.get("stages")) {
      n.put("FUNNEL." + s.get("key").asString(), String.valueOf(s.get("count").asInt()));
    }
    n.put("FUNNEL.high", String.valueOf(f.get("tiers").get("HIGH").asInt()));
    n.put("FUNNEL.medium", String.valueOf(f.get("tiers").get("MEDIUM").asInt()));
    n.put("FUNNEL.monitor", String.valueOf(f.get("tiers").get("MONITOR").asInt()));
    List<Sentence> out = new ArrayList<>();
    out.add(new Sentence("The latest run raised {{FUNNEL.alerts}} alerts; {{FUNNEL.active}} stayed active after approved "
        + "exceptions and they consolidated into {{FUNNEL.cases}} cases.", List.of("FUNNEL")));
    out.add(new Sentence("Of those cases {{FUNNEL.high}} are in the highest confidence tier and {{FUNNEL.medium}} need expert "
        + "review; {{FUNNEL.monitor}} further items are on the Monitor list instead of the queue.", List.of("FUNNEL")));
    out.add(new Sentence("{{FUNNEL.inCapacity}} cases fit inside the current investigator capacity.", List.of("FUNNEL")));
    return new Facts(Intent.QUEUE_SUMMARY, out, null, Set.of("FUNNEL"), n, Map.of(), Set.of(),
        List.of(Map.of("type", "PAGE", "id", "queue")), List.of("get_funnel"), false);
  }

  private Facts runChanges() {
    JsonNode f = funnel();
    JsonNode d = f.path("diff");
    if (!d.isObject() || d.isEmpty()) {
      return new Facts(Intent.RUN_CHANGES, List.of(new Sentence("This is the first run, so there is nothing to "
          + "compare it with yet.", List.of("FUNNEL"))), null, Set.of("FUNNEL"), Map.of(), Map.of(), Set.of(),
          List.of(), List.of("get_funnel"), false);
    }
    Map<String, String> n = new LinkedHashMap<>();
    n.put("FUNNEL.dAlerts", String.valueOf(Math.abs(d.get("alerts").asInt())));
    n.put("FUNNEL.dCases", String.valueOf(Math.abs(d.get("cases").asInt())));
    n.put("FUNNEL.moved", String.valueOf(d.get("tierChanges").size()));
    List<Sentence> out = new ArrayList<>();
    out.add(new Sentence("Compared with the previous run there are {{FUNNEL.dAlerts}} "
        + (d.get("alerts").asInt() <= 0 ? "fewer" : "more") + " active alerts and {{FUNNEL.dCases}} "
        + (d.get("cases").asInt() <= 0 ? "fewer" : "more") + " cases.", List.of("FUNNEL")));
    out.add(new Sentence("{{FUNNEL.moved}} cases changed tier; each change names the approved exception that caused it.",
        List.of("FUNNEL")));
    return new Facts(Intent.RUN_CHANGES, out, null, Set.of("FUNNEL"), n, Map.of(), Set.of(),
        List.of(Map.of("type", "PAGE", "id", "brain")), List.of("get_funnel"), false);
  }
}
