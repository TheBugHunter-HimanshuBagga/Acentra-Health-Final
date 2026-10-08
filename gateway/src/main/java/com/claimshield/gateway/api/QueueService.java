package com.claimshield.gateway.api;

import com.claimshield.gateway.config.Json;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * Builds the SIU queue: rank by the stored utility for the chosen horizon, then fill investigator capacity
 * first-fit (a smaller later case can still fit). Mirrors engine/claimshield/cases/score.py::pack_first_fit.
 */
@Service
public class QueueService {

  public static final Set<Integer> HORIZONS = Set.of(30, 60, 90);

  public record Item(String caseId, double utility, double hours) {}

  /** Optional filters beyond tier, scheme, specialty and status. Every field may be null. */
  public record Extra(String confidence, Double minEvidence, Integer minMembers, Double minExposure,
      Integer minRegions, String provider, Boolean network, String q, Double minRisk) {
    static final Extra NONE = new Extra(null, null, null, null, null, null, null, null, null);
  }

  private final ServingRepository serving;
  private final JdbcTemplate jdbc;
  private final Json json;

  public QueueService(ServingRepository serving, JdbcTemplate jdbc, Json json) {
    this.serving = serving;
    this.jdbc = jdbc;
    this.json = json;
  }

  /** Pure and unit-tested. Returns caseId -> fits. */
  public static Map<String, Boolean> pack(List<Item> items, double capacityHours) {
    List<Item> ranked = new ArrayList<>(items);
    ranked.sort(Comparator.comparingDouble(Item::utility).reversed().thenComparing(Item::caseId));
    double remaining = capacityHours;
    Map<String, Boolean> out = new LinkedHashMap<>();
    for (Item it : ranked) {
      if (it.hours() <= remaining) {
        out.put(it.caseId(), true);
        remaining -= it.hours();
      } else {
        out.put(it.caseId(), false);
      }
    }
    return out;
  }

  public Map<String, Object> queue(int horizon, double capacityHours, String tier, String scheme, String specialty,
      String status) {
    return queue(horizon, capacityHours, tier, scheme, specialty, status, Extra.NONE);
  }

  public Map<String, Object> queue(int horizon, double capacityHours, String tier, String scheme, String specialty,
      String status, Extra x) {
    if (!HORIZONS.contains(horizon)) {
      throw ApiException.invalid("horizon", "must be 30, 60 or 90");
    }
    if (capacityHours < 0 || Double.isNaN(capacityHours)) {
      throw ApiException.invalid("capacityHours", "must be zero or more");
    }
    String runId = serving.requireRunId();
    List<Map<String, Object>> rows = serving.cases(runId);
    Map<String, Map<String, Object>> wf = new LinkedHashMap<>();
    jdbc.queryForList("SELECT case_id, status, assigned_to FROM wf_case_state").forEach(r -> wf.put((String) r.get("case_id"), r));

    String utilCol = "utility_" + horizon;      // whitelisted by HORIZONS above
    String riskCol = "risk_" + horizon;
    List<Item> items = new ArrayList<>();
    for (Map<String, Object> r : rows) {
      items.add(new Item((String) r.get("case_id"), ((Number) r.get(utilCol)).doubleValue(),
          ((Number) r.get("est_hours")).doubleValue()));
    }
    Map<String, Boolean> fits = pack(items, capacityHours);
    List<Map<String, Object>> ranked = new ArrayList<>(rows);
    ranked.sort(Comparator.comparingDouble((Map<String, Object> r) -> ((Number) r.get(utilCol)).doubleValue())
        .reversed().thenComparing(r -> (String) r.get("case_id")));

    List<Map<String, Object>> out = new ArrayList<>();
    double used = 0;
    int rank = 0;
    for (Map<String, Object> r : ranked) {
      rank++;
      String id = (String) r.get("case_id");
      boolean in = fits.get(id);
      double hours = ((Number) r.get("est_hours")).doubleValue();
      if (in) {
        used += hours;
      }
      JsonNode header = json.tree((String) r.get("header_json"));
      String caseStatus = wf.containsKey(id) ? (String) wf.get(id).get("status") : "NEW";
      List<String> hyps = new ArrayList<>();
      header.get("hypotheses").forEach(h -> hyps.add(h.get("code").asString()));
      if (tier != null && !tier.isBlank() && !tier.equals(r.get("tier"))) continue;
      if (scheme != null && !scheme.isBlank() && !hyps.contains(scheme)) continue;
      if (specialty != null && !specialty.isBlank() && !specialty.equals(r.get("specialty_code"))) continue;
      if (status != null && !status.isBlank() && !status.equals(caseStatus)) continue;
      JsonNode conf = header.path("confidence");
      JsonNode imp = header.path("impact");
      if (x.confidence() != null && !x.confidence().isBlank() && !x.confidence().equals(conf.path("level").asString(""))) continue;
      if (x.minEvidence() != null && conf.path("evidenceStrength").asDouble(0) < x.minEvidence()) continue;
      if (x.minMembers() != null && imp.path("members").asInt(0) < x.minMembers()) continue;
      if (x.minExposure() != null && imp.path("exposureExact").asDouble(0) + imp.path("exposureEstimated").asDouble(0) < x.minExposure()) continue;
      if (x.minRegions() != null && imp.path("regions").asInt(0) < x.minRegions()) continue;
      if (x.minRisk() != null && ((Number) r.get(riskCol)).doubleValue() < x.minRisk()) continue;
      if (x.network() != null && x.network() != header.path("ruleIds").valueStream().anyMatch(v -> v.asString().startsWith("G-"))) continue;
      if (x.provider() != null && !x.provider().isBlank() && header.get("subjects").valueStream()
          .noneMatch(s -> s.path("id").asString("").toLowerCase().contains(x.provider().toLowerCase()))) continue;
      if (x.q() != null && !x.q().isBlank()) {
        String hay = (id + " " + caseStatus + " " + hyps + " " + header.get("subjects")).toLowerCase();
        if (!hay.contains(x.q().toLowerCase())) continue;
      }

      Map<String, Object> factors = new LinkedHashMap<>();
      factors.put("risk", ((Number) r.get(riskCol)).doubleValue());
      factors.put("dollarScore", header.get("factors").get("dollarScore").asDouble());
      factors.put("memberImpact", ((Number) r.get("member_impact")).doubleValue());
      factors.put("severity", ((Number) r.get("severity")).doubleValue());
      factors.put("evidenceStrength", ((Number) r.get("evidence_strength")).doubleValue());
      Map<String, Object> dollars = new LinkedHashMap<>();
      dollars.put("exact", ((Number) r.get("dollars_exact")).doubleValue());
      dollars.put("estimated", ((Number) r.get("dollars_est")).doubleValue());
      dollars.put("basis", r.get("dollars_basis"));

      Map<String, Object> item = new LinkedHashMap<>();
      item.put("caseId", id);
      item.put("rank", rank);
      item.put("tier", r.get("tier"));
      item.put("status", caseStatus);
      item.put("subjects", header.get("subjects"));
      item.put("hypotheses", hyps);
      item.put("factors", factors);
      item.put("utility", ((Number) r.get(utilCol)).doubleValue());
      item.put("dollars", dollars);
      item.put("trend", r.get("trend"));
      item.put("estHours", hours);
      item.put("inCapacity", in);
      item.put("deferReason", in ? null : "exceeds remaining capacity");
      item.put("assignedTo", wf.containsKey(id) ? wf.get(id).get("assigned_to") : null);
      item.put("confidence", conf.isMissingNode() ? null : conf);
      item.put("impact", imp.isMissingNode() ? null : imp);
      item.put("ruleIds", header.get("ruleIds"));
      out.add(item);
    }
    Map<String, Object> resp = new LinkedHashMap<>();
    resp.put("runId", runId);
    resp.put("horizon", horizon);
    resp.put("capacityHours", capacityHours);
    resp.put("usedHours", used);
    resp.put("items", out);
    return resp;
  }
}
