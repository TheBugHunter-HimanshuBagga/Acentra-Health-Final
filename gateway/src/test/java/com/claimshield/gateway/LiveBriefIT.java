package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.ai.LlmClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import com.claimshield.gateway.brief.BriefTemplate;

/** The real AnthropicBriefSource (prompt, schema, retry hint) driven by a fake model client. */
@Import(LiveBriefIT.Model.class)
class LiveBriefIT extends GatewayIT {

  static volatile boolean corrupt;
  static final List<String> users = new ArrayList<>();
  static final List<String> systems = new ArrayList<>();
  static BriefTemplate tpl;

  @TestConfiguration
  static class Model {
    @Bean
    @Primary
    LlmClient fake(BriefTemplate template) {
      tpl = template;
      return new LlmClient() {
        @Override
        public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String tool,
            String model) {
          users.add(user);
          systems.add(system);
          String pack = user.substring(user.indexOf("Evidence pack (JSON):\n") + 22);
          int end = pack.indexOf("\n\nYour previous answer");
          if (end > 0) {
            pack = pack.substring(0, end);
          }
          ObjectNode out = template.build(ChatIT.M.readTree(pack));
          if (corrupt && users.size() == 1) {
            ((ObjectNode) out.get("summary").get(0)).put("text", "Overpaid by $9,999.");
          }
          return Optional.of(new Result(out, "end_turn", "claude-test", 5, "a".repeat(64), "b".repeat(64)));
        }

        @Override
        public String status() {
          return "LIVE";
        }
      };
    }
  }

  @BeforeEach
  void reset() {
    users.clear();
    systems.clear();
    corrupt = false;
    jdbc.update("DELETE FROM wf_brief");
  }

  @Test
  void aValidModelBriefIsAcceptedAndThePromptCarriesTheClosedPack() throws Exception {
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + allCaseIds().get(0) + "/brief", null, 200);
    assertThat(b.get("mode").asString()).isEqualTo("LLM");
    assertThat(b.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(users).hasSize(1);
    assertThat(users.get(0)).contains("Allowed IDs:").contains("Evidence pack (JSON):");
    assertThat(systems.get(0)).contains("Never type a number").contains("submit_brief");
  }

  @Test
  void aFailedFirstAnswerIsRetriedWithTheValidatorHintAndThenAccepted() throws Exception {
    corrupt = true;
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + allCaseIds().get(1) + "/brief", null, 200);
    assertThat(users).hasSize(2);
    assertThat(users.get(1)).contains("Your previous answer failed these checks");
    assertThat(b.get("mode").asString()).isEqualTo("LLM");
    assertThat(b.toString()).doesNotContain("9,999");
  }
}
