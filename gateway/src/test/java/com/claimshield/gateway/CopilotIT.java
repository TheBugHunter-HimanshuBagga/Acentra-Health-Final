package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.ai.LlmClient;
import java.util.List;
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

/** Devil's-advocate challenge, network analysis and the case copilot: grounded, validated, safe when unsure. */
@Import(CopilotIT.Model.class)
class CopilotIT extends GatewayIT {

  static final JsonMapper M = JsonMapper.builder().build();
  static volatile String behaviour = "off";          // off | valid | unanswerable | inventedNumber

  @TestConfiguration
  static class Model {
    @Bean
    @Primary
    LlmClient routingLlmClient() {
      return new LlmClient() {
        @Override
        public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String tool,
            String model) {
          if ("off".equals(behaviour)) {
            return Optional.empty();
          }
          String pack = user.substring(user.indexOf("(JSON):\n") + 8);
          int cut = pack.indexOf("\n\n");
          JsonNode in = M.readTree(cut > 0 ? pack.substring(0, cut) : pack);
          ObjectNode out = M.createObjectNode();
          if (purpose.equals("COPILOT")) {
            boolean no = "unanswerable".equals(behaviour);
            out.put("answerable", !no);
            var answer = out.putArray("answer");
            if (!no) {
              String id = in.get("evidence").get(0).get("id").asString();
              String text = "inventedNumber".equals(behaviour) ? "That is {{E1.claims}} claims."
                  : in.get("evidence").get(0).get("statement").asString();
              answer.add(ReasoningIT.sentence(text, id));
            }
            out.putArray("followUps");
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
    jdbc.update("DELETE FROM wf_ai_output");
  }

  @Test
  void challengeIsBuiltFromTheConflictingAndMissingEvidenceAndIsCached() throws Exception {
    String id = allCaseIds().get(0);
    assertThat(get("investigator", "/api/cases/" + id + "/challenge").get("available").asBoolean()).isFalse();
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/challenge", null, 200);
    assertThat(r.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    JsonNode s = r.get("content").get("sections");
    for (String k : List.of("headline", "counterArguments", "whatWouldChangeTheView")) {
      assertThat(s.get(k)).as(k).isNotEmpty();
      s.get(k).forEach(x -> {
        assertThat(x.get("citations")).isNotEmpty();
        assertThat(x.get("text").asString()).doesNotContain("{{").doesNotContainIgnoringCase("fraud");
      });
    }
    assertThat(get("investigator", "/api/cases/" + id + "/challenge").get("available").asBoolean()).isTrue();
  }

  @Test
  void networkAnalysisCarriesMetricsCountedFromTheGraphNotByTheModel() throws Exception {
    String id = allCaseIds().get(0);
    JsonNode r = call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/network-analysis", null, 200);
    JsonNode metrics = r.get("content").get("metrics");
    assertThat(metrics).isNotEmpty();
    assertThat(metrics.get(0).get("label").asString()).isEqualTo("Providers");
    assertThat(metrics.get(0).get("value").asInt()).isGreaterThanOrEqualTo(1);
    assertThat(r.get("content").get("sections").get("verify").get(0).get("text").asString()).contains("derived");
  }

  @Test
  void theCopilotAnswersFromThePackAndAdmitsWhenItCannot() throws Exception {
    String id = allCaseIds().get(0);
    JsonNode a = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "How confident are we?"), 200);
    assertThat(a.get("content").get("answerable").asBoolean()).isTrue();
    assertThat(a.get("content").get("sections").get("answer")).isNotEmpty();
    JsonNode no = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "What is the weather in Delhi?"), 200);
    assertThat(no.get("content").get("answerable").asBoolean()).isFalse();
    assertThat(no.get("content").get("notInPack").asString()).contains("will not guess");
  }

  @Test
  void aValidatedModelAnswerIsShownAndAnInventedNumberIsReplacedByTheFallback() throws Exception {
    String id = allCaseIds().get(0);
    behaviour = "valid";
    JsonNode ok = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "Why was this flagged?"), 200);
    assertThat(ok.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(ok.get("model").asString()).isEqualTo("gemini-test");
    behaviour = "inventedNumber";
    JsonNode bad = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "Why was this flagged?"), 200);
    assertThat(bad.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(bad.toString()).doesNotContain("{{E1.claims}}");
    behaviour = "unanswerable";
    JsonNode none = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "Anything about lunch?"), 200);
    assertThat(none.get("content").get("answerable").asBoolean()).isFalse();
  }

  @Test
  void rulesAuditorsCannotAskEmptyQuestionsAreRefusedAndAskingIsRateLimited() throws Exception {
    String id = allCaseIds().get(0);
    call("auditor", HttpMethod.POST, "/api/cases/" + id + "/copilot", Map.of("question", "why?"), 403);
    call("auditor", HttpMethod.POST, "/api/cases/" + id + "/challenge", null, 403);
    call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot", Map.of("question", "   "), 422);
    call("investigator", HttpMethod.POST, "/api/cases/" + id + "/copilot",
        Map.of("question", "x".repeat(301)), 422);
    for (int i = 0; i < 12; i++) {
      call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/copilot", Map.of("question", "why was it flagged?"), 200);
    }
    call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/copilot", Map.of("question", "why was it flagged?"), 429);
  }
}
