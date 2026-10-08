"""Temporal analytics (channel SELF): a provider compared with its OWN history.

  T-CUSUM   one-sided CUSUM on standardised monthly metrics (high-level visit share, lines per member, paid per
            member). Baseline = the provider's first six eligible months, scale floored by half the peer baseline sd.
  T-GROWTH  log growth of paid dollars, last 90 days against the 90 days before, robust z against specialty peers.
  T-RAMP    a provider enrolled less than 12 months ago already billing above the 75th percentile of mature peers.

These signals raise alerts without claim lines (the evidence is a statistic about the provider). They are immune to
peer-group mismatch, which makes them a genuinely different view from the PEER channel.

This module reads claims.duckdb only. It never opens the ground-truth database.
"""

from __future__ import annotations

import math
from datetime import date

import duckdb
import numpy as np
import pandas as pd

from claimshield import reference as ref
from claimshield.cases.alerts import Alert
from claimshield.detect.peer import _load, robust_z, strength_from_z

METRICS = {
    # key: (label used in the evidence text, scheme code, floor of the scale, minimum volume in a month, formatter)
    "em_high_share": ("The share of high-level office visits", "UPC", 0.10, 8),
    "lines_per_member": ("Lines per member in the month", "UTL", 0.50, 5),
    "paid_per_member": ("Paid dollars per member in the month", "UTL", 40.0, 5),
}
# a shift must also be big enough to matter: absolute for a share, relative for the others
MIN_SHIFT = {"em_high_share": ("abs", 0.15), "lines_per_member": ("rel", 0.40), "paid_per_member": ("rel", 0.40)}


def monthly_features(lines: pd.DataFrame) -> pd.DataFrame:
    """Provider x month: lines, paid, members, E&M volume and share of level 4-5."""
    em = lines[lines["em_level"].notna() & (lines["pos_code"] == "11")]
    g = lines.groupby(["provider_id", "month"])
    f = pd.DataFrame({"lines": g.size(), "paid": g["paid_amt"].sum(), "members": g["member_id"].nunique()})
    ge = em.groupby(["provider_id", "month"])
    f["em_n"] = ge.size()
    f["em_hi"] = ge.apply(lambda d: int((d["em_level"] >= 4).sum()), include_groups=False)
    f = f.fillna({"em_n": 0, "em_hi": 0}).reset_index()
    enough = f["em_n"] >= METRICS["em_high_share"][3]
    f["em_high_share"] = np.where(enough, f["em_hi"] / f["em_n"].clip(lower=1), np.nan)
    ok = f["members"] >= 5
    f["lines_per_member"] = np.where(ok, f["lines"] / f["members"].clip(lower=1), np.nan)
    f["paid_per_member"] = np.where(ok, f["paid"] / f["members"].clip(lower=1), np.nan)
    return f


def _all_months() -> list[pd.Timestamp]:
    start = pd.Timestamp(ref.WINDOW_START).to_period("M")
    end = pd.Timestamp(ref.WINDOW_END).to_period("M")
    return [(start + i).to_timestamp() for i in range((end - start).n + 1)]


def _eval_months() -> list[pd.Timestamp]:
    return _all_months()[-ref.PEER_WINDOW_MONTHS:]


def cusum_series(values: list[float], mu0: float, sigma0: float, k: float = ref.CUSUM_K) -> list[float]:
    """S_t = max(0, S_{t-1} + z_t - k); missing months carry the statistic forward unchanged."""
    s, out = 0.0, []
    for v in values:
        if v is not None and not math.isnan(v):
            s = max(0.0, s + (v - mu0) / sigma0 - k)
        out.append(s)
    return out


def _cusum_alerts(feat: pd.DataFrame, spec_of: dict[str, str], only_eval: bool = True) -> list[Alert]:
    """Alarm records for every month (only_eval=False, used to measure detection delay) or the evaluated months."""
    months = _all_months()
    evalm = set(_eval_months()) if only_eval else set(months)
    alerts: list[Alert] = []
    for metric, (label, scheme, floor, _minvol) in METRICS.items():
        piv = feat.pivot(index="provider_id", columns="month", values=metric).reindex(columns=months)
        base: dict[str, tuple[float, float]] = {}
        for p, row in piv.iterrows():
            vals = [v for v in row.tolist() if not math.isnan(v)][:ref.CUSUM_BASE_MONTHS]
            if len(vals) >= ref.CUSUM_BASE_MONTHS:
                base[p] = (float(np.mean(vals)), float(np.std(vals, ddof=1)))
        for p, (mu0, sd0) in base.items():
            peer_sd = [b[1] for q, b in base.items() if q != p and spec_of[q] == spec_of[p]]
            sigma0 = max(sd0, 0.5 * float(np.median(peer_sd)) if peer_sd else 0.0, floor)
            row = piv.loc[p]
            first_idx = [i for i, v in enumerate(row.tolist()) if not math.isnan(v)][:ref.CUSUM_BASE_MONTHS]
            start_after = first_idx[-1] + 1
            s = cusum_series(row.tolist()[start_after:], mu0, sigma0)
            full = [0.0] * start_after + s
            for i, m in enumerate(months):
                if m not in evalm or full[i] < ref.CUSUM_H:
                    continue
                onset = i
                while onset > 0 and full[onset - 1] > 0:
                    onset -= 1
                recent = [v for v in row.tolist()[onset:i + 1] if not math.isnan(v)]
                if not recent:
                    continue
                kind, thr = MIN_SHIFT[metric]
                shift = abs(float(np.mean(recent)) - mu0)
                if (kind == "abs" and shift < thr) or (kind == "rel" and shift < thr * abs(mu0)):
                    continue
                strength = round(float(min(1.0, full[i] / (2 * ref.CUSUM_H))), 4)
                alerts.append(Alert(
                    alert_id="", rule_id="T-CUSUM", scheme_type=scheme, provider_id=p, window_start=m.date(),
                    window_end=(m + pd.offsets.MonthEnd(0)).date(), score=strength, dollars=0.0, n_lines=0,
                    detail={"metric": metric, "label": label, "from": round(mu0, 4),
                            "to": round(float(np.mean(recent)), 4), "months": i - onset + 1,
                            "cusum": round(full[i], 2), "onset": months[onset].strftime("%Y-%m"),
                            "strength": strength}))
    return alerts


def _growth_ramp_alerts(feat: pd.DataFrame, spec_of: dict[str, str], enroll: dict[str, date]) -> list[Alert]:
    months = _all_months()
    paid = feat.pivot(index="provider_id", columns="month", values="paid").reindex(columns=months).fillna(0.0)
    alerts: list[Alert] = []
    for m in _eval_months():
        i = months.index(m)
        if i < 5:
            continue
        p90 = paid.iloc[:, i - 2:i + 1].sum(axis=1)
        prev = paid.iloc[:, i - 5:i - 2].sum(axis=1)
        g = np.log((p90 + 100.0) / (prev + 100.0))
        ok = prev >= 500.0
        eligible = {p: float(g[p]) for p in paid.index if ok[p]}
        for p, val in eligible.items():
            peers = [v for q, v in eligible.items() if q != p and spec_of[q] == spec_of[p]]
            if len(peers) < ref.PEER_MIN_PEERS:
                continue
            z, med = robust_z(val, peers, 0.15)
            if z >= ref.GROWTH_Z_ALERT and val > 0.4:
                strength = strength_from_z(z)
                alerts.append(Alert(
                    alert_id="", rule_id="T-GROWTH", scheme_type="GRW", provider_id=p, window_start=m.date(),
                    window_end=(m + pd.offsets.MonthEnd(0)).date(), score=strength, dollars=0.0, n_lines=0,
                    detail={"ratio": round(math.exp(val), 2), "peer": round(math.exp(med), 2), "z": round(z, 2),
                            "strength": strength}))
        # T-RAMP: tenure under a year and volume above the 75th percentile of mature peers
        end = (m + pd.offsets.MonthEnd(0)).date()
        for p in paid.index:
            tenure = (end - enroll[p]).days / 30.4
            if tenure >= ref.RAMP_TENURE_MONTHS or float(p90[p]) <= 0:
                continue
            mature = [float(p90[q]) for q in paid.index if q != p and spec_of[q] == spec_of[p]
                      and (end - enroll[q]).days / 30.4 >= ref.RAMP_TENURE_MONTHS]
            if len(mature) < ref.PEER_MIN_PEERS:
                continue
            p75 = float(np.percentile(mature, 75))
            if p75 > 0 and float(p90[p]) >= p75:
                ratio = float(p90[p]) / p75
                strength = round(min(1.0, ratio / 3) * 0.8, 4)
                alerts.append(Alert(
                    alert_id="", rule_id="T-RAMP", scheme_type="RMP", provider_id=p, window_start=m.date(),
                    window_end=end, score=strength, dollars=0.0, n_lines=0,
                    detail={"tenure": int(tenure), "ratio": round(ratio, 2), "strength": strength}))
    # a growth or ramp pattern must persist, like the peer signals
    keep: list[Alert] = []
    for rule in ("T-GROWTH", "T-RAMP"):
        by: dict[str, list[Alert]] = {}
        for a in alerts:
            if a.rule_id == rule:
                by.setdefault(a.provider_id, []).append(a)
        for al in by.values():
            if len(al) >= ref.PEER_MIN_MONTHS:
                keep += al
    return keep


def first_cusum_alarms(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    """provider -> first month (YYYY-MM) in which any CUSUM metric alarmed, over the WHOLE data window.
    Used by the evaluation to measure detection delay and false alarms; not part of the alert set."""
    lines, providers, _dist = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    out: dict[str, str] = {}
    for a in _cusum_alerts(monthly_features(lines), spec_of, only_eval=False):
        m = a.window_start.strftime("%Y-%m")
        if a.provider_id not in out or m < out[a.provider_id]:
            out[a.provider_id] = m
    return out


def run_temporal_signals(con: duckdb.DuckDBPyConnection) -> list[Alert]:
    lines, providers, _dist = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    enroll = {p: d for p, d in con.execute("SELECT provider_id, enroll_dt FROM provider").fetchall()}
    feat = monthly_features(lines)
    return _cusum_alerts(feat, spec_of) + _growth_ramp_alerts(feat, spec_of, enroll)


def trend_slope(monthly_dollars: dict[date, float]) -> float | None:
    """Theil-Sen slope (dollars per month) of monthly alert dollars; None with fewer than two months of data."""
    from scipy.stats import theilslopes
    pts = sorted(monthly_dollars.items())
    if len(pts) < 2:
        return None
    y = [v for _m, v in pts]
    x = list(range(len(y)))
    return float(theilslopes(y, x)[0])
