"""Internal engine API. Bound to 127.0.0.1 and reachable only from the Java gateway.

Every route requires the shared secret in the X-Engine-Token header.
Endpoints are added as features land; see docs/ClaimShield_Nexus_Implementation_Architecture.md.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from claimshield import __version__
from claimshield.db import app_db


def require_token(x_engine_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ENGINE_TOKEN", "dev-engine-token")
    if x_engine_token is None or not hmac.compare_digest(x_engine_token, expected):
        raise HTTPException(status_code=401, detail="invalid engine token")


app = FastAPI(title="ClaimShield engine (internal)", version=__version__)


@app.get("/internal/health", dependencies=[Depends(require_token)])
def health() -> dict:
    con = app_db.connect()
    try:
        row = con.execute(
            "select name from sqlite_master where type='table' and name='serving_current_run'"
        ).fetchone()
        run = None
        if row:
            r = con.execute("select run_id from serving_current_run where id=1").fetchone()
            run = r[0] if r else None
    finally:
        con.close()
    return {"status": "UP", "version": __version__, "currentRun": run}
