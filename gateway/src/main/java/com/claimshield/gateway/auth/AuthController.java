package com.claimshield.gateway.auth;

import com.claimshield.gateway.api.ApiException;
import com.claimshield.gateway.audit.AuditService;
import com.claimshield.gateway.config.Tx;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AuthController {


  public record LoginRequest(@NotBlank String username, @NotBlank String password) {}

  public record PrefsRequest(String language, Boolean onboarded, Boolean onboardingSkipped) {}

  public record SwitchRoleRequest(@NotBlank String role) {}

  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final SecurityContextRepository contextRepo;
  private final AuditService audit;
  private final Tx tx;
  private final boolean demoMode;
  /** Compared against when the username is unknown, so response time does not reveal which usernames exist. */
  private final String dummyHash;

  public AuthController(UserRepository users, PasswordEncoder encoder, SecurityContextRepository contextRepo,
      AuditService audit, Tx tx, @Value("${claimshield.demo-mode:false}") boolean demoMode) {
    this.users = users;
    this.encoder = encoder;
    this.contextRepo = contextRepo;
    this.audit = audit;
    this.tx = tx;
    this.demoMode = demoMode;
    this.dummyHash = encoder.encode(java.util.UUID.randomUUID().toString());
  }

  private static final int MAX_FAILURES = 8;
  private static final long WINDOW_MS = 60_000;
  private final java.util.concurrent.ConcurrentHashMap<String, java.util.Deque<Long>> failures =
      new java.util.concurrent.ConcurrentHashMap<>();

  /** Slows password guessing: after 8 wrong attempts for one name, wait a minute. Correct sign-ins reset the count. */
  private void throttle(String username) {
    java.util.Deque<Long> q = failures.get(username.toLowerCase());
    if (q == null) {
      return;
    }
    synchronized (q) {
      long now = System.currentTimeMillis();
      while (!q.isEmpty() && now - q.peekFirst() > WINDOW_MS) {
        q.pollFirst();
      }
      if (q.size() >= MAX_FAILURES) {
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many attempts",
            "Too many failed sign-ins. Please wait a minute and try again.");
      }
    }
  }

  @PostMapping("/auth/login")
  public Map<String, Object> login(@Valid @RequestBody LoginRequest body, HttpServletRequest req,
      HttpServletResponse res) {
    throttle(body.username());
    var stored = users.findByUsername(body.username());
    boolean ok = encoder.matches(body.password(), stored.map(UserRepository.Stored::passwordHash).orElse(dummyHash))
        && stored.isPresent();
    if (!ok) {
      failures.computeIfAbsent(body.username().toLowerCase(), k -> new java.util.ArrayDeque<>()).addLast(System.currentTimeMillis());
      tx.write(() -> audit.append(body.username(), "ANONYMOUS", "AUTH_LOGIN_FAILED", "user", body.username(),
          Map.of()));
      throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Sign-in failed",
          "The username or password is incorrect.");
    }
    AppUser u = stored.get().user();
    failures.remove(body.username().toLowerCase());
    establish(u, req, res);
    tx.write(() -> audit.append(u.username(), u.role().name(), "AUTH_LOGIN", "user", u.id(), Map.of()));
    return users.profile(u);
  }

  @PostMapping("/auth/logout")
  public ResponseEntity<Void> logout(HttpServletRequest req) {
    Authentication a = SecurityContextHolder.getContext().getAuthentication();
    if (a != null && a.getPrincipal() instanceof AppUser u) {
      tx.write(() -> audit.append(u.username(), u.role().name(), "AUTH_LOGOUT", "user", u.id(), Map.of()));
    }
    var session = req.getSession(false);
    if (session != null) {
      session.invalidate();
    }
    SecurityContextHolder.clearContext();
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/auth/me")
  public Map<String, Object> me(@org.springframework.security.core.annotation.AuthenticationPrincipal AppUser u) {
    return users.profile(u);
  }

  @PutMapping("/me/prefs")
  public Map<String, Object> prefs(@org.springframework.security.core.annotation.AuthenticationPrincipal AppUser u,
      @RequestBody PrefsRequest body) {
    if (body.language() != null && !body.language().matches("^[a-z]{2,3}$")) {
      throw ApiException.invalid("language", "must be a short language code such as en or hi");
    }
    users.updatePrefs(u.id(), body.language(), body.onboarded(), body.onboardingSkipped());
    return users.profile(u);
  }

  /** Demo-only: become the seeded user of another role so approvals can be shown with one browser. */
  @PostMapping("/auth/switch-role")
  public Map<String, Object> switchRole(@Valid @RequestBody SwitchRoleRequest body, HttpServletRequest req,
      HttpServletResponse res, @org.springframework.security.core.annotation.AuthenticationPrincipal AppUser current) {
    if (!demoMode) {
      throw ApiException.notFound("This endpoint");
    }
    Role role;
    try {
      role = Role.valueOf(body.role());
    } catch (IllegalArgumentException e) {
      throw ApiException.invalid("role", "must be one of INVESTIGATOR, SUPERVISOR, GOVERNANCE, AUDITOR");
    }
    AppUser target = users.findFirstByRole(role).orElseThrow(() -> ApiException.notFound("A user with that role"))
        .user();
    // the same person is demonstrating both roles: their language and onboarding choice carry over
    Map<String, Object> mine = users.profile(current);
    users.updatePrefs(target.id(), (String) mine.get("language"), Boolean.TRUE.equals(mine.get("onboarded")),
        Boolean.TRUE.equals(mine.get("onboardingSkipped")));
    establish(target, req, res);
    tx.write(() -> audit.append(current.username(), current.role().name(), "AUTH_SWITCH_ROLE", "user", target.id(),
        Map.of("from", current.role().name(), "to", target.role().name())));
    return users.profile(target);
  }

  private void establish(AppUser u, HttpServletRequest req, HttpServletResponse res) {
    if (req.getSession(false) != null) {
      req.changeSessionId();            // session-fixation protection
    }
    List<GrantedAuthority> auth = List.of(new SimpleGrantedAuthority(u.role().authority()));
    SecurityContext ctx = SecurityContextHolder.getContextHolderStrategy().createEmptyContext();
    ctx.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(u, null, auth));
    SecurityContextHolder.getContextHolderStrategy().setContext(ctx);
    contextRepo.saveContext(ctx, req, res);
  }
}
