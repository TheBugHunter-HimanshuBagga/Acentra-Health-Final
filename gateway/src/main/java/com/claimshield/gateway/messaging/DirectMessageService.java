package com.claimshield.gateway.messaging;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.api.ServingRepository;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import com.claimshield.gateway.config.Tx;
import com.claimshield.gateway.reasoning.NotificationService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Direct messages between two people, separate from the assistant. A conversation belongs to exactly two users, any
 * message can carry a case (checked to exist), and only the two participants can read it (anyone else gets 404). Each
 * message is recorded in the audit trail by hash only; the other person gets a notification that never contains the
 * message text. Personal identifiers are refused. Auditors can read nothing here and send nothing.
 */
@Service
public class DirectMessageService {

  public static final int MAX_TEXT = 1000;
  private static final Pattern PII = Pattern.compile(
      "\\b\\d{3}-\\d{2}-\\d{4}\\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|\\b(?:\\+?\\d[\\s-]?){10,}\\b");

  private final JdbcTemplate jdbc;
  private final ServingRepository serving;
  private final AuditService audit;
  private final NotificationService notifications;
  private final Tx tx;
  private final Clock clock;
  private final Map<String, Deque<Long>> recent = new ConcurrentHashMap<>();

  public DirectMessageService(JdbcTemplate jdbc, ServingRepository serving, AuditService audit,
      NotificationService notifications, Tx tx, Clock clock) {
    this.jdbc = jdbc;
    this.serving = serving;
    this.audit = audit;
    this.notifications = notifications;
    this.tx = tx;
    this.clock = clock;
  }

  private static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  private static String sha(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static void requireParticipantRole(AppUser u) {
    if (u.role() == Role.AUDITOR) {
      throw ApiException.forbiddenRole("Auditors cannot use direct messages.");
    }
  }

  /** The people one can message: everyone with an account except yourself and auditors. */
  public List<Map<String, Object>> people(AppUser u) {
    requireParticipantRole(u);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList("SELECT username, display_name, role FROM wf_user WHERE username <> ? AND "
        + "role <> 'AUDITOR' ORDER BY display_name", u.username())) {
      out.add(map("username", r.get("username"), "displayName", r.get("display_name"), "role", r.get("role")));
    }
    return out;
  }

  private Map<String, Object> thread(AppUser u, String threadId) {
    Map<String, Object> t = jdbc.queryForList("SELECT * FROM wf_dm_thread WHERE thread_id = ?", threadId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Conversation " + threadId));
    if (!u.username().equals(t.get("user_a")) && !u.username().equals(t.get("user_b"))) {
      throw ApiException.notFound("Conversation " + threadId);                  // not even its existence is revealed
    }
    return t;
  }

  private static String other(AppUser u, Map<String, Object> t) {
    return u.username().equals(t.get("user_a")) ? (String) t.get("user_b") : (String) t.get("user_a");
  }

  private Map<String, Object> person(String username) {
    return jdbc.queryForList("SELECT username, display_name, role FROM wf_user WHERE username = ?", username).stream()
        .findFirst().map(r -> map("username", r.get("username"), "displayName", r.get("display_name"), "role", r.get("role")))
        .orElse(map("username", username, "displayName", username, "role", "UNKNOWN"));
  }

  public List<Map<String, Object>> threads(AppUser u) {
    requireParticipantRole(u);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> t : jdbc.queryForList("SELECT * FROM wf_dm_thread WHERE user_a = ? OR user_b = ?", u.username(),
        u.username())) {
      String id = (String) t.get("thread_id");
      List<Map<String, Object>> last = jdbc.queryForList("SELECT rowid AS seq, sender, text, case_id, created_at FROM "
          + "wf_dm_message WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1", id);
      Long readSeq = jdbc.queryForList("SELECT last_seq FROM wf_dm_read WHERE thread_id = ? AND username = ?", Long.class, id,
          u.username()).stream().findFirst().orElse(0L);
      Long unread = jdbc.queryForObject("SELECT COUNT(*) FROM wf_dm_message WHERE thread_id = ? AND sender <> ? AND rowid > ?",
          Long.class, id, u.username(), readSeq);
      Map<String, Object> v = map("threadId", id, "with", person(other(u, t)), "unread", unread == null ? 0 : unread);
      if (last.isEmpty()) {
        v.put("last", null);
        v.put("updatedAt", t.get("created_at"));
      } else {
        Map<String, Object> m = last.get(0);
        v.put("last", map("sender", m.get("sender"), "text", m.get("text"), "caseId", m.get("case_id"), "at", m.get("created_at")));
        v.put("updatedAt", m.get("created_at"));
      }
      out.add(v);
    }
    out.sort((a, b) -> ((String) b.get("updatedAt")).compareTo((String) a.get("updatedAt")));
    return out;
  }

  public Map<String, Object> open(AppUser u, String to, String caseId, String text) {
    requireParticipantRole(u);
    if (to == null || to.isBlank() || to.equals(u.username())) {
      throw ApiException.invalid("to", "choose another person");
    }
    Map<String, Object> target = jdbc.queryForList("SELECT username, role FROM wf_user WHERE username = ?", to).stream()
        .findFirst().orElseThrow(() -> ApiException.invalid("to", "that person does not exist"));
    if ("AUDITOR".equals(target.get("role"))) {
      throw ApiException.invalid("to", "auditors cannot receive direct messages");
    }
    String a = u.username().compareTo(to) < 0 ? u.username() : to;
    String b = u.username().compareTo(to) < 0 ? to : u.username();
    String id = jdbc.queryForList("SELECT thread_id FROM wf_dm_thread WHERE user_a = ? AND user_b = ?", String.class, a, b).stream()
        .findFirst().orElse(null);
    if (id == null) {
      String fresh = "DM-" + UUID.randomUUID().toString().substring(0, 8);
      tx.write(() -> jdbc.update("INSERT INTO wf_dm_thread (thread_id, user_a, user_b, created_at) VALUES (?,?,?,?)", fresh, a, b,
          Instant.now(clock).toString()));
      id = fresh;
    }
    if (text != null && !text.isBlank()) {
      send(u, id, text, caseId);
    }
    return map("threadId", id);
  }

  public Map<String, Object> messages(AppUser u, String threadId, long after) {
    requireParticipantRole(u);
    Map<String, Object> t = thread(u, threadId);
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> m : jdbc.queryForList("SELECT rowid AS seq, sender, text, case_id, created_at FROM wf_dm_message "
        + "WHERE thread_id = ? AND rowid > ? ORDER BY rowid", threadId, after)) {
      out.add(map("seq", ((Number) m.get("seq")).longValue(), "sender", m.get("sender"), "text", m.get("text"),
          "caseId", m.get("case_id"), "at", m.get("created_at"), "mine", u.username().equals(m.get("sender"))));
    }
    return map("threadId", threadId, "with", person(other(u, t)), "messages", out);
  }

  public Map<String, Object> send(AppUser u, String threadId, String text, String caseId) {
    requireParticipantRole(u);
    Map<String, Object> t = thread(u, threadId);
    String body = text == null ? "" : text.trim();
    if (body.isEmpty()) {
      throw ApiException.invalid("text", "type a message");
    }
    if (body.length() > MAX_TEXT) {
      throw ApiException.invalid("text", "keep it under " + MAX_TEXT + " characters");
    }
    if (PII.matcher(body).find()) {
      throw ApiException.invalid("text", "please do not share personal identifiers (SSN, email, phone); use case or claim ids");
    }
    String attached = caseId == null || caseId.isBlank() ? null : caseId.trim();
    if (attached != null) {
      Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM serving_case WHERE run_id = ? AND case_id = ?", Integer.class,
          serving.requireRunId(), attached);
      if (n == null || n == 0) {
        throw ApiException.invalid("caseId", "that case does not exist in the current run");
      }
    }
    rateLimit(u.username());
    String id = "DMM-" + UUID.randomUUID().toString().substring(0, 10);
    String to = other(u, t);
    String now = Instant.now(clock).toString();
    tx.write(() -> {
      jdbc.update("INSERT INTO wf_dm_message (message_id, thread_id, sender, text, case_id, created_at) VALUES (?,?,?,?,?,?)", id,
          threadId, u.username(), body, attached, now);
      audit.append(u.username(), u.role().name(), "DM_MESSAGE", "dm", threadId,
          map("messageId", id, "to", to, "caseId", attached, "chars", body.length(), "sha256", sha(body)));
      notifications.notify(to, "DM_MESSAGE", u.displayName() + " sent you a message",
          attached == null ? "Open Messages to read it." : "About " + attached + ". Open Messages to read it.",
          "/agent?thread=" + threadId, threadId);
    });
    return map("messageId", id, "sent", true);
  }

  public Map<String, Object> markRead(AppUser u, String threadId) {
    requireParticipantRole(u);
    thread(u, threadId);
    Long last = jdbc.queryForObject("SELECT COALESCE(MAX(rowid), 0) FROM wf_dm_message WHERE thread_id = ?", Long.class, threadId);
    tx.write(() -> jdbc.update("INSERT INTO wf_dm_read (thread_id, username, last_seq) VALUES (?,?,?) ON CONFLICT(thread_id, "
        + "username) DO UPDATE SET last_seq = excluded.last_seq", threadId, u.username(), last));
    return map("read", true);
  }

  private void rateLimit(String user) {
    long now = clock.millis();
    Deque<Long> q = recent.computeIfAbsent(user, k -> new ArrayDeque<>());
    synchronized (q) {
      while (!q.isEmpty() && now - q.peekFirst() > 60_000) {
        q.pollFirst();
      }
      if (q.size() >= 30) {
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many messages", "Please wait a moment.");
      }
      q.addLast(now);
    }
  }
}
