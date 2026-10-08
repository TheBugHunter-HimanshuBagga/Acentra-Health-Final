package com.claimshield.gateway.auth;

public enum Role {
  INVESTIGATOR, SUPERVISOR, GOVERNANCE, AUDITOR;

  public String authority() {
    return "ROLE_" + name();
  }
}
