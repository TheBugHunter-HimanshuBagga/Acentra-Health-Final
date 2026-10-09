package com.claimshield.gateway.messaging;

import com.claimshield.gateway.auth.AppUser;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Direct messages between two people, with an optional case on each message. Separate from the assistant. */
@RestController
@RequestMapping("/api")
public class DirectMessageController {

  public record OpenBody(String to, String caseId, String text) {}

  public record SendBody(String text, String caseId) {}

  private final DirectMessageService dm;

  public DirectMessageController(DirectMessageService dm) {
    this.dm = dm;
  }

  @GetMapping("/people")
  public List<Map<String, Object>> people(@AuthenticationPrincipal AppUser u) {
    return dm.people(u);
  }

  @GetMapping("/dm/threads")
  public List<Map<String, Object>> threads(@AuthenticationPrincipal AppUser u) {
    return dm.threads(u);
  }

  @PostMapping("/dm/threads")
  public Map<String, Object> open(@AuthenticationPrincipal AppUser u, @RequestBody OpenBody body) {
    return dm.open(u, body.to(), body.caseId(), body.text());
  }

  @GetMapping("/dm/threads/{id}")
  public Map<String, Object> messages(@AuthenticationPrincipal AppUser u, @PathVariable String id,
      @RequestParam(defaultValue = "0") long after) {
    return dm.messages(u, id, after);
  }

  @PostMapping("/dm/threads/{id}/messages")
  public Map<String, Object> send(@AuthenticationPrincipal AppUser u, @PathVariable String id, @RequestBody SendBody body) {
    return dm.send(u, id, body.text(), body.caseId());
  }

  @PostMapping("/dm/threads/{id}/read")
  public Map<String, Object> read(@AuthenticationPrincipal AppUser u, @PathVariable String id) {
    return dm.markRead(u, id);
  }
}
