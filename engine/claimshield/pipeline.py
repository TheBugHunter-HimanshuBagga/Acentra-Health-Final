"""Offline pipeline CLI:  python -m claimshield.pipeline [--seed N] [--no-regenerate]

generate (mini) -> rules and signals -> alerts -> exceptions -> cases -> scores and precedent fit -> evidence packs ->
evaluation -> publish. Writes claims.duckdb / gt.duckdb under DATA_DIR and publishes serving_* into app.db
(APP_DB_PATH). The analysis itself lives in claimshield.analysis so that simulations and re-runs share it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from claimshield import analysis, paths, publish
from claimshield.brain import exceptions as exc
from claimshield.cases import rows as rows_mod
from claimshield.db import app_db
from claimshield.generate import mini

DEFAULT_SEED = 20261008


def run_pipeline(seed: int = DEFAULT_SEED, *, regenerate: bool = True, app_path: Path | None = None,
                 claims_path: Path | None = None, gt_path: Path | None = None,
                 capacity_hours: float = rows_mod.DEFAULT_CAPACITY_HOURS,
                 exceptions: list[exc.ExceptionRule] | None = None,
                 live_precedents: list[dict] | None = None, progress=None, workspace=None) -> dict:
    claims_path = claims_path or paths.claims_db_path()
    gt_path = gt_path or paths.gt_db_path()
    note = progress or (lambda stage: None)
    note("generation")
    gen_info = mini.build(claims_path, gt_path, seed) if regenerate else None
    note("detection")
    ws = workspace or analysis.load_workspace(claims_path, gt_path)
    try:
        app = app_db.connect(app_path)
        try:
            app_db.ensure_serving_schema(app)
            run_id = publish.next_run_id(app)
            previous = publish.previous_state(app)
            note("scoring")
            a = analysis.analyse(ws, run_id=run_id, previous=previous, exceptions=exceptions,
                                 live_precedents=live_precedents, capacity_hours=capacity_hours)
            run = {"run_id": run_id, "asof": asof_text(), "master_seed": seed, "data_hash": ws.data_hash,
                   "exception_set": [e.exc_id for e in a.exceptions],
                   "precedent_count": sum(1 for p in a.precedents if p.status == "ACTIVE")}
            note("publishing")
            publish.publish_run(app, run, a.rows, rows_mod.dumps(a.funnel), rows_mod.dumps(a.dashboard),
                                rows_mod.dumps(a.eval_doc))
        finally:
            app.close()
        return {"runId": run_id, "generated": gen_info and {k: gen_info[k] for k in ("claims", "lines")},
                "ruleHits": len(ws.hits), "alerts": len(a.alerts), "cases": len(a.rows["cases"]),
                "monitor": len(a.rows["monitors"]), "tiers": a.funnel["tiers"], "stages": a.funnel["stages"],
                "recall": {r["rule"]: r["recall"] for r in a.eval_doc["rules"]}, "decoys": a.eval_doc["decoys"],
                "coverage": a.eval_doc["coverage"], "diff": a.funnel["diff"],
                "suppressed": a.funnel["suppressedByException"]}
    finally:
        if workspace is None:
            ws.close()


def asof_text() -> str:
    from claimshield import reference as ref
    return ref.ASOF.isoformat()


def main() -> None:
    ap = argparse.ArgumentParser(description="ClaimShield pipeline")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--no-regenerate", action="store_true")
    ap.add_argument("--capacity", type=float, default=rows_mod.DEFAULT_CAPACITY_HOURS)
    args = ap.parse_args()
    print(json.dumps(run_pipeline(args.seed, regenerate=not args.no_regenerate, capacity_hours=args.capacity),
                     indent=2, default=str))


if __name__ == "__main__":
    main()
