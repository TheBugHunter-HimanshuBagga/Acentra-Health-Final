package com.claimshield.gateway.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.config.Json;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

/** The key pool's rotation, limits and recovery, and the client's behaviour against a local fake Gemini. */
class GeminiTest {

  static final JsonMapper M = JsonMapper.builder().build();
  static final Json JSON = new Json(M);

  static final class Tick extends Clock {
    long now = 5_000_000;

    @Override
    public java.time.ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(java.time.ZoneId z) {
      return this;
    }

    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(now);
    }
  }

  // ------------------------------------------------------------------------------------------------ the pool
  @Test
  void requestsSpreadAcrossKeysAndRespectTheSafetyHeadroom() {
    Tick c = new Tick();
    GeminiPool p = new GeminiPool(List.of("a", "b", "c"), "gemini-3.1-flash-lite", 10, 1_000_000, c);
    List<String> used = new ArrayList<>();
    for (int i = 0; i < 24; i++) {                                    // 3 keys x 10 rpm x 0.8 headroom = 24 per minute
      used.add(p.acquire(100).orElseThrow().id());
    }
    assertThat(used).containsOnly("key-1", "key-2", "key-3");
    assertThat(used.stream().filter("key-1"::equals).count()).isEqualTo(8);
    assertThat(p.acquire(100)).as("the safe capacity is used up, so the caller waits or falls back").isEmpty();
    assertThat(p.millisUntilAvailable()).isBetween(1L, 60_000L);
    c.now += 61_000;
    assertThat(p.acquire(100)).isPresent();
  }

  @Test
  void aRateLimitedKeyCoolsDownTheOthersCarryOnAndItRecovers() {
    Tick c = new Tick();
    GeminiPool p = new GeminiPool(List.of("a", "b"), "gemini-3.1-flash-lite", 10, 1_000_000, c);
    GeminiPool.Lease first = p.acquire(10).orElseThrow();
    p.rateLimited(first, 30_000, 6);                                   // Google says: 6 per minute, retry in 30 s
    for (int i = 0; i < 5; i++) {
      assertThat(p.acquire(10).orElseThrow().id()).isNotEqualTo(first.id());
    }
    assertThat(p.stats().get(first.index())).containsEntry("state", "COOLING_DOWN").containsEntry("rpmLimit", 6)
        .containsEntry("rateLimited", 1L);
    c.now += 31_000;
    assertThat(p.stats().get(first.index())).containsEntry("state", "READY");
    assertThat(p.stats().toString()).as("only positions and counters are ever published").doesNotContain("a=").doesNotContain("secret");
  }

  @Test
  void repeatedFailuresOpenTheBreakerAndASuccessKeepsItClosed() {
    Tick c = new Tick();
    GeminiPool p = new GeminiPool(List.of("a"), "gemini-3.1-flash-lite", 10, 1_000_000, c);
    for (int i = 0; i < 2; i++) {
      p.failed(p.acquire(1).orElseThrow());
    }
    GeminiPool.Lease ok = p.acquire(1).orElseThrow();
    p.success(ok, 10);                                                 // a success resets the count
    for (int i = 0; i < 2; i++) {
      p.failed(p.acquire(1).orElseThrow());
    }
    assertThat(p.anyUsable()).isTrue();
    p.failed(p.acquire(1).orElseThrow());
    assertThat(p.anyUsable()).isFalse();
    c.now += 61_000;
    assertThat(p.anyUsable()).isTrue();
  }

  @Test
  void limitsAreModelAwareAndAnUnexpectedRateLimitTightensThem() {
    assertThat(GeminiPool.Limits.forModel("gemini-3.1-flash-lite", 0, 0).rpm()).isEqualTo(15);
    assertThat(GeminiPool.Limits.forModel("gemini-2.5-pro", 0, 0).rpm()).isEqualTo(5);
    assertThat(GeminiPool.Limits.forModel("gemini-2.5-flash", 0, 0).rpm()).isEqualTo(10);
    assertThat(GeminiPool.Limits.forModel("x", 7, 9).tpm()).isEqualTo(9);
    Tick c = new Tick();
    GeminiPool p = new GeminiPool(List.of("a"), "gemini-3.1-flash-lite", 12, 1_000_000, c);
    p.rateLimited(p.acquire(1).orElseThrow(), 1_000, null);
    assertThat(p.stats().get(0)).containsEntry("rpmLimit", 9);
  }

  // ----------------------------------------------------------------------------------- the client, fake server
  private HttpServer server;
  private final List<String> seenKeys = new CopyOnWriteArrayList<>();

  @AfterEach
  void stop() {
    if (server != null) {
      server.stop(0);
    }
  }

  private GeminiLlmClient client(String... keys) throws Exception {
    try {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    } catch (java.io.IOException e) {
      org.junit.jupiter.api.Assumptions.abort("this sandbox cannot open a loopback port; run the suite in a normal terminal");
    }
    server.createContext("/", ex -> {
      String key = ex.getRequestHeaders().getFirst("x-goog-api-key");
      seenKeys.add(key);
      byte[] body;
      int code;
      if ("limited".equals(key)) {
        code = 429;
        body = "{\"error\":{\"code\":429,\"details\":[{\"retryDelay\":\"20s\"}]}}".getBytes(StandardCharsets.UTF_8);
      } else if ("broken".equals(key)) {
        code = 403;
        body = "{\"error\":{\"code\":403}}".getBytes(StandardCharsets.UTF_8);
      } else {
        code = 200;
        body = ("{\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"text\":\"{\\\"answer\\\":\\\"ok\\\"}\"}]}}],"
            + "\"usageMetadata\":{\"totalTokenCount\":321}}").getBytes(StandardCharsets.UTF_8);
      }
      ex.sendResponseHeaders(code, body.length);
      ex.getResponseBody().write(body);
      ex.close();
    });
    server.start();
    MockEnvironment env = new MockEnvironment().withProperty("claimshield.llm.mode", "live")
        .withProperty("claimshield.gemini.base-url", "http://127.0.0.1:" + server.getAddress().getPort())
        .withProperty("claimshield.gemini.model", "gemini-3.1-flash-lite")
        .withProperty("claimshield.gemini.rpm", "10");
    String[] names = {"claimshield.gemini.key", "claimshield.gemini.key-2", "claimshield.gemini.key-3"};
    for (int i = 0; i < keys.length; i++) {
      env.setProperty(names[i], keys[i]);
    }
    return new GeminiLlmClient(JSON, Clock.systemUTC(), env);
  }

  @Test
  void a429OnOneKeyRotatesToTheNextWithoutFailingTheRequest() throws Exception {
    GeminiLlmClient g = client("limited", "good");
    Optional<LlmClient.Result> r = g.structured("TEST", "sys", "user", M.readTree("{\"type\":\"object\"}"), "t", "x");
    assertThat(r).isPresent();
    assertThat(r.get().output().get("answer").asString()).isEqualTo("ok");
    assertThat(r.get().stopReason()).isEqualTo("tool_use");
    assertThat(r.get().model()).isEqualTo("gemini-3.1-flash-lite");
    assertThat(seenKeys).contains("good");
    assertThat(g.pool().stats().get(0)).containsEntry("state", "COOLING_DOWN");
    assertThat(g.pool().stats().get(1)).containsEntry("tokens", 321L);
    assertThat(g.status()).isEqualTo("LIVE");
  }

  @Test
  void identicalRequestsAreAnsweredFromTheCacheAndOnlyOneCallIsMade() throws Exception {
    GeminiLlmClient g = client("good");
    g.structured("TEST", "sys", "same evidence", null, "t", "x");
    g.structured("TEST", "sys", "same evidence", null, "t", "x");
    g.structured("TEST", "sys", "other evidence", null, "t", "x");
    assertThat(seenKeys).hasSize(2);
  }

  @Test
  void anInvalidKeyIsParkedAndTheCallStillSucceedsOnAnother() throws Exception {
    GeminiLlmClient g = client("broken", "good");
    assertThat(g.structured("TEST", "sys", "user", null, "t", "x")).isPresent();
    assertThat(g.pool().stats().get(0)).containsEntry("state", "COOLING_DOWN");
  }

  @Test
  void withNoKeysOrInTemplateModeNothingIsCalled() throws Exception {
    MockEnvironment env = new MockEnvironment().withProperty("claimshield.llm.mode", "live");
    GeminiLlmClient none = new GeminiLlmClient(JSON, Clock.systemUTC(), env);
    assertThat(none.status()).isEqualTo("TEMPLATE");
    assertThat(none.structured("TEST", "s", "u", null, "t", "x")).isEmpty();
    MockEnvironment tpl = new MockEnvironment().withProperty("claimshield.llm.mode", "template")
        .withProperty("claimshield.gemini.key", "k");
    assertThat(new GeminiLlmClient(JSON, Clock.systemUTC(), tpl).status()).isEqualTo("TEMPLATE");
  }

  @Test
  void whenEveryKeyIsRateLimitedTheCallerGetsTheDeterministicFallback() throws Exception {
    GeminiLlmClient g = client("limited", "limited");
    assertThat(g.structured("TEST", "sys", "user", null, "t", "x")).isEmpty();
    assertThat(g.status()).isEqualTo("DEGRADED");
  }
}
