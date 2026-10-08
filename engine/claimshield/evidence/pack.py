"""Evidence pack pk_v1: the closed world an explanation may use (docs/..._AI_Second_Brain.md section 4).

Statements are templates filled from a numbers registry; nothing here is free text from a model.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from claimshield import reference as ref
from claimshield.cases.score import ScoredCase

PACK_VERSION = "pk_v1"
MAX_CLAIM_REFS = 10
MAX_EXAMPLES = 5


@dataclass
class PackContext:
    run_id: str
    asof: date
    provider_info: dict[str, dict]        # provider_id -> {specialty_code, name_syn, enroll_dt}
    hcpcs_label: dict[str, str]
    exclusion_dt: dict[str, date]


def money(v: float) -> str:
    return f"${v:,.2f}"


def _num(value, fmt):
    return {"value": value, "fmt": [fmt]}


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def pack_sha256(pack: dict) -> str:
    body = {k: v for k, v in pack.items() if k != "packSha256"}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


_PLACEHOLDER = re.compile(r"\{\{([A-Za-z0-9_.]+)\}\}")


def render(template: str, numbers: dict) -> str:
    """Substitute {{key}} with numbers[key].fmt[0]. Unknown keys raise (a template bug, not user input)."""
    return _PLACEHOLDER.sub(lambda m: numbers[m.group(1)]["fmt"][0], template)


def default_action_for(sc: ScoredCase) -> str:
    top = sc.hypotheses[0]["code"]
    rule = next(r for r, v in ref.RULES.items() if v[0] == top)
    action = ref.RULES[rule][5]
    allowed = {a["action"] for a in ref.permitted_actions(sc.tier)}
    return action if action in allowed else "REQUEST_RECORDS"


def build_pack(sc: ScoredCase, ctx: PackContext) -> dict:
    d = sc.draft
    numbers: dict[str, dict] = {}
    evidence: list[dict] = []
    codes: set[str] = set()
    entities: set[str] = {p for p, _ in d.subjects}
    dates: set[str] = set()

    # one evidence item per rule that fired, ordered by dollars
    by_rule: dict[str, list[dict]] = defaultdict(list)
    for h in d.hits:
        by_rule[h["rule_id"]].append(h)
    ordered_rules = sorted(by_rule, key=lambda r: (-sum(h["dollars"] for h in by_rule[r]), r))
    for i, rule_id in enumerate(ordered_rules, start=1):
        eid = f"E{i}"
        hs = by_rule[rule_id]
        scheme, name, strength, policy_id, hard, _act = ref.RULES[rule_id]
        dollars = round(sum(h["dollars"] for h in hs), 2)
        numbers[f"{eid}.n"] = _num(len(hs), str(len(hs)))
        numbers[f"{eid}.dollars"] = _num(dollars, money(dollars))
        if rule_id == "R-DME-01":
            numbers[f"{eid}.days"] = _num(ref.DME_VISIT_WINDOW_DAYS, str(ref.DME_VISIT_WINDOW_DAYS))
        template = ref.RULE_TEMPLATE[rule_id].replace("{{EV.", "{{" + eid + ".")
        top = sorted(hs, key=lambda h: (-h["dollars"], h["claim_id"], h["line_no"]))
        examples = [{"claimId": h["claim_id"], "lineNo": h["line_no"], "serviceDt": h["service_dt"].isoformat(),
                     "hcpcs": h["hcpcs"], "dollars": h["dollars"]} for h in top[:MAX_EXAMPLES]]
        for h in hs:
            codes.add(h["hcpcs"])
        for e in examples:
            entities.add(e["claimId"])
            dates.add(e["serviceDt"])
        first, last = min(h["service_dt"] for h in hs), max(h["service_dt"] for h in hs)
        dates |= {first.isoformat(), last.isoformat()}
        evidence.append({
            "id": eid, "type": "rule_hit", "detector": f"{rule_id}@v{ref.RULE_VERSION}", "channel": "LINE",
            "schemeType": scheme, "name": name, "strength": strength, "hardFact": hard, "template": template,
            "statement": render(template, numbers), "dollars": dollars, "lineCount": len(hs),
            "firstServiceDt": first.isoformat(), "lastServiceDt": last.isoformat(),
            "claimRefs": [h["claim_id"] for h in top[:MAX_CLAIM_REFS]], "examples": examples,
            "policyRefs": [policy_id],
        })

    s = {
        "S.risk": _num(round(sc.risk, 4), f"{sc.risk:.2f}"),
        "S.dollars": _num(sc.dollars_exact, money(sc.dollars_exact)),
        "S.members": _num(len(sc.members), str(len(sc.members))),
        "S.severity": _num(round(sc.severity, 4), f"{sc.severity:.2f}"),
        "S.memberImpact": _num(round(sc.member_impact, 4), f"{sc.member_impact:.2f}"),
        "S.evidenceStrength": _num(round(sc.evidence_strength, 4), f"{sc.evidence_strength:.2f}"),
    }
    numbers.update(s)

    cited_policies = sorted({p for e in evidence for p in e["policyRefs"]})
    policies = [{"id": sid, "version": "v1", "title": title, "text": body}
                for sid, _doc, title, body in ref.POLICY_SECTIONS if sid in cited_policies]
    cited_terms = {"R-DUP-01": "GL-DUP", "R-PTP-01": "GL-PTP", "R-MUE-01": "GL-MUE", "R-DME-01": "GL-QV"}
    glossary = [{"id": tid, "term": term, "definition": dfn}
                for tid, term, dfn, _cat in ref.GLOSSARY
                if tid in {cited_terms[r] for r in ordered_rules if r in cited_terms} | {"GL-EXACT", "GL-TIER"}]

    subjects = []
    for pid, role in d.subjects:
        info = ctx.provider_info[pid]
        subjects.append({"id": pid, "role": role, "specialty": info["specialty_code"],
                         "label": f"{info['name_syn']}"})

    timeline = [{"id": "T1", "date": sc.first_service.isoformat(), "text": "First flagged service"},
                {"id": "T2", "date": sc.last_service.isoformat(), "text": "Latest flagged service"}]
    enroll = ctx.provider_info[d.primary]["enroll_dt"]
    timeline.append({"id": "T3", "date": enroll.isoformat(), "text": "Primary subject enrolled"})
    if d.primary in ctx.exclusion_dt:
        timeline.append({"id": "T4", "date": ctx.exclusion_dt[d.primary].isoformat(),
                         "text": "Recorded exclusion date of the primary subject"})
    for t in timeline:
        dates.add(t["date"])
    timeline.sort(key=lambda t: (t["date"], t["id"]))

    limitations = [
        {"id": "L1", "mandatory": True, "text": "All data in this system is synthetic."},
        {"id": "L2", "mandatory": True,
         "text": "This build evaluates deterministic line rules only; peer, trend, network and prediction "
                 "signals are not available yet."},
    ]
    if "R-DME-01" in by_rule:
        limitations.append({"id": "L3", "mandatory": False,
                            "text": "Orders with no ordering provider are not evaluated by the equipment rule."})

    pack = {
        "packVersion": PACK_VERSION, "caseId": d.case_id, "runId": ctx.run_id, "asof": ctx.asof.isoformat(),
        "subjects": subjects,
        "scores": {"risk": "{{S.risk}}", "dollars": "{{S.dollars}}", "tier": sc.tier,
                   "tierReasons": [{"id": f"TR{i}", "text": t} for i, t in enumerate(sc.tier_reasons, start=1)]},
        "evidence": evidence, "numbers": numbers,
        "entities": sorted(entities), "dates": sorted(dates), "codes": sorted(codes),
        "codeLabels": {c: ctx.hcpcs_label[c] for c in sorted(codes)},
        "timeline": timeline, "network": [], "precedents": [], "policies": policies, "glossary": glossary,
        "limitations": limitations,
        "permittedActions": ref.permitted_actions(sc.tier),
        "defaultAction": default_action_for(sc),
        "hypotheses": [h["code"] for h in sc.hypotheses],
        "insufficientEvidenceRequired": sc.tier == "LOW",
        "forbiddenTerms": ref.FORBIDDEN_TERMS,
    }
    pack["packSha256"] = pack_sha256(pack)
    return pack
