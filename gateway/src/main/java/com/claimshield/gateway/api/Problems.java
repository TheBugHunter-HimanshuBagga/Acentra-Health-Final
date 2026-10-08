package com.claimshield.gateway.api;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import tools.jackson.databind.json.JsonMapper;

/** Builds RFC 9457 problem documents (application/problem+json) for both controllers and security filters. */
public final class Problems {

  private Problems() {}

  public static ProblemDetail of(HttpStatus status, String code, String title, String detail,
      List<Map<String, String>> errors) {
    ProblemDetail p = ProblemDetail.forStatusAndDetail(status, detail);
    p.setType(java.net.URI.create("https://claimshield.local/errors/" + code.toLowerCase().replace('_', '-')));
    p.setTitle(title);
    p.setProperty("code", code);
    p.setProperty("traceId", UUID.randomUUID().toString().replace("-", ""));
    if (errors != null && !errors.isEmpty()) {
      p.setProperty("errors", errors);
    }
    return p;
  }

  /** For code that runs before Spring MVC (security entry points). */
  public static void write(HttpServletResponse res, JsonMapper mapper, HttpStatus status, String code,
      String title, String detail) throws IOException {
    res.setStatus(status.value());
    res.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
    res.setCharacterEncoding("UTF-8");
    res.getWriter().write(mapper.writeValueAsString(of(status, code, title, detail, List.of())));
  }
}
