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
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Gemini over HTTPS with structured (JSON-schema) output, spread across all configured keys by {@link GeminiPool}.
 * Server side only: the keys come from environment variables and never leave this process or reach the logs.
 *
 * <p>Calls are made only when the caller needs reasoning; identical requests are answered from a short cache so the
 * same evidence pack is never explained twice. Retries are limited to failures that can succeed on retry (429 on
 * another key, 5xx, timeouts); 400/403 are not retried against the same key.
 */
@Component
public class GeminiLlmClient implements LlmClient {

  private static final Logger log = LoggerFactory.getLogger(GeminiLlmClient.class);
  private static final Pattern RETRY = Pattern.compile("\"retryDelay\"\\s*:\\s*\"([0-9.]+)s\"");
  private static final Pattern QUOTA = Pattern.compile("\"quotaValue\"\\s*:\\s*\"(\\d+)\"");
  private static final long CACHE_TTL_MS = 10 * 60_000;
  private static final long MAX_WAIT_MS = 6_000;

  private final Json json;
  private final Clock clock;
  private final String mode;
  private final String model;
  private final String baseUrl;
  private final Duration timeout;
  private final GeminiPool pool;
  private volatile HttpClient http;
  private final Map<String, Cached> cache = new ConcurrentHashMap<>();

  private record Cached(long at, Result result) {}

  public GeminiLlmClient(Json json, Clock clock, Environment env) {
    this.json = json;
    this.clock = clock;
    this.mode = env.getProperty("claimshield.llm.mode", "template");
    this.model = env.getProperty("claimshield.gemini.model", "gemini-3.1-flash-lite");
    this.baseUrl = env.getProperty("claimshield.gemini.base-url", "https://generativelanguage.googleapis.com")
        .replaceAll("/$", "");
    this.timeout = Duration.ofSeconds(env.getProperty("claimshield.gemini.timeout-seconds", Integer.class, 40));
    List<String> keys = new ArrayList<>();
    for (String name : new String[] {"claimshield.gemini.key", "claimshield.gemini.key-2", "claimshield.gemini.key-3",
        "claimshield.gemini.key-4", "claimshield.gemini.key-5", "claimshield.gemini.key-6"}) {
      keys.add(env.getProperty(name, ""));
    }
    this.pool = new GeminiPool(keys, model, env.getProperty("claimshield.gemini.rpm", Integer.class, 0),
        env.getProperty("claimshield.gemini.tpm", Integer.class, 0), clock);
  }

  public GeminiPool pool() {
    return pool;
  }

  public String model() {
    return model;
  }

  @Override
  public String status() {
    if (!"live".equalsIgnoreCase(mode) || pool.size() == 0) {
      return "TEMPLATE";
    }
    return pool.anyUsable() ? "LIVE" : "DEGRADED";
  }

  @Override
  public Optional<Result> structured(String purpose, String system, String user, JsonNode schema, String toolName,
      String ignoredModel) {
    if (!"LIVE".equals(status())) {
      return Optional.empty();
    }
    String requestKey = sha(purpose + "\n" + system + "\n" + user + "\n" + (schema == null ? "" : schema.toString()));
    Cached hit = cache.get(requestKey);
    if (hit != null && clock.millis() - hit.at < CACHE_TTL_MS) {
      return Optional.of(hit.result);
    }
    int estimate = (system.length() + user.length()) / 3 + 1500;      // rough tokens in + room for the answer
    String payload = body(system, user, schema, true);
    boolean schemaDropped = false;
    long t0 = clock.millis();
    for (int attempt = 1; attempt <= 4; attempt++) {
      Optional<GeminiPool.Lease> lease = pool.acquire(estimate);
      if (lease.isEmpty()) {
        long wait = pool.millisUntilAvailable();
        if (wait < 0 || wait > MAX_WAIT_MS) {
          log.info("Gemini {}: no key available (next in {} ms); using the deterministic fallback", purpose, wait);
          return Optional.empty();
        }
        sleep(wait + 50);
        continue;
      }
      GeminiPool.Lease l = lease.get();
      try {
        HttpResponse<String> r = client().send(HttpRequest.newBuilder(URI.create(
            baseUrl + "/v1beta/models/" + model + ":generateContent")).timeout(timeout)
            .header("x-goog-api-key", l.secret()).header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload)).build(), HttpResponse.BodyHandlers.ofString());
        int status = r.statusCode();
        if (status == 429) {
          long retry = parseRetryMs(r);
          Matcher q = QUOTA.matcher(r.body());
          pool.rateLimited(l, retry, q.find() ? Integer.valueOf(q.group(1)) : null);
          log.warn("Gemini {} rate limited on {} (cooling {} ms); rotating", purpose, l.id(), retry);
          continue;                                                  // another key, no sleep
        }
        if (status >= 500) {
          pool.failed(l);
          backoff(attempt);
          continue;
        }
        if (status == 400 && schema != null && !schemaDropped) {      // schema feature unsupported: ask in the prompt
          schemaDropped = true;
          payload = body(system, user, schema, false);
          continue;
        }
        if (status / 100 != 2) {
          pool.rejected(l);
          log.warn("Gemini {} refused by {}: HTTP {}", purpose, l.id(), status);
          continue;
        }
        JsonNode resp = json.tree(r.body());
        JsonNode cand = resp.path("candidates").path(0);
        String finish = cand.path("finishReason").asString("");
        StringBuilder text = new StringBuilder();
        for (JsonNode p : cand.path("content").path("parts")) {
          if (p.has("text") && !p.path("thought").asBoolean(false)) {
            text.append(p.get("text").asString());
          }
        }
        int used = resp.path("usageMetadata").path("totalTokenCount").asInt(estimate);
        pool.success(l, used);
        JsonNode out;
        try {
          out = json.tree(stripFence(text.toString()));
        } catch (RuntimeException e) {
          log.warn("Gemini {} returned non-JSON text on {}", purpose, l.id());
          return Optional.empty();
        }
        Result result = new Result(out, "STOP".equals(finish) ? "tool_use" : finish.toLowerCase(), model,
            clock.millis() - t0, sha(payload), sha(r.body()));
        if (cache.size() > 200) {
          cache.clear();
        }
        cache.put(requestKey, new Cached(clock.millis(), result));
        return Optional.of(result);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return Optional.empty();
      } catch (Exception e) {
        pool.failed(l);
        log.warn("Gemini {} call failed on {}: {}", purpose, l.id(), e.getClass().getSimpleName());
        backoff(attempt);
      }
    }
    return Optional.empty();
  }

  private String body(String system, String user, JsonNode schema, boolean withSchema) {
    Map<String, Object> gen = new LinkedHashMap<>();
    gen.put("temperature", 0);
    gen.put("maxOutputTokens", 4096);
    gen.put("responseMimeType", "application/json");
    String sys = system;
    if (schema != null && withSchema) {
      ObjectNode clean = (ObjectNode) schema.deepCopy();
      clean.remove("$schema");
      clean.remove("$id");
      gen.put("responseJsonSchema", clean);
    } else if (schema != null) {
      sys = system + "\nAnswer with one JSON object that matches this JSON Schema exactly:\n" + schema;
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", sys))));
    body.put("contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", user)))));
    body.put("generationConfig", gen);
    return json.write(body);
  }

  private static String stripFence(String s) {
    String t = s.trim();
    if (t.startsWith("```")) {
      t = t.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "");
    }
    return t;
  }

  private static long parseRetryMs(HttpResponse<String> r) {
    String h = r.headers().firstValue("retry-after").orElse(null);
    if (h != null) {
      try {
        return (long) (Double.parseDouble(h) * 1000);
      } catch (NumberFormatException ignored) {
        // fall through to the body
      }
    }
    Matcher m = RETRY.matcher(r.body());
    return m.find() ? (long) (Double.parseDouble(m.group(1)) * 1000) : 60_000;
  }

  private static void backoff(int attempt) {
    sleep((long) (300L * Math.pow(2, attempt - 1) + Math.random() * 200));
  }

  private static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  private HttpClient client() {
    HttpClient c = http;
    if (c == null) {
      synchronized (this) {
        if (http == null) {
          http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
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
