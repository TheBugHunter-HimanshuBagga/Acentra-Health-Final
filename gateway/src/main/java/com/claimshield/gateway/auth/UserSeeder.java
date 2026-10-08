package com.claimshield.gateway.auth;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** Seeds the demo accounts from demo-users.csv when wf_user is empty. Demo-grade; see README. */
@Component
public class UserSeeder implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(UserSeeder.class);

  private final UserRepository users;
  private final PasswordEncoder encoder;

  public UserSeeder(UserRepository users, PasswordEncoder encoder) {
    this.users = users;
    this.encoder = encoder;
  }

  @Override
  public void run(ApplicationArguments args) throws IOException {
    if (users.count() > 0) {
      return;
    }
    int n = 0;
    try (BufferedReader r = new BufferedReader(new InputStreamReader(
        new ClassPathResource("demo-users.csv").getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = r.readLine()) != null) {
        if (line.isBlank() || line.startsWith("#")) {
          continue;
        }
        String[] f = line.split(",", 4);
        AppUser u = new AppUser("U-" + f[0], f[0], f[1], Role.valueOf(f[2]));
        users.insert(u, encoder.encode(f[3]));
        n++;
      }
    }
    log.info("Seeded {} demo users", n);
  }
}
