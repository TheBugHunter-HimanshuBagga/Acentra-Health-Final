package com.claimshield.gateway.brief;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Read-only lookup tables over one evidence pack: the closed world a brief may draw on. */
final class PackIndex {

  final String caseId;
  final String tier;
  final boolean insufficientRequired;
  final Set<String> ids = new LinkedHashSet<>();
  final Set<String> evidenceIds = new LinkedHashSet<>();
  final Set<String> tierReasonIds = new LinkedHashSet<>();
  final Set<String> limitationIds = new LinkedHashSet<>();
  final Set<String> mandatoryLimitations = new LinkedHashSet<>();
  final Set<String> timelineIds = new LinkedHashSet<>();
  final Set<String> policyIds = new LinkedHashSet<>();
  final Set<String> networkIds = new LinkedHashSet<>();
  final Set<String> entities = new LinkedHashSet<>();
  final Set<String> hypotheses = new LinkedHashSet<>();
  final List<String> permittedActions = new ArrayList<>();
  final List<String> forbidden = new ArrayList<>();
  /** number key -> first allowed rendering */
  final Map<String, String> numbers = new LinkedHashMap<>();
  /** cited ID -> the pack's own wording for it (trusted verbatim) */
  final Map<String, List<String>> textById = new LinkedHashMap<>();
  /** dates, entities, codes and IDs that may appear as digits in free text, longest first */
  final List<String> allowedTokens;

  PackIndex(JsonNode pack) {
    caseId = pack.get("caseId").asString();
    tier = pack.get("scores").get("tier").asString();
    insufficientRequired = pack.get("insufficientEvidenceRequired").asBoolean();

    for (JsonNode e : pack.get("evidence")) {
      String id = e.get("id").asString();
      evidenceIds.add(id);
      add(id, e, "name", "statement");
    }
    for (JsonNode r : pack.get("scores").get("tierReasons")) {
      tierReasonIds.add(r.get("id").asString());
      add(r.get("id").asString(), r, "text");
    }
    for (JsonNode l : pack.get("limitations")) {
      String id = l.get("id").asString();
      limitationIds.add(id);
      if (l.get("mandatory").asBoolean()) {
        mandatoryLimitations.add(id);
      }
      add(id, l, "text");
    }
    for (JsonNode t : pack.get("timeline")) {
      timelineIds.add(t.get("id").asString());
      add(t.get("id").asString(), t, "text");
    }
    for (JsonNode p : pack.get("policies")) {
      policyIds.add(p.get("id").asString());
      add(p.get("id").asString(), p, "title", "text");
    }
    for (JsonNode g : pack.get("glossary")) {
      add(g.get("id").asString(), g, "term", "definition");
    }
    for (JsonNode n : pack.get("network")) {
      networkIds.add(n.get("id").asString());
      add(n.get("id").asString(), n, "statement", "text");
    }
    for (JsonNode n : pack.get("precedents")) {
      add(n.get("id").asString(), n, "statement", "text");
    }
    // the pack's own explanation (WHY) and confidence wording (CONF) are citable verbatim
    if (pack.hasNonNull("explanation")) {
      add("WHY", pack.get("explanation"), "headline", "confidenceLine");
    }
    if (pack.hasNonNull("confidence")) {
      add("CONF", pack.get("confidence"), "statement");
      add("CONF", pack.get("confidence").get("route"), "text");
      pack.get("confidence").get("evidence").get("missing").forEach(x -> textById
          .computeIfAbsent("CONF", k -> new ArrayList<>()).add(x.asString()));
    }
    // impact items (IM*), conflicting signals (CF*) and reasoning steps (RS*) are citable like evidence
    if (pack.hasNonNull("impact")) {
      for (JsonNode i : pack.get("impact").get("items")) {
        add(i.get("id").asString(), i, "label", "why");
      }
    }
    if (pack.hasNonNull("confidence")) {
      for (JsonNode c : pack.get("confidence").get("evidence").get("contradicting")) {
        add(c.get("id").asString(), c, "text");
      }
    }
    if (pack.hasNonNull("reasoning")) {
      for (JsonNode r : pack.get("reasoning").get("steps")) {
        add(r.get("id").asString(), r, "title", "summary");
      }
    }
    ids.addAll(textById.keySet());

    pack.get("numbers").properties().forEach(en -> numbers.put(en.getKey(), en.getValue().get("fmt").get(0).asString()));
    pack.get("hypotheses").forEach(h -> hypotheses.add(h.asString()));
    pack.get("permittedActions").forEach(a -> permittedActions.add(a.get("action").asString()));
    pack.get("forbiddenTerms").forEach(f -> forbidden.add(f.asString()));

    entities.add(caseId);
    pack.get("entities").forEach(e -> entities.add(e.asString()));
    pack.get("subjects").forEach(s -> entities.add(s.get("id").asString()));

    Set<String> tokens = new LinkedHashSet<>(entities);
    pack.get("dates").forEach(d -> tokens.add(d.asString()));
    pack.get("codes").forEach(c -> tokens.add(c.asString()));
    tokens.addAll(ids);
    allowedTokens = tokens.stream().sorted(Comparator.comparingInt(String::length).reversed()).toList();
  }

  private void add(String id, JsonNode node, String... fields) {
    List<String> texts = textById.computeIfAbsent(id, k -> new ArrayList<>());
    for (String f : fields) {
      if (node.hasNonNull(f)) {
        texts.add(node.get(f).asString());
      }
    }
  }
}
