#!/bin/sh
# Seeds the shared volume on first start (synthetic data + the first analysis run), then serves the engine API.
set -e
export DATA_DIR="${DATA_DIR:-/data}"
export APP_DB_PATH="${APP_DB_PATH:-/data/app.db}"
mkdir -p "$DATA_DIR"
if [ ! -f "$APP_DB_PATH" ] || [ ! -f "$DATA_DIR/claims.duckdb" ]; then
  echo "first start: generating synthetic data and the first run"
  python -m claimshield.pipeline > /dev/null
fi
exec uvicorn claimshield.api.main:app --host 0.0.0.0 --port 8000
