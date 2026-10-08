package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

class ReadApiIT extends GatewayIT {

  @Test
  void currentRunAndFunnelComeFromTheEngine() throws Exception {
    JsonNode run = get("investigator", "/api/runs/current");
    assertThat(run.get("runId").asString()).isEqualTo("RUN-001");
    assertThat(run.get("status").asString()).isEqualTo("COMPLETE");
    JsonNode f = get("investigator", "/api/funnel");
    List<String> keys = new ArrayList<>();
    f.get("stages").forEach(s -> keys.add(s.get("key").asString()));
    assertThat(keys).containsExactly("alerts", "active", "cases", "inCapacity");
    assertThat(f.get("stages").get(0).get("count").asInt()).isGreaterThan(f.get("stages").get(2).get("count").asInt());
    assertThat(f.get("tiers").get("HIGH").asInt()).isEqualTo(2);
    assertThat(f.get("coverage").get("basis").asString()).isEqualTo("synthetic-ground-truth");
  }

  @Test
  void queueIsRankedByUtilityWithEveryOfficialFactorPresent() throws Exception {
    JsonNode q = get("investigator", "/api/queue");
    JsonNode items = q.get("items");
    assertThat(items).hasSize(8);
    double prev = Double.MAX_VALUE;
    int rank = 0;
    for (JsonNode i : items) {
      assertThat(i.get("rank").asInt()).isEqualTo(++rank);
      assertThat(i.get("utility").asDouble()).isLessThanOrEqualTo(prev);
      prev = i.get("utility").asDouble();
      for (String factor : List.of("risk", "dollarScore", "memberImpact", "severity", "evidenceStrength")) {
        assertThat(i.get("factors").has(factor)).as(factor).isTrue();
      }
      assertThat(i.get("dollars").get("basis").asString()).isEqualTo("EXACT");
      assertThat(i.get("status").asString()).isEqualTo("NEW");
      assertThat(i.get("estHours").asDouble()).isGreaterThanOrEqualTo(4);
    }
    assertThat(items.get(0).get("tier").asString()).isEqualTo("HIGH");
    assertThat(items.get(1).get("tier").asString()).isEqualTo("HIGH");
    assertThat(items.get(2).get("tier").asString()).isEqualTo("MEDIUM");
  }

  @Test
  void capacityDefersCasesThatDoNotFitAndASmallerLaterCaseCanStillFit() throws Exception {
    // Derive a capacity from the fixture itself: room for the first two cases plus just under the third.
    List<Double> hours = new ArrayList<>();
    get("investigator", "/api/queue?capacityHours=1000").get("items").forEach(i -> hours.add(i.get("estHours").asDouble()));
    double capacity = hours.get(0) + hours.get(1) + hours.get(2) - 0.01;
    assertThat(hours.subList(3, hours.size())).as("fixture has a later case smaller than the third")
        .anyMatch(h -> h < hours.get(2) - 0.01);

    JsonNode q = get("investigator", "/api/queue?capacityHours=" + capacity);
    double used = 0;
    boolean sawDeferred = false;
    boolean fitAfterDeferral = false;
    for (JsonNode i : q.get("items")) {
      if (i.get("inCapacity").asBoolean()) {
        used += i.get("estHours").asDouble();
        fitAfterDeferral |= sawDeferred;
        assertThat(i.get("deferReason").isNull()).isTrue();
      } else {
        sawDeferred = true;
        assertThat(i.get("deferReason").asString()).isEqualTo("exceeds remaining capacity");
      }
    }
    assertThat(used).isLessThanOrEqualTo(capacity).isEqualTo(q.get("usedHours").asDouble());
    assertThat(q.get("items").get(2).get("inCapacity").asBoolean()).isFalse();
    assertThat(fitAfterDeferral).as("first-fit: a later, smaller case still fits").isTrue();
    get("investigator", "/api/queue?capacityHours=0").get("items")
        .forEach(i -> assertThat(i.get("inCapacity").asBoolean()).isFalse());
  }

  @Test
  void gatewayPackingAgreesWithTheEnginesStoredFunnelAtTheDefaultCapacity() throws Exception {
    long inCap = 0;
    for (JsonNode i : get("investigator", "/api/queue?capacityHours=240").get("items")) {
      if (i.get("inCapacity").asBoolean()) inCap++;
    }
    JsonNode funnel = get("investigator", "/api/funnel");
    assertThat(inCap).isEqualTo(funnel.get("stages").get(3).get("count").asLong());
  }

  @Test
  void filtersAndValidation() throws Exception {
    assertThat(get("investigator", "/api/queue?tier=HIGH").get("items")).hasSize(2);
    assertThat(get("investigator", "/api/queue?scheme=DME").get("items")).hasSize(1);
    assertThat(get("investigator", "/api/queue?scheme=DUP").get("items")).hasSize(2);
    assertThat(get("investigator", "/api/queue?status=CLOSED").get("items")).isEmpty();
    assertThat(get("investigator", "/api/queue?horizon=30").get("horizon").asInt()).isEqualTo(30);
    expectProblem("investigator", HttpMethod.GET, "/api/queue?horizon=45", null, 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.GET, "/api/queue?capacityHours=-5", null, 422, "VALIDATION_FAILED");
    expectProblem("investigator", HttpMethod.GET, "/api/queue?horizon=abc", null, 422, "VALIDATION_FAILED");
  }

  @Test
  void caseDetailAndEvidenceAgreeAndExposeTheGovernedFields() throws Exception {
    String id = caseWith("DME", "MEDIUM");
    JsonNode c = get("investigator", "/api/cases/" + id);
    JsonNode ev = get("investigator", "/api/cases/" + id + "/evidence");
    assertThat(c.get("status").asString()).isEqualTo("NEW");
    assertThat(c.get("packSha256").asString()).isEqualTo(ev.get("packSha256").asString());
    assertThat(c.get("tierReasons")).isNotEmpty();
    assertThat(c.get("outlook").get("available").asBoolean()).isFalse();
    assertThat(ev.get("packVersion").asString()).isEqualTo("pk_v1");
    assertThat(ev.get("permittedActions")).isNotEmpty();
    assertThat(ev.get("evidence").get(0).get("statement").asString()).doesNotContain("{{");
    assertThat(ev.get("limitations").toString()).contains("synthetic");
  }

  @Test
  void claimLinesPageAndFilterByEvidence() throws Exception {
    String id = caseWith("EXC", "HIGH");
    JsonNode all = get("investigator", "/api/cases/" + id + "/claims?size=5");
    assertThat(all.get("items")).hasSize(5);
    int total = all.get("total").asInt();
    assertThat(total).isGreaterThan(5);
    JsonNode next = get("investigator", "/api/cases/" + id + "/claims?size=5&page=1");
    assertThat(next.get("items").get(0).get("claimId").asString()).isNotEqualTo(
        all.get("items").get(0).get("claimId").asString());
    JsonNode one = get("investigator", "/api/cases/" + id + "/claims?evidenceId=E1&size=200");
    one.get("items").forEach(i -> assertThat(i.get("evidenceId").asString()).isEqualTo("E1"));
    assertThat(get("investigator", "/api/cases/" + id + "/claims?evidenceId=E99").get("total").asInt()).isZero();
    JsonNode first = all.get("items").get(0);
    assertThat(first.has("label") && first.has("units") && first.has("paid") && first.has("flagRole")).isTrue();
  }

  @Test
  void unknownCasesAreProblemDocuments() throws Exception {
    for (String suffix : new String[] {"", "/evidence", "/claims", "/reviews"}) {
      expectProblem("investigator", HttpMethod.GET, "/api/cases/CASE-9999" + suffix, null, 404, "NOT_FOUND");
    }
  }

  @Test
  void lowConfidenceItemsAreOnTheMonitorListNotInTheQueue() throws Exception {
    JsonNode m = get("investigator", "/api/monitor");
    assertThat(m.get("items")).hasSize(1);
    assertThat(m.get("items").get(0).get("whatWouldRaiseConfidence")).isNotEmpty();
    String monitored = m.get("items").get(0).get("providerId").asString();
    get("investigator", "/api/queue?capacityHours=1000").get("items").forEach(i ->
        i.get("subjects").forEach(s -> assertThat(s.get("id").asString()).isNotEqualTo(monitored)));
  }
}
