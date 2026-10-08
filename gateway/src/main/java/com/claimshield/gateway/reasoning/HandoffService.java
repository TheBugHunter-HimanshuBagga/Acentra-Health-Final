package com.claimshield.gateway.reasoning;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import com.claimshield.gateway.config.Json;
import com.claimshield.gateway.config.Tx;
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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Human handoff inside the same chat. When the assistant is not confident enough, or the user asks, a request is
 * queued; a supervisor or governance user (the internal specialists, no personal contact details involved) joins from
 * the agent console, and the conversation continues in the same chat window. Messages are stored in full for the audit
 * trail and each one is also recorded as an audit event with a hash of its text. Only the requester, the assigned
 * specialist and auditors can read a conversation. Personal identifiers are refused at the door.
 */
@Service
public class HandoffService {

  public static final int MAX_TEXT = 1000;
  private static final Pattern PII = Pattern.compile(
      "\\b\\d{3}-\\d{2}-\\d{4}\\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}|\\b(?:\\+?\\d[\\s-]?){10,}\\b");

  private final JdbcTemplate jdbc;
  private final AuditService audit;
  private final Tx tx;
  private final Json json;
  private final Clock clock;
  private final NotificationService notifications;
  private final Map<String, Deque<Long>> recent = new ConcurrentHashMap<>();
  private final ScheduledExecutorService pump = Executors.newScheduledThreadPool(2, r -> {
    Thread t = new Thread(r, "handoff-sse");
    t.setDaemon(true);
    return t;
  });

  public HandoffService(JdbcTemplate jdbc, AuditService audit, Tx tx, Json json, Clock clock, NotificationService notifications) {
    this.notifications = notifications;
    this.jdbc = jdbc;
    this.audit = audit;
    this.tx = tx;
    this.json = json;
    this.clock = clock;
  }

  private String now() {
    return Instant.now(clock).toString();
  }

  private static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  private static boolean specialist(AppUser u) {
    return u.role() == Role.SUPERVISOR || u.role() == Role.GOVERNANCE;
  }

  private static String sha(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // ------------------------------------------------------------------------------------------------- requesting
  public Map<String, Object> request(AppUser u, String sessionId, String reason, String caseId) {
    List<Map<String, Object>> open = jdbc.queryForList("SELECT handoff_id FROM wf_handoff WHERE requested_by = ? AND "
        + "status <> 'CLOSED'", u.username());
    if (!open.isEmpty()) {
      return mine(u);
    }
    String why = reason == null || reason.isBlank() ? "The assistant could not answer confidently" : reason.trim();
    if (why.length() > 300) {
      why = why.substring(0, 300);
    }
    String id = "HO-" + UUID.randomUUID().toString().substring(0, 8);
    String finalWhy = why;
    tx.write(() -> {
      jdbc.update("INSERT INTO wf_handoff (handoff_id, session_id, requested_by, reason, status, case_id, created_at) "
          + "VALUES (?,?,?,?, 'WAITING', ?, ?)", id, sessionId == null ? "none" : sessionId, u.username(), finalWhy,
          caseId, now());
      system(id, "A human specialist has been requested. You can keep typing; they will see this conversation.");
      audit.append(u.username(), u.role().name(), "HANDOFF_REQUESTED", "handoff", id,
          map("reason", finalWhy, "caseId", caseId, "sessionId", sessionId));
      notifications.notifyRoles(List.of("SUPERVISOR", "GOVERNANCE"), u.username(), "HANDOFF_REQUESTED",
          u.displayName() + " needs a specialist", finalWhy, "/agent?open=" + id, id);
    });
    return mine(u);
  }

  private void system(String handoffId, String text) {
    jdbc.update("INSERT INTO wf_handoff_message (message_id, handoff_id, sender_role, sender, text, created_at) VALUES "
        + "(?,?, 'SYSTEM', 'system', ?, ?)", "HM-" + UUID.randomUUID().toString().substring(0, 10), handoffId, text, now());
  }

  public Map<String, Object> mine(AppUser u) {
    List<Map<String, Object>> r = jdbc.queryForList("SELECT * FROM wf_handoff WHERE requested_by = ? AND status <> 'CLOSED' "
        + "ORDER BY created_at DESC LIMIT 1", u.username());
    if (r.isEmpty()) {
      return map("active", false);
    }
    String id = (String) r.get(0).get("handoff_id");
    return map("active", true, "handoff", handoffView(r.get(0)), "messages", messages(id, 0));
  }

  private Map<String, Object> handoffView(Map<String, Object> r) {
    return map("handoffId", r.get("handoff_id"), "status", r.get("status"), "requestedBy", r.get("requested_by"),
        "agent", r.get("agent"), "reason", r.get("reason"), "caseId", r.get("case_id"), "createdAt", r.get("created_at"),
        "joinedAt", r.get("joined_at"), "closedAt", r.get("closed_at"));
  }

  List<Map<String, Object>> messages(String handoffId, long afterSeq) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> m : jdbc.queryForList("SELECT rowid AS seq, sender_role, sender, text, created_at FROM "
        + "wf_handoff_message WHERE handoff_id = ? AND rowid > ? ORDER BY rowid", handoffId, afterSeq)) {
      out.add(map("seq", ((Number) m.get("seq")).longValue(), "role", m.get("sender_role"), "sender", m.get("sender"),
          "text", m.get("text"), "at", m.get("created_at")));
    }
    return out;
  }

  private Map<String, Object> load(String handoffId) {
    return jdbc.queryForList("SELECT * FROM wf_handoff WHERE handoff_id = ?", handoffId).stream().findFirst()
        .orElseThrow(() -> ApiException.notFound("Handoff " + handoffId));
  }

  /** Requester, the assigned specialist, or (read only) an auditor. Waiting requests are visible to specialists. */
  private Map<String, Object> authorize(AppUser u, String handoffId, boolean write) {
    Map<String, Object> h = load(handoffId);
    boolean requester = u.username().equals(h.get("requested_by"));
    boolean agent = u.username().equals(h.get("agent"));
    boolean waitingForSpecialist = "WAITING".equals(h.get("status")) && specialist(u) && !requester;
    boolean auditor = u.role() == Role.AUDITOR && !write;
    if (!(requester || agent || waitingForSpecialist || auditor)) {
      throw ApiException.notFound("Handoff " + handoffId);                      // not even its existence is revealed
    }
    return h;
  }

  // -------------------------------------------------------------------------------------------------- messages
  public Map<String, Object> post(AppUser u, String handoffId, String text) {
    Map<String, Object> h = authorize(u, handoffId, true);
    if ("CLOSED".equals(h.get("status"))) {
      throw ApiException.conflict("This conversation is closed.");
    }
    boolean requester = u.username().equals(h.get("requested_by"));
    boolean agent = u.username().equals(h.get("agent"));
    if (!requester && !agent) {
      throw ApiException.forbiddenRole("Join the conversation before replying.");
    }
    String t = text == null ? "" : text.trim();
    if (t.isEmpty()) {
      throw ApiException.invalid("text", "type a message");
    }
    if (t.length() > MAX_TEXT) {
      throw ApiException.invalid("text", "keep it under " + MAX_TEXT + " characters");
    }
    if (PII.matcher(t).find()) {
      throw ApiException.invalid("text", "please do not share personal identifiers (SSN, email, phone); use case or claim ids");
    }
    rateLimit(u.username());
    String id = "HM-" + UUID.randomUUID().toString().substring(0, 10);
    String role = requester ? "USER" : "AGENT";
    tx.write(() -> {
      jdbc.update("INSERT INTO wf_handoff_message (message_id, handoff_id, sender_role, sender, text, created_at) VALUES "
          + "(?,?,?,?,?,?)", id, handoffId, role, u.username(), t, now());
      audit.append(u.username(), u.role().name(), "HANDOFF_MESSAGE", "handoff", handoffId,
          map("messageId", id, "senderRole", role, "chars", t.length(), "sha256", sha(t)));
      String other = requester ? (String) h.get("agent") : (String) h.get("requested_by");
      if (other != null) {
        notifications.notify(other, "HANDOFF_MESSAGE", u.displayName() + " sent a message", "Open the conversation to read it.",
            requester ? "/agent?open=" + handoffId : "chat:" + handoffId, handoffId + ":msg");
      }
    });
    return map("messageId", id, "sent", true);
  }

  private void rateLimit(String user) {
    long now = clock.millis();
    Deque<Long> q = recent.computeIfAbsent(user, k -> new ArrayDeque<>());
    synchronized (q) {
      while (!q.isEmpty() && now - q.peekFirst() > 60_000) {
        q.pollFirst();
      }
      if (q.size() >= 20) {
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many messages", "Please wait a moment.");
      }
      q.addLast(now);
    }
  }

  public Map<String, Object> fetch(AppUser u, String handoffId, long after) {
    Map<String, Object> h = authorize(u, handoffId, false);
    return map("handoff", handoffView(h), "messages", messages(handoffId, after));
  }

  // ---------------------------------------------------------------------------------------------- agent console
  public Map<String, Object> agentQueue(AppUser u) {
    if (!specialist(u)) {
      throw ApiException.forbiddenRole("The agent console is for supervisors and governance specialists.");
    }
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> r : jdbc.queryForList("SELECT * FROM wf_handoff WHERE status <> 'CLOSED' AND (status = 'WAITING' "
        + "OR agent = ?) ORDER BY created_at", u.username())) {
      Map<String, Object> v = handoffView(r);
      List<Map<String, Object>> ms = messages((String) r.get("handoff_id"), 0);
      v.put("messageCount", ms.size());
      v.put("lastMessage", ms.isEmpty() ? null : ms.get(ms.size() - 1));
      out.add(v);
    }
    return map("items", out);
  }

  public Map<String, Object> join(AppUser u, String handoffId) {
    if (!specialist(u)) {
      throw ApiException.forbiddenRole("Only a supervisor or governance specialist can join a conversation.");
    }
    Map<String, Object> h = authorize(u, handoffId, true);
    if (u.username().equals(h.get("requested_by"))) {
      throw ApiException.forbiddenRole("You cannot answer your own request.");
    }
    if (!"WAITING".equals(h.get("status"))) {
      throw ApiException.conflict("This conversation is " + h.get("status").toString().toLowerCase() + ".");
    }
    tx.write(() -> {
      jdbc.update("UPDATE wf_handoff SET status = 'ACTIVE', agent = ?, joined_at = ? WHERE handoff_id = ?", u.username(),
          now(), handoffId);
      system(handoffId, u.displayName() + " (" + u.role().name().toLowerCase() + ") joined the conversation.");
      audit.append(u.username(), u.role().name(), "HANDOFF_JOINED", "handoff", handoffId,
          map("requestedBy", h.get("requested_by")));
      notifications.notify((String) h.get("requested_by"), "HANDOFF_JOINED", u.displayName() + " joined your conversation",
          "A specialist is now in your chat.", "chat:" + handoffId, handoffId + ":join");
    });
    return fetch(u, handoffId, 0);
  }

  public Map<String, Object> close(AppUser u, String handoffId) {
    Map<String, Object> h = authorize(u, handoffId, true);
    if (!(u.username().equals(h.get("agent")) || u.username().equals(h.get("requested_by")))) {
      throw ApiException.forbiddenRole("Only the requester or the assigned specialist can close the conversation.");
    }
    tx.write(() -> {
      jdbc.update("UPDATE wf_handoff SET status = 'CLOSED', closed_at = ? WHERE handoff_id = ?", now(), handoffId);
      system(handoffId, "The conversation was closed by " + u.username() + ".");
      audit.append(u.username(), u.role().name(), "HANDOFF_CLOSED", "handoff", handoffId, map());
      String other = u.username().equals(h.get("agent")) ? (String) h.get("requested_by") : (String) h.get("agent");
      if (other != null) {
        notifications.notify(other, "HANDOFF_CLOSED", "Conversation closed", u.displayName() + " closed the conversation.",
            "chat:" + handoffId, handoffId + ":close");
      }
    });
    return map("closed", true);
  }

  public Map<String, Object> transcript(AppUser u, String handoffId) {
    Map<String, Object> h = authorize(u, handoffId, false);
    return map("handoff", handoffView(h), "messages", messages(handoffId, 0));
  }

  // -------------------------------------------------------------------------------------------------- streaming
  /** Server-sent events: every new message arrives as it is written, and the stream ends when the chat closes. */
  public SseEmitter stream(AppUser u, String handoffId, long after) {
    authorize(u, handoffId, false);
    SseEmitter em = new SseEmitter(30 * 60_000L);
    long[] last = {after};
    ScheduledFuture<?>[] task = new ScheduledFuture<?>[1];
    Runnable stop = () -> {
      if (task[0] != null) {
        task[0].cancel(false);
      }
    };
    em.onCompletion(stop);
    em.onTimeout(() -> {
      stop.run();
      em.complete();
    });
    em.onError(e -> stop.run());
    task[0] = pump.scheduleWithFixedDelay(() -> {
      try {
        Map<String, Object> h = load(handoffId);
        List<Map<String, Object>> ms = messages(handoffId, last[0]);
        for (Map<String, Object> m : ms) {
          em.send(SseEmitter.event().name("message").data(json.write(m)));
          last[0] = ((Number) m.get("seq")).longValue();
        }
        em.send(SseEmitter.event().name("status").data(json.write(map("status", h.get("status"), "agent", h.get("agent")))));
        if ("CLOSED".equals(h.get("status")) && ms.isEmpty()) {
          stop.run();
          em.complete();
        }
      } catch (Exception e) {
        stop.run();
        em.complete();
      }
    }, 0, 1, TimeUnit.SECONDS);
    return em;
  }
}
