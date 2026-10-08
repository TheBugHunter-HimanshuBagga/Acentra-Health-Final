"""Graph analytics (NETWORK), own-history signals (SELF), per-case graph and timeline views."""

import json
import math
from datetime import date

import pandas as pd
import pytest

from claimshield import reference as ref
from claimshield.detect import temporal
from claimshield.graph import graph as G
from tests.helpers import TinyDb


# ================================================================== infrastructure groups (G-INFRA)
def _infra(db):
    return G.infra_alerts(G.load_tables(db.con))


def test_a_shared_building_alone_never_forms_a_group():
    db = TinyDb()
    for p in ("P1", "P2", "P3"):
        db.place(p, 40.0, -75.0, building="B-1", phone=f"PH-{p}")
    assert _infra(db) == []


def test_building_plus_phone_forms_a_group_capped_at_point_four():
    db = TinyDb()
    for p in ("P1", "P2"):
        db.place(p, 40.0, -75.0, building="B-1", phone="PH-1")
    (grp,) = _infra(db)
    assert grp.providers == ["P1", "P2"] and grp.strength == 0.4
    assert set(grp.detail["links"]) == {"address", "phone"}


def test_a_shared_control_owner_forms_a_group_but_a_minority_stake_does_not():
    db = TinyDb()
    db.own("P1", "OWN-A")
    db.own("P2", "OWN-A")
    db.own("P3", "OWN-INV", control=False, pct=0.2)
    db.own("P4", "OWN-INV", control=False, pct=0.2)
    db.place("P1", 40, -75)
    groups = _infra(db)
    assert [g.providers for g in groups] == [["P1", "P2"]]


def test_a_shared_facility_alone_is_too_weak():
    db = TinyDb()
    db.facility("P1", "F-1")
    db.facility("P2", "F-1")
    assert _infra(db) == []


def test_missing_building_values_are_not_treated_as_one_shared_building():
    db = TinyDb()
    for p in ("P1", "P2", "P3"):
        db.place(p, 40.0, -75.0, building=None, phone=None)
    assert _infra(db) == []


# ================================================================== owner groups: G-OWNREF and G-LOOP
def _ring(db, per_edge=10, outside=0, members=("A", "B", "C"), owner="OWN-R"):
    for m in members:
        db.own(m, owner)
    for k, a in enumerate(members):
        b = members[(k + 1) % len(members)]
        for i in range(per_edge):
            db.claim([("99213",)], member=f"{a}{b}{i}", provider=b, referring=a, day=date(2025, 8, 1 + i))
    for i in range(outside):
        db.claim([("99213",)], member=f"X{i}", provider="Z", referring=members[0], day=date(2025, 9, 1 + i % 20))


def _signals(db):
    tables = G.load_tables(db.con)
    return G.owner_group_signals(db.con, tables)


def test_ring_of_owned_providers_raises_ownref_and_loop():
    db = TinyDb()
    _ring(db)
    rows = _signals(db)
    own = [r for r in rows if r["rule_id"] == "G-OWNREF"]
    loop = [r for r in rows if r["rule_id"] == "G-LOOP"]
    assert len(own) == 30 and len(loop) == 30
    d = json.loads(own[0]["detail"])
    assert d["share"] == 1.0 and d["referrals"] == 30 and d["members"] == 3 and d["owner"] == "OWN-R"
    assert d["strength"] == 1.0 and json.loads(loop[0]["detail"])["cycles"] == 1
    assert {r["flag_role"] for r in own} == {"RING_REFERRAL"} and all(r["dollars"] > 0 for r in own)


def test_too_few_referrals_or_a_low_inside_share_is_not_flagged():
    db = TinyDb()
    _ring(db, per_edge=5)                                # 15 referrals: below the 30 minimum
    assert [r for r in _signals(db) if r["rule_id"] == "G-OWNREF"] == []
    db2 = TinyDb()
    _ring(db2, per_edge=10, outside=60)                  # most referral dollars leave the group
    assert [r for r in _signals(db2) if r["rule_id"] == "G-OWNREF"] == []


def test_a_chain_without_a_return_edge_has_no_loop():
    db = TinyDb()
    for m in ("A", "B", "C"):
        db.own(m, "OWN-R")
    for i in range(20):
        db.claim([("99213",)], member=f"a{i}", provider="B", referring="A", day=date(2025, 8, 1 + i))
        db.claim([("99213",)], member=f"b{i}", provider="C", referring="B", day=date(2025, 8, 1 + i))
    rows = _signals(db)
    assert [r for r in rows if r["rule_id"] == "G-LOOP"] == []
    assert len([r for r in rows if r["rule_id"] == "G-OWNREF"]) == 40         # still all inside the group


def test_referrals_outside_the_window_do_not_count():
    db = TinyDb()
    for m in ("A", "B"):
        db.own(m, "OWN-R")
    for i in range(40):
        db.claim([("99213",)], member=f"a{i}", provider="B", referring="A", day=date(2024, 2, 1 + i % 20))
        db.claim([("99213",)], member=f"b{i}", provider="A", referring="B", day=date(2024, 2, 1 + i % 20))
    assert _signals(db) == []


# ================================================================== referral concentration
def _fed(db, provider, n, referrers, spec="DME_SUPPLIER", month=9):
    db.provider(provider, spec)
    for i in range(n):
        db.claim([("E0601",)], claim_type="DME", member=f"{provider}-m{i}", provider=provider,
                 referring=f"R{i % referrers}", day=date(2025, month, 1 + i % 25))


def test_concentrated_referrals_are_flagged_against_peers():
    db = TinyDb()
    for k in range(5):
        _fed(db, f"S{k}", 40, referrers=20)              # peers: referrals spread over 20 sources
    _fed(db, "SX", 40, referrers=2)
    rows = G.referral_concentration_signals(db.con, G.load_tables(db.con))
    assert {r["provider_id"] for r in rows} == {"SX"}
    d = json.loads(rows[0]["detail"])
    assert d["share"] == 1.0 and d["referrers"] == 2 and d["peers"] == 5 and d["z"] >= 3


def test_concentration_needs_enough_referrals_and_enough_peers():
    db = TinyDb()
    for k in range(5):
        _fed(db, f"S{k}", 40, referrers=20)
    _fed(db, "SX", 10, referrers=2)                      # only 10 referrals
    assert G.referral_concentration_signals(db.con, G.load_tables(db.con)) == []
    db2 = TinyDb()
    for k in range(2):
        _fed(db2, f"S{k}", 40, referrers=20)             # only two peers
    _fed(db2, "SX", 40, referrers=2)
    assert G.referral_concentration_signals(db2.con, G.load_tables(db2.con)) == []


# ================================================================== proximity to a confirmed case
def test_hops_to_a_confirmed_investigation_are_counted_to_two():
    db = TinyDb()
    db.investigation("C1", "CONFIRMED", date(2024, 5, 1))
    db.investigation("U1", "UNFOUNDED", date(2024, 5, 1))
    db.investigation("C2", "CONFIRMED", date(2026, 5, 1))      # closed after the as-of date: ignored
    for p in ("P1", "P2", "P3", "P4"):
        db.provider(p)
    db.claim([("99213",)], provider="P1", referring="C1", day=date(2025, 8, 1))        # C1 -> P1: one hop
    db.claim([("99213",)], member="M2", provider="P2", referring="P1", day=date(2025, 8, 2))   # P1 -> P2: two hops
    db.claim([("99213",)], member="M3", provider="P3", referring="P2", day=date(2025, 8, 3))   # P2 -> P3: three hops
    tables = G.load_tables(db.con)
    g = G.referral_graph(G.referral_lines(db.con, date(2024, 1, 1), date(2025, 12, 31)))
    hops = G.min_hops_to_confirmed(tables, g, ref.ASOF)
    assert hops["C1"] == 0 and hops["P1"] == 1 and hops["P2"] == 2 and hops["P3"] is None
    assert hops["P4"] is None and hops["U1"] is None and hops["C2"] is None


# ================================================================== CUSUM, growth, ramp (SELF)
def test_cusum_is_flat_on_a_stable_series_and_climbs_after_a_step():
    flat = temporal.cusum_series([0.30, 0.31, 0.29, 0.30, 0.30, 0.31], 0.30, 0.05)
    assert max(flat) < 1.0
    step = temporal.cusum_series([0.3] * 3 + [0.8] * 6, 0.30, 0.10)
    assert step[2] == 0 and step[-1] > ref.CUSUM_H and step == sorted(step)


def test_cusum_carries_the_statistic_over_missing_months():
    out = temporal.cusum_series([0.8, float("nan"), 0.8], 0.3, 0.1)
    assert out[1] == out[0] and out[2] > out[1]


def _series(db, providers, share_of, first=date(2024, 1, 1), months=24, per_month=14):
    k = 0
    for p in providers:
        for mi in range(months):
            y, m = first.year + (first.month - 1 + mi) // 12, (first.month - 1 + mi) % 12 + 1
            hi = round(per_month * share_of(p, mi))
            for j in range(per_month):
                k += 1
                db.claim([("99215" if j < hi else "99213",)], member=f"M{k}", provider=p, day=date(y, m, 1 + j))


def test_sustained_upcoding_shift_raises_a_cusum_alert_with_the_before_and_after_share():
    db = TinyDb()
    peers = [f"P{i}" for i in range(6)]
    _series(db, peers + ["PX"], lambda p, mi: 0.9 if (p == "PX" and mi >= 14) else 0.3)
    alerts = temporal.run_temporal_signals(db.con)
    cus = [a for a in alerts if a.rule_id == "T-CUSUM" and a.detail["metric"] == "em_high_share"]
    assert {a.provider_id for a in cus} == {"PX"}
    a = max(cus, key=lambda x: x.window_end)
    assert a.scheme_type == "UPC" and a.detail["from"] == pytest.approx(0.29, abs=0.03)
    assert a.detail["to"] == pytest.approx(0.93, abs=0.04) and a.detail["onset"] == "2025-03"
    assert 0.5 <= a.score <= 1.0 and a.n_lines == 0 and a.dollars == 0.0
    first = temporal.first_cusum_alarms(db.con)
    assert first["PX"] in ("2025-03", "2025-04") and "P1" not in first


def test_a_small_drift_is_not_an_alert():
    db = TinyDb()
    peers = [f"P{i}" for i in range(6)]
    _series(db, peers + ["PX"], lambda p, mi: 0.38 if (p == "PX" and mi >= 14) else 0.3)
    assert [a for a in temporal.run_temporal_signals(db.con) if a.provider_id == "PX"
            and a.rule_id == "T-CUSUM"] == []


def test_a_provider_that_was_always_high_has_no_change_to_report():
    db = TinyDb()
    peers = [f"P{i}" for i in range(6)]
    _series(db, peers + ["PX"], lambda p, mi: 0.9 if p == "PX" else 0.3)
    assert [a for a in temporal.run_temporal_signals(db.con) if a.provider_id == "PX"] == []


def test_a_new_provider_billing_like_an_established_one_is_a_ramp_alert():
    db = TinyDb()
    mature = [f"P{i}" for i in range(6)]
    _series(db, mature, lambda p, mi: 0.3)
    db.provider("PN")
    db.con.execute("UPDATE provider SET enroll_dt = ? WHERE provider_id = 'PN'", (date(2025, 3, 1),))
    for mi in range(6, 12):
        for j in range(60):                                            # far more volume than the mature peers
            db.claim([("99215",)], member=f"N{mi}-{j}", provider="PN", day=date(2025, mi + 1, 1 + j % 27))
    ramp = [a for a in temporal.run_temporal_signals(db.con) if a.rule_id == "T-RAMP"]
    assert {a.provider_id for a in ramp} == {"PN"} and len(ramp) >= ref.PEER_MIN_MONTHS
    assert ramp[0].detail["tenure"] < ref.RAMP_TENURE_MONTHS and ramp[0].detail["ratio"] > 1
    assert ramp[0].scheme_type == "RMP"


def test_theil_sen_slope_follows_the_direction_and_needs_two_months():
    up = temporal.trend_slope({date(2025, m, 1): float(100 * m) for m in range(1, 7)})
    down = temporal.trend_slope({date(2025, m, 1): float(700 - 100 * m) for m in range(1, 7)})
    assert up == pytest.approx(100) and down == pytest.approx(-100)
    assert temporal.trend_slope({date(2025, 1, 1): 5.0}) is None


# ================================================================== what the pipeline produced
def _cases(app_con):
    return {r["primary_provider_id"]: r for r in app_con.execute("SELECT * FROM serving_case")}


def _pack(app_con, case_id):
    return json.loads(app_con.execute("SELECT pack_json FROM serving_evidence_pack WHERE case_id=?",
                                      (case_id,)).fetchone()[0])


def test_the_owner_ring_lands_in_one_network_case_and_is_not_overstated(app_con):
    cases = _cases(app_con)
    ring = [r for r in cases.values() if {"P-0062", "P-0063", "P-0064", "P-0065"} <=
            {s["id"] for s in json.loads(r["subjects_json"])}]
    assert len(ring) == 1, "all four ring providers are in exactly one case"
    c = ring[0]
    ch = json.loads(c["channels_json"])
    assert ch["NETWORK"] >= 0.3 and c["tier"] == "MEDIUM"      # network evidence alone justifies expert review
    pack = _pack(app_con, c["case_id"])
    detectors = {e["detector"].split("@")[0] for e in pack["evidence"]}
    assert {"G-OWNREF", "G-LOOP"} <= detectors
    assert pack["network"] and all(n["id"].startswith("N") for n in pack["network"])
    assert "control owner" in " ".join(n["statement"] for n in pack["network"])
    assert {r["role"] for r in json.loads(c["subjects_json"])} >= {"PRIMARY", "NETWORK"}


def test_the_shared_building_decoys_never_reach_a_case(app_con):
    cases = _cases(app_con)
    monitored = {r["provider_id"] for r in app_con.execute("SELECT provider_id FROM serving_monitor_item")}
    d2 = {"P-0023", "P-0024", "P-0025", "P-0026", "P-0037", "P-0038", "P-0039", "P-0040"}
    assert not (d2 & set(cases)), "no D2 provider is the primary of a case"
    assert monitored & d2, "the shared-infrastructure groups are visible as Monitor items"
    ev = json.loads(app_con.execute("SELECT eval_json FROM serving_eval").fetchone()[0])
    d2rows = [d for d in ev["decoyProviders"] if d["type"] == "D2"]
    assert d2rows and all("G-INFRA" in d["flaggedBy"] and not d["reachedHigh"] and not d["opensCase"] for d in d2rows)


def test_a_new_supplier_fed_by_one_referrer_is_corroborated_across_three_channels(app_con):
    c = _cases(app_con)["P-0031"]
    ch = json.loads(c["channels_json"])
    assert ch["LINE"] >= 0.3 and ch["NETWORK"] >= 0.3 and ch["SELF"] >= 0.3
    # three channels but no recorded fact: MEDIUM on the evidence alone; HIGH only because earlier CONFIRMED cases of
    # the same kind (precedents) lift the evidence strength. The dashboard proves that is the only reason.
    assert c["tier"] == "HIGH"
    dash = json.loads(app_con.execute("SELECT dashboard_json FROM serving_dashboard").fetchone()[0])
    changed = {x["caseId"]: x for x in dash["compounding"]["tierChangedByPrecedent"]}
    assert changed[c["case_id"]]["without"] == "MEDIUM" and changed[c["case_id"]]["with"] == "HIGH"
    pack = _pack(app_con, c["case_id"])
    assert {"R-DME-01", "G-REFCONC", "T-RAMP"} <= {e["detector"].split("@")[0] for e in pack["evidence"]}


def test_own_history_signals_have_no_lines_and_no_dollars_of_their_own(app_con):
    pack = _pack(app_con, _cases(app_con)["P-0041"]["case_id"])
    selfs = [e for e in pack["evidence"] if e["channel"] == "SELF"]
    assert selfs and all(e["lineCount"] == 0 and e["dollars"] == 0 and e["type"] == "temporal_stat" for e in selfs)
    cus = next(e for e in selfs if e["detector"].startswith("T-CUSUM"))
    assert "moved from" in cus["statement"] and "stayed there" in cus["statement"]


def test_graph_view_shows_the_ring_loop_and_ownership(app_con):
    c = next(r for r in _cases(app_con).values() if "P-0062" in {s["id"] for s in json.loads(r["subjects_json"])})
    g = json.loads(app_con.execute("SELECT graph_json FROM serving_graph WHERE case_id = ?",
                                   (c["case_id"],)).fetchone()[0])
    types = {n["type"] for n in g["nodes"]}
    assert {"provider", "owner", "member"} <= types
    refs = {(e["source"], e["target"]) for e in g["edges"] if e["type"] == "referral"}
    ring = ["P-0062", "P-0063", "P-0064", "P-0065"]
    assert all((a, b) in refs for a, b in zip(ring, ring[1:] + ring[:1], strict=True))
    assert all({"x", "y"} <= set(n) for n in g["nodes"])
    ids = {n["id"] for n in g["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])


def test_timeline_view_has_a_month_series_events_and_a_trend(app_con):
    c = _cases(app_con)["P-0041"]
    t = json.loads(app_con.execute("SELECT timeline_json FROM serving_timeline WHERE case_id = ?",
                                   (c["case_id"],)).fetchone()[0])
    assert len(t["months"]) == 24 and t["months"][0]["month"] == "2024-01" and t["months"][-1]["month"] == "2025-12"
    assert sum(m["flaggedLines"] for m in t["months"]) > 0
    kinds = {e["type"] for e in t["events"]}
    assert {"ENROLLED", "FIRST_FLAG", "CHANGE"} <= kinds
    assert t["signals"] and t["signals"][0]["metric"] in temporal.METRICS
    assert t["trend"]["label"] in (None, "ESCALATING", "STABLE", "DECLINING")
    assert [e["date"] for e in t["events"]] == sorted(e["date"] for e in t["events"])


def test_every_case_has_a_graph_and_a_timeline(app_con):
    n_cases = app_con.execute("SELECT COUNT(*) FROM serving_case").fetchone()[0]
    assert app_con.execute("SELECT COUNT(*) FROM serving_graph").fetchone()[0] == n_cases
    assert app_con.execute("SELECT COUNT(*) FROM serving_timeline").fetchone()[0] == n_cases


def test_evaluation_reports_ring_recovery_and_temporal_delay(app_con):
    ev = json.loads(app_con.execute("SELECT eval_json FROM serving_eval").fetchone()[0])
    assert ev["network"]["ringRecovered"] is True and ev["network"]["casesPerRing"] == 1
    t = ev["temporal"]
    assert t["detected"] >= 4 and t["medianDelayMonths"] is not None and t["medianDelayMonths"] <= 3
    assert t["falseAlarmsPer1000ProviderMonths"] < 10 and not math.isnan(t["falseAlarmsPer1000ProviderMonths"])
    assert isinstance(pd.DataFrame(t["delays"]), pd.DataFrame)
