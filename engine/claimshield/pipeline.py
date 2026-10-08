"""Offline pipeline CLI:  python -m claimshield.pipeline [--seed N] [--no-regenerate]

generate (mini) -> six rules -> alerts -> consolidation -> scoring -> evidence packs -> evaluation -> publish.
Writes claims.duckdb / gt.duckdb under DATA_DIR and publishes serving_* into app.db (APP_DB_PATH).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import duckdb

from claimshield import paths, publish
from claimshield import reference as ref
from claimshield.cases import alerts as alerts_mod
from claimshield.cases import rows as rows_mod
from claimshield.cases.consolidate import assign_case_ids, consolidate
from claimshield.cases.score import score_drafts
from claimshield.db import app_db
from claimshield.detect import rules
from claimshield.eval.metrics import evaluate
from claimshield.evidence.pack import PackContext
from claimshield.generate import mini

DEFAULT_SEED = 20261008


def run_pipeline(seed: int = DEFAULT_SEED, *, regenerate: bool = True, app_path: Path | None = None,
                 claims_path: Path | None = None, gt_path: Path | None = None,
                 capacity_hours: float = rows_mod.DEFAULT_CAPACITY_HOURS) -> dict:
    claims_path = claims_path or paths.claims_db_path()
    gt_path = gt_path or paths.gt_db_path()
    gen_info = mini.build(claims_path, gt_path, seed) if regenerate else None

    con = duckdb.connect(str(claims_path))
    try:
        rules.run_all_rules(con)
        hits = alerts_mod.read_hits(con)

        app = app_db.connect(app_path)
        try:
            app_db.ensure_serving_schema(app)
            run_id = publish.next_run_id(app)
            alerts = alerts_mod.build_alerts(hits)
            alerts_mod.store_alerts(con, run_id, alerts)
            drafts = consolidate(con, alerts, hits)
            assign_case_ids(drafts, publish.previous_subjects(app))

            acuity = dict(con.execute("SELECT member_id, acuity_score FROM member").fetchall())
            prov = {r[0]: {"specialty_code": r[1], "name_syn": r[2], "enroll_dt": r[3]}
                    for r in con.execute(
                        "SELECT provider_id, specialty_code, name_syn, enroll_dt FROM provider").fetchall()}
            provider_lines = dict(con.execute(
                "SELECT rendering_provider_id, COUNT(*) FROM claim_line GROUP BY 1").fetchall())
            hcpcs_label = dict(con.execute("SELECT hcpcs, short_label FROM ref_hcpcs").fetchall())
            excl = dict(con.execute("SELECT provider_id, MIN(excl_dt) FROM exclusion GROUP BY 1").fetchall())
            units = {(c, n): u for c, n, u in con.execute(
                "SELECT DISTINCT l.claim_id, l.line_no, l.units FROM claim_line l "
                "JOIN out_rule_hit h ON h.claim_id = l.claim_id AND h.line_no = l.line_no").fetchall()}
            hit_meta = {(h["claim_id"], h["line_no"]): h for h in hits}

            scored = score_drafts(drafts, acuity=acuity, enroll={p: v["enroll_dt"] for p, v in prov.items()},
                                  provider_lines=provider_lines, asof=ref.ASOF)
            ctx = PackContext(run_id=run_id, asof=ref.ASOF, provider_info=prov, hcpcs_label=hcpcs_label,
                              exclusion_dt=excl)
            rows = rows_mod.build_rows(run_id, scored, ctx, units, hit_meta, capacity_hours)

            in_cap_lines = {k for s in scored if rows["in_capacity"].get(s.draft.case_id) for k in s.line_dollars}
            eval_doc = evaluate(con, gt_path, hits, in_cap_lines)
            funnel = rows_mod.build_funnel(run_id, len(alerts), sum(1 for a in alerts
                                                                    if a.suppressed_by_exception_id is None),
                                           scored, rows["in_capacity"], eval_doc["coverage"])
            dashboard = rows_mod.build_dashboard(run_id, scored, funnel)

            manifest = con.execute("SELECT table_hashes_json FROM gen_manifest").fetchone()[0]
            run = {"run_id": run_id, "asof": ref.ASOF.isoformat(), "master_seed": seed,
                   "data_hash": hashlib.sha256(manifest.encode()).hexdigest()}
            publish.publish_run(app, run, rows, rows_mod.dumps(funnel), rows_mod.dumps(dashboard),
                                rows_mod.dumps(eval_doc))
        finally:
            app.close()
    finally:
        con.close()

    return {"runId": run_id, "generated": gen_info and {k: gen_info[k] for k in ("claims", "lines")},
            "ruleHits": len(hits), "alerts": len(alerts), "cases": len(rows["cases"]),
            "monitor": len(rows["monitors"]), "tiers": funnel["tiers"], "stages": funnel["stages"],
            "recall": {r["rule"]: r["recall"] for r in eval_doc["rules"]}, "decoys": eval_doc["decoys"],
            "coverage": eval_doc["coverage"]}


def main() -> None:
    ap = argparse.ArgumentParser(description="ClaimShield M1 pipeline")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--no-regenerate", action="store_true")
    ap.add_argument("--capacity", type=float, default=rows_mod.DEFAULT_CAPACITY_HOURS)
    args = ap.parse_args()
    print(json.dumps(run_pipeline(args.seed, regenerate=not args.no_regenerate, capacity_hours=args.capacity),
                     indent=2, default=str))


if __name__ == "__main__":
    main()
