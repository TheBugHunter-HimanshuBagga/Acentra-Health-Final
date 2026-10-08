"""Alerts, consolidation, stable IDs, scoring and the deterministic tier."""

from datetime import date

import pytest

from claimshield.cases import alerts as al
from claimshield.cases.consolidate import CaseDraft, assign_case_ids, consolidate
from claimshield.cases.score import decide_tier, est_hours, evidence_strength, pack_first_fit, risk_signal, trend_label
from tests.helpers import TinyDb


# ---------------------------------------------------------------- alerts
def _hit(rule, provider, day, claim="C-1", line=1, dollars=10.0, member="M1"):
    return {"rule_id": rule, "claim_id": claim, "line_no": line, "member_id": member, "provider_id": provider,
            "service_dt": day, "hcpcs": "99213", "paid_amt": dollars, "dollars": dollars, "detail": "x",
            "flag_role": "X"}


def test_alert_grain_is_rule_provider_month_and_ids_are_deterministic():
    hits = [_hit("R-DUP-01", "P1", date(2025, 1, 3), "C-1"), _hit("R-DUP-01", "P1", date(2025, 1, 20), "C-2"),
            _hit("R-DUP-01", "P1", date(2025, 2, 1), "C-3"), _hit("R-DOD-01", "P1", date(2025, 1, 3), "C-4"),
            _hit("R-DUP-01", "P2", date(2025, 1, 3), "C-5")]
    a = al.build_alerts(hits)
    assert len(a) == 4
    assert [x.alert_id for x in a] == ["ALR-000001", "ALR-000002", "ALR-000003", "ALR-000004"]
    jan = next(x for x in a if x.rule_id == "R-DUP-01" and x.provider_id == "P1" and x.window_start.month == 1)
    assert jan.n_lines == 2 and jan.dollars == 20.0
    assert [x.alert_id for x in al.build_alerts(list(reversed(hits)))] == [x.alert_id for x in a]


def test_alert_score_is_rule_strength_not_a_sum():
    a = al.build_alerts([_hit("R-DME-01", "S1", date(2025, 1, i), f"C-{i}") for i in range(1, 6)])
    assert len(a) == 1 and a[0].score == 0.8


# ---------------------------------------------------------------- consolidation
def _dme_world(n_orders=40, n_other=0):
    db = TinyDb()
    for i in range(n_orders):
        db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R1", member=f"M{i}",
                 day=date(2025, 3, 1))
    for i in range(n_other):
        db.claim([("E0601",)], claim_type="DME", provider="S1", referring="R2", member=f"X{i}",
                 day=date(2025, 3, 1))
    return db


def test_referral_coupled_active_providers_merge_into_one_case():
    db = _dme_world()
    hits = [_hit("R-DME-01", "S1", date(2025, 3, 1), "C-1", dollars=500.0),
            _hit("R-DUP-01", "R1", date(2025, 3, 1), "C-2", dollars=40.0)]
    drafts = consolidate(db.con, al.build_alerts(hits), hits)
    assert len(drafts) == 1 and set(drafts[0].providers) == {"S1", "R1"} and drafts[0].primary == "S1"


def test_inactive_referrer_is_related_not_merged():
    db = _dme_world()
    hits = [_hit("R-DME-01", "S1", date(2025, 3, 1), "C-1", dollars=500.0)]
    # the hit must point at a real DME claim so the referrer can be resolved
    cid = db.con.execute("SELECT claim_id FROM claim WHERE claim_type='DME' LIMIT 1").fetchone()[0]
    hits[0]["claim_id"] = cid
    drafts = consolidate(db.con, al.build_alerts(hits), hits)
    assert len(drafts) == 1 and drafts[0].providers == ["S1"] and drafts[0].related == ["R1"]
    assert ("R1", "RELATED") in drafts[0].subjects


def test_weak_referral_share_does_not_merge():
    db = _dme_world(n_orders=35, n_other=200)            # R1 is 35 of 235 orders (< 25%)
    hits = [_hit("R-DME-01", "S1", date(2025, 3, 1), "C-1"), _hit("R-DUP-01", "R1", date(2025, 3, 1), "C-2")]
    assert len(consolidate(db.con, al.build_alerts(hits), hits)) == 2


def test_suppressed_alerts_never_form_cases():
    db = TinyDb()
    hits = [_hit("R-DUP-01", "P1", date(2025, 1, 3))]
    alerts = al.build_alerts(hits)
    alerts[0].suppressed_by_exception_id = "EXC-0001"
    assert consolidate(db.con, alerts, hits) == []


def _draft(primary, others=()):
    return CaseDraft(primary=primary, providers=[primary, *others], related=[])


def test_case_ids_are_stable_by_subject_overlap():
    prev = {"CASE-0001": {"P1", "P2"}, "CASE-0002": {"P9"}}
    inherits, split, new = _draft("P1", ["P2", "P3"]), _draft("P9"), _draft("P5")
    assign_case_ids([inherits, split, new], prev)
    assert inherits.case_id == "CASE-0001"          # Jaccard 2/3 >= 0.5
    assert split.case_id == "CASE-0002"
    assert new.case_id == "CASE-0003"               # no overlap: new ID after the highest existing


def test_case_id_not_inherited_below_half_overlap_and_never_reused():
    prev = {"CASE-0001": {"P1", "P2", "P3", "P4"}}
    a, b = _draft("P1"), _draft("P2")
    assign_case_ids([a, b], prev)                   # each overlaps 1/4 < 0.5
    assert {a.case_id, b.case_id} == {"CASE-0002", "CASE-0003"}
    c1, c2 = _draft("P1", ["P2", "P3", "P4"]), _draft("P1", ["P2", "P3"])
    c2.primary = "PX"
    assign_case_ids([c1, c2], prev)
    assert len({c1.case_id, c2.case_id}) == 2


# ---------------------------------------------------------------- scoring
def test_risk_signal_is_noisy_or_and_one_weak_channel_cannot_saturate():
    assert risk_signal({"LINE": 1.0, "PEER": 0.0, "SELF": 0.0, "NETWORK": 0.0}) == pytest.approx(0.85)
    both = risk_signal({"LINE": 1.0, "PEER": 1.0, "SELF": 0.0, "NETWORK": 0.0})
    assert both == pytest.approx(1 - 0.15 * 0.40) and both < 1.0
    assert risk_signal({"LINE": 0.1, "PEER": 0.0, "SELF": 0.0, "NETWORK": 0.0}) < 0.1


def test_evidence_strength_formula():
    one = {"LINE": 1.0, "PEER": 0, "SELF": 0, "NETWORK": 0}
    assert evidence_strength(one, True, 3) == pytest.approx(0.45 * 0.25 + 0.25 + 0.20 + 0.05)
    assert evidence_strength(one, False, 0) == pytest.approx(0.45 * 0.25 + 0.05)
    assert evidence_strength(one, True, 3, inadequate=True) == pytest.approx(0.6125 * 0.7)


ONE = {"LINE": 0.9, "PEER": 0.0, "SELF": 0.0, "NETWORK": 0.0}


def test_tier_exception_wins_over_everything():
    assert decide_tier(ONE, True, 0.9, hard_direct_dollars=1e6, exception_id="EXC-0001")[0] == "LOW"


def test_tier_direct_recorded_fact_is_high_only_above_the_dollar_floor():
    assert decide_tier(ONE, True, 0.6, hard_direct_dollars=100.0)[0] == "HIGH"
    assert decide_tier(ONE, True, 0.6, hard_direct_dollars=99.99)[0] == "MEDIUM"


def test_tier_precedent_conflict_forces_low():
    assert decide_tier(ONE, True, 0.8, precedent_fit=-0.6, unfounded_matches=2)[0] == "LOW"
    assert decide_tier(ONE, True, 0.8, precedent_fit=-0.6, unfounded_matches=1)[0] == "MEDIUM"


def test_tier_low_for_weak_evidence_or_statistical_only():
    assert decide_tier(ONE, False, 0.30)[0] == "LOW"
    peer_only = {"LINE": 0.0, "PEER": 0.9, "SELF": 0.0, "NETWORK": 0.0}
    assert decide_tier(peer_only, False, 0.7)[0] == "LOW"
    assert decide_tier(ONE, False, 0.7, low_peer=True)[0] == "LOW"


def test_tier_high_needs_three_channels_or_two_plus_a_hard_fact():
    three = {"LINE": 0.9, "PEER": 0.9, "SELF": 0.9, "NETWORK": 0.0}
    two = {"LINE": 0.9, "PEER": 0.9, "SELF": 0.0, "NETWORK": 0.0}
    assert decide_tier(three, False, 0.7)[0] == "HIGH"
    assert decide_tier(two, True, 0.7)[0] == "HIGH"
    assert decide_tier(two, False, 0.7)[0] == "MEDIUM"
    assert decide_tier(two, True, 0.6)[0] == "MEDIUM"                    # ES below 0.65
    assert decide_tier(three, False, 0.7, precedent_fit=-0.3)[0] == "MEDIUM"


def test_tier_medium_is_the_default_and_explains_itself():
    tier, why = decide_tier(ONE, True, 0.5)
    assert tier == "MEDIUM" and any("channel" in w for w in why) and any("not HIGH" in w for w in why)


def test_trend_label():
    asof = date(2025, 12, 31)
    assert trend_label({date(2025, 12, 1): 100.0}, asof) is None                      # needs two months
    assert trend_label({date(2025, 12, 1): 100.0, date(2025, 8, 1): 50.0}, asof) == "ESCALATING"
    assert trend_label({date(2025, 10, 1): 100.0, date(2025, 8, 1): 100.0}, asof) == "STABLE"
    assert trend_label({date(2025, 12, 1): 10.0, date(2025, 7, 1): 100.0}, asof) == "DECLINING"
    assert trend_label({date(2025, 11, 1): 10.0, date(2025, 3, 1): 100.0}, asof) == "ESCALATING"   # prior is empty


def test_est_hours_is_clamped():
    assert est_hours(1, 1, 1) == pytest.approx(4 + 1.5 + 0.5)
    assert est_hours(1, 1, 1) >= 4
    assert est_hours(100, 10_000, 10) == 40


def test_capacity_packing_is_first_fit_by_utility():
    items = [("A", 0.9, 30.0), ("B", 0.8, 20.0), ("C", 0.7, 15.0), ("D", 0.1, 5.0)]
    out = pack_first_fit(items, 50.0)
    assert out == {"A": True, "B": True, "C": False, "D": False}
    out = pack_first_fit(items, 55.0)
    assert out["A"] and out["B"] and not out["C"] and out["D"]              # a smaller later case still fits
