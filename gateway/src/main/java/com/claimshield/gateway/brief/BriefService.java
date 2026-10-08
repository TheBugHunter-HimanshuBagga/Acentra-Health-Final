package com.claimshield.gateway.brief;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import com.claimshield.gateway.config.Json;
import com.claimshield.gateway.config.Tx;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Creates, stores and serves investigation briefs. Failure ladder (docs, Second Brain section 20):
 * L0 validated model brief, L1 one retry, L2 deterministic template (badge TEMPLATE_FALLBACK), L3 unavailable.
 * Briefs are cached per (case, pack hash); a new engine run with a different pack makes the old brief stale.
 */
@Service
public class BriefService {

  private final JdbcTemplate jdbc;
  private final ServingRepository serving;
  private final AuditService audit;
  private final Tx tx;
  private final Json json;
  private final Clock clock;
  private final BriefTemplate template;
  private final BriefValidator validator;
  private final BriefRenderer renderer;
  private final ObjectProvider<BriefCandidateSource> llm;

  public BriefService(JdbcTemplate jdbc, ServingRepository serving, AuditService audit, Tx tx, Json json, Clock clock,
      BriefTemplate template, BriefValidator validator, BriefRenderer renderer,
      ObjectProvider<BriefCandidateSource> llm) {
    this.jdbc = jdbc;
    this.serving = serving;
    this.audit = audit;
    this.tx = tx;
    this.json = json;
    this.clock = clock;
    this.template = template;
    this.validator = validator;
    this.renderer = renderer;
    this.llm = llm;
  }

  /** The brief for the case's CURRENT pack, or empty (204) when none exists or the stored one is stale. */
  public Optional<Map<String, Object>> latest(String caseId) {
    String run = serving.requireRunId();
    serving.caseRow(run, caseId);
    String sha = (String) serving.packRow(run, caseId).get("pack_sha256");
    return find(caseId, sha);
  }

  public Map<String, Object> generate(AppUser u, String caseId) {
    if (u.role() != Role.INVESTIGATOR && u.role() != Role.SUPERVISOR) {
      throw ApiException.forbiddenRole("The " + u.role() + " role cannot generate a brief.");
    }
    String run = serving.requireRunId();
    serving.caseRow(run, caseId);
    Map<String, Object> packRow = serving.packRow(run, caseId);
    String sha = (String) packRow.get("pack_sha256");
    Optional<Map<String, Object>> cached = find(caseId, sha);
    if (cached.isPresent()) {
      return cached.get();
    }
    JsonNode pack = json.tree((String) packRow.get("pack_json"));

    // L0/L1: a model brief, if a source exists, validated, with one retry. L2: the deterministic template.
    ObjectNode chosen = null;
    BriefCandidateSource.Candidate used = null;
    BriefValidator.Result chosenResult = null;
    String fallbackReason = null;
    int retries = 0;
    List<Map<String, Object>> rejected = new ArrayList<>();
    BriefCandidateSource source = llm.getIfAvailable();
    for (int attempt = 1; source != null && attempt <= 2 && chosen == null; attempt++) {
      Optional<BriefCandidateSource.Candidate> c = source.generate(caseId, pack, attempt);
      if (c.isEmpty()) {
        fallbackReason = "model unavailable";
        break;
      }
      BriefValidator.Result r = validator.validate(c.get().output(), pack, c.get().stopReason());
      retries = attempt - 1;
      if (r.passed()) {
        chosen = (ObjectNode) c.get().output();
        used = c.get();
        chosenResult = r;
      } else {
        fallbackReason = "validation failed: " + String.join(",", r.blockerIds());
        rejected.add(rejection(attempt, r));
      }
    }
    String mode = "LLM";
    String badge = "VALIDATED";
    if (chosen == null) {
      mode = "TEMPLATE";
      chosen = template.build(pack);
      chosenResult = validator.validate(chosen, pack, "template");
      if (!chosenResult.passed()) {
        // L3: even the deterministic brief is invalid, so the pack itself is unusable for a brief
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "BRIEF_UNAVAILABLE", "Brief unavailable",
            "No valid brief could be built for " + caseId + " (" + String.join(",", chosenResult.blockerIds())
                + "). The evidence pack is still available.");
      }
      if (source != null) {
        badge = "TEMPLATE_FALLBACK";
      }
    }
    ObjectNode rendered = renderer.render(chosen, pack);
    Map<String, Object> validation = new LinkedHashMap<>();
    validation.put("passed", true);
    validation.put("retries", retries);
    validation.put("fallbackReason", fallbackReason);
    validation.put("badge", badge);
    validation.put("checks", checksOf(chosenResult));
    validation.put("rejectedAttempts", rejected);

    final String fMode = mode;
    final String fBadge = badge;
    final BriefCandidateSource.Candidate fUsed = used;
    final ObjectNode fChosen = chosen;
    final String fReason = fallbackReason;
    return tx.write(() -> {
      Optional<Map<String, Object>> again = find(caseId, sha);   // lost a race: return the stored one
      if (again.isPresent()) {
        return again.get();
      }
      Long n = jdbc.queryForObject("SELECT COUNT(*) FROM wf_brief", Long.class);
      String id = String.format("BRF-%05d", (n == null ? 0 : n) + 1);
      jdbc.update("INSERT INTO wf_brief (brief_id, case_id, pack_sha256, mode, model, prompt_sha256, response_sha256, "
          + "output_json, rendered_json, validation_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", id, caseId, sha,
          fMode, fUsed == null ? null : fUsed.model(), fUsed == null ? null : fUsed.promptSha256(),
          fUsed == null ? null : fUsed.responseSha256(), json.write(fChosen), json.write(rendered),
          json.write(validation), Instant.now(clock).toString());
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("caseId", caseId);
      payload.put("briefId", id);
      payload.put("mode", fMode);
      payload.put("badge", fBadge);
      payload.put("packSha256", sha);
      payload.put("fallbackReason", fReason);
      audit.append(u.username(), u.role().name(), "BRIEF_GENERATED", "CASE", caseId, payload);
      return find(caseId, sha).orElseThrow();
    });
  }

  private Optional<Map<String, Object>> find(String caseId, String sha) {
    return jdbc.queryForList("SELECT * FROM wf_brief WHERE case_id = ? AND pack_sha256 = ?", caseId, sha).stream()
        .findFirst().map(this::view);
  }

  private Map<String, Object> view(Map<String, Object> r) {
    JsonNode validation = json.tree((String) r.get("validation_json"));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("briefId", r.get("brief_id"));
    m.put("caseId", r.get("case_id"));
    m.put("mode", r.get("mode"));
    m.put("badge", validation.get("badge").asString());
    m.put("generatedAt", r.get("created_at"));
    m.put("packSha256", r.get("pack_sha256"));
    m.put("model", r.get("model"));
    m.put("sections", json.tree((String) r.get("rendered_json")));
    m.put("output", json.tree((String) r.get("output_json")));
    m.put("validation", validation);
    return m;
  }

  /**
   * What is kept about a rejected model brief: which rules failed and in which fields. The validator's detail
   * strings quote the offending text (a fabricated amount, a forbidden word), so they are deliberately NOT stored
   * or returned: a rejected brief's content must not reach a user through the diagnostics either.
   */
  private static Map<String, Object> rejection(int attempt, BriefValidator.Result r) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("attempt", attempt);
    m.put("blockers", r.blockerIds());
    List<Map<String, Object>> failed = new ArrayList<>();
    for (BriefValidator.Check c : r.checks()) {
      if (c.failed()) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("id", c.id());
        f.put("name", c.name());
        f.put("fields", c.details().stream().map(d -> d.split(" ", 2)[0]).distinct().toList());
        failed.add(f);
      }
    }
    m.put("failedChecks", failed);
    return m;
  }

  static List<Map<String, Object>> checksOf(BriefValidator.Result r) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (BriefValidator.Check c : r.checks()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", c.id());
      m.put("name", c.name());
      m.put("severity", c.severity());
      m.put("status", c.status());
      m.put("details", c.details());
      out.add(m);
    }
    return out;
  }
}
