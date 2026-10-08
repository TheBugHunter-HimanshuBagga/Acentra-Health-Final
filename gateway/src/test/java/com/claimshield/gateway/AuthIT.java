package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import tools.jackson.databind.JsonNode;

class AuthIT extends GatewayIT {

  @org.junit.jupiter.api.BeforeEach
  void resetPrefs() {
    jdbc.update("UPDATE wf_user_pref SET language = 'en', onboarded = 0, onboarding_skipped = 0");
  }

  @Test
  void loginReturnsTheProfileWithRoleAndPreferences() throws Exception {
    MvcResult r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(Map.of("username", "investigator", "password",
            passwords().get("investigator"))))).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(200);
    JsonNode me = body(r);
    assertThat(me.get("role").asString()).isEqualTo("INVESTIGATOR");
    assertThat(me.get("language").asString()).isEqualTo("en");
    assertThat(me.get("onboarded").asBoolean()).isFalse();
    assertThat(me.has("password") || me.has("passwordHash")).isFalse();
  }

  @Test
  void wrongPasswordAndUnknownUserGiveTheSameAnswer() throws Exception {
    Object bad = Map.of("username", "investigator", "password", "not-the-password");
    Object ghost = Map.of("username", "nobody", "password", "whatever");
    MvcResult a = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(bad))).andReturn();
    MvcResult b = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(ghost))).andReturn();
    for (MvcResult r : new MvcResult[] {a, b}) {
      assertThat(r.getResponse().getStatus()).isEqualTo(401);
      assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
      assertThat(body(r).get("code").asString()).isEqualTo("INVALID_CREDENTIALS");
      assertThat(body(r).get("detail").asString()).isEqualTo("The username or password is incorrect.");
    }
    assertThat(auditCount("AUTH_LOGIN_FAILED")).isGreaterThanOrEqualTo(2);
  }

  @Test
  void anonymousRequestsAreRefusedWithAProblemDocument() throws Exception {
    for (String url : new String[] {"/api/queue", "/api/auth/me", "/api/audit", "/api/cases/CASE-0001"}) {
      MvcResult r = mvc.perform(MockMvcRequestBuilders.get(url)).andReturn();
      assertThat(r.getResponse().getStatus()).as(url).isEqualTo(401);
      assertThat(body(r).get("code").asString()).isEqualTo("AUTH_REQUIRED");
    }
    assertThat(mvc.perform(MockMvcRequestBuilders.get("/api/health")).andReturn().getResponse().getStatus()).isEqualTo(200);
  }

  @Test
  void logoutEndsTheSession() throws Exception {
    MockHttpSession s = session("auditor");
    call("auditor", HttpMethod.POST, "/api/auth/logout", null, 204);
    MvcResult r = mvc.perform(MockMvcRequestBuilders.get("/api/auth/me").session(s)).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void preferencesPersistAndAreValidated() throws Exception {
    JsonNode p = call("investigator", HttpMethod.PUT, "/api/me/prefs",
        Map.of("language", "hi", "onboarded", true, "onboardingSkipped", true), 200);
    assertThat(p.get("language").asString()).isEqualTo("hi");
    assertThat(p.get("onboarded").asBoolean()).isTrue();
    assertThat(get("investigator", "/api/auth/me").get("language").asString()).isEqualTo("hi");
    expectProblem("investigator", HttpMethod.PUT, "/api/me/prefs", Map.of("language", "Hindi!!"), 422,
        "VALIDATION_FAILED");
  }

  @Test
  void demoRoleSwitchChangesTheActingUserAndIsAudited() throws Exception {
    long before = auditCount("AUTH_SWITCH_ROLE");
    JsonNode me = call("investigator", HttpMethod.POST, "/api/auth/switch-role", Map.of("role", "SUPERVISOR"), 200);
    assertThat(me.get("role").asString()).isEqualTo("SUPERVISOR");
    assertThat(auditCount("AUTH_SWITCH_ROLE")).isEqualTo(before + 1);
    expectProblem("investigator", HttpMethod.POST, "/api/auth/switch-role", Map.of("role", "KING"), 422,
        "VALIDATION_FAILED");
  }

  @Test
  void passwordsAreStoredHashedNeverInTheClear() {
    for (String hash : jdbc.queryForList("SELECT password_hash FROM wf_user", String.class)) {
      assertThat(hash).startsWith("$2");
      assertThat(passwords().values()).doesNotContain(hash);
    }
  }
}
