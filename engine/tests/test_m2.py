"""M2: impossible timing, phantom stays, peer statistics, the PEER channel, decoys D1-D4."""

import json
from datetime import date, timedelta

import pytest

from claimshield import reference as ref
from claimshield.cases.score import decide_tier, evidence_strength, risk_signal
from claimshield.detect import peer
from tests.helpers import TinyDb


# ================================================================== R-TIME-01
def _busy_day(n, code="99215", provider="P1"):
    db = TinyDb()
    for i in range(n):
        db.claim([(code,)], member=f"M{i}", provider=provider, day=date(2025, 3, 3))
    return db


def test_time_over_the_cap_flags_every_line_with_prorata_estimated_dollars():
    hits = _busy_day(19).run("R-TIME-01")                        # 19 x 40 min = 760 > 720
    assert len(hits) == 19
    row = hits.iloc[0]
    assert row.flag_role == "DAY_OVERLOAD"
    assert row.dollars == pytest.approx(float(row.paid_amt) * 40 / 760, abs=0.01)


def test_time_at_the_cap_is_not_flagged():
    assert len(_busy_day(18).run("R-TIME-01")) == 0              # exactly 720 minutes
    assert len(_busy_day(5).run("R-TIME-01")) == 0


def test_time_is_per_provider_and_per_day():
    db = TinyDb()
    for i in range(10):
        db.claim([("99215",)], member=f"A{i}", provider="P1", day=date(2025, 3, 3))
        db.claim([("99215",)], member=f"B{i}", provider="P2", day=date(2025, 3, 3))
        db.claim([("99215",)], member=f"C{i}", provider="P1", day=date(2025, 3, 4))
    assert len(db.run("R-TIME-01")) == 0                         # 400 minutes each: nobody is over


def test_time_counts_units_of_timed_codes():
    db = TinyDb()
    db.claim([("97110", 4)] * 13, member="M1", provider="P1")    # 13 lines x 4 units x 15 min = 780
    assert len(db.run("R-TIME-01")) == 13


def test_time_ignores_codes_with_no_assumed_minutes():
    db = TinyDb()
    for i in range(40):
        db.claim([("85025",)], member=f"M{i}", provider="P1")    # 0 minutes assumed
    assert len(db.run("R-TIME-01")) == 0


# ================================================================== R-IP-01
def test_ip_flags_service_strictly_inside_a_stay_only():
    db = TinyDb()
    db.stay("M1", date(2025, 2, 10), date(2025, 2, 20))
    inside = db.claim([("99213",)], member="M1", day=date(2025, 2, 15))
    db.claim([("99213",)], member="M1", day=date(2025, 2, 10))   # admission day
    db.claim([("99213",)], member="M1", day=date(2025, 2, 20))   # discharge day
    db.claim([("99213",)], member="M1", day=date(2025, 2, 21))
    hits = db.run("R-IP-01")
    assert list(hits.claim_id) == [inside] and hits.iloc[0].flag_role == "DURING_STAY"


def test_ip_ignores_facility_places_of_service_and_other_members():
    db = TinyDb()
    db.stay("M1", date(2025, 2, 10), date(2025, 2, 20))
    db.claim([("99213",)], member="M1", day=date(2025, 2, 15), pos="21")     # the hospital itself
    db.claim([("99213",)], member="M2", day=date(2025, 2, 15))
    assert len(db.run("R-IP-01")) == 0


def test_ip_back_to_back_stays_flag_a_line_once():
    db = TinyDb()
    db.stay("M1", date(2025, 2, 10), date(2025, 2, 20))
    db.stay("M1", date(2025, 2, 12), date(2025, 2, 22))
    db.claim([("99213",)], member="M1", day=date(2025, 2, 15))
    assert len(db.run("R-IP-01")) == 1


# ================================================================== R-GEO-01
FAR_A, FAR_B = (40.0, -75.0), (40.0, -73.0)                      # about 170 km apart


def _geo_world(history_with="P2"):
    db = TinyDb()
    db.place("P1", *FAR_A)
    db.place("P2", *FAR_B)
    for d in range(1, 6):                                       # the member's usual provider
        db.claim([("99213",)], member="M1", provider=history_with, day=date(2025, 3, d))
    return db


def test_geo_flags_the_unfamiliar_side_of_two_distant_places_on_one_day():
    db = _geo_world("P2")
    db.claim([("99214",)], member="M1", provider="P2", day=date(2025, 3, 20))
    odd = db.claim([("99213",)], member="M1", provider="P1", day=date(2025, 3, 20))
    hits = db.run("R-GEO-01")
    assert list(hits.claim_id) == [odd] and hits.iloc[0].provider_id == "P1"
    assert hits.iloc[0].flag_role == "DISTANT_SAME_DAY"


def test_geo_side_follows_the_members_history_not_the_provider_id():
    db = _geo_world("P1")                                        # now P1 is the usual provider
    odd = db.claim([("99214",)], member="M1", provider="P2", day=date(2025, 3, 20))
    db.claim([("99213",)], member="M1", provider="P1", day=date(2025, 3, 20))
    assert list(db.run("R-GEO-01").claim_id) == [odd]


def test_geo_is_quiet_for_near_places_other_days_and_other_members():
    db = TinyDb()
    db.place("P1", 40.0, -75.0)
    db.place("P2", 40.05, -75.0)                                 # a few km away
    db.place("P3", *FAR_B)
    db.claim([("99213",)], member="M1", provider="P1", day=date(2025, 3, 20))
    db.claim([("99213",)], member="M1", provider="P2", day=date(2025, 3, 20))
    db.claim([("99213",)], member="M2", provider="P1", day=date(2025, 3, 20))
    db.claim([("99213",)], member="M2", provider="P3", day=date(2025, 3, 21))     # far, but another day
    db.claim([("99213",)], member="M3", provider="P3", day=date(2025, 3, 20))      # far, but another member
    assert len(db.run("R-GEO-01")) == 0


def test_geo_ignores_dme_claims():
    db = _geo_world("P2")
    db.claim([("E0601",)], member="M1", provider="P1", day=date(2025, 3, 20), claim_type="DME")
    db.claim([("99213",)], member="M1", provider="P2", day=date(2025, 3, 20))
    assert len(db.run("R-GEO-01")) == 0


# ================================================================== peer statistics (pure functions)
def test_strength_maps_the_alert_threshold_to_point_four_and_saturates():
    assert peer.strength_from_z(3.0) == 0.4
    assert peer.strength_from_z(4.0) == pytest.approx(0.55)
    assert peer.strength_from_z(50.0) == 1.0
    assert peer.strength_from_z(1.0) == 0.4            # never below the threshold value


def test_robust_z_uses_median_and_mad_not_mean_and_sd():
    z, med = peer.robust_z(1.0, [0.2, 0.25, 0.3, 0.3, 0.35, 5.0], floor=0.03)
    assert med == pytest.approx(0.3)
    assert z > 5                                         # one wild peer does not hide the outlier


def test_robust_z_floor_stops_a_tight_group_from_exploding():
    z, _ = peer.robust_z(0.31, [0.30] * 8, floor=0.03)
    assert z == pytest.approx(0.01 / 0.03)


def test_shrinkage_pulls_small_volumes_toward_the_peer_median():
    assert peer.shrink(1.0, n=10, peer_median=0.3, k=10) == pytest.approx(0.65)
    assert peer.shrink(1.0, n=1000, peer_median=0.3, k=10) == pytest.approx(1.0, abs=0.01)


def test_haversine_is_zero_for_the_same_point_and_about_right_for_two_degrees_of_longitude():
    assert peer.haversine_km(40, -75, 40, -75) == pytest.approx(0)
    assert peer.haversine_km(40, -75, 40, -73) == pytest.approx(170, abs=5)


# ================================================================== S-UPC on hand-built peers
def _upc_world(n_peers, upcoder_share_codes=("99215",), months=range(7, 13)):
    db = TinyDb()
    providers = [f"P{i}" for i in range(n_peers)] + ["PX"]
    k = 0
    for p in providers:
        for m in months:
            for j in range(12):
                code = ("99213" if j < 8 else "99214") if p != "PX" else upcoder_share_codes[0]
                k += 1
                db.claim([(code,)], member=f"M{k}", provider=p, day=date(2025, m, 1 + j))
    return db


def test_upcoding_signal_flags_the_provider_far_above_a_peer_group():
    hits = peer.run_peer_signals(_upc_world(7).con)
    upc = hits[hits.rule_id == "S-UPC"]
    assert set(upc.provider_id) == {"PX"}
    detail = json.loads(upc.iloc[0].detail)
    assert detail["peers"] == 7 and detail["share"] > 0.8 and detail["peer"] == pytest.approx(0.3333, abs=0.01)
    assert upc.flag_role.eq("PEER_HIGH_LEVEL").all() and (upc.dollars > 0).all()
    assert set(detail) >= {"z", "strength", "acuity", "peerAcuity", "month"}


def test_peer_signals_need_enough_peers():
    assert len(peer.run_peer_signals(_upc_world(ref.PEER_MIN_PEERS - 1).con)) == 0


def test_peer_group_with_no_outlier_gives_no_signal():
    db = _upc_world(7, upcoder_share_codes=("99213",))
    assert len(peer.run_peer_signals(db.con)) == 0


def test_peer_signal_ignores_providers_with_too_little_volume():
    db = TinyDb()
    for p in [f"P{i}" for i in range(7)]:
        for j in range(60):
            db.claim([("99213",)], member=f"{p}-{j}", provider=p, day=date(2025, 10, 1 + j % 28))
    for j in range(5):                                           # only five high-level lines: below the minimum
        db.claim([("99215",)], member=f"X{j}", provider="PX", day=date(2025, 10, 2 + j))
    assert len(peer.run_peer_signals(db.con)) == 0


# ================================================================== scoring with the PEER channel
def test_line_plus_peer_with_a_hard_fact_reaches_high():
    ch = {"LINE": 1.0, "PEER": 0.79, "SELF": 0.0, "NETWORK": 0.0}
    es = evidence_strength(ch, hard_fact=True, months_with_alerts=6)
    tier, reasons = decide_tier(ch, True, es)
    assert tier == "HIGH" and es >= 0.65 and "2 independent channels" in reasons[0]


def test_line_plus_peer_without_a_hard_fact_is_medium():
    ch = {"LINE": 0.8, "PEER": 0.56, "SELF": 0.0, "NETWORK": 0.0}
    es = evidence_strength(ch, hard_fact=False, months_with_alerts=4)
    assert decide_tier(ch, False, es)[0] == "MEDIUM"


def test_a_peer_signal_alone_never_opens_a_case():
    ch = {"LINE": 0.0, "PEER": 1.0, "SELF": 0.0, "NETWORK": 0.0}
    es = evidence_strength(ch, hard_fact=False, months_with_alerts=6)
    tier, why = decide_tier(ch, False, es)
    assert tier == "LOW" and any("statistical" in w for w in why)


def test_corroboration_raises_the_risk_signal():
    assert risk_signal({"LINE": 0.8, "PEER": 0.5}) > risk_signal({"LINE": 0.8})


# ================================================================== what the pipeline produced
def _case_by_provider(app_con):
    return {r["primary_provider_id"]: r for r in app_con.execute("SELECT * FROM serving_case")}


def test_corroborated_cases_reach_high_through_two_channels(app_con):
    cases = _case_by_provider(app_con)
    for prov in ("P-0041", "P-0045", "P-0044"):          # upcoding+duplicates, utilization+duplicates, ghost+death
        c = cases[prov]
        ch = json.loads(c["channels_json"])
        assert c["tier"] == "HIGH" and ch["LINE"] >= 0.3 and ch["PEER"] >= 0.3, prov
    reasons = json.loads(cases["P-0041"]["tier_reasons_json"])
    assert "independent channels" in reasons[0]["text"]


def test_line_rules_without_a_hard_fact_corroborated_by_own_history_are_medium(app_con):
    c = _case_by_provider(app_con)["P-0043"]            # impossible daily time plus a sustained change in its pattern
    assert c["tier"] == "MEDIUM"
    ch = json.loads(c["channels_json"])
    assert ch["LINE"] >= 0.3 and ch["SELF"] >= 0.3
    assert c["dollars_basis"] == "ESTIMATED" and c["dollars_exact"] == 0 and c["dollars_est"] > 0


def test_single_line_rule_cases_for_the_new_rules_are_medium(app_con):
    cases = _case_by_provider(app_con)
    assert cases["P-0060"]["tier"] == "MEDIUM"          # same member in two distant places
    assert cases["P-0061"]["tier"] == "MEDIUM"          # services during an inpatient stay


def test_dollars_are_split_into_exact_and_estimated(app_con):
    cases = _case_by_provider(app_con)
    assert cases["P-0002"]["dollars_basis"] == "EXACT" and cases["P-0002"]["dollars_est"] == 0
    mixed = cases["P-0041"]
    assert mixed["dollars_basis"] == "MIXED" and mixed["dollars_exact"] > 0 and mixed["dollars_est"] > 0
    header = json.loads(mixed["header_json"])
    assert header["dollars"]["estimated"] == pytest.approx(mixed["dollars_est"])
    pack = json.loads(app_con.execute("SELECT pack_json FROM serving_evidence_pack WHERE case_id = ?",
                                      (mixed["case_id"],)).fetchone()[0])
    n = pack["numbers"]
    assert n["S.dollars"]["value"] == pytest.approx(n["S.dollarsExact"]["value"] + n["S.dollarsEstimated"]["value"],
                                                    abs=0.01)


def test_peer_evidence_is_labelled_estimated_and_quotes_registry_numbers(app_con):
    c = _case_by_provider(app_con)["P-0041"]
    pack = json.loads(app_con.execute("SELECT pack_json FROM serving_evidence_pack WHERE case_id = ?",
                                      (c["case_id"],)).fetchone()[0])
    e1, e2 = pack["evidence"][0], pack["evidence"][1]
    assert e1["channel"] == "LINE" and e1["dollarsBasis"] == "EXACT"            # line evidence comes first
    assert e2["channel"] == "PEER" and e2["type"] == "peer_stat" and e2["dollarsBasis"] == "ESTIMATED"
    assert e2["detector"] == "S-UPC@v1" and e2["hardFact"] is False
    for key in ("share", "peer", "peers", "acuity", "peerAcuity", "dollars"):
        assert f"E2.{key}" in pack["numbers"]
    assert "peer median" in e2["statement"]
    assert {"L1", "L2", "L4"} <= {x["id"] for x in pack["limitations"]}
    assert "network" in next(x for x in pack["limitations"] if x["id"] == "L2")["text"].lower()


def test_peer_only_schemes_and_decoys_are_monitored_never_cased(app_con):
    cases = _case_by_provider(app_con)
    monitored = {r["provider_id"] for r in app_con.execute("SELECT provider_id FROM serving_monitor_item")}
    for prov in ("P-0053", "P-0059"):                        # D4, D3: a statistical signal alone
        assert prov in monitored and prov not in cases, prov
    # D1 (recurring treatment) trips three independent channels but has no hard fact: an expert-review case that a
    # human must be able to reject; this is the false positive the Second Brain learns from
    assert cases["P-0046"]["tier"] == "MEDIUM" and cases["P-0047"]["tier"] == "MEDIUM"
    # upcoding alone is only a Monitor item until its own history confirms a change; then two channels make it a case
    upc_b = cases["P-0042"]
    assert upc_b["tier"] == "MEDIUM" and set(json.loads(upc_b["channels_json"])) >= {"PEER", "SELF"}


def test_decoy_providers_are_flagged_by_statistics_but_never_reach_high(app_con):
    ev = json.loads(app_con.execute("SELECT eval_json FROM serving_eval").fetchone()[0])
    by = {d["scheme"]: d for d in ev["decoyProviders"]}
    assert set(by) == {"DEC-D1-01", "DEC-D1-02", "DEC-D2-01", "DEC-D2-02", "DEC-D3-01", "DEC-D4-01"}
    assert "S-UTL" in by["DEC-D1-01"]["flaggedBy"]
    assert "S-DIST" in by["DEC-D3-01"]["flaggedBy"]
    assert "S-UPC" in by["DEC-D4-01"]["flaggedBy"]
    for d in by.values():
        assert not d["reachedHigh"], d                       # no decoy may ever be HIGH
        if d["type"] != "D1":
            assert not d["opensCase"], d                     # only D1 reaches expert review (and is then governed)
    # D2 (shared buildings): only the weak infrastructure signal sees them, and a shared building alone is no case
    assert by["DEC-D2-01"]["flaggedBy"] == ["G-INFRA"] and by["DEC-D2-02"]["flaggedBy"] == ["G-INFRA"]


def test_every_injected_scheme_provider_is_found(app_con):
    ev = json.loads(app_con.execute("SELECT eval_json FROM serving_eval").fetchone()[0])
    assert ev["schemes"] and all(s["flagged"] for s in ev["schemes"]), [s for s in ev["schemes"] if not s["flagged"]]
    kinds = {s["type"] for s in ev["schemes"]}
    assert {"UPC", "UTL", "PHC", "TMA", "TMB", "PHB"} <= kinds
    recall = {r["rule"]: r["recall"] for r in ev["rules"]}
    assert set(recall) == set(ref.SQL_RULES) | {"S-UPC", "S-UTL", "S-GHOST", "G-OWNREF"}
    assert all(v == 1.0 for v in recall.values()), recall


def test_legitimate_data_is_clean_for_the_new_line_rules(claims_con, m1):
    """Nothing but the injected schemes is flagged by the new SQL rules (the generator is region- and stay-aware)."""
    import duckdb

    from claimshield.detect import rules

    gt = duckdb.connect(str(m1["paths"]["gt"]), read_only=True)
    rows = gt.execute("SELECT claim_id, line_no FROM gt_claim_label "
                      "WHERE label IN ('POSITIVE', 'DECOY_CONTEXT')").fetchall()
    pos = {(c, n) for c, n in rows}
    gt.close()
    for rid in ("R-TIME-01", "R-GEO-01", "R-IP-01"):
        df = rules.run_rule(claims_con.cursor(), rid)
        extra = {(c, n) for c, n in zip(df.claim_id, df.line_no, strict=True)} - pos
        assert not extra, (rid, len(extra))
        assert len(df) > 0, rid


def test_peer_signals_never_flag_ordinary_providers(claims_con):
    hits = peer.run_peer_signals(claims_con.cursor())
    flagged = set(hits.provider_id)
    # the only providers the statistics may flag are the scheme and decoy providers (and the ones that share
    # their lines, such as the impossible-time provider whose extra visits are all level 5)
    assert flagged <= {"P-0041", "P-0042", "P-0043", "P-0044", "P-0045", "P-0046", "P-0047", "P-0053", "P-0059",
                       "P-0060", "P-0061"}, flagged
    assert {"S-UPC", "S-UTL", "S-GHOST", "S-DIST"} == set(hits.rule_id)


def test_ghost_members_are_exclusive_and_some_are_recorded_deceased(claims_con):
    n_ghost = claims_con.execute("""SELECT COUNT(*) FROM member m WHERE NOT EXISTS
        (SELECT 1 FROM claim c WHERE c.member_id = m.member_id AND c.rendering_provider_id <> 'P-0044')
        AND EXISTS (SELECT 1 FROM claim c WHERE c.member_id = m.member_id)""").fetchone()[0]
    assert n_ghost == 30
    dead = claims_con.execute("""SELECT COUNT(*) FROM member m WHERE death_dt IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM claim c WHERE c.member_id = m.member_id AND c.rendering_provider_id <> 'P-0044')
        AND EXISTS (SELECT 1 FROM claim c WHERE c.member_id = m.member_id)""").fetchone()[0]
    assert dead == 6


def test_shared_building_providers_look_ordinary(claims_con):
    rows = claims_con.execute("""SELECT building_id, COUNT(*) FROM provider_location WHERE building_id IS NOT NULL
                                 GROUP BY 1 ORDER BY 1""").fetchall()
    assert rows == [("B-001", 4), ("B-002", 4)]
    # same building and phone, different tax IDs: unrelated owners
    tins = claims_con.execute("""SELECT COUNT(DISTINCT p.tin_syn) FROM provider p JOIN provider_location l USING
                                 (provider_id) WHERE l.building_id = 'B-001'""").fetchone()[0]
    assert tins == 4


def test_new_dates_stay_inside_the_window(claims_con):
    lo, hi = claims_con.execute("SELECT MIN(service_dt), MAX(service_dt) FROM claim_line").fetchone()
    assert lo >= ref.WINDOW_START and hi <= ref.WINDOW_END + timedelta(days=0)
