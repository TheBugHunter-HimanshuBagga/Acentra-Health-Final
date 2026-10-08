package com.claimshield.gateway.brief;

import com.claimshield.gateway.auth.AppUser;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class BriefController {

  private final BriefService service;

  public BriefController(BriefService service) {
    this.service = service;
  }

  /** The latest brief for the case's current evidence pack, or 204 if none has been generated. */
  @GetMapping("/cases/{caseId}/brief")
  public ResponseEntity<Map<String, Object>> latest(@PathVariable String caseId) {
    return service.latest(caseId).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
  }

  /** Builds (or returns the cached) brief. Synchronous; a validation failure degrades to the template, not an error. */
  @PostMapping("/cases/{caseId}/brief")
  public ResponseEntity<Map<String, Object>> generate(@AuthenticationPrincipal AppUser user,
      @PathVariable String caseId) {
    return ResponseEntity.ok(service.generate(user, caseId));
  }
}
