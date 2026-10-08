package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.ai.LlmClient;
import java.util.ArrayList;
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
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Grounded reasoning over a closed pack: validated model output, retry, deterministic fallback, role rules. */
@Import(ReasoningIT.Model.class)
class ReasoningIT extends GatewayIT {

  static final JsonMapper M = JsonMapper.builder().build();
  static volatile String behaviour = "off";          // off | valid | badThenGood | alwaysBad
  static final List<String> prompts = new ArrayList<>();

  @TestConfiguration
  static class Model {
    @Bean
    @Primary
    LlmClient routingLlmClient() {
      return new LlmClient() {
        @Override
        public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String tool,
            String model) {
          prompts.add(purpose + "|" + user);
          if ("off".equals(behaviour) || !purpose.equals("CASE_REASONING")) {
            return Optional.empty();
          }
          String pack = user.substring(user.indexOf("(JSON):\n") + 8);
          int cut = pack.indexOf("\n\nYour previous");
          JsonNode in = M.readTree(cut > 0 ? pack.substring(0, cut) : pack);
          boolean bad = "alwaysBad".equals(behaviour) || ("badThenGood".equals(behaviour) && prompts.size() == 1);
          ObjectNode out = M.createObjectNode();
          String e1 = in.get("evidence").get(0).get("id").asString();
          String e1Text = in.get("evidence").get(0).get("statement").asString();
          out.set("headline", sentence(bad ? "The provider was overpaid by $48,000." : e1Text, e1));
          out.set("why", arr(sentence(e1Text, e1)));
          out.set("supporting", arr(sentence(e1Text, e1)));
          out.set("conflicting", arr(sentence("No conflicting signal was found.", "RS5")));
          out.set("confidenceExplanation", arr(sentence(in.get("confidence").get("statement").asString(), "CONF")));
          JsonNode missing = in.get("confidence").get("missing");
          out.set("missingEvidence", arr(sentence(missing.isEmpty() ? "Nothing is recorded as missing." :
              missing.get(0).asString(), missing.isEmpty() ? "RS5" : "CONF")));
          out.set("investigatorQuestions", arr(sentence("What records explain this pattern?", e1)));
          out.set("nextEvidence", arr(sentence("Request the supporting records for the flagged lines.", e1)));
          return Optional.of(new Result(out, "tool_use", "gemini-test", 9, "a".repeat(64), "b".repeat(64)));
        }

        @Override
        public String status() {
          return "off".equals(behaviour) ? "TEMPLATE" : "LIVE";
        }
      };
    }
  }

  static ObjectNode sentence(String text, String id) {
    ObjectNode o = M.createObjectNode();
    o.put("text", text);
    o.putArray("evidence_ids").add(id);
    return o;
  }

  static ArrayNode arr(ObjectNode... s) {
    ArrayNode a = M.createArrayNode();
    for (ObjectNode x : s) {
      a.add(x);
    }
    return a;
  }

  @BeforeEach
  void reset() {
    behaviour = "off";
    prompts.clear();
    jdbc.update("DELETE FROM wf_ai_output");
  }

  private String caseId() throws Exception {
    return caseWith("DUP", "HIGH") != null ? caseWith("DUP", "HIGH") : allCaseIds().get(0);
  }

  @Test
  void withoutAModelTheDeterministicExplanationIsBuiltFromThePackAndLabelledAsSuch() throws Exception {
    String id = allCaseIds().get(0);
    JsonNode none = get("investigator", "/api/cases/" + id + "/reasoning");
    assertThat(none.get("available").asBoolean()).isFalse();
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 200);
    assertThat(r.get("mode").asString()).isEqualTo("TEMPLATE");
    assertThat(r.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(r.get("validation").get("fallbackReason").asString()).isEqualTo("model unavailable");
    JsonNode sections = r.get("content").get("sections");
    for (String s : List.of("headline", "why", "supporting", "conflicting", "confidenceExplanation", "missingEvidence",
        "investigatorQuestions", "nextEvidence")) {
      assertThat(sections.get(s)).as(s).isNotEmpty();
      sections.get(s).forEach(x -> {
        assertThat(x.get("citations")).isNotEmpty();
        assertThat(x.get("text").asString()).doesNotContain("{{").doesNotContainIgnoringCase("fraud");
      });
    }
    assertThat(sections.get("headline").get(0).get("text").asString()).startsWith("Flagged because");
    assertThat(get("investigator", "/api/cases/" + id + "/reasoning").get("available").asBoolean()).isTrue();
    assertThat(prompts).isEmpty();
  }

  @Test
  void aValidatedModelAnswerIsShownAndCitesOnlyPackIds() throws Exception {
    behaviour = "valid";
    String id = allCaseIds().get(0);
    JsonNode pack = get("investigator", "/api/cases/" + id + "/evidence");
    JsonNode r = call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 200);
    assertThat(r.get("mode").asString()).isEqualTo("LLM");
    assertThat(r.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(r.get("model").asString()).isEqualTo("gemini-test");
    java.util.Set<String> packIds = new java.util.HashSet<>(List.of("RS5", "CONF", "WHY"));
    pack.get("evidence").forEach(e -> packIds.add(e.get("id").asString()));
    assertThat(com.claimshield.gateway.reasoning.ReasoningService.cited(r.get("content"))).isSubsetOf(packIds);
    assertThat(auditCount("AI_REASONING_GENERATED")).isPositive();
    int before = prompts.size();
    call("supervisor", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 200);
    assertThat(prompts).as("the stored answer for the same evidence is reused, not regenerated").hasSize(before);
  }

  @Test
  void aFirstAnswerThatInventsANumberIsRetriedOnceAndAcceptedIfTheSecondIsClean() throws Exception {
    behaviour = "badThenGood";
    String id = allCaseIds().get(1);
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 200);
    assertThat(prompts).hasSize(2);
    assertThat(prompts.get(1)).contains("Your previous answer failed these checks");
    assertThat(r.get("mode").asString()).isEqualTo("LLM");
    assertThat(r.get("validation").get("retries").asInt()).isEqualTo(1);
    assertThat(r.toString()).doesNotContain("48,000");
  }

  @Test
  void aModelThatKeepsInventingEvidenceNeverReachesTheUser() throws Exception {
    behaviour = "alwaysBad";
    String id = allCaseIds().get(2);
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 200);
    assertThat(prompts).hasSize(2);
    assertThat(r.get("mode").asString()).isEqualTo("TEMPLATE");
    assertThat(r.get("validation").get("fallbackReason").asString()).contains("validation failed");
    assertThat(r.toString()).doesNotContain("48,000").doesNotContain("overpaid");
  }

  @Test
  void auditorsCanReadButNotGenerateAndUnknownPurposesAndCasesAreRefused() throws Exception {
    String id = allCaseIds().get(0);
    expectProblem("auditor", HttpMethod.POST, "/api/cases/" + id + "/reasoning", null, 403, "FORBIDDEN_ROLE");
    assertThat(get("auditor", "/api/cases/" + id + "/reasoning").has("available")).isTrue();
    expectProblem("investigator", HttpMethod.POST, "/api/cases/CASE-9999/reasoning", null, 404, "NOT_FOUND");
  }

  @Test
  void precedentStrengthIsComputedNotChosenByAModel() throws Exception {
    String id = allCaseIds().get(0);
    JsonNode r = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/precedent-reasoning", null, 200);
    JsonNode content = r.get("content");
    assertThat(content.get("summary").asString()).isNotBlank();
    content.get("precedents").forEach(p -> {
      double sim = p.get("similarity").asDouble();
      String disp = p.get("disposition").asString();
      assertThat(p.get("strength").asString()).isEqualTo("UNFOUNDED".equals(disp) ? "CONFLICTING" : sim >= 0.75 ? "STRONG" : "PARTIAL");
      assertThat(p.get("whyRelevant").asString()).isNotBlank();
    });
    assertThat(content.get("influencedBy").asInt()).isEqualTo(content.get("precedents").size());
  }

  @Test
  void theCaseHeaderCarriesConfidenceAndImpactForTheQueue() throws Exception {
    JsonNode q = get("investigator", "/api/queue?horizon=90");
    assertThat(q.get("items")).isNotEmpty();
    q.get("items").forEach(i -> {
      assertThat(i.get("confidence").get("level").asString()).isIn("HIGH", "MEDIUM");
      assertThat(i.get("impact").get("members").asInt()).isPositive();
    });
    JsonNode high = get("investigator", "/api/queue?horizon=90&confidence=HIGH");
    assertThat(high.get("items")).isNotEmpty();
    high.get("items").forEach(i -> assertThat(i.get("confidence").get("level").asString()).isEqualTo("HIGH"));
    JsonNode strong = get("investigator", "/api/queue?horizon=90&minEvidence=0.8");
    strong.get("items").forEach(i -> assertThat(i.get("confidence").get("evidenceStrength").asDouble()).isGreaterThanOrEqualTo(0.8));
    JsonNode network = get("investigator", "/api/queue?horizon=90&network=true");
    network.get("items").forEach(i -> assertThat(i.get("ruleIds").toString()).contains("G-"));
    assertThat(get("investigator", "/api/queue?horizon=90&q=zzzz-nothing").get("items")).isEmpty();
    assertThat(Map.of("ok", true)).isNotNull();
  }

  @Test
  void theAiUsageEndpointIsRoleGatedAndNeverShowsKeys() throws Exception {
    expectProblem("investigator", HttpMethod.GET, "/api/ai/usage", null, 403, "FORBIDDEN_ROLE");
    JsonNode u = get("auditor", "/api/ai/usage");
    assertThat(u.has("keys")).isTrue();
    assertThat(u.toString()).doesNotContain("AQ.").doesNotContain("AIza");
  }
}
