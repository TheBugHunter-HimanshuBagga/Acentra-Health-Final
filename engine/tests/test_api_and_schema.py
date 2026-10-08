import sqlite3

import pytest
from fastapi.testclient import TestClient

from claimshield.api.main import app
from claimshield.db import app_db

client = TestClient(app)


def test_health_requires_token():
    assert client.get("/internal/health").status_code == 401
    assert client.get("/internal/health", headers={"X-Engine-Token": "wrong"}).status_code == 401


def test_health_ok_with_token(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    r = client.get("/internal/health", headers={"X-Engine-Token": "dev-engine-token"})
    assert r.status_code == 200
    assert r.json()["status"] == "UP"


def test_serving_schema_applies_and_is_idempotent(tmp_path):
    con = app_db.connect(tmp_path / "app.db")
    app_db.ensure_serving_schema(con)
    app_db.ensure_serving_schema(con)  # IF NOT EXISTS: running twice must not fail
    names = {
        r[0]
        for r in con.execute("select name from sqlite_master where type='table'")
    }
    assert {"serving_run", "serving_case", "serving_evidence_pack"} <= names
    assert not any(n.startswith("wf_") for n in names), "engine must never create wf_* tables"
    assert con.execute("pragma journal_mode").fetchone()[0].lower() == "wal"
    con.close()


def test_case_tier_excludes_low(tmp_path):
    """LOW items are Monitor entries, never cases (schema-level guard)."""
    con = app_db.connect(tmp_path / "app.db")
    app_db.ensure_serving_schema(con)
    con.execute(
        "insert into serving_run(run_id, asof, created_at, status) "
        "values('R1','2026-01-01','t','COMPLETE')"
    )
    cols = (
        "run_id,case_id,primary_provider_id,tier,risk_30,risk_60,risk_90,utility_30,utility_60,utility_90,"
        "dollars_exact,dollars_est,dollars_basis,member_impact,severity,evidence_strength,precedent_fit,"
        "est_hours,hypotheses_json,subjects_json,channels_json,tier_reasons_json,header_json,fv_json"
    )
    def row(tier):
        return (
            f"insert into serving_case({cols}) "
            f"values('R1','C-{tier}','P1','{tier}',0,0,0,0,0,0,0,0,'EXACT',"
            "0,0,0,0,4,'[]','[]','{}','[]','{}','[]')"
        )
    con.execute(row("HIGH"))
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(row("LOW"))
    con.close()
