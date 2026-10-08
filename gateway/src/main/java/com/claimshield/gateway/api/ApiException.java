package com.claimshield.gateway.api;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/** A client-visible failure with a stable machine-readable code (see the implementation architecture, section 7). */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String code;
  private final String title;
  private final List<Map<String, String>> errors;

  public ApiException(HttpStatus status, String code, String title, String detail) {
    this(status, code, title, detail, List.of());
  }

  public ApiException(HttpStatus status, String code, String title, String detail,
      List<Map<String, String>> errors) {
    super(detail);
    this.status = status;
    this.code = code;
    this.title = title;
    this.errors = errors;
  }

  public HttpStatus status() { return status; }
  public String code() { return code; }
  public String title() { return title; }
  public List<Map<String, String>> errors() { return errors; }

  public static ApiException notFound(String what) {
    return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found", what + " was not found.");
  }

  public static ApiException forbiddenRole(String detail) {
    return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "Your role cannot do this", detail);
  }

  public static ApiException conflict(String detail) {
    return new ApiException(HttpStatus.CONFLICT, "STATE_CONFLICT", "State conflict", detail);
  }

  public static ApiException invalid(String field, String message) {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "Validation failed",
        field + ": " + message, List.of(Map.of("field", field, "message", message)));
  }
}
