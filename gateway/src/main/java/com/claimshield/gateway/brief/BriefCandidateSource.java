package com.claimshield.gateway.brief;

import java.util.Optional;
import tools.jackson.databind.JsonNode;

/**
 * Optional producer of a model-written brief. No implementation exists yet (LLM_MODE=template); when one is added
 * as a Spring bean, {@link BriefService} validates its output and falls back to the template if it fails.
 */
public interface BriefCandidateSource {

  record Candidate(JsonNode output, String stopReason, String model, String promptSha256, String responseSha256) {}

  /** attempt is 1 for the first try and 2 for the single retry. Empty means the source is unavailable. */
  Optional<Candidate> generate(String caseId, JsonNode pack, int attempt);
}
