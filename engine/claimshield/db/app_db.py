"""Access to the shared SQLite file (app.db).

Ownership rule: this engine writes ONLY serving_* tables and never touches wf_* tables.
The Java gateway writes wf_* and only reads serving_*.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVING_SCHEMA = REPO_ROOT / "contracts" / "sql" / "serving_schema.sql"


def app_db_path() -> Path:
    return Path(os.environ.get("APP_DB_PATH", REPO_ROOT / "data" / "app.db"))


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open app.db in WAL mode with a busy timeout (the gateway reads/writes concurrently)."""
    p = path or app_db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(p, timeout=5.0)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def ensure_serving_schema(con: sqlite3.Connection) -> None:
    con.executescript(SERVING_SCHEMA.read_text(encoding="utf-8"))
