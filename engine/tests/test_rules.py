"""Edge-case tests for each of the six deterministic rules on hand-built data."""

from datetime import date

from tests.helpers import TinyDb


# ---------------------------------------------------------------- R-DUP-01
def test_dup_flags_only_the_later_identical_line():
    db = TinyDb()
    first = db.claim([("99213",)])
    second = db.claim([("99213",)])
    hits = db.run("R-DUP-01")
    assert list(hits["claim_id"]) == [second] and first not in set(hits["claim_id"])


def test_dup_three_copies_flag_two():
    db = TinyDb()
    for _ in range(3):
        db.claim([("99213",)])
    assert len(db.run("R-DUP-01")) == 2


def test_dup_different_modifier_or_units_or_date_or_member_is_not_a_duplicate():
    db = TinyDb()
    db.claim([("20610", 1)])
    db.claim([("20610", 1, "76")])                       # repeat-procedure modifier differs
    db.claim([("20610", 2)])                             # different units
    db.claim([("20610", 1)], day=date(2025, 1, 11))      # different date
    db.claim([("20610", 1)], member="M2")                # different member
    db.claim([("20610", 1)], provider="P2")              # different provider
    assert len(db.run("R-DUP-01")) == 0


def test_dup_within_one_claim_is_flagged():
    db = TinyDb()
    db.claim([("36415",), ("36415",)])
    assert len(db.run("R-DUP-01")) == 1


# ---------------------------------------------------------------- R-PTP-01
def test_ptp_never_allowed_pair_is_flagged_on_col2():
    db = TinyDb()
    cid = db.claim([("93000",), ("93005",)])
    hits = db.run("R-PTP-01")
    assert len(hits) == 1 and hits.iloc[0]["claim_id"] == cid and hits.iloc[0]["hcpcs"] == "93005"


def test_ptp_modifier_allowed_pair_without_modifier_is_flagged():
    db = TinyDb()
    db.claim([("20610",), ("99213",)])
    hits = db.run("R-PTP-01")
    assert len(hits) == 1 and hits.iloc[0]["hcpcs"] == "99213"


def test_ptp_bypass_modifier_on_either_line_clears_an_allowed_pair():
    db = TinyDb()
    db.claim([("20610",), ("99213", 1, "25")])
    db.claim([("20610", 1, "59"), ("99214",)], member="M2")
    assert len(db.run("R-PTP-01")) == 0


def test_ptp_modifier_does_not_rescue_a_never_allowed_pair():
    db = TinyDb()
    db.claim([("93000",), ("93005", 1, "59")])
    assert len(db.run("R-PTP-01")) == 1


def test_ptp_needs_same_member_provider_and_date():
    db = TinyDb()
    db.claim([("93000",)])
    db.claim([("93005",)], member="M2")
    db.claim([("93005",)], provider="P2")
    db.claim([("93005",)], day=date(2025, 1, 11))
    assert len(db.run("R-PTP-01")) == 0


def test_ptp_pair_across_two_claims_same_day_is_flagged_once():
    db = TinyDb()
    db.claim([("93000",)])
    db.claim([("93000",)])        # two col1 lines must not double-flag the single col2 line
    db.claim([("93005",)])
    assert len(db.run("R-PTP-01")) == 1


# ---------------------------------------------------------------- R-MUE-01
def test_mue_line_edit_flags_over_limit_with_prorata_dollars():
    db = TinyDb()
    db.claim([("97110", 8)])                       # limit 4, MAI 1
    h = db.run("R-MUE-01").iloc[0]
    assert float(h["dollars"]) == round(float(h["paid_amt"]) * (8 - 4) / 8, 2)


def test_mue_at_limit_is_not_flagged():
    db = TinyDb()
    db.claim([("97110", 4)])
    assert len(db.run("R-MUE-01")) == 0


def test_mue_day_level_edit_sums_units_across_lines():
    db = TinyDb()
    db.claim([("20610", 1)])
    db.claim([("20610", 1, "76")])                 # sums to 2 = limit: fine
    assert len(db.run("R-MUE-01")) == 0
    db.claim([("20610", 1, "77")])                 # sums to 3 > 2: all three lines flagged
    assert len(db.run("R-MUE-01")) == 3


def test_mue_uses_dme_limits_for_dme_claims():
    db = TinyDb()
    db.claim([("E0601", 2)], claim_type="DME", referring="P9")
    assert len(db.run("R-MUE-01")) == 1


# ---------------------------------------------------------------- R-DOD-01
def test_dod_flags_after_death_but_not_on_or_before():
    db = TinyDb()
    db.member("M1", death=date(2025, 1, 10))
    db.claim([("99213",)], day=date(2025, 1, 10))
    db.claim([("99213",)], day=date(2025, 1, 9), provider="P2")
    after = db.claim([("99213",)], day=date(2025, 1, 11), provider="P3")
    hits = db.run("R-DOD-01")
    assert list(hits["claim_id"]) == [after]


def test_dod_members_without_death_date_are_ignored():
    db = TinyDb()
    db.claim([("99213",)])
    assert len(db.run("R-DOD-01")) == 0


# ---------------------------------------------------------------- R-EXCL-01
def test_excl_flags_on_and_after_exclusion_date_only():
    db = TinyDb()
    db.exclusion("P1", date(2025, 3, 1))
    db.claim([("99213",)], day=date(2025, 2, 28))
    on = db.claim([("99213",)], day=date(2025, 3, 1), member="M2")
    after = db.claim([("99213",)], day=date(2025, 4, 1), member="M3")
    assert set(db.run("R-EXCL-01")["claim_id"]) == {on, after}


def test_excl_reinstatement_ends_the_window():
    db = TinyDb()
    db.exclusion("P1", date(2025, 3, 1), reinstate=date(2025, 6, 1))
    db.claim([("99213",)], day=date(2025, 5, 31))
    db.claim([("99213",)], day=date(2025, 6, 1), member="M2")
    assert len(db.run("R-EXCL-01")) == 1


def test_excl_other_providers_unaffected():
    db = TinyDb()
    db.exclusion("P1", date(2025, 3, 1))
    db.claim([("99213",)], day=date(2025, 4, 1), provider="P2")
    assert len(db.run("R-EXCL-01")) == 0


# ---------------------------------------------------------------- R-DME-01
def test_dme_order_without_visit_is_flagged():
    db = TinyDb()
    cid = db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R1")
    assert list(db.run("R-DME-01")["claim_id"]) == [cid]


def test_dme_visit_by_ordering_provider_within_window_clears_the_order():
    db = TinyDb()
    db.claim([("99213",)], provider="R1", day=date(2024, 11, 20))     # 51 days before the order
    db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R1", day=date(2025, 1, 10))
    assert len(db.run("R-DME-01")) == 0


def test_dme_visit_just_outside_the_window_does_not_count():
    db = TinyDb()
    db.claim([("99213",)], provider="R1", day=date(2024, 11, 10))     # 61 days before
    db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R1", day=date(2025, 1, 10))
    assert len(db.run("R-DME-01")) == 1


def test_dme_visit_by_a_different_provider_or_after_the_order_does_not_count():
    db = TinyDb()
    db.claim([("99213",)], provider="OTHER", day=date(2025, 1, 5))
    db.claim([("99213",)], provider="R1", day=date(2025, 1, 12))      # after the order
    db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R1", day=date(2025, 1, 10))
    assert len(db.run("R-DME-01")) == 1


def test_dme_order_with_no_ordering_provider_is_not_evaluated():
    db = TinyDb()
    db.claim([("E0601",)], claim_type="DME", provider="S1", referring=None)
    assert len(db.run("R-DME-01")) == 0
