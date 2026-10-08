package com.claimshield.gateway.engine;

import com.claimshield.gateway.config.Json;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

@Component
public class HttpEngineClient implements EngineClient {

  private volatile HttpClient http;      // built on first use: starting the app must not open sockets
  private final String base;
  private final String token;
  private final Json json;
  private volatile long healthyUntil = 0;

  public HttpEngineClient(@Value("${claimshield.engine.url}") String base,
      @Value("${claimshield.engine.token}") String token, Json json) {
    this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    this.token = token;
    this.json = json;
  }

  @Override
  public JsonNode post(String path, Object body) {
    return send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(90))
        .header("X-Engine-Token", token).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json.write(body))).build());
  }

  @Override
  public JsonNode get(String path) {
    return send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
        .header("X-Engine-Token", token).GET().build());
  }

  @Override
  public boolean healthy() {
    if (System.currentTimeMillis() < healthyUntil) {
      return true;
    }
    try {
      get("/internal/health");
      healthyUntil = System.currentTimeMillis() + 5_000;
      return true;
    } catch (EngineException e) {
      return false;
    }
  }

  private HttpClient client() {
    HttpClient c = http;
    if (c == null) {
      synchronized (this) {
        if (http == null) {
          http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(2)).build();
        }
        c = http;
      }
    }
    return c;
  }

  private JsonNode send(HttpRequest req) {
    try {
      HttpResponse<String> r = client().send(req, HttpResponse.BodyHandlers.ofString());
      if (r.statusCode() / 100 != 2) {
        String detail = r.body();
        try {
          JsonNode n = json.tree(r.body());
          if (n.hasNonNull("detail")) {
            detail = n.get("detail").isString() ? n.get("detail").asString() : n.get("detail").toString();
          }
        } catch (RuntimeException ignored) {
          // keep the raw body
        }
        throw new EngineException(r.statusCode(), detail);
      }
      return json.tree(r.body());
    } catch (IOException | java.io.UncheckedIOException e) {
      throw new EngineException(0, "The analysis engine could not be reached (" + e.getClass().getSimpleName() + ").");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new EngineException(0, "The call to the analysis engine was interrupted.");
    }
  }
}
