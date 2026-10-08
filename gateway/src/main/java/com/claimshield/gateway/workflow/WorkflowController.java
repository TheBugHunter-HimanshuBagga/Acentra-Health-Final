package com.claimshield.gateway.workflow;

import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.workflow.Dto.ApproveRequest;
import com.claimshield.gateway.workflow.Dto.CloseRequest;
import com.claimshield.gateway.workflow.Dto.ReviewRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class WorkflowController {

  private final CaseWorkflowService service;

  public WorkflowController(CaseWorkflowService service) {
    this.service = service;
  }

  @PostMapping("/cases/{caseId}/review")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> review(@AuthenticationPrincipal AppUser user, @PathVariable String caseId,
      @Valid @RequestBody ReviewRequest body,
      @RequestHeader(name = "Idempotency-Key", required = false) String key) {
    return service.review(user, caseId, body, key);
  }

  @GetMapping("/cases/{caseId}/reviews")
  public List<Map<String, Object>> reviews(@PathVariable String caseId) {
    return service.reviews(caseId);
  }

  @PostMapping("/review-actions/{actionId}/approve")
  public Map<String, Object> approve(@AuthenticationPrincipal AppUser user, @PathVariable String actionId,
      @Valid @RequestBody ApproveRequest body) {
    return service.approve(user, actionId, body);
  }

  @PostMapping("/review-actions/{actionId}/execute")
  public Map<String, Object> execute(@AuthenticationPrincipal AppUser user, @PathVariable String actionId) {
    return service.execute(user, actionId);
  }

  @PostMapping("/cases/{caseId}/close")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> close(@AuthenticationPrincipal AppUser user, @PathVariable String caseId,
      @Valid @RequestBody CloseRequest body) {
    return service.close(user, caseId, body);
  }
}
