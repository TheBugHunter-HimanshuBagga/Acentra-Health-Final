"""Case impact, risk x evidence x confidence, the reasoning chain and the flagged / not-flagged explanation.

Everything here is deterministic and computed from the same validated inputs as the evidence pack. Nothing is written
by a model. Numbers that a model may later quote are registered in the pack's numbers registry (IM*, CF*); items carry
ids (IM1.., CF1.., RS1..) so they can be cited like evidence.

Principle: a confident wrong answer is worse than an explicit gap. A LOW-confidence case therefore says
"Insufficient evidence - human review required" and names what is missing instead of recommending an action.
"""

from __future__ import annotations

from collections import Counter

from claimshield import reference as ref
from claimshield.brain import precedents as prec
from claimshield.cases.score import CHANNEL_WEIGHT, ScoredCase

INSUFFICIENT = "Insufficient evidence - human review required."

THRESHOLD = {
    "R-DUP-01": "any exact duplicate (same member, date, code, modifiers and units)",
    "R-PTP-01": "any paired code billed together without an allowed modifier",
    "R-MUE-01": "units above the published per-day limit",
    "R-DOD-01": "any service dated after the member's recorded date of death",
    "R-EXCL-01": "any billing dated after the provider's recorded exclusion date",
    "R-DME-01": f"no qualifying visit by the ordering provider in the {ref.DME_VISIT_WINDOW_DAYS} days before the order",
    "R-TIME-01": f"more than {ref.TIME_CAP_MINUTES} minutes of typical service time for one provider in one day",
    "R-GEO-01": f"same member in two places more than {ref.GEO_KM:.0f} km apart on one day",
    "R-IP-01": "an office or home service dated inside an inpatient stay",
    "S-UPC": f"robust z of at least {ref.PEER_Z_ALERT} against the peer group in at least {ref.PEER_MIN_MONTHS} months "
             f"(at least {ref.PEER_MIN_PEERS} peers)",
    "S-UTL": f"robust z of at least {ref.PEER_Z_ALERT} against the peer group in at least {ref.PEER_MIN_MONTHS} months "
             f"(at least {ref.PEER_MIN_PEERS} peers)",
    "S-GHOST": f"robust z of at least {ref.PEER_Z_ALERT} against the peer group in at least {ref.PEER_MIN_MONTHS} "
               f"months (at least {ref.PEER_MIN_PEERS} peers)",
    "S-DIST": f"robust z of at least {ref.PEER_Z_ALERT} against the peer group in at least {ref.PEER_MIN_MONTHS} "
              f"months (at least {ref.PEER_MIN_PEERS} peers)",
    "G-OWNREF": "referral dollars staying inside one control-owner group well above the base rate",
    "G-LOOP": "closed loops of referrals between the providers",
    "G-REFCONC": "referrals concentrated in very few referrers compared with peers",
    "G-INFRA": "providers sharing a control owner, a phone number or a building (alert only, never a case by itself)",
    "T-CUSUM": f"cumulative shift of at least {ref.CUSUM_H} standard units from the provider's own "
               f"{ref.CUSUM_BASE_MONTHS}-month baseline",
    "T-GROWTH": "growth ratio far above the peer growth ratio",
    "T-RAMP": "billing volume of an established provider within the first months after enrolment",
}

LINE_SOURCE = ["claim_line.claim_id", "claim_line.line_no", "claim_line.hcpcs", "claim_line.service_dt",
               "claim_line.units", "claim_line.paid_amt", "claim.member_id", "claim.billing_provider_id"]
RULE_SOURCE = {"R-DOD-01": ["member.death_dt"], "R-EXCL-01": ["exclusion.excl_dt"], "R-IP-01": ["inpatient_stay"],
               "R-GEO-01": ["member_location", "provider_location"], "R-TIME-01": ["ref_hcpcs.typical_minutes"],
               "R-PTP-01": ["ref_ncci_ptp"], "R-MUE-01": ["ref_mue"], "R-DME-01": ["claim.referring_provider_id"]}


# Emergency and core-care services: a flag here must never interrupt or delay care. Design list (HCPCS/CPT ranges), not a clinical rule.
CORE_CARE_PREFIXES = ("9928", "99291", "99292", "9093", "9094", "9095", "9096", "9097", "9640", "9641", "G0463")
CORE_CARE_LABEL = "emergency, critical care, dialysis or chemotherapy"


def is_core_care(hcpcs: str) -> bool:
    return str(hcpcs).startswith(CORE_CARE_PREFIXES)


def _n(numbers: dict, key: str, value, fmt: str) -> None:
    numbers[key] = {"value": value, "fmt": [fmt]}


def _money(v: float) -> str:
    return f"${v:,.2f}"


def observation(rule_id: str, hits: list[dict], stat: dict, strength: float) -> dict:
    """What was observed, against which threshold, compared with whom, with which history and from which fields."""
    channel = ref.CHANNEL_OF[rule_id]
    obs: dict = {"channel": channel, "threshold": THRESHOLD[rule_id], "strength": round(float(strength), 4),
                 "observed": None, "peerBaseline": None, "history": None, "network": None, "sourceFields": []}
    if channel == "LINE":
        claims = sorted({h["claim_id"] for h in hits})
        obs["observed"] = {"lines": len(hits), "claims": len(claims), "members": len({h["member_id"] for h in hits}),
                           "dollars": round(sum(h["dollars"] for h in hits), 2),
                           "codes": sorted({h["hcpcs"] for h in hits})[:8],
                           "firstDate": min(h["service_dt"] for h in hits).isoformat() if hits else None,
                           "lastDate": max(h["service_dt"] for h in hits).isoformat() if hits else None}
        obs["sourceFields"] = LINE_SOURCE + RULE_SOURCE.get(rule_id, [])
        return obs
    obs["sourceFields"] = ["claim_line", "provider", "ref_hcpcs"]
    if rule_id == "S-UPC":
        obs["observed"] = {"highLevelShare": stat.get("share")}
        obs["peerBaseline"] = {"peerShare": stat.get("peer"), "peers": stat.get("peers"),
                               "acuity": stat.get("acuity"), "peerAcuity": stat.get("peerAcuity")}
    elif rule_id == "S-UTL":
        obs["observed"] = {"linesPerMember": stat.get("lpm")}
        obs["peerBaseline"] = {"peerMedian": stat.get("peer"), "peers": stat.get("peers")}
    elif rule_id == "S-GHOST":
        obs["observed"] = {"membersWithNoOtherProvider": stat.get("share")}
        obs["peerBaseline"] = {"peerShare": stat.get("peer"), "peers": stat.get("peers")}
        obs["history"] = {"monthsSeen": stat.get("months")}
    elif rule_id == "S-DIST":
        obs["observed"] = {"medianKm": stat.get("km")}
        obs["peerBaseline"] = {"peerMedianKm": stat.get("peer"), "peers": stat.get("peers")}
    elif rule_id in ("G-OWNREF", "G-LOOP", "G-REFCONC", "G-INFRA"):
        obs["observed"] = {k: stat.get(k) for k in ("share", "referrals", "members", "cycles", "length", "referrers")
                           if k in stat}
        obs["peerBaseline"] = {"peerShare": stat.get("peer")} if "peer" in stat else None
        obs["network"] = {"group": stat.get("group"), "links": stat.get("links"), "top": stat.get("top3")}
        obs["sourceFields"] = ["ownership", "provider_location", "provider_facility", "claim.referring_provider_id"]
    elif rule_id == "T-CUSUM":
        obs["observed"] = {"metric": stat.get("label"), "to": stat.get("to")}
        obs["history"] = {"baseline": stat.get("from"), "monthsSustained": stat.get("months"),
                          "onset": stat.get("onset")}
    elif rule_id == "T-GROWTH":
        obs["observed"] = {"growthRatio": stat.get("ratio")}
        obs["peerBaseline"] = {"peerGrowthRatio": stat.get("peer")}
    elif rule_id == "T-RAMP":
        obs["observed"] = {"monthsSinceEnrolment": stat.get("tenure"), "volumeRatio": stat.get("ratio")}
    return obs


def _channels_agreeing(sc: ScoredCase) -> list[str]:
    return sorted(c for c, s in sc.channels.items() if s >= 0.3)


def _precedent_view(sc: ScoredCase) -> dict:
    strong = partial = conflicting = supporting = 0
    ids = []
    for k, m in enumerate(sc.matches[:3], start=1):
        ids.append(f"PR{k}")
        if m.similarity >= prec.STRONG_SIM:
            strong += 1
        else:
            partial += 1
        if m.precedent.disposition == "UNFOUNDED":
            conflicting += 1
        elif m.precedent.disposition == "CONFIRMED":
            supporting += 1
    return {"fit": round(sc.precedent_fit, 4), "matches": len(sc.matches[:3]), "strong": strong, "partial": partial,
            "conflicting": conflicting, "supporting": supporting, "ids": ids,
            "live": sum(1 for m in sc.matches[:3] if m.precedent.source == "LIVE")}


def build_insight(sc: ScoredCase, evidence: list[dict], numbers: dict, precedents_out: list[dict], policies: list[dict],
                  ctx, limitations: list[dict], default_action: str, permitted: list[dict],
                  flagged: bool = True) -> dict:
    d = sc.draft
    members = sorted(sc.members)
    claims = sorted({h["claim_id"] for h in d.hits})
    codes = sorted({h["hcpcs"] for h in d.hits})
    fam = {ctx.hcpcs_family.get(c) for c in codes if ctx.hcpcs_family.get(c)}
    providers = [p for p, _r in d.subjects]
    facilities = sorted({f for p in providers for f in ctx.provider_facility.get(p, [])})
    regions = {ctx.provider_region[p] for p in providers if p in ctx.provider_region}
    regions |= {ctx.member_region[m] for m in members if m in ctx.member_region}
    ev_ids = [e["id"] for e in evidence]
    line_ev = [e["id"] for e in evidence if e["channel"] == "LINE"]
    est_ev = [e["id"] for e in evidence if e["dollarsBasis"] == "ESTIMATED" and e["dollars"] > 0]
    net_ev = [e["id"] for e in evidence if e["channel"] == "NETWORK"]
    agree = _channels_agreeing(sc)
    pv = _precedent_view(sc)

    # ------------------------------------------------------------------------------------------------ impact
    items: list[dict] = []

    def add(key, label, value, display, basis, template, evidence_ids, source):
        iid = f"IM{len(items) + 1}"
        _n(numbers, f"{iid}.value", value, display)
        why = template.replace("{{V}}", "{{" + iid + ".value}}")
        rendered = why
        for k, v in numbers.items():
            if k.startswith(iid + "."):
                rendered = rendered.replace("{{" + k + "}}", v["fmt"][0])
        items.append({"id": iid, "key": key, "label": label, "value": value, "display": display, "basis": basis,
                      "whyTemplate": why, "why": rendered, "evidenceIds": evidence_ids, "sourceFields": source})

    has_lines = bool(d.hits)
    add("members", "Potentially affected members", len(members), str(len(members)),
        "EXACT" if has_lines else "ESTIMATED",
        "{{V}} distinct members are linked to the evidence" + (
            f" ({', '.join(line_ev)}: members on the flagged claim lines)" if has_lines else
            ": the provider's members in the evaluated window, because the evidence is a statistic, not claim lines"),
        ev_ids, ["claim.member_id", "claim_line.claim_id"])
    add("claims", "Affected claims", len(claims), str(len(claims)), "EXACT",
        "{{V}} distinct claims contain at least one flagged line (" + (", ".join(line_ev) or "no line-level evidence")
        + ")", line_ev, ["claim_line.claim_id"])
    add("lines", "Flagged claim lines", len(d.hits), str(len(d.hits)), "EXACT",
        "{{V}} claim lines were flagged by recorded-fact or line-level rules; each is listed with its claim id in the "
        "evidence", line_ev, ["claim_line.line_no", "out_rule_hit"])
    add("exposureExact", "Exact exposure", sc.dollars_exact, _money(sc.dollars_exact), "EXACT",
        "{{V}} is the sum of paid amounts on lines flagged by deterministic rules (" + (", ".join(
            e["id"] for e in evidence if e["dollarsBasis"] == "EXACT" and e["dollars"] > 0) or "none") + ")",
        [e["id"] for e in evidence if e["dollarsBasis"] == "EXACT" and e["dollars"] > 0], ["claim_line.paid_amt"])
    add("exposureEstimated", "Estimated exposure", sc.dollars_est, _money(sc.dollars_est), "ESTIMATED",
        "{{V}} is inferred from time, peer, network or trend rules (" + (", ".join(est_ev) or "none")
        + "); it is not a recorded payment and is never added to the exact figure without the label", est_ev,
        ["claim_line.paid_amt", "provider peer statistics"])
    add("providers", "Providers and facilities", len(providers), f"{len(providers)} providers · {len(facilities)} facilities",
        "DERIVED",
        "{{V}} providers form the case" + (f"; they are linked by {', '.join(net_ev)}" if net_ev else "") + (
            f"; {len(facilities)} facilities are shared" if facilities else ""), net_ev or ev_ids[:1],
        ["provider", "provider_facility", "ownership"])
    add("geography", "Geographic breadth", len(regions), f"{len(regions)} regions", "DERIVED",
        "{{V}} regions contain the subjects or the affected members (synthetic region codes, not real places)",
        ev_ids[:1], ["provider_location.region", "member_location.region"])
    add("services", "Service breadth", len(codes), f"{len(codes)} codes · {len(fam)} service families", "EXACT",
        "{{V}} distinct procedure codes appear on the flagged lines", line_ev, ["claim_line.hcpcs", "ref_hcpcs.family"])
    core_lines = [h for h in d.hits if is_core_care(h["hcpcs"])]
    add("coreCare", "Core care protection", len(core_lines), f"{len(core_lines)} lines", "EXACT",
        "{{V}} flagged lines are " + CORE_CARE_LABEL + " services; these must never be paused or denied automatically",
        line_ev, ["claim_line.hcpcs"])
    top = sc.hypotheses[0]["code"] if sc.hypotheses else None
    sev_w = ref.SCHEME_WEIGHTS.get(top, (0.0, 0.0)) if top else (0.0, 0.0)
    impact = {
        "items": items,
        "severity": {"value": round(sc.severity, 4), "pattern": top,
                     "why": f"Severity {sc.severity:.2f} is the weight of the most serious pattern observed "
                            f"({top}: severity weight {sev_w[0]:.2f}, harm weight {sev_w[1]:.2f}); weights are "
                            "design judgements frozen in the reference file, not statistics."},
        "exposureBasis": "EXACT" if sc.dollars_est <= 0 else ("ESTIMATED" if sc.dollars_exact <= 0 else "MIXED"),
        "memberImpactScore": round(sc.member_impact, 4),
    }

    # ----------------------------------------------------------------------------------------- confidence
    contra: list[dict] = []

    def con(text, source, ids=None):
        contra.append({"id": f"CF{len(contra) + 1}", "text": text, "source": source, "refs": ids or []})

    for k, m in enumerate(sc.matches[:3], start=1):
        if m.precedent.disposition == "UNFOUNDED":
            con(f"A similar earlier case ({m.precedent.precedent_id}, similarity {m.similarity:.2f}) was closed "
                f"unfounded{' with ' + prec.REASON_TEXT[m.precedent.reason_code] if m.precedent.reason_code in prec.REASON_TEXT else ''}",
                "precedent", [f"PR{k}"])
    if sc.exception_id:
        con(f"An approved exception ({sc.exception_id}) matches this case", "exception")
    if not sc.hard_fact:
        con("No recorded-fact rule fired: every signal is a statistical or relationship indicator", "evidence")
    if sc.dollars_est > sc.dollars_exact:
        con("More of the exposure is estimated than exact", "impact", ["IM5"])
    if core_lines:
        con(f"{len(core_lines)} flagged line(s) are {CORE_CARE_LABEL} services: protect access to care, review after the fact, never block", "context", ["IM%d" % len(items)])
    mean_ac = (sum(ctx.member_acuity.get(m, 0.0) for m in members) / len(members)) if members and ctx.member_acuity else 0.0
    if ctx.mean_acuity and mean_ac >= 1.25 * ctx.mean_acuity and any(e["channel"] == "PEER" for e in evidence):
        con(f"The members have {mean_ac / ctx.mean_acuity:.1f} times the population average acuity, which can explain "
            "higher utilisation than peers", "context")
    if any(ctx.provider_rural.get(p) for p in providers) and any(e["channel"] == "PEER" for e in evidence):
        con("A subject is in a rural area, where peer comparisons are less reliable", "context")

    missing: list[str] = []
    for ch, label in (("LINE", "recorded-fact or line-level rule hit"), ("PEER", "peer-comparison signal"),
                      ("SELF", "change in the provider's own history"), ("NETWORK", "relationship signal")):
        if sc.channels.get(ch, 0.0) < 0.3:
            missing.append(f"No {label} was found ({ch.lower()} channel)")
    for r in sc.raise_conf:
        if r not in missing:
            missing.append(r)

    tier = sc.tier
    strength = round(sc.evidence_strength, 4)
    material_conflict = pv["conflicting"] >= 1 and pv["fit"] <= -0.25
    if tier == "HIGH":
        route = {"code": "HIGH_NONBLOCKING", "requiresHuman": True,
                 "automationEligible": not material_conflict and not contra_material(contra) and not core_lines,
                 "text": "High confidence: eligible for the non-blocking workflow where policy permits. Every step "
                         "is audited, and high-impact actions still need a second person."}
        statement = (f"Confidence: HIGH - {len(agree)} independent evidence channel(s) corroborate the signal"
                     + (" and a recorded fact is present" if sc.hard_fact else "") + ".")
    elif tier == "MEDIUM":
        route = {"code": "EXPERT_REVIEW", "requiresHuman": True, "automationEligible": False,
                 "text": "Medium confidence: route to expert review. What is known and what is uncertain are listed; "
                         "the missing evidence below would raise confidence."}
        statement = (f"Confidence: MEDIUM - {len(agree)} evidence channel(s) agree, but "
                     + ("signals conflict or" if contra else "the evidence is partial and")
                     + " more is needed before a firm conclusion.")
    else:
        route = {"code": "ESCALATE_INSUFFICIENT", "requiresHuman": True, "automationEligible": False,
                 "text": INSUFFICIENT + " No recommendation is made; the missing evidence is listed."}
        statement = f"Confidence: LOW - {INSUFFICIENT}"
    drivers = sorted(({"channel": c, "contribution": round(CHANNEL_WEIGHT[c] * s, 4), "strength": round(s, 4)}
                      for c, s in sc.channels.items() if s > 0), key=lambda x: -x["contribution"])
    out90 = sc.outlook.get("horizons", {}).get("90", {}).get("probability") if sc.outlook.get("available") else None
    confidence = {
        "level": tier, "route": route, "statement": statement, "insufficientEvidence": tier == "LOW",
        "insufficientText": INSUFFICIENT if tier == "LOW" else None,
        "risk": {"score": round(sc.risk, 4), "severity": round(sc.severity, 4),
                 "drivers": [{**x, "text": f"{x['channel']} channel strength {x['strength']:.2f} "
                                           f"(weight {CHANNEL_WEIGHT[x['channel']]:.2f})"} for x in drivers],
                 "outlook": {"available": sc.outlook.get("available", False), "p90": out90,
                             "label": "PREDICTION - a ranking score, never proof"},
                 "note": "Risk says how much a case deserves attention. It is not confidence."},
        "evidence": {"strength": strength, "count": len(evidence), "channelsAgreeing": agree,
                     "supporting": [{"id": e["id"], "channel": e["channel"], "strength": round(e["strength"], 4),
                                     "text": e["statement"]} for e in evidence],
                     "contradicting": contra, "missing": missing, "evidenceIds": ev_ids},
        "precedent": pv,
    }

    # ------------------------------------------------------------------------------------ reasoning chain
    rules = [{"evidenceId": e["id"], "ruleId": e["detector"].split("@")[0], "version": ref.RULE_VERSION,
              "name": e["name"], "policy": e["policyRefs"][0], "threshold": e["observation"]["threshold"],
              "observed": e["observation"]["observed"], "hardFact": e["hardFact"]} for e in evidence]
    action_text = {a["action"]: a for a in permitted}.get(default_action, {})
    chain = [
        {"id": "RS1", "step": "RETRIEVE", "title": "Retrieve",
         "summary": f"Retrieved {len(evidence)} evidence items, {len(d.hits)} claim lines, {len(policies)} policies, "
                    f"{len({r['ruleId'] for r in rules})} rules and {pv['matches']} similar earlier case(s).",
         "details": [f"{e['id']}: {e['name']}" for e in evidence], "refs": ev_ids + [p["id"] for p in policies]
         + pv["ids"]},
        {"id": "RS2", "step": "INTERPRET", "title": "Interpret",
         "summary": "What the evidence means in this case.",
         "details": [f"{e['id']}: {e['statement']}" for e in evidence]
         + [ref.HYPOTHESIS_TEXT[h["code"]] for h in sc.hypotheses[:3]], "refs": ev_ids},
        {"id": "RS3", "step": "APPLY_RULES", "title": "Apply rules",
         "summary": f"{len(rules)} approved rule(s) (version {ref.RULE_VERSION}) fired; none was changed by this system.",
         "details": [f"{r['ruleId']} ({r['policy']}): threshold - {r['threshold']}" for r in rules],
         "refs": [r["evidenceId"] for r in rules]},
        {"id": "RS4", "step": "PROPOSE", "title": "Propose",
         "summary": ("Suggested next step: " + default_action.replace("_", " ").lower() + ". This is a proposal for a "
                     "person to review, not a finding about anyone.") if tier != "LOW" else
                    "No recommendation: " + INSUFFICIENT,
         "details": [f"Permitted actions: {', '.join(a['action'] for a in permitted)}"], "refs": []},
        {"id": "RS5", "step": "SCORE", "title": "Score",
         "summary": f"Evidence strength {sc.evidence_strength:.2f}; risk {sc.risk:.2f}; severity {sc.severity:.2f}; "
                    f"precedent fit {sc.precedent_fit:+.2f}; {len(contra)} conflicting signal(s).",
         "details": [f"{len(agree)} of 4 channels agree ({', '.join(agree) or 'none'})",
                     f"Precedents: {pv['strong']} strong, {pv['partial']} partial, {pv['conflicting']} conflicting",
                     "Ambiguity = conflicting signals / (supporting + conflicting) = "
                     f"{len(contra) / max(1, len(contra) + len(evidence)):.2f}"], "refs": []},
        {"id": "RS6", "step": "CITE", "title": "Cite",
         "summary": f"Every statement cites its evidence ids: {', '.join(ev_ids)}.",
         "details": [f"Source fields: {', '.join(sorted({f for e in evidence for f in e['observation']['sourceFields']}))}"],
         "refs": ev_ids},
        {"id": "RS7", "step": "HUMAN_REVIEW", "title": "Human review", "summary": route["text"], "details": [],
         "refs": []},
    ]
    chain_doc = {"steps": chain, "note": "Deterministic reasoning chain built from validated evidence. A model may "
                                         "explain it in words but cannot change it."}

    # ----------------------------------------------------------------------------- explanation (flagged)
    explanation = _explain(sc, evidence, contra, missing, confidence, impact, route, default_action, pv, ctx) \
        if flagged else None
    return {"impact": impact, "confidence": confidence, "reasoning": chain_doc, "explanation": explanation}


def contra_material(contra: list[dict]) -> bool:
    return any(c["source"] in ("precedent", "exception") for c in contra)


def _short(e: dict) -> str:
    return e["statement"][0].lower() + e["statement"][1:] if e["statement"] else e["name"]


def _explain(sc, evidence, contra, missing, confidence, impact, route, default_action, pv, ctx) -> dict:
    ranked = sorted(evidence, key=lambda e: (-int(e["hardFact"]), -e["strength"], e["id"]))
    trigger = ranked[0] if ranked else None
    top3 = ranked[:3]
    headline = ("Flagged because " + "; ".join(f"{_short(e)} ({e['id']})" for e in top3) + "."
                ) if top3 else "Flagged by the combined signals."
    total = sum(CHANNEL_WEIGHT[c] * s for c, s in sc.channels.items()) or 1.0
    contribution = [{"channel": c, "share": round(CHANNEL_WEIGHT[c] * s / total, 4), "strength": round(s, 4)}
                    for c, s in sorted(sc.channels.items(), key=lambda kv: -kv[1]) if s > 0]
    unusual, peer_cmp, history, network = [], [], [], []
    for e in evidence:
        o = e["observation"]
        if o["peerBaseline"]:
            peer_cmp.append({"id": e["id"], "observed": o["observed"], "peer": o["peerBaseline"],
                             "threshold": o["threshold"]})
            unusual.append(f"{e['id']}: {e['statement']}")
        if o["history"]:
            history.append({"id": e["id"], "history": o["history"], "observed": o["observed"]})
        if o["network"]:
            network.append({"id": e["id"], "network": o["network"], "statement": e["statement"]})
    if not unusual and top3:
        unusual = [f"{e['id']}: {e['statement']}" for e in top3]
    return {
        "flagged": True, "headline": headline, "confidenceLine": confidence["statement"],
        "trigger": {"id": trigger["id"], "statement": trigger["statement"]} if trigger else None,
        "strongestEvidence": {"id": trigger["id"], "statement": trigger["statement"],
                              "hardFact": trigger["hardFact"]} if trigger else None,
        "supportingEvidence": [{"id": e["id"], "statement": e["statement"]} for e in ranked[1:]],
        "riskContribution": contribution, "whyUnusual": unusual, "peerComparison": peer_cmp,
        "historicalBehaviour": history, "networkContext": network,
        "contradictory": contra, "missingEvidence": missing,
        "recommendedHumanAction": {"action": default_action, "text": route["text"]},
        "impactLine": f"{impact['items'][0]['display']} members, {impact['items'][1]['display']} claims, "
                      f"{impact['items'][3]['display']} exact + {impact['items'][4]['display']} estimated.",
    }


def explain_not_flagged(sc: ScoredCase, ctx, exception_id: str | None = None) -> dict:
    """Why a provider with alerts was NOT escalated to a case (Monitor). Same structure, opposite verdict."""
    agree = _channels_agreeing(sc)
    channels = {c: round(s, 2) for c, s in sc.channels.items() if s > 0}
    seen = [f"{c.lower()} channel strength {s:.2f}" for c, s in channels.items()]
    why = list(sc.tier_reasons)
    headline = ("Not escalated because " + "; ".join(why[:2]).rstrip(".").lower() + ".") if why else \
        "Not escalated because the evidence did not meet the case threshold."
    if exception_id:
        headline = f"Not escalated because the approved exception {exception_id} matches this pattern."
    missing = list(sc.raise_conf) or ["A second independent evidence channel"]
    return {
        "flagged": False, "headline": headline,
        "confidenceLine": f"Confidence: LOW - {INSUFFICIENT}",
        "whatWasSeen": seen or ["No alert strength above the noise floor"],
        "channelsAgreeing": agree, "evidenceStrength": round(sc.evidence_strength, 4),
        "reasons": why, "viaException": exception_id,
        "missingEvidence": missing,
        "whatWouldChangeThis": missing,
        "recommendedHumanAction": {"action": "MONITOR",
                                   "text": "Keep on the Monitor list. " + INSUFFICIENT},
    }


def case_summary(sc: ScoredCase, insight: dict) -> dict:
    # `insight` is the pack (it carries the same impact and confidence sections)
    """Small block copied into the case header so the queue can filter and sort without opening packs."""
    conf = insight["confidence"]
    items = {i["key"]: i for i in insight["impact"]["items"]}
    return {
        "confidence": {"level": conf["level"], "route": conf["route"]["code"],
                       "automationEligible": conf["route"]["automationEligible"],
                       "evidenceStrength": conf["evidence"]["strength"], "evidenceCount": conf["evidence"]["count"],
                       "channelsAgreeing": len(conf["evidence"]["channelsAgreeing"]),
                       "contradictions": len(conf["evidence"]["contradicting"]),
                       "missing": len(conf["evidence"]["missing"])},
        "impact": {"members": items["members"]["value"], "claims": items["claims"]["value"],
                   "lines": items["lines"]["value"], "exposureExact": items["exposureExact"]["value"],
                   "exposureEstimated": items["exposureEstimated"]["value"], "providers": items["providers"]["value"],
                   "regions": items["geography"]["value"], "services": items["services"]["value"],
                   "severity": insight["impact"]["severity"]["value"]},
        "fwaTypes": [h["code"] for h in sc.hypotheses],
        "channelCounts": dict(Counter(e["channel"] for e in conf["evidence"]["supporting"])),
    }
