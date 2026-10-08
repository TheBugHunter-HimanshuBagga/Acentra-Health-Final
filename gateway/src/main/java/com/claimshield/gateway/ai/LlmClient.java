package com.claimshield.gateway.ai;

import java.util.Optional;
import tools.jackson.databind.JsonNode;

/**
 * Server-side access to Claude. The model is only ever asked to fill a fixed JSON schema from a closed evidence pack
 * (or from tool results for chat); every answer goes through the Java validator before a person can see it. It never
 * produces a score, a tier or an authoritative number, and the API key never leaves this process.
 */
public interface LlmClient {

  /** A structured answer plus the facts needed to audit the call (hashes, not content). */
  record Result(JsonNode output, String stopReason, String model, long latencyMs, String requestSha256,
      String responseSha256) {}

  /**
   * Calls the model with the system prompt and user message and forces it to answer through one tool whose input
   * schema is {@code schema}. Empty means "no model available" (not configured, circuit open, API error, timeout):
   * callers must fall back to deterministic output.
   */
  Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String toolName,
      String model);

  /** LIVE (configured and healthy), TEMPLATE (no key or mode=template) or DEGRADED (configured, breaker open). */
  String status();

  default boolean live() {
    return "LIVE".equals(status());
  }
}
