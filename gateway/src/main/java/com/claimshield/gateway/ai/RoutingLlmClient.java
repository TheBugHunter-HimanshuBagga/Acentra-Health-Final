package com.claimshield.gateway.ai;

import java.util.Optional;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * The one {@link LlmClient} the rest of the gateway sees. Gemini (key pool) is tried first, Claude second; if neither
 * is available the caller gets empty and falls back to deterministic output. Neither provider is a source of truth:
 * everything that comes back still goes through the validators.
 */
@Primary
@Component("routingLlmClient")
public class RoutingLlmClient implements LlmClient {

  private final GeminiLlmClient gemini;
  private final HttpLlmClient claude;

  public RoutingLlmClient(GeminiLlmClient gemini, HttpLlmClient claude) {
    this.gemini = gemini;
    this.claude = claude;
  }

  @Override
  public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String toolName,
      String model) {
    if ("LIVE".equals(gemini.status())) {
      Optional<Result> r = gemini.structured(purpose, system, user, schema, toolName, gemini.model());
      if (r.isPresent()) {
        return r;
      }
    }
    if ("LIVE".equals(claude.status())) {
      return claude.structured(purpose, system, user, schema, toolName, model);
    }
    return Optional.empty();
  }

  @Override
  public String status() {
    String g = gemini.status();
    String c = claude.status();
    if ("LIVE".equals(g) || "LIVE".equals(c)) {
      return "LIVE";
    }
    if ("DEGRADED".equals(g) || "DEGRADED".equals(c)) {
      return "DEGRADED";
    }
    return "TEMPLATE";
  }

  /** Which providers are configured, for the health and usage screens. Never includes key material. */
  public String providers() {
    StringBuilder sb = new StringBuilder();
    if (!"TEMPLATE".equals(gemini.status())) {
      sb.append("gemini:").append(gemini.model()).append(" x").append(gemini.pool().size());
    }
    if (!"TEMPLATE".equals(claude.status())) {
      sb.append(sb.length() > 0 ? ", " : "").append("claude");
    }
    return sb.toString();
  }
}
