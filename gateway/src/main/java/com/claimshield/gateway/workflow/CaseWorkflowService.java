package com.claimshield.gateway.workflow;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import com.claimshield.gateway.config.Json;
import com.claimshield.gateway.config.Tx;
import com.claimshield.gateway.workflow.Dto.ApproveRequest;
import com.claimshield.gateway.workflow.Dto.CloseRequest;
import com.claimshield.gateway.workflow.Dto.Decision;
import com.claimshield.gateway.workflow.Dto.ReviewAction;
import com.claimshield.gateway.workflow.Dto.ReviewRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * Case review workflow (docs/ClaimShield_Nexus_Implementation_Architecture.md section 12.2).
 *
 * Rules enforced here, all server-side:
 *  - roles: INVESTIGATOR/SUPERVISOR review and close; only SUPERVISOR approves; others are read-only
 *  - the chosen action must be in the case's permitted_actions (computed by the engine from the tier)
 *  - high-impact actions (needs=SUPERVISOR) wait for approval, and the approver can never be the proposer
 *  - every state change writes an audit row in the SAME transaction (Tx.write)
 * The AI proposal in this build is the engine's rule default; there is no model call and no AI actor.
 */
@Service
public class CaseWorkflowService {

  public static final Set<String> REASON_CODES = Set.of("LEGIT_CLINICAL_PATTERN", "LEGIT_SHARED_BUILDING",
      "LEGIT_RURAL_ACCESS", "LEGIT_HIGH_ACUITY", "DOC_SUPPORTS_BILLING", "DATA_ERROR", "CONFIRMED_PATTERN",
      "NEEDS_RECORDS");
  public static final Set<String> EXCEPTION_ELIGIBLE = Set.of("LEGIT_CLINICAL_PATTERN", "LEGIT_SHARED_BUILDING",
      "LEGIT_RURAL_ACCESS", "LEGIT_HIGH_ACUITY");
  static final Set<String> REVIEWABLE = Set.of("NEW", "TRIAGED", "IN_REVIEW", "NEED_INFO");
  static final Set<String> CLOSABLE = Set.of("IN_REVIEW", "ACTION_TAKEN");
  static final int MIN_RATIONALE = 40;

  private final JdbcTemplate jdbc;
  private final ServingRepository serving;
  private final AuditService audit;
  private final Tx tx;
  private final Json json;
  private final Clock clock;

  public CaseWorkflowService(JdbcTemplate jdbc, ServingRepository serving, AuditService audit, Tx tx, Json json,
      Clock clock) {
    this.jdbc = jdbc;
    this.serving = serving;
    this.audit = audit;
    this.tx = tx;
    this.json = json;
    this.clock = clock;
  }

  // ------------------------------------------------------------------------------------------------ helpers
  private static void requireRole(AppUser u, Role... allowed) {
    for (Role r : allowed) {
      if (u.role() == r) {
        return;
      }
    }
    throw ApiException.forbiddenRole("The " + u.role() + " role cannot do this.");
  }

  private String now() {
    return Instant.now(clock).toString();
  }

  private String status(String caseId) {
    List<String> s = jdbc.queryForList("SELECT status FROM wf_case_state WHERE case_id = ?", String.class, caseId);
    return s.isEmpty() ? "NEW" : s.get(0);
  }

  private void setStatus(String caseId, String status, String assignee, String outcome) {
    jdbc.update("INSERT INTO wf_case_state (case_id, status, assigned_to, outcome, closed_at, updated_at) "
        + "VALUES (?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET status = excluded.status, "
        + "assigned_to = COALESCE(wf_case_state.assigned_to, excluded.assigned_to), "
        + "outcome = COALESCE(excluded.outcome, wf_case_state.outcome), "
        + "closed_at = COALESCE(excluded.closed_at, wf_case_state.closed_at), updated_at = excluded.updated_at",
        caseId, status, assignee, outcome, "CLOSED".equals(status) ? now() : null, now());
  }

  private record Snap(String runId, String packSha, JsonNode pack, JsonNode header, Map<String, Object> row) {}

  private Snap snap(String caseId) {
    String run = serving.requireRunId();
    Map<String, Object> row = serving.caseRow(run, caseId);
    Map<String, Object> pack = serving.packRow(run, caseId);
    return new Snap(run, (String) pack.get("pack_sha256"), json.tree((String) pack.get("pack_json")),
        json.tree((String) row.get("header_json")), row);
  }

  private static String needsFor(JsonNode pack, String action) {
    for (JsonNode a : pack.get("permittedActions")) {
      if (a.get("action").asString().equals(action)) {
        return a.get("needs").asString();
      }
    }
    return null;
  }

  private static List<String> permittedNames(JsonNode pack) {
    List<String> out = new ArrayList<>();
    pack.get("permittedActions").forEach(a -> out.add(a.get("action").asString()));
    return out;
  }

  private String nextId(String prefix, String table, String col) {
    Long n = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);   // table/col are code constants
    return String.format("%s-%05d", prefix, (n == null ? 0 : n) + 1);
  }

  private static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  // ------------------------------------------------------------------------------------------------ review
  public Map<String, Object> review(AppUser u, String caseId, ReviewRequest req, String idempotencyKey) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR);
    return tx.write(() -> {
      if (idempotencyKey != null && !idempotencyKey.isBlank()) {
        List<Map<String, Object>> prior = jdbc.queryForList(
            "SELECT * FROM wf_review_action WHERE idempotency_key = ?", idempotencyKey);
        if (!prior.isEmpty()) {
          Map<String, Object> p = prior.get(0);
          if (!caseId.equals(p.get("case_id"))) {
            throw ApiException.conflict("That Idempotency-Key was already used for a different case.");
          }
          return reviewResponse(p, status(caseId));
        }
      }
      Snap s = snap(caseId);
      String current = status(caseId);
      if (!REVIEWABLE.contains(current)) {
        throw ApiException.conflict("Case " + caseId + " is " + current + " and cannot be reviewed now.");
      }
      JsonNode pack = s.pack();
      String aiAction = pack.get("defaultAction").asString();
      String aiHyp = pack.get("hypotheses").get(0).asString();
      List<String> hypotheses = new ArrayList<>();
      pack.get("hypotheses").forEach(h -> hypotheses.add(h.asString()));

      boolean needsReason = req.action() == ReviewAction.MODIFY || req.action() == ReviewAction.REJECT;
      if (needsReason) {
        if (req.reasonCode() == null || req.reasonCode().isBlank()) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "REASON_REQUIRED", "A reason code is required",
              "Modify and Reject need a reason code.", List.of(Map.of("field", "reasonCode", "message", "required")));
        }
        if (!REASON_CODES.contains(req.reasonCode())) {
          throw ApiException.invalid("reasonCode", "must be one of " + new java.util.TreeSet<>(REASON_CODES));
        }
      }
      if (req.action() == ReviewAction.REQUEST_INFO && (req.notes() == null || req.notes().isBlank())) {
        throw ApiException.invalid("notes", "say what information is needed");
      }

      String effective = null;
      String hypothesis = aiHyp;
      if (req.action() == ReviewAction.ACCEPT) {
        effective = aiAction;
      } else if (req.action() == ReviewAction.MODIFY) {
        if ((req.newAction() == null || req.newAction().isBlank()) && (req.hypothesis() == null
            || req.hypothesis().isBlank())) {
          throw ApiException.invalid("newAction", "Modify must change the action or the hypothesis");
        }
        effective = (req.newAction() == null || req.newAction().isBlank()) ? aiAction : req.newAction();
        if (needsFor(pack, effective) == null) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "ACTION_NOT_PERMITTED", "Action not permitted",
              effective + " is not permitted for a " + s.row().get("tier") + " case. Allowed: "
                  + permittedNames(pack) + ".", List.of(Map.of("field", "newAction", "message",
                  "must be one of " + permittedNames(pack))));
        }
        if (req.hypothesis() != null && !req.hypothesis().isBlank()) {
          if (!hypotheses.contains(req.hypothesis())) {
            throw ApiException.invalid("hypothesis", "must be one of " + hypotheses);
          }
          hypothesis = req.hypothesis();
        }
      }

      boolean requiresApproval = effective != null && "SUPERVISOR".equals(needsFor(pack, effective));
      String actionStatus;
      String caseStatus;
      switch (req.action()) {
        case ACCEPT, MODIFY -> {
          actionStatus = requiresApproval ? "PENDING_APPROVAL" : "APPROVED";
          caseStatus = requiresApproval ? "ACTION_PROPOSED" : "ACTION_APPROVED";
        }
        case REJECT -> {
          actionStatus = "RECORDED";
          caseStatus = "IN_REVIEW";
        }
        default -> {
          actionStatus = "RECORDED";
          caseStatus = "NEED_INFO";
        }
      }
      Map<String, Object> aiProposal = map("action", aiAction, "hypothesis", aiHyp, "source", "RULE_DEFAULT",
          "packSha256", s.packSha());
      Map<String, Object> human = map("action", effective, "hypothesis", hypothesis, "reasonCode", req.reasonCode(),
          "notes", req.notes(), "diff", map("actionChanged", effective != null && !effective.equals(aiAction),
              "hypothesisChanged", !hypothesis.equals(aiHyp)));
      String actionId = nextId("RA", "wf_review_action", "action_id");
      jdbc.update("INSERT INTO wf_review_action (action_id, case_id, actor, role, action, reason_code, notes, "
              + "new_action, hypothesis, ai_proposal_json, human_decision_json, requires_approval, status, "
              + "idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", actionId, caseId,
          u.username(), u.role().name(), req.action().name(), req.reasonCode(), req.notes(), effective, hypothesis,
          json.canonical(aiProposal), json.canonical(human), requiresApproval ? 1 : 0, actionStatus,
          idempotencyKey == null || idempotencyKey.isBlank() ? null : idempotencyKey, now());
      setStatus(caseId, caseStatus, u.username(), null);
      audit.append(u.username(), u.role().name(), "REVIEW_ACTION", "case", caseId,
          map("actionId", actionId, "action", req.action().name(), "effectiveAction", effective,
              "reasonCode", req.reasonCode(), "requiresApproval", requiresApproval, "actionStatus", actionStatus,
              "caseStatus", caseStatus, "aiAction", aiAction, "runId", s.runId(), "packSha256", s.packSha()));
      Map<String, Object> row = jdbc.queryForList("SELECT * FROM wf_review_action WHERE action_id = ?", actionId).get(0);
      return reviewResponse(row, caseStatus);
    });
  }

  private Map<String, Object> reviewResponse(Map<String, Object> row, String caseStatus) {
    boolean needs = ((Number) row.get("requires_approval")).intValue() == 1;
    return map("actionId", row.get("action_id"), "caseId", row.get("case_id"), "caseStatus", caseStatus,
        "action", row.get("action"), "effectiveAction", row.get("new_action"), "status", row.get("status"),
        "requiresApproval", needs, "approvalNeeded", needs ? "SUPERVISOR" : null,
        "aiProposal", json.tree((String) row.get("ai_proposal_json")));
  }

  public List<Map<String, Object>> reviews(String caseId) {
    serving.caseRow(serving.requireRunId(), caseId);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT * FROM wf_review_action WHERE case_id = ? ORDER BY created_at, action_id", caseId)) {
      out.add(map("actionId", r.get("action_id"), "actor", r.get("actor"), "role", r.get("role"),
          "action", r.get("action"), "status", r.get("status"), "reasonCode", r.get("reason_code"),
          "notes", r.get("notes"), "requiresApproval", ((Number) r.get("requires_approval")).intValue() == 1,
          "aiProposal", json.tree((String) r.get("ai_proposal_json")),
          "humanDecision", json.tree((String) r.get("human_decision_json")), "approver", r.get("approver"),
          "approvedAt", r.get("approved_at"), "approvalNotes", r.get("approval_notes"),
          "createdAt", r.get("created_at")));
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ approval
  public Map<String, Object> approve(AppUser u, String actionId, ApproveRequest req) {
    requireRole(u, Role.SUPERVISOR);
    return tx.write(() -> {
      Map<String, Object> a = action(actionId);
      String caseId = (String) a.get("case_id");
      String target = req.decision() == Decision.APPROVE ? "APPROVED" : "REJECTED";
      // replay: the same supervisor repeating the same decision is a no-op, not an error
      if (target.equals(a.get("status")) && u.username().equals(a.get("approver"))) {
        return map("actionId", actionId, "status", target, "caseStatus", status(caseId), "replayed", true);
      }
      if (!"PENDING_APPROVAL".equals(a.get("status"))) {
        throw ApiException.conflict("Action " + actionId + " is " + a.get("status") + ", not awaiting approval.");
      }
      if (u.username().equals(a.get("actor"))) {
        throw new ApiException(HttpStatus.FORBIDDEN, "SELF_APPROVAL_FORBIDDEN", "Two-person rule",
            "The person who proposed an action cannot approve it.");
      }
      String caseStatus = req.decision() == Decision.APPROVE ? "ACTION_APPROVED" : "IN_REVIEW";
      jdbc.update("UPDATE wf_review_action SET status = ?, approver = ?, approved_at = ?, approval_notes = ? "
          + "WHERE action_id = ?", target, u.username(), now(), req.notes(), actionId);
      setStatus(caseId, caseStatus, null, null);
      audit.append(u.username(), u.role().name(), "APPROVAL", "case", caseId,
          map("actionId", actionId, "decision", req.decision().name(), "proposer", a.get("actor"),
              "effectiveAction", a.get("new_action"), "caseStatus", caseStatus));
      return map("actionId", actionId, "status", target, "caseStatus", caseStatus, "replayed", false);
    });
  }

  public Map<String, Object> execute(AppUser u, String actionId) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR);
    return tx.write(() -> {
      Map<String, Object> a = action(actionId);
      String caseId = (String) a.get("case_id");
      if ("EXECUTED".equals(a.get("status"))) {
        return map("actionId", actionId, "status", "EXECUTED", "caseStatus", status(caseId), "simulated", true,
            "replayed", true);
      }
      if (!"APPROVED".equals(a.get("status")) || !"ACTION_APPROVED".equals(status(caseId))) {
        throw ApiException.conflict("Action " + actionId + " is not approved, so it cannot be carried out.");
      }
      jdbc.update("UPDATE wf_review_action SET status = 'EXECUTED' WHERE action_id = ?", actionId);
      setStatus(caseId, "ACTION_TAKEN", null, null);
      audit.append(u.username(), u.role().name(), "ACTION_EXECUTED", "case", caseId,
          map("actionId", actionId, "effectiveAction", a.get("new_action"), "simulated", true));
      return map("actionId", actionId, "status", "EXECUTED", "caseStatus", "ACTION_TAKEN", "simulated", true,
          "replayed", false);
    });
  }

  private Map<String, Object> action(String actionId) {
    return jdbc.queryForList("SELECT * FROM wf_review_action WHERE action_id = ?", actionId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Review action " + actionId));
  }

  // ------------------------------------------------------------------------------------------------ close
  public Map<String, Object> close(AppUser u, String caseId, CloseRequest req) {
    requireRole(u, Role.INVESTIGATOR, Role.SUPERVISOR);
    return tx.write(() -> {
      Snap s = snap(caseId);
      String current = status(caseId);
      if ("CLOSED".equals(current)) {                       // replay of the same closure returns the same result
        List<Map<String, Object>> p = jdbc.queryForList(
            "SELECT * FROM wf_precedent WHERE case_id = ? AND source = 'LIVE'", caseId);
        if (!p.isEmpty() && req.outcome().name().equals(p.get(0).get("disposition"))
            && req.reasonCode().equals(p.get(0).get("reason_code"))) {
          return closeResponse(caseId, p.get(0), s.header(), true);
        }
        throw ApiException.conflict("Case " + caseId + " is already closed.");
      }
      if (!CLOSABLE.contains(current)) {
        throw ApiException.conflict("Case " + caseId + " is " + current
            + "; it can be closed after a rejection or once an approved action has been taken.");
      }
      if (!REASON_CODES.contains(req.reasonCode())) {
        throw ApiException.invalid("reasonCode", "must be one of " + new java.util.TreeSet<>(REASON_CODES));
      }
      String rationale = req.rationale().trim();
      if (rationale.length() < MIN_RATIONALE) {
        throw ApiException.invalid("rationale", "must be at least " + MIN_RATIONALE + " characters so the precedent is useful");
      }
      JsonNode fv = json.tree((String) s.row().get("fv_json"));
      String precedentId = String.format("PRC-LIVE-%04d", 1 + jdbc.queryForObject(
          "SELECT COUNT(*) FROM wf_precedent WHERE source = 'LIVE'", Long.class));
      List<String> rules = new ArrayList<>();
      s.header().get("ruleIds").forEach(r -> rules.add(r.asString()));
      jdbc.update("INSERT INTO wf_precedent (precedent_id, source, case_id, scheme_type, specialty_code, "
              + "disposition, reason_code, rule_ids_json, feature_vector_json, fv_version, rationale, ai_drafted, "
              + "exposure, recovered, status, closed_dt, created_by, created_at) "
              + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", precedentId, "LIVE", caseId,
          s.pack().get("hypotheses").get(0).asString(), (String) s.row().get("specialty_code"), req.outcome().name(),
          req.reasonCode(), json.canonical(rules), json.write(fv.get("vector")), fv.get("version").asString(),
          rationale, Boolean.TRUE.equals(req.aiDrafted()) ? 1 : 0,
          ((Number) s.row().get("dollars_exact")).doubleValue(), req.recovered() == null ? 0.0 : req.recovered(),
          "PENDING_COSIGN", LocalDate.now(clock).toString(), u.username(), now());
      setStatus(caseId, "CLOSED", null, req.outcome().name());
      audit.append(u.username(), u.role().name(), "CASE_CLOSED", "case", caseId,
          map("outcome", req.outcome().name(), "reasonCode", req.reasonCode(), "precedentId", precedentId,
              "fromStatus", current, "aiDrafted", Boolean.TRUE.equals(req.aiDrafted()), "runId", s.runId()));
      audit.append(u.username(), u.role().name(), "PRECEDENT_CREATED", "precedent", precedentId,
          map("caseId", caseId, "disposition", req.outcome().name(), "status", "PENDING_COSIGN",
              "fvVersion", fv.get("version").asString()));
      Map<String, Object> p = jdbc.queryForList("SELECT * FROM wf_precedent WHERE precedent_id = ?", precedentId).get(0);
      return closeResponse(caseId, p, s.header(), false);
    });
  }

  private Map<String, Object> closeResponse(String caseId, Map<String, Object> p, JsonNode header, boolean replay) {
    boolean eligible = "UNFOUNDED".equals(p.get("disposition")) && EXCEPTION_ELIGIBLE.contains(p.get("reason_code"))
        && !header.get("hardFactAlerts").asBoolean();
    return map("caseId", caseId, "caseStatus", "CLOSED", "outcome", p.get("disposition"),
        "precedentId", p.get("precedent_id"), "precedentStatus", p.get("status"), "exceptionEligible", eligible,
        "replayed", replay);
  }

  public List<Map<String, Object>> precedents() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> p : jdbc.queryForList("SELECT * FROM wf_precedent ORDER BY created_at, precedent_id")) {
      out.add(map("precedentId", p.get("precedent_id"), "source", p.get("source"), "caseId", p.get("case_id"),
          "schemeType", p.get("scheme_type"), "specialtyCode", p.get("specialty_code"),
          "disposition", p.get("disposition"), "reasonCode", p.get("reason_code"), "rationale", p.get("rationale"),
          "status", p.get("status"), "createdBy", p.get("created_by"), "createdAt", p.get("created_at")));
    }
    return out;
  }
}
