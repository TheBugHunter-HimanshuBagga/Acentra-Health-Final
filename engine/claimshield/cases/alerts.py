"""Signals to alerts: one alert per (rule, provider, calendar month), lines unioned, score = rule strength.

Dollars are never summed across detectors here; that happens at case level by line union.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

import duckdb
import pandas as pd

from claimshield import reference as ref


@dataclass
class Alert:
    alert_id: str
    rule_id: str
    scheme_type: str
    provider_id: str
    window_start: date
    window_end: date
    score: float
    dollars: float
    n_lines: int
    lines: list[tuple[str, int, float]] = field(default_factory=list)   # (claim_id, line_no, dollars)
    suppressed_by_exception_id: str | None = None
    detail: dict | None = None                  # statistics behind a line-less alert (temporal, infrastructure)


def read_hits(con: duckdb.DuckDBPyConnection) -> list[dict]:
    cols = ["rule_id", "claim_id", "line_no", "member_id", "provider_id", "service_dt", "hcpcs", "paid_amt",
            "dollars", "detail", "flag_role"]
    rows = con.execute(f"SELECT {', '.join(cols)} FROM out_rule_hit ORDER BY rule_id, claim_id, line_no").fetchall()
    out = []
    for r in rows:
        d = dict(zip(cols, r, strict=True))
        for k in ("paid_amt", "dollars"):
            d[k] = float(d[k]) if isinstance(d[k], Decimal) else float(d[k])
        out.append(d)
    return out


def alert_strength(rule_id: str, rows: list[dict]) -> float:
    """Fixed base strength for rules; the largest z-based strength in the group for PEER signals."""
    base = ref.RULES[rule_id][2]
    if rule_id not in ref.PEER_RULES and rule_id not in ref.GRAPH_RULES:
        return base
    return max(json.loads(r["detail"]).get("strength", base) for r in rows)


def build_alerts(hits: list[dict]) -> list[Alert]:
    groups: dict[tuple[str, str, date], list[dict]] = {}
    for h in hits:
        month = h["service_dt"].replace(day=1)
        groups.setdefault((h["rule_id"], h["provider_id"], month), []).append(h)
    alerts: list[Alert] = []
    for i, key in enumerate(sorted(groups), start=1):
        rule_id, provider_id, month = key
        rows = groups[key]
        scheme = ref.RULES[rule_id][0]
        strength = alert_strength(rule_id, rows)
        dates = [r["service_dt"] for r in rows]
        alerts.append(Alert(
            alert_id=f"ALR-{i:06d}", rule_id=rule_id, scheme_type=scheme, provider_id=provider_id,
            window_start=min(dates), window_end=max(dates), score=strength,
            dollars=round(sum(r["dollars"] for r in rows), 2), n_lines=len(rows),
            lines=[(r["claim_id"], r["line_no"], r["dollars"]) for r in rows]))
    return alerts


def renumber(alerts: list[Alert]) -> list[Alert]:
    """Deterministic IDs over the combined alert set (rule, provider, window)."""
    ordered = sorted(alerts, key=lambda a: (a.rule_id, a.provider_id, a.window_start, a.window_end))
    for i, a in enumerate(ordered, start=1):
        a.alert_id = f"ALR-{i:06d}"
    return ordered


FAMILY = {"LINE": "rule", "PEER": "peer", "NETWORK": "graph", "SELF": "temporal"}


def store_alerts(con: duckdb.DuckDBPyConnection, run_id: str, alerts: list[Alert]) -> None:
    con.execute("DELETE FROM out_alert_line")
    con.execute("DELETE FROM out_alert")
    if not alerts:
        return
    a = pd.DataFrame([(x.alert_id, run_id, x.rule_id, ref.RULE_VERSION, FAMILY[ref.CHANNEL_OF[x.rule_id]],
                       x.scheme_type, x.provider_id,
                       x.window_start, x.window_end, x.score, x.dollars,
                       "ESTIMATED" if x.rule_id in ref.ESTIMATED_RULES else "EXACT", x.n_lines,
                       x.suppressed_by_exception_id) for x in alerts],
                     columns=["alert_id", "run_id", "rule_id", "rule_version", "family", "scheme_type",
                              "provider_id", "window_start", "window_end", "score", "dollars", "dollars_basis",
                              "n_lines", "suppressed_by_exception_id"])
    con.register("alerts_df", a)
    con.execute("INSERT INTO out_alert SELECT * FROM alerts_df")
    con.unregister("alerts_df")
    lines = pd.DataFrame([(x.alert_id, c, n, d) for x in alerts for c, n, d in x.lines],
                         columns=["alert_id", "claim_id", "line_no", "dollars"])
    con.register("lines_df", lines)
    con.execute("INSERT INTO out_alert_line SELECT * FROM lines_df")
    con.unregister("lines_df")
