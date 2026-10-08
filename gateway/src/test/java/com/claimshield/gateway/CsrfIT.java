package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * The REAL cookie-based CSRF handshake a browser performs.
 *
 * Kept in its own class on purpose: Spring's csrf() test helper permanently replaces the shared CsrfFilter's token
 * repository inside a Spring context, so any test that uses it (GatewayIT.send does) would disable the real cookie
 * mechanism for later tests in the same context. Nothing in this class may call send()/call()/get(user, url).
 */
class CsrfIT extends GatewayIT {

  @Test
  void theCookieIsIssuedOnTheFirstGetAndTheTokenIsRequiredOnMutatingCalls() throws Exception {
    MockHttpSession s = session("investigator");
    MvcResult first = mvc.perform(MockMvcRequestBuilders.get("/api/auth/me").session(s)).andReturn();
    Cookie xsrf = first.getResponse().getCookie("XSRF-TOKEN");
    assertThat(xsrf).as("XSRF-TOKEN cookie is sent on the first GET").isNotNull();
    assertThat(xsrf.isHttpOnly()).as("the single-page app must be able to read it").isFalse();

    MvcResult noToken = mvc.perform(post("/api/auth/switch-role").session(s).contentType(MediaType.APPLICATION_JSON)
        .content("{\"role\":\"SUPERVISOR\"}")).andReturn();
    assertThat(noToken.getResponse().getStatus()).isEqualTo(403);
    assertThat(body(noToken).get("code").asString()).isEqualTo("CSRF_INVALID");

    MvcResult wrongToken = mvc.perform(post("/api/auth/switch-role").session(s).cookie(xsrf)
        .header("X-XSRF-TOKEN", "not-the-token").contentType(MediaType.APPLICATION_JSON)
        .content("{\"role\":\"SUPERVISOR\"}")).andReturn();
    assertThat(wrongToken.getResponse().getStatus()).isEqualTo(403);

    MvcResult withToken = mvc.perform(post("/api/auth/switch-role").session(s).cookie(xsrf)
        .header("X-XSRF-TOKEN", xsrf.getValue()).contentType(MediaType.APPLICATION_JSON)
        .content("{\"role\":\"SUPERVISOR\"}")).andReturn();
    assertThat(withToken.getResponse().getStatus()).isEqualTo(200);
  }

  @Test
  void anonymousVisitorsAlsoGetTheCookieSoTheLoginPageCanPostLater() throws Exception {
    MvcResult r = mvc.perform(MockMvcRequestBuilders.get("/api/health")).andReturn();
    assertThat(r.getResponse().getCookie("XSRF-TOKEN")).isNotNull();
  }
}
