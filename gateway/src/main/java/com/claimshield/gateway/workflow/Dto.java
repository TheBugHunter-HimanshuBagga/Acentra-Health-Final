package com.claimshield.gateway.workflow;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public final class Dto {

  private Dto() {}

  public enum ReviewAction { ACCEPT, MODIFY, REJECT, REQUEST_INFO }

  public enum Decision { APPROVE, REJECT }

  public enum Outcome { CONFIRMED, UNFOUNDED, EDUCATION, INSUFFICIENT }

  public record ReviewRequest(@NotNull ReviewAction action, String newAction, String hypothesis, String reasonCode,
      String notes) {}

  public record ApproveRequest(@NotNull Decision decision, String notes) {}

  public record CloseRequest(@NotNull Outcome outcome, @NotBlank String reasonCode, @NotBlank String rationale,
      Boolean aiDrafted, Double recovered) {}
}
