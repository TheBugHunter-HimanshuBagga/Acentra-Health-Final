package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/**
 * Milestone M1 as one story, run against a FRESHLY generated engine database:
 *
 *   synthetic data -> six rules -> alerts -> cases -> scores -> queue -> evidence pack
 *     -> investigator review (modify) -> supervisor approval -> action -> final decision -> audit
 *
 * Enabled only when -Dgateway.fixture points at a database the engine just produced:  npm run e2e:m1
 */
@EnabledIfSystemProperty(named = "gateway.fixture", matches = ".+")
class M1EndToEndIT extends GatewayIT {

  @Test
  void theWholeVerticalSliceWorksEndToEnd() throws Exception {
    // 1. the engine's published run is what the API serves
    JsonNode run = get("investigator", "/api/runs/current");
    assertThat(run.get("status").asString()).isEqualTo("COMPLETE");
    JsonNode funnel = get("investigator", "/api/funnel");
    int alerts = funnel.get("stages").get(0).get("count").asInt();
    int cases = funnel.get("stages").get(2).get("count").asInt();
    assertThat(alerts).isGreaterThan(cases).isGreaterThan(50);
    assertThat(cases).isEqualTo(jdbc.queryForObject("SELECT COUNT(*) FROM serving_case", Integer.class));

    // 2. the queue: ranked, every official factor present, HIGH first
    JsonNode queue = get("investigator", "/api/queue");
    assertThat(queue.get("items")).hasSize(cases);
    JsonNode top = queue.get("items").get(0);
    assertThat(top.get("tier").asString()).isEqualTo("HIGH");
    String caseId = top.get("caseId").asString();

    // 3. the evidence pack the gateway serves is byte-for-byte what the engine stored
    JsonNode pack = get("investigator", "/api/cases/" + caseId + "/evidence");
    String stored = jdbc.queryForObject("SELECT pack_sha256 FROM serving_evidence_pack WHERE case_id = ?",
        String.class, caseId);
    assertThat(pack.get("packSha256").asString()).isEqualTo(stored);
    assertThat(get("investigator", "/api/cases/" + caseId + "/claims").get("total").asInt()).isPositive();

    // 3b. a brief built from that exact pack validates, cites it, and fills numbers from its registry
    JsonNode brief = call("investigator", HttpMethod.POST, "/api/cases/" + caseId + "/brief", null, 200);
    assertThat(brief.get("validation").get("passed").asBoolean()).isTrue();
    assertThat(brief.get("packSha256").asString()).isEqualTo(stored);
    assertThat(brief.get("sections").get("markdown").asString()).doesNotContain("{{")
        .contains(pack.get("numbers").get("S.dollars").get("fmt").get(0).asString());

    // 4. investigator proposes a high-impact action (Modify); it waits for a supervisor
    JsonNode proposed = call("investigator", HttpMethod.POST, "/api/cases/" + caseId + "/review",
        Map.of("action", "MODIFY", "newAction", "PREPAY_REVIEW_FLAG", "reasonCode", "NEEDS_RECORDS",
            "notes", "Hold payment while records are requested."), 201, "Idempotency-Key", "e2e-1");
    assertThat(proposed.get("caseStatus").asString()).isEqualTo("ACTION_PROPOSED");
    String actionId = proposed.get("actionId").asString();

    // 5. the investigator cannot approve; a supervisor can; then the action is carried out (simulated)
    expectProblem("investigator", HttpMethod.POST, "/api/review-actions/" + actionId + "/approve",
        Map.of("decision", "APPROVE"), 403, "FORBIDDEN_ROLE");
    call("supervisor", HttpMethod.POST, "/api/review-actions/" + actionId + "/approve",
        Map.of("decision", "APPROVE", "notes", "Agreed."), 200);
    call("investigator", HttpMethod.POST, "/api/review-actions/" + actionId + "/execute", null, 200);

    // 6. final decision
    JsonNode closed = call("investigator", HttpMethod.POST, "/api/cases/" + caseId + "/close",
        Map.of("outcome", "CONFIRMED", "reasonCode", "CONFIRMED_PATTERN",
            "rationale", "Records received and they confirm the billing pattern flagged by the exact-fact rule."), 201);
    assertThat(closed.get("caseStatus").asString()).isEqualTo("CLOSED");
    assertThat(get("investigator", "/api/cases/" + caseId).get("status").asString()).isEqualTo("CLOSED");

    // 7. audit: every step recorded, the chain verifies, and the precedent was created pending co-signature
    JsonNode events = get("auditor", "/api/audit?entityType=case&entityId=" + caseId + "&limit=50").get("items");
    assertThat(events.toString()).contains("REVIEW_ACTION", "APPROVAL", "ACTION_EXECUTED", "CASE_CLOSED");
    assertThat(get("auditor", "/api/audit/verify").get("ok").asBoolean()).isTrue();
    assertThat(get("investigator", "/api/precedents").get(0).get("status").asString()).isEqualTo("PENDING_COSIGN");

    // 8. the closed case is visible in the queue as CLOSED and a different case is still untouched
    assertThat(get("investigator", "/api/queue?status=CLOSED").get("items")).hasSize(1);
    assertThat(get("investigator", "/api/queue?status=NEW").get("items")).hasSize(cases - 1);
  }
}
