"""Per-case views the workbench draws: the relationship graph and the timeline (stored as JSON in serving_*)."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

import duckdb
import networkx as nx
import pandas as pd

from claimshield import reference as ref
from claimshield.cases.score import ScoredCase

MAX_MEMBER_NODES = 12
MAX_EXTERNAL_REFERRERS = 3


@dataclass
class ViewData:
    monthly: dict[tuple[str, str], tuple[int, float]] = field(default_factory=dict)   # (provider, YYYY-MM)
    owners: dict[str, list[tuple[str, bool, float]]] = field(default_factory=dict)
    location: dict[str, dict] = field(default_factory=dict)
    facilities: dict[str, list[str]] = field(default_factory=dict)
    referrals: pd.DataFrame = field(default_factory=pd.DataFrame)       # referrer, provider_id, n, dollars
    member_death: dict[str, date] = field(default_factory=dict)
    stays: dict[str, list[tuple[date, date]]] = field(default_factory=dict)
    investigations: dict[str, list[dict]] = field(default_factory=dict)
    exclusion: dict[str, date] = field(default_factory=dict)
    enroll: dict[str, date] = field(default_factory=dict)


def load_view_data(con: duckdb.DuckDBPyConnection) -> ViewData:
    vd = ViewData()
    for p, m, n, paid in con.execute("""SELECT rendering_provider_id, strftime(service_dt, '%Y-%m'), COUNT(*),
                                        SUM(paid_amt) FROM claim_line WHERE rendering_provider_id IS NOT NULL
                                        GROUP BY 1, 2""").fetchall():
        vd.monthly[(p, m)] = (int(n), float(paid))
    for p, o, c, pct in con.execute("SELECT provider_id, owner_id, is_control, pct FROM ownership").fetchall():
        vd.owners.setdefault(p, []).append((o, bool(c), float(pct)))
    for p, b, ph, lat, lon in con.execute(
            "SELECT provider_id, building_id, phone_syn, lat, lon FROM provider_location").fetchall():
        vd.location[p] = {"building": b, "phone": ph, "lat": lat, "lon": lon}
    for p, f in con.execute("SELECT provider_id, facility_id FROM provider_facility").fetchall():
        vd.facilities.setdefault(p, []).append(f)
    vd.referrals = con.execute("""
        SELECT c.referring_provider_id AS referrer, cl.rendering_provider_id AS provider_id,
               COUNT(DISTINCT c.claim_id) AS n, SUM(cl.paid_amt) AS dollars
        FROM claim c JOIN claim_line cl USING (claim_id)
        WHERE c.referring_provider_id IS NOT NULL AND cl.rendering_provider_id IS NOT NULL
          AND c.referring_provider_id <> cl.rendering_provider_id GROUP BY 1, 2""").fetchdf()
    vd.member_death = {m: d for m, d in con.execute(
        "SELECT member_id, death_dt FROM member WHERE death_dt IS NOT NULL").fetchall()}
    for m, a, d in con.execute("SELECT member_id, admit_dt, discharge_dt FROM inpatient_stay").fetchall():
        vd.stays.setdefault(m, []).append((a, d))
    for inv, p, st, o, c, disp, rc in con.execute(
            "SELECT investigation_id, provider_id, scheme_type, opened_dt, closed_dt, disposition, reason_code "
            "FROM investigation").fetchall():
        vd.investigations.setdefault(p, []).append({"id": inv, "scheme": st, "opened": o, "closed": c,
                                                    "disposition": disp, "reason": rc})
    vd.exclusion = {p: d for p, d in con.execute("SELECT provider_id, MIN(excl_dt) FROM exclusion GROUP BY 1")
                    .fetchall()}
    vd.enroll = {p: d for p, d in con.execute("SELECT provider_id, enroll_dt FROM provider").fetchall()}
    return vd


def build_graph(sc: ScoredCase, vd: ViewData, hit_meta: dict) -> dict:
    d = sc.draft
    subjects = {p: r for p, r in d.subjects}
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def node(nid: str, ntype: str, label: str, role: str | None = None, **extra) -> None:
        nodes.setdefault(nid, {"id": nid, "type": ntype, "label": label, "role": role, **extra})

    def edge(a: str, b: str, etype: str, label: str, n: int = 0) -> None:
        edges.append({"id": f"{etype}:{a}>{b}", "source": a, "target": b, "type": etype, "label": label,
                      "nClaims": n})

    for p, role in subjects.items():
        node(p, "provider", p, role, specialty=None)
    # ownership: control owners always; minority owners only if they connect two subjects
    owner_members: dict[str, list[str]] = defaultdict(list)
    for p in subjects:
        for oid, _ctrl, _pct in vd.owners.get(p, []):
            owner_members[oid].append(p)
    for oid, members in owner_members.items():
        ctrl = any(c for p in members for o, c, _ in vd.owners[p] if o == oid)
        if ctrl or len(members) >= 2:
            node(oid, "owner", oid, None)
            for p in members:
                pct = next(x[2] for x in vd.owners[p] if x[0] == oid)
                edge(p, oid, "owner", f"{'controls' if ctrl else 'holds'} {pct * 100:.0f}%")
    # shared buildings, phones, facilities (drawn only when they connect at least two providers in the picture)
    for kind, getter in (("building", lambda p: [vd.location[p]["building"]]),
                         ("phone", lambda p: [vd.location[p]["phone"]]),
                         ("facility", lambda p: vd.facilities.get(p, []))):
        holders: dict[str, list[str]] = defaultdict(list)
        for p in subjects:
            for v in getter(p):
                if isinstance(v, str) and v:
                    holders[v].append(p)
        for v, ps in holders.items():
            if len(ps) >= 2:
                node(v, kind, v)
                for p in ps:
                    edge(p, v, kind, f"shares {kind}")
    # referrals among subjects and the strongest outside referrers
    ref_df = vd.referrals
    if not ref_df.empty:
        inside = ref_df[ref_df["referrer"].isin(subjects) & ref_df["provider_id"].isin(subjects)]
        for r in inside.itertuples():
            edge(r.referrer, r.provider_id, "referral", f"{int(r.n)} referrals", int(r.n))
        for p in subjects:
            into = ref_df[(ref_df["provider_id"] == p) & ~ref_df["referrer"].isin(subjects)] \
                .sort_values("n", ascending=False).head(MAX_EXTERNAL_REFERRERS)
            for r in into.itertuples():
                node(r.referrer, "provider", r.referrer, "REFERRER")
                edge(r.referrer, p, "referral", f"{int(r.n)} referrals", int(r.n))
    # members with the most flagged dollars
    member_dollars: dict[str, float] = defaultdict(float)
    member_claims: dict[tuple[str, str], set] = defaultdict(set)
    for key, dollars in sc.line_dollars.items():
        m = hit_meta[(key[0], key[1], sc.line_rule[key])]
        member_dollars[m["member_id"]] += dollars
        member_claims[(m["member_id"], m["provider_id"])].add(key[0])
    for mid in sorted(member_dollars, key=lambda x: (-member_dollars[x], x))[:MAX_MEMBER_NODES]:
        node(mid, "member", mid, None, dollars=round(member_dollars[mid], 2))
        for (m2, prov), claims in member_claims.items():
            if m2 == mid and prov in nodes:
                edge(mid, prov, "billed", f"{len(claims)} flagged claims", len(claims))
    # deterministic layout
    g = nx.Graph()
    g.add_nodes_from(nodes)
    g.add_edges_from((e["source"], e["target"]) for e in edges if e["source"] in nodes and e["target"] in nodes)
    pos = nx.spring_layout(g, seed=7, k=0.9) if len(g) > 1 else {n: (0.0, 0.0) for n in g}
    for nid, nd in nodes.items():
        x, y = pos[nid]
        nd["x"], nd["y"] = round(float(x) * 400 + 500, 1), round(float(y) * 300 + 350, 1)
    seen, clean = set(), []
    for e in edges:
        if e["source"] in nodes and e["target"] in nodes and e["id"] not in seen:
            seen.add(e["id"])
            clean.append(e)
    return {"nodes": list(nodes.values()), "edges": clean}


def build_timeline(sc: ScoredCase, vd: ViewData, hit_meta: dict) -> dict:
    d = sc.draft
    primary = d.primary
    flagged_lines: dict[str, int] = defaultdict(int)
    flagged_dollars: dict[str, float] = defaultdict(float)
    members_flagged: dict[str, float] = defaultdict(float)
    for key, dollars in sc.line_dollars.items():
        m = hit_meta[(key[0], key[1], sc.line_rule[key])]
        month = m["service_dt"].strftime("%Y-%m")
        flagged_lines[month] += 1
        flagged_dollars[month] += dollars
        members_flagged[m["member_id"]] += dollars
    months = []
    start = pd.Timestamp(ref.WINDOW_START).to_period("M")
    end = pd.Timestamp(ref.WINDOW_END).to_period("M")
    for i in range((end - start).n + 1):
        m = (start + i).strftime("%Y-%m")
        n, paid = vd.monthly.get((primary, m), (0, 0.0))
        months.append({"month": m, "lines": n, "paid": round(paid, 2), "flaggedLines": flagged_lines.get(m, 0),
                       "flaggedDollars": round(flagged_dollars.get(m, 0.0), 2)})
    events: list[dict] = []
    if primary in vd.enroll:
        events.append({"date": vd.enroll[primary].isoformat(), "type": "ENROLLED", "entity": primary,
                       "label": f"{primary} enrolled"})
    if primary in vd.exclusion:
        events.append({"date": vd.exclusion[primary].isoformat(), "type": "EXCLUDED", "entity": primary,
                       "label": f"{primary} recorded as excluded"})
    for p, _role in d.subjects:
        for inv in vd.investigations.get(p, []):
            events.append({"date": inv["closed"].isoformat(), "type": "INVESTIGATION", "entity": p,
                           "label": f"Earlier investigation {inv['id']} closed: {inv['disposition'].lower()}"})
    for mid in sorted(members_flagged, key=lambda x: (-members_flagged[x], x))[:MAX_MEMBER_NODES]:
        if mid in vd.member_death:
            events.append({"date": vd.member_death[mid].isoformat(), "type": "DEATH", "entity": mid,
                           "label": f"{mid} recorded date of death"})
        for a, b in vd.stays.get(mid, []):
            events.append({"date": a.isoformat(), "type": "STAY", "entity": mid, "label": f"{mid} admitted",
                           "until": b.isoformat()})
    flagged_dates = [h["service_dt"] for h in d.hits]
    if flagged_dates:
        events.append({"date": min(flagged_dates).isoformat(), "type": "FIRST_FLAG", "entity": primary,
                       "label": "First flagged service"})
    signals = []
    for a in d.alerts:
        if a.rule_id == "T-CUSUM" and a.detail:
            events.append({"date": f"{a.detail['onset']}-01", "type": "CHANGE", "entity": a.provider_id,
                           "label": f"{a.detail['label']} began to change"})
            signals.append({"rule": a.rule_id, "metric": a.detail["metric"], "onset": a.detail["onset"],
                            "from": a.detail["from"], "to": a.detail["to"]})
    events.sort(key=lambda e: (e["date"], e["type"], e["entity"]))
    return {"primary": primary, "months": months, "events": events, "signals": signals,
            "trend": {"label": sc.trend, "slope": sc.trend_slope}}
