"""Governed exception rules: a closed, bounded condition language. There is no free-form logic, so there is nothing to
inject. A deterministic miner drafts an exception from a rejected case; a human governs it; the engine applies it.

An exception can never touch a hard-fact rule, and it can only DOWNGRADE_TO_MONITOR or SUPPRESS_ALERT: it can never
raise a tier or create an alert.
"""

from __future__ import annotations

import operator
from dataclasses import dataclass, field

from claimshield import reference as ref

NON_EXEMPTABLE = {"R-EXCL-01", "R-DOD-01", "R-IP-01", "R-DUP-01", "R-PTP-01", "R-MUE-01", "R-GEO-01"}
EXCEPTION_ELIGIBLE = {"LEGIT_CLINICAL_PATTERN", "LEGIT_SHARED_BUILDING", "LEGIT_RURAL_ACCESS", "LEGIT_HIGH_ACUITY"}
CATALOGUE = {   # reason code -> features the exception may reference
    "LEGIT_CLINICAL_PATTERN": ["lines_per_member", "visits_per_member_month"],
    "LEGIT_SHARED_BUILDING": ["building_unrelated_owner_count", "referral_top3_share"],
    "LEGIT_RURAL_ACCESS": ["mean_member_km", "is_sole_provider_county"],
    "LEGIT_HIGH_ACUITY": ["acuity_mean", "em_high_share"],
}
ALLOWED_FIELDS = {f for fs in CATALOGUE.values() for f in fs} | {"hard_fact_alert_count"}
LOWER_BOUND = {"mean_member_km", "is_sole_provider_county", "acuity_mean", "building_unrelated_owner_count"}
OPS = {"<=": operator.le, ">=": operator.ge, "==": operator.eq, "<": operator.lt, ">": operator.gt}
EFFECTS = {"DOWNGRADE_TO_MONITOR", "SUPPRESS_ALERT"}
BREADTH_WARN = 0.30
REVIEW_DAYS = 90


@dataclass
class ExceptionRule:
    exc_id: str
    version: int
    scope: dict                       # {"rule_ids": [...], "specialty_code": str | None}
    condition: list[dict]             # [{"field", "op", "value"}]
    effect: str
    support_n: int = 1
    flags: list[str] = field(default_factory=list)
    review_due: str | None = None

    def to_dict(self) -> dict:
        return {"excId": self.exc_id, "version": self.version, "scope": self.scope, "condition": self.condition,
                "effect": self.effect, "supportN": self.support_n, "flags": self.flags, "reviewDue": self.review_due}

    @staticmethod
    def from_dict(d: dict) -> ExceptionRule:
        return ExceptionRule(d["excId"], int(d.get("version", 1)), d["scope"], d["condition"], d["effect"],
                             int(d.get("supportN", 1)), list(d.get("flags", [])), d.get("reviewDue"))


# approved before the first run: shared-building providers are not a finding by themselves (decoy D2)
SEED_EXCEPTIONS = [
    ExceptionRule("EXC-0001", 1, {"rule_ids": ["G-INFRA"], "specialty_code": None},
                  [{"field": "building_unrelated_owner_count", "op": ">=", "value": 3},
                   {"field": "referral_top3_share", "op": "<=", "value": 0.5},
                   {"field": "hard_fact_alert_count", "op": "==", "value": 0}],
                  "DOWNGRADE_TO_MONITOR", support_n=2, review_due="2026-01-01"),
]


def validate(rule: ExceptionRule) -> list[str]:
    """Structural errors in a draft (empty list = a well-formed rule)."""
    errs = []
    if rule.effect not in EFFECTS:
        errs.append(f"unknown effect {rule.effect}")
    if not rule.scope.get("rule_ids"):
        errs.append("scope needs at least one rule")
    touched = set(rule.scope.get("rule_ids", [])) & NON_EXEMPTABLE
    if touched:
        errs.append("hard-fact rules cannot be excepted: " + ", ".join(sorted(touched)))
    unknown = set(rule.scope.get("rule_ids", [])) - set(ref.RULES)
    if unknown:
        errs.append("unknown rules: " + ", ".join(sorted(unknown)))
    for c in rule.condition:
        if c.get("field") not in ALLOWED_FIELDS:
            errs.append(f"field {c.get('field')} is not in the catalogue")
        if c.get("op") not in OPS:
            errs.append(f"operator {c.get('op')} is not allowed")
        if not isinstance(c.get("value"), (int, float)) or isinstance(c.get("value"), bool):
            errs.append(f"condition on {c.get('field')} needs a number")
    if not any(c.get("field") == "hard_fact_alert_count" for c in rule.condition):
        errs.append("the hard_fact_alert_count == 0 condition is mandatory")
    return errs


def holds(rule: ExceptionRule, pf: dict[str, float]) -> bool:
    return all(OPS[c["op"]](pf.get(c["field"], 0.0), c["value"]) for c in rule.condition)


def matches(rule: ExceptionRule, rule_id: str, specialty: str, pf: dict[str, float]) -> bool:
    if rule_id not in rule.scope["rule_ids"]:
        return False
    want = rule.scope.get("specialty_code")
    return (want is None or want == specialty) and holds(rule, pf)


def apply(alerts: list, pfeat: dict[str, dict[str, float]], spec_of: dict[str, str],
          rules: list[ExceptionRule]) -> dict[str, list]:
    """Marks alerts as suppressed by the first matching exception (ordered by id). Returns excId -> alerts."""
    hard: dict[str, int] = {}
    for a in alerts:
        if a.rule_id in ref.HARD_FACT_RULES:
            hard[a.provider_id] = hard.get(a.provider_id, 0) + 1
    for p, f in pfeat.items():
        f["hard_fact_alert_count"] = float(hard.get(p, 0))
    hit: dict[str, list] = {}
    for a in alerts:
        a.suppressed_by_exception_id = None
        for r in sorted(rules, key=lambda x: (x.exc_id, x.version)):
            if matches(r, a.rule_id, spec_of[a.provider_id], pfeat[a.provider_id]):
                a.suppressed_by_exception_id = r.exc_id
                hit.setdefault(r.exc_id, []).append(a)
                break
    return hit


def propose(*, case_id: str, provider: str, specialty: str, rule_ids: list[str], reason_code: str,
            pf: dict[str, float], support_n: int, source_precedent_id: str | None, exc_id: str) -> ExceptionRule:
    """Draft an exception from a rejected case. Raises ValueError when the case is not eligible."""
    if reason_code not in EXCEPTION_ELIGIBLE:
        raise ValueError(f"reason code {reason_code} is not eligible for an exception")
    hard = [r for r in rule_ids if r in NON_EXEMPTABLE]
    if hard:
        raise ValueError("the case carries hard-fact alerts (" + ", ".join(sorted(hard)) + "); they cannot be excepted")
    scope_rules = sorted(set(rule_ids))
    conds = []
    for f in CATALOGUE[reason_code]:
        # a band around the observed value ("providers that look like this one"), never an open-ended limit
        v = float(pf.get(f, 0.0))
        lo, hi = (0.9, 1.25) if f in LOWER_BOUND else (0.8, 1.1)
        conds.append({"field": f, "op": ">=", "value": round(v * lo, 4)})
        conds.append({"field": f, "op": "<=", "value": round(v * hi + 1e-9, 4)})
    conds.append({"field": "hard_fact_alert_count", "op": "==", "value": 0})
    flags = ["LOW_SUPPORT"] if support_n < 2 else []
    return ExceptionRule(exc_id, 1, {"rule_ids": scope_rules, "specialty_code": specialty}, conds,
                         "DOWNGRADE_TO_MONITOR", support_n=support_n, flags=flags)


def lint(rule: ExceptionRule, *, confirmed_conflicts: list[str], breadth: float, hard_touches: int,
         gt_lost: int | None) -> dict:
    """BLOCK cannot be approved; WARN is shown to the approver; PASS has no reasons."""
    block, warn = [], []
    errs = validate(rule)
    block += errs
    if hard_touches:
        block.append(f"it would suppress {hard_touches} hard-fact alerts")
    if confirmed_conflicts:
        block.append("it matches providers similar to confirmed precedents: " + ", ".join(confirmed_conflicts[:5]))
    if gt_lost:
        block.append(f"demo check: it would hide {gt_lost} lines that were injected as real schemes")
    if breadth > BREADTH_WARN:
        warn.append(f"it affects {breadth:.0%} of the specialty's providers")
    if "LOW_SUPPORT" in rule.flags or rule.support_n < 2:
        warn.append("only one precedent supports it")
    return {"verdict": "BLOCK" if block else ("WARN" if warn else "PASS"), "reasons": block + warn}
