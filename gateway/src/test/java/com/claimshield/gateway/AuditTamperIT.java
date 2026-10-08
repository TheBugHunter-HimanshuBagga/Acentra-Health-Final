package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.annotation.DirtiesContext;
import tools.jackson.databind.JsonNode;

/** Own class (own database) because it deliberately disables the append-only triggers to simulate tampering. */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)   // each test gets its own database
class AuditTamperIT extends GatewayIT {

  private void someHistory() throws Exception {
    for (String scheme : new String[] {"DUP", "UNB", "EXU"}) {
      call("investigator", HttpMethod.POST, "/api/cases/" + caseWith(scheme, "MEDIUM") + "/review",
          Map.of("action", "ACCEPT"), 201);
    }
  }

  @Test
  void editingAnyStoredColumnIsDetectedAtTheExactRow() throws Exception {
    someHistory();
    assertThat(get("auditor", "/api/audit/verify").get("ok").asBoolean()).isTrue();
    long victim = jdbc.queryForObject("SELECT seq FROM wf_audit_event WHERE event_type = 'REVIEW_ACTION' "
        + "ORDER BY seq LIMIT 1", Long.class);

    jdbc.execute("DROP TRIGGER wf_audit_no_update");
    jdbc.update("UPDATE wf_audit_event SET actor = 'someone-else' WHERE seq = ?", victim);
    JsonNode v = get("auditor", "/api/audit/verify");
    assertThat(v.get("ok").asBoolean()).isFalse();
    assertThat(v.get("firstBadSeq").asLong()).isEqualTo(victim);
  }

  @Test
  void aDeletedRowBreaksTheChainAfterIt() throws Exception {
    someHistory();
    long victim = jdbc.queryForObject("SELECT seq FROM wf_audit_event WHERE event_type = 'REVIEW_ACTION' "
        + "ORDER BY seq LIMIT 1", Long.class);
    jdbc.execute("DROP TRIGGER wf_audit_no_delete");
    jdbc.update("DELETE FROM wf_audit_event WHERE seq = ?", victim);
    JsonNode v = get("auditor", "/api/audit/verify");
    assertThat(v.get("ok").asBoolean()).isFalse();
    assertThat(v.get("firstBadSeq").asLong()).isGreaterThan(victim);
  }
}
