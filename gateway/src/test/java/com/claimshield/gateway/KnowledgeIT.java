package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.engine.EngineClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Second Brain workflow end to end through the real controllers, services, database and audit chain, with the
 * Python engine replaced by a scripted stand-in (the real engine is exercised by npm run e2e:brain).
 */
@Import(KnowledgeIT.FakeEngineConfig.class)
class KnowledgeIT extends GatewayIT {

  static final JsonMapper M = JsonMapper.builder().build();

  /** Records what the gateway sends and answers like the engine would, switchable per test. */
  static class FakeEngine implements EngineClient {
    static final List<String> calls = new ArrayList<>();
    static final List<JsonNode> bodies = new ArrayList<>();
    static volatile boolean down = false;
    static volatile String verdict = "PASS";
    static volatile List<String> conflicts = List.of();
    static volatile int polls = 0;

    @Override
    public JsonNode post(String path, Object body) {
      calls.add(path);
      JsonNode b = M.valueToTree(body);
      bodies.add(b);
      if (down) {
        throw new EngineException(0, "The analysis engine could not be reached (ConnectException).");
      }
      switch (path) {
        case "/internal/exceptions/propose" -> {
          List<String> rules = new ArrayList<>();
          b.get("ruleIds").forEach(r -> rules.add(r.asString()));
          if (rules.contains("R-DUP-01")) {
            throw new EngineException(422, "the case carries hard-fact alerts (R-DUP-01); they cannot be excepted");
          }
          return M.readTree("{\"excId\":\"" + b.get("excId").asString() + "\",\"version\":1,\"scope\":{\"rule_ids\":"
              + M.writeValueAsString(rules) + ",\"specialty_code\":\"PRIMARY_CARE\"},\"condition\":["
              + "{\"field\":\"lines_per_member\",\"op\":\">=\",\"value\":4.8},"
              + "{\"field\":\"lines_per_member\",\"op\":\"<=\",\"value\":6.6},"
              + "{\"field\":\"hard_fact_alert_count\",\"op\":\"==\",\"value\":0}],"
              + "\"effect\":\"DOWNGRADE_TO_MONITOR\",\"supportN\":" + b.get("supportN").asInt() + ",\"flags\":[]}");
        }
        case "/internal/simulate" -> {
          return M.readTree("{\"alertsSuppressed\":12,\"providersAffected\":2,\"casesAffected\":2,"
              + "\"tierShifts\":{\"MEDIUM->MONITOR\":2},\"dollarsNoLongerReviewed\":23446.0,"
              + "\"conflictsWithConfirmed\":[],\"breadthShare\":0.08,\"hardFactTouches\":0,"
              + "\"groundTruthPositivesLost\":0,\"lint\":{\"verdict\":\"" + verdict + "\",\"reasons\":[]}}");
        }
        case "/internal/precedent/check" -> {
          StringBuilder c = new StringBuilder();
          for (String id : conflicts) {
            c.append(c.length() > 0 ? "," : "").append("{\"precedentId\":\"").append(id)
                .append("\",\"similarity\":0.93}");
          }
          return M.readTree("{\"conflicts\":[" + c + "],\"reinforces\":[]}");
        }
        case "/internal/rerun" -> {
          polls = 0;
          return M.readTree("{\"engineJobId\":\"E-1\"}");
        }
        default -> throw new EngineException(404, "unknown " + path);
      }
    }

    @Override
    public JsonNode get(String path) {
      calls.add(path);
      bodies.add(M.createObjectNode());        // keep calls and bodies index-aligned
      if (down) {
        throw new EngineException(0, "The analysis engine could not be reached (ConnectException).");
      }
      if (path.startsWith("/internal/jobs/")) {
        return ++polls < 2 ? M.readTree("{\"status\":\"RUNNING\",\"stage\":\"scoring\"}")
            : M.readTree("{\"status\":\"DONE\",\"stage\":\"done\",\"runId\":\"RUN-001\"}");
      }
      return M.readTree("{\"status\":\"UP\"}");
    }

    @Override
    public boolean healthy() {
      return !down;
    }
  }

  @TestConfiguration
  static class FakeEngineConfig {
    @Bean
    @Primary
    EngineClient fakeEngine() {
      return new FakeEngine();
    }
  }

  @BeforeEach
  void reset() {
    FakeEngine.calls.clear();
    FakeEngine.bodies.clear();
    FakeEngine.down = false;
    FakeEngine.verdict = "PASS";
    FakeEngine.conflicts = List.of();
    jdbc.update("UPDATE wf_job SET status = 'DONE' WHERE status IN ('QUEUED','RUNNING')");
  }

  // ------------------------------------------------------------------------------------------------ helpers
  private String caseOf(String provider) {
    return jdbc.queryForObject("SELECT case_id FROM serving_case WHERE primary_provider_id = ?", String.class,
        provider);
  }

  private static final String RATIONALE = "Recurring treatment centre; its visit pattern is the normal course of care.";

  /** Reject and close the case of a provider as unfounded; returns the new precedent id. */
  private String closeUnfounded(String user, String provider, String rationale) throws Exception {
    String id = caseOf(provider);
    call(user, HttpMethod.POST, "/api/cases/" + id + "/review",
        Map.of("action", "REJECT", "reasonCode", "LEGIT_CLINICAL_PATTERN"), 201);
    JsonNode closed = call(user, HttpMethod.POST, "/api/cases/" + id + "/close",
        Map.of("outcome", "UNFOUNDED", "reasonCode", "LEGIT_CLINICAL_PATTERN", "rationale", rationale), 201);
    return closed.get("precedentId").asString();
  }

  /** Poll a job until the stand-in engine reports it done. */
  private void finish(String jobId) throws Exception {
    for (int i = 0; i < 4; i++) {
      if ("DONE".equals(get("investigator", "/api/jobs/" + jobId).get("status").asString())) {
        return;
      }
    }
  }

  private JsonNode activePrecedent(String provider) throws Exception {
    String pid = closeUnfounded("investigator", provider, RATIONALE);
    call("supervisor", HttpMethod.POST, "/api/precedents/" + pid + "/cosign", Map.of("decision", "CONFIRM"), 200);
    return get("investigator", "/api/precedents?status=ACTIVE");
  }

  // --------------------------------------------------------------------------------- the whole compounding loop
  @Test
  void rejectedCaseBecomesAPrecedentThenAGovernedExceptionThenARerun() throws Exception {
    String id = caseOf("P-0046");
    String pid = closeUnfounded("investigator", "P-0046", RATIONALE);
    assertThat(get("investigator", "/api/precedents?status=PENDING_COSIGN").valueStream()
        .map(p -> p.get("precedentId").asString())).contains(pid);

    // a precedent that is not co-signed cannot become an exception
    expectProblem("investigator", HttpMethod.POST, "/api/exceptions/propose",
        Map.of("caseId", id, "precedentId", pid), 409, "STATE_CONFLICT");

    // the investigator who closed the case cannot co-sign, and neither can an auditor
    expectProblem("investigator", HttpMethod.POST, "/api/precedents/" + pid + "/cosign",
        Map.of("decision", "CONFIRM"), 403, "FORBIDDEN_ROLE");
    expectProblem("auditor", HttpMethod.POST, "/api/precedents/" + pid + "/cosign", Map.of("decision", "CONFIRM"),
        403, "FORBIDDEN_ROLE");

    long audits = auditCount();
    JsonNode cosigned = call("supervisor", HttpMethod.POST, "/api/precedents/" + pid + "/cosign",
        Map.of("decision", "CONFIRM"), 200);
    assertThat(cosigned.get("status").asString()).isEqualTo("ACTIVE");
    assertThat(cosigned.get("check").asString()).isEqualTo("CHECKED");
    assertThat(cosigned.get("rerun").get("kind").asString()).isEqualTo("RERUN");
    assertThat(auditCount("PRECEDENT_COSIGNED")).isPositive();
    assertThat(auditCount()).isGreaterThan(audits);
    JsonNode rerunBody = FakeEngine.bodies.get(FakeEngine.calls.lastIndexOf("/internal/rerun"));
    finish(cosigned.get("rerun").get("jobId").asString());          // a second job cannot start while one runs
    JsonNode live = rerunBody.get("livePrecedents").valueStream()
        .filter(p -> pid.equals(p.get("precedentId").asString())).findFirst().orElseThrow();
    assertThat(live.get("featureVector")).hasSize(12);
    assertThat(live.get("status").asString()).isEqualTo("ACTIVE");
    assertThat(rerunBody.get("livePrecedents").valueStream().map(p -> p.get("status").asString()))
        .containsOnly("ACTIVE");                       // pending or retired precedents are never sent to the engine
    assertThat(rerunBody.get("exceptions").get(0).get("excId").asString()).isEqualTo("EXC-0001");

    JsonNode draft = call("investigator", HttpMethod.POST, "/api/exceptions/propose",
        Map.of("caseId", id, "precedentId", pid), 201);
    String exc = draft.get("excId").asString();
    assertThat(exc).startsWith("EXC-").isNotEqualTo("EXC-0001");
    assertThat(draft.get("status").asString()).isEqualTo("DRAFT");
    assertThat(draft.get("effect").asString()).isEqualTo("DOWNGRADE_TO_MONITOR");
    assertThat(draft.get("scope").get("specialty_code").asString()).isEqualTo("PRIMARY_CARE");
    assertThat(draft.get("reviewDue").asString()).hasSize(10);
    // proposing again from the same precedent returns the same draft instead of piling up duplicates
    assertThat(call("investigator", HttpMethod.POST, "/api/exceptions/propose",
        Map.of("caseId", id, "precedentId", pid), 201).get("reused").asBoolean()).isTrue();

    // it must be simulated before it can be submitted, and approved by someone else
    expectProblem("supervisor", HttpMethod.POST, "/api/exceptions/" + exc + "/submit", null, 409, "STATE_CONFLICT");
    JsonNode sim = call("investigator", HttpMethod.POST, "/api/exceptions/" + exc + "/simulate", null, 200);
    assertThat(sim.get("status").asString()).isEqualTo("SIMULATED");
    assertThat(sim.get("lintVerdict").asString()).isEqualTo("PASS");
    assertThat(sim.get("simulation").get("alertsSuppressed").asInt()).isEqualTo(12);
    JsonNode simBody = FakeEngine.bodies.get(FakeEngine.calls.lastIndexOf("/internal/simulate"));
    assertThat(simBody.get("exceptions")).extracting(e -> e.get("excId").asString()).containsExactly("EXC-0001");
    assertThat(call("investigator", HttpMethod.POST, "/api/exceptions/" + exc + "/explain", null, 200)
        .get("text").asString()).contains("12 alerts").contains("A person must still approve");
    expectProblem("supervisor", HttpMethod.POST, "/api/exceptions/" + exc + "/approve",
        Map.of("decision", "APPROVE"), 403, "FORBIDDEN_ROLE");           // only the governance role approves
    expectProblem("governance", HttpMethod.POST, "/api/exceptions/" + exc + "/approve",
        Map.of("decision", "APPROVE"), 409, "STATE_CONFLICT");           // not submitted yet
    assertThat(call("supervisor", HttpMethod.POST, "/api/exceptions/" + exc + "/submit", null, 200)
        .get("status").asString()).isEqualTo("PENDING_APPROVAL");

    JsonNode approved = call("governance", HttpMethod.POST, "/api/exceptions/" + exc + "/approve",
        Map.of("decision", "APPROVE", "notes", "Recurring treatment is legitimate for this centre type."), 200);
    assertThat(approved.get("status").asString()).isEqualTo("APPROVED");
    assertThat(approved.get("approvedBy").asString()).isEqualTo("governance");
    JsonNode job = approved.get("rerun");
    assertThat(job.get("status").asString()).isIn("RUNNING", "DONE");
    JsonNode approvedBody = FakeEngine.bodies.get(FakeEngine.calls.lastIndexOf("/internal/rerun"));
    assertThat(approvedBody.get("exceptions")).extracting(e -> e.get("excId").asString())
        .containsExactly("EXC-0001", exc);

    // the job finishes; the run is recorded in the audit trail
    String jobId = job.get("jobId").asString();
    JsonNode finished = get("investigator", "/api/jobs/" + jobId);
    for (int i = 0; i < 3 && !"DONE".equals(finished.get("status").asString()); i++) {
      finished = get("investigator", "/api/jobs/" + jobId);
    }
    assertThat(finished.get("status").asString()).isEqualTo("DONE");
    assertThat(finished.get("resultRunId").asString()).isEqualTo("RUN-001");
    assertThat(auditCount("RUN_COMPLETED")).isPositive();
    assertThat(auditCount("EXCEPTION_APPROVED")).isGreaterThanOrEqualTo(2);     // the seed and this one
    assertThat(get("governance", "/api/exceptions?status=APPROVED").valueStream()
        .map(e -> e.get("excId").asString())).contains("EXC-0001", exc);
    assertThat(get("supervisor", "/api/audit/verify").get("ok").asBoolean()).isTrue();
  }

  // ------------------------------------------------------------------------------------------------ guardrails
  @Test
  void aPrecedentNeedsASecondPersonAndACompleteRationale() throws Exception {
    String own = closeUnfounded("supervisor", "P-0016", RATIONALE);
    expectProblem("supervisor", HttpMethod.POST, "/api/precedents/" + own + "/cosign",
        Map.of("decision", "CONFIRM"), 403, "SELF_APPROVAL_FORBIDDEN");

    String loose = closeUnfounded("investigator", "P-0047",
        "The centre looks like a fraud ring according to this note, which is not allowed wording.");
    MvcResultHolder.problem(this, "supervisor", "/api/precedents/" + loose + "/cosign", "PRECEDENT_INCOMPLETE");
    assertThat(get("investigator", "/api/precedents?status=PENDING_COSIGN").valueStream()
        .map(p -> p.get("precedentId").asString())).contains(own, loose);

    JsonNode rejected = call("supervisor", HttpMethod.POST, "/api/precedents/" + loose + "/cosign",
        Map.of("decision", "REJECT"), 200);
    assertThat(rejected.get("status").asString()).isEqualTo("RETIRED");
    expectProblem("supervisor", HttpMethod.POST, "/api/precedents/" + loose + "/cosign",
        Map.of("decision", "CONFIRM"), 409, "STATE_CONFLICT");
    expectProblem("supervisor", HttpMethod.POST, "/api/precedents/" + own + "/cosign",
        Map.of("decision", "MAYBE"), 422, "VALIDATION_FAILED");
  }

  @Test
  void aConflictingPrecedentIsFlaggedAtCosignAndTheLinkIsKept() throws Exception {
    FakeEngine.conflicts = List.of("PRC-0003");
    String pid = closeUnfounded("investigator", "P-0042", RATIONALE);
    JsonNode r = call("supervisor", HttpMethod.POST, "/api/precedents/" + pid + "/cosign",
        Map.of("decision", "CONFIRM"), 200);
    assertThat(r.get("conflicts")).extracting(JsonNode::asString).containsExactly("PRC-0003");
    assertThat(auditCount("PRECEDENT_CONFLICT")).isPositive();
    JsonNode stored = get("investigator", "/api/precedents?status=ACTIVE").valueStream()
        .filter(p -> pid.equals(p.get("precedentId").asString())).findFirst().orElseThrow();
    assertThat(stored.get("conflictsWithId").asString()).isEqualTo("PRC-0003");
  }

  @Test
  void aCaseWithHardFactAlertsCanNeverBecomeAnException() throws Exception {
    // P-0045 also carries duplicate billing (a recorded fact)
    activePrecedent("P-0045");
    String id = caseOf("P-0045");
    String pid = jdbc.queryForObject("SELECT precedent_id FROM wf_precedent WHERE case_id = ?", String.class, id);
    expectProblem("investigator", HttpMethod.POST, "/api/exceptions/propose", Map.of("caseId", id, "precedentId", pid),
        422, "NOT_ELIGIBLE");
    assertThat(FakeEngine.calls).doesNotContain("/internal/exceptions/propose");   // refused before the engine
  }

  @Test
  void aBlockedSimulationCannotBeSubmittedOrApproved() throws Exception {
    activePrecedent("P-0043");
    String id = caseOf("P-0043");
    String pid = jdbc.queryForObject("SELECT precedent_id FROM wf_precedent WHERE case_id = ?", String.class, id);
    String exc = call("investigator", HttpMethod.POST, "/api/exceptions/propose", Map.of("caseId", id,
        "precedentId", pid), 201).get("excId").asString();
    FakeEngine.verdict = "BLOCK";
    assertThat(call("investigator", HttpMethod.POST, "/api/exceptions/" + exc + "/simulate", null, 200)
        .get("lintVerdict").asString()).isEqualTo("BLOCK");
    expectProblem("supervisor", HttpMethod.POST, "/api/exceptions/" + exc + "/submit", null, 409, "LINT_BLOCKED");
    // even if a row somehow reached PENDING_APPROVAL, approval re-checks the verdict
    jdbc.update("UPDATE wf_exception_rule SET status = 'PENDING_APPROVAL' WHERE exc_id = ?", exc);
    expectProblem("governance", HttpMethod.POST, "/api/exceptions/" + exc + "/approve", Map.of("decision", "APPROVE"),
        409, "LINT_BLOCKED");
    JsonNode rej = call("governance", HttpMethod.POST, "/api/exceptions/" + exc + "/approve",
        Map.of("decision", "REJECT", "notes", "Blocked by the simulation."), 200);
    assertThat(rej.get("status").asString()).isEqualTo("REJECTED");
    expectProblem("governance", HttpMethod.POST, "/api/exceptions/" + exc + "/approve", Map.of("decision", "REJECT"),
        409, "STATE_CONFLICT");
  }

  @Test
  void theProposerOfAnExceptionCanNeverApproveIt() throws Exception {
    jdbc.update("INSERT INTO wf_exception_rule (exc_id, version, scope_json, condition_json, effect, support_n, "
        + "flags_json, status, lint_verdict, proposed_by, created_at) VALUES ('EXC-0900', 1, "
        + "'{\"rule_ids\":[\"S-UTL\"],\"specialty_code\":null}', '[]', 'DOWNGRADE_TO_MONITOR', 2, '[]', "
        + "'PENDING_APPROVAL', 'PASS', 'governance', '2026-01-01T00:00:00Z')");
    expectProblem("governance", HttpMethod.POST, "/api/exceptions/EXC-0900/approve", Map.of("decision", "APPROVE"),
        403, "SELF_APPROVAL_FORBIDDEN");
    expectProblem("governance", HttpMethod.POST, "/api/exceptions/EXC-0900/approve", Map.of("decision", "REJECT"),
        403, "SELF_APPROVAL_FORBIDDEN");
    jdbc.update("DELETE FROM wf_exception_rule WHERE exc_id = 'EXC-0900'");
  }

  @Test
  void retiringAnApprovedExceptionReRunsWithoutIt() throws Exception {
    expectProblem("supervisor", HttpMethod.POST, "/api/exceptions/EXC-0001/retire", null, 403, "FORBIDDEN_ROLE");
    JsonNode r = call("governance", HttpMethod.POST, "/api/exceptions/EXC-0001/retire", null, 200);
    assertThat(r.get("status").asString()).isEqualTo("RETIRED");
    JsonNode body = FakeEngine.bodies.get(FakeEngine.calls.lastIndexOf("/internal/rerun"));
    assertThat(body.get("exceptions").valueStream().map(e -> e.get("excId").asString()))
        .doesNotContain("EXC-0001");
    jdbc.update("UPDATE wf_exception_rule SET status = 'APPROVED' WHERE exc_id = 'EXC-0001'");   // restore the seed
  }

  // ------------------------------------------------------------------------------------------------ jobs
  @Test
  void onlyOneAnalysisJobRunsAtATimeAndTheStateMachineIsHonest() throws Exception {
    JsonNode first = call("supervisor", HttpMethod.POST, "/api/runs/rerun", null, 202);
    assertThat(first.get("status").asString()).isEqualTo("RUNNING");
    expectProblem("supervisor", HttpMethod.POST, "/api/runs/rerun", null, 409, "JOB_RUNNING");
    expectProblem("auditor", HttpMethod.POST, "/api/runs/rerun", null, 403, "FORBIDDEN_ROLE");
    String id = first.get("jobId").asString();
    JsonNode second = get("auditor", "/api/jobs/" + id);
    assertThat(second.get("status").asString()).isEqualTo("DONE");
    assertThat(second.get("resultRunId").asString()).isEqualTo("RUN-001");
    assertThat(get("auditor", "/api/jobs").size()).isGreaterThanOrEqualTo(1);
    expectProblem("auditor", HttpMethod.GET, "/api/jobs/J-9999", null, 404, "NOT_FOUND");
  }

  @Test
  void whenTheEngineIsDownWriteActionsExplainItAndReadsKeepWorking() throws Exception {
    String pid = closeUnfounded("investigator", "P-0065", RATIONALE);
    FakeEngine.down = true;
    JsonNode r = call("supervisor", HttpMethod.POST, "/api/precedents/" + pid + "/cosign",
        Map.of("decision", "CONFIRM"), 200);
    assertThat(r.get("status").asString()).isEqualTo("ACTIVE");
    assertThat(r.get("check").asString()).isEqualTo("UNAVAILABLE");
    assertThat(r.get("rerun").get("status").asString()).isEqualTo("FAILED");
    assertThat(r.get("rerun").get("error").asString()).contains("could not be reached");
    expectProblem("investigator", HttpMethod.POST, "/api/exceptions/propose", Map.of("caseId", caseOf("P-0065"),
        "precedentId", pid), 503, "ENGINE_UNAVAILABLE");
    // the stored world is untouched
    assertThat(get("investigator", "/api/queue").get("items")).isNotEmpty();
    assertThat(get("investigator", "/api/knowledge/rules")).isNotEmpty();
    assertThat(auditCount("JOB_FAILED")).isPositive();
  }

  // ------------------------------------------------------------------------------------------ knowledge reads
  @Test
  void theKnowledgeEndpointsServeTheEnginesLibrary() throws Exception {
    assertThat(get("auditor", "/api/knowledge/policies").valueStream().map(p -> p.get("sectionId").asString()))
        .contains("POL-NET-8.1", "POL-TIME-6.1", "POL-BILL-1.1");
    JsonNode rules = get("auditor", "/api/knowledge/rules");
    assertThat(rules.valueStream().map(x -> x.get("ruleId").asString())).contains("G-OWNREF", "T-CUSUM", "S-UPC",
        "R-GEO-01");
    assertThat(get("auditor", "/api/knowledge/glossary").size()).isGreaterThanOrEqualTo(8);
    assertThat(get("auditor", "/api/knowledge/help").size()).isEqualTo(8);
    JsonNode g = get("auditor", "/api/knowledge/graph");
    assertThat(g.get("nodes").size()).isGreaterThan(20);
    assertThat(g.get("edges").valueStream().map(e -> e.get("type").asString())).contains("cites", "excepts",
        "informs");
    assertThat(get("auditor", "/api/knowledge/lint")).isNotNull();
  }

  @Test
  void theLibraryListsSeedAndLivePrecedentsAndCasesCiteTheirMatches() throws Exception {
    JsonNode all = get("investigator", "/api/precedents");
    assertThat(all.valueStream().filter(p -> "SEED".equals(p.get("source").asString())).count())
        .isGreaterThanOrEqualTo(30);
    assertThat(get("investigator", "/api/precedents?scheme=DUP").valueStream()
        .allMatch(p -> "DUP".equals(p.get("schemeType").asString()))).isTrue();
    JsonNode matches = get("investigator", "/api/cases/" + caseOf("P-0002") + "/precedents");
    assertThat(matches).isNotEmpty();
    JsonNode m = matches.get(0);
    assertThat(m.get("similarity").asDouble()).isBetween(0.6, 1.0);
    assertThat(m.get("compare")).hasSize(5);
    assertThat(m.get("rationale").asString()).isNotBlank();
    expectProblem("investigator", HttpMethod.GET, "/api/cases/CASE-9999/precedents", null, 404, "NOT_FOUND");
  }

  @Test
  void theSeedExceptionIsAlreadyApprovedAndVisibleWithItsEffectOnTheCurrentRun() throws Exception {
    JsonNode e = get("governance", "/api/exceptions/EXC-0001");
    assertThat(e.get("status").asString()).isEqualTo("APPROVED");
    assertThat(e.get("scope").get("rule_ids").get(0).asString()).isEqualTo("G-INFRA");
    assertThat(e.get("suppressedInLastRun").asInt()).isPositive();
    expectProblem("governance", HttpMethod.GET, "/api/exceptions/EXC-9999", null, 404, "NOT_FOUND");
    JsonNode c = get("auditor", "/api/compounding");
    assertThat(c.get("current").get("activeExceptions").asInt()).isEqualTo(1);
    assertThat(c.get("current").has("tierChangedByPrecedent")).isTrue();
    assertThat(c.get("runs")).isNotEmpty();
    assertThat(get("auditor", "/api/runs").get(0).get("stages")).hasSize(4);
  }

  @Test
  void theGovernanceMonitorEntriesCiteTheirException() throws Exception {
    JsonNode items = get("investigator", "/api/monitor").get("items");
    List<JsonNode> cited = items.valueStream().filter(i -> i.get("reasons").hasNonNull("exceptionId")).toList();
    assertThat(cited).isNotEmpty();
    assertThat(cited.get(0).get("reasons").get("exceptionId").asString()).isEqualTo("EXC-0001");
    assertThat(cited.get(0).get("reasons").get("tierReasons").get(0).asString()).contains("approved exception");
  }

  /** Small helper so the problem-code assertion reads like the others. */
  static final class MvcResultHolder {
    static void problem(KnowledgeIT t, String user, String url, String code) throws Exception {
      t.expectProblem(user, HttpMethod.POST, url, Map.of("decision", "CONFIRM"), 422, code);
    }
  }
}
