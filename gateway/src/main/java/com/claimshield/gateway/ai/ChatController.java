package com.claimshield.gateway.ai;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.auth.AppUser;
import com.claimshield.gateway.config.Tx;
import jakarta.validation.constraints.NotBlank;
import java.io.IOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Chat and voice. All external calls (Claude, Sarvam) happen here, on the server; the browser sends only text/audio. */
@RestController
@RequestMapping("/api")
public class ChatController {

  public record ChatBody(String sessionId, @NotBlank String message, String lang, Boolean speak,
      ChatService.Context context) {}

  public record SpeakBody(@NotBlank String text, String lang) {}

  static final long MAX_AUDIO_BYTES = 3L * 1024 * 1024;
  static final Set<String> AUDIO_TYPES = Set.of("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav",
      "audio/x-wav", "audio/wave", "audio/aac", "audio/x-m4a", "video/webm");

  private final ChatService chat;
  private final SpeechService speech;
  private final AuditService audit;
  private final Tx tx;

  public ChatController(ChatService chat, SpeechService speech, AuditService audit, Tx tx) {
    this.chat = chat;
    this.speech = speech;
    this.audit = audit;
    this.tx = tx;
  }

  @PostMapping("/chat")
  public Map<String, Object> chat(@AuthenticationPrincipal AppUser u, @RequestBody ChatBody body) {
    return chat.chat(u, new ChatService.Request(body.sessionId(), body.message(), body.lang(), body.speak(),
        body.context()));
  }

  @GetMapping("/chat/{sessionId}")
  public List<Map<String, Object>> history(@AuthenticationPrincipal AppUser u, @PathVariable String sessionId) {
    return chat.history(u, sessionId);
  }

  // ------------------------------------------------------------------------------------------------- voice
  private Map<String, Object> doTranscribe(AppUser u, MultipartFile audio, String language) {
    if (!speech.on()) {
      throw voiceUnavailable();
    }
    if (audio == null || audio.isEmpty()) {
      throw ApiException.invalid("audio", "no audio was received");
    }
    if (audio.getSize() > MAX_AUDIO_BYTES) {
      throw ApiException.invalid("audio", "too long: keep recordings under about 28 seconds");
    }
    String type = audio.getContentType() == null ? "" : audio.getContentType().toLowerCase().split(";")[0].trim();
    if (!AUDIO_TYPES.contains(type)) {
      throw ApiException.invalid("audio", "unsupported audio type " + type);
    }
    String code = ChatService.LANG.getOrDefault(language, "unknown");
    Optional<SpeechService.Transcript> t;
    try {
      t = speech.transcribe(audio.getBytes(), audio.getOriginalFilename() == null ? "audio" : audio.getOriginalFilename(),
          type, code);
    } catch (IOException e) {
      throw voiceUnavailable();
    }
    long bytes = audio.getSize();
    tx.write(() -> audit.append(u.username(), u.role().name(), "SARVAM_CALL", "voice", "stt",
        Map.of("endpoint", "speech-to-text", "language", code, "bytes", bytes, "outcome", t.isPresent() ? "OK"
            : "FAILED")));          // never the audio, never the transcript
    SpeechService.Transcript tr = t.orElseThrow(ChatController::voiceUnavailable);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("transcript", tr.text());
    out.put("languageCode", tr.languageCode());
    out.put("languageProbability", tr.languageProbability());
    out.put("needsConfirmation", tr.languageProbability() < 0.6);
    return out;
  }

  private static ApiException voiceUnavailable() {
    return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "VOICE_UNAVAILABLE", "Voice is unavailable",
        "Voice is unavailable right now, please type your question. Typed chat is unaffected.");
  }

  @PostMapping("/voice/transcribe")
  public Map<String, Object> transcribe(@AuthenticationPrincipal AppUser u, @RequestParam("audio") MultipartFile audio,
      @RequestParam(defaultValue = "en") String language) {
    return doTranscribe(u, audio, language);
  }

  /** Speech in, validated answer out. The transcript is returned so the person can see what was understood. */
  @PostMapping("/voice/chat")
  public Map<String, Object> voiceChat(@AuthenticationPrincipal AppUser u, @RequestParam("audio") MultipartFile audio,
      @RequestParam(defaultValue = "en") String language, @RequestParam(required = false) String sessionId,
      @RequestParam(required = false) String caseId, @RequestParam(required = false) String page,
      @RequestParam(required = false) Integer horizon) {
    Map<String, Object> t = doTranscribe(u, audio, language);
    Map<String, Object> out = new LinkedHashMap<>(chat.chat(u, new ChatService.Request(sessionId,
        (String) t.get("transcript"), language, true, new ChatService.Context(page, caseId, horizon))));
    out.put("transcript", t.get("transcript"));
    out.put("languageProbability", t.get("languageProbability"));
    out.put("needsConfirmation", t.get("needsConfirmation"));
    return out;
  }

  @PostMapping("/voice/speak")
  public Map<String, Object> speak(@AuthenticationPrincipal AppUser u, @RequestBody SpeakBody body) {
    if (!speech.on()) {
      throw voiceUnavailable();
    }
    if (body.text().length() > 2500) {
      throw ApiException.invalid("text", "keep it under 2,500 characters");
    }
    String code = ChatService.LANG.getOrDefault(body.lang(), "en-IN");
    Optional<SpeechService.Audio> a = speech.speak(body.text(), code);
    tx.write(() -> audit.append(u.username(), u.role().name(), "SARVAM_CALL", "voice", "tts",
        Map.of("endpoint", "text-to-speech", "language", code, "characters", body.text().length(),
            "outcome", a.isPresent() ? "OK" : "FAILED")));
    SpeechService.Audio audio = a.orElseThrow(ChatController::voiceUnavailable);
    return Map.of("audio", Map.of("base64", audio.base64(), "mimeType", audio.mimeType()), "bytes",
        Base64.getDecoder().decode(audio.base64()).length);
  }
}
