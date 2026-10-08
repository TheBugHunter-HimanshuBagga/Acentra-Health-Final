"""Evaluation against synthetic ground truth. This and generate/ are the ONLY modules that open gt.duckdb.

Recall is exact (every injected positive is known). Precision is a LOWER BOUND: any flagged line that is not a
labelled positive is counted as a false positive, though real anomalies in base data would be unlabelled.

Peer signals (PEER channel) evaluate only the last months of the data, so their line recall is measured over
positives inside that window; their headline number is provider recall (was the scheme provider flagged at all).
Decoy providers D1-D4 are not scored for recall: the question is whether they are flagged and how far they get
(they must never reach HIGH).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import duckdb
import pandas as pd

from claimshield import reference as ref
from claimshield.detect.peer import monthly_cutoff

SCHEME_TO_RULE = {"DUP": "R-DUP-01", "PTP": "R-PTP-01", "MUE": "R-MUE-01", "DOD": "R-DOD-01",
                  "EXC": "R-EXCL-01", "DME": "R-DME-01", "TMA": "R-TIME-01", "TMB": "R-GEO-01",
                  "PHB": "R-IP-01", "UPC": "S-UPC", "UTL": "S-UTL", "PHC": "S-GHOST", "RNG": "G-OWNREF"}
WINDOWED = ref.PEER_RULES | {"G-OWNREF", "G-LOOP", "G-REFCONC"}      # evaluated on the last months of data only
TIER_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


def _network_eval(claims_con, pos, provider_case: dict[str, str]) -> dict:
    """Ring recovery: are all providers of the injected ring in ONE case, and how many cases does the ring span?"""
    ring_lines = [(c, n) for c, n, st in pos if st == "RNG"]
    if not ring_lines:
        return {"ringProviders": [], "ringRecovered": None, "casesPerRing": None}
    df = pd.DataFrame(ring_lines, columns=["claim_id", "line_no"])
    claims_con.register("ring_df", df)
    provs = sorted({r[0] for r in claims_con.execute(
        "SELECT DISTINCT l.rendering_provider_id FROM claim_line l "
        "JOIN ring_df r USING (claim_id, line_no)").fetchall()})
    claims_con.unregister("ring_df")
    cases = {provider_case.get(p) for p in provs}
    return {"ringProviders": provs, "ringRecovered": len(cases) == 1 and None not in cases,
            "casesPerRing": len({c for c in cases if c})}


def _temporal_eval(claims_con, pos, when) -> dict:
    """Detection delay of the own-history signal (months from the scheme start to the first alarm) and false alarms on
    providers that carry no scheme and no decoy, per 1,000 provider-months."""
    from claimshield.detect.temporal import first_cusum_alarms

    first = first_cusum_alarms(claims_con)
    onset: dict[str, str] = {}
    df = pd.DataFrame(sorted({(c, n) for c, n, _ in pos}), columns=["claim_id", "line_no"])
    claims_con.register("pos_df2", df)
    for p, d in claims_con.execute("""SELECT l.rendering_provider_id, MIN(l.service_dt) FROM claim_line l
                                     JOIN pos_df2 USING (claim_id, line_no) GROUP BY 1""").fetchall():
        onset[p] = d.strftime("%Y-%m")
    claims_con.unregister("pos_df2")
    delays = []
    for p, o in sorted(onset.items()):
        if p in first:
            delays.append({"provider": p, "onset": o, "firstAlarm": first[p],
                           "delayMonths": _month_diff(o, first[p])})
    n_months = claims_con.execute("SELECT COUNT(DISTINCT rendering_provider_id || strftime(service_dt, '%Y-%m')) "
                                  "FROM claim_line").fetchone()[0]
    normal_months = max(1, n_months - sum(1 for _ in onset) * 24)
    false = sorted(p for p in first if p not in onset)
    delays_only = sorted(d["delayMonths"] for d in delays)
    return {"detected": len(delays), "schemeProviders": len(onset), "delays": delays,
            "medianDelayMonths": delays_only[len(delays_only) // 2] if delays_only else None,
            "providersWithFalseAlarm": false, "falseAlarmsPer1000ProviderMonths":
                round(1000 * len(false) / normal_months, 2)}


def _month_diff(a: str, b: str) -> int:
    ya, ma = int(a[:4]), int(a[5:])
    yb, mb = int(b[:4]), int(b[5:])
    return (yb - ya) * 12 + (mb - ma)


def evaluate(claims_con: duckdb.DuckDBPyConnection, gt_path: Path, hits: list[dict],
             in_capacity_lines: set[tuple[str, int]], provider_tier: dict[str, str] | None = None,
             provider_case: dict[str, str] | None = None, alerts: list | None = None) -> dict:
    provider_tier = provider_tier or {}
    provider_case = provider_case or {}
    gt = duckdb.connect(str(gt_path), read_only=True)
    try:
        pos = gt.execute("""SELECT l.claim_id, l.line_no, s.scheme_type FROM gt_claim_label l
                            JOIN gt_scheme s USING (scheme_id) WHERE l.label = 'POSITIVE'""").fetchall()
        decoys = gt.execute("SELECT claim_id, line_no FROM gt_claim_label WHERE label = 'DECOY_NEGATIVE'").fetchall()
        schemes = gt.execute("SELECT scheme_id, scheme_type, subject_provider_id FROM gt_scheme "
                             "WHERE kind = 'SCHEME' ORDER BY scheme_id").fetchall()
        decoy_prov = gt.execute("""SELECT s.scheme_id, s.scheme_type, d.provider_id FROM gt_scheme s
                                   JOIN gt_decoy_provider d USING (scheme_id)
                                   ORDER BY s.scheme_id, d.provider_id""").fetchall()
    finally:
        gt.close()

    flagged: dict[str, set[tuple[str, int]]] = {r: set() for r in ref.RULES}
    flagged_providers: dict[str, set[str]] = {r: set() for r in ref.RULES}
    any_flag_provider: dict[str, set[str]] = {}
    for h in hits:
        flagged[h["rule_id"]].add((h["claim_id"], h["line_no"]))
        flagged_providers[h["rule_id"]].add(h["provider_id"])
        any_flag_provider.setdefault(h["provider_id"], set()).add(h["rule_id"])
    for a in alerts or []:                                # alerts without lines (group and own-history signals)
        if a.n_lines == 0:
            flagged_providers[a.rule_id].add(a.provider_id)
            any_flag_provider.setdefault(a.provider_id, set()).add(a.rule_id)

    # service dates of the positives (peer rules only count positives inside the evaluated window)
    cutoff: date = monthly_cutoff()
    all_pos = {(c, n) for c, n, _ in pos}
    paid: dict[tuple[str, int], float] = {}
    when: dict[tuple[str, int], date] = {}
    if all_pos:
        df = pd.DataFrame(sorted(all_pos), columns=["claim_id", "line_no"])
        claims_con.register("pos_df", df)
        for c, n, p, d in claims_con.execute(
                "SELECT l.claim_id, l.line_no, l.paid_amt, l.service_dt FROM claim_line l "
                "JOIN pos_df p USING (claim_id, line_no)").fetchall():
            paid[(c, n)] = float(p)
            when[(c, n)] = d
        claims_con.unregister("pos_df")

    positives: dict[str, set[tuple[str, int]]] = {r: set() for r in SCHEME_TO_RULE.values()}
    for cid, ln, st in pos:
        rule = SCHEME_TO_RULE[st]
        if rule in WINDOWED and when[(cid, ln)] < cutoff:
            continue
        positives[rule].add((cid, ln))

    rules = []
    for rule in sorted(positives):
        tp = positives[rule] & flagged[rule]
        rules.append({"rule": rule, "channel": ref.CHANNEL_OF[rule], "positives": len(positives[rule]),
                      "flagged": len(flagged[rule]), "truePositives": len(tp),
                      "recall": round(len(tp) / len(positives[rule]), 4) if positives[rule] else None,
                      "precisionLowerBound": round(len(tp) / len(flagged[rule]), 4) if flagged[rule] else None})

    scheme_rows = []
    for sid, st, prov in schemes:
        rule = SCHEME_TO_RULE.get(st)
        if rule is None:
            continue
        scheme_rows.append({"scheme": sid, "type": st, "provider": prov, "rule": rule,
                            "flagged": prov in flagged_providers[rule], "tier": provider_tier.get(prov)})

    decoy_rows = []
    by_scheme: dict[str, dict] = {}
    for sid, dtype, prov in decoy_prov:
        r = by_scheme.setdefault(sid, {"scheme": sid, "type": dtype, "providers": [], "flaggedBy": set(),
                                       "bestTier": None})
        r["providers"].append(prov)
        r["flaggedBy"] |= any_flag_provider.get(prov, set())
        t = provider_tier.get(prov)
        if t and TIER_RANK[t] > TIER_RANK.get(r["bestTier"] or "", 0):
            r["bestTier"] = t
    for r in by_scheme.values():
        r["flaggedBy"] = sorted(r["flaggedBy"])
        r["flagged"] = bool(r["flaggedBy"])
        r["reachedHigh"] = r["bestTier"] == "HIGH"
        r["opensCase"] = r["bestTier"] in ("HIGH", "MEDIUM")
        decoy_rows.append(r)

    network = _network_eval(claims_con, pos, provider_case)
    temporal = _temporal_eval(claims_con, pos, when)
    all_flagged = set().union(*flagged.values())
    decoy_set = {(c, n) for c, n in decoys}

    # dollars coverage: paid dollars of positive lines that sit inside in-capacity cases
    total = sum(paid.values())
    covered = sum(v for k, v in paid.items() if k in in_capacity_lines)
    return {
        "basis": "synthetic ground truth injected by the generator; not evidence of real-world detection power",
        "rules": rules,
        "schemes": scheme_rows,
        "decoyProviders": decoy_rows,
        "network": network,
        "temporal": temporal,
        "decoys": {"lines": len(decoy_set), "falselyFlagged": len(decoy_set & all_flagged)},
        "coverage": {"pct": round(covered / total, 4) if total else None, "positiveDollars": round(total, 2),
                     "dollarsInCapacityCases": round(covered, 2),
                     "basis": "synthetic-ground-truth"},
        "notes": ["Recall is exact; precision is a lower bound.",
                  "Peer signals are scored on the last months of data only; provider recall is their headline.",
                  "Decoy providers D1-D4 are expected to be flagged by peer statistics; they must never reach HIGH. "
                  "Decoy D2 (shared buildings) has no detector until the graph work.",
                  "There is no train/validation/test split yet."],
    }


def positive_lines_among(gt_path: Path, lines: set[tuple[str, int]]) -> int:
    """Demo environment only: how many of these lines were injected as real scheme lines."""
    gt = duckdb.connect(str(gt_path), read_only=True)
    try:
        pos = {(c, n) for c, n in gt.execute(
            "SELECT claim_id, line_no FROM gt_claim_label WHERE label = 'POSITIVE'").fetchall()}
    finally:
        gt.close()
    return len(lines & pos)
