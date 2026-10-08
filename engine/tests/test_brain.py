"""The Second Brain in the engine: precedent vectors and fit, the governed exception language, simulation, re-run
and the funnel diff. Unit tests first, then the whole loop on the real generated data."""

import json
import math
import time
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from claimshield import analysis
from claimshield import reference as ref
from claimshield.api import main as api
from claimshield.brain import exceptions as exc
from claimshield.brain import precedents as prec


def _pf(**over):
    base = {n: 0.0 for n in prec.FV_NAMES}
    base.update(em_high_share=0.3, lines_per_member=1.5, acuity_mean=0.4, tenure_months=60, mean_member_km=15)
    base.update(over)
    return base


def _prec(pid, disp, fv, scheme="UTL", status="ACTIVE", source="LIVE", reason=None):
    return prec.Precedent(pid, source, scheme, None, disp, reason, fv, status=status)


STATS = {"mean": [0.3] * 12, "sd": [0.2] * 12}


# ================================================================== vectors and similarity
def test_the_vector_is_scaled_into_zero_one_and_clipped():
    v = prec.fv_vector(_pf(lines_per_member=50, em_high_share=-1, mean_member_km=400), 1e9, 9)
    assert len(v) == len(prec.FV_NAMES) == 12 and all(0.0 <= x <= 1.0 for x in v)
    assert v[prec.FV_NAMES.index("lines_per_member")] == 1.0 and v[prec.FV_NAMES.index("em_high_share")] == 0.0
    assert v[prec.FV_NAMES.index("n_channels")] == 1.0


def test_z_scores_are_clipped_and_a_tiny_spread_cannot_explode():
    z = prec.zvec([1.0] + [0.3] * 11, {"mean": [0.3] * 12, "sd": [0.0] * 12})
    assert z.max() == 5.0 and z.min() == 0.0
    assert prec.cosine(np.zeros(3), np.ones(3)) == 0.0


def test_similarity_is_one_for_identical_vectors_and_low_for_opposite_profiles():
    a = prec.fv_vector(_pf(), 5000, 2)
    assert prec.similarity(a, a, STATS) == pytest.approx(1.0)
    b = prec.fv_vector(_pf(em_high_share=0.9, lines_per_member=9, acuity_mean=0.9), 5000, 2)
    c = prec.fv_vector(_pf(em_high_share=0.0, lines_per_member=0.2, acuity_mean=0.1), 5000, 2)
    assert prec.similarity(b, c, STATS) < 0.3


def test_matching_keeps_only_active_precedents_of_the_same_scheme_above_the_threshold():
    fv = prec.fv_vector(_pf(), 5000, 2)
    good = _prec("PRC-1", "UNFOUNDED", fv)
    other = _prec("PRC-2", "UNFOUNDED", fv, scheme="DUP")
    retired = _prec("PRC-3", "UNFOUNDED", fv, status="RETIRED")
    far = _prec("PRC-4", "UNFOUNDED", prec.fv_vector(_pf(em_high_share=0.0, lines_per_member=0.0, acuity_mean=0.0,
                                                          tenure_months=0, mean_member_km=0), 1, 0))
    got = prec.match(fv, [good, other, retired, far], {"UTL"}, None, STATS)
    assert [m.precedent.precedent_id for m in got] == ["PRC-1"] and got[0].similarity == pytest.approx(1.0)
    assert len(got[0].compare) == 5 and {"feature", "case", "precedent"} <= set(got[0].compare[0])


def test_matching_is_sorted_capped_and_deterministic():
    fv = prec.fv_vector(_pf(), 5000, 2)
    ps = [_prec(f"PRC-{i}", "CONFIRMED", prec.fv_vector(_pf(em_high_share=0.3 + i * 0.01), 5000, 2))
          for i in range(9)]
    a = prec.match(fv, ps, {"UTL"}, None, STATS)
    assert len(a) == prec.TOP_N and [m.similarity for m in a] == sorted((m.similarity for m in a), reverse=True)
    again = prec.match(fv, ps, {"UTL"}, None, STATS)
    assert [m.precedent.precedent_id for m in a] == [m.precedent.precedent_id for m in again]


def test_precedent_fit_weighs_outcomes_by_similarity_and_counts_strong_unfounded():
    fv = prec.fv_vector(_pf(), 5000, 2)

    def m(disp, sim):
        return prec.Match(_prec("P", disp, fv), sim, [])

    fit, strong = prec.fit([m("UNFOUNDED", 0.9), m("UNFOUNDED", 0.8)])
    assert fit == -1.0 and strong == 2
    fit, strong = prec.fit([m("CONFIRMED", 0.9), m("UNFOUNDED", 0.9)])
    assert fit == pytest.approx(0.0) and strong == 1
    fit, strong = prec.fit([m("UNFOUNDED", 0.7)])
    assert fit == -1.0 and strong == 0                       # similar, but not strong enough to force a tier
    assert prec.fit([]) == (0.0, 0)
    assert prec.fit([m("EDUCATION", 1.0)])[0] == 0.5 and prec.fit([m("INSUFFICIENT", 1.0)])[0] == -0.3


def test_the_seed_library_is_deterministic_labelled_synthetic_and_covers_every_outcome():
    pf = {f"P{i}": _pf(em_high_share=0.2 + 0.01 * i) for i in range(8)}
    invs = [{"id": "INV-0001", "provider": "P1", "scheme": "UTL", "closed": "2024-06-01", "disposition": "UNFOUNDED",
             "reason": "LEGIT_CLINICAL_PATTERN", "exposure": 9000.0}]
    a = prec.seed_precedents(pf, invs, {"P1": "PRIMARY_CARE"})
    b = prec.seed_precedents(pf, invs, {"P1": "PRIMARY_CARE"})
    assert [(p.precedent_id, p.fv) for p in a] == [(p.precedent_id, p.fv) for p in b]
    assert len(a) == 1 + sum(x[3] for x in prec.ARCHETYPES) and {p.disposition for p in a} == set(prec.OUTCOME)
    assert a[0].specialty_code == "PRIMARY_CARE" and a[0].rationale.endswith("(prior investigation INV-0001)")
    assert all(p.source == "SEED" and (p.rationale.startswith("Synthetic") or p.precedent_id == "PRC-0001")
               for p in a)


# ================================================================== the exception language
def _rule(**over):
    d = dict(exc_id="EXC-9", version=1, scope={"rule_ids": ["S-UTL"], "specialty_code": "PRIMARY_CARE"},
             condition=[{"field": "lines_per_member", "op": "<=", "value": 7.0},
                        {"field": "hard_fact_alert_count", "op": "==", "value": 0}],
             effect="DOWNGRADE_TO_MONITOR", support_n=2)
    d.update(over)
    return exc.ExceptionRule(**d)


def test_a_well_formed_rule_validates_and_round_trips():
    r = _rule()
    assert exc.validate(r) == []
    assert exc.ExceptionRule.from_dict(r.to_dict()) == r


@pytest.mark.parametrize("breakage, fragment", [
    ({"scope": {"rule_ids": ["R-DUP-01"], "specialty_code": None}}, "hard-fact rules cannot be excepted"),
    ({"scope": {"rule_ids": ["R-NOPE"], "specialty_code": None}}, "unknown rules"),
    ({"scope": {"rule_ids": [], "specialty_code": None}}, "at least one rule"),
    ({"effect": "RAISE_TIER"}, "unknown effect"),
    ({"condition": [{"field": "lines_per_member", "op": "<=", "value": 7.0}]}, "mandatory"),
    ({"condition": [{"field": "paid_total", "op": "<=", "value": 7.0},
                    {"field": "hard_fact_alert_count", "op": "==", "value": 0}]}, "not in the catalogue"),
    ({"condition": [{"field": "lines_per_member", "op": "!=", "value": 7.0},
                    {"field": "hard_fact_alert_count", "op": "==", "value": 0}]}, "operator"),
    ({"condition": [{"field": "lines_per_member", "op": "<=", "value": "seven"},
                    {"field": "hard_fact_alert_count", "op": "==", "value": 0}]}, "needs a number"),
])
def test_malformed_or_forbidden_rules_are_rejected(breakage, fragment):
    errs = exc.validate(_rule(**breakage))
    assert errs and any(fragment in e for e in errs), errs


def test_every_non_exemptable_rule_is_a_hard_fact_and_none_can_be_scoped():
    assert exc.NON_EXEMPTABLE <= set(ref.RULES) and exc.NON_EXEMPTABLE >= ref.HARD_FACT_RULES
    for rid in exc.NON_EXEMPTABLE:
        assert exc.validate(_rule(scope={"rule_ids": [rid], "specialty_code": None}))


def _alert(rule, provider, idx=1):
    return SimpleNamespace(rule_id=rule, provider_id=provider, suppressed_by_exception_id=None, alert_id=f"A{idx}")


def test_an_exception_applies_by_rule_specialty_and_condition_and_never_to_a_provider_with_a_hard_fact():
    alerts = [_alert("S-UTL", "A"), _alert("S-UTL", "B"), _alert("S-UTL", "C"), _alert("S-UPC", "A"),
              _alert("R-DUP-01", "B"), _alert("S-UTL", "D")]
    pfeat = {"A": {"lines_per_member": 5.0}, "B": {"lines_per_member": 5.0}, "C": {"lines_per_member": 9.0},
             "D": {"lines_per_member": 5.0}}
    spec = {"A": "PRIMARY_CARE", "B": "PRIMARY_CARE", "C": "PRIMARY_CARE", "D": "CARDIOLOGY"}
    hit = exc.apply(alerts, pfeat, spec, [_rule()])
    suppressed = {(a.rule_id, a.provider_id) for a in alerts if a.suppressed_by_exception_id}
    # B has a hard fact, C is over the limit, D is another specialty, and S-UPC is out of scope
    assert suppressed == {("S-UTL", "A")}
    assert [a.provider_id for a in hit["EXC-9"]] == ["A"] and pfeat["B"]["hard_fact_alert_count"] == 1.0


def test_the_first_exception_by_id_wins_and_unsuppressed_alerts_are_reset():
    a = _alert("S-UTL", "A")
    a.suppressed_by_exception_id = "STALE"
    pfeat = {"A": {"lines_per_member": 5.0}}
    hit = exc.apply([a], pfeat, {"A": "PRIMARY_CARE"}, [_rule(exc_id="EXC-2"), _rule(exc_id="EXC-1")])
    assert a.suppressed_by_exception_id == "EXC-1" and list(hit) == ["EXC-1"]
    exc.apply([a], pfeat, {"A": "PRIMARY_CARE"}, [])
    assert a.suppressed_by_exception_id is None


def test_the_miner_builds_bounded_conditions_from_the_catalogue_and_always_adds_the_hard_fact_guard():
    pf = {"lines_per_member": 6.0, "visits_per_member_month": 4.0, "hard_fact_alert_count": 0.0}
    d = exc.propose(case_id="CASE-1", provider="P1", specialty="PRIMARY_CARE", rule_ids=["S-UTL", "R-TIME-01"],
                    reason_code="LEGIT_CLINICAL_PATTERN", pf=pf, support_n=2, source_precedent_id="PRC-9",
                    exc_id="EXC-5")
    bands = {(c["field"], c["op"]): c["value"] for c in d.condition}
    assert {f for f, _ in bands} == {"lines_per_member", "visits_per_member_month", "hard_fact_alert_count"}
    assert bands[("lines_per_member", ">=")] == pytest.approx(4.8)
    assert bands[("lines_per_member", "<=")] == pytest.approx(6.6)
    assert bands[("hard_fact_alert_count", "==")] == 0
    assert d.scope == {"rule_ids": ["R-TIME-01", "S-UTL"], "specialty_code": "PRIMARY_CARE"}
    assert d.effect == "DOWNGRADE_TO_MONITOR" and d.flags == [] and exc.validate(d) == []


def test_lower_bound_features_are_relaxed_downwards():
    d = exc.propose(case_id="C", provider="P", specialty="RADIOLOGY", rule_ids=["S-DIST"],
                    reason_code="LEGIT_RURAL_ACCESS", pf={"mean_member_km": 100.0, "is_sole_provider_county": 1.0},
                    support_n=1, source_precedent_id=None, exc_id="EXC-6")
    km = {c["op"]: c["value"] for c in d.condition if c["field"] == "mean_member_km"}
    assert km[">="] == pytest.approx(90.0) and km["<="] == pytest.approx(125.0) and d.flags == ["LOW_SUPPORT"]


def test_the_miner_refuses_ineligible_reasons_and_hard_fact_cases():
    kw = dict(case_id="C", provider="P", specialty="PRIMARY_CARE", pf={}, support_n=2, source_precedent_id=None,
              exc_id="EXC-7")
    with pytest.raises(ValueError, match="not eligible"):
        exc.propose(rule_ids=["S-UTL"], reason_code="CONFIRMED_PATTERN", **kw)
    with pytest.raises(ValueError, match="hard-fact"):
        exc.propose(rule_ids=["S-UTL", "R-DUP-01"], reason_code="LEGIT_CLINICAL_PATTERN", **kw)


def test_lint_verdicts():
    r = _rule()
    assert exc.lint(r, confirmed_conflicts=[], breadth=0.1, hard_touches=0, gt_lost=0)["verdict"] == "PASS"
    warn = exc.lint(r, confirmed_conflicts=[], breadth=0.5, hard_touches=0, gt_lost=0)
    assert warn["verdict"] == "WARN" and "50%" in warn["reasons"][0]
    assert exc.lint(_rule(support_n=1), confirmed_conflicts=[], breadth=0.1, hard_touches=0,
                    gt_lost=0)["verdict"] == "WARN"
    for kw in ({"confirmed_conflicts": ["PRC-1"]}, {"hard_touches": 2}, {"gt_lost": 3}):
        base = dict(confirmed_conflicts=[], breadth=0.0, hard_touches=0, gt_lost=0)
        base.update(kw)
        assert exc.lint(r, **base)["verdict"] == "BLOCK"
    assert exc.lint(_rule(scope={"rule_ids": ["R-EXCL-01"], "specialty_code": None}), confirmed_conflicts=[],
                    breadth=0.0, hard_touches=0, gt_lost=0)["verdict"] == "BLOCK"


# ================================================================== the loop on the real data
@pytest.fixture(scope="module")
def loop(ws):
    """The first run, a draft mined from a rejected D1 case, its simulation, and the run with it approved."""
    base = analysis.analyse(ws, run_id="RUN-T1", store=False)
    cases = {s.draft.case_id: {"tier": s.tier, "providers": [p for p, _ in s.draft.subjects]}
             for s in base.scored if s.tier != "LOW"}
    prev = {"runId": "RUN-T1", "cases": cases,
            "funnel": base.funnel, "monitored": set()}
    case = next(s for s in base.scored if s.draft.primary == "P-0046")
    draft = exc.propose(case_id=case.draft.case_id, provider="P-0046", specialty="PRIMARY_CARE",
                        rule_ids=sorted({a.rule_id for a in case.draft.alerts}),
                        reason_code="LEGIT_CLINICAL_PATTERN", pf=ws.pfeat["P-0046"], support_n=2,
                        source_precedent_id="PRC-0010", exc_id="EXC-0002")
    report = analysis.simulate(ws, draft, list(exc.SEED_EXCEPTIONS))
    after = analysis.analyse(ws, run_id="RUN-T2", previous=prev, exceptions=list(exc.SEED_EXCEPTIONS) + [draft],
                             store=False)
    return SimpleNamespace(base=base, prev=prev, case=case, draft=draft, report=report, after=after)


def test_the_seed_exception_moves_the_shared_building_alerts_to_monitor_with_a_citation(loop):
    sup = loop.base.suppressed["EXC-0001"]
    assert sup and {a.rule_id for a in sup} == {"G-INFRA"}
    mons = [json.loads(m["reasons_json"]) for m in loop.base.rows["monitors"] if "exceptionId" in m["reasons_json"]]
    assert mons and all(m["exceptionId"] == "EXC-0001" and "Downgraded to Monitor" in m["tierReasons"][0] for m in mons)
    assert loop.base.funnel["suppressedByException"]["EXC-0001"] == len(sup)
    assert loop.base.funnel["stages"][1]["count"] == loop.base.funnel["stages"][0]["count"] - len(sup)


def test_the_d1_decoy_opens_as_an_expert_review_case_before_any_governance(loop):
    by = {s.draft.primary: s for s in loop.base.scored}
    assert by["P-0046"].tier == "MEDIUM" and by["P-0047"].tier == "MEDIUM"
    assert not {r for r in {a.rule_id for a in by["P-0046"].draft.alerts}} & exc.NON_EXEMPTABLE


def test_the_mined_draft_is_valid_and_scoped_to_what_fired(loop):
    d = loop.draft
    assert exc.validate(d) == [] and d.effect == "DOWNGRADE_TO_MONITOR"
    assert d.scope["specialty_code"] == "PRIMARY_CARE" and set(d.scope["rule_ids"]) == {"R-TIME-01", "S-UTL", "T-CUSUM"}
    assert {c["field"] for c in d.condition} == {"lines_per_member", "visits_per_member_month", "hard_fact_alert_count"}


def test_simulation_reports_exactly_what_the_exception_would_do(loop):
    r = loop.report
    assert r["alertsSuppressed"] > 0 and set(r["providers"]) >= {"P-0046"}
    assert r["casesAffected"] >= 1 and r["tierShifts"].get("MEDIUM->MONITOR", 0) >= 1
    assert r["dollarsNoLongerReviewed"] > 0 and r["hardFactTouches"] == 0
    assert r["groundTruthPositivesLost"] == 0, "the demo ground-truth check: no injected scheme line is hidden"
    assert r["conflictsWithConfirmed"] == [] and 0 < r["breadthShare"] < 0.3
    assert r["lint"]["verdict"] in ("PASS", "WARN")


def test_a_run_with_the_approved_exception_has_fewer_alerts_and_the_d1_cases_in_monitor(loop):
    after = {s.draft.primary: s for s in loop.after.scored}
    assert "P-0046" not in after, "the rejected pattern no longer opens a case"
    mons = {m["provider_id"]: json.loads(m["reasons_json"]) for m in loop.after.rows["monitors"]}
    assert mons["P-0046"]["exceptionId"] == "EXC-0002"
    assert loop.after.funnel["stages"][1]["count"] < loop.base.funnel["stages"][1]["count"]
    assert loop.after.funnel["tiers"]["HIGH"] == loop.base.funnel["tiers"]["HIGH"]
    for scheme_provider in ("P-0041", "P-0044", "P-0045"):                    # real schemes are untouched
        assert after[scheme_provider].tier == "HIGH"


def test_the_funnel_diff_names_each_tier_change_and_the_exception_responsible(loop):
    diff = loop.after.funnel["diff"]
    assert diff["fromRun"] == "RUN-T1" and diff["active"] < 0 and diff["cases"] < 0
    moved = {c["caseId"]: c for c in diff["tierChanges"]}
    assert moved[loop.case.draft.case_id] == {"caseId": loop.case.draft.case_id, "from": "MEDIUM", "to": "MONITOR",
                                              "via": "EXC-0002"}
    assert diff["suppressedByException"]["EXC-0002"] > 0 and diff["newCases"] == []


def test_a_first_run_has_no_diff(loop):
    assert loop.base.funnel["diff"] == {} and loop.base.funnel["diffFrom"] is None


def test_an_exception_never_hides_a_provider_that_has_a_hard_fact(ws):
    wide = _rule(exc_id="EXC-0003", scope={"rule_ids": ["S-UTL", "T-CUSUM"], "specialty_code": "PRIMARY_CARE"},
                 condition=[{"field": "lines_per_member", "op": ">=", "value": 0.0},
                            {"field": "hard_fact_alert_count", "op": "==", "value": 0}])
    a = analysis.analyse(ws, run_id="RUN-T3", exceptions=[wide], store=False)
    by = {s.draft.primary: s for s in a.scored}
    assert by["P-0045"].tier == "HIGH", "P-0045 also has duplicate billing, a hard fact, so nothing is excepted"
    assert not any(x.provider_id == "P-0045" for x in a.suppressed.get("EXC-0003", []))


def test_an_unused_exception_is_reported_by_the_knowledge_lint(ws):
    idle = _rule(exc_id="EXC-0004", scope={"rule_ids": ["S-UTL"], "specialty_code": "PRIMARY_CARE"},
                 condition=[{"field": "lines_per_member", "op": "<=", "value": 0.01},
                            {"field": "hard_fact_alert_count", "op": "==", "value": 0}], support_n=1)
    a = analysis.analyse(ws, run_id="RUN-T4", exceptions=[idle], store=False)
    kinds = {(f["type"], json.loads(f["entities_json"])[0]) for f in a.lint}
    assert ("UNUSED_EXCEPTION", "EXC-0004") in kinds and ("LOW_SUPPORT_EXCEPTION", "EXC-0004") in kinds


def test_a_confirmed_looking_exception_is_blocked_by_the_simulation(ws):
    # an exception wide enough to hit the real utilization scheme would lose injected positives or touch confirmed
    # precedents; either way the lint must not let it through
    wide = _rule(exc_id="EXC-0005", scope={"rule_ids": ["S-UTL", "S-UPC", "T-CUSUM", "R-TIME-01", "S-GHOST"],
                                            "specialty_code": "PRIMARY_CARE"},
                 condition=[{"field": "lines_per_member", "op": ">=", "value": 0.0},
                            {"field": "hard_fact_alert_count", "op": "==", "value": 0}])
    r = analysis.simulate(ws, wide, list(exc.SEED_EXCEPTIONS))
    assert r["lint"]["verdict"] == "BLOCK" and r["groundTruthPositivesLost"] > 0
    assert any("injected" in x for x in r["lint"]["reasons"])


def test_a_live_unfounded_precedent_can_move_a_lookalike_case_to_monitor(ws, loop):
    twin = next(s for s in loop.base.scored if s.draft.primary == "P-0046")
    live = [{"precedentId": "PRC-L001", "schemeType": "UTL", "specialtyCode": "PRIMARY_CARE",
             "disposition": "UNFOUNDED", "reasonCode": "LEGIT_CLINICAL_PATTERN", "featureVector": twin.fv,
             "status": "ACTIVE", "closedDt": "2025-12-01"}]
    a = analysis.analyse(ws, run_id="RUN-T5", exceptions=list(exc.SEED_EXCEPTIONS), live_precedents=live, store=False)
    by = {s.draft.primary: s for s in a.scored}
    assert by["P-0047"].tier == "LOW", "the seed investigation plus the live closure are two strong unfounded matches"
    assert "closed unfounded" in " ".join(by["P-0047"].tier_reasons)
    assert any(c["caseId"] for c in a.dashboard["compounding"]["tierChangedByPrecedent"])
    assert a.dashboard["compounding"]["livePrecedents"] == 1


def test_pending_or_retired_precedents_do_not_count(ws, loop):
    twin = next(s for s in loop.base.scored if s.draft.primary == "P-0046")
    for status in ("PENDING_COSIGN", "RETIRED", "SUPERSEDED"):
        live = [{"precedentId": "PRC-L002", "schemeType": "UTL", "disposition": "UNFOUNDED", "status": status,
                 "featureVector": twin.fv, "closedDt": "2025-12-01"}]
        a = analysis.analyse(ws, run_id="RUN-T6", exceptions=list(exc.SEED_EXCEPTIONS), live_precedents=live,
                             store=False)
        assert {s.draft.primary: s.tier for s in a.scored}["P-0047"] == "MEDIUM", status


def test_cases_cite_the_precedents_that_shaped_them(loop):
    packs = {r["case_id"]: json.loads(r["pack_json"]) for r in loop.base.rows["packs"]}
    cited = [p for p in packs.values() if p["precedents"]]
    assert cited
    for p in cited:
        for e in p["precedents"]:
            assert e["id"].startswith("PR") and f"{e['id']}.sim" in p["numbers"]
            assert e["precedentId"] in p["entities"] and "{{" in e["template"] and "{{" not in e["statement"]
    rows = loop.base.rows["case_precedents"]
    assert rows and all(0.6 <= r["similarity"] <= 1.0 for r in rows)


def test_knowledge_lint_runs_on_every_analysis(loop):
    assert isinstance(loop.base.lint, list)
    assert all({"finding_id", "type", "severity", "entities_json", "message"} <= set(f) for f in loop.base.lint)
    assert math.isfinite(len(loop.base.lint))


# ================================================================== the engine API
@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from claimshield.pipeline import run_pipeline
    d = tmp_path_factory.mktemp("api")        # the API gets its own data: a re-run publishes into its own app.db
    run_pipeline(app_path=d / "app.db", claims_path=d / "claims.duckdb", gt_path=d / "gt.duckdb")
    api.configure(d / "claims.duckdb", d / "gt.duckdb", d / "app.db")
    yield TestClient(api.app)
    api.STATE.reset()


H = {"X-Engine-Token": "dev-engine-token"}


def test_every_new_route_requires_the_token(client):
    for method, url in (("post", "/internal/rerun"), ("get", "/internal/jobs/E-1"),
                        ("post", "/internal/simulate"), ("post", "/internal/exceptions/propose"),
                        ("post", "/internal/precedent/check")):
        kw = {"json": {}} if method == "post" else {}
        assert getattr(client, method)(url, **kw).status_code == 401
        assert getattr(client, method)(url, headers={"X-Engine-Token": "wrong"}, **kw).status_code == 401


def test_propose_over_http_returns_a_draft_and_refuses_hard_facts(client):
    body = {"caseId": "CASE-0016", "provider": "P-0046", "ruleIds": ["R-TIME-01", "S-UTL", "T-CUSUM"],
            "reasonCode": "LEGIT_CLINICAL_PATTERN", "supportN": 2, "sourcePrecedentId": "PRC-0010",
            "excId": "EXC-0002"}
    r = client.post("/internal/exceptions/propose", json=body, headers=H)
    assert r.status_code == 200 and r.json()["excId"] == "EXC-0002" and r.json()["effect"] == "DOWNGRADE_TO_MONITOR"
    bad = client.post("/internal/exceptions/propose", json=dict(body, ruleIds=["S-UTL", "R-DUP-01"]), headers=H)
    assert bad.status_code == 422 and "hard-fact" in bad.json()["detail"]
    assert client.post("/internal/exceptions/propose", json=dict(body, reasonCode="CONFIRMED_PATTERN"),
                       headers=H).status_code == 422
    assert client.post("/internal/exceptions/propose", json=dict(body, provider="P-9999"), headers=H).status_code == 404


def test_simulate_over_http_and_a_malformed_draft_is_blocked_not_run(client):
    draft = client.post("/internal/exceptions/propose", headers=H, json={
        "caseId": "CASE-0016", "provider": "P-0046", "ruleIds": ["R-TIME-01", "S-UTL", "T-CUSUM"],
        "reasonCode": "LEGIT_CLINICAL_PATTERN", "supportN": 2, "excId": "EXC-0002"}).json()
    rep = client.post("/internal/simulate", headers=H, json={"draft": draft, "exceptions": []}).json()
    assert rep["alertsSuppressed"] > 0 and rep["lint"]["verdict"] in ("PASS", "WARN")
    broken = dict(draft, scope={"rule_ids": ["R-DUP-01"], "specialty_code": None})
    rep2 = client.post("/internal/simulate", headers=H, json={"draft": broken, "exceptions": []}).json()
    assert rep2["lint"]["verdict"] == "BLOCK" and rep2["alertsSuppressed"] == 0


def test_precedent_check_finds_a_conflict_and_a_reinforcement(client):
    ws = api.STATE.ws()
    seed = next(p for p in ws.seeds if p.disposition == "CONFIRMED")
    r = client.post("/internal/precedent/check", headers=H,
                    json={"featureVector": seed.fv, "disposition": "UNFOUNDED", "active": []}).json()
    assert seed.precedent_id in {c["precedentId"] for c in r["conflicts"]}
    r2 = client.post("/internal/precedent/check", headers=H,
                     json={"featureVector": seed.fv, "disposition": "CONFIRMED", "active": []}).json()
    assert seed.precedent_id in {c["precedentId"] for c in r2["reinforces"]} and r2["conflicts"] == []


def test_rerun_over_http_publishes_a_new_run_with_the_exception_and_a_diff(client):
    draft = client.post("/internal/exceptions/propose", headers=H, json={
        "caseId": "CASE-0016", "provider": "P-0046", "ruleIds": ["R-TIME-01", "S-UTL", "T-CUSUM"],
        "reasonCode": "LEGIT_CLINICAL_PATTERN", "supportN": 2, "excId": "EXC-0002"}).json()
    seed = [e.to_dict() for e in exc.SEED_EXCEPTIONS]
    r = client.post("/internal/rerun", headers=H, json={"exceptions": seed + [draft], "livePrecedents": []})
    assert r.status_code == 202
    job_id = r.json()["engineJobId"]
    assert client.post("/internal/rerun", headers=H, json={"exceptions": seed}).status_code in (202, 409)
    deadline = time.time() + 240
    info = {}
    while time.time() < deadline:
        info = client.get(f"/internal/jobs/{job_id}", headers=H).json()
        if info["status"] != "RUNNING":
            break
        time.sleep(1)
    assert info["status"] == "DONE", info
    assert info["runId"] and info["diff"]["fromRun"] and info["diff"]["suppressedByException"]["EXC-0002"] > 0
    import sqlite3
    con = sqlite3.connect(api.STATE.app_path)
    run = con.execute("SELECT run_id FROM serving_current_run").fetchone()[0]
    assert run == info["runId"]
    got = con.execute("SELECT exception_set_json FROM serving_run WHERE run_id = ?", (run,)).fetchone()[0]
    assert json.loads(got) == ["EXC-0001", "EXC-0002"]
    assert not con.execute("SELECT 1 FROM serving_case WHERE run_id = ? AND primary_provider_id = 'P-0046'",
                           (run,)).fetchall()
    assert con.execute("SELECT COUNT(*) FROM serving_precedent_seed").fetchone()[0] >= 30
    assert client.get("/internal/jobs/E-999", headers=H).status_code == 404


def test_a_malformed_exception_is_refused_before_a_job_starts(client):
    bad = {"excId": "EXC-X", "version": 1, "scope": {"rule_ids": ["R-EXCL-01"], "specialty_code": None},
           "condition": [{"field": "hard_fact_alert_count", "op": "==", "value": 0}], "effect": "DOWNGRADE_TO_MONITOR"}
    deadline = time.time() + 120
    while time.time() < deadline and any(j.status == "RUNNING" for j in api.STATE.jobs.values()):
        time.sleep(1)
    r = client.post("/internal/rerun", headers=H, json={"exceptions": [bad]})
    assert r.status_code == 422 and "hard-fact" in r.json()["detail"]
