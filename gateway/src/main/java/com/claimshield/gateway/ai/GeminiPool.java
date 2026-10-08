package com.claimshield.gateway.ai;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Rotates several Gemini API keys so the combined free-tier quota is used without 429s.
 *
 * <p>Each key tracks requests and tokens in a sliding one-minute window against safety limits (a fraction of the
 * model's published free-tier quota, tightened further whenever Google answers 429). A key that returns 429 is cooled
 * down for the delay Google asks for; a key that fails repeatedly is circuit-broken and recovers by itself after the
 * cooldown. {@link #acquire} always picks the healthy key with the most headroom. Key material is held only in this
 * object and is never logged or returned: callers see the key's position ({@code key-1}) only.
 */
public class GeminiPool {

  /** Approximate free-tier quota of a model family (per key). Used only as the starting point; 429s refine it. */
  public record Limits(int rpm, int tpm) {
    static Limits forModel(String model, int rpmOverride, int tpmOverride) {
      String m = model == null ? "" : model.toLowerCase();
      int rpm = m.contains("pro") ? 5 : m.contains("lite") ? 15 : 10;
      int tpm = 250_000;
      return new Limits(rpmOverride > 0 ? rpmOverride : rpm, tpmOverride > 0 ? tpmOverride : tpm);
    }
  }

  /** What a caller gets for one request: the key to use and its position, valid until {@link #release} is called. */
  public record Lease(int index, String id, String secret) {}

  static final double HEADROOM = 0.8;
  static final long WINDOW_MS = 60_000;

  static final class Key {
    final int index;
    final String secret;
    final Deque<Long> requests = new ArrayDeque<>();
    final Deque<long[]> tokens = new ArrayDeque<>();      // {timestamp, tokens}
    int rpm;
    int tpm;
    long cooldownUntil;
    int consecutiveFailures;
    boolean invalid;
    long calls;
    long tokenTotal;
    long rateLimited;
    long errors;
    long lastUsed;

    Key(int index, String secret, Limits l) {
      this.index = index;
      this.secret = secret;
      this.rpm = l.rpm();
      this.tpm = l.tpm();
    }

    String id() {
      return "key-" + (index + 1);
    }

    void prune(long now) {
      while (!requests.isEmpty() && now - requests.peekFirst() > WINDOW_MS) {
        requests.pollFirst();
      }
      while (!tokens.isEmpty() && now - tokens.peekFirst()[0] > WINDOW_MS) {
        tokens.pollFirst();
      }
    }

    long tokenSum() {
      long s = 0;
      for (long[] t : tokens) {
        s += t[1];
      }
      return s;
    }
  }

  private final List<Key> keys = new ArrayList<>();
  private final Clock clock;
  private final Limits base;

  public GeminiPool(List<String> secrets, String model, int rpmOverride, int tpmOverride, Clock clock) {
    this.clock = clock;
    this.base = Limits.forModel(model, rpmOverride, tpmOverride);
    int i = 0;
    for (String s : secrets) {
      if (s != null && !s.isBlank()) {
        keys.add(new Key(i++, s.trim(), base));
      }
    }
  }

  public int size() {
    return keys.size();
  }

  /** Picks the usable key with the lowest utilisation, or empty when every key is cooling down or full. */
  public synchronized Optional<Lease> acquire(int estimatedTokens) {
    long now = clock.millis();
    Key best = null;
    double bestLoad = Double.MAX_VALUE;
    for (Key k : keys) {
      if (k.invalid || now < k.cooldownUntil) {
        continue;
      }
      k.prune(now);
      double reqLoad = (k.requests.size() + 1.0) / Math.max(1, k.rpm * HEADROOM);
      double tokLoad = (k.tokenSum() + estimatedTokens) / Math.max(1.0, k.tpm * HEADROOM);
      if (reqLoad > 1.0 || tokLoad > 1.0) {
        continue;
      }
      double load = Math.max(reqLoad, tokLoad);
      if (load < bestLoad || (load == bestLoad && best != null && k.lastUsed < best.lastUsed)) {
        best = k;
        bestLoad = load;
      }
    }
    if (best == null) {
      return Optional.empty();
    }
    best.requests.addLast(now);
    best.lastUsed = now;
    best.calls++;
    return Optional.of(new Lease(best.index, best.id(), best.secret));
  }

  /** Milliseconds until some key could take a request, or -1 if none will (all invalid). Lets callers wait briefly. */
  public synchronized long millisUntilAvailable() {
    long now = clock.millis();
    long best = Long.MAX_VALUE;
    for (Key k : keys) {
      if (k.invalid) {
        continue;
      }
      k.prune(now);
      long wait = Math.max(0, k.cooldownUntil - now);
      if (k.requests.size() >= k.rpm * HEADROOM && !k.requests.isEmpty()) {
        wait = Math.max(wait, WINDOW_MS - (now - k.requests.peekFirst()));
      }
      best = Math.min(best, wait);
    }
    return best == Long.MAX_VALUE ? -1 : best;
  }

  public synchronized void success(Lease l, int tokensUsed) {
    Key k = keys.get(l.index());
    k.consecutiveFailures = 0;
    k.tokens.addLast(new long[] {clock.millis(), tokensUsed});
    k.tokenTotal += tokensUsed;
  }

  /** Google said 429: stop using the key for {@code retryAfterMs} and, if it told us the quota, adopt 80% of it. */
  public synchronized void rateLimited(Lease l, long retryAfterMs, Integer quotaPerMinute) {
    Key k = keys.get(l.index());
    k.rateLimited++;
    k.cooldownUntil = clock.millis() + Math.max(1_000, Math.min(retryAfterMs, 10 * 60_000));
    if (quotaPerMinute != null && quotaPerMinute > 0) {
      k.rpm = Math.max(1, Math.min(k.rpm, quotaPerMinute));
    } else {
      k.rpm = Math.max(2, (int) Math.floor(k.rpm * 0.75));       // we were too optimistic: back off
    }
  }

  /** Transport error or 5xx. Three in a row open the breaker for a minute; one success closes it. */
  public synchronized void failed(Lease l) {
    Key k = keys.get(l.index());
    k.errors++;
    if (++k.consecutiveFailures >= 3) {
      k.cooldownUntil = clock.millis() + 60_000;
      k.consecutiveFailures = 0;
    }
  }

  /** 400/403: the key is unusable (revoked, wrong project). Park it for a long time rather than hammering. */
  public synchronized void rejected(Lease l) {
    Key k = keys.get(l.index());
    k.errors++;
    k.cooldownUntil = clock.millis() + 15 * 60_000;
  }

  public synchronized boolean anyUsable() {
    long now = clock.millis();
    return keys.stream().anyMatch(k -> !k.invalid && now >= k.cooldownUntil);
  }

  /** Safe to publish: positions, counters and state only. */
  public synchronized List<Map<String, Object>> stats() {
    long now = clock.millis();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Key k : keys) {
      k.prune(now);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("key", k.id());
      m.put("state", k.invalid ? "INVALID" : now < k.cooldownUntil ? "COOLING_DOWN" : "READY");
      m.put("cooldownSeconds", Math.max(0, (k.cooldownUntil - now) / 1000));
      m.put("requestsLastMinute", k.requests.size());
      m.put("tokensLastMinute", k.tokenSum());
      m.put("rpmLimit", k.rpm);
      m.put("tpmLimit", k.tpm);
      m.put("calls", k.calls);
      m.put("tokens", k.tokenTotal);
      m.put("rateLimited", k.rateLimited);
      m.put("errors", k.errors);
      out.add(m);
    }
    return out;
  }
}
