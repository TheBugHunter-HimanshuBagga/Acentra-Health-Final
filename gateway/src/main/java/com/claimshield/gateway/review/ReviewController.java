package com.claimshield.gateway.review;

import com.claimshield.gateway.auth.AppUser;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Human pushback on the system: review notes, a critique of the knowledge base, and fine-tuning proposals. */
@RestController
@RequestMapping("/api")
public class ReviewController {

  public record NoteBody(String subjectType, String subjectId, String verdict, String note, String proposal, String caseId) {}

  public record FinetuneBody(String targetType, String targetId, String instruction) {}

  private final ReviewService review;

  public ReviewController(ReviewService review) {
    this.review = review;
  }

  @PostMapping("/review/notes")
  public Map<String, Object> add(@AuthenticationPrincipal AppUser u, @RequestBody NoteBody b) {
    return review.addNote(u, b.subjectType(), b.subjectId(), b.verdict(), b.note(), b.proposal(), b.caseId());
  }

  @GetMapping("/review/notes")
  public List<Map<String, Object>> notes(@RequestParam(required = false) String subjectType,
      @RequestParam(defaultValue = "50") int limit) {
    return review.notes(subjectType, limit);
  }

  @PostMapping("/knowledge/critique")
  public Map<String, Object> critique(@AuthenticationPrincipal AppUser u) {
    return review.critique(u);
  }

  @PostMapping("/knowledge/finetune")
  public Map<String, Object> finetune(@AuthenticationPrincipal AppUser u, @RequestBody FinetuneBody b) {
    return review.finetune(u, b.targetType(), b.targetId(), b.instruction());
  }
}
