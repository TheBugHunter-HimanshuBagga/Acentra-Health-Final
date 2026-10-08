package com.claimshield.gateway.knowledge;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.config.Json;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api")
public class KnowledgeController {

  public record CosignRequest(@NotBlank String decision) {}

  public record ProposeRequest(@NotBlank String caseId, @NotBlank String precedentId) {}

  public record ApprovalRequest(@NotBlank String decision, String notes) {}

  private final KnowledgeService service;
  private final ServingRepository serving;
  private final JdbcTemplate jdbc;
  private final Json json;

  public KnowledgeController(KnowledgeService service, ServingRepository serving, JdbcTemplate jdbc, Json json) {
    this.service = service;
    this.serving = serving;
    this.jdbc = jdbc;
    this.json = json;
  }

  // -------------------------------------------------------------------------------------------- precedents
  @GetMapping("/precedents")
  public List<Map<String, Object>> precedents(@RequestParam(required = false) String status,
      @RequestParam(required = false) String scheme) {
    return service.allPrecedents(status, scheme);
  }

  @PostMapping("/precedents/{id}/cosign")
  public Map<String, Object> cosign(@AuthenticationPrincipal AppUser u, @PathVariable String id,
      @Valid @RequestBody CosignRequest body) {
    return service.cosign(u, id, body.decision());
  }

  @GetMapping("/cases/{caseId}/precedents")
  public List<Map<String, Object>> casePrecedents(@PathVariable String caseId) {
    return service.casePrecedents(caseId);
  }

  // -------------------------------------------------------------------------------------------- exceptions
  @GetMapping("/exceptions")
  public List<Map<String, Object>> exceptions(@RequestParam(required = false) String status) {
    return service.exceptions(status);
  }

  @GetMapping("/exceptions/{excId}")
  public Map<String, Object> exception(@PathVariable String excId) {
    return service.exception(excId);
  }

  @PostMapping("/exceptions/propose")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> propose(@AuthenticationPrincipal AppUser u, @Valid @RequestBody ProposeRequest body) {
    return service.propose(u, body.caseId(), body.precedentId());
  }

  @PostMapping("/exceptions/{excId}/simulate")
  public Map<String, Object> simulate(@AuthenticationPrincipal AppUser u, @PathVariable String excId) {
    return service.simulate(u, excId);
  }

  @PostMapping("/exceptions/{excId}/submit")
  public Map<String, Object> submit(@AuthenticationPrincipal AppUser u, @PathVariable String excId) {
    return service.submit(u, excId);
  }

  @PostMapping("/exceptions/{excId}/approve")
  public Map<String, Object> approve(@AuthenticationPrincipal AppUser u, @PathVariable String excId,
      @Valid @RequestBody ApprovalRequest body) {
    return service.approve(u, excId, body.decision(), body.notes());
  }

  @PostMapping("/exceptions/{excId}/retire")
  public Map<String, Object> retire(@AuthenticationPrincipal AppUser u, @PathVariable String excId) {
    return service.retire(u, excId);
  }

  @PostMapping("/exceptions/{excId}/explain")
  public Map<String, Object> explain(@PathVariable String excId) {
    return service.explain(excId);
  }

  // -------------------------------------------------------------------------------------------------- jobs
  @PostMapping("/runs/rerun")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Map<String, Object> rerun(@AuthenticationPrincipal AppUser u) {
    return service.startRerun(u, "Manual re-run");
  }

  @GetMapping("/jobs/{jobId}")
  public Map<String, Object> job(@PathVariable String jobId) {
    return service.job(jobId);
  }

  @GetMapping("/jobs")
  public List<Map<String, Object>> jobs() {
    return service.jobs();
  }

  /** Run history with the funnel and the diff each run made against the one before: how knowledge compounds. */
  @GetMapping("/runs")
  public List<Map<String, Object>> runs() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT r.run_id, r.created_at, r.exception_set_json, r.precedent_count, f.funnel_json FROM serving_run r "
            + "JOIN serving_funnel f ON f.run_id = r.run_id ORDER BY r.created_at DESC, r.run_id DESC")) {
      JsonNode f = json.tree((String) r.get("funnel_json"));
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("runId", r.get("run_id"));
      m.put("createdAt", r.get("created_at"));
      m.put("exceptionSet", json.tree((String) r.get("exception_set_json")));
      m.put("precedentCount", r.get("precedent_count"));
      m.put("stages", f.get("stages"));
      m.put("tiers", f.get("tiers"));
      m.put("diffFrom", f.get("diffFrom"));
      m.put("diff", f.get("diff"));
      m.put("suppressedByException", f.get("suppressedByException"));
      out.add(m);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- knowledge
  private ResponseEntity<List<Map<String, Object>>> rows(String sql, Object... args) {
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(jdbc.queryForList(sql, args));
  }

  @GetMapping("/knowledge/policies")
  public ResponseEntity<List<Map<String, Object>>> policies() {
    return rows("SELECT section_id AS sectionId, doc_id AS docId, title, body, version, eff_dt AS effDt, provenance "
        + "FROM serving_policy_section ORDER BY section_id");
  }

  @GetMapping("/knowledge/rules")
  public List<Map<String, Object>> rules() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT rule_id, version, name, scheme_type, family, status, params_json, policy_ids_json "
            + "FROM serving_rule_registry ORDER BY rule_id")) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("ruleId", r.get("rule_id"));
      m.put("version", r.get("version"));
      m.put("name", r.get("name"));
      m.put("schemeType", r.get("scheme_type"));
      m.put("family", r.get("family"));
      m.put("status", r.get("status"));
      m.put("policyIds", json.tree((String) r.get("policy_ids_json")));
      out.add(m);
    }
    return out;
  }

  @GetMapping("/knowledge/glossary")
  public ResponseEntity<List<Map<String, Object>>> glossary() {
    return rows("SELECT term_id AS termId, term, definition, category FROM serving_glossary ORDER BY term_id");
  }

  @GetMapping("/knowledge/help")
  public ResponseEntity<List<Map<String, Object>>> help() {
    return rows("SELECT article_id AS articleId, title, body FROM serving_help_article ORDER BY article_id");
  }

  @GetMapping("/knowledge/lint")
  public List<Map<String, Object>> lint() {
    String run = serving.requireRunId();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT finding_id, type, severity, entities_json, message FROM serving_knowledge_lint WHERE run_id = ? "
            + "ORDER BY finding_id", run)) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("findingId", r.get("finding_id"));
      m.put("type", r.get("type"));
      m.put("severity", r.get("severity"));
      m.put("entities", json.tree((String) r.get("entities_json")));
      m.put("message", r.get("message"));
      out.add(m);
    }
    return out;
  }

  /** The knowledge map: rules, the policy sections they cite, governed exceptions and the precedents per scheme. */
  @GetMapping("/knowledge/graph")
  public Map<String, Object> knowledgeGraph() {
    List<Map<String, Object>> nodes = new ArrayList<>();
    List<Map<String, Object>> edges = new ArrayList<>();
    for (Map<String, Object> p : jdbc.queryForList("SELECT section_id, title FROM serving_policy_section")) {
      nodes.add(node((String) p.get("section_id"), "policy", (String) p.get("title")));
    }
    Map<String, List<String>> bySchemeRules = new LinkedHashMap<>();
    for (Map<String, Object> r : rules()) {
      nodes.add(node((String) r.get("ruleId"), "rule", (String) r.get("name")));
      ((JsonNode) r.get("policyIds")).forEach(pid -> edges.add(edge((String) r.get("ruleId"), pid.asString(),
          "cites")));
      bySchemeRules.computeIfAbsent((String) r.get("schemeType"), k -> new ArrayList<>()).add((String) r.get("ruleId"));
    }
    Map<String, Long> perScheme = new LinkedHashMap<>();
    for (Map<String, Object> p : service.allPrecedents("ACTIVE", null)) {
      perScheme.merge((String) p.get("schemeType"), 1L, Long::sum);
    }
    perScheme.forEach((scheme, n) -> {
      nodes.add(node("PRECEDENTS-" + scheme, "precedents", n + " " + scheme + " precedents"));
      bySchemeRules.getOrDefault(scheme, List.of()).forEach(rule -> edges.add(edge("PRECEDENTS-" + scheme, rule,
          "informs")));
    });
    for (Map<String, Object> e : service.exceptions("APPROVED")) {
      nodes.add(node((String) e.get("excId"), "exception", (String) e.get("excId")));
      ((JsonNode) e.get("scope")).get("rule_ids").forEach(r -> edges.add(edge((String) e.get("excId"), r.asString(),
          "excepts")));
    }
    Map<String, Object> g = new LinkedHashMap<>();
    g.put("nodes", nodes);
    g.put("edges", edges.stream().filter(ed -> nodes.stream().anyMatch(n -> n.get("id").equals(ed.get("target"))))
        .toList());
    return g;
  }

  private static Map<String, Object> node(String id, String type, String label) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("type", type);
    m.put("label", label);
    return m;
  }

  private static Map<String, Object> edge(String a, String b, String type) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", type + ":" + a + ">" + b);
    m.put("source", a);
    m.put("target", b);
    m.put("type", type);
    return m;
  }

  @GetMapping("/compounding")
  public Map<String, Object> compounding() {
    JsonNode dash = json.tree(serving.singleJson("serving_dashboard", "dashboard_json", serving.requireRunId()));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("current", dash.get("compounding"));
    m.put("runs", runs());
    m.put("activeLivePrecedents", jdbc.queryForObject(
        "SELECT COUNT(*) FROM wf_precedent WHERE source = 'LIVE' AND status = 'ACTIVE'", Long.class));
    m.put("pendingCosign", jdbc.queryForObject(
        "SELECT COUNT(*) FROM wf_precedent WHERE status = 'PENDING_COSIGN'", Long.class));
    m.put("approvedExceptions", jdbc.queryForObject(
        "SELECT COUNT(*) FROM wf_exception_rule WHERE status = 'APPROVED'", Long.class));
    if (!m.containsKey("current")) {
      throw ApiException.notFound("Compounding metrics");
    }
    return m;
  }
}
