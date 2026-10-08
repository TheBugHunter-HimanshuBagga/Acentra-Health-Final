package com.claimshield.gateway.knowledge;

import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.config.Tx;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Starting knowledge: the shared-building exception EXC-0001 is approved before the first screen is drawn, so the
 * first run already shows an exception being applied. It mirrors the engine's seed and is audited like any approval.
 */
@Component
public class KnowledgeSeeder implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(KnowledgeSeeder.class);

  private final JdbcTemplate jdbc;
  private final AuditService audit;
  private final Tx tx;
  private final Clock clock;

  public KnowledgeSeeder(JdbcTemplate jdbc, AuditService audit, Tx tx, Clock clock) {
    this.jdbc = jdbc;
    this.audit = audit;
    this.tx = tx;
    this.clock = clock;
  }

  @Override
  public void run(ApplicationArguments args) {
    Long n = jdbc.queryForObject("SELECT COUNT(*) FROM wf_exception_rule WHERE exc_id = 'EXC-0001'", Long.class);
    if (n != null && n > 0) {
      return;
    }
    tx.write(() -> {
      String now = Instant.now(clock).toString();
      jdbc.update("INSERT INTO wf_exception_rule (exc_id, version, scope_json, condition_json, effect, "
              + "source_precedent_id, support_n, flags_json, status, lint_verdict, proposed_by, approved_by, "
              + "approved_at, approval_notes, review_due, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          "EXC-0001", 1, "{\"rule_ids\":[\"G-INFRA\"],\"specialty_code\":null}",
          "[{\"field\":\"building_unrelated_owner_count\",\"op\":\">=\",\"value\":3},"
              + "{\"field\":\"referral_top3_share\",\"op\":\"<=\",\"value\":0.5},"
              + "{\"field\":\"hard_fact_alert_count\",\"op\":\"==\",\"value\":0}]",
          "DOWNGRADE_TO_MONITOR", null, 2, "[]", "APPROVED", "PASS", "system", "system", now,
          "Seed: providers that merely share a building are not a finding.", "2026-01-01", now);
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("seed", true);
      payload.put("effect", "DOWNGRADE_TO_MONITOR");
      audit.append("system", "SYSTEM", "EXCEPTION_APPROVED", "exception", "EXC-0001", payload);
    });
    log.info("Seeded the approved exception EXC-0001");
  }
}
