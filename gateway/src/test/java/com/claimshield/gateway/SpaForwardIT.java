package com.claimshield.gateway;


import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;

/** A reload on a client-side route must get the single-page app, while API paths are never forwarded. */
class SpaForwardIT extends GatewayIT {

  @Test
  void clientRoutesForwardToTheApp() throws Exception {
    for (String route : new String[] {"/queue", "/precedents", "/governance", "/audit", "/library", "/cases/CASE-0001",
        "/login", "/welcome"}) {
      mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(route)).andExpect(forwardedUrl("/index.html"));
    }
  }

  @Test
  void unknownApiPathsAreNotForwarded() throws Exception {
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/nope")).andExpect(status().is4xxClientError());
  }
}
