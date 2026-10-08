"""Evidence packs, the serving_* publisher (atomicity, stability) and the process-ownership rules."""

import json
import re
import sqlite3
from pathlib import Path

import jsonschema
import pytest

from claimshield import publish
from claimshield import reference as ref
from claimshield.evidence.pack import pack_sha256, render
from claimshield.pipeline import run_pipeline

REPO = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((REPO / "contracts" / "schemas" / "evidence_pack.schema.json").read_text(encoding="utf-8"))


def _packs(app_con):
    cur = app_con.execute("SELECT run_id FROM serving_current_run WHERE id=1").fetchone()[0]
    return [json.loads(r["pack_json"]) for r in
            app_con.execute("SELECT pack_json FROM serving_evidence_pack WHERE run_id=? ORDER BY case_id", (cur,))]


# ---------------------------------------------------------------- the packs
def test_every_pack_validates_against_the_contract(app_con):
    packs = _packs(app_con)
    assert len(packs) >= 6
    v = jsonschema.Draft202012Validator(SCHEMA)
    for p in packs:
        errs = sorted(v.iter_errors(p), key=lambda e: list(e.path))
        assert not errs, [e.message for e in errs[:3]]


def test_pack_hash_is_deterministic_and_matches_the_stored_column(app_con):
    for row in app_con.execute("SELECT pack_json, pack_sha256 FROM serving_evidence_pack"):
        p = json.loads(row["pack_json"])
        assert p["packSha256"] == row["pack_sha256"] == pack_sha256(p)
        p["scores"]["tier"] = "LOW" if p["scores"]["tier"] != "LOW" else "HIGH"
        assert pack_sha256(p) != row["pack_sha256"]


def test_every_template_placeholder_resolves_and_statements_are_rendered(app_con):
    for p in _packs(app_con):
        for e in p["evidence"]:
            assert "{{" not in e["statement"]
            assert render(e["template"], p["numbers"]) == e["statement"]
        for tmpl in (p["scores"]["risk"], p["scores"]["dollars"]):
            assert re.fullmatch(r"\{\{S\.[A-Za-z]+\}\}", tmpl) and tmpl[2:-2] in p["numbers"]


def test_numbers_registry_is_the_only_source_of_digits_in_statements(app_con):
    for p in _packs(app_con):
        allowed = {fmt for n in p["numbers"].values() for fmt in n["fmt"]}
        for e in p["evidence"]:
            for token in re.findall(r"\$[\d,]+\.\d{2}|\d+(?:\.\d+)?%?", e["statement"]):
                assert token in allowed or any(a.startswith(token) for a in allowed), (e["statement"], token)


def test_permitted_actions_follow_the_tier_and_default_is_permitted(app_con):
    for p in _packs(app_con):
        names = {a["action"] for a in p["permittedActions"]}
        assert names == {a["action"] for a in ref.permitted_actions(p["scores"]["tier"])}
        assert p["defaultAction"] in names
        sup = {a["action"] for a in p["permittedActions"] if a["needs"] == "SUPERVISOR"}
        assert sup == ({"PREPAY_REVIEW_FLAG", "REFER_EXTERNAL"} if p["scores"]["tier"] == "HIGH" else set())


def test_mandatory_limitations_and_vocabulary_guards(app_con):
    for p in _packs(app_con):
        mand = [x["id"] for x in p["limitations"] if x["mandatory"]]
        assert {"L1", "L2"} <= set(mand)
        text = " ".join(e["statement"] for e in p["evidence"]).lower()
        assert not [t for t in p["forbiddenTerms"] if t in text]
        assert p["insufficientEvidenceRequired"] is False          # LOW items never become cases
        assert len({e["id"] for e in p["evidence"]}) == len(p["evidence"])


def test_pack_entities_cover_subjects_and_example_claims(app_con):
    for p in _packs(app_con):
        ents = set(p["entities"])
        assert {s["id"] for s in p["subjects"]} <= ents
        for e in p["evidence"]:
            assert {x["claimId"] for x in e["examples"]} <= ents


def test_hard_fact_cases_are_high_and_the_rest_medium(app_con):
    by_hyp = {}
    for p in _packs(app_con):
        by_hyp.setdefault(tuple(p["hypotheses"]), p["scores"]["tier"])
    assert by_hyp[("EXC",)] == "HIGH" and by_hyp[("PHA",)] == "HIGH"
    assert by_hyp[("DUP",)] == "MEDIUM" and by_hyp[("EXU",)] == "MEDIUM" and by_hyp[("UNB",)] == "MEDIUM"


def test_low_confidence_provider_goes_to_monitor_not_the_queue(app_con):
    cur = app_con.execute("SELECT run_id FROM serving_current_run").fetchone()[0]
    mon = app_con.execute("SELECT * FROM serving_monitor_item WHERE run_id=?", (cur,)).fetchall()
    assert len(mon) >= 1
    ids = {r["primary_provider_id"] for r in app_con.execute("SELECT primary_provider_id FROM serving_case")}
    for m in mon:
        assert json.loads(m["raise_json"])                           # says what would raise confidence
        assert m["provider_id"] not in ids


# ---------------------------------------------------------------- the publisher
def test_current_run_points_at_a_complete_run_with_funnel_and_eval(app_con):
    run = app_con.execute("SELECT r.* FROM serving_run r JOIN serving_current_run c ON c.run_id=r.run_id").fetchone()
    assert run["status"] == "COMPLETE"
    funnel = json.loads(app_con.execute("SELECT funnel_json FROM serving_funnel WHERE run_id=?",
                                        (run["run_id"],)).fetchone()[0])
    assert [s["key"] for s in funnel["stages"]] == ["alerts", "active", "cases", "inCapacity"]
    assert funnel["stages"][0]["count"] > funnel["stages"][2]["count"] > 0
    ev = json.loads(
        app_con.execute("SELECT eval_json FROM serving_eval WHERE run_id=?", (run["run_id"],)).fetchone()[0])
    assert all(r["recall"] == 1.0 for r in ev["rules"]) and ev["decoys"]["falselyFlagged"] == 0


def test_engine_never_creates_workflow_tables(app_con):
    names = {r[0] for r in app_con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not [n for n in names if n.startswith("wf_")]


def test_second_run_keeps_case_ids_stable_and_flips_current_run(tmp_path):
    kw = dict(app_path=tmp_path / "app.db", claims_path=tmp_path / "c.duckdb", gt_path=tmp_path / "g.duckdb")
    s1 = run_pipeline(**kw)
    s2 = run_pipeline(regenerate=False, **kw)
    assert (s1["runId"], s2["runId"]) == ("RUN-001", "RUN-002")
    con = sqlite3.connect(kw["app_path"])
    ids = {r: {x[0] for x in con.execute("SELECT case_id FROM serving_case WHERE run_id=?", (r,))}
           for r in ("RUN-001", "RUN-002")}
    assert ids["RUN-001"] == ids["RUN-002"] and len(ids["RUN-001"]) == s1["cases"]
    assert con.execute("SELECT run_id FROM serving_current_run").fetchone()[0] == "RUN-002"


def test_failed_publish_rolls_back_and_leaves_the_previous_run_current(tmp_path, monkeypatch):
    kw = dict(app_path=tmp_path / "app.db", claims_path=tmp_path / "c.duckdb", gt_path=tmp_path / "g.duckdb")
    run_pipeline(**kw)
    real = publish._insert

    def boom(con, table, cols, rows, replace=False):
        if table == "serving_case_line":
            raise RuntimeError("simulated crash mid-publish")
        return real(con, table, cols, rows, replace)

    monkeypatch.setattr(publish, "_insert", boom)
    with pytest.raises(RuntimeError, match="simulated crash"):
        run_pipeline(regenerate=False, **kw)
    con = sqlite3.connect(kw["app_path"])
    assert con.execute("SELECT run_id FROM serving_current_run").fetchone()[0] == "RUN-001"
    assert [r[0] for r in con.execute("SELECT run_id FROM serving_run")] == ["RUN-001"]
    assert con.execute("SELECT COUNT(*) FROM serving_case WHERE run_id='RUN-002'").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM serving_evidence_pack WHERE run_id='RUN-002'").fetchone()[0] == 0


# ---------------------------------------------------------------- ownership / isolation
GT_MARKERS = ("gt.duckdb", "gt_path", "gt_db_path", "gt_claim_label", "gt_scheme", "gt_provider_split")


def test_only_generation_eval_and_the_orchestrator_may_touch_ground_truth():
    src = REPO / "engine" / "claimshield"
    allowed = {"generate", "eval"}
    # orchestrators only pass the path along (make_fixture must, or the pipeline would default to the real gt file)
    # main.py is the API: it only passes the ground-truth path on to the pipeline
    orchestrators = ("pipeline.py", "analysis.py", "paths.py", "make_fixture.py", "main.py")
    offenders = []
    for f in src.rglob("*.py"):
        rel = f.relative_to(src)
        if rel.parts[0] in allowed or rel.name in orchestrators:
            continue
        text = f.read_text(encoding="utf-8")
        if any(m in text for m in GT_MARKERS):
            offenders.append(str(rel))
    assert not offenders, offenders


def test_engine_code_never_references_workflow_tables():
    src = REPO / "engine" / "claimshield"
    assert not [str(f) for f in src.rglob("*.py") if "wf_" in f.read_text(encoding="utf-8")
                and f.name != "app_db.py"]
