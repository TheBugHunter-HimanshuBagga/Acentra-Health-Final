package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;

/** The brief endpoints against the real app: roles, caching, audit, staleness, and that M1 is untouched. */
class BriefIT extends GatewayIT {

  private static String url(String caseId) {
    return "/api/cases/" + caseId + "/brief";
  }

  @Test
  void noBriefUntilOneIsGenerated_thenItIsServedAndCached() throws Exception {
    String id = allCaseIds().get(0);
    assertThat(call("investigator", HttpMethod.GET, url(id), null, 204)).isNull();
    assertThat(get("investigator", "/api/cases/" + id).get("briefAvailable").asBoolean()).isFalse();

    long audits = auditCount("BRIEF_GENERATED");
    JsonNode b = call("investigator", HttpMethod.POST, url(id), null, 200);
    assertThat(b.get("briefId").asString()).startsWith("BRF-");
    assertThat(b.get("caseId").asString()).isEqualTo(id);
    assertThat(b.get("mode").asString()).isEqualTo("TEMPLATE");
    assertThat(b.get("badge").asString()).isEqualTo("VALIDATED");
    assertThat(b.get("packSha256").asString()).hasSize(64);
    assertThat(b.get("validation").get("passed").asBoolean()).isTrue();
    assertThat(b.get("validation").get("checks")).hasSize(15);
    assertThat(b.get("validation").get("fallbackReason").isNull()).isTrue();
    assertThat(b.get("sections").get("markdown").asString()).doesNotContain("{{");
    assertThat(b.get("output").get("recommended_action").asString())
        .isEqualTo(get("investigator", "/api/cases/" + id).get("defaultAction").asString());
    assertThat(auditCount("BRIEF_GENERATED")).isEqualTo(audits + 1);

    // second POST and GET return the same stored brief, no new row and no new audit event
    JsonNode again = call("supervisor", HttpMethod.POST, url(id), null, 200);
    assertThat(again.get("briefId")).isEqualTo(b.get("briefId"));
    assertThat(call("auditor", HttpMethod.GET, url(id), null, 200).get("briefId")).isEqualTo(b.get("briefId"));
    assertThat(auditCount("BRIEF_GENERATED")).isEqualTo(audits + 1);
    assertThat(get("investigator", "/api/cases/" + id).get("briefAvailable").asBoolean()).isTrue();
    assertThat(get("supervisor", "/api/audit/verify").get("ok").asBoolean()).isTrue();
  }

  @Test
  void everyFixtureCaseGetsAValidBriefWithTheSevenElements() throws Exception {
    List<String> ids = allCaseIds();
    assertThat(ids).hasSizeGreaterThanOrEqualTo(8);
    for (String id : ids) {
      JsonNode b = call("investigator", HttpMethod.POST, url(id), null, 200);
      assertThat(b.get("validation").get("passed").asBoolean()).as(id).isTrue();
      List<String> titles = b.get("sections").get("sections").valueStream().map(s -> s.get("title").asString()).toList();
      assertThat(titles).as(id).containsSequence("1. Evidence", "2. Timeline", "3. Network context",
          "4. Confidence", "5. Limitations", "6. Recommended human-review action",
          "7. Supporting case and risk context");
      // every rendered line carries at least one citation
      b.get("sections").get("sections").forEach(s -> s.get("items").forEach(i ->
          assertThat(i.get("cites")).as(id + " " + i).isNotEmpty()));
    }
  }

  @Test
  void auditorCanReadButNotGenerate() throws Exception {
    String id = allCaseIds().get(1);
    expectProblem("auditor", HttpMethod.POST, url(id), null, 403, "FORBIDDEN_ROLE");
    expectProblem("governance", HttpMethod.POST, url(id), null, 403, "FORBIDDEN_ROLE");
    call("auditor", HttpMethod.GET, url(id), null, 204);
  }

  @Test
  void unknownCaseIs404AndAnonymousIs401() throws Exception {
    expectProblem("investigator", HttpMethod.POST, url("CASE-9999"), null, 404, "NOT_FOUND");
    expectProblem("investigator", HttpMethod.GET, url("CASE-9999"), null, 404, "NOT_FOUND");
    MvcResult r = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url("CASE-0001")))
        .andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void aBriefBuiltFromAnOlderPackIsStale() throws Exception {
    String id = allCaseIds().get(2);
    call("investigator", HttpMethod.POST, url(id), null, 200);
    assertThat(call("investigator", HttpMethod.GET, url(id), null, 200)).isNotNull();
    // simulate a new engine run publishing a different pack for the same case
    jdbc.update("UPDATE serving_evidence_pack SET pack_sha256 = ? WHERE case_id = ?", "f".repeat(64), id);
    assertThat(call("investigator", HttpMethod.GET, url(id), null, 204)).isNull();
    assertThat(get("investigator", "/api/cases/" + id).get("briefAvailable").asBoolean()).isFalse();
    JsonNode fresh = call("investigator", HttpMethod.POST, url(id), null, 200);
    assertThat(fresh.get("packSha256").asString()).isEqualTo("f".repeat(64));
  }

  @Test
  void generatingABriefDoesNotChangeTheCaseStateOrTheEvidence() throws Exception {
    String id = allCaseIds().get(3);
    String before = get("investigator", "/api/cases/" + id + "/evidence").toString();
    JsonNode caseBefore = get("investigator", "/api/cases/" + id);
    call("investigator", HttpMethod.POST, url(id), null, 200);
    assertThat(get("investigator", "/api/cases/" + id + "/evidence").toString()).isEqualTo(before);
    JsonNode caseAfter = get("investigator", "/api/cases/" + id);
    assertThat(caseAfter.get("status")).isEqualTo(caseBefore.get("status"));
    assertThat(caseAfter.get("packSha256")).isEqualTo(caseBefore.get("packSha256"));
  }
}
