package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Base for integration tests: boots the real app (security, JDBC, schema init, seeding) against a FRESH COPY of
 * serving_fixture.db, which is real engine output (regenerate with `npm run fixture`).
 */
@SpringBootTest(properties = "claimshield.demo-mode=true")
@AutoConfigureMockMvc
// each test class gets its own context, hence its own fresh copy of the fixture database
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
public abstract class GatewayIT {

  @Autowired protected MockMvc mvc;
  @Autowired protected JsonMapper json;
  @Autowired protected JdbcTemplate jdbc;

  private final Map<String, MockHttpSession> sessions = new HashMap<>();

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", GatewayIT::freshDatabaseUrl);
  }

  static String freshDatabaseUrl() {
    try {
      Path dir = Path.of("target", "it");
      Files.createDirectories(dir);
      Path db = dir.resolve(UUID.randomUUID() + ".db").toAbsolutePath();
      // -Dgateway.fixture=<path> points the suite at a freshly generated engine database (see scripts/e2e-m1.mjs)
      Path source = Path.of(System.getProperty("gateway.fixture", "src/test/resources/serving_fixture.db"));
      Files.copy(source, db, StandardCopyOption.REPLACE_EXISTING);
      return "jdbc:sqlite:" + db + "?journal_mode=WAL&busy_timeout=5000&foreign_keys=on";
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** username -> password from the seed file the app itself uses. */
  protected static Map<String, String> passwords() {
    try {
      Map<String, String> out = new HashMap<>();
      for (String line : Files.readAllLines(Path.of("src", "main", "resources", "demo-users.csv"),
          StandardCharsets.UTF_8)) {
        if (line.isBlank() || line.startsWith("#")) continue;
        String[] f = line.split(",", 4);
        out.put(f[0], f[3]);
      }
      return out;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @BeforeEach
  void clearSessions() {
    sessions.clear();
  }

  protected MockHttpSession session(String user) throws Exception {
    MockHttpSession s = sessions.get(user);
    if (s != null) return s;
    MvcResult r = mvc.perform(request(HttpMethod.POST, "/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(Map.of("username", user, "password", passwords().get(user))))).andReturn();
    assertThat(r.getResponse().getStatus()).as("login as " + user).isEqualTo(200);
    s = (MockHttpSession) r.getRequest().getSession(false);
    assertThat(s).isNotNull();
    sessions.put(user, s);
    return s;
  }

  protected MvcResult send(String user, HttpMethod method, String url, Object body, String... headers)
      throws Exception {
    MockHttpServletRequestBuilder b = request(method, url).session(session(user)).with(csrf())
        .accept(MediaType.APPLICATION_JSON, MediaType.APPLICATION_PROBLEM_JSON);
    if (body != null) {
      b.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
    }
    for (int i = 0; i + 1 < headers.length; i += 2) {
      b.header(headers[i], headers[i + 1]);
    }
    return mvc.perform(b).andReturn();
  }

  protected JsonNode body(MvcResult r) {
    String s;
    try {
      s = r.getResponse().getContentAsString();
    } catch (java.io.UnsupportedEncodingException e) {
      throw new UncheckedIOException(e);
    }
    return s.isEmpty() ? null : json.readTree(s);
  }

  /** Performs the call, asserts the status, returns the parsed body. */
  protected JsonNode call(String user, HttpMethod method, String url, Object body, int expected, String... headers)
      throws Exception {
    MvcResult r = send(user, method, url, body, headers);
    assertThat(r.getResponse().getStatus()).as(method + " " + url + " as " + user + " -> "
        + r.getResponse().getContentAsString()).isEqualTo(expected);
    return body(r);
  }

  protected JsonNode get(String user, String url) throws Exception {
    return call(user, HttpMethod.GET, url, null, 200);
  }

  protected void expectProblem(String user, HttpMethod method, String url, Object body, int status, String code)
      throws Exception {
    MvcResult r = send(user, method, url, body);
    assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
    assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
    assertThat(body(r).get("code").asString()).isEqualTo(code);
  }

  /** First case in the queue with the given hypothesis code and tier. */
  protected String caseWith(String scheme, String tier) throws Exception {
    JsonNode q = get("investigator", "/api/queue?scheme=" + scheme + "&tier=" + tier);
    assertThat(q.get("items")).as("a " + tier + " " + scheme + " case exists in the fixture").isNotEmpty();
    return q.get("items").get(0).get("caseId").asString();
  }

  protected List<String> allCaseIds() throws Exception {
    List<String> ids = new java.util.ArrayList<>();
    get("investigator", "/api/queue?capacityHours=1000").get("items").forEach(i -> ids.add(i.get("caseId").asString()));
    return ids;
  }

  protected long auditCount() {
    Long n = jdbc.queryForObject("SELECT COUNT(*) FROM wf_audit_event", Long.class);
    return n == null ? 0 : n;
  }

  protected long auditCount(String eventType) {
    Long n = jdbc.queryForObject("SELECT COUNT(*) FROM wf_audit_event WHERE event_type = ?", Long.class, eventType);
    return n == null ? 0 : n;
  }

  protected void resetWorkflow() {
    jdbc.update("DELETE FROM wf_review_action");
    jdbc.update("DELETE FROM wf_precedent");
    jdbc.update("DELETE FROM wf_case_state");
  }
}
