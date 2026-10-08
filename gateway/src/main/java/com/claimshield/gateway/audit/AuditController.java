package com.claimshield.gateway.audit;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
public class AuditController {

  private final AuditService audit;

  public AuditController(AuditService audit) {
    this.audit = audit;
  }

  private static void requireAuditAccess(AppUser u) {
    if (u.role() == Role.INVESTIGATOR) {
      throw ApiException.forbiddenRole("The audit trail is available to supervisors, governance and auditors.");
    }
  }

  @GetMapping
  public Map<String, Object> list(@AuthenticationPrincipal AppUser user,
      @RequestParam(required = false) String entityType, @RequestParam(required = false) String entityId,
      @RequestParam(required = false) String type, @RequestParam(required = false) Long cursor,
      @RequestParam(defaultValue = "50") int limit) {
    requireAuditAccess(user);
    return audit.list(entityType, entityId, type, cursor, limit);
  }

  @GetMapping("/verify")
  public Map<String, Object> verify(@AuthenticationPrincipal AppUser user) {
    requireAuditAccess(user);
    return audit.verify();
  }
}
