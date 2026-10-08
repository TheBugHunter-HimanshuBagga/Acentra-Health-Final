package com.claimshield.gateway.knowledge;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import com.claimshield.gateway.brief.BriefValidator;
import com.claimshield.gateway.config.Json;
import com.claimshield.gateway.config.Tx;
import com.claimshield.gateway.engine.EngineClient;
import com.claimshield.gateway.engine.EngineClient.EngineException;
import com.claimshield.gateway.workflow.CaseWorkflowService;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * The Second Brain's workflow: precedents (created when a case closes, active after a second person co-signs),
 * governed exception rules (propose, simulate, submit, approve by someone else, retire) and the re-run jobs that make
 * approved knowledge change the queue. Nothing here scores a case: the engine does that, deterministically. Nothing
 * here lets one person change future scoring alone, and no model ever approves anything.
 */
@Service
public class KnowledgeService {

  static final Set<String> NON_EXEMPTABLE = Set.of("R-EXCL-01", "R-DOD-01", "R-IP-01", "R-DUP-01", "R-PTP-01",
      "R-MUE-01", "R-GEO-01");
  static final List<String> FORBIDDEN = List.of("fraud", "fraudulent", "criminal", "guilty", "illegal", "steal",
      "scam", "intentional", "deliberate", "knowingly", "kickback");
  static final int REVIEW_DAYS = 90;

  private final JdbcTemplate jdbc;
  private final ServingRepository serving;
  private final AuditService audit;
  private final Tx tx;
  private final Json json;
  private final Clock clock;
  private final EngineClient engine;

  public KnowledgeService(JdbcTemplate jdbc, ServingRepository serving, AuditService audit, Tx tx, Json json,
      Clock clock, EngineClient engine) {
    this.jdbc = jdbc;
    this.serving = serving;
    this.audit = audit;
    this.tx = tx;
    this.json = json;
    this.clock = clock;
    this.engine = engine;
  }

  private String now() {
    return Instant.now(clock).toString();
  }

  private static void requireRole(AppUser u, Role... allowed) {
    for (Role r : allowed) {
      if (u.role() == r) {
        return;
      }
    }
    throw ApiException.forbiddenRole("The " + u.role() + " role cannot do this.");
  }

  private static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  private static ApiException engineProblem(EngineException e) {
    if (e.status() == 0) {
      return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ENGINE_UNAVAILABLE", "Analysis engine unavailable",
          e.getMessage() + " Stored results are still available; this action needs the engine.");
    }
    if (e.status() == 409) {
      return new ApiException(HttpStatus.CONFLICT, "JOB_RUNNING", "An analysis job is already running",
          "Wait for the running job to finish.");
    }
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "ENGINE_REJECTED", "The engine refused the request",
        e.getMessage());
  }

  private static String sha(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(
          java.nio.charset.StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // ------------------------------------------------------------------------------------------------ precedents
  public Map<String, Object> precedent(String id) {
    List<Map<String, Object>> r = jdbc.queryForList("SELECT * FROM wf_precedent WHERE precedent_id = ?", id);
    if (r.isEmpty()) {
      throw ApiException.notFound("Precedent " + id);
    }
    return precedentView(r.get(0));
  }

  Map<String, Object> precedentView(Map<String, Object> p) {
    return map("precedentId", p.get("precedent_id"), "source", p.get("source"), "caseId", p.get("case_id"),
        "schemeType", p.get("scheme_type"), "specialtyCode", p.get("specialty_code"),
        "disposition", p.get("disposition"), "reasonCode", p.get("reason_code"), "rationale", p.get("rationale"),
        "aiDrafted", ((Number) p.get("ai_drafted")).intValue() == 1, "status", p.get("status"),
        "createdBy", p.get("created_by"), "createdAt", p.get("created_at"), "cosignedBy", p.get("cosigned_by"),
        "cosignedAt", p.get("cosigned_at"), "reinforcesId", p.get("reinforces_id"),
        "conflictsWithId", p.get("conflicts_with_id"), "exposure", p.get("exposure"), "closedDt", p.get("closed_dt"));
  }

  /** Seed (from the engine) and live precedents together, newest knowledge last. */
  public List<Map<String, Object>> allPrecedents(String status, String scheme) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> p : jdbc.queryForList(
        "SELECT precedent_id, scheme_type, specialty_code, disposition, reason_code, rationale, closed_dt "
            + "FROM serving_precedent_seed ORDER BY precedent_id")) {
      out.add(map("precedentId", p.get("precedent_id"), "source", "SEED", "caseId", null,
          "schemeType", p.get("scheme_type"), "specialtyCode", p.get("specialty_code"),
          "disposition", p.get("disposition"), "reasonCode", p.get("reason_code"), "rationale", p.get("rationale"),
          "aiDrafted", false, "status", "ACTIVE", "createdBy", "seed", "closedDt", p.get("closed_dt")));
    }
    for (Map<String, Object> p : jdbc.queryForList("SELECT * FROM wf_precedent ORDER BY created_at, precedent_id")) {
      out.add(precedentView(p));
    }
    return out.stream().filter(p -> status == null || status.isBlank() || status.equals(p.get("status")))
        .filter(p -> scheme == null || scheme.isBlank() || scheme.equals(p.get("schemeType"))).toList();
  }

  public Map<String, Object> cosign(AppUser u, String precedentId, String decision) {
    requireRole(u, Role.SUPERVISOR);
    if (!"CONFIRM".equals(decision) && !"REJECT".equals(decision)) {
      throw ApiException.invalid("decision", "must be CONFIRM or REJECT");
    }
    Map<String, Object> p = jdbc.queryForList("SELECT * FROM wf_precedent WHERE precedent_id = ?", precedentId)
        .stream().findFirst().orElseThrow(() -> ApiException.notFound("Precedent " + precedentId));
    if (!"PENDING_COSIGN".equals(p.get("status"))) {
      throw ApiException.conflict("Precedent " + precedentId + " is " + p.get("status") + " and cannot be co-signed.");
    }
    if (u.username().equals(p.get("created_by"))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SELF_APPROVAL_FORBIDDEN", "A second person must co-sign",
          "You closed the case that created this precedent; another supervisor has to co-sign it.");
    }
    if ("REJECT".equals(decision)) {
      return tx.write(() -> {
        jdbc.update("UPDATE wf_precedent SET status = 'RETIRED', cosigned_by = ?, cosigned_at = ? "
            + "WHERE precedent_id = ? AND status = 'PENDING_COSIGN'", u.username(), now(), precedentId);
        audit.append(u.username(), u.role().name(), "PRECEDENT_RETIRED", "precedent", precedentId,
            map("decision", "REJECT", "caseId", p.get("case_id")));
        return map("precedentId", precedentId, "status", "RETIRED", "jobId", null);
      });
    }
    // completeness gates: why one closed case cannot poison the knowledge base
    String rationale = String.valueOf(p.get("rationale"));
    List<Map<String, String>> problems = new ArrayList<>();
    if (rationale.trim().length() < CaseWorkflowService.MIN_RATIONALE) {
      problems.add(Map.of("field", "rationale", "message", "too short to be useful"));
    }
    String low = rationale.toLowerCase(Locale.ROOT);
    List<String> terms = new ArrayList<>(FORBIDDEN);
    terms.addAll(BriefValidator.EXTRA_FORBIDDEN);
    for (String t : terms) {
      if (java.util.regex.Pattern.compile("\\b" + java.util.regex.Pattern.quote(t) + "\\w*").matcher(low).find()) {
        problems.add(Map.of("field", "rationale", "message", "uses wording the platform does not allow: " + t));
        break;
      }
    }
    JsonNode fv = json.tree((String) p.get("feature_vector_json"));
    if (!fv.isArray() || fv.size() != 12) {
      problems.add(Map.of("field", "featureVector", "message", "incomplete feature vector"));
    }
    if (!problems.isEmpty()) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "PRECEDENT_INCOMPLETE", "The precedent is not complete",
          "A precedent needs a full feature vector and a clear rationale before it can become active.", problems);
    }
    // conflict / reinforcement check against the knowledge already active (the engine knows the z-score scale)
    List<Map<String, Object>> active = new ArrayList<>();
    for (Map<String, Object> a : jdbc.queryForList(
        "SELECT precedent_id, disposition, feature_vector_json FROM wf_precedent WHERE status = 'ACTIVE'")) {
      active.add(map("precedentId", a.get("precedent_id"), "disposition", a.get("disposition"),
          "featureVector", json.tree((String) a.get("feature_vector_json"))));
    }
    String checkStatus = "CHECKED";
    List<String> conflicts = new ArrayList<>();
    List<String> reinforces = new ArrayList<>();
    try {
      JsonNode res = engine.post("/internal/precedent/check",
          map("featureVector", fv, "disposition", p.get("disposition"), "active", active));
      res.get("conflicts").forEach(c -> conflicts.add(c.get("precedentId").asString()));
      res.get("reinforces").forEach(c -> reinforces.add(c.get("precedentId").asString()));
    } catch (EngineException e) {
      checkStatus = "UNAVAILABLE";      // the precedent is still valid; the lint pass will catch conflicts later
    }
    final String fCheck = checkStatus;
    Map<String, Object> result = tx.write(() -> {
      int n = jdbc.update("UPDATE wf_precedent SET status = 'ACTIVE', cosigned_by = ?, cosigned_at = ?, "
          + "reinforces_id = ?, conflicts_with_id = ? WHERE precedent_id = ? AND status = 'PENDING_COSIGN'",
          u.username(), now(), reinforces.isEmpty() ? null : reinforces.get(0),
          conflicts.isEmpty() ? null : conflicts.get(0), precedentId);
      if (n == 0) {
        throw ApiException.conflict("Precedent " + precedentId + " was already co-signed.");
      }
      audit.append(u.username(), u.role().name(), "PRECEDENT_COSIGNED", "precedent", precedentId,
          map("caseId", p.get("case_id"), "disposition", p.get("disposition"), "check", fCheck));
      for (String c : conflicts) {
        audit.append(u.username(), u.role().name(), "PRECEDENT_CONFLICT", "precedent", precedentId,
            map("conflictsWith", c));
      }
      for (String c : reinforces) {
        audit.append(u.username(), u.role().name(), "PRECEDENT_REINFORCED", "precedent", precedentId,
            map("reinforces", c));
      }
      return map("precedentId", precedentId, "status", "ACTIVE", "conflicts", conflicts, "reinforces", reinforces,
          "check", fCheck);
    });
    result.put("rerun", rerunSafely(u, "Precedent " + precedentId + " became active"));
    return result;
  }

  public List<Map<String, Object>> casePrecedents(String caseId) {
    String run = serving.requireRunId();
    serving.caseRow(run, caseId);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT * FROM serving_case_precedent WHERE run_id = ? AND case_id = ? ORDER BY similarity DESC", run,
        caseId)) {
      String id = (String) r.get("precedent_id");
      Map<String, Object> detail = allPrecedents(null, null).stream()
          .filter(p -> id.equals(p.get("precedentId"))).findFirst().orElse(map());
      out.add(map("precedentId", id, "similarity", r.get("similarity"), "disposition", r.get("disposition"),
          "reasonCode", r.get("reason_code"), "source", detail.get("source"), "schemeType", detail.get("schemeType"),
          "rationale", detail.get("rationale"), "compare", json.tree((String) r.get("compare_json"))));
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ exceptions
  Map<String, Object> excView(Map<String, Object> r) {
    return map("excId", r.get("exc_id"), "version", r.get("version"), "status", r.get("status"),
        "scope", json.tree((String) r.get("scope_json")), "condition", json.tree((String) r.get("condition_json")),
        "effect", r.get("effect"), "supportN", r.get("support_n"), "flags", json.tree((String) r.get("flags_json")),
        "sourcePrecedentId", r.get("source_precedent_id"),
        "simulation", r.get("simulate_report_json") == null ? null : json.tree((String) r.get("simulate_report_json")),
        "lintVerdict", r.get("lint_verdict"),
        "explanation", r.get("explanation_json") == null ? null : json.tree((String) r.get("explanation_json")),
        "proposedBy", r.get("proposed_by"), "approvedBy", r.get("approved_by"), "approvedAt", r.get("approved_at"),
        "approvalNotes", r.get("approval_notes"), "supersedes", r.get("supersedes"),
        "reviewDue", r.get("review_due"), "createdAt", r.get("created_at"));
  }

  private Map<String, Object> excRow(String excId) {
    return jdbc.queryForList("SELECT * FROM wf_exception_rule WHERE exc_id = ? ORDER BY version DESC LIMIT 1", excId)
        .stream().findFirst().orElseThrow(() -> ApiException.notFound("Exception " + excId));
  }

  public List<Map<String, Object>> exceptions(String status) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT * FROM wf_exception_rule e WHERE version = (SELECT MAX(version) FROM wf_exception_rule WHERE "
            + "exc_id = e.exc_id) ORDER BY exc_id")) {
      if (status == null || status.isBlank() || status.equals(r.get("status"))) {
        Map<String, Object> v = excView(r);
        v.put("suppressedInLastRun", suppressedInCurrentRun((String) r.get("exc_id")));
        out.add(v);
      }
    }
    return out;
  }

  public Map<String, Object> exception(String excId) {
    Map<String, Object> v = excView(excRow(excId));
    v.put("suppressedInLastRun", suppressedInCurrentRun(excId));
    return v;
  }

  private long suppressedInCurrentRun(String excId) {
    try {
      JsonNode f = json.tree(serving.singleJson("serving_funnel", "funnel_json", serving.requireRunId()));
      return f.path("suppressedByException").path(excId).asLong(0);
    } catch (ApiException e) {
      return 0;
    }
  }

  private List<Map<String, Object>> approvedForEngine(String exclude) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT * FROM wf_exception_rule WHERE status = 'APPROVED' ORDER BY exc_id, version")) {
      if (!r.get("exc_id").equals(exclude)) {
        out.add(engineForm(r));
      }
    }
    return out;
  }

  private Map<String, Object> engineForm(Map<String, Object> r) {
    return map("excId", r.get("exc_id"), "version", r.get("version"), "scope", json.tree((String) r.get("scope_json")),
        "condition", json.tree((String) r.get("condition_json")), "effect", r.get("effect"),
        "supportN", r.get("support_n"), "flags", json.tree((String) r.get("flags_json")),
        "reviewDue", r.get("review_due"));
  }

  private List<Map<String, Object>> livePrecedentsForEngine() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> p : jdbc.queryForList(
        "SELECT * FROM wf_precedent WHERE source = 'LIVE' AND status = 'ACTIVE' ORDER BY precedent_id")) {
      out.add(map("precedentId", p.get("precedent_id"), "schemeType", p.get("scheme_type"),
          "specialtyCode", p.get("specialty_code"), "disposition", p.get("disposition"),
          "reasonCode", p.get("reason_code"), "featureVector", json.tree((String) p.get("feature_vector_json")),
          "ruleIds", json.tree((String) p.get("rule_ids_json")), "rationale", p.get("rationale"),
          "closedDt", p.get("closed_dt"), "status", "ACTIVE"));
    }
    return out;
  }

  public Map<String, Object> propose(AppUser u, String caseId, String precedentId) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR);
    String run = serving.requireRunId();
    Map<String, Object> caseRow = serving.caseRow(run, caseId);
    Map<String, Object> p = jdbc.queryForList("SELECT * FROM wf_precedent WHERE precedent_id = ? AND case_id = ?",
        precedentId, caseId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Precedent " + precedentId + " for case " + caseId));
    if (!"ACTIVE".equals(p.get("status"))) {
      throw ApiException.conflict("The precedent is " + p.get("status")
          + "; a supervisor must co-sign it before an exception can be proposed from it.");
    }
    if (!"UNFOUNDED".equals(p.get("disposition"))
        || !CaseWorkflowService.EXCEPTION_ELIGIBLE.contains((String) p.get("reason_code"))) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "NOT_ELIGIBLE", "This closure cannot become an exception",
          "Only cases closed UNFOUNDED with a legitimate-pattern reason can be turned into an exception rule.");
    }
    List<Map<String, Object>> existing = jdbc.queryForList("SELECT * FROM wf_exception_rule WHERE "
        + "source_precedent_id = ? AND status IN ('DRAFT','SIMULATED','PENDING_APPROVAL','APPROVED') "
        + "ORDER BY version DESC", precedentId);
    if (!existing.isEmpty()) {
      Map<String, Object> v = excView(existing.get(0));
      v.put("reused", true);
      return v;
    }
    JsonNode header = json.tree((String) caseRow.get("header_json"));
    List<String> rules = new ArrayList<>();
    header.get("ruleIds").forEach(r -> rules.add(r.asString()));
    List<String> hard = rules.stream().filter(NON_EXEMPTABLE::contains).toList();
    if (!hard.isEmpty()) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "NOT_ELIGIBLE", "Hard-fact alerts cannot be excepted",
          "This case carries " + String.join(", ", hard) + "; recorded-fact rules can never be excepted.");
    }
    long support = 1 + jdbc.queryForObject("SELECT COUNT(*) FROM wf_precedent WHERE status = 'ACTIVE' AND "
        + "disposition = 'UNFOUNDED' AND scheme_type = ? AND precedent_id <> ?", Long.class, p.get("scheme_type"),
        precedentId) + jdbc.queryForObject("SELECT COUNT(*) FROM serving_precedent_seed WHERE disposition = "
        + "'UNFOUNDED' AND scheme_type = ?", Long.class, p.get("scheme_type"));
    String excId = String.format("EXC-%04d", 1 + jdbc.queryForObject(
        "SELECT COALESCE(MAX(CAST(SUBSTR(exc_id, 5) AS INTEGER)), 0) FROM wf_exception_rule", Long.class));
    JsonNode draft;
    try {
      draft = engine.post("/internal/exceptions/propose", map("caseId", caseId,
          "provider", caseRow.get("primary_provider_id"), "ruleIds", rules, "reasonCode", p.get("reason_code"),
          "supportN", support, "sourcePrecedentId", precedentId, "excId", excId));
    } catch (EngineException e) {
      throw engineProblem(e);
    }
    return tx.write(() -> {
      String due = LocalDate.now(clock).plusDays(REVIEW_DAYS).toString();
      jdbc.update("INSERT INTO wf_exception_rule (exc_id, version, scope_json, condition_json, effect, "
              + "source_precedent_id, support_n, flags_json, status, proposed_by, review_due, created_at) "
              + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", excId, 1, json.write(draft.get("scope")),
          json.write(draft.get("condition")), draft.get("effect").asString(), precedentId,
          draft.get("supportN").asInt(), json.write(draft.get("flags")), "DRAFT", u.username(), due, now());
      audit.append(u.username(), u.role().name(), "EXCEPTION_PROPOSED", "exception", excId,
          map("caseId", caseId, "precedentId", precedentId, "supportN", draft.get("supportN").asInt(),
              "conditionSha", sha(draft.get("condition").toString())));
      Map<String, Object> v = excView(excRow(excId));
      v.put("reused", false);
      return v;
    });
  }

  public Map<String, Object> simulate(AppUser u, String excId) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR, Role.GOVERNANCE);
    Map<String, Object> row = excRow(excId);
    String st = (String) row.get("status");
    if (!Set.of("DRAFT", "SIMULATED", "PENDING_APPROVAL").contains(st)) {
      throw ApiException.conflict("Exception " + excId + " is " + st + " and cannot be simulated.");
    }
    JsonNode report;
    try {
      report = engine.post("/internal/simulate", map("draft", engineForm(row),
          "exceptions", approvedForEngine(excId), "livePrecedents", livePrecedentsForEngine()));
    } catch (EngineException e) {
      throw engineProblem(e);
    }
    String verdict = report.get("lint").get("verdict").asString();
    return tx.write(() -> {
      jdbc.update("UPDATE wf_exception_rule SET simulate_report_json = ?, lint_verdict = ?, status = 'SIMULATED' "
          + "WHERE exc_id = ? AND version = ?", json.write(report), verdict, excId, row.get("version"));
      audit.append(u.username(), u.role().name(), "EXCEPTION_SIMULATED", "exception", excId,
          map("reportSha", sha(report.toString()), "verdict", verdict,
              "alertsSuppressed", report.get("alertsSuppressed").asInt()));
      return excView(excRow(excId));
    });
  }

  public Map<String, Object> submit(AppUser u, String excId) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR);
    return tx.write(() -> {
      Map<String, Object> row = excRow(excId);
      if (!"SIMULATED".equals(row.get("status"))) {
        throw ApiException.conflict("Exception " + excId + " must be simulated before it is submitted.");
      }
      if ("BLOCK".equals(row.get("lint_verdict"))) {
        throw new ApiException(HttpStatus.CONFLICT, "LINT_BLOCKED", "The simulation blocked this exception",
            "A BLOCK verdict cannot be submitted; edit the draft and simulate again.");
      }
      jdbc.update("UPDATE wf_exception_rule SET status = 'PENDING_APPROVAL' WHERE exc_id = ? AND version = ?",
          excId, row.get("version"));
      audit.append(u.username(), u.role().name(), "EXCEPTION_SUBMITTED", "exception", excId,
          map("verdict", row.get("lint_verdict")));
      return excView(excRow(excId));
    });
  }

  public Map<String, Object> approve(AppUser u, String excId, String decision, String notes) {
    requireRole(u, Role.GOVERNANCE);
    if (!"APPROVE".equals(decision) && !"REJECT".equals(decision)) {
      throw ApiException.invalid("decision", "must be APPROVE or REJECT");
    }
    Map<String, Object> done = tx.write(() -> {
      Map<String, Object> row = excRow(excId);
      if (!"PENDING_APPROVAL".equals(row.get("status"))) {
        throw ApiException.conflict("Exception " + excId + " is " + row.get("status") + ", not waiting for approval.");
      }
      if (u.username().equals(row.get("proposed_by"))) {
        throw new ApiException(HttpStatus.FORBIDDEN, "SELF_APPROVAL_FORBIDDEN", "A second person must approve",
            "You proposed this exception, so someone else in the governance role has to approve it.");
      }
      if ("REJECT".equals(decision)) {
        if (notes == null || notes.isBlank()) {
          throw ApiException.invalid("notes", "say why the exception is rejected");
        }
        jdbc.update("UPDATE wf_exception_rule SET status = 'REJECTED', approved_by = ?, approved_at = ?, "
            + "approval_notes = ? WHERE exc_id = ? AND version = ?", u.username(), now(), notes, excId,
            row.get("version"));
        audit.append(u.username(), u.role().name(), "EXCEPTION_REJECTED", "exception", excId, map("notes", notes));
        return excView(excRow(excId));
      }
      if ("BLOCK".equals(row.get("lint_verdict"))) {
        throw new ApiException(HttpStatus.CONFLICT, "LINT_BLOCKED", "The simulation blocked this exception",
            "A BLOCK verdict cannot be approved.");
      }
      jdbc.update("UPDATE wf_exception_rule SET status = 'APPROVED', approved_by = ?, approved_at = ?, "
          + "approval_notes = ? WHERE exc_id = ? AND version = ?", u.username(), now(), notes, excId,
          row.get("version"));
      audit.append(u.username(), u.role().name(), "EXCEPTION_APPROVED", "exception", excId,
          map("verdict", row.get("lint_verdict"), "notes", notes, "proposedBy", row.get("proposed_by")));
      return excView(excRow(excId));
    });
    if ("APPROVED".equals(done.get("status"))) {
      done.put("rerun", rerunSafely(u, "Exception " + excId + " approved"));
    }
    return done;
  }

  public Map<String, Object> retire(AppUser u, String excId) {
    requireRole(u, Role.GOVERNANCE);
    Map<String, Object> done = tx.write(() -> {
      Map<String, Object> row = excRow(excId);
      if (!"APPROVED".equals(row.get("status"))) {
        throw ApiException.conflict("Only an approved exception can be retired.");
      }
      jdbc.update("UPDATE wf_exception_rule SET status = 'RETIRED' WHERE exc_id = ? AND version = ?", excId,
          row.get("version"));
      audit.append(u.username(), u.role().name(), "EXCEPTION_RETIRED", "exception", excId, map());
      return excView(excRow(excId));
    });
    done.put("rerun", rerunSafely(u, "Exception " + excId + " retired"));
    return done;
  }

  /** A plain-language explanation built from the draft and its simulation report (a model may rewrite it later). */
  public Map<String, Object> explain(String excId) {
    Map<String, Object> v = exception(excId);
    JsonNode sim = (JsonNode) v.get("simulation");
    if (sim == null) {
      throw ApiException.conflict("Simulate " + excId + " first; the explanation describes its effect.");
    }
    JsonNode scope = (JsonNode) v.get("scope");
    List<String> bits = new ArrayList<>();
    ((JsonNode) v.get("condition")).forEach(c -> bits.add(c.get("field").asString() + " " + c.get("op").asString()
        + " " + c.get("value").asString()));
    String text = "This exception would move alerts from " + scope.get("rule_ids").toString().replace("\"", "")
        + (scope.hasNonNull("specialty_code") ? " for " + scope.get("specialty_code").asString() + " providers" : "")
        + " out of the review queue and onto the Monitor list when " + String.join(" and ", bits) + ". The simulation "
        + "found " + sim.get("alertsSuppressed").asInt() + " alerts and " + sim.get("providersAffected").asInt()
        + " providers affected, " + sim.get("casesAffected").asInt() + " cases changing tier and "
        + sim.get("hardFactTouches").asInt() + " recorded-fact alerts touched. Risks: a provider that merely looks "
        + "like the closed case would no longer be reviewed; the review date is " + v.get("reviewDue") + ". A person "
        + "must still approve it, and it can be retired at any time.";
    Map<String, Object> out = map("text", text, "mode", "TEMPLATE", "verdict", v.get("lintVerdict"));
    tx.write(() -> jdbc.update("UPDATE wf_exception_rule SET explanation_json = ? WHERE exc_id = ? AND version = ?",
        json.write(out), excId, v.get("version")));
    return out;
  }

  // ------------------------------------------------------------------------------------------------------ jobs
  private Map<String, Object> rerunSafely(AppUser u, String reason) {
    try {
      return startRerun(u, reason);
    } catch (ApiException e) {
      return map("status", "NOT_STARTED", "code", e.code(), "detail", e.getMessage());
    }
  }

  public Map<String, Object> startRerun(AppUser u, String reason) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR, Role.GOVERNANCE);
    List<Map<String, Object>> excs = approvedForEngine(null);
    List<Map<String, Object>> live = livePrecedentsForEngine();
    String jobId = tx.write(() -> {
      Long running = jdbc.queryForObject("SELECT COUNT(*) FROM wf_job WHERE status IN ('QUEUED','RUNNING')",
          Long.class);
      if (running != null && running > 0) {
        throw new ApiException(HttpStatus.CONFLICT, "JOB_RUNNING", "An analysis job is already running",
            "Wait for the running job to finish.");
      }
      String id = String.format("J-%d", 1 + jdbc.queryForObject("SELECT COUNT(*) FROM wf_job", Long.class));
      jdbc.update("INSERT INTO wf_job (job_id, kind, status, stage, request_json, created_by, created_at) "
              + "VALUES (?,?,?,?,?,?,?)", id, "RERUN", "QUEUED", "queued",
          json.canonical(map("reason", reason, "exceptions", excs.stream().map(e -> e.get("excId")).toList(),
              "livePrecedents", live.size())), u.username(), now());
      audit.append(u.username(), u.role().name(), "JOB_STARTED", "job", id,
          map("kind", "RERUN", "reason", reason, "exceptions", excs.size(), "livePrecedents", live.size()));
      return id;
    });
    try {
      JsonNode r = engine.post("/internal/rerun", map("requestId", jobId, "exceptions", excs,
          "livePrecedents", live, "capacityDefaultHours", 240));
      tx.write(() -> jdbc.update("UPDATE wf_job SET status = 'RUNNING', stage = 'started', engine_job_id = ? "
          + "WHERE job_id = ?", r.get("engineJobId").asString(), jobId));
    } catch (EngineException e) {
      tx.write(() -> {
        jdbc.update("UPDATE wf_job SET status = 'FAILED', error = ?, finished_at = ? WHERE job_id = ?",
            e.getMessage(), now(), jobId);
        audit.append(u.username(), u.role().name(), "JOB_FAILED", "job", jobId, map("error", e.getMessage()));
      });
    }
    return job(jobId);
  }

  public Map<String, Object> job(String jobId) {
    Map<String, Object> row = jdbc.queryForList("SELECT * FROM wf_job WHERE job_id = ?", jobId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Job " + jobId));
    final String createdBy = (String) row.get("created_by");
    boolean reachable = true;
    if ("RUNNING".equals(row.get("status")) && row.get("engine_job_id") != null) {
      try {
        JsonNode r = engine.get("/internal/jobs/" + row.get("engine_job_id"));
        String st = r.get("status").asString();
        if ("DONE".equals(st)) {
          String run = r.get("runId").asString();
          tx.write(() -> {
            int n = jdbc.update("UPDATE wf_job SET status = 'DONE', stage = 'done', result_run_id = ?, "
                + "finished_at = ? WHERE job_id = ? AND status = 'RUNNING'", run, now(), jobId);
            if (n > 0) {
              String excs = jdbc.queryForObject("SELECT exception_set_json FROM serving_run WHERE run_id = ?",
                  String.class, run);
              audit.append(createdBy, "SYSTEM", "RUN_COMPLETED", "run", run,
                  map("jobId", jobId, "exceptionSet", json.tree(excs), "dataHash", jdbc.queryForObject(
                      "SELECT data_hash FROM serving_run WHERE run_id = ?", String.class, run)));
            }
          });
        } else if ("FAILED".equals(st)) {
          String err = r.hasNonNull("error") ? r.get("error").asString() : "failed";
          tx.write(() -> {
            int n = jdbc.update("UPDATE wf_job SET status = 'FAILED', error = ?, finished_at = ? WHERE job_id = ? "
                + "AND status = 'RUNNING'", err, now(), jobId);
            if (n > 0) {
              audit.append(createdBy, "SYSTEM", "JOB_FAILED", "job", jobId, map("error", err));
            }
          });
        } else {
          tx.write(() -> jdbc.update("UPDATE wf_job SET stage = ? WHERE job_id = ?", r.get("stage").asString(), jobId));
        }
      } catch (EngineException e) {
        reachable = false;
      }
      row = jdbc.queryForList("SELECT * FROM wf_job WHERE job_id = ?", jobId).get(0);
    }
    Map<String, Object> v = map("jobId", row.get("job_id"), "kind", row.get("kind"), "status", row.get("status"),
        "stage", row.get("stage"), "resultRunId", row.get("result_run_id"), "error", row.get("error"),
        "createdBy", row.get("created_by"), "createdAt", row.get("created_at"), "finishedAt", row.get("finished_at"),
        "request", row.get("request_json") == null ? null : json.tree((String) row.get("request_json")),
        "engineReachable", reachable, "diff", null);
    if (row.get("result_run_id") != null) {
      JsonNode f = json.tree(serving.singleJson("serving_funnel", "funnel_json", (String) row.get("result_run_id")));
      v.put("diff", f.hasNonNull("diff") ? f.get("diff") : null);
    }
    return v;
  }

  public List<Map<String, Object>> jobs() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList("SELECT job_id FROM wf_job ORDER BY created_at DESC LIMIT 20")) {
      out.add(job((String) r.get("job_id")));
    }
    return out;
  }
}
