package com.claimshield.gateway.config;

import com.claimshield.gateway.api.Problems;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import tools.jackson.databind.json.JsonMapper;

/**
 * Session login (cookie), CSRF via the XSRF-TOKEN cookie + X-XSRF-TOKEN header, JSON problem responses.
 *
 * Login itself is exempt from CSRF so a fresh browser can sign in (demo-grade; a production deployment would
 * add login rate limiting and a CSRF-protected login). Everything else under /api/** requires a session.
 */
@Configuration
public class SecurityConfig {

  @Bean
  SecurityContextRepository securityContextRepository() {
    return new HttpSessionSecurityContextRepository();
  }

  /** Declared so Spring Boot does not auto-create its default in-memory user; login is handled in AuthController. */
  @Bean
  UserDetailsService noDefaultUser() {
    return username -> {
      throw new org.springframework.security.core.userdetails.UsernameNotFoundException(username);
    };
  }

  @Bean
  SecurityFilterChain api(HttpSecurity http, SecurityContextRepository repo, JsonMapper mapper) throws Exception {
    http
        .securityContext(c -> c.securityContextRepository(repo))
        .csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())   // plain (unmasked) token for the SPA
            .ignoringRequestMatchers("/api/auth/login"))
        .addFilterAfter(new CsrfCookieFilter(), CsrfFilter.class)
        .authorizeHttpRequests(a -> a
            .requestMatchers("/api/auth/login", "/api/health", "/actuator/health").permitAll()
            .requestMatchers("/api/**").authenticated()
            .anyRequest().permitAll())
        .exceptionHandling(e -> e
            .authenticationEntryPoint((req, res, ex) -> Problems.write(res, mapper, HttpStatus.UNAUTHORIZED,
                "AUTH_REQUIRED", "Sign in required", "Please sign in to continue."))
            .accessDeniedHandler((req, res, ex) -> {
              if (ex instanceof CsrfException) {
                Problems.write(res, mapper, HttpStatus.FORBIDDEN, "CSRF_INVALID", "Security token missing or invalid",
                    "Refresh the page and try again.");
              } else {
                Problems.write(res, mapper, HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "Access denied",
                    "You do not have access to this resource.");
              }
            }))
        .httpBasic(AbstractHttpConfigurer::disable)
        .formLogin(AbstractHttpConfigurer::disable)
        .logout(AbstractHttpConfigurer::disable)
        .headers(Customizer.withDefaults());
    return http.build();
  }
}
