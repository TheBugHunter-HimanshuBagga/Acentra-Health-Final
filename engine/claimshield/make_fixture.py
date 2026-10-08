"""Builds the gateway's test fixture by running the REAL pipeline:

    node scripts/run-engine.mjs --module claimshield.make_fixture [out_path]

Default output: gateway/src/test/resources/serving_fixture.db (serving_* tables only, rollback-journal mode so it
is a single self-contained file). Regenerate whenever contracts/sql/serving_schema.sql or the engine output changes.
"""

from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from claimshield.paths import REPO_ROOT
from claimshield.pipeline import run_pipeline

DEFAULT_OUT = REPO_ROOT / "gateway" / "src" / "test" / "resources" / "serving_fixture.db"


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        summary = run_pipeline(app_path=d / "app.db", claims_path=d / "c.duckdb", gt_path=d / "g.duckdb")
        con = sqlite3.connect(d / "app.db")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.execute("PRAGMA journal_mode=DELETE")
        con.execute("VACUUM")
        con.close()
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(d / "app.db", out)
    print(f"fixture written to {out} ({out.stat().st_size / 1024:.0f} KB): run {summary['runId']}, "
          f"{summary['cases']} cases, {summary['monitor']} monitor, tiers {summary['tiers']}")


if __name__ == "__main__":
    main()
