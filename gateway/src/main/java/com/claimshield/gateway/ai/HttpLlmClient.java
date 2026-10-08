package com.claimshield.gateway.ai;

import com.claimshield.gateway.config.Json;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Talks to the Anthropic Messages API over HTTPS. The model must answer through a single forced tool, so the reply
 * is JSON in a fixed schema. Two attempts with backoff on transport errors, 429 and 5xx; a circuit breaker keeps a
 * failing provider from slowing every request. The key comes from the ANTHROPIC_API_KEY environment variable only.
 */
@Component
public class HttpLlmClient implements LlmClient {

  private static final Logger log = LoggerFactory.getLogger(HttpLlmClient.class);
  private static final String VERSION = "2023-06-01";

  private final Json json;
  private final String mode;
  private final String apiKey;
  private final String baseUrl;
  private final Duration timeout;
  private final CircuitBreaker breaker;
  private volatile HttpClient http;

  public HttpLlmClient(Json json, Clock clock, @Value("${claimshield.llm.mode:template}") String mode,
      @Value("${claimshield.llm.api-key:}") String apiKey,
      @Value("${claimshield.llm.base-url:https://api.anthropic.com}") String baseUrl,
      @Value("${claimshield.llm.timeout-seconds:25}") int timeoutSeconds) {
    this.json = json;
    this.mode = mode;
    this.apiKey = apiKey == null ? "" : apiKey.trim();
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    this.timeout = Duration.ofSeconds(timeoutSeconds);
    this.breaker = new CircuitBreaker(3, Duration.ofSeconds(60), Duration.ofMinutes(3), clock);
  }

  @Override
  public String status() {
    if (!"live".equalsIgnoreCase(mode) || apiKey.isEmpty()) {
      return "TEMPLATE";
    }
    return breaker.isOpen() ? "DEGRADED" : "LIVE";
  }

  @Override
  public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String toolName,
      String model) {
    if (!"LIVE".equals(status())) {
      return Optional.empty();
    }
    ObjectNode clean = (ObjectNode) schema.deepCopy();
    clean.remove("$schema");
    clean.remove("$id");
    Map<String, Object> tool = new LinkedHashMap<>();
    tool.put("name", toolName);
    tool.put("description", "Submit the answer. This is the only way to answer.");
    tool.put("input_schema", clean);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("max_tokens", 3000);
    body.put("temperature", 0);
    body.put("system", system);
    body.put("messages", List.of(Map.of("role", "user", "content", user)));
    body.put("tools", List.of(tool));
    body.put("tool_choice", Map.of("type", "tool", "name", toolName));
    String payload = json.write(body);
    for (int attempt = 1; attempt <= 2; attempt++) {
      long t0 = System.currentTimeMillis();
      try {
        HttpResponse<String> r = client().send(HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
            .timeout(timeout).header("x-api-key", apiKey).header("anthropic-version", VERSION)
            .header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofString(payload)).build(),
            HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() == 429 || r.statusCode() / 100 == 5) {
          throw new RuntimeException("HTTP " + r.statusCode());
        }
        if (r.statusCode() / 100 != 2) {
          breaker.failure();
          log.warn("LLM {} call refused: HTTP {}", purpose, r.statusCode());
          return Optional.empty();
        }
        JsonNode resp = json.tree(r.body());
        String stop = resp.path("stop_reason").asString("");
        JsonNode out = null;
        for (JsonNode block : resp.path("content")) {
          if ("tool_use".equals(block.path("type").asString()) && toolName.equals(block.path("name").asString())) {
            out = block.get("input");
          }
        }
        breaker.success();
        return Optional.of(new Result(out, "tool_use".equals(stop) ? "tool_use" : stop, resp.path("model")
            .asString(model), System.currentTimeMillis() - t0, sha(payload), sha(r.body())));
      } catch (Exception e) {
        if (e instanceof InterruptedException) {
          Thread.currentThread().interrupt();
        }
        log.warn("LLM {} call failed (attempt {}): {}", purpose, attempt, e.getClass().getSimpleName());
        if (attempt == 2 || e instanceof InterruptedException) {
          breaker.failure();
          return Optional.empty();
        }
        try {
          Thread.sleep(400L * attempt + (long) (Math.random() * 200));
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          return Optional.empty();
        }
      }
    }
    return Optional.empty();
  }

  private HttpClient client() {
    HttpClient c = http;
    if (c == null) {
      synchronized (this) {
        if (http == null) {
          http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        }
        c = http;
      }
    }
    return c;
  }

  static String sha(String s) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
