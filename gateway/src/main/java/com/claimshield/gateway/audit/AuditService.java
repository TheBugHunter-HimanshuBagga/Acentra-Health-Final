package com.claimshield.gateway.audit;

import com.claimshield.gateway.config.Json;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Hash-chained, append-only audit log (wf_audit_event; UPDATE/DELETE are blocked by triggers).
 *
 * hash = SHA-256(prev_hash + "\n" + canonical({ts, actor, role, eventType, entityType, entityId, payload})).
 * Hashing the whole record (not just the payload) means editing the actor or timestamp is also detected.
 *
 * append() MUST be called inside Tx.write(...) so the audit row commits or rolls back with the change it records.
 */
@Service
public class AuditService {

  public static final String GENESIS = "0".repeat(64);

  private final JdbcTemplate jdbc;
  private final Json json;
  private final Clock clock;

  public AuditService(JdbcTemplate jdbc, Json json, Clock clock) {
    this.jdbc = jdbc;
    this.json = json;
    this.clock = clock;
  }

  public void append(String actor, String role, String eventType, String entityType, String entityId,
      Map<String, Object> payload) {
    String prev = jdbc.query("SELECT hash FROM wf_audit_event ORDER BY seq DESC LIMIT 1",
        rs -> rs.next() ? rs.getString(1) : GENESIS);
    String ts = Instant.now(clock).toString();
    String payloadJson = json.canonical(payload);
    String hash = hash(prev, ts, actor, role, eventType, entityType, entityId, payloadJson);
    jdbc.update("INSERT INTO wf_audit_event (ts, actor, role, event_type, entity_type, entity_id, payload_json, "
        + "prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)", ts, actor, role, eventType, entityType, entityId,
        payloadJson, prev, hash);
  }

  /** Hash over the exact stored text of every column, so any edit to any of them is detected on verify. */
  private String hash(String prev, String ts, String actor, String role, String eventType, String entityType,
      String entityId, String payloadJson) {
    return sha256(String.join("\n", prev, ts, actor, role, eventType, entityType == null ? "" : entityType,
        entityId == null ? "" : entityId, payloadJson));
  }

  /** Recomputes the whole chain. Returns ok=false and the first bad sequence number on any mismatch. */
  public Map<String, Object> verify() {
    List<Map<String, Object>> rows = jdbc.queryForList(
        "SELECT seq, ts, actor, role, event_type, entity_type, entity_id, payload_json, prev_hash, hash "
            + "FROM wf_audit_event ORDER BY seq");
    String prev = GENESIS;
    long checked = 0;
    Long lastSeq = null;
    for (Map<String, Object> r : rows) {
      long seq = ((Number) r.get("seq")).longValue();
      String expected = hash(prev, (String) r.get("ts"), (String) r.get("actor"), (String) r.get("role"),
          (String) r.get("event_type"), (String) r.get("entity_type"), (String) r.get("entity_id"),
          (String) r.get("payload_json"));
      if (!prev.equals(r.get("prev_hash")) || !expected.equals(r.get("hash"))) {
        Map<String, Object> bad = new LinkedHashMap<>();
        bad.put("ok", false);
        bad.put("checked", checked);
        bad.put("lastSeq", lastSeq);
        bad.put("firstBadSeq", seq);
        return bad;
      }
      prev = (String) r.get("hash");
      lastSeq = seq;
      checked++;
    }
    Map<String, Object> ok = new LinkedHashMap<>();
    ok.put("ok", true);
    ok.put("checked", checked);
    ok.put("lastSeq", lastSeq);
    ok.put("firstBadSeq", null);
    return ok;
  }

  public Map<String, Object> list(String entityType, String entityId, String type, Long cursor, int limit) {
    int n = Math.max(1, Math.min(limit, 200));
    StringBuilder sql = new StringBuilder("SELECT seq, ts, actor, role, event_type, entity_type, entity_id, "
        + "payload_json, prev_hash, hash FROM wf_audit_event WHERE 1=1");
    List<Object> args = new ArrayList<>();
    if (entityType != null && !entityType.isBlank()) { sql.append(" AND entity_type = ?"); args.add(entityType); }
    if (entityId != null && !entityId.isBlank()) { sql.append(" AND entity_id = ?"); args.add(entityId); }
    if (type != null && !type.isBlank()) { sql.append(" AND event_type = ?"); args.add(type); }
    if (cursor != null) { sql.append(" AND seq < ?"); args.add(cursor); }
    sql.append(" ORDER BY seq DESC LIMIT ?");
    args.add(n + 1);
    List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
    boolean more = rows.size() > n;
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, Object> r : rows.subList(0, Math.min(n, rows.size()))) {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("seq", r.get("seq"));
      item.put("ts", r.get("ts"));
      item.put("actor", r.get("actor"));
      item.put("role", r.get("role"));
      item.put("eventType", r.get("event_type"));
      item.put("entityType", r.get("entity_type"));
      item.put("entityId", r.get("entity_id"));
      item.put("payload", json.tree((String) r.get("payload_json")));
      item.put("prevHash", r.get("prev_hash"));
      item.put("hash", r.get("hash"));
      items.add(item);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("items", items);
    out.put("nextCursor", more ? items.get(items.size() - 1).get("seq") : null);
    return out;
  }

  static String sha256(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
