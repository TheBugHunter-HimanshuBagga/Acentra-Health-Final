package com.claimshield.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import com.claimshield.gateway.api.QueueService;
import com.claimshield.gateway.api.QueueService.Item;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Pure unit test; mirrors engine/tests/test_cases_score.py::test_capacity_packing_is_first_fit_by_utility. */
class QueuePackingTest {

  private static final List<Item> ITEMS = List.of(new Item("A", 0.9, 30), new Item("B", 0.8, 20),
      new Item("C", 0.7, 15), new Item("D", 0.1, 5));

  @Test
  void ranksByUtilityAndFillsFirstFit() {
    assertThat(QueueService.pack(ITEMS, 50)).isEqualTo(Map.of("A", true, "B", true, "C", false, "D", false));
  }

  @Test
  void aSmallerLaterCaseStillFitsWhenALargerOneWasSkipped() {
    Map<String, Boolean> out = QueueService.pack(ITEMS, 55);
    assertThat(out.get("A")).isTrue();
    assertThat(out.get("B")).isTrue();
    assertThat(out.get("C")).isFalse();
    assertThat(out.get("D")).isTrue();
  }

  @Test
  void zeroCapacityFitsNothingAndTiesBreakByCaseId() {
    assertThat(QueueService.pack(ITEMS, 0).values()).containsOnly(false);
    List<Item> tie = List.of(new Item("Z", 0.5, 10), new Item("M", 0.5, 10));
    assertThat(QueueService.pack(tie, 10)).containsEntry("M", true).containsEntry("Z", false);
  }
}
