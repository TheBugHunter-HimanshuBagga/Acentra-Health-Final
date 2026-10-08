"""Evaluation against synthetic ground truth. This and generate/ are the ONLY modules that open gt.duckdb.

Recall is exact (every injected positive is known). Precision is a LOWER BOUND: any flagged line that is not a
labelled positive is counted as a false positive, though real anomalies in base data would be unlabelled.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

SCHEME_TO_RULE = {"DUP": "R-DUP-01", "PTP": "R-PTP-01", "MUE": "R-MUE-01", "DOD": "R-DOD-01",
                  "EXC": "R-EXCL-01", "DME": "R-DME-01"}


def evaluate(claims_con: duckdb.DuckDBPyConnection, gt_path: Path, hits: list[dict],
             in_capacity_lines: set[tuple[str, int]]) -> dict:
    gt = duckdb.connect(str(gt_path), read_only=True)
    try:
        pos = gt.execute("""SELECT l.claim_id, l.line_no, s.scheme_type FROM gt_claim_label l
                            JOIN gt_scheme s USING (scheme_id) WHERE l.label = 'POSITIVE'""").fetchall()
        decoys = gt.execute("SELECT claim_id, line_no FROM gt_claim_label WHERE label = 'DECOY_NEGATIVE'").fetchall()
    finally:
        gt.close()

    flagged: dict[str, set[tuple[str, int]]] = {r: set() for r in SCHEME_TO_RULE.values()}
    for h in hits:
        flagged[h["rule_id"]].add((h["claim_id"], h["line_no"]))
    positives: dict[str, set[tuple[str, int]]] = {r: set() for r in SCHEME_TO_RULE.values()}
    for cid, ln, st in pos:
        positives[SCHEME_TO_RULE[st]].add((cid, ln))

    rules = []
    for rule in sorted(positives):
        tp = positives[rule] & flagged[rule]
        rules.append({"rule": rule, "positives": len(positives[rule]), "flagged": len(flagged[rule]),
                      "truePositives": len(tp),
                      "recall": round(len(tp) / len(positives[rule]), 4) if positives[rule] else None,
                      "precisionLowerBound": round(len(tp) / len(flagged[rule]), 4) if flagged[rule] else None})

    all_flagged = set().union(*flagged.values())
    decoy_set = {(c, n) for c, n in decoys}

    # dollars coverage: paid dollars of positive lines that sit inside in-capacity cases
    all_pos = set().union(*positives.values())
    if all_pos:
        df = pd.DataFrame(sorted(all_pos), columns=["claim_id", "line_no"])
        claims_con.register("pos_df", df)
        paid = {(c, n): float(p) for c, n, p in claims_con.execute(
            "SELECT l.claim_id, l.line_no, l.paid_amt FROM claim_line l JOIN pos_df p USING (claim_id, line_no)"
        ).fetchall()}
        claims_con.unregister("pos_df")
    else:
        paid = {}
    total = sum(paid.values())
    covered = sum(v for k, v in paid.items() if k in in_capacity_lines)
    return {
        "basis": "synthetic ground truth injected by the generator; not evidence of real-world detection power",
        "rules": rules,
        "decoys": {"lines": len(decoy_set), "falselyFlagged": len(decoy_set & all_flagged)},
        "coverage": {"pct": round(covered / total, 4) if total else None, "positiveDollars": round(total, 2),
                     "dollarsInCapacityCases": round(covered, 2),
                     "basis": "synthetic-ground-truth"},
        "notes": ["Recall is exact; precision is a lower bound.",
                  "M1 evaluates deterministic line rules only; there is no train/validation/test split yet."],
    }
