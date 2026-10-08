"""File locations. The ground-truth path is imported ONLY by generate/, eval/ (and tests)."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_DIR = REPO_ROOT / "engine"
SQL_DIR = ENGINE_DIR / "sql"


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", REPO_ROOT / "data"))


def claims_db_path() -> Path:
    return data_dir() / "claims.duckdb"


def gt_db_path() -> Path:
    return data_dir() / "gt.duckdb"
