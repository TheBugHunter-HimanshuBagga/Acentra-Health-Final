"""Graph analytics (channel NETWORK) with NetworkX.

Graphs
  A  infrastructure (undirected): provider - control owner, building, phone, facility
  B  referral (directed, weighted): referring provider -> rendering provider, referrals and paid dollars

Signals
  G-OWNREF   control-owner groups whose referrals mostly stay inside the group           (lines, ESTIMATED dollars)
  G-LOOP     closed referral loops (length 2-4) inside an owner group                     (lines, ESTIMATED dollars)
  G-REFCONC  providers whose referrals come from very few referrers, versus specialty peers (lines)
  G-INFRA    components of graph A joined by shared infrastructure; weak on purpose        (alert only, no lines)
  G-PROX     context only: hops to a provider with a CONFIRMED earlier investigation

This module reads claims.duckdb only. It never opens the ground-truth database.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

import duckdb
import networkx as nx
import pandas as pd

from claimshield import reference as ref
from claimshield.detect.peer import HIT_COLUMNS, robust_z


@dataclass
class GroupAlert:
    """An alert about a group of providers that has no claim lines of its own (G-INFRA)."""
    rule_id: str
    providers: list[str]
    strength: float
    detail: dict = field(default_factory=dict)


def _window(months: int) -> tuple[date, date]:
    end = ref.WINDOW_END
    start = (pd.Timestamp(end).to_period("M") - (months - 1)).to_timestamp().date()
    return start, end


def load_tables(con: duckdb.DuckDBPyConnection) -> dict[str, pd.DataFrame]:
    return {
        "ownership": con.execute("SELECT provider_id, owner_id, is_control FROM ownership").fetchdf(),
        "location": con.execute("SELECT provider_id, building_id, phone_syn FROM provider_location").fetchdf(),
        "facility": con.execute("SELECT provider_id, facility_id FROM provider_facility").fetchdf(),
        "provider": con.execute("SELECT provider_id, specialty_code, enroll_dt FROM provider").fetchdf(),
        "investigation": con.execute("SELECT provider_id, disposition, closed_dt FROM investigation").fetchdf(),
    }


def referral_lines(con: duckdb.DuckDBPyConnection, start: date, end: date) -> pd.DataFrame:
    """One row per referred claim line: referrer, rendering provider, member, dates, paid."""
    df = con.execute("""
        SELECT c.referring_provider_id AS referrer, cl.rendering_provider_id AS provider_id, c.member_id,
               cl.claim_id, cl.line_no, cl.service_dt, cl.hcpcs, cl.paid_amt
        FROM claim c JOIN claim_line cl USING (claim_id)
        WHERE c.referring_provider_id IS NOT NULL AND cl.rendering_provider_id IS NOT NULL
          AND c.referring_provider_id <> cl.rendering_provider_id
          AND cl.service_dt BETWEEN ? AND ?""", [start, end]).fetchdf()
    df["paid_amt"] = df["paid_amt"].astype(float)
    return df


def referral_graph(lines: pd.DataFrame) -> nx.DiGraph:
    g = nx.DiGraph()
    claims = lines.drop_duplicates(["claim_id", "referrer", "provider_id"])
    n = claims.groupby(["referrer", "provider_id"]).size()
    dollars = lines.groupby(["referrer", "provider_id"])["paid_amt"].sum()
    for (a, b), cnt in n.items():
        g.add_edge(a, b, referrals=int(cnt), dollars=float(dollars[(a, b)]))
    return g


def control_groups(tables: dict[str, pd.DataFrame]) -> dict[str, list[str]]:
    own = tables["ownership"]
    groups = own[own["is_control"]].groupby("owner_id")["provider_id"].apply(sorted)
    return {oid: ps for oid, ps in groups.items() if len(ps) >= 2}


def infrastructure_graph(tables: dict[str, pd.DataFrame]) -> nx.Graph:
    """Providers are joined by one edge per shared item; edge attribute 'links' lists the shared kinds."""
    g = nx.Graph()
    g.add_nodes_from(tables["provider"]["provider_id"])
    items: dict[tuple[str, str], set[str]] = defaultdict(set)    # (kind, value) -> providers
    own = tables["ownership"]
    for r in own[own["is_control"]].itertuples():
        items[("owner", r.owner_id)].add(r.provider_id)
    for r in tables["location"].itertuples():
        if isinstance(r.building_id, str) and r.building_id:
            items[("address", r.building_id)].add(r.provider_id)
        if isinstance(r.phone_syn, str) and r.phone_syn:
            items[("phone", r.phone_syn)].add(r.provider_id)
    for r in tables["facility"].itertuples():
        items[("facility", r.facility_id)].add(r.provider_id)
    for (kind, _value), provs in items.items():
        provs = sorted(provs)
        for i, a in enumerate(provs):
            for b in provs[i + 1:]:
                links = g.edges[a, b]["links"] if g.has_edge(a, b) else set()
                g.add_edge(a, b, links=links | {kind})
    return g


def _pair_score(links: set[str]) -> float:
    return sum(ref.INFRA_LINK_WEIGHT[k] for k in links)


def infra_alerts(tables: dict[str, pd.DataFrame]) -> list[GroupAlert]:
    """Groups joined by shared infrastructure. A pair is linked when its link score reaches 0.3 (a shared owner, or a
    shared phone number, or building plus facility). Sharing a building alone is NOT enough, and the group signal is
    capped at 0.4 because shared infrastructure alone is weak evidence."""
    a = infrastructure_graph(tables)
    strong = nx.Graph()
    for u, v, d in a.edges(data=True):
        if _pair_score(d["links"]) >= 0.3:
            strong.add_edge(u, v, links=d["links"], score=_pair_score(d["links"]))
    out = []
    for comp in nx.connected_components(strong):
        sub = strong.subgraph(comp)
        kinds = sorted({k for _u, _v, d in sub.edges(data=True) for k in d["links"]})
        top = max(d["score"] for _u, _v, d in sub.edges(data=True))
        out.append(GroupAlert("G-INFRA", sorted(comp), round(min(ref.INFRA_CAP, top), 4),
                              {"links": kinds, "members": len(comp), "strength": round(min(ref.INFRA_CAP, top), 4)}))
    return sorted(out, key=lambda g: g.providers)


def _hit_rows(rule: str, lines: pd.DataFrame, detail: dict, role: str) -> list[dict]:
    rows = []
    for r in lines.sort_values(["claim_id", "line_no"]).itertuples():
        d = dict(detail, month=pd.Timestamp(r.service_dt).strftime("%Y-%m"))
        rows.append({"rule_id": rule, "claim_id": r.claim_id, "line_no": int(r.line_no), "member_id": r.member_id,
                     "provider_id": r.provider_id, "service_dt": pd.Timestamp(r.service_dt).date(),
                     "hcpcs": r.hcpcs, "paid_amt": float(r.paid_amt), "dollars": round(float(r.paid_amt), 2),
                     "detail": json.dumps(d, sort_keys=True), "flag_role": role})
    return rows


def owner_group_signals(con, tables) -> list[dict]:
    """G-OWNREF and G-LOOP over the trailing referral window."""
    start, end = _window(ref.GRAPH_WINDOW_MONTHS)
    lines = referral_lines(con, start, end)
    rows: list[dict] = []
    for owner, members in control_groups(tables).items():
        if len(members) > ref.LOOP_MAX_GROUP:
            continue
        mset = set(members)
        out_lines = lines[lines["referrer"].isin(mset)]
        inside = out_lines[out_lines["provider_id"].isin(mset)]
        n_in = inside.drop_duplicates("claim_id").shape[0]
        d_out, d_in = float(out_lines["paid_amt"].sum()), float(inside["paid_amt"].sum())
        share = d_in / d_out if d_out else 0.0
        if share >= ref.OWNREF_MIN_SHARE and n_in >= ref.OWNREF_MIN_REFERRALS:
            strength = round(min(1.0, max(0.0, (share - ref.OWNREF_MIN_SHARE) / 0.4)), 4)
            detail = {"owner": owner, "group": members, "share": round(share, 4), "referrals": n_in,
                      "members": len(members), "strength": max(strength, 0.3)}
            rows += _hit_rows("G-OWNREF", inside, detail, "RING_REFERRAL")
        # directed cycles of length 2-4 where every edge has enough referrals
        g = referral_graph(inside)
        heavy = nx.DiGraph([(a, b) for a, b, d in g.edges(data=True) if d["referrals"] >= ref.LOOP_MIN_EDGE_REFERRALS])
        cycles = [c for c in nx.simple_cycles(heavy, length_bound=4) if 2 <= len(c) <= 4]
        if cycles:
            edges = {(c[i], c[(i + 1) % len(c)]) for c in cycles for i in range(len(c))}
            on_cycle = inside[[(a, b) in edges for a, b in zip(inside["referrer"], inside["provider_id"],
                                                                  strict=True)]]
            detail = {"owner": owner, "group": members, "cycles": len(cycles), "length": max(len(c) for c in cycles),
                      "members": len(members), "strength": round(min(1.0, 0.5 + 0.1 * len(cycles)), 4)}
            rows += _hit_rows("G-LOOP", on_cycle, detail, "RING_LOOP")
    return rows


def referral_concentration_signals(con, tables) -> list[dict]:
    """G-REFCONC: a provider whose referrals come from very few referrers, far more than same-specialty peers."""
    start, end = _window(ref.GRAPH_REFCONC_MONTHS)
    lines = referral_lines(con, start, end)
    if lines.empty:
        return []
    spec = dict(zip(tables["provider"]["provider_id"], tables["provider"]["specialty_code"], strict=True))
    stats: dict[str, dict] = {}
    for prov, grp in lines.groupby("provider_id"):
        claims = grp.drop_duplicates("claim_id")
        if len(claims) < ref.REFCONC_MIN_REFERRALS:
            continue
        by_ref = claims.groupby("referrer").size().sort_values(ascending=False)
        top3 = list(by_ref.index[:3])
        stats[prov] = {"share": float(by_ref.iloc[:3].sum() / len(claims)), "n": len(claims), "top3": top3,
                       "referrers": int(len(by_ref))}
    rows: list[dict] = []
    for prov, st in stats.items():
        peers = [v["share"] for q, v in stats.items() if q != prov and spec[q] == spec[prov]]
        if len(peers) < ref.REFCONC_MIN_PEERS:
            continue
        z, med = robust_z(st["share"], peers, 0.05)
        if st["share"] < ref.REFCONC_MIN_SHARE or z < ref.PEER_Z_ALERT:
            continue
        from claimshield.detect.peer import strength_from_z
        sel = lines[(lines["provider_id"] == prov) & lines["referrer"].isin(st["top3"])]
        detail = {"share": round(st["share"], 4), "referrals": st["n"], "referrers": min(3, st["referrers"]),
                  "peer": round(med, 4), "peers": len(peers), "z": round(z, 2), "top3": st["top3"],
                  "strength": strength_from_z(z)}
        rows += _hit_rows("G-REFCONC", sel, detail, "CONCENTRATED_REFERRER")
    return rows


def min_hops_to_confirmed(tables, ref_graph: nx.DiGraph, asof: date) -> dict[str, int | None]:
    """G-PROX (context): shortest path (at most 2) in A + B to a provider with a CONFIRMED investigation."""
    inv = tables["investigation"]
    confirmed = set(inv[(inv["disposition"] == "CONFIRMED") & (pd.to_datetime(inv["closed_dt"]).dt.date <= asof)]
                    ["provider_id"])
    union = infrastructure_graph(tables)
    for u, v in ref_graph.edges:
        union.add_edge(u, v)
    out: dict[str, int | None] = {}
    for p in union.nodes:
        best = None
        for c in confirmed:
            if c == p:
                best = 0
                break
            try:
                d = nx.shortest_path_length(union, p, c)
            except nx.NetworkXNoPath:
                continue
            if d <= 2 and (best is None or d < best):
                best = d
        out[p] = best
    return out


def run_graph_signals(con: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, list[GroupAlert]]:
    """Line-backed graph hits (same shape as rule hits) and the line-less infrastructure alerts."""
    tables = load_tables(con)
    rows = owner_group_signals(con, tables) + referral_concentration_signals(con, tables)
    hits = pd.DataFrame(rows, columns=HIT_COLUMNS) if rows else pd.DataFrame(columns=HIT_COLUMNS)
    return hits, infra_alerts(tables)
