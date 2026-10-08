package com.claimshield.gateway.auth;

/** The authenticated principal (kept in the HTTP session). */
public record AppUser(String id, String username, String displayName, Role role) {}
