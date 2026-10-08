package com.claimshield.gateway.auth;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

  public record Stored(AppUser user, String passwordHash) {}

  private final JdbcTemplate jdbc;

  public UserRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Optional<Stored> findByUsername(String username) {
    return one("SELECT * FROM wf_user WHERE username = ?", username);
  }

  public Optional<Stored> findFirstByRole(Role role) {
    return one("SELECT * FROM wf_user WHERE role = ? ORDER BY user_id LIMIT 1", role.name());
  }

  private Optional<Stored> one(String sql, Object arg) {
    List<Stored> rows = jdbc.query(sql, (rs, i) -> new Stored(
        new AppUser(rs.getString("user_id"), rs.getString("username"), rs.getString("display_name"),
            Role.valueOf(rs.getString("role"))), rs.getString("password_hash")), arg);
    return rows.stream().findFirst();
  }

  public long count() {
    Long n = jdbc.queryForObject("SELECT COUNT(*) FROM wf_user", Long.class);
    return n == null ? 0 : n;
  }

  public void insert(AppUser u, String passwordHash) {
    jdbc.update("INSERT INTO wf_user (user_id, username, password_hash, display_name, role) VALUES (?,?,?,?,?)",
        u.id(), u.username(), passwordHash, u.displayName(), u.role().name());
    jdbc.update("INSERT INTO wf_user_pref (user_id) VALUES (?)", u.id());
  }

  /** User plus preferences, in the shape the API returns. */
  public Map<String, Object> profile(AppUser u) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", u.id());
    out.put("username", u.username());
    out.put("displayName", u.displayName());
    out.put("role", u.role().name());
    jdbc.query("SELECT language, onboarded, onboarding_skipped FROM wf_user_pref WHERE user_id = ?", rs -> {
      out.put("language", rs.getString("language"));
      out.put("onboarded", rs.getInt("onboarded") == 1);
      out.put("onboardingSkipped", rs.getInt("onboarding_skipped") == 1);
    }, u.id());
    return out;
  }

  public void updatePrefs(String userId, String language, Boolean onboarded, Boolean skipped) {
    if (language != null) {
      jdbc.update("UPDATE wf_user_pref SET language = ? WHERE user_id = ?", language, userId);
    }
    if (onboarded != null) {
      jdbc.update("UPDATE wf_user_pref SET onboarded = ? WHERE user_id = ?", onboarded ? 1 : 0, userId);
    }
    if (skipped != null) {
      jdbc.update("UPDATE wf_user_pref SET onboarding_skipped = ? WHERE user_id = ?", skipped ? 1 : 0, userId);
    }
  }
}
