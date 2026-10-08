package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/** Proves wf_schema.sql is applied at startup and the audit log is append-only. */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:sqlite:target/test-app.db?journal_mode=WAL&busy_timeout=5000&foreign_keys=on"
})
class SchemaInitTest {

  @Autowired JdbcTemplate jdbc;

  @Test
  void workflowTablesExist() {
    Integer n = jdbc.queryForObject(
        "select count(*) from sqlite_master where type='table' and name like 'wf_%'", Integer.class);
    assertThat(n).isEqualTo(16);
  }

  @Test
  void auditLogIsAppendOnly() {
    jdbc.update("insert into wf_audit_event(ts,actor,role,event_type,payload_json,prev_hash,hash)"
        + " values('2026-01-01T00:00:00Z','test','AUDITOR','TEST','{}','0','h')");
    assertThatThrownBy(() -> jdbc.update("update wf_audit_event set actor='x'"))
        .hasMessageContaining("append-only");
    assertThatThrownBy(() -> jdbc.update("delete from wf_audit_event"))
        .hasMessageContaining("append-only");
  }
}
