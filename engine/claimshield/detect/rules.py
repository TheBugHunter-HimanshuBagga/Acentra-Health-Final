"""Deterministic line rules (channel LINE). Each rule is one SQL file under engine/sql/rules/.

This module reads claims.duckdb only. It must never import or open the ground-truth database.
"""

from __future__ import annotations

import duckdb
import pandas as pd

from claimshield import reference as ref
from claimshield.paths import SQL_DIR

RULE_FILES = {
    "R-DUP-01": "r_dup_01.sql",
    "R-PTP-01": "r_ptp_01.sql",
    "R-MUE-01": "r_mue_01.sql",
    "R-DOD-01": "r_dod_01.sql",
    "R-EXCL-01": "r_excl_01.sql",
    "R-DME-01": "r_dme_01.sql",
    "R-TIME-01": "r_time_01.sql",
    "R-GEO-01": "r_geo_01.sql",
    "R-IP-01": "r_ip_01.sql",
}

HIT_COLUMNS = ["rule_id", "claim_id", "line_no", "member_id", "provider_id", "service_dt", "hcpcs",
               "paid_amt", "dollars", "detail", "flag_role"]


def _params(rule_id: str) -> dict:
    if rule_id == "R-PTP-01":
        return {"bypass": list(ref.PTP_BYPASS_MODIFIERS)}
    if rule_id == "R-DME-01":
        return {"days": ref.DME_VISIT_WINDOW_DAYS}
    if rule_id == "R-TIME-01":
        return {"cap": ref.TIME_CAP_MINUTES}
    if rule_id == "R-GEO-01":
        return {"km": ref.GEO_KM, "history": ref.GEO_HISTORY_DAYS}
    return {}


def run_rule(con: duckdb.DuckDBPyConnection, rule_id: str) -> pd.DataFrame:
    sql = (SQL_DIR / "rules" / RULE_FILES[rule_id]).read_text(encoding="utf-8")
    df = con.execute(sql, _params(rule_id)).fetchdf()
    return df[HIT_COLUMNS]


def run_all_rules(con: duckdb.DuckDBPyConnection, store: bool = True, peer: bool = True) -> pd.DataFrame:
    """All SQL line rules, plus (peer=True) the PEER-channel statistical signals, in one hit table."""
    frames = [run_rule(con, r) for r in RULE_FILES]
    if peer:
        from claimshield.detect.peer import run_peer_signals

        frames.append(run_peer_signals(con))
        from claimshield.graph.graph import run_graph_signals

        frames.append(run_graph_signals(con)[0])
    hits = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=HIT_COLUMNS)
    hits = hits.sort_values(["rule_id", "claim_id", "line_no"]).reset_index(drop=True)
    if store:
        con.execute("DELETE FROM out_rule_hit")
        if len(hits):
            con.register("hits_df", hits)
            con.execute("INSERT INTO out_rule_hit SELECT * FROM hits_df")
            con.unregister("hits_df")
    return hits
