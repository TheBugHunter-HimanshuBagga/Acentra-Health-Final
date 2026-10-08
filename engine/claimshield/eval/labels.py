"""Prediction labels and provider splits from the synthetic ground truth. This module (with generate/ and the
orchestrator) is one of the few allowed to open gt.duckdb; the detectors and the model's FEATURES never do.

Label y_h at snapshot t (end of month t): the provider has positive injected-FWA dollars in the next h/30 months AND
(positive injected dollars in the prior 180 days OR a future monthly rate of at least 1.25 times the prior 90-day
rate). Because the second clause is vacuously true when there was no earlier activity, the label is in practice
"the provider will have injected FWA dollars in the horizon". It is synthetic and transparent; say so wherever the
numbers are shown.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from claimshield.predict.features import H_MONTHS, HORIZONS, MIN_T, snapshot_months


def load_splits(gt_path: Path) -> dict[str, str]:
    gt = duckdb.connect(str(gt_path), read_only=True)
    try:
        return dict(gt.execute("SELECT provider_id, split FROM gt_provider_split").fetchall())
    finally:
        gt.close()


def load_labels(claims_con: duckdb.DuckDBPyConnection, gt_path: Path, providers: list[str]) -> pd.DataFrame:
    """(provider_id, t, y30, y60, y90); NaN where the horizon runs past the end of the data."""
    gt = duckdb.connect(str(gt_path), read_only=True)
    try:
        pos = gt.execute("SELECT DISTINCT claim_id, line_no FROM gt_claim_label WHERE label = 'POSITIVE'").fetchdf()
    finally:
        gt.close()
    months = snapshot_months()
    midx = {m: i for i, m in enumerate(months)}
    series = {p: np.zeros(len(months)) for p in providers}
    if len(pos):
        claims_con.register("lab_pos", pos)
        df = claims_con.execute("""SELECT l.rendering_provider_id AS p, date_trunc('month', l.service_dt) AS m,
                                   SUM(l.paid_amt) AS paid FROM claim_line l JOIN lab_pos USING (claim_id, line_no)
                                   GROUP BY 1, 2""").fetchdf()
        claims_con.unregister("lab_pos")
        for r in df.itertuples():
            if r.p in series:
                series[r.p][midx[pd.Timestamp(r.m)]] += float(r.paid)
    rows = []
    n = len(months)
    for p in providers:
        s = series[p]
        for t in range(MIN_T, n):
            prior180, prior90 = s[t - 5:t + 1].sum(), s[t - 2:t + 1].sum()
            row = {"provider_id": p, "t": t}
            for h in HORIZONS:
                hm = H_MONTHS[h]
                if t + hm > n - 1:
                    row[f"y{h}"] = np.nan
                    continue
                future = s[t + 1:t + 1 + hm].sum()
                row[f"y{h}"] = float(future > 0 and (prior180 > 0 or future / hm >= 1.25 * prior90 / 3))
            rows.append(row)
    return pd.DataFrame(rows)
