"""Provider x month-end snapshot features for the 30/60/90-day repeat-or-escalating risk model.

Every feature at snapshot t uses only information dated on or before the end of month t. No demographic field and no
ground-truth field is used. The line-rule hits are the same deterministic hits the alerts are built from; the
statistical features are recomputed at every snapshot (the PEER alerts themselves only cover the last months).
"""

from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

from claimshield import reference as ref
from claimshield.detect.peer import robust_z
from claimshield.detect.temporal import METRICS, _all_months, cusum_series, monthly_features

FEATURES = [
    "hits_30", "hits_90", "hits_180", "hit_dollars_90", "max_strength_30", "max_strength_90", "hard_fact_90",
    "z_high_share", "z_lines_per_member", "z_paid_per_member", "growth_90d", "z_growth",
    "cusum_alarm", "cusum_max", "cusum_months_since_onset", "tenure_months", "self_referral_share",
    "referral_top3_share", "hops_to_confirmed", "prior_confirmed", "prior_investigations", "months_since_closure",
    "n_members", "log_paid_90",
]
MIN_T = 6            # earliest snapshot (needs a baseline and 180 days of history)
HORIZONS = (30, 60, 90)
H_MONTHS = {30: 1, 60: 2, 90: 3}


def snapshot_months() -> list[pd.Timestamp]:
    return _all_months()


def _peer_z(values: dict[str, float], spec_of: dict[str, str], floor: float) -> dict[str, float]:
    out = {}
    for p, v in values.items():
        peers = [x for q, x in values.items() if q != p and spec_of[q] == spec_of[p]]
        out[p] = robust_z(v, peers, floor)[0] if len(peers) >= ref.PEER_MIN_PEERS else 0.0
    return out


def cusum_matrix(feat: pd.DataFrame, spec_of: dict[str, str]) -> dict[str, np.ndarray]:
    """provider -> 24 values: the largest CUSUM statistic over the three metrics at each month."""
    months = _all_months()
    out: dict[str, np.ndarray] = {}
    for metric, (_label, _scheme, floor, _minvol) in METRICS.items():
        piv = feat.pivot(index="provider_id", columns="month", values=metric).reindex(columns=months)
        base = {}
        for p, row in piv.iterrows():
            vals = [v for v in row.tolist() if not math.isnan(v)][:ref.CUSUM_BASE_MONTHS]
            if len(vals) >= ref.CUSUM_BASE_MONTHS:
                base[p] = (float(np.mean(vals)), float(np.std(vals, ddof=1)))
        for p, (mu0, sd0) in base.items():
            peer_sd = [b[1] for q, b in base.items() if q != p and spec_of[q] == spec_of[p]]
            sigma0 = max(sd0, 0.5 * float(np.median(peer_sd)) if peer_sd else 0.0, floor)
            row = piv.loc[p].tolist()
            idx = [i for i, v in enumerate(row) if not math.isnan(v)][:ref.CUSUM_BASE_MONTHS]
            start = idx[-1] + 1
            full = np.array([0.0] * start + cusum_series(row[start:], mu0, sigma0))
            out[p] = np.maximum(out.get(p, np.zeros(len(months))), full)
    return out


def build_snapshots(lines: pd.DataFrame, hits: pd.DataFrame, referrals: pd.DataFrame,
                    investigations: pd.DataFrame, enroll: dict[str, date], spec_of: dict[str, str],
                    control_groups: dict[str, list[str]], hops_fn,
                    ts: list[int] | None = None) -> pd.DataFrame:
    """One row per (provider, t). `t` is the month index (0 = first month of the data)."""
    months = _all_months()
    feat = monthly_features(lines)
    everyone = sorted(spec_of)                  # every provider has a row at every snapshot, active or not

    def grid(col: str, fill: float | None):
        g = feat.pivot(index="provider_id", columns="month", values=col).reindex(index=everyone, columns=months)
        return g.fillna(fill) if fill is not None else g

    paid, members = grid("paid", 0.0), grid("members", 0.0)
    em_n, em_hi = grid("em_n", 0.0), grid("em_hi", 0.0)
    lpm, ppm = grid("lines_per_member", None), grid("paid_per_member", None)
    cus = cusum_matrix(feat, spec_of)
    providers = list(paid.index)

    line_hits = hits[hits["rule_id"].isin(ref.SQL_RULES)].copy()
    line_hits["m"] = pd.to_datetime(line_hits["service_dt"]).dt.to_period("M").dt.to_timestamp()
    midx = {m: i for i, m in enumerate(months)}
    line_hits["mi"] = line_hits["m"].map(midx)
    strength = {r: ref.RULES[r][2] for r in ref.SQL_RULES}
    line_hits["strength"] = line_hits["rule_id"].map(strength)
    line_hits["hard"] = line_hits["rule_id"].isin(ref.HARD_FACT_RULES)
    by_p = {p: g for p, g in line_hits.groupby("provider_id")}

    ref_lines = referrals.copy()
    if not ref_lines.empty:
        ref_lines["mi"] = pd.to_datetime(ref_lines["service_dt"]).dt.to_period("M").dt.to_timestamp().map(midx)
    owner_of = {p: g for g, ps in control_groups.items() for p in ps}

    inv = investigations.copy()
    inv["closed"] = pd.to_datetime(inv["closed_dt"])

    rows = []
    for t in ts or range(MIN_T, len(months)):
        end = months[t] + pd.offsets.MonthEnd(0)
        sl90 = slice(t - 2, t + 1)
        p90 = paid.iloc[:, sl90].sum(axis=1)
        prev90 = paid.iloc[:, t - 5:t - 2].sum(axis=1) if t >= 5 else p90 * 0
        growth = np.log((p90 + 100.0) / (prev90 + 100.0))
        share3 = (em_hi.iloc[:, sl90].sum(axis=1) / em_n.iloc[:, sl90].sum(axis=1).replace(0, np.nan))
        ok_share = em_n.iloc[:, sl90].sum(axis=1) >= ref.PEER_MIN_EM
        z_share = _peer_z({p: float(share3[p]) for p in providers if ok_share[p]}, spec_of, 0.05)
        z_lpm = _peer_z({p: float(lpm.iloc[:, t][p]) for p in providers if not math.isnan(lpm.iloc[:, t][p])},
                        spec_of, 0.25)
        z_ppm = _peer_z({p: float(ppm.iloc[:, t][p]) for p in providers if not math.isnan(ppm.iloc[:, t][p])},
                        spec_of, 10.0)
        z_gr = _peer_z({p: float(growth[p]) for p in providers if prev90[p] >= 500.0}, spec_of, 0.15)
        in_window = ref_lines[(ref_lines["mi"] <= t) & (ref_lines["mi"] >= t - 5)] if not ref_lines.empty else ref_lines
        in_year = ref_lines[(ref_lines["mi"] <= t) & (ref_lines["mi"] >= t - 11)] if not ref_lines.empty else ref_lines
        done = inv[inv["closed"] <= end]
        hops = hops_fn(end.date())
        for p in providers:
            h = by_p.get(p)
            if h is not None:
                h30, h90 = h[h["mi"] == t], h[(h["mi"] <= t) & (h["mi"] >= t - 2)]
                h180 = h[(h["mi"] <= t) & (h["mi"] >= t - 5)]
            else:
                h30 = h90 = h180 = line_hits.iloc[0:0]
            s = cus.get(p, np.zeros(len(months)))
            alarm = bool(s[t] >= ref.CUSUM_H)
            onset = t
            while alarm and onset > 0 and s[onset - 1] > 0:
                onset -= 1
            self_share = 0.0
            if p in owner_of and not in_window.empty:
                grp = set(control_groups[owner_of[p]])
                out = in_window[in_window["referrer"].isin(grp)]
                self_share = float(out[out["provider_id"].isin(grp)]["paid_amt"].sum() / out["paid_amt"].sum()) \
                    if out["paid_amt"].sum() > 0 else 0.0
            top3 = 0.0
            if not in_year.empty:
                mine = in_year[in_year["provider_id"] == p].drop_duplicates("claim_id")
                if len(mine) >= 10:
                    counts = mine.groupby("referrer").size().sort_values(ascending=False)
                    top3 = float(counts.iloc[:3].sum() / len(mine))
            mine_inv = done[done["provider_id"] == p]
            months_since = (end - mine_inv["closed"].max()).days / 30.4 if len(mine_inv) else 36.0
            rows.append({
                "provider_id": p, "t": t,
                "hits_30": len(h30), "hits_90": len(h90), "hits_180": len(h180),
                "hit_dollars_90": float(h90["dollars"].sum()) if len(h90) else 0.0,
                "max_strength_30": float(h30["strength"].max()) if len(h30) else 0.0,
                "max_strength_90": float(h90["strength"].max()) if len(h90) else 0.0,
                "hard_fact_90": float(bool(len(h90) and h90["hard"].any())),
                "z_high_share": z_share.get(p, 0.0), "z_lines_per_member": z_lpm.get(p, 0.0),
                "z_paid_per_member": z_ppm.get(p, 0.0), "growth_90d": float(growth[p]), "z_growth": z_gr.get(p, 0.0),
                "cusum_alarm": float(alarm), "cusum_max": float(s[t]),
                "cusum_months_since_onset": float(t - onset + 1) if alarm else 0.0,
                "tenure_months": max(0.0, (end.date() - enroll[p]).days / 30.4),
                "self_referral_share": self_share, "referral_top3_share": top3,
                "hops_to_confirmed": float(hops.get(p) if hops.get(p) is not None else 3),
                "prior_confirmed": float((mine_inv["disposition"] == "CONFIRMED").sum()),
                "prior_investigations": float(len(mine_inv)), "months_since_closure": float(min(36.0, months_since)),
                "n_members": float(members.iloc[:, t][p]), "log_paid_90": float(math.log1p(p90[p])),
            })
    return pd.DataFrame(rows)
