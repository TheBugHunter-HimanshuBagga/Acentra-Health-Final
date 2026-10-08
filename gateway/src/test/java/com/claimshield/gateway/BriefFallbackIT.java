package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.brief.BriefCandidateSource;
import com.claimshield.gateway.brief.BriefTemplate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.BiFunction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The failure ladder, exercised with a scripted stand-in for the future model: invalid output is retried once and
 * then replaced by the deterministic template with a fallback badge; valid output is accepted. A rejected model
 * brief is never shown to a user.
 */
@Import(BriefFallbackIT.ScriptedModel.class)
class BriefFallbackIT extends GatewayIT {

  static BiFunction<JsonNode, Integer, Optional<BriefCandidateSource.Candidate>> script;
  static final List<Integer> calls = new ArrayList<>();

  @TestConfiguration
  static class ScriptedModel {
    @Bean
    BriefCandidateSource scripted() {
      return (caseId, pack, attempt) -> {
        calls.add(attempt);
        return script.apply(pack, attempt);
      };
    }
  }

  @Autowired BriefTemplate template;

  @BeforeEach
  void reset() {
    calls.clear();
    jdbc.update("DELETE FROM wf_brief");   // cases share one database per class; start each test uncached
  }

  private static BriefCandidateSource.Candidate model(JsonNode out, String stop) {
    return new BriefCandidateSource.Candidate(out, stop, "test-model", "p".repeat(64), "r".repeat(64));
  }

  private String freshCase(int i) throws Exception {
    return allCaseIds().get(i);
  }

  @Test
  void aFabricatedNumberIsRejectedTwiceThenTheTemplateIsUsedWithAFallbackBadge() throws Exception {
    script = (pack, attempt) -> {
      ObjectNode out = template.build(pack);
      ((ObjectNode) out.get("summary").get(0)).put("text", "The provider was overpaid by $48,000.");
      return Optional.of(model(out, "end_turn"));
    };
    String id = freshCase(0);
    long audits = auditCount("BRIEF_GENERATED");
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/brief", null, 200);
    assertThat(calls).containsExactly(1, 2);
    assertThat(b.get("mode").asString()).isEqualTo("TEMPLATE");
    assertThat(b.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(b.get("model").isNull()).isTrue();
    JsonNode v = b.get("validation");
    assertThat(v.get("retries").asInt()).isEqualTo(1);
    assertThat(v.get("fallbackReason").asString()).contains("validation failed").contains("V5");
    assertThat(v.get("rejectedAttempts")).hasSize(2);
    assertThat(v.get("rejectedAttempts").get(0).get("blockers").toString()).contains("V5");
    // the rejected text is nowhere in what the user sees or what is stored as the brief
    assertThat(b.toString()).doesNotContain("48,000").doesNotContain("overpaid");
    assertThat(jdbc.queryForObject("SELECT output_json FROM wf_brief WHERE case_id = ?", String.class, id))
        .doesNotContain("48,000");
    assertThat(auditCount("BRIEF_GENERATED")).isEqualTo(audits + 1);
    assertThat(jdbc.queryForObject("SELECT payload_json FROM wf_audit_event WHERE event_type = 'BRIEF_GENERATED' "
        + "ORDER BY seq DESC LIMIT 1", String.class)).contains("TEMPLATE_FALLBACK");
  }

  @Test
  void aTruncatedOrRefusedModelResponseFallsBackToo() throws Exception {
    script = (pack, attempt) -> Optional.of(model(template.build(pack), attempt == 1 ? "max_tokens" : "refusal"));
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + freshCase(1) + "/brief", null, 200);
    assertThat(b.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(b.get("validation").get("fallbackReason").asString()).contains("V1");
  }

  @Test
  void aValidSecondAttemptIsAcceptedAsAModelBrief() throws Exception {
    script = (pack, attempt) -> {
      ObjectNode out = template.build(pack);
      if (attempt == 1) {
        out.put("recommended_action", "REFER_EXTERNAL");   // not permitted for a MEDIUM case
        out.put("hypothesis", "NOPE");
      }
      return Optional.of(model(out, "end_turn"));
    };
    String id = caseWith("DUP", "MEDIUM");
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + id + "/brief", null, 200);
    assertThat(calls).containsExactly(1, 2);
    assertThat(b.get("mode").asString()).isEqualTo("LLM");
    assertThat(b.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(b.get("model").asString()).isEqualTo("test-model");
    assertThat(b.get("validation").get("retries").asInt()).isEqualTo(1);
    assertThat(b.get("validation").get("rejectedAttempts")).hasSize(1);
    assertThat(b.get("validation").get("rejectedAttempts").get(0).get("blockers").toString()).contains("V8", "V9");
  }

  @Test
  void anUnavailableModelFallsBackWithoutRetrying() throws Exception {
    script = (pack, attempt) -> Optional.empty();
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + freshCase(2) + "/brief", null, 200);
    assertThat(calls).containsExactly(1);
    assertThat(b.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(b.get("validation").get("fallbackReason").asString()).isEqualTo("model unavailable");
  }

  @Test
  void aModelBriefThatNamesAnUnknownEvidenceIdOrForbiddenActionNeverReachesTheUser() throws Exception {
    script = (pack, attempt) -> {
      ObjectNode out = template.build(pack);
      ((ObjectNode) out.get("summary").get(0)).putArray("evidence_ids").add("E7");
      ((ObjectNode) out.get("headline")).put("text", "This is a fraudulent provider.");
      return Optional.of(model(out, "end_turn"));
    };
    JsonNode b = call("investigator", HttpMethod.POST, "/api/cases/" + freshCase(3) + "/brief", null, 200);
    assertThat(b.get("badge").asString()).isEqualTo("TEMPLATE_FALLBACK");
    assertThat(b.toString()).doesNotContainIgnoringCase("fraudulent").doesNotContain("E7\"]");
    assertThat(b.get("validation").get("rejectedAttempts").get(0).get("blockers").toString()).contains("V3", "V7");
  }
}
