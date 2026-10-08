package com.claimshield.gateway.api;

import com.claimshield.gateway.config.Json;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.node.ObjectNode;

/** Read endpoints. Stored JSON documents are passed through verbatim; nothing here computes a score. */
@RestController
@RequestMapping("/api")
public class ReadController {

  private final ServingRepository serving;
  private final QueueService queue;
  private final JdbcTemplate jdbc;
  private final Json json;

  public ReadController(ServingRepository serving, QueueService queue, JdbcTemplate jdbc, Json json) {
    this.serving = serving;
    this.queue = queue;
    this.jdbc = jdbc;
    this.json = json;
  }

  private static ResponseEntity<String> raw(String jsonText) {
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(jsonText);
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("status", "UP");
    out.put("run", serving.currentRunId().orElse(null));
    out.put("engine", "NOT_CONFIGURED");     // the engine link arrives with the re-run feature
    out.put("llm", "TEMPLATE");
    out.put("voice", "OFF");
    return out;
  }

  @GetMapping("/runs/current")
  public Map<String, Object> currentRun() {
    Map<String, Object> r = serving.run(serving.requireRunId());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("runId", r.get("run_id"));
    out.put("asof", r.get("asof"));
    out.put("createdAt", r.get("created_at"));
    out.put("status", r.get("status"));
    out.put("exceptionSet", json.tree((String) r.get("exception_set_json")));
    out.put("precedentCount", r.get("precedent_count"));
    return out;
  }

  @GetMapping("/funnel")
  public ResponseEntity<String> funnel() {
    return raw(serving.singleJson("serving_funnel", "funnel_json", serving.requireRunId()));
  }

  @GetMapping("/dashboard")
  public ResponseEntity<String> dashboard() {
    return raw(serving.singleJson("serving_dashboard", "dashboard_json", serving.requireRunId()));
  }

  @GetMapping("/eval")
  public ResponseEntity<String> eval() {
    return raw(serving.singleJson("serving_eval", "eval_json", serving.requireRunId()));
  }

  @GetMapping("/queue")
  public Map<String, Object> queue(@RequestParam(defaultValue = "90") int horizon,
      @RequestParam(defaultValue = "240") double capacityHours, @RequestParam(required = false) String tier,
      @RequestParam(required = false) String scheme, @RequestParam(required = false) String specialty,
      @RequestParam(required = false) String status) {
    return queue.queue(horizon, capacityHours, tier, scheme, specialty, status);
  }

  @GetMapping("/monitor")
  public Map<String, Object> monitor() {
    String run = serving.requireRunId();
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT monitor_id, provider_id, reasons_json, raise_json FROM serving_monitor_item WHERE run_id = ? "
            + "ORDER BY monitor_id", run)) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("monitorId", r.get("monitor_id"));
      m.put("providerId", r.get("provider_id"));
      m.put("reasons", json.tree((String) r.get("reasons_json")));
      m.put("whatWouldRaiseConfidence", json.tree((String) r.get("raise_json")));
      items.add(m);
    }
    return Map.of("runId", run, "items", items);
  }

  @GetMapping("/cases/{caseId}")
  public ResponseEntity<String> caseDetail(@PathVariable String caseId) {
    String run = serving.requireRunId();
    Map<String, Object> row = serving.caseRow(run, caseId);
    ObjectNode header = (ObjectNode) json.tree((String) row.get("header_json"));
    List<Map<String, Object>> wf = jdbc.queryForList(
        "SELECT status, assigned_to, outcome FROM wf_case_state WHERE case_id = ?", caseId);
    header.put("status", wf.isEmpty() ? "NEW" : (String) wf.get(0).get("status"));
    header.put("assignedTo", wf.isEmpty() ? null : (String) wf.get(0).get("assigned_to"));
    header.put("outcome", wf.isEmpty() ? null : (String) wf.get(0).get("outcome"));
    // a brief is only current if it was built from this exact pack
    Long briefs = jdbc.queryForObject("SELECT COUNT(*) FROM wf_brief WHERE case_id = ? AND pack_sha256 = ?",
        Long.class, caseId, row.get("pack_sha256") != null ? row.get("pack_sha256")
            : serving.packRow(run, caseId).get("pack_sha256"));
    header.put("briefAvailable", briefs != null && briefs > 0);
    return raw(json.write(header));
  }

  @GetMapping("/cases/{caseId}/evidence")
  public ResponseEntity<String> evidence(@PathVariable String caseId) {
    return raw((String) serving.packRow(serving.requireRunId(), caseId).get("pack_json"));
  }

  @GetMapping("/cases/{caseId}/claims")
  public Map<String, Object> claims(@PathVariable String caseId, @RequestParam(required = false) String evidenceId,
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size) {
    String run = serving.requireRunId();
    serving.caseRow(run, caseId);
    int s = Math.max(1, Math.min(size, 200));
    int p = Math.max(0, page);
    boolean filter = evidenceId != null && !evidenceId.isBlank();
    String where = " WHERE run_id = ? AND case_id = ?" + (filter ? " AND evidence_id = ?" : "");
    Object[] args = filter ? new Object[] {run, caseId, evidenceId} : new Object[] {run, caseId};
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM serving_case_line" + where, Long.class, args);
    Object[] pageArgs = java.util.Arrays.copyOf(args, args.length + 2);
    pageArgs[args.length] = s;
    pageArgs[args.length + 1] = (long) p * s;
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList(
        "SELECT evidence_id, claim_id, line_no, member_id, provider_id, service_dt, hcpcs, hcpcs_label, units, "
            + "paid_amt, flag_role FROM serving_case_line" + where
            + " ORDER BY paid_amt DESC, claim_id, line_no LIMIT ? OFFSET ?", pageArgs)) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("evidenceId", r.get("evidence_id"));
      m.put("claimId", r.get("claim_id"));
      m.put("lineNo", r.get("line_no"));
      m.put("memberId", r.get("member_id"));
      m.put("providerId", r.get("provider_id"));
      m.put("serviceDt", r.get("service_dt"));
      m.put("hcpcs", r.get("hcpcs"));
      m.put("label", r.get("hcpcs_label"));
      m.put("units", r.get("units"));
      m.put("paid", r.get("paid_amt"));
      m.put("flagRole", r.get("flag_role"));
      items.add(m);
    }
    return Map.of("total", total == null ? 0 : total, "page", p, "size", s, "items", items);
  }
}
