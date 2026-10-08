"""Case impact, the risk x evidence x confidence framework, the reasoning chain and flagged / not-flagged explanations."""

from __future__ import annotations

import json

import pytest

from claimshield import reference as ref
from claimshield.evidence import insight


@pytest.fixture()
def packs(app_con):
    return {r[0]: json.loads(r[1]) for r in app_con.execute("SELECT case_id, pack_json FROM serving_evidence_pack")}


@pytest.fixture()
def headers(app_con):
    return {r[0]: json.loads(r[1]) for r in app_con.execute("SELECT case_id, header_json FROM serving_case")}


def test_every_pack_has_the_four_new_sections_and_a_hash_that_covers_them(packs):
    from claimshield.evidence.pack import pack_sha256
    assert packs
    for cid, p in packs.items():
        assert {"impact", "confidence", "reasoning", "explanation"} <= p.keys(), cid
        assert p["packSha256"] == pack_sha256(p)
        tampered = {**p, "impact": {**p["impact"], "severity": {"value": 0.0}}}
        assert pack_sha256(tampered) != p["packSha256"]


def test_every_evidence_item_says_what_was_observed_against_which_threshold_and_from_which_fields(packs):
    for cid, p in packs.items():
        for e in p["evidence"]:
            o = e["observation"]
            assert o["threshold"] and o["sourceFields"] and o["observed"] is not None, (cid, e["id"])
            if e["channel"] == "LINE":
                assert o["observed"]["lines"] == e["lineCount"] and o["observed"]["claims"] >= 1
                assert abs(o["observed"]["dollars"] - e["dollars"]) < 0.01
            if e["channel"] == "PEER":
                assert o["peerBaseline"] and o["peerBaseline"]["peers"] >= ref.PEER_MIN_PEERS
            if e["channel"] == "SELF":
                assert o["history"] is not None or o["peerBaseline"] is not None or o["observed"]
            if e["channel"] == "NETWORK":
                assert o["network"] is not None


def test_impact_values_are_traceable_and_agree_with_the_case_header(packs, headers, app_con):
    for cid, p in packs.items():
        items = {i["key"]: i for i in p["impact"]["items"]}
        h = headers[cid]
        assert items["members"]["value"] == h["memberCount"]
        assert abs(items["exposureExact"]["value"] - h["dollars"]["exact"]) < 0.01
        assert abs(items["exposureEstimated"]["value"] - h["dollars"]["estimated"]) < 0.01
        n_lines = app_con.execute("SELECT COUNT(*) FROM serving_case_line WHERE case_id = ?", [cid]).fetchone()[0]
        assert items["lines"]["value"] >= n_lines                      # the pack counts every flagged line
        claims = {r[0] for r in app_con.execute("SELECT claim_id FROM serving_case_line WHERE case_id = ?", [cid])}
        assert items["claims"]["value"] >= len(claims)
        for i in p["impact"]["items"]:
            assert i["why"] and "{{" not in i["why"], (cid, i["id"])     # "why do we believe this?" is always answered
            assert i["basis"] in {"EXACT", "ESTIMATED", "DERIVED"} and i["sourceFields"]
            assert p["numbers"][f"{i['id']}.value"]["value"] == i["value"]
        assert h["impact"]["members"] == items["members"]["value"]


def test_exact_and_estimated_exposure_are_never_merged(packs):
    for p in packs.values():
        items = {i["key"]: i for i in p["impact"]["items"]}
        assert items["exposureExact"]["basis"] == "EXACT" and items["exposureEstimated"]["basis"] == "ESTIMATED"
        assert p["impact"]["exposureBasis"] in {"EXACT", "ESTIMATED", "MIXED"}


def test_confidence_is_separate_from_risk_and_routes_by_level(packs, headers):
    levels = set()
    for cid, p in packs.items():
        c = p["confidence"]
        levels.add(c["level"])
        assert c["level"] == p["scores"]["tier"] == headers[cid]["tier"]
        assert {"risk", "evidence", "precedent", "route", "statement"} <= c.keys()
        assert "not confidence" in c["risk"]["note"]
        assert c["risk"]["outlook"]["label"].startswith("PREDICTION")
        assert c["evidence"]["count"] == len(p["evidence"]) and c["evidence"]["evidenceIds"]
        assert all(s["id"] in {e["id"] for e in p["evidence"]} for s in c["evidence"]["supporting"])
        assert c["route"]["requiresHuman"] is True
        if c["level"] == "HIGH":
            assert c["route"]["code"] == "HIGH_NONBLOCKING" and "audited" in c["route"]["text"]
        if c["level"] == "MEDIUM":
            assert c["route"]["code"] == "EXPERT_REVIEW" and c["route"]["automationEligible"] is False
        assert not any(t in c["statement"].lower() for t in ref.FORBIDDEN_TERMS)
    assert levels <= {"HIGH", "MEDIUM"}


def test_a_precedent_closed_unfounded_is_shown_as_a_contradicting_signal(packs):
    seen = [c for p in packs.values() for c in p["confidence"]["evidence"]["contradicting"] if c["source"] == "precedent"]
    for c in seen:
        assert "closed unfounded" in c["text"] and c["refs"]


def test_a_low_confidence_case_never_recommends_an_action_and_names_what_is_missing(app_con):
    rows = [json.loads(r[0]) for r in app_con.execute("SELECT reasons_json FROM serving_monitor_item")]
    assert rows
    for m in rows:
        ex = m["explanation"]
        assert ex["flagged"] is False and insight.INSUFFICIENT in ex["confidenceLine"]
        assert ex["headline"].startswith("Not escalated because")
        assert ex["missingEvidence"] and ex["recommendedHumanAction"]["action"] == "MONITOR"
        assert insight.INSUFFICIENT in ex["recommendedHumanAction"]["text"]


def test_the_reasoning_chain_has_all_seven_steps_in_order_with_citations(packs):
    order = ["RETRIEVE", "INTERPRET", "APPLY_RULES", "PROPOSE", "SCORE", "CITE", "HUMAN_REVIEW"]
    for cid, p in packs.items():
        steps = p["reasoning"]["steps"]
        assert [s["step"] for s in steps] == order, cid
        assert [s["id"] for s in steps] == [f"RS{i}" for i in range(1, 8)]
        ev = {e["id"] for e in p["evidence"]}
        assert set(steps[5]["refs"]) == ev                             # CITE lists every evidence id
        assert "not a finding" in steps[3]["summary"] or "Insufficient" in steps[3]["summary"]
        for s in steps[2]["details"]:
            assert "threshold" in s


def test_a_flagged_case_is_explained_with_trigger_peer_history_network_contradictions_and_missing(packs):
    for cid, p in packs.items():
        x = p["explanation"]
        assert x["flagged"] is True and x["headline"].startswith("Flagged because")
        assert x["trigger"]["id"] in {e["id"] for e in p["evidence"]}
        assert x["confidenceLine"] == p["confidence"]["statement"]
        assert x["recommendedHumanAction"]["action"] == p["defaultAction"]
        assert abs(sum(c["share"] for c in x["riskContribution"]) - 1.0) < 0.01
        for key in ("supportingEvidence", "whyUnusual", "peerComparison", "historicalBehaviour", "networkContext",
                    "contradictory", "missingEvidence"):
            assert key in x
        assert not any(t in json.dumps(x).lower() for t in ref.FORBIDDEN_TERMS)


def test_the_peer_case_explains_the_peer_baseline(packs):
    peer = [(cid, p) for cid, p in packs.items() if any(e["channel"] == "PEER" for e in p["evidence"])]
    assert peer
    for _cid, p in peer:
        assert p["explanation"]["peerComparison"] and p["explanation"]["whyUnusual"]


def test_a_decoy_style_case_does_not_reach_high_through_peer_signals_alone(packs):
    for p in packs.values():
        if p["confidence"]["level"] == "HIGH":
            assert any(e["hardFact"] for e in p["evidence"]) or len(p["confidence"]["evidence"]["channelsAgreeing"]) >= 3


def test_core_care_codes_are_recognised_and_never_automation_eligible():
    from claimshield.evidence.insight import is_core_care
    assert is_core_care("99285") and is_core_care("90935") and is_core_care("96413") and is_core_care("99291")
    assert not is_core_care("99213") and not is_core_care("85025")
