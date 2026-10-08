package com.claimshield.gateway.api;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Read-only access to the engine-owned serving_* tables. This class never writes. */
@Repository
public class ServingRepository {

  private final JdbcTemplate jdbc;

  public ServingRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Optional<String> currentRunId() {
    List<String> r = jdbc.queryForList("SELECT run_id FROM serving_current_run WHERE id = 1", String.class);
    return r.stream().findFirst();
  }

  public String requireRunId() {
    return currentRunId().orElseThrow(() -> ApiException.notFound("A published run"));
  }

  public Map<String, Object> run(String runId) {
    return jdbc.queryForList("SELECT run_id, asof, created_at, status, precedent_count, exception_set_json "
        + "FROM serving_run WHERE run_id = ?", runId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Run " + runId));
  }

  public List<Map<String, Object>> cases(String runId) {
    return jdbc.queryForList("SELECT * FROM serving_case WHERE run_id = ?", runId);
  }

  public Map<String, Object> caseRow(String runId, String caseId) {
    return jdbc.queryForList("SELECT * FROM serving_case WHERE run_id = ? AND case_id = ?", runId, caseId).stream()
        .findFirst().orElseThrow(() -> ApiException.notFound("Case " + caseId));
  }

  public Map<String, Object> packRow(String runId, String caseId) {
    return jdbc.queryForList("SELECT pack_json, pack_sha256 FROM serving_evidence_pack WHERE run_id = ? AND "
        + "case_id = ?", runId, caseId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Evidence pack for " + caseId));
  }

  /** One JSON document stored per case (graph, timeline). Table and column are fixed strings from this codebase. */
  public String caseJson(String table, String column, String runId, String caseId) {
    return jdbc.queryForList("SELECT " + column + " FROM " + table + " WHERE run_id = ? AND case_id = ?",
        String.class, runId, caseId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound(table.replace("serving_", "") + " for " + caseId));
  }

  public String singleJson(String table, String column, String runId) {
    // table and column are fixed strings from this codebase, never user input
    return jdbc.queryForList("SELECT " + column + " FROM " + table + " WHERE run_id = ?", String.class, runId)
        .stream().findFirst().orElseThrow(() -> ApiException.notFound("Run data " + table));
  }
}
