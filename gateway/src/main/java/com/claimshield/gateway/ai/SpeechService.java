package com.claimshield.gateway.ai;

import java.util.Optional;

/**
 * Indian-language speech and translation, server-side only. The browser never talks to Sarvam and never sees the key.
 * Every method returns empty when the service is off, degraded or the call fails; callers then fall back to English
 * text, typed input, or text-only answers.
 */
public interface SpeechService {

  record Transcript(String text, String languageCode, double languageProbability) {}

  record Audio(String base64, String mimeType) {}

  /** ON (configured, healthy), OFF (not enabled / no key) or DEGRADED (breaker open). */
  String status();

  default boolean on() {
    return "ON".equals(status());
  }

  /** Translate between language codes such as en-IN and hi-IN. */
  Optional<String> translate(String text, String sourceLanguage, String targetLanguage);

  Optional<Transcript> transcribe(byte[] audio, String filename, String contentType, String languageCode);

  Optional<Audio> speak(String text, String languageCode);
}
