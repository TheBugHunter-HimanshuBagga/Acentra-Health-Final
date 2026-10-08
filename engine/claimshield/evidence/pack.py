"""Evidence pack pk_v1: the closed world an explanation may use (docs/..._AI_Second_Brain.md section 4).

Statements are templates filled from a numbers registry; nothing here is free text from a model.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from claimshield import reference as ref
from claimshield.brain import precedents as prec
from claimshield.cases.score import ScoredCase
from claimshield.evidence import insight

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
    # context for the impact and confidence sections (empty when a dataset lacks it)
    member_region: dict[str, int] = field(default_factory=dict)
    provider_region: dict[str, int] = field(default_factory=dict)
    provider_rural: dict[str, bool] = field(default_factory=dict)
    provider_facility: dict[str, list[str]] = field(default_factory=dict)
    hcpcs_family: dict[str, str] = field(default_factory=dict)
    member_acuity: dict[str, float] = field(default_factory=dict)
    mean_acuity: float = 0.0


CHANNEL_ORDER = {"LINE": 0, "NETWORK": 1, "PEER": 2, "SELF": 3}
EVIDENCE_TYPE = {"LINE": "rule_hit", "PEER": "peer_stat", "NETWORK": "graph_stat", "SELF": "temporal_stat"}
LINK_TEXT = {"owner": "a control owner", "phone": "a phone number", "address": "a building", "facility": "a facility"}


def _pct(v: float) -> str:
    return f"{v * 100:.0f}%"


def _times(v: float) -> str:
    return f"{v:.1f} times"


def _and(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _metric_fmt(metric: str, v: float) -> str:
    return _pct(v) if metric == "em_high_share" else money(v) if metric == "paid_per_member" else f"{v:.1f}"


def _signal_numbers(numbers: dict, eid: str, rule_id: str, st: dict) -> dict[str, str]:
    """Registry numbers a statement may quote (from the latest evaluated month) and the literal words that fill
    {{LITERAL}} slots in its template. Statements never contain a number that is not in the registry."""
    lit: dict[str, str] = {}
    if rule_id == "S-UPC":
        numbers[f"{eid}.share"] = _num(st["share"], _pct(st["share"]))
        numbers[f"{eid}.peer"] = _num(st["peer"], _pct(st["peer"]))
        numbers[f"{eid}.acuity"] = _num(st["acuity"], f"{st['acuity']:.2f}")
        numbers[f"{eid}.peerAcuity"] = _num(st["peerAcuity"], f"{st['peerAcuity']:.2f}")
    elif rule_id == "S-UTL":
        numbers[f"{eid}.lpm"] = _num(st["lpm"], f"{st['lpm']:.1f}")
        numbers[f"{eid}.peer"] = _num(st["peer"], f"{st['peer']:.1f}")
    elif rule_id == "S-GHOST":
        numbers[f"{eid}.share"] = _num(st["share"], _pct(st["share"]))
        numbers[f"{eid}.peer"] = _num(st["peer"], _pct(st["peer"]))
        numbers[f"{eid}.months"] = _num(st["months"], str(st["months"]))
    elif rule_id == "S-DIST":
        numbers[f"{eid}.km"] = _num(st["km"], f"{st['km']:.0f}")
        numbers[f"{eid}.peer"] = _num(st["peer"], f"{st['peer']:.0f}")
    elif rule_id == "G-OWNREF":
        numbers[f"{eid}.share"] = _num(st["share"], _pct(st["share"]))
        numbers[f"{eid}.referrals"] = _num(st["referrals"], str(st["referrals"]))
        numbers[f"{eid}.members"] = _num(st["members"], str(st["members"]))
    elif rule_id == "G-LOOP":
        numbers[f"{eid}.cycles"] = _num(st["cycles"], str(st["cycles"]))
        numbers[f"{eid}.length"] = _num(st["length"], str(st["length"]))
    elif rule_id == "G-REFCONC":
        numbers[f"{eid}.share"] = _num(st["share"], _pct(st["share"]))
        numbers[f"{eid}.referrers"] = _num(st["referrers"], str(st["referrers"]))
        numbers[f"{eid}.peer"] = _num(st["peer"], _pct(st["peer"]))
    elif rule_id == "G-INFRA":
        numbers[f"{eid}.members"] = _num(st["members"], str(st["members"]))
        lit["LINKS"] = _and([LINK_TEXT[k] for k in st["links"]])
    elif rule_id == "T-CUSUM":
        numbers[f"{eid}.from"] = _num(st["from"], _metric_fmt(st["metric"], st["from"]))
        numbers[f"{eid}.to"] = _num(st["to"], _metric_fmt(st["metric"], st["to"]))
        numbers[f"{eid}.months"] = _num(st["months"], str(st["months"]))
        lit["METRIC"] = st["label"]
    elif rule_id == "T-GROWTH":
        numbers[f"{eid}.ratio"] = _num(st["ratio"], _times(st["ratio"]))
        numbers[f"{eid}.peer"] = _num(st["peer"], _times(st["peer"]))
    elif rule_id == "T-RAMP":
        numbers[f"{eid}.tenure"] = _num(st["tenure"], str(st["tenure"]))
        numbers[f"{eid}.ratio"] = _num(st["ratio"], _times(st["ratio"]))
    if "peers" in st:
        numbers[f"{eid}.peers"] = _num(st["peers"], str(st["peers"]))
    return lit


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


def _network_entry(k: int, eid: str, rule_id: str, st: dict, numbers: dict, entities: set[str]) -> dict:
    """A relationship fact about the case (who is linked to whom), with its own registry numbers."""
    nid = f"N{k}"
    members = st.get("group") or []
    entities.update(members)
    entities.update(st.get("top3", []))
    if rule_id == "G-OWNREF":
        numbers[f"{nid}.share"] = _num(st["share"], _pct(st["share"]))
        text = _and(members) + " are under one control owner and {{" + nid + ".share}} of the referral dollars " \
            "from the group stay inside it"
        kind = "owner_group"
    elif rule_id == "G-LOOP":
        numbers[f"{nid}.cycles"] = _num(st["cycles"], str(st["cycles"]))
        text = "Referrals between " + _and(members) + " form {{" + nid + ".cycles}} closed loops"
        kind = "referral_loop"
    elif rule_id == "G-REFCONC":
        numbers[f"{nid}.share"] = _num(st["share"], _pct(st["share"]))
        text = "{{" + nid + ".share}} of the referrals come from " + _and(st["top3"])
        kind = "referral_concentration"
    else:
        text = _and(members) + " share " + _and([LINK_TEXT[x] for x in st["links"]])
        kind = "shared_infrastructure"
    return {"id": nid, "type": kind, "evidence": eid, "providers": members or st.get("top3", []),
            "template": text, "statement": render(text, numbers)}


def build_pack(sc: ScoredCase, ctx: PackContext) -> dict:
    d = sc.draft
    numbers: dict[str, dict] = {}
    evidence: list[dict] = []
    codes: set[str] = set()
    entities: set[str] = {p for p, _ in d.subjects}
    dates: set[str] = set()

    # one evidence item per detector that fired: line rules, then network, peer and own-history signals
    by_rule: dict[str, list[dict]] = defaultdict(list)
    for h in d.hits:
        by_rule[h["rule_id"]].append(h)
    items: list[dict] = []
    for rule_id, hs in by_rule.items():
        items.append({"rule": rule_id, "hits": hs, "alert": None,
                      "dollars": round(sum(h["dollars"] for h in hs), 2)})
    seen_alert: set = set()
    for al in sorted(d.alerts, key=lambda x: (x.rule_id, x.provider_id, x.window_end)):
        if al.rule_id not in ref.ALERT_ONLY_RULES or al.suppressed_by_exception_id:
            continue
        key = (al.rule_id, tuple(al.detail["group"])) if al.rule_id == "G-INFRA" else \
            (al.rule_id, al.provider_id, al.detail.get("metric"))
        latest = max((x for x in d.alerts if x.rule_id == al.rule_id and (
            (x.detail or {}).get("group") == al.detail.get("group") if al.rule_id == "G-INFRA" else
            x.provider_id == al.provider_id and (x.detail or {}).get("metric") == al.detail.get("metric"))),
            key=lambda x: x.window_end)
        if key in seen_alert:
            continue
        seen_alert.add(key)
        items.append({"rule": al.rule_id, "hits": [], "alert": latest, "dollars": 0.0})
    items.sort(key=lambda it: (CHANNEL_ORDER[ref.CHANNEL_OF[it["rule"]]], -it["dollars"], it["rule"],
                               it["alert"].provider_id if it["alert"] else ""))
    ordered_rules = [it["rule"] for it in items]
    network: list[dict] = []
    for i, it in enumerate(items, start=1):
        eid = f"E{i}"
        rule_id, hs, al = it["rule"], it["hits"], it["alert"]
        channel = ref.CHANNEL_OF[rule_id]
        scheme, name, strength, policy_id, hard, _act = ref.RULES[rule_id]
        dollars = it["dollars"]
        numbers[f"{eid}.dollars"] = _num(dollars, money(dollars))
        if hs:
            numbers[f"{eid}.n"] = _num(len(hs), str(len(hs)))
        if rule_id == "R-DME-01":
            numbers[f"{eid}.days"] = _num(ref.DME_VISIT_WINDOW_DAYS, str(ref.DME_VISIT_WINDOW_DAYS))
        if rule_id == "R-TIME-01":
            n_days = len({h["service_dt"] for h in hs})
            numbers[f"{eid}.days"] = _num(n_days, str(n_days))
            numbers[f"{eid}.cap"] = _num(ref.TIME_CAP_MINUTES, str(ref.TIME_CAP_MINUTES))
        if rule_id == "R-GEO-01":
            numbers[f"{eid}.km"] = _num(ref.GEO_KM, f"{ref.GEO_KM:.0f}")
        lit: dict[str, str] = {}
        stat: dict = {}
        if channel != "LINE":
            if al is not None:
                stat = dict(al.detail)
                strength = al.score
            else:
                stat = max((json.loads(h["detail"]) for h in hs), key=lambda x: x["month"])
                strength = max(json.loads(h["detail"])["strength"] for h in hs)
            lit = _signal_numbers(numbers, eid, rule_id, stat)
        template = ref.RULE_TEMPLATE[rule_id].replace("{{EV.", "{{" + eid + ".")
        for k, v in lit.items():
            template = template.replace("{{" + k + "}}", v)
        top = sorted(hs, key=lambda h: (-h["dollars"], h["claim_id"], h["line_no"]))
        examples = [{"claimId": h["claim_id"], "lineNo": h["line_no"], "serviceDt": h["service_dt"].isoformat(),
                     "hcpcs": h["hcpcs"], "dollars": h["dollars"]} for h in top[:MAX_EXAMPLES]]
        for h in hs:
            codes.add(h["hcpcs"])
        for e in examples:
            entities.add(e["claimId"])
            dates.add(e["serviceDt"])
        if hs:
            first, last = min(h["service_dt"] for h in hs), max(h["service_dt"] for h in hs)
        else:
            first, last = al.window_start, al.window_end
        dates |= {first.isoformat(), last.isoformat()}
        evidence.append({
            "id": eid, "type": EVIDENCE_TYPE[channel], "detector": f"{rule_id}@v{ref.RULE_VERSION}",
            "channel": channel, "schemeType": al.scheme_type if al else scheme, "name": name, "strength": strength,
            "hardFact": hard, "template": template, "statement": render(template, numbers), "dollars": dollars,
            "dollarsBasis": "ESTIMATED" if rule_id in ref.ESTIMATED_RULES else "EXACT", "lineCount": len(hs),
            "firstServiceDt": first.isoformat(), "lastServiceDt": last.isoformat(),
            "claimRefs": [h["claim_id"] for h in top[:MAX_CLAIM_REFS]], "examples": examples,
            "policyRefs": [policy_id],
            "observation": insight.observation(rule_id, hs, stat, strength),
        })
        if channel == "NETWORK":
            network.append(_network_entry(len(network) + 1, eid, rule_id, stat, numbers, entities))

    precedents_out: list[dict] = []
    for k, m in enumerate(sc.matches[:3], start=1):
        pid, p = f"PR{k}", m.precedent
        numbers[f"{pid}.sim"] = _num(round(m.similarity, 4), f"{m.similarity:.2f}")
        text = ("A similar earlier case ({{" + pid + ".sim}} similarity) was closed "
                + prec.DISPOSITION_TEXT[p.disposition])
        if p.reason_code in prec.REASON_TEXT:
            text += ", with " + prec.REASON_TEXT[p.reason_code] + " as the stated reason"
        entities.add(p.precedent_id)
        precedents_out.append({"id": pid, "precedentId": p.precedent_id, "similarity": round(m.similarity, 4),
                               "disposition": p.disposition, "reasonCode": p.reason_code, "template": text,
                               "statement": render(text, numbers)})

    s = {
        "S.risk": _num(round(sc.risk, 4), f"{sc.risk:.2f}"),
        "S.dollars": _num(round(sc.dollars_exact + sc.dollars_est, 2), money(sc.dollars_exact + sc.dollars_est)),
        "S.dollarsExact": _num(sc.dollars_exact, money(sc.dollars_exact)),
        "S.dollarsEstimated": _num(sc.dollars_est, money(sc.dollars_est)),
        "S.members": _num(len(sc.members), str(len(sc.members))),
        "S.severity": _num(round(sc.severity, 4), f"{sc.severity:.2f}"),
        "S.memberImpact": _num(round(sc.member_impact, 4), f"{sc.member_impact:.2f}"),
        "S.evidenceStrength": _num(round(sc.evidence_strength, 4), f"{sc.evidence_strength:.2f}"),
    }
    numbers.update(s)

    cited_policies = sorted({p for e in evidence for p in e["policyRefs"]})
    policies = [{"id": sid, "version": "v1", "title": title, "text": body}
                for sid, _doc, title, body in ref.POLICY_SECTIONS if sid in cited_policies]
    cited_terms = {"R-DUP-01": "GL-DUP", "R-PTP-01": "GL-PTP", "R-MUE-01": "GL-MUE", "R-DME-01": "GL-QV",
                   "R-TIME-01": "GL-TIME", **{r: "GL-PEER" for r in ref.PEER_RULES},
                   **{r: "GL-NET" for r in ref.GRAPH_RULES}, **{r: "GL-SELF" for r in ref.TEMPORAL_RULES}}
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
    for k, e in enumerate((e for e in evidence if e["channel"] == "SELF" and e["detector"].startswith("T-CUSUM")),
                          start=5):
        onset = next(a.detail["onset"] for a in d.alerts if a.rule_id == "T-CUSUM"
                     and e["statement"].startswith(a.detail["label"]))
        timeline.append({"id": f"T{k}", "date": f"{onset}-01", "text": "A sustained change in the provider's own "
                                                                        "pattern began"})
    for t in timeline:
        dates.add(t["date"])
    timeline.sort(key=lambda t: (t["date"], t["id"]))

    limitations = [
        {"id": "L1", "mandatory": True, "text": "All data in this system is synthetic."},
        {"id": "L2", "mandatory": True,
         "text": "Network analysis covers shared owners, buildings, phones, facilities and referrals in the "
                 "synthetic data; relationships outside that data cannot be assessed."},
    ]
    if "R-DME-01" in by_rule:
        limitations.append({"id": "L3", "mandatory": False,
                            "text": "Orders with no ordering provider are not evaluated by the equipment rule."})

    if any(e["channel"] == "PEER" for e in evidence) or sc.dollars_est > 0:
        limitations.append({"id": "L4", "mandatory": False,
                            "text": "Peer comparisons are statistical and show an unusual pattern against providers "
                                    "of the same specialty, not its cause; dollars marked estimated are inferred, "
                                    "not recorded payments."})

    action = default_action_for(sc)
    permitted = ref.permitted_actions(sc.tier)
    ins = insight.build_insight(sc, evidence, numbers, precedents_out, policies, ctx, limitations, action, permitted)

    pack = {
        "packVersion": PACK_VERSION, "caseId": d.case_id, "runId": ctx.run_id, "asof": ctx.asof.isoformat(),
        "subjects": subjects,
        "scores": {"risk": "{{S.risk}}", "dollars": "{{S.dollars}}", "tier": sc.tier,
                   "tierReasons": [{"id": f"TR{i}", "text": t} for i, t in enumerate(sc.tier_reasons, start=1)]},
        "evidence": evidence, "numbers": numbers,
        "entities": sorted(entities), "dates": sorted(dates), "codes": sorted(codes),
        "codeLabels": {c: ctx.hcpcs_label[c] for c in sorted(codes)},
        "timeline": timeline, "network": network, "precedents": precedents_out, "policies": policies,
        "glossary": glossary,
        "limitations": limitations,
        "permittedActions": ref.permitted_actions(sc.tier),
        "defaultAction": default_action_for(sc),
        "hypotheses": [h["code"] for h in sc.hypotheses],
        "insufficientEvidenceRequired": sc.tier == "LOW",
        "forbiddenTerms": ref.FORBIDDEN_TERMS,
        "impact": ins["impact"], "confidence": ins["confidence"], "reasoning": ins["reasoning"],
        "explanation": ins["explanation"],
    }
    pack["packSha256"] = pack_sha256(pack)
    return pack
