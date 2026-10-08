package com.claimshield.gateway.ai;

import com.claimshield.gateway.config.Json;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Calls api.sarvam.ai with the key from SARVAM_API_KEY. Verified against the live API for the formats used here. */
@Component
public class HttpSarvam implements SpeechService {

  private static final Logger log = LoggerFactory.getLogger(HttpSarvam.class);
  static final int MAX_TTS_CHARS = 2400;
  static final int MAX_TRANSLATE_CHARS = 1900;

  private final Json json;
  private final boolean enabled;
  private final String key;
  private final String base;
  private final String sttModel;
  private final String translateModel;
  private final String ttsModel;
  private final String speaker;
  private final CircuitBreaker breaker;
  private volatile HttpClient http;

  public HttpSarvam(Json json, Clock clock, @Value("${claimshield.sarvam.enabled:false}") boolean enabled,
      @Value("${claimshield.sarvam.api-key:}") String key,
      @Value("${claimshield.sarvam.base-url:https://api.sarvam.ai}") String base,
      @Value("${claimshield.sarvam.stt-model:saaras:v4}") String sttModel,
      @Value("${claimshield.sarvam.translate-model:sarvam-translate:v1}") String translateModel,
      @Value("${claimshield.sarvam.tts-model:bulbul:v3}") String ttsModel,
      @Value("${claimshield.sarvam.speaker:shubh}") String speaker) {
    this.json = json;
    this.enabled = enabled;
    this.key = key == null ? "" : key.trim();
    this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    this.sttModel = sttModel;
    this.translateModel = translateModel;
    this.ttsModel = ttsModel;
    this.speaker = speaker;
    this.breaker = new CircuitBreaker(3, Duration.ofSeconds(60), Duration.ofMinutes(3), clock);
  }

  @Override
  public String status() {
    if (!enabled || key.isEmpty()) {
      return "OFF";
    }
    return breaker.isOpen() ? "DEGRADED" : "ON";
  }

  @Override
  public Optional<String> translate(String text, String sourceLanguage, String targetLanguage) {
    if (!on() || text == null || text.isBlank() || text.length() > MAX_TRANSLATE_CHARS) {
      return Optional.empty();
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("input", text);
    body.put("source_language_code", sourceLanguage);
    body.put("target_language_code", targetLanguage);
    body.put("model", translateModel);
    body.put("mode", "formal");
    body.put("numerals_format", "international");
    return call("translate", HttpRequest.newBuilder(URI.create(base + "/translate")).timeout(Duration.ofSeconds(10))
        .header("api-subscription-key", key).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json.write(body))).build())
        .map(n -> n.path("translated_text").asString("")).filter(s -> !s.isBlank());
  }

  @Override
  public Optional<Transcript> transcribe(byte[] audio, String filename, String contentType, String languageCode) {
    if (!on() || audio == null || audio.length == 0) {
      return Optional.empty();
    }
    String boundary = "----cs" + UUID.randomUUID();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      part(out, boundary, "model", sttModel);
      part(out, boundary, "language_code", languageCode == null ? "unknown" : languageCode);
      out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\""
          + filename.replaceAll("[^A-Za-z0-9._-]", "_") + "\"\r\nContent-Type: " + contentType + "\r\n\r\n")
          .getBytes(StandardCharsets.UTF_8));
      out.write(audio);
      out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      return Optional.empty();
    }
    return call("speech-to-text", HttpRequest.newBuilder(URI.create(base + "/speech-to-text"))
        .timeout(Duration.ofSeconds(20)).header("api-subscription-key", key)
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())).build())
        .map(n -> new Transcript(n.path("transcript").asString(""), n.path("language_code").asString(""),
            n.has("language_probability") && n.get("language_probability").isNumber()
                ? n.get("language_probability").asDouble() : 1.0))
        .filter(t -> !t.text().isBlank());
  }

  @Override
  public Optional<Audio> speak(String text, String languageCode) {
    if (!on() || text == null || text.isBlank()) {
      return Optional.empty();
    }
    String t = text.length() > MAX_TTS_CHARS ? text.substring(0, MAX_TTS_CHARS) : text;
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("text", t);
    body.put("target_language_code", languageCode);
    body.put("model", ttsModel);
    body.put("speaker", speaker);
    return call("text-to-speech", HttpRequest.newBuilder(URI.create(base + "/text-to-speech"))
        .timeout(Duration.ofSeconds(20)).header("api-subscription-key", key)
        .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json.write(body)))
        .build())
        .filter(n -> n.path("audios").isArray() && n.get("audios").size() > 0)
        .map(n -> new Audio(n.get("audios").get(0).asString(), "audio/wav"));
  }

  private static void part(ByteArrayOutputStream out, String boundary, String name, String value) throws IOException {
    out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n")
        .getBytes(StandardCharsets.UTF_8));
  }

  private Optional<JsonNode> call(String what, HttpRequest req) {
    for (int attempt = 1; attempt <= 2; attempt++) {
      try {
        HttpResponse<String> r = client().send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() == 429 || r.statusCode() / 100 == 5) {
          throw new IOException("HTTP " + r.statusCode());
        }
        if (r.statusCode() / 100 != 2) {
          breaker.failure();
          log.warn("Sarvam {} refused: HTTP {}", what, r.statusCode());
          return Optional.empty();
        }
        breaker.success();
        JsonNode n = json.tree(r.body());
        log.info("Sarvam {} ok, request_id={}", what, n.path("request_id").asString(""));
        return Optional.of(n);
      } catch (IOException | RuntimeException e) {
        log.warn("Sarvam {} failed (attempt {}): {}", what, attempt, e.getClass().getSimpleName());
        if (attempt == 2) {
          breaker.failure();
          return Optional.empty();
        }
        try {
          Thread.sleep(300L + (long) (Math.random() * 300));
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          return Optional.empty();
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return Optional.empty();
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
}
