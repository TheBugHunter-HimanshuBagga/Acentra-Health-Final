package com.claimshield.gateway.ai;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;

/** Opens after {@code threshold} failures inside {@code window}; stays open for {@code cooldown}, then half-opens. */
public final class CircuitBreaker {

  private final int threshold;
  private final Duration window;
  private final Duration cooldown;
  private final Clock clock;
  private final Deque<Long> failures = new ArrayDeque<>();
  private long openUntil = 0;

  public CircuitBreaker(int threshold, Duration window, Duration cooldown, Clock clock) {
    this.threshold = threshold;
    this.window = window;
    this.cooldown = cooldown;
    this.clock = clock;
  }

  public synchronized boolean allow() {
    return clock.millis() >= openUntil;
  }

  public synchronized boolean isOpen() {
    return !allow();
  }

  public synchronized void success() {
    failures.clear();
    openUntil = 0;
  }

  public synchronized void failure() {
    long now = clock.millis();
    failures.addLast(now);
    while (!failures.isEmpty() && now - failures.peekFirst() > window.toMillis()) {
      failures.pollFirst();
    }
    if (failures.size() >= threshold) {
      openUntil = now + cooldown.toMillis();
      failures.clear();
    }
  }
}
