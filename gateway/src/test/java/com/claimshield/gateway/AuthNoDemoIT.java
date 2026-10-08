package com.claimshield.gateway;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;

/** With demo mode OFF the role-switch endpoint must not exist. */
@SpringBootTest(properties = "claimshield.demo-mode=false")
class AuthNoDemoIT extends GatewayIT {

  @Test
  void roleSwitchIsNotAvailableOutsideDemoMode() throws Exception {
    expectProblem("investigator", HttpMethod.POST, "/api/auth/switch-role", Map.of("role", "SUPERVISOR"), 404,
        "NOT_FOUND");
  }
}
