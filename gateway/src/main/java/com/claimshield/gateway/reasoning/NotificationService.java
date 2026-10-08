package com.claimshield.gateway.reasoning;

import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.config.Tx;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Per-person notifications that wait for the person to sign in. They are written when something needs someone (a
 * specialist is requested, a specialist joined, a message arrived) and stay unread until the person reads them, so a
 * colleague who signs in later still sees them. Repeated events for the same conversation are folded into one entry
 * with a count rather than flooding the bell. Notification text never contains message text.
 */
@Service
public class NotificationService {

  private final JdbcTemplate jdbc;
  private final Tx tx;
  private final Clock clock;

  public NotificationService(JdbcTemplate jdbc, Tx tx, Clock clock) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.clock = clock;
  }

  /** Call inside an existing write transaction. Folds into an unread entry of the same kind and reference. */
  public void notify(String username, String kind, String title, String body, String link, String ref) {
    List<Map<String, Object>> open = jdbc.queryForList("SELECT notif_id, count FROM wf_notification WHERE username = ? AND "
        + "kind = ? AND ref = ? AND read_at IS NULL", username, kind, ref);
    String now = Instant.now(clock).toString();
    if (!open.isEmpty()) {
      jdbc.update("UPDATE wf_notification SET count = count + 1, created_at = ?, title = ?, body = ? WHERE notif_id = ?", now,
          title, body, open.get(0).get("notif_id"));
      return;
    }
    jdbc.update("INSERT INTO wf_notification (notif_id, username, kind, title, body, link, ref, count, created_at) VALUES "
        + "(?,?,?,?,?,?,?,1,?)", "NT-" + UUID.randomUUID().toString().substring(0, 10), username, kind, title, body, link, ref, now);
  }

  /** Everyone with one of the roles, except the person who caused it. */
  public void notifyRoles(List<String> roles, String except, String kind, String title, String body, String link, String ref) {
    for (String role : roles) {
      for (String name : jdbc.queryForList("SELECT username FROM wf_user WHERE role = ?", String.class, role)) {
        if (!name.equals(except)) {
          notify(name, kind, title, body, link, ref);
        }
      }
    }
  }

  public Map<String, Object> list(AppUser u) {
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList("SELECT notif_id, kind, title, body, link, ref, count, created_at, read_at "
        + "FROM wf_notification WHERE username = ? ORDER BY created_at DESC LIMIT 30", u.username())) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", r.get("notif_id"));
      m.put("kind", r.get("kind"));
      m.put("title", r.get("title"));
      m.put("body", r.get("body"));
      m.put("link", r.get("link"));
      m.put("count", ((Number) r.get("count")).intValue());
      m.put("createdAt", r.get("created_at"));
      m.put("read", r.get("read_at") != null);
      items.add(m);
    }
    Long unread = jdbc.queryForObject("SELECT COUNT(*) FROM wf_notification WHERE username = ? AND read_at IS NULL", Long.class,
        u.username());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("unread", unread == null ? 0 : unread);
    out.put("items", items);
    return out;
  }

  public Map<String, Object> markRead(AppUser u, List<String> ids, boolean all) {
    String now = Instant.now(clock).toString();
    tx.write(() -> {
      if (all) {
        jdbc.update("UPDATE wf_notification SET read_at = ? WHERE username = ? AND read_at IS NULL", now, u.username());
      } else if (ids != null) {
        for (String id : ids) {
          jdbc.update("UPDATE wf_notification SET read_at = ? WHERE notif_id = ? AND username = ? AND read_at IS NULL", now, id,
              u.username());
        }
      }
    });
    return list(u);
  }
}
