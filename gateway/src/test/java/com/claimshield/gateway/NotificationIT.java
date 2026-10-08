package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/** Notifications wait for the person: a colleague who signs in later still sees them, and they never leak. */
class NotificationIT extends GatewayIT {

  @org.junit.jupiter.api.BeforeEach
  void clean() {
    jdbc.update("DELETE FROM wf_notification");
    jdbc.update("DELETE FROM wf_handoff_message");
    jdbc.update("DELETE FROM wf_handoff");
  }

  private JsonNode mine(String user) throws Exception {
    return get(user, "/api/notifications");
  }

  @Test
  void aRequestNotifiesTheSpecialistsWhoSeeItWhenTheySignInAndNobodyElse() throws Exception {
    JsonNode req = call("investigator", HttpMethod.POST, "/api/handoff", Map.of("reason", "Need a policy answer"), 200);
    String hid = req.get("handoff").get("handoffId").asString();

    for (String specialist : List.of("supervisor", "governance")) {
      JsonNode n = mine(specialist);
      assertThat(n.get("unread").asInt()).as(specialist).isGreaterThanOrEqualTo(1);
      JsonNode first = n.get("items").get(0);
      assertThat(first.get("kind").asString()).isEqualTo("HANDOFF_REQUESTED");
      assertThat(first.get("link").asString()).isEqualTo("/agent?open=" + hid);
      assertThat(first.get("body").asString()).isEqualTo("Need a policy answer");
    }
    assertThat(mine("investigator").get("unread").asInt()).as("the requester is not notified of their own request").isZero();
    assertThat(mine("auditor").get("unread").asInt()).isZero();
  }

  @Test
  void joiningAndRepliesNotifyTheOtherPersonAndRepeatedMessagesFoldIntoOneEntry() throws Exception {
    JsonNode req = call("investigator", HttpMethod.POST, "/api/handoff", Map.of("reason", "Question about CASE-0001"), 200);
    String hid = req.get("handoff").get("handoffId").asString();
    call("supervisor", HttpMethod.POST, "/api/agent/handoffs/" + hid + "/join", null, 200);
    JsonNode afterJoin = mine("investigator");
    assertThat(afterJoin.get("items").get(0).get("kind").asString()).isEqualTo("HANDOFF_JOINED");
    assertThat(afterJoin.get("items").get(0).get("link").asString()).isEqualTo("chat:" + hid);

    call("supervisor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "Looking at it now"), 200);
    call("supervisor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "Rule R-DOD-01 applies"), 200);
    JsonNode inv = mine("investigator");
    long messageEntries = inv.get("items").valueStream().filter((i) -> i.get("kind").asString().equals("HANDOFF_MESSAGE")).count();
    assertThat(messageEntries).as("two messages fold into one notification").isEqualTo(1);
    JsonNode msg = inv.get("items").valueStream().filter((i) -> i.get("kind").asString().equals("HANDOFF_MESSAGE")).findFirst().orElseThrow();
    assertThat(msg.get("count").asInt()).isEqualTo(2);
    assertThat(msg.toString()).as("message text never goes into a notification").doesNotContain("Rule R-DOD-01");

    call("investigator", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "Thank you"), 200);
    assertThat(mine("supervisor").get("items").valueStream().anyMatch((i) -> i.get("kind").asString().equals("HANDOFF_MESSAGE"))).isTrue();
  }

  @Test
  void markingReadClearsTheCountForThatPersonOnly() throws Exception {
    call("investigator", HttpMethod.POST, "/api/handoff", Map.of("reason", "Help please"), 200);
    JsonNode sup = mine("supervisor");
    String id = sup.get("items").get(0).get("id").asString();
    JsonNode after = call("supervisor", HttpMethod.POST, "/api/notifications/read", Map.of("ids", List.of(id)), 200);
    assertThat(after.get("unread").asInt()).isEqualTo(sup.get("unread").asInt() - 1);
    assertThat(mine("governance").get("unread").asInt()).as("another person's copy is untouched").isGreaterThanOrEqualTo(1);
    JsonNode none = call("governance", HttpMethod.POST, "/api/notifications/read", Map.of("all", true), 200);
    assertThat(none.get("unread").asInt()).isZero();
    // someone else's id does nothing
    call("investigator", HttpMethod.POST, "/api/notifications/read", Map.of("ids", List.of(id)), 200);
    assertThat(mine("supervisor").get("items").get(0).get("read").asBoolean()).isTrue();
  }
}
