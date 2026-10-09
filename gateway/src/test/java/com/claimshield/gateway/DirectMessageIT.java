package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/** Direct messages: separate from the assistant, two people only, a case can ride along, the other person is notified. */
class DirectMessageIT extends GatewayIT {

  @BeforeEach
  void clean() {
    jdbc.update("DELETE FROM wf_notification");
    jdbc.update("DELETE FROM wf_dm_read");
    jdbc.update("DELETE FROM wf_dm_message");
    jdbc.update("DELETE FROM wf_dm_thread");
  }

  @Test
  void aConversationCarriesACaseAndNotifiesTheOtherPersonWithoutLeakingTheText() throws Exception {
    String caseId = allCaseIds().get(0);
    JsonNode opened = call("investigator", HttpMethod.POST, "/api/dm/threads",
        Map.of("to", "supervisor", "caseId", caseId, "text", "Can you look at this one before I act?"), 200);
    String tid = opened.get("threadId").asString();

    JsonNode inbox = get("supervisor", "/api/dm/threads");
    assertThat(inbox.get(0).get("threadId").asString()).isEqualTo(tid);
    assertThat(inbox.get(0).get("unread").asInt()).isEqualTo(1);
    assertThat(inbox.get(0).get("last").get("caseId").asString()).isEqualTo(caseId);

    JsonNode note = get("supervisor", "/api/notifications").get("items").get(0);
    assertThat(note.get("kind").asString()).isEqualTo("DM_MESSAGE");
    assertThat(note.get("link").asString()).isEqualTo("/agent?thread=" + tid);
    assertThat(note.toString()).doesNotContain("look at this one");

    JsonNode msgs = get("supervisor", "/api/dm/threads/" + tid);
    assertThat(msgs.get("messages").get(0).get("caseId").asString()).isEqualTo(caseId);
    assertThat(msgs.get("with").get("username").asString()).isEqualTo("investigator");
    call("supervisor", HttpMethod.POST, "/api/dm/threads/" + tid + "/read", null, 200);
    assertThat(get("supervisor", "/api/dm/threads").get(0).get("unread").asInt()).isZero();

    call("supervisor", HttpMethod.POST, "/api/dm/threads/" + tid + "/messages", Map.of("text", "Looking now"), 200);
    assertThat(get("investigator", "/api/dm/threads/" + tid).get("messages")).hasSize(2);
    // opening again with the same person reuses the conversation
    assertThat(call("supervisor", HttpMethod.POST, "/api/dm/threads", Map.of("to", "investigator"), 200).get("threadId").asString())
        .isEqualTo(tid);
  }

  @Test
  void onlyTheTwoPeopleCanReadItAuditorsAreOutAndBadInputIsRefused() throws Exception {
    JsonNode opened = call("investigator", HttpMethod.POST, "/api/dm/threads", Map.of("to", "supervisor", "text", "hello"), 200);
    String tid = opened.get("threadId").asString();
    call("governance", HttpMethod.GET, "/api/dm/threads/" + tid, null, 404);
    call("governance", HttpMethod.POST, "/api/dm/threads/" + tid + "/messages", Map.of("text", "hi"), 404);
    call("auditor", HttpMethod.GET, "/api/dm/threads", null, 403);
    call("auditor", HttpMethod.GET, "/api/people", null, 403);
    call("investigator", HttpMethod.POST, "/api/dm/threads", Map.of("to", "auditor", "text", "hi"), 422);
    call("investigator", HttpMethod.POST, "/api/dm/threads", Map.of("to", "investigator", "text", "hi"), 422);
    call("investigator", HttpMethod.POST, "/api/dm/threads/" + tid + "/messages", Map.of("text", "call me on 9876543210 now"), 422);
    call("investigator", HttpMethod.POST, "/api/dm/threads/" + tid + "/messages", Map.of("text", "see this", "caseId", "CASE-NOPE"), 422);
    call("investigator", HttpMethod.POST, "/api/dm/threads/" + tid + "/messages", Map.of("text", "   "), 422);
    JsonNode people = get("investigator", "/api/people");
    assertThat(people.valueStream().map((p) -> p.get("username").asString())).contains("supervisor", "governance")
        .doesNotContain("investigator", "auditor");
    assertThat(auditCount("DM_MESSAGE")).isGreaterThanOrEqualTo(1);
  }
}
