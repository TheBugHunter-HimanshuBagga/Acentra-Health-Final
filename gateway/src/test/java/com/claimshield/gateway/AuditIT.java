package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.config.Tx;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

class AuditIT extends GatewayIT {

  @Autowired AuditService audit;
  @Autowired Tx tx;

  @BeforeEach
  void freshWorkflow() {
    resetWorkflow();
  }

  @Test
  void everyStepOfTheDecisionFlowIsAuditedAndTheChainVerifies() throws Exception {
    String id = caseWith("EXC", "HIGH");
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "MODIFY",
        "newAction", "PREPAY_REVIEW_FLAG", "reasonCode", "NEEDS_RECORDS"), 201);
    String action = r.get("actionId").asString();
    call("supervisor", HttpMethod.POST, "/api/review-actions/" + action + "/approve", Map.of("decision", "APPROVE"),
        200);
    call("investigator", HttpMethod.POST, "/api/review-actions/" + action + "/execute", null, 200);
    call("investigator", HttpMethod.POST, "/api/cases/" + id + "/close", Map.of("outcome", "CONFIRMED",
        "reasonCode", "CONFIRMED_PATTERN", "rationale", "Records confirmed the pattern across multiple months."), 201);

    JsonNode events = get("auditor", "/api/audit?entityType=case&entityId=" + id + "&limit=50").get("items");
    List<String> types = new ArrayList<>();
    events.forEach(e -> types.add(e.get("eventType").asString()));
    assertThat(types).contains("REVIEW_ACTION", "APPROVAL", "ACTION_EXECUTED", "CASE_CLOSED");
    JsonNode review = null;
    for (JsonNode e : events) if (e.get("eventType").asString().equals("REVIEW_ACTION")) review = e;
    assertThat(review.get("actor").asString()).isEqualTo("investigator");
    assertThat(review.get("payload").get("packSha256").asString()).hasSize(64);
    assertThat(auditCount("PRECEDENT_CREATED")).isEqualTo(1);
    assertThat(auditCount("AUTH_LOGIN")).isGreaterThanOrEqualTo(3);

    JsonNode v = get("auditor", "/api/audit/verify");
    assertThat(v.get("ok").asBoolean()).isTrue();
    assertThat(v.get("checked").asLong()).isEqualTo(auditCount());
    assertThat(v.get("firstBadSeq").isNull()).isTrue();
  }

  @Test
  void theTableIsAppendOnlyAtTheDatabaseLevel() {
    tx.write(() -> audit.append("tester", "AUDITOR", "SEED", "case", "CASE-X", Map.of()));
    assertThatThrownBy(() -> jdbc.update("UPDATE wf_audit_event SET actor = 'mallory'"))
        .hasMessageContaining("append-only");
    assertThatThrownBy(() -> jdbc.update("DELETE FROM wf_audit_event")).hasMessageContaining("append-only");
  }

  @Test
  void anAuditRowRollsBackWithTheChangeItRecords() {
    long before = auditCount();
    assertThatThrownBy(() -> tx.write((Supplier<Object>) () -> {
      audit.append("tester", "AUDITOR", "SHOULD_VANISH", "case", "CASE-X", Map.of("k", "v"));
      throw new IllegalStateException("boom after the audit row was written");
    })).hasMessageContaining("boom");
    assertThat(auditCount()).isEqualTo(before);
    assertThat(auditCount("SHOULD_VANISH")).isZero();
    assertThat(audit.verify().get("ok")).isEqualTo(true);
  }

  @Test
  void concurrentDecisionsNeverForkTheChain() throws Exception {
    List<String> ids = allCaseIds();
    assertThat(ids).hasSize(8);
    long reviewsBefore = auditCount("REVIEW_ACTION");
    ExecutorService pool = Executors.newFixedThreadPool(8);
    try {
      List<Future<Integer>> results = new ArrayList<>();
      for (String id : ids) {
        results.add(pool.submit(() -> send("investigator", HttpMethod.POST, "/api/cases/" + id + "/review",
            Map.of("action", "ACCEPT")).getResponse().getStatus()));
        results.add(pool.submit(() -> send("auditor", HttpMethod.GET, "/api/audit/verify", null).getResponse()
            .getStatus()));
      }
      for (Future<Integer> f : results) {
        assertThat(f.get()).isIn(200, 201);
      }
    } finally {
      pool.shutdown();
    }
    assertThat(auditCount("REVIEW_ACTION") - reviewsBefore).isEqualTo(8);
    JsonNode v = get("auditor", "/api/audit/verify");
    assertThat(v.get("ok").asBoolean()).as("hash chain intact after concurrent writers").isTrue();
    assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT prev_hash) FROM wf_audit_event", Long.class))
        .isEqualTo(auditCount());                      // every row has a unique predecessor: no fork
  }

  @Test
  void listingSupportsFiltersAndPagingAndIsRestrictedByRole() throws Exception {
    String id = caseWith("DUP", "MEDIUM");
    long reviewsBefore = auditCount("REVIEW_ACTION");
    call("investigator", HttpMethod.POST, "/api/cases/" + id + "/review", Map.of("action", "ACCEPT"), 201);
    JsonNode page1 = get("supervisor", "/api/audit?limit=2");
    assertThat(page1.get("items")).hasSize(2);
    assertThat(page1.get("nextCursor").isNull()).isFalse();
    long seq1 = page1.get("items").get(0).get("seq").asLong();
    JsonNode page2 = get("supervisor", "/api/audit?limit=2&cursor=" + page1.get("nextCursor").asLong());
    assertThat(page2.get("items").get(0).get("seq").asLong()).isLessThan(seq1);
    assertThat(get("governance", "/api/audit?type=REVIEW_ACTION&limit=200").get("items")).hasSize((int) reviewsBefore + 1);
    expectProblem("investigator", HttpMethod.GET, "/api/audit", null, 403, "FORBIDDEN_ROLE");
    expectProblem("investigator", HttpMethod.GET, "/api/audit/verify", null, 403, "FORBIDDEN_ROLE");
  }
}
