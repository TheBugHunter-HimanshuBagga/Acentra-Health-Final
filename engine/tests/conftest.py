from __future__ import annotations

import sqlite3

import duckdb
import pytest

from claimshield.pipeline import run_pipeline


@pytest.fixture(scope="session")
def m1(tmp_path_factory):
    """One full pipeline run (generate, rules, alerts, cases, packs, eval, publish) shared by many tests."""
    d = tmp_path_factory.mktemp("m1")
    paths = {"claims": d / "claims.duckdb", "gt": d / "gt.duckdb", "app": d / "app.db"}
    summary = run_pipeline(app_path=paths["app"], claims_path=paths["claims"], gt_path=paths["gt"])
    return {"paths": paths, "summary": summary}


@pytest.fixture()
def app_con(m1):
    con = sqlite3.connect(m1["paths"]["app"])
    con.row_factory = sqlite3.Row
    yield con
    con.close()


@pytest.fixture()
def claims_con(m1):
    con = duckdb.connect(str(m1["paths"]["claims"]), read_only=True)
    yield con
    con.close()
