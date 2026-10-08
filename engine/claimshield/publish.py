"""Publishes one run into app.db (serving_* tables) in a single transaction, then flips serving_current_run.

The engine writes ONLY serving_* tables. Readers (the gateway) always see a complete run.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime

from claimshield import reference as ref

CASE_COLS = ["run_id", "case_id", "primary_provider_id", "specialty_code", "tier", "risk_30", "risk_60", "risk_90",
             "utility_30", "utility_60", "utility_90", "dollars_exact", "dollars_est", "dollars_basis",
             "member_impact", "severity", "evidence_strength", "precedent_fit", "est_hours", "trend",
             "hypotheses_json", "subjects_json", "channels_json", "tier_reasons_json", "header_json", "fv_json"]
LINE_COLS = ["run_id", "case_id", "evidence_id", "claim_id", "line_no", "member_id", "provider_id", "service_dt",
             "hcpcs", "hcpcs_label", "units", "paid_amt", "flag_role"]


def _insert(con: sqlite3.Connection, table: str, cols: list[str], rows: list[dict], replace: bool = False) -> None:
    if not rows:
        return
    verb = "INSERT OR REPLACE" if replace else "INSERT"
    con.executemany(f"{verb} INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [tuple(r[c] for c in cols) for r in rows])


def next_run_id(con: sqlite3.Connection) -> str:
    row = con.execute("SELECT MAX(CAST(SUBSTR(run_id, 5) AS INTEGER)) FROM serving_run").fetchone()
    return f"RUN-{(row[0] or 0) + 1:03d}"


def previous_subjects(con: sqlite3.Connection) -> dict[str, set[str]]:
    """case_id -> subject provider ids of the CURRENT run (for stable case IDs across runs)."""
    cur = con.execute("SELECT run_id FROM serving_current_run WHERE id = 1").fetchone()
    if not cur:
        return {}
    out = {}
    for case_id, subj in con.execute("SELECT case_id, subjects_json FROM serving_case WHERE run_id = ?", (cur[0],)):
        out[case_id] = {s["id"] for s in json.loads(subj)}
    return out


def previous_state(con: sqlite3.Connection) -> dict:
    """The CURRENT run as the next run's diff baseline: case tiers, funnel counts, monitored providers."""
    cur = con.execute("SELECT run_id FROM serving_current_run WHERE id = 1").fetchone()
    if not cur:
        return {}
    run = cur[0]
    cases = {cid: {"tier": tier, "providers": [x["id"] for x in json.loads(subj)]}
             for cid, tier, subj in con.execute(
                 "SELECT case_id, tier, subjects_json FROM serving_case WHERE run_id = ?", (run,))}
    funnel = json.loads(con.execute("SELECT funnel_json FROM serving_funnel WHERE run_id = ?", (run,)).fetchone()[0])
    mon = {p for (p,) in con.execute("SELECT provider_id FROM serving_monitor_item WHERE run_id = ?", (run,))}
    return {"runId": run, "cases": cases, "funnel": funnel, "monitored": mon}


def knowledge_rows() -> dict:
    return {
        "policy": [{"section_id": sid, "doc_id": doc, "title": t, "body": b, "version": "v1",
                    "eff_dt": ref.POLICY_EFF_DT.isoformat(), "provenance": ref.POLICY_PROVENANCE}
                   for sid, doc, t, b in ref.POLICY_SECTIONS],
        "rules": [{"rule_id": rid, "version": ref.RULE_VERSION, "name": v[1], "scheme_type": v[0],
                   "family": "rule", "status": "ACTIVE",
                   "params_json": "{}", "policy_ids_json": f'["{v[3]}"]'} for rid, v in sorted(ref.RULES.items())],
        "glossary": [{"term_id": tid, "term": term, "definition": d, "category": cat, "version": "v1"}
                     for tid, term, d, cat in ref.GLOSSARY],
        "help": [{"article_id": aid, "title": t, "body": b, "version": "v1"} for aid, t, b in ref.HELP],
    }


def publish_run(con: sqlite3.Connection, run: dict, rows: dict, funnel_json: str, dashboard_json: str,
                eval_json: str) -> None:
    """All-or-nothing. On any error the previous run stays current and no partial rows remain."""
    con.isolation_level = None
    con.execute("BEGIN IMMEDIATE")
    try:
        con.execute("INSERT INTO serving_run (run_id, asof, created_at, master_seed, data_hash, exception_set_json, "
                    "precedent_count, status) VALUES (?,?,?,?,?,?,?,?)",
                    (run["run_id"], run["asof"], datetime.now(UTC).isoformat(), run["master_seed"],
                     run["data_hash"], json.dumps(run.get("exception_set", [])), run.get("precedent_count", 0),
                     "COMPLETE"))
        _insert(con, "serving_case", CASE_COLS, rows["cases"])
        _insert(con, "serving_evidence_pack", ["run_id", "case_id", "pack_json", "pack_sha256"], rows["packs"])
        _insert(con, "serving_case_line", LINE_COLS, rows["lines"])
        _insert(con, "serving_case_precedent", ["run_id", "case_id", "precedent_id", "similarity", "disposition",
                                                "reason_code", "compare_json"], rows.get("case_precedents", []))
        _insert(con, "serving_graph", ["run_id", "case_id", "graph_json"], rows.get("graphs", []))
        _insert(con, "serving_timeline", ["run_id", "case_id", "timeline_json"], rows.get("timelines", []))
        _insert(con, "serving_monitor_item", ["run_id", "monitor_id", "provider_id", "reasons_json", "raise_json"],
                rows["monitors"])
        con.execute("INSERT INTO serving_funnel VALUES (?,?)", (run["run_id"], funnel_json))
        con.execute("INSERT INTO serving_dashboard VALUES (?,?)", (run["run_id"], dashboard_json))
        con.execute("INSERT INTO serving_eval VALUES (?,?)", (run["run_id"], eval_json))
        con.execute("DELETE FROM serving_precedent_seed")
        _insert(con, "serving_precedent_seed",
                ["precedent_id", "investigation_id", "scheme_type", "specialty_code", "disposition", "reason_code",
                 "rule_ids_json", "feature_vector_json", "fv_version", "rationale", "exposure", "recovered",
                 "closed_dt"], rows.get("seeds", []))
        _insert(con, "serving_knowledge_lint", ["run_id", "finding_id", "type", "severity", "entities_json",
                                                "message"], rows.get("lint", []))
        k = knowledge_rows()
        _insert(con, "serving_policy_section",
                ["section_id", "doc_id", "title", "body", "version", "eff_dt", "provenance"], k["policy"], True)
        _insert(con, "serving_rule_registry",
                ["rule_id", "version", "name", "scheme_type", "family", "status", "params_json", "policy_ids_json"],
                k["rules"], True)
        _insert(con, "serving_glossary", ["term_id", "term", "definition", "category", "version"], k["glossary"], True)
        _insert(con, "serving_help_article", ["article_id", "title", "body", "version"], k["help"], True)
        con.execute("INSERT INTO serving_current_run (id, run_id) VALUES (1, ?) "
                    "ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id", (run["run_id"],))
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
