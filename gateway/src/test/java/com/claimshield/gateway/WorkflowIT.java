package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

class WorkflowIT extends GatewayIT {

  private static final String RATIONALE = "Records reviewed; the pattern is documented and consistent with care.";

  @BeforeEach
  void freshWorkflow() {
    resetWorkflow();
  }

  private JsonNode review(String user, String caseId, Object body, int status, String... headers) throws Exception {
    return call(user, HttpMethod.POST, "/api/cases/" + caseId + "/review", body, status, headers);
  }

  private String status(String caseId) throws Exception {
    return get("investigator", "/api/cases/" + caseId).get("status").asString();
  }

  // ----------------------------------------------------------------------------- Accept
  @Test
  void acceptingALowImpactActionNeedsNoApprovalAndRunsThroughToClosure() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    JsonNode r = review("investigator", id, Map.of("action", "ACCEPT"), 201);
    assertThat(r.get("effectiveAction").asString()).isEqualTo("REQUEST_RECORDS");
    assertThat(r.get("requiresApproval").asBoolean()).isFalse();
    assertThat(r.get("caseStatus").asString()).isEqualTo("ACTION_APPROVED");
    assertThat(r.get("aiProposal").get("source").asString()).isEqualTo("RULE_DEFAULT");

    JsonNode ex = call("investigator", HttpMethod.POST, "/api/review-actions/" + r.get("actionId").asString()
        + "/execute", null, 200);
    assertThat(ex.get("caseStatus").asString()).isEqualTo("ACTION_TAKEN");
    assertThat(ex.get("simulated").asBoolean()).isTrue();

    JsonNode closed = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome",
        "CONFIRMED", "reasonCode", "CONFIRMED_PATTERN", "rationale", RATIONALE), 201);
    assertThat(closed.get("caseStatus").asString()).isEqualTo("CLOSED");
    assertThat(closed.get("precedentStatus").asString()).isEqualTo("PENDING_COSIGN");
    assertThat(status(id)).isEqualTo("CLOSED");
  }

  // ----------------------------------------------------------------------------- Modify
  @Test
  void modifyingToAHighImpactActionWaitsForASupervisor() throws Exception {
    String id = caseWith("EXC", "HIGH");
    JsonNode r = review("investigator", id, Map.of("action", "MODIFY", "newAction", "PREPAY_REVIEW_FLAG",
        "reasonCode", "NEEDS_RECORDS", "notes", "Hold payments while records are requested."), 201);
    assertThat(r.get("requiresApproval").asBoolean()).isTrue();
    assertThat(r.get("approvalNeeded").asString()).isEqualTo("SUPERVISOR");
    assertThat(r.get("status").asString()).isEqualTo("PENDING_APPROVAL");
    assertThat(r.get("caseStatus").asString()).isEqualTo("ACTION_PROPOSED");
    String actionId = r.get("actionId").asString();

    expectProblem("investigator", HttpMethod.POST, "/api/review-actions/" + actionId + "/approve",
        Map.of("decision", "APPROVE"), 403, "FORBIDDEN_ROLE");
    expectProblem("investigator", HttpMethod.POST, "/api/review-actions/" + actionId + "/execute", null, 409,
        "STATE_CONFLICT");

    JsonNode ok = call("supervisor", HttpMethod.POST, "/api/review-actions/" + actionId + "/approve",
        Map.of("decision", "APPROVE", "notes", "Agreed."), 200);
    assertThat(ok.get("caseStatus").asString()).isEqualTo("ACTION_APPROVED");
    assertThat(call("investigator", HttpMethod.POST, "/api/review-actions/" + actionId + "/execute", null, 200)
        .get("caseStatus").asString()).isEqualTo("ACTION_TAKEN");
    JsonNode history = get("investigator", "/api/cases/" + id + "/reviews");
    assertThat(history.get(0).get("approver").asString()).isEqualTo("supervisor");
    assertThat(history.get(0).get("humanDecision").get("diff").get("actionChanged").asBoolean()).isTrue();
  }

  @Test
  void aSupervisorCannotApproveTheirOwnProposal() throws Exception {
    String id = caseWith("EXC", "HIGH");
    JsonNode r = review("supervisor", id, Map.of("action", "MODIFY", "newAction", "REFER_EXTERNAL",
        "reasonCode", "CONFIRMED_PATTERN"), 201);
    long approvals = auditCount("APPROVAL");
    expectProblem("supervisor", HttpMethod.POST, "/api/review-actions/" + r.get("actionId").asString()
        + "/approve", Map.of("decision", "APPROVE"), 403, "SELF_APPROVAL_FORBIDDEN");
    assertThat(status(id)).isEqualTo("ACTION_PROPOSED");
    assertThat(auditCount("APPROVAL")).isEqualTo(approvals);
  }

  @Test
  void aRejectedApprovalSendsTheCaseBackToReview() throws Exception {
    String id = caseWith("PHA", "HIGH");
    JsonNode r = review("investigator", id, Map.of("action", "MODIFY", "newAction", "REFER_EXTERNAL",
        "reasonCode", "CONFIRMED_PATTERN"), 201);
    JsonNode out = call("supervisor", HttpMethod.POST, "/api/review-actions/" + r.get("actionId").asString()
        + "/approve", Map.of("decision", "REJECT", "notes", "Need records first."), 200);
    assertThat(out.get("status").asString()).isEqualTo("REJECTED");
    assertThat(status(id)).isEqualTo("IN_REVIEW");
  }

  @Test
  void anActionOutsideThePermittedListIsRefusedAndLeavesNoTrace() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    long audit = auditCount();
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "MODIFY",
        "newAction", "PREPAY_REVIEW_FLAG", "reasonCode", "NEEDS_RECORDS"), 422, "ACTION_NOT_PERMITTED");
    assertThat(auditCount()).isEqualTo(audit);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wf_review_action", Long.class)).isZero();
    assertThat(status(id)).isEqualTo("NEW");
  }

  @Test
  void modifyAndRejectNeedAValidReasonCode() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "MODIFY", "newAction", "MONITOR"), 422, "REASON_REQUIRED");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "REJECT"), 422, "REASON_REQUIRED");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "REJECT", "reasonCode", "BECAUSE_I_SAID_SO"), 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "MODIFY", "reasonCode", "NEEDS_RECORDS"), 422, "VALIDATION_FAILED");   // changes nothing
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "EXPLODE"), 422, "VALIDATION_FAILED");
  }

  @Test
  void aHypothesisMustBelongToTheCase() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "MODIFY",
        "hypothesis", "EXC", "reasonCode", "DATA_ERROR"), 422, "VALIDATION_FAILED");
    JsonNode ok = review("investigator", id, Map.of("action", "MODIFY", "hypothesis", "DUP", "newAction",
        "PROVIDER_EDUCATION", "reasonCode", "DOC_SUPPORTS_BILLING"), 201);
    assertThat(ok.get("effectiveAction").asString()).isEqualTo("PROVIDER_EDUCATION");
  }

  // ----------------------------------------------------------------------------- Reject / Request info
  @Test
  void rejectingMovesToReviewAndTheCaseCanThenBeClosedUnfoundedWithAnEligibleException() throws Exception {
    String id = caseWith("DME", "MEDIUM");           // equipment rule is not a hard-fact rule
    JsonNode r = review("investigator", id, Map.of("action", "REJECT", "reasonCode", "LEGIT_CLINICAL_PATTERN",
        "notes", "Documented ongoing need."), 201);
    assertThat(r.get("caseStatus").asString()).isEqualTo("IN_REVIEW");
    assertThat(r.get("requiresApproval").asBoolean()).isFalse();
    JsonNode closed = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome",
        "UNFOUNDED", "reasonCode", "LEGIT_CLINICAL_PATTERN", "rationale", RATIONALE), 201);
    assertThat(closed.get("exceptionEligible").asBoolean()).isTrue();
  }

  @Test
  void hardFactCasesAreNeverEligibleForAnException() throws Exception {
    String id = caseWith("DUP", "MEDIUM");           // exact duplicate rule is a hard-fact rule
    review("investigator", id, Map.of("action", "REJECT", "reasonCode", "LEGIT_CLINICAL_PATTERN"), 201);
    JsonNode closed = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome",
        "UNFOUNDED", "reasonCode", "LEGIT_CLINICAL_PATTERN", "rationale", RATIONALE), 201);
    assertThat(closed.get("exceptionEligible").asBoolean()).isFalse();
  }

  @Test
  void requestInfoPausesTheCaseAndItCanBeReviewedAgain() throws Exception {
    String id = caseWith("UNB", "MEDIUM");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "REQUEST_INFO"),
        422, "VALIDATION_FAILED");
    assertThat(review("investigator", id, Map.of("action", "REQUEST_INFO", "notes", "Need the modifier policy."), 201)
        .get("caseStatus").asString()).isEqualTo("NEED_INFO");
    assertThat(review("investigator", id, Map.of("action", "ACCEPT"), 201).get("caseStatus").asString())
        .isEqualTo("ACTION_APPROVED");
  }

  // ----------------------------------------------------------------------------- state machine and roles
  @Test
  void anActionedCaseCannotBeReviewedAgain() throws Exception {
    String id = caseWith("EXU", "MEDIUM");
    review("investigator", id, Map.of("action", "ACCEPT"), 201);
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "ACCEPT"), 409,
        "STATE_CONFLICT");
  }

  @Test
  void closingRequiresAReviewFirstAndAUsefulRationale() throws Exception {
    String id = caseWith("UNB", "MEDIUM");
    Map<String, Object> close = Map.of("outcome", "CONFIRMED", "reasonCode", "CONFIRMED_PATTERN", "rationale",
        RATIONALE);
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", close, 409, "STATE_CONFLICT");
    review("investigator", id, Map.of("action", "REJECT", "reasonCode", "DATA_ERROR"), 201);
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome", "CONFIRMED",
        "reasonCode", "CONFIRMED_PATTERN", "rationale", "too short"), 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome", "CONFIRMED",
        "reasonCode", "NOPE", "rationale", RATIONALE), 422, "VALIDATION_FAILED");
    call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", close, 201);
  }

  @Test
  void onlyInvestigatorsAndSupervisorsMayReviewAndOnlySupervisorsMayApprove() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    for (String user : new String[] {"auditor", "governance"}) {
      expectProblem(user, HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "ACCEPT"), 403,
          "FORBIDDEN_ROLE");
      expectProblem(user, HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome", "CONFIRMED",
          "reasonCode", "CONFIRMED_PATTERN", "rationale", RATIONALE), 403, "FORBIDDEN_ROLE");
      expectProblem(user, HttpMethod.POST, "/api/review-actions/RA-00001/approve", Map.of("decision", "APPROVE"),
          403, "FORBIDDEN_ROLE");
    }
    assertThat(status(id)).isEqualTo("NEW");
    assertThat(get("auditor", "/api/queue").get("items")).isNotEmpty();      // read-only roles can still read
  }

  @Test
  void unknownActionsAndCasesAre404() throws Exception {
    expectProblem("supervisor", HttpMethod.POST, "/api/review-actions/RA-99999/approve", Map.of("decision",
        "APPROVE"), 404, "NOT_FOUND");
    expectProblem("investigator", HttpMethod.POST, "/api/cases/CASE-9999/review", Map.of("action", "ACCEPT"), 404,
        "NOT_FOUND");
  }

  // ----------------------------------------------------------------------------- idempotency and replays
  @Test
  void theSameIdempotencyKeyReplaysWithoutDuplicates() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    JsonNode a = review("investigator", id, Map.of("action", "ACCEPT"), 201, "Idempotency-Key", "k-123");
    long audit = auditCount();
    JsonNode b = review("investigator", id, Map.of("action", "ACCEPT"), 201, "Idempotency-Key", "k-123");
    assertThat(b.get("actionId").asString()).isEqualTo(a.get("actionId").asString());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wf_review_action", Long.class)).isEqualTo(1L);
    assertThat(auditCount()).isEqualTo(audit);
    expectProblemWithKey(caseWith("UNB", "MEDIUM"), "k-123");
  }

  private void expectProblemWithKey(String otherCase, String key) throws Exception {
    var r = send("investigator", HttpMethod.POST, "/api/cases/" + otherCase + "/review",
        Map.of("action", "ACCEPT"), "Idempotency-Key", key);
    assertThat(r.getResponse().getStatus()).isEqualTo(409);
  }

  @Test
  void repeatingAnApprovalOrAClosureIsHarmless() throws Exception {
    String id = caseWith("PHA", "HIGH");
    JsonNode r = review("investigator", id, Map.of("action", "MODIFY", "newAction", "PREPAY_REVIEW_FLAG",
        "reasonCode", "NEEDS_RECORDS"), 201);
    String path = "/api/review-actions/" + r.get("actionId").asString() + "/approve";
    call("supervisor", HttpMethod.POST, path, Map.of("decision", "APPROVE"), 200);
    long audit = auditCount("APPROVAL");
    assertThat(call("supervisor", HttpMethod.POST, path, Map.of("decision", "APPROVE"), 200).get("replayed")
        .asBoolean()).isTrue();
    assertThat(auditCount("APPROVAL")).isEqualTo(audit);

    call("investigator", HttpMethod.POST, "/api/review-actions/" + r.get("actionId").asString() + "/execute", null,
        200);
    Map<String, Object> close = Map.of("outcome", "CONFIRMED", "reasonCode", "CONFIRMED_PATTERN", "rationale",
        RATIONALE);
    JsonNode first = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", close, 201);
    JsonNode again = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", close, 201);
    assertThat(again.get("precedentId").asString()).isEqualTo(first.get("precedentId").asString());
    assertThat(again.get("replayed").asBoolean()).isTrue();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wf_precedent", Long.class)).isEqualTo(1L);
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome", "UNFOUNDED",
        "reasonCode", "DATA_ERROR", "rationale", RATIONALE), 409, "STATE_CONFLICT");
  }

  // ----------------------------------------------------------------------------- precedent and visibility
  @Test
  void closingCreatesAPendingPrecedentCarryingTheEnginesFeatureVector() throws Exception {
    String id = caseWith("EXU", "MEDIUM");
    review("investigator", id, Map.of("action", "REJECT", "reasonCode", "DOC_SUPPORTS_BILLING"), 201);
    JsonNode closed = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome",
        "UNFOUNDED", "reasonCode", "DOC_SUPPORTS_BILLING", "rationale", RATIONALE, "recovered", 0), 201);
    Map<String, Object> p = jdbc.queryForMap("SELECT * FROM wf_precedent WHERE precedent_id = ?",
        closed.get("precedentId").asString());
    assertThat(p.get("status")).isEqualTo("PENDING_COSIGN");
    assertThat(p.get("source")).isEqualTo("LIVE");
    assertThat(p.get("scheme_type")).isEqualTo("EXU");
    assertThat(p.get("fv_version")).isEqualTo("fv_v1");
    assertThat(json.readTree((String) p.get("feature_vector_json")).size()).isEqualTo(12);
    assertThat(json.readTree((String) p.get("rule_ids_json")).toString()).contains("R-MUE-01");
    assertThat(get("investigator", "/api/precedents")).hasSize(1);
  }

  @Test
  void theQueueAndCaseReflectWorkflowStatusAndAssignee() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    review("investigator", id, Map.of("action", "ACCEPT"), 201);
    JsonNode item = null;
    for (JsonNode i : get("investigator", "/api/queue").get("items")) {
      if (i.get("caseId").asString().equals(id)) item = i;
    }
    assertThat(item).isNotNull();
    assertThat(item.get("status").asString()).isEqualTo("ACTION_APPROVED");
    assertThat(item.get("assignedTo").asString()).isEqualTo("investigator");
    assertThat(get("investigator", "/api/queue?status=ACTION_APPROVED").get("items")).hasSize(1);
  }
}
