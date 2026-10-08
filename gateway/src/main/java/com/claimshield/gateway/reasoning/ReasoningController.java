package com.claimshield.gateway.reasoning;

import com.claimshield.gateway.auth.AppUser;
import jakarta.validation.constraints.NotBlank;
import java.util.LinkedHashMap;
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
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Grounded AI reasoning, the governed feedback loop, institutional memory and the human handoff. */
@RestController
@RequestMapping("/api")
public class ReasoningController {

  public record HandoffRequest(String sessionId, String reason, String caseId) {}

  public record MessageBody(@NotBlank String text) {}

  private final ReasoningService reasoning;
  private final LearningService learning;
  private final HandoffService handoff;

  public ReasoningController(ReasoningService reasoning, LearningService learning, HandoffService handoff) {
    this.reasoning = reasoning;
    this.learning = learning;
    this.handoff = handoff;
  }

  // ------------------------------------------------------------------------------------------------ reasoning
  @GetMapping("/cases/{caseId}/reasoning")
  public Map<String, Object> reasoningGet(@PathVariable String caseId) {
    return wrap(reasoning.stored(caseId, ReasoningService.CASE));
  }

  @PostMapping("/cases/{caseId}/reasoning")
  public Map<String, Object> reasoningMake(@AuthenticationPrincipal AppUser u, @PathVariable String caseId,
      @RequestParam(defaultValue = "false") boolean force) {
    return reasoning.generate(u, caseId, ReasoningService.CASE, force);
  }

  @GetMapping("/cases/{caseId}/precedent-reasoning")
  public Map<String, Object> precedentGet(@PathVariable String caseId) {
    return wrap(reasoning.stored(caseId, ReasoningService.PRECEDENT));
  }

  @PostMapping("/cases/{caseId}/precedent-reasoning")
  public Map<String, Object> precedentMake(@AuthenticationPrincipal AppUser u, @PathVariable String caseId,
      @RequestParam(defaultValue = "false") boolean force) {
    return reasoning.generate(u, caseId, ReasoningService.PRECEDENT, force);
  }

  private static Map<String, Object> wrap(java.util.Optional<Map<String, Object>> o) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("available", o.isPresent());
    o.ifPresent(out::putAll);
    return out;
  }

  // ---------------------------------------------------------------------------------------- feedback + memory
  @PostMapping("/cases/{caseId}/feedback")
  public Map<String, Object> feedback(@AuthenticationPrincipal AppUser u, @PathVariable String caseId,
      @RequestBody LearningService.FeedbackRequest body) {
    return learning.feedback(u, caseId, body);
  }

  @GetMapping("/cases/{caseId}/feedback")
  public List<Map<String, Object>> feedbackList(@PathVariable String caseId) {
    return learning.feedbackFor(caseId);
  }

  @GetMapping("/feedback/summary")
  public Map<String, Object> feedbackSummary(@AuthenticationPrincipal AppUser u) {
    return learning.feedbackSummary(u);
  }

  @GetMapping("/cases/{caseId}/institutional-memory")
  public Map<String, Object> memory(@PathVariable String caseId) {
    return learning.memory(caseId);
  }

  @PostMapping("/cases/{caseId}/knowledge/extract")
  public List<Map<String, Object>> extract(@AuthenticationPrincipal AppUser u, @PathVariable String caseId) {
    return learning.extract(u, caseId);
  }

  @GetMapping("/knowledge-items")
  public List<Map<String, Object>> items(@RequestParam(required = false) String status,
      @RequestParam(required = false) String caseId, @RequestParam(required = false) String scheme) {
    return learning.items(status, caseId, scheme);
  }

  @PostMapping("/knowledge-items/{itemId}/decision")
  public Map<String, Object> decide(@AuthenticationPrincipal AppUser u, @PathVariable String itemId,
      @RequestBody LearningService.Decision body) {
    return learning.decide(u, itemId, body);
  }

  @GetMapping("/learning/growth")
  public Map<String, Object> growth() {
    return learning.growth();
  }

  // --------------------------------------------------------------------------------------------------- handoff
  @PostMapping("/handoff")
  public Map<String, Object> request(@AuthenticationPrincipal AppUser u, @RequestBody HandoffRequest body) {
    return handoff.request(u, body.sessionId(), body.reason(), body.caseId());
  }

  @GetMapping("/handoff/mine")
  public Map<String, Object> mine(@AuthenticationPrincipal AppUser u) {
    return handoff.mine(u);
  }

  @GetMapping("/handoff/{id}")
  public Map<String, Object> fetch(@AuthenticationPrincipal AppUser u, @PathVariable String id,
      @RequestParam(defaultValue = "0") long after) {
    return handoff.fetch(u, id, after);
  }

  @PostMapping("/handoff/{id}/messages")
  public Map<String, Object> send(@AuthenticationPrincipal AppUser u, @PathVariable String id, @RequestBody MessageBody body) {
    return handoff.post(u, id, body.text());
  }

  @GetMapping(value = "/handoff/{id}/stream", produces = "text/event-stream")
  public SseEmitter stream(@AuthenticationPrincipal AppUser u, @PathVariable String id,
      @RequestParam(defaultValue = "0") long after) {
    return handoff.stream(u, id, after);
  }

  @PostMapping("/handoff/{id}/close")
  public Map<String, Object> close(@AuthenticationPrincipal AppUser u, @PathVariable String id) {
    return handoff.close(u, id);
  }

  @GetMapping("/handoff/{id}/transcript")
  public Map<String, Object> transcript(@AuthenticationPrincipal AppUser u, @PathVariable String id) {
    return handoff.transcript(u, id);
  }

  @GetMapping("/agent/queue")
  public Map<String, Object> agentQueue(@AuthenticationPrincipal AppUser u) {
    return handoff.agentQueue(u);
  }

  @PostMapping("/agent/handoffs/{id}/join")
  public Map<String, Object> join(@AuthenticationPrincipal AppUser u, @PathVariable String id) {
    return handoff.join(u, id);
  }
}
