package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.ai.LlmClient;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Human pushback: review notes, the knowledge critique and fine-tuning proposals, all grounded and never applied. */
@Import(ReviewIT.Model.class)
class ReviewIT extends GatewayIT {

  static final JsonMapper M = JsonMapper.builder().build();
  static volatile String behaviour = "off";          // off | valid | bad

  @TestConfiguration
  static class Model {
    @Bean
    @Primary
    LlmClient routingLlmClient() {
      return new LlmClient() {
        @Override
        public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String tool, String model) {
          if ("off".equals(behaviour)) {
            return Optional.empty();
          }
          ObjectNode out = M.createObjectNode();
          boolean bad = "bad".equals(behaviour);
          if (purpose.equals("KNOWLEDGE_CRITIQUE")) {
            var f = out.putArray("findings").addObject();
            f.put("severity", "HIGH").put("area", "Rules").put("issue", "The rule has no recorded policy backing in the data.")
                .put("suggestion", "Link it to the policy it enforces.");
            f.putArray("refs").add(bad ? "R-NOT-REAL" : "R-DOD-01");
          } else if (purpose.equals("KNOWLEDGE_FINETUNE")) {
            out.put("proposed", bad ? "Duplicates are blocked after 45 days." : "A line identical to an earlier one is a duplicate submission.");
            out.put("rationale", "Clearer wording.");
          } else {
            return Optional.empty();
          }
          return Optional.of(new Result(out, "tool_use", "gemini-test", 9, "a".repeat(64), "b".repeat(64)));
        }

        @Override
        public String status() {
          return "off".equals(behaviour) ? "TEMPLATE" : "LIVE";
        }
      };
    }
  }

  @BeforeEach
  void reset() {
    behaviour = "off";
    jdbc.update("DELETE FROM wf_review_note");
  }

  @Test
  void peopleCanAgreeOrDisagreeWithReasonsAndTheLogIsReadable() throws Exception {
    call("investigator", HttpMethod.POST, "/api/review/notes",
        Map.of("subjectType", "AI_SENTENCE", "subjectId", "CASE-0001:why:0", "verdict", "DISAGREE", "note", "The peer median is wrong here", "caseId", allCaseIds().get(0)), 200);
    call("supervisor", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "CRITIQUE_FINDING", "subjectId", "CF-1", "verdict", "AGREE"), 200);
    call("investigator", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "AI_SENTENCE", "subjectId", "x", "verdict", "DISAGREE"), 422);
    call("investigator", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "NOPE", "subjectId", "x", "verdict", "AGREE"), 422);
    call("investigator", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "AI_OUTPUT", "subjectId", "BRIEF:CASE-1", "verdict", "GOOD", "caseId", allCaseIds().get(0)), 200);
    call("investigator", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "AI_OUTPUT", "subjectId", "REASONING:CASE-1", "verdict", "BAD", "note", "Missing evidence"), 200);
    call("investigator", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "AI_OUTPUT", "subjectId", "COPILOT:CASE-1", "verdict", "FINE"), 422);
    call("auditor", HttpMethod.POST, "/api/review/notes", Map.of("subjectType", "AI_SENTENCE", "subjectId", "x", "verdict", "AGREE"), 403);
    JsonNode log = get("auditor", "/api/review/notes");
    assertThat(log).hasSize(4);
    assertThat(log.valueStream().map((n) -> n.get("verdict").asString())).containsExactlyInAnyOrder("DISAGREE", "AGREE", "GOOD", "BAD");
    assertThat(auditCount("HUMAN_REVIEW_NOTE")).isGreaterThanOrEqualTo(2);
  }

  @Test
  void withoutAModelTheCritiqueIsBuiltFromTheLintFeedbackAndRulesAndFineTuningSaysSo() throws Exception {
    JsonNode c = call("supervisor", HttpMethod.POST, "/api/knowledge/critique", null, 200);
    assertThat(c.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    c.get("findings").forEach((f) -> assertThat(f.get("refs")).isNotEmpty());
    String pol = get("supervisor", "/api/knowledge/policies").get(0).get("sectionId").asString();
    JsonNode f = call("supervisor", HttpMethod.POST, "/api/knowledge/finetune",
        Map.of("targetType", "POLICY", "targetId", pol, "instruction", "Make this clearer for new investigators"), 200);
    assertThat(f.get("proposed").isNull()).isTrue();
    assertThat(f.get("applied").asBoolean()).isFalse();
    call("supervisor", HttpMethod.POST, "/api/knowledge/finetune", Map.of("targetType", "POLICY", "targetId", "NOPE", "instruction", "Make this clearer"), 404);
    call("auditor", HttpMethod.POST, "/api/knowledge/critique", null, 403);
  }

  @Test
  void aGroundedModelAnswerIsShownAndOneThatInventsIdsOrNumbersIsReplaced() throws Exception {
    behaviour = "valid";
    JsonNode ok = call("supervisor", HttpMethod.POST, "/api/knowledge/critique", null, 200);
    assertThat(ok.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(ok.get("findings").get(0).get("refs").get(0).asString()).isEqualTo("R-DOD-01");
    String pol = get("supervisor", "/api/knowledge/policies").get(0).get("sectionId").asString();
    JsonNode f = call("supervisor", HttpMethod.POST, "/api/knowledge/finetune",
        Map.of("targetType", "POLICY", "targetId", pol, "instruction", "Use simpler words"), 200);
    assertThat(f.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(f.get("proposed").asString()).contains("duplicate submission");
    behaviour = "bad";
    JsonNode bad = call("supervisor", HttpMethod.POST, "/api/knowledge/critique", null, 200);
    assertThat(bad.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(bad.toString()).doesNotContain("R-NOT-REAL");
    JsonNode badFine = call("supervisor", HttpMethod.POST, "/api/knowledge/finetune",
        Map.of("targetType", "POLICY", "targetId", pol, "instruction", "Use simpler words"), 200);
    assertThat(badFine.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(badFine.get("proposed").isNull()).isTrue();
  }
}
