package com.claimshield.gateway.engine;

import tools.jackson.databind.JsonNode;

/**
 * The gateway's only way to ask the Python engine to do analytics work (re-run, simulate, propose, precedent checks).
 * The engine is internal: it listens on 127.0.0.1 and wants a shared secret. If it is down or slow the gateway still
 * serves every stored result; only these write-side operations are refused, with a clear explanation.
 */
public interface EngineClient {

  /** POST a JSON body and return the JSON answer. */
  JsonNode post(String path, Object body);

  JsonNode get(String path);

  /** True if the engine answered its health check recently. */
  boolean healthy();

  /** A failed call: status 0 = the engine could not be reached, anything else = the HTTP status it answered. */
  class EngineException extends RuntimeException {
    private final int status;

    public EngineException(int status, String message) {
      super(message);
      this.status = status;
    }

    public int status() {
      return status;
    }
  }
}
