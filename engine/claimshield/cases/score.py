"""Case scoring, confidence tier and queue inputs (docs/ClaimShield_Nexus_Intelligence_Engine.md section 7).

M1 has one evidence channel (LINE) and no prediction, so: risk_30 = risk_60 = risk_90 = risk_signal.
Weights are design judgements, not statistics; they are frozen in this file.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

import numpy as np

from claimshield import reference as ref
from claimshield.cases.consolidate import CaseDraft

CHANNEL_WEIGHT = {"LINE": 0.85, "PEER": 0.60, "SELF": 0.50, "NETWORK": 0.70}
CORROBORATION = {0: 0.0, 1: 0.25, 2: 0.60, 3: 0.85, 4: 1.0}
TIER_MULT = {"HIGH": 1.0, "MEDIUM": 0.75}
UTILITY_W = {"risk": 0.30, "dollar": 0.20, "member": 0.15, "severity": 0.15, "evidence": 0.20}


# ---- pure functions (unit-tested) ----------------------------------------------------------------------------
def risk_signal(channels: dict[str, float]) -> float:
    """Noisy-OR across independent channels: one weak channel cannot saturate."""
    p = 1.0
    for c, s in channels.items():
        p *= 1.0 - CHANNEL_WEIGHT[c] * s
    return 1.0 - p


def evidence_strength(channels: dict[str, float], hard_fact: bool, months_with_alerts: int,
                      precedent_fit: float = 0.0, has_precedent: bool = False,
                      inadequate: bool = False) -> float:
    n_ch = sum(1 for s in channels.values() if s >= 0.3)
    c = CORROBORATION[n_ch]
    d = 1.0 if hard_fact else 0.0
    x = min(1.0, months_with_alerts / 3)
    p = (precedent_fit + 1) / 2 if has_precedent else 0.5
    es = 0.45 * c + 0.25 * d + 0.20 * x + 0.10 * p
    return es * 0.70 if inadequate else es


def decide_tier(channels: dict[str, float], hard_fact: bool, es: float, hard_direct_dollars: float = 0.0,
                precedent_fit: float = 0.0, unfounded_matches: int = 0, exception_id: str | None = None,
                low_peer: bool = False) -> tuple[str, list[str]]:
    """Ordered rules, first match wins. Returns (tier, reasons)."""
    on = [c for c, s in channels.items() if s >= 0.3]
    n_ch = len(on)
    if exception_id:
        return "LOW", [f"An approved exception ({exception_id}) matches this case"]
    if hard_direct_dollars >= ref.DOLLAR_MIN_HARD_FACT:
        return "HIGH", [f"Direct recorded fact on exact dollars ({hard_direct_dollars:,.2f})"]
    if precedent_fit <= -0.5 and unfounded_matches >= 2:
        return "LOW", ["Similar earlier cases were closed unfounded"]
    if (n_ch == 1 and on[0] in ("PEER", "SELF")) or es < 0.35 or (low_peer and n_ch == 1):
        why = []
        if es < 0.35:
            why.append(f"Evidence strength {es:.2f} is below 0.35")
        if n_ch == 1 and on[0] in ("PEER", "SELF"):
            why.append("Only a statistical signal is present")
        if low_peer and n_ch == 1:
            why.append("Peer group too small for a single-channel signal")
        return "LOW", why
    if (n_ch >= 3 or (n_ch >= 2 and hard_fact)) and es >= 0.65 and precedent_fit > -0.25:
        return "HIGH", [f"{n_ch} independent channels with strong evidence ({es:.2f})"]
    why = [f"{n_ch} independent evidence channel(s): {', '.join(on) or 'none'}",
           f"Evidence strength {es:.2f}"]
    if not hard_fact:
        why.append("No deterministic exact-fact rule fired")
    if n_ch < 2:
        why.append("Fewer than two independent channels, so not HIGH")
    return "MEDIUM", why


def est_hours(n_subjects: int, n_lines: int, n_hypotheses: int) -> float:
    return float(np.clip(4 + 1.5 * n_subjects + 0.5 * math.ceil(n_lines / 50) + 3 * (n_hypotheses - 1), 4, 40))


def trend_label(monthly: dict[date, float], asof: date) -> str | None:
    """ESCALATING / STABLE / DECLINING from the last 3 months vs the prior 3. Needs >= 2 months with alerts."""
    if sum(1 for v in monthly.values() if v > 0) < 2:
        return None

    def span(offset: int) -> float:
        tot = 0.0
        for k in range(offset, offset + 3):
            y, m = asof.year, asof.month - k
            while m <= 0:
                y, m = y - 1, m + 12
            tot += monthly.get(date(y, m, 1), 0.0)
        return tot

    last, prior = span(0), span(3)
    if last > 0 and (prior == 0 or last >= 1.25 * prior):
        return "ESCALATING"
    if prior > 0 and last <= 0.8 * prior:
        return "DECLINING"
    return "STABLE"


# ---- case scoring ----------------------------------------------------------------------------------------------
@dataclass
class ScoredCase:
    draft: CaseDraft
    tier: str
    tier_reasons: list[str]
    channels: dict[str, float]
    risk: float
    dollar_score: float
    dollars_exact: float
    member_impact: float
    severity: float
    evidence_strength: float
    precedent_fit: float
    est_hours: float
    utility: float
    trend: str | None
    hypotheses: list[dict]                    # [{code, text, dollars}] by dollars desc
    members: list[str]
    line_dollars: dict[tuple[str, int], float]
    line_rule: dict[tuple[str, int], str]
    months_with_alerts: int
    hard_fact: bool
    fv: list[float]
    first_service: date
    last_service: date
    raise_conf: list[str] = field(default_factory=list)


def score_drafts(drafts: list[CaseDraft], *, acuity: dict[str, float], enroll: dict[str, date],
                 provider_lines: dict[str, int], asof: date) -> list[ScoredCase]:
    raw = []
    for d in drafts:
        line_dollars: dict[tuple[str, int], float] = {}
        line_rule: dict[tuple[str, int], str] = {}
        for h in d.hits:
            k = (h["claim_id"], h["line_no"])
            if h["dollars"] >= line_dollars.get(k, -1.0):
                line_dollars[k] = h["dollars"]
                line_rule[k] = h["rule_id"]
        dollars = round(sum(line_dollars.values()), 2)
        members = sorted({h["member_id"] for h in d.hits})
        by_scheme: dict[str, float] = defaultdict(float)
        for a in d.alerts:
            by_scheme[a.scheme_type] += a.dollars
        hyps = [{"code": s, "text": ref.HYPOTHESIS_TEXT[s], "dollars": round(v, 2)}
                for s, v in sorted(by_scheme.items(), key=lambda kv: (-kv[1], kv[0]))]
        line_strength = max(a.score for a in d.alerts)
        channels = {"LINE": line_strength, "PEER": 0.0, "SELF": 0.0, "NETWORK": 0.0}
        rules_hit = {h["rule_id"] for h in d.hits}
        hard_fact = bool(rules_hit & ref.HARD_FACT_RULES)
        direct = sum(v for k, v in line_dollars.items() if line_rule[k] in ("R-EXCL-01", "R-DOD-01"))
        months = {a.window_start.replace(day=1) for a in d.alerts}
        monthly: dict[date, float] = defaultdict(float)
        for a in d.alerts:
            monthly[a.window_start.replace(day=1)] += a.dollars
        es = evidence_strength(channels, hard_fact, len(months))
        tier, reasons = decide_tier(channels, hard_fact, es, hard_direct_dollars=direct)
        sev = max(ref.SCHEME_WEIGHTS[h["code"]][0] for h in hyps)
        harm = max(ref.SCHEME_WEIGHTS[h["code"]][1] for h in hyps)
        n_m = len(members)
        member_impact = (1 - math.exp(-n_m / 25)) * (0.4 + 0.6 * harm)
        rsig = risk_signal(channels)
        n_lines_p = max(1, provider_lines.get(d.primary, 1))
        by_rule_p = defaultdict(int)
        for h in d.hits:
            if h["provider_id"] == d.primary:
                by_rule_p[h["rule_id"]] += 1
        tenure = max(0, (asof - enroll[d.primary]).days / 30.4)
        fv = [0.0, 0.0, by_rule_p["R-DUP-01"] / n_lines_p, by_rule_p["R-PTP-01"] / n_lines_p,
              by_rule_p["R-MUE-01"] / n_lines_p, 0.0, 0.0, 0.0, min(1.0, tenure / 120),
              math.log1p(dollars), float(sum(1 for s in channels.values() if s >= 0.3)),
              float(np.mean([acuity[m] for m in members])) if members else 0.0]
        raise_conf = []
        if tier == "LOW":
            if not hard_fact:
                raise_conf.append("A deterministic exact-fact rule hit (none fired)")
            if len(months) < 3:
                raise_conf.append(f"Signals in at least 3 different months (seen in {len(months)})")
            raise_conf.append("A second independent evidence channel (peer, trend or network signals are not "
                              "available in this build)")
        raw.append((d, line_dollars, line_rule, dollars, members, hyps, channels, es, tier, reasons, sev,
                    member_impact, rsig, monthly, months, hard_fact, fv, raise_conf))

    d_ref = float(np.percentile([r[3] for r in raw], 95)) if raw else 1.0
    d_ref = d_ref if d_ref > 0 else 1.0
    out: list[ScoredCase] = []
    for (d, ld, lr, dollars, members, hyps, channels, es, tier, reasons, sev, mi, rsig, monthly, months,
         hard_fact, fv, raise_conf) in raw:
        dscore = float(np.clip(math.log1p(dollars) / math.log1p(d_ref), 0, 1))
        util = (UTILITY_W["risk"] * rsig + UTILITY_W["dollar"] * dscore + UTILITY_W["member"] * mi
                + UTILITY_W["severity"] * sev + UTILITY_W["evidence"] * es) * TIER_MULT.get(tier, 0.0)
        dts = [h["service_dt"] for h in d.hits]
        out.append(ScoredCase(
            draft=d, tier=tier, tier_reasons=reasons, channels=channels, risk=rsig, dollar_score=dscore,
            dollars_exact=dollars, member_impact=mi, severity=sev, evidence_strength=es, precedent_fit=0.0,
            est_hours=est_hours(len(d.subjects), len(ld), len(hyps)), utility=util,
            trend=trend_label(dict(monthly), asof), hypotheses=hyps, members=members, line_dollars=ld,
            line_rule=lr, months_with_alerts=len(months), hard_fact=hard_fact, fv=fv,
            first_service=min(dts), last_service=max(dts), raise_conf=raise_conf))
    return out


def pack_first_fit(items: list[tuple[str, float, float]], capacity_hours: float) -> dict[str, bool]:
    """items = [(id, utility, est_hours)]. Rank by utility; take a case if it fits, else defer (a smaller later
    case can still fit). Mirrors the gateway's queue packing."""
    remaining, out = capacity_hours, {}
    for cid, _u, hrs in sorted(items, key=lambda t: (-t[1], t[0])):
        if hrs <= remaining:
            out[cid] = True
            remaining -= hrs
        else:
            out[cid] = False
    return out
