package com.claimshield.gateway.brief;

import java.util.Optional;
import tools.jackson.databind.JsonNode;

/**
 * Optional producer of a model-written brief. No implementation exists yet (LLM_MODE=template); when one is added
 * as a Spring bean, {@link BriefService} validates its output and falls back to the template if it fails.
 */
public interface BriefCandidateSource {

  record Candidate(JsonNode output, String stopReason, String model, String promptSha256, String responseSha256,
      long latencyMs) {
    public Candidate(JsonNode output, String stopReason, String model, String promptSha256, String responseSha256) {
      this(output, stopReason, model, promptSha256, responseSha256, 0L);
    }
  }

  /** False when no model is configured or healthy: the deterministic template is then the normal path. */
  default boolean available() {
    return true;
  }

  /**
   * attempt is 1 for the first try and 2 for the single retry; hint lists the checks the previous attempt failed (or
   * null). Empty means the source could not answer.
   */
  Optional<Candidate> generate(String caseId, JsonNode pack, int attempt, String hint);
}
