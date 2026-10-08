"""Provider-level features used by precedent vectors and by exception-rule conditions (the closed catalogue).

Everything is computed from the claims database as of the end of the data window; nothing here reads ground truth.
"""

from __future__ import annotations

import math

import duckdb
import numpy as np
import pandas as pd

from claimshield import reference as ref
from claimshield.detect.peer import _load, haversine_km
from claimshield.graph import graph as G

LAST_MONTHS = 6


def provider_features(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, float]]:
    lines, providers, dist = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    end = pd.Timestamp(ref.WINDOW_END)
    recent = lines[lines["service_dt"] > end - pd.DateOffset(months=LAST_MONTHS)]
    year = lines[lines["service_dt"] > end - pd.DateOffset(months=12)]
    em = recent[recent["em_level"].notna() & (recent["pos_code"] == "11")]
    hits = con.execute("SELECT rule_id, provider_id, COUNT(*) FROM out_rule_hit WHERE service_dt > ? "
                       "GROUP BY 1, 2", [(end - pd.DateOffset(months=12)).date()]).fetchall()
    hit_n: dict[tuple[str, str], int] = {(r, p): int(n) for r, p, n in hits}
    tables = G.load_tables(con)
    enroll = dict(zip(tables["provider"]["provider_id"], tables["provider"]["enroll_dt"], strict=True))
    start6, _ = G._window(ref.GRAPH_WINDOW_MONTHS)
    ref12 = G.referral_lines(con, G._window(ref.GRAPH_REFCONC_MONTHS)[0], ref.WINDOW_END)
    ref6 = G.referral_lines(con, start6, ref.WINDOW_END)
    groups = G.control_groups(tables)
    owner_of = {p: g for g, ps in groups.items() for p in ps}
    loc = con.execute("SELECT provider_id, region, building_id FROM provider_location").fetchdf()
    region = dict(zip(loc["provider_id"], loc["region"], strict=True))
    building = {p: b for p, b in zip(loc["provider_id"], loc["building_id"], strict=True) if isinstance(b, str)}
    control_owner = {p: o for o, ps in groups.items() for p in ps}
    own = tables["ownership"]
    ctrl = own[own["is_control"]]
    control_owner = dict(zip(ctrl["provider_id"], ctrl["owner_id"], strict=True))

    out: dict[str, dict[str, float]] = {}
    km = pd.DataFrame()
    if dist is not None:
        dist = dist.copy()
        dist["km"] = haversine_km(dist["mlat"], dist["mlon"], dist["plat"], dist["plon"])
        seen = lines[lines["service_dt"] > end - pd.DateOffset(months=3)][["provider_id", "member_id"]] \
            .drop_duplicates()
        km = seen.merge(dist[["member_id", "provider_id", "km"]], on=["member_id", "provider_id"], how="left")
    for p in spec_of:
        mine, mine_em = recent[recent["provider_id"] == p], em[em["provider_id"] == p]
        n_members = max(1, mine["member_id"].nunique())
        months = max(1, mine["month"].nunique())
        n_year_lines = max(1, int((year["provider_id"] == p).sum()))
        refs_in = ref12[ref12["provider_id"] == p].drop_duplicates("claim_id")
        top3 = 0.0
        if len(refs_in) >= 10:
            top3 = float(refs_in.groupby("referrer").size().sort_values(ascending=False).iloc[:3].sum() / len(refs_in))
        self_share = 0.0
        if p in owner_of:
            grp = set(groups[owner_of[p]])
            out_l = ref6[ref6["referrer"].isin(grp)]
            tot = float(out_l["paid_amt"].sum())
            self_share = float(out_l[out_l["provider_id"].isin(grp)]["paid_amt"].sum() / tot) if tot > 0 else 0.0
        sharing = [q for q, b in building.items() if b == building.get(p) and q != p] if p in building else []
        unrelated = [q for q in sharing if control_owner.get(q) != control_owner.get(p)]
        same_county_same_spec = [q for q in spec_of if q != p and spec_of[q] == spec_of[p]
                                 and region.get(q) == region.get(p)]
        mean_km = float(km[km["provider_id"] == p]["km"].mean()) if len(km) and (km["provider_id"] == p).any() else 0.0
        out[p] = {
            "em_high_share": float((mine_em["em_level"] >= 4).mean()) if len(mine_em) else 0.0,
            "lines_per_member": float(len(mine) / n_members / months) if len(mine) else 0.0,
            "visits_per_member_month": float(mine["claim_id"].nunique() / n_members / months) if len(mine) else 0.0,
            "dup_share": hit_n.get(("R-DUP-01", p), 0) / n_year_lines,
            "ptp_share": hit_n.get(("R-PTP-01", p), 0) / n_year_lines,
            "mue_share": hit_n.get(("R-MUE-01", p), 0) / n_year_lines,
            "referral_top3_share": top3, "self_referral_share": self_share,
            "mean_member_km": 0.0 if math.isnan(mean_km) else mean_km,
            "tenure_months": max(0.0, (pd.Timestamp(ref.WINDOW_END) - pd.Timestamp(enroll[p])).days / 30.4),
            "acuity_mean": float(mine.drop_duplicates("member_id")["acuity_score"].mean()) if len(mine) else 0.0,
            "building_unrelated_owner_count": float(len(unrelated)),
            "is_sole_provider_county": float(not same_county_same_spec),
            "hard_fact_alert_count": 0.0,          # filled in by the analysis once the alerts exist
        }
    return {p: {k: (0.0 if (isinstance(v, float) and np.isnan(v)) else v) for k, v in f.items()}
            for p, f in out.items()}
