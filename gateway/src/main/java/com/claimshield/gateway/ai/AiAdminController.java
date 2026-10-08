package com.claimshield.gateway.ai;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.auth.Role;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Operational view of the AI providers: status, model and per-key usage. Never exposes key material. */
@RestController
@RequestMapping("/api/ai")
public class AiAdminController {

  private final LlmClient llm;
  private final GeminiLlmClient gemini;

  public AiAdminController(LlmClient llm, GeminiLlmClient gemini) {
    this.llm = llm;
    this.gemini = gemini;
  }

  @GetMapping("/usage")
  public Map<String, Object> usage(@AuthenticationPrincipal AppUser u) {
    if (u.role() == Role.INVESTIGATOR) {
      throw ApiException.forbiddenRole("AI usage is available to supervisors, governance and auditors.");
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("status", llm.status());
    out.put("providers", llm instanceof RoutingLlmClient r ? r.providers() : "custom");
    out.put("geminiModel", gemini.model());
    out.put("keys", gemini.pool().stats());
    return out;
  }
}
