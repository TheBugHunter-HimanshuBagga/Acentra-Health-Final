package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

/** The governed feedback loop, institutional memory, and the human handoff inside the same chat. */
class LearningHandoffIT extends GatewayIT {

  private static final String RATIONALE =
      "Records show the visit pattern is the normal course of care for this treatment centre and its patients.";

  private String closeUnfounded(String caseId) throws Exception {
    call("investigator", HttpMethod.POST, "/api/cases/" + caseId + "/review",
        Map.of("action", "REJECT", "reasonCode", "LEGIT_CLINICAL_PATTERN"), 201);
    return call("investigator", HttpMethod.POST, "/api/cases/" + caseId + "/close",
        Map.of("outcome", "UNFOUNDED", "reasonCode", "LEGIT_CLINICAL_PATTERN", "rationale", RATIONALE), 201)
        .get("precedentId").asString();
  }

  // ---------------------------------------------------------------------------------------------- feedback
  @Test
  void feedbackIsValidatedStoredAuditedAndNeverChangesAScoreOrARule() throws Exception {
    String id = allCaseIds().get(0);
    JsonNode before = get("investigator", "/api/cases/" + id);
    String path = "/api/cases/" + id + "/feedback";
    expectProblem("investigator", HttpMethod.POST, path, Map.of("target", "NOPE", "rating", "USEFUL"), 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, path, Map.of("target", "REASONING", "rating", "NOT_USEFUL"), 422,
        "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, path, Map.of("target", "REASONING", "rating", "NOT_USEFUL",
        "categories", List.of("MADE_UP")), 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, path, Map.of("target", "RECOMMENDATION", "rating", "NOT_USEFUL",
        "categories", List.of("INCORRECT_RECOMMENDATION"), "decision", "REJECTED"), 422, "VALIDATION_FAILED");
    expectProblem("auditor", HttpMethod.POST, path, Map.of("target", "REASONING", "rating", "USEFUL"), 403, "FORBIDDEN_ROLE");
    long audits = auditCount("FEEDBACK_RECORDED");
    JsonNode ok = call("investigator", HttpMethod.POST, path, Map.of("target", "REASONING", "rating", "NOT_USEFUL",
        "categories", List.of("MISSING_EVIDENCE", "WRONG_CONFIDENCE"), "comment", "The referral records were not considered.",
        "decision", "MODIFIED"), 200);
    assertThat(ok.get("effect").asString()).contains("does not change any rule, score or model");
    assertThat(auditCount("FEEDBACK_RECORDED")).isEqualTo(audits + 1);
    JsonNode list = get("supervisor", path);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("categories").toString()).contains("MISSING_EVIDENCE");
    assertThat(list.get(0).get("aiConfidence").asString()).isIn("HIGH", "MEDIUM");
    JsonNode summary = get("auditor", "/api/feedback/summary");
    assertThat(summary.get("notUseful").asInt()).isEqualTo(1);
    assertThat(summary.get("byCategory").get("MISSING_EVIDENCE").asInt()).isEqualTo(1);
    expectProblem("investigator", HttpMethod.GET, "/api/feedback/summary", null, 403, "FORBIDDEN_ROLE");
    JsonNode after = get("investigator", "/api/cases/" + id);
    assertThat(after.get("tier")).isEqualTo(before.get("tier"));
    assertThat(after.get("packSha256")).isEqualTo(before.get("packSha256"));
  }

  // ----------------------------------------------------------------------------------- knowledge extraction
  @Test
  void lessonsAreDraftedAfterClosureReviewedByASecondPersonAndThenShownWithTheirReason() throws Exception {
    String closed = caseWith("DUP", "MEDIUM");
    String similar = allCaseIds().stream().filter(c -> !c.equals(closed)).findFirst().orElseThrow();
    expectProblem("investigator", HttpMethod.POST, "/api/cases/" + closed + "/knowledge/extract", null, 409, "STATE_CONFLICT");
    closeUnfounded(closed);
    call("investigator", HttpMethod.POST, "/api/cases/" + closed + "/feedback", Map.of("target", "RECOMMENDATION",
        "rating", "NOT_USEFUL", "categories", List.of("INCORRECT_RECOMMENDATION"),
        "comment", "A different step was needed here.", "decision", "MODIFIED"), 200);

    expectProblem("auditor", HttpMethod.POST, "/api/cases/" + closed + "/knowledge/extract", null, 403, "FORBIDDEN_ROLE");
    JsonNode drafted = call("investigator", HttpMethod.POST, "/api/cases/" + closed + "/knowledge/extract", null, 200);
    assertThat(drafted.size()).isGreaterThanOrEqualTo(2);
    drafted.forEach(i -> {
      assertThat(i.get("status").asString()).isEqualTo("PENDING_REVIEW");
      assertThat(i.get("text").asString()).isNotBlank().doesNotContainIgnoringCase("fraud");
      assertThat(i.get("source").asString()).isIn("DETERMINISTIC", "AI");
    });
    assertThat(drafted.valueStream().map(i -> i.get("kind").asString())).contains("PATTERN");
    assertThat(call("supervisor", HttpMethod.POST, "/api/cases/" + closed + "/knowledge/extract", null, 200).size())
        .as("extraction is idempotent").isEqualTo(drafted.size());
    String itemId = drafted.get(0).get("itemId").asString();

    String path = "/api/knowledge-items/" + itemId + "/decision";
    expectProblem("investigator", HttpMethod.POST, path, Map.of("decision", "APPROVE"), 403, "FORBIDDEN_ROLE");
    expectProblem("supervisor", HttpMethod.POST, path, Map.of("decision", "REJECT"), 422, "VALIDATION_FAILED");   // notes needed
    long audits = auditCount("KNOWLEDGE_APPROVED");
    JsonNode approved = call("supervisor", HttpMethod.POST, path, Map.of("decision", "APPROVE", "notes", "Reasonable lesson."), 200);
    assertThat(approved.get("status").asString()).isEqualTo("APPROVED");
    assertThat(approved.get("reviewedBy").asString()).isEqualTo("supervisor");
    assertThat(auditCount("KNOWLEDGE_APPROVED")).isEqualTo(audits + 1);
    expectProblem("governance", HttpMethod.POST, path, Map.of("decision", "APPROVE"), 409, "STATE_CONFLICT");

    JsonNode mem = get("investigator", "/api/cases/" + similar + "/institutional-memory");
    assertThat(mem.get("summary").asString()).isNotBlank();
    assertThat(mem.get("influencedBy").asInt()).isEqualTo(mem.get("precedents").size());
    mem.get("precedents").forEach(p -> {
      assertThat(p.get("whyShown").asString()).contains("not evidence");
      assertThat(p.get("strength").asString()).isIn("STRONG", "PARTIAL", "CONFLICTING");
    });
    mem.get("approvedKnowledge").forEach(k -> assertThat(k.get("whyShown").asString()).contains("does not change the score"));
    assertThat(get("auditor", "/api/learning/growth").get("approvedKnowledge").asInt()).isGreaterThanOrEqualTo(1);
  }

  @Test
  void theAuthorOfADraftCannotApproveItEvenWithTheRightRole() throws Exception {
    String id = allCaseIds().stream().filter(c -> jdbc.queryForObject(
        "SELECT COUNT(*) FROM wf_case_state WHERE case_id = ? AND status = 'CLOSED'", Long.class, c) == 0).skip(2).findFirst().orElseThrow();
    closeUnfounded(id);
    JsonNode drafted = call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/knowledge/extract", null, 200);
    String itemId = drafted.get(0).get("itemId").asString();
    expectProblem("supervisor", HttpMethod.POST, "/api/knowledge-items/" + itemId + "/decision",
        Map.of("decision", "APPROVE"), 403, "SELF_APPROVAL_FORBIDDEN");
    call("governance", HttpMethod.POST, "/api/knowledge-items/" + itemId + "/decision",
        Map.of("decision", "REJECT", "notes", "Too specific to generalise."), 200);
  }

  // -------------------------------------------------------------------------------------------------- handoff
  @Test
  void aHumanSpecialistJoinsInTheSameConversationAndEveryMessageIsAudited() throws Exception {
    long audits = auditCount("HANDOFF_MESSAGE");
    JsonNode req = call("investigator", HttpMethod.POST, "/api/handoff", Map.of("reason", "I need help with a policy question"), 200);
    assertThat(req.get("active").asBoolean()).isTrue();
    String hid = req.get("handoff").get("handoffId").asString();
    assertThat(req.get("handoff").get("status").asString()).isEqualTo("WAITING");
    assertThat(call("investigator", HttpMethod.POST, "/api/handoff", Map.of("reason", "again"), 200)
        .get("handoff").get("handoffId").asString()).as("one open request per person").isEqualTo(hid);

    expectProblem("investigator", HttpMethod.GET, "/api/agent/queue", null, 403, "FORBIDDEN_ROLE");
    JsonNode queue = get("supervisor", "/api/agent/queue");
    assertThat(queue.get("items").valueStream().map(i -> i.get("handoffId").asString())).contains(hid);

    call("investigator", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "Which rule covers CASE-0001?"), 200);
    expectProblem("investigator", HttpMethod.POST, "/api/handoff/" + hid + "/messages",
        Map.of("text", "my email is someone@example.com"), 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.POST, "/api/handoff/" + hid + "/messages",
        Map.of("text", "call 555-123-4567 or 5551234567"), 422, "VALIDATION_FAILED");
    expectProblem("supervisor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "hello"), 403, "FORBIDDEN_ROLE");
    expectProblem("investigator", HttpMethod.POST, "/api/agent/handoffs/" + hid + "/join", null, 403, "FORBIDDEN_ROLE");

    JsonNode joined = call("supervisor", HttpMethod.POST, "/api/agent/handoffs/" + hid + "/join", null, 200);
    assertThat(joined.get("handoff").get("status").asString()).isEqualTo("ACTIVE");
    assertThat(joined.get("handoff").get("agent").asString()).isEqualTo("supervisor");
    expectProblem("governance", HttpMethod.POST, "/api/agent/handoffs/" + hid + "/join", null, 404, "NOT_FOUND");   // already taken: private
    call("supervisor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "POL-BILL-1.1 covers duplicate lines."), 200);

    JsonNode mine = get("investigator", "/api/handoff/mine");
    List<String> senders = mine.get("messages").valueStream().map(m -> m.get("role").asString()).toList();
    assertThat(senders).containsSubsequence("SYSTEM", "USER", "SYSTEM", "AGENT");
    long seq = mine.get("messages").get(1).get("seq").asLong();
    assertThat(get("investigator", "/api/handoff/" + hid + "?after=" + seq).get("messages").size())
        .isLessThan(mine.get("messages").size());

    expectProblem("governance", HttpMethod.GET, "/api/handoff/" + hid, null, 404, "NOT_FOUND");          // private
    JsonNode transcript = get("auditor", "/api/handoff/" + hid + "/transcript");
    assertThat(transcript.get("messages").toString()).contains("POL-BILL-1.1 covers duplicate lines.");
    expectProblem("auditor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "x"), 404, "NOT_FOUND");   // read only

    assertThat(auditCount("HANDOFF_MESSAGE")).isEqualTo(audits + 2);
    assertThat(jdbc.queryForObject("SELECT payload_json FROM wf_audit_event WHERE event_type = 'HANDOFF_MESSAGE' ORDER BY seq DESC LIMIT 1",
        String.class)).contains("sha256").doesNotContain("POL-BILL-1.1 covers");
    call("investigator", HttpMethod.POST, "/api/handoff/" + hid + "/close", null, 200);
    expectProblem("supervisor", HttpMethod.POST, "/api/handoff/" + hid + "/messages", Map.of("text", "late"), 409, "STATE_CONFLICT");
    assertThat(get("investigator", "/api/handoff/mine").get("active").asBoolean()).isFalse();
    assertThat(auditCount("HANDOFF_JOINED")).isPositive();
    assertThat(auditCount("HANDOFF_CLOSED")).isPositive();
  }

  @Test
  void theAssistantOffersAHumanWhenItCannotAnswerOrWhenAskedAndTheRequestIsStillExplicit() throws Exception {
    JsonNode asked = call("investigator", HttpMethod.POST, "/api/chat", Map.of("message", "I want to talk to a human specialist",
        "lang", "en"), 200);
    assertThat(asked.get("intent").asString()).isEqualTo("HUMAN_HANDOFF");
    assertThat(asked.get("handoffOffered").asBoolean()).isTrue();
    assertThat(asked.get("blocks").get(0).get("textEn").asString()).contains("human specialist");
    assertThat(get("investigator", "/api/handoff/mine").get("active").asBoolean()).as("offering is not connecting").isFalse();

    JsonNode lost = call("investigator", HttpMethod.POST, "/api/chat", Map.of("message", "What does the policy say about zebra staffing levels?",
        "lang", "en"), 200);
    assertThat(lost.get("blocks").get(0).get("textEn").asString())
        .isEqualTo("I don't have enough evidence to answer this confidently. Would you like to connect with a human specialist?");
    assertThat(lost.get("handoffOffered").asBoolean()).isTrue();
  }
}
