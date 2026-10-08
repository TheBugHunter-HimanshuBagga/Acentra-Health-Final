package com.claimshield.gateway.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The React app is embedded in the jar (static/index.html). A browser reload on a client-side route such as
 * /cases/CASE-0001 must get index.html, not a 404. /api/** is never forwarded.
 */
@Configuration
public class SpaForwardConfig implements WebMvcConfigurer {

  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    for (String route : new String[] {"/login", "/welcome", "/queue", "/precedents", "/governance", "/audit",
        "/library", "/home", "/lab", "/agent", "/investigate", "/investigate/{caseId}", "/cases/{caseId}"}) {
      registry.addViewController(route).setViewName("forward:/index.html");
    }
  }
}
