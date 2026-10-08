"""PEER channel: statistical comparison of a provider with providers of the same specialty.

Four signals, each one a robust z-score against peers (median / scaled MAD with a floor), with the provider's own
rate shrunk toward the peer median when its volume is small. Every alert carries the numbers a human needs (own
value, peer median, number of peers, z) as JSON in the `detail` column; the evidence pack turns them into
registry numbers. Dollars are ESTIMATES (or zero) and are labelled as such downstream.

  S-UPC    share of level 4-5 among office E&M lines, trailing 3 months
  S-UTL    lines per member in the month
  S-GHOST  share of the provider's members who saw no other provider in the prior 12 months
  S-DIST   mean distance between the provider and its members, trailing 3 months

This module reads claims.duckdb only. It must never import or open the ground-truth database.
"""

from __future__ import annotations

import json
import math
from datetime import date

import duckdb
import numpy as np
import pandas as pd

from claimshield import reference as ref

HIT_COLUMNS = ["rule_id", "claim_id", "line_no", "member_id", "provider_id", "service_dt", "hcpcs",
               "paid_amt", "dollars", "detail", "flag_role"]

FLOORS = {"S-UPC": 0.03, "S-UTL": 0.25, "S-GHOST": 0.02, "S-DIST": 5.0}


def strength_from_z(z: float) -> float:
    """z = 3 is the alert threshold and maps to 0.4; it saturates at 1.0 around z = 7."""
    return round(float(min(1.0, max(0.4, 0.4 + 0.15 * (z - ref.PEER_Z_ALERT)))), 4)


def robust_z(value: float, peers: list[float], floor: float) -> tuple[float, float]:
    """(z, peer_median). Scale is 1.4826 x MAD, never below `floor`, so a tight peer group cannot explode z."""
    arr = np.asarray(peers, dtype=float)
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    scale = max(1.4826 * mad, floor)
    return (value - med) / scale, med


def shrink(value: float, n: float, peer_median: float, k: float = ref.PEER_SHRINK_K) -> float:
    return (n * value + k * peer_median) / (n + k)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def _eval_months() -> list[pd.Timestamp]:
    end = pd.Timestamp(ref.WINDOW_END).to_period("M")
    return [(end - i).to_timestamp() for i in range(ref.PEER_WINDOW_MONTHS - 1, -1, -1)]


def _has_table(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    return bool(con.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
                            [name]).fetchone()[0])


def _load(con: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame | None]:
    lines = con.execute("""
        SELECT cl.claim_id, cl.line_no, c.member_id, cl.rendering_provider_id AS provider_id, cl.service_dt,
               cl.hcpcs, cl.units, cl.allowed_amt, cl.paid_amt, cl.pos_code, h.em_level,
               p.specialty_code, m.acuity_score
        FROM claim_line cl
        JOIN claim c ON c.claim_id = cl.claim_id
        JOIN ref_hcpcs h ON h.hcpcs = cl.hcpcs
        JOIN provider p ON p.provider_id = cl.rendering_provider_id
        JOIN member m ON m.member_id = c.member_id
        WHERE cl.rendering_provider_id IS NOT NULL""").fetchdf()
    lines["service_dt"] = pd.to_datetime(lines["service_dt"])
    lines["month"] = lines["service_dt"].dt.to_period("M").dt.to_timestamp()
    for col in ("allowed_amt", "paid_amt"):
        lines[col] = lines[col].astype(float)
    providers = con.execute("SELECT provider_id, specialty_code FROM provider").fetchdf()
    dist = None
    if _has_table(con, "provider_location") and _has_table(con, "member_location"):
        dist = con.execute("""
            SELECT m.member_id, p.provider_id, m.lat AS mlat, m.lon AS mlon, p.lat AS plat, p.lon AS plon
            FROM member_location m CROSS JOIN provider_location p""").fetchdf()
    return lines, providers, dist


def _row(rule: str, ln: pd.Series, dollars: float, detail: dict, role: str) -> dict:
    return {"rule_id": rule, "claim_id": ln["claim_id"], "line_no": int(ln["line_no"]), "member_id": ln["member_id"],
            "provider_id": ln["provider_id"], "service_dt": ln["service_dt"].date(), "hcpcs": ln["hcpcs"],
            "paid_amt": float(ln["paid_amt"]), "dollars": round(float(dollars), 2),
            "detail": json.dumps(detail, sort_keys=True), "flag_role": role}


def _spread(total: float, n: int) -> list[float]:
    """Split `total` into n cent-exact parts so the parts add up to the rounded total."""
    cents = int(round(total * 100))
    base, extra = divmod(cents, n)
    return [(base + (1 if i < extra else 0)) / 100 for i in range(n)]


def _peers_of(provider: str, spec_of: dict[str, str], values: dict[str, float]) -> list[float]:
    spec = spec_of[provider]
    return [v for q, v in values.items() if q != provider and spec_of[q] == spec]


# ---------------------------------------------------------------------------------------------------- S-UPC
def _upc(lines: pd.DataFrame, spec_of: dict[str, str]) -> list[dict]:
    em = lines[lines["em_level"].notna() & (lines["pos_code"] == "11")].copy()
    em["hi"] = em["em_level"] >= 4
    rows: list[dict] = []
    for m in _eval_months():
        win = em[(em["month"] > m - pd.DateOffset(months=3)) & (em["month"] <= m)]
        g = win.groupby("provider_id")
        n = g.size()
        share = (g["hi"].mean())
        ok = n[n >= ref.PEER_MIN_EM].index
        shares = {p: float(share[p]) for p in ok}
        acuity = {p: float(win[win["provider_id"] == p].drop_duplicates("member_id")["acuity_score"].mean())
                  for p in ok}
        for p in ok:
            peers = _peers_of(p, spec_of, shares)
            if len(peers) < ref.PEER_MIN_PEERS:
                continue
            _, med = robust_z(shares[p], peers, FLOORS["S-UPC"])
            adj = shrink(shares[p], float(n[p]), med)
            z, _ = robust_z(adj, peers, FLOORS["S-UPC"])
            if z < ref.PEER_Z_ALERT or adj - med < ref.UPC_MIN_GAP:
                continue
            pw = win[win["provider_id"] == p]
            hi_allowed, lo_allowed = pw[pw["hi"]]["allowed_amt"].mean(), pw[~pw["hi"]]["allowed_amt"].mean()
            if math.isnan(lo_allowed):
                lo_allowed = em[~em["hi"]]["allowed_amt"].mean()
            flagged = em[(em["provider_id"] == p) & (em["month"] == m) & em["hi"]].sort_values(["claim_id", "line_no"])
            n_month = int((em[(em["provider_id"] == p) & (em["month"] == m)]).shape[0])
            if flagged.empty:
                continue
            est = n_month * max(0.0, adj - med) * max(0.0, hi_allowed - lo_allowed) * 0.8
            peer_acu = float(np.mean([acuity[q] for q in ok if q != p and spec_of[q] == spec_of[p]]))
            detail = {"share": round(adj, 4), "rawShare": round(shares[p], 4), "peer": round(med, 4),
                      "peers": len(peers), "z": round(z, 2), "strength": strength_from_z(z),
                      "acuity": round(acuity[p], 4), "peerAcuity": round(peer_acu, 4), "month": m.strftime("%Y-%m")}
            for (_, ln), d in zip(flagged.iterrows(), _spread(est, len(flagged)), strict=True):
                rows.append(_row("S-UPC", ln, d, detail, "PEER_HIGH_LEVEL"))
    return rows


# ---------------------------------------------------------------------------------------------------- S-UTL
def _utl(lines: pd.DataFrame, spec_of: dict[str, str]) -> list[dict]:
    rows: list[dict] = []
    for m in _eval_months():
        win = lines[lines["month"] == m]
        g = win.groupby("provider_id")
        members = g["member_id"].nunique()
        ok = members[members >= ref.PEER_MIN_MEMBERS].index
        lpm = {p: float(g.size()[p] / members[p]) for p in ok}
        for p in ok:
            peers = _peers_of(p, spec_of, lpm)
            if len(peers) < ref.PEER_MIN_PEERS:
                continue
            z, med = robust_z(lpm[p], peers, FLOORS["S-UTL"])
            if z < ref.PEER_Z_ALERT or lpm[p] < ref.UTL_MIN_RATIO * med:
                continue
            pw = win[win["provider_id"] == p]
            per_member = pw.groupby("member_id").size()
            threshold = math.ceil(ref.UTL_MIN_RATIO * med)
            heavy = per_member[per_member > threshold].index
            flagged = pw[pw["member_id"].isin(heavy)].sort_values(["claim_id", "line_no"])
            if flagged.empty:
                continue
            est = max(0.0, lpm[p] - med) * float(members[p]) * float(pw["paid_amt"].mean())
            est = min(est, float(flagged["paid_amt"].sum()))
            detail = {"lpm": round(lpm[p], 2), "peer": round(med, 2), "peers": len(peers), "z": round(z, 2),
                      "strength": strength_from_z(z), "members": int(members[p]), "month": m.strftime("%Y-%m")}
            for (_, ln), d in zip(flagged.iterrows(), _spread(est, len(flagged)), strict=True):
                rows.append(_row("S-UTL", ln, d, detail, "PEER_EXCESS_USE"))
    return rows


# -------------------------------------------------------------------------------------------------- S-GHOST
def _ghost(lines: pd.DataFrame, spec_of: dict[str, str]) -> list[dict]:
    rows: list[dict] = []
    for m in _eval_months():
        end = m + pd.offsets.MonthEnd(0)
        win = lines[(lines["service_dt"] > end - pd.DateOffset(months=ref.GHOST_LOOKBACK_MONTHS))
                    & (lines["service_dt"] <= end)]
        providers_per_member = win.groupby("member_id")["provider_id"].nunique()
        solo = set(providers_per_member[providers_per_member == 1].index)
        members_of = win.groupby("provider_id")["member_id"].agg(lambda s: set(s))
        ok = [p for p, s in members_of.items() if len(s) >= ref.PEER_MIN_MEMBERS]
        share = {p: len(members_of[p] & solo) / len(members_of[p]) for p in ok}
        for p in ok:
            peers = _peers_of(p, spec_of, share)
            if len(peers) < ref.PEER_MIN_PEERS:
                continue
            z, med = robust_z(share[p], peers, FLOORS["S-GHOST"])
            if z < ref.PEER_Z_ALERT or share[p] < ref.GHOST_MIN_SHARE:
                continue
            excl = members_of[p] & solo
            flagged = lines[(lines["provider_id"] == p) & (lines["month"] == m)
                            & lines["member_id"].isin(excl)].sort_values(["claim_id", "line_no"])
            if flagged.empty:
                continue
            detail = {"share": round(share[p], 4), "peer": round(med, 4), "peers": len(peers), "z": round(z, 2),
                      "strength": strength_from_z(z), "members": len(excl), "months": ref.GHOST_LOOKBACK_MONTHS,
                      "month": m.strftime("%Y-%m")}
            for _, ln in flagged.iterrows():
                rows.append(_row("S-GHOST", ln, float(ln["paid_amt"]), detail, "PEER_EXCLUSIVE_MEMBER"))
    return rows


# --------------------------------------------------------------------------------------------------- S-DIST
def _dist(lines: pd.DataFrame, spec_of: dict[str, str], dist: pd.DataFrame | None) -> list[dict]:
    if dist is None:
        return []
    dist = dist.copy()
    dist["km"] = haversine_km(dist["mlat"], dist["mlon"], dist["plat"], dist["plon"])
    km_of = {(r.member_id, r.provider_id): float(r.km) for r in dist.itertuples()}
    rows: list[dict] = []
    for m in _eval_months():
        win = lines[(lines["month"] > m - pd.DateOffset(months=3)) & (lines["month"] <= m)]
        pairs = win.drop_duplicates(["provider_id", "member_id"])[["provider_id", "member_id"]]
        pairs = pairs.assign(km=[km_of.get((a, b)) for a, b in zip(pairs["member_id"], pairs["provider_id"],
                                                                    strict=True)])
        pairs = pairs.dropna(subset=["km"])
        g = pairs.groupby("provider_id")["km"]
        counts = g.size()
        ok = counts[counts >= ref.PEER_MIN_MEMBERS].index
        mean_km = {p: float(g.mean()[p]) for p in ok}
        for p in ok:
            peers = _peers_of(p, spec_of, mean_km)
            if len(peers) < ref.PEER_MIN_PEERS:
                continue
            z, med = robust_z(mean_km[p], peers, FLOORS["S-DIST"])
            if z < ref.PEER_Z_ALERT or mean_km[p] < ref.DIST_MIN_KM:
                continue
            far = {mid for mid, k in ((r.member_id, r.km) for r in pairs[pairs["provider_id"] == p].itertuples())
                   if k >= ref.DIST_MIN_KM}
            flagged = lines[(lines["provider_id"] == p) & (lines["month"] == m)
                            & lines["member_id"].isin(far)].sort_values(["claim_id", "line_no"])
            if flagged.empty:
                continue
            detail = {"km": round(mean_km[p], 1), "peer": round(med, 1), "peers": len(peers), "z": round(z, 2),
                      "strength": strength_from_z(z), "month": m.strftime("%Y-%m")}
            for _, ln in flagged.iterrows():
                rows.append(_row("S-DIST", ln, 0.0, detail, "PEER_FAR_MEMBER"))
    return rows


def run_peer_signals(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    lines, providers, dist = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    rows = _upc(lines, spec_of) + _utl(lines, spec_of) + _ghost(lines, spec_of) + _dist(lines, spec_of, dist)
    months: dict[tuple[str, str], set[str]] = {}
    for r in rows:
        months.setdefault((r["rule_id"], r["provider_id"]), set()).add(json.loads(r["detail"])["month"])
    rows = [r for r in rows if len(months[(r["rule_id"], r["provider_id"])]) >= ref.PEER_MIN_MONTHS]
    if not rows:
        return pd.DataFrame(columns=HIT_COLUMNS)
    return pd.DataFrame(rows, columns=HIT_COLUMNS)


def monthly_cutoff() -> date:
    """First day of the earliest evaluated month (used by tests and docs)."""
    return _eval_months()[0].date()
