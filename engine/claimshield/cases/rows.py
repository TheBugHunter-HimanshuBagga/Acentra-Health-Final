"""Turns scored cases + packs into the rows and JSON documents the gateway reads (serving_* tables)."""

from __future__ import annotations

import json
from collections import Counter, defaultdict

from claimshield import reference as ref
from claimshield.cases.score import ScoredCase, pack_first_fit
from claimshield.cases.views import ViewData, build_graph, build_timeline
from claimshield.evidence import insight
from claimshield.evidence.pack import PackContext, build_pack, canonical_json

MAX_LINES_PER_CASE = 500
DEFAULT_CAPACITY_HOURS = 240.0


def basis_of(sc: ScoredCase) -> str:
    if sc.dollars_est <= 0:
        return "EXACT"
    return "ESTIMATED" if sc.dollars_exact <= 0 else "MIXED"


def _j(obj) -> str:
    return canonical_json(obj)


def build_rows(run_id: str, scored: list[ScoredCase], ctx: PackContext, units: dict[tuple[str, int], int],
               hit_meta: dict[tuple[str, int], dict], capacity_hours: float = DEFAULT_CAPACITY_HOURS,
               view_data: ViewData | None = None, suppressed: list[dict] | None = None) -> dict:
    cases, packs, lines, monitors, graphs, timelines, case_prec = [], [], [], [], [], [], []
    vd = view_data or ViewData()
    queue_items = [(s.draft.case_id, s.utility, s.est_hours) for s in scored if s.tier != "LOW"]
    in_cap = pack_first_fit(queue_items, capacity_hours)
    mon_n = 0
    for sc in sorted(scored, key=lambda s: s.draft.case_id):
        d = sc.draft
        if sc.tier == "LOW":
            mon_n += 1
            monitors.append({
                "run_id": run_id, "monitor_id": f"MON-{mon_n:04d}", "provider_id": d.primary,
                "reasons_json": _j({"tierReasons": sc.tier_reasons, "hypotheses": sc.hypotheses,
                                    "dollarsExact": sc.dollars_exact, "dollarsEstimated": sc.dollars_est,
                                    "caseId": d.case_id,
                                    "explanation": insight.explain_not_flagged(sc, ctx, sc.exception_id)}),
                "raise_json": _j(sc.raise_conf)})
            continue
        for m in sc.matches:
            case_prec.append({"run_id": run_id, "case_id": d.case_id, "precedent_id": m.precedent.precedent_id,
                              "similarity": round(m.similarity, 4), "disposition": m.precedent.disposition,
                              "reason_code": m.precedent.reason_code, "compare_json": _j(m.compare)})
        pack = build_pack(sc, ctx)
        packs.append({"run_id": run_id, "case_id": d.case_id, "pack_json": canonical_json(pack),
                      "pack_sha256": pack["packSha256"]})
        graphs.append({"run_id": run_id, "case_id": d.case_id, "graph_json": _j(build_graph(sc, vd, hit_meta))})
        timelines.append({"run_id": run_id, "case_id": d.case_id,
                          "timeline_json": _j(build_timeline(sc, vd, hit_meta))})
        rule_to_eid = {e["detector"].split("@")[0]: e["id"] for e in pack["evidence"]}
        top = sorted(sc.line_dollars, key=lambda k: (-sc.line_dollars[k], k))[:MAX_LINES_PER_CASE]
        for key in top:
            m = hit_meta[(key[0], key[1], sc.line_rule[key])]
            lines.append({
                "run_id": run_id, "case_id": d.case_id, "evidence_id": rule_to_eid[sc.line_rule[key]],
                "claim_id": key[0], "line_no": key[1], "member_id": m["member_id"], "provider_id": m["provider_id"],
                "service_dt": m["service_dt"].isoformat(), "hcpcs": m["hcpcs"],
                "hcpcs_label": ctx.hcpcs_label[m["hcpcs"]], "units": units[key], "paid_amt": m["paid_amt"],
                "flag_role": m["flag_role"]})
        subjects = [{"id": p, "role": r, "label": ctx.provider_info[p]["name_syn"],
                     "specialty": ctx.provider_info[p]["specialty_code"]} for p, r in d.subjects]
        header = {
            "caseId": d.case_id, "tier": sc.tier, "tierReasons": [{"id": f"TR{i}", "text": t}
                                                                   for i, t in enumerate(sc.tier_reasons, 1)],
            "subjects": subjects, "hypotheses": sc.hypotheses, "channels": sc.channels,
            "factors": {"risk": round(sc.risk, 4), "dollarScore": round(sc.dollar_score, 4),
                        "memberImpact": round(sc.member_impact, 4), "severity": round(sc.severity, 4),
                        "evidenceStrength": round(sc.evidence_strength, 4)},
            "dollars": {"exact": sc.dollars_exact, "estimated": sc.dollars_est, "basis": basis_of(sc)},
            "trend": sc.trend, "trendSlope": sc.trend_slope, "estHours": sc.est_hours, "memberCount": len(sc.members),
            "ruleIds": sorted({a.rule_id for a in d.alerts}),
            "hardFactAlerts": sc.hard_fact, "alertCount": len(d.alerts),
            "firstServiceDt": sc.first_service.isoformat(), "lastServiceDt": sc.last_service.isoformat(),
            "outlook": sc.outlook,
            "defaultAction": pack["defaultAction"], "permittedActions": pack["permittedActions"],
            "packSha256": pack["packSha256"], "runId": run_id,
            **insight.case_summary(sc, pack),
        }
        cases.append({
            "run_id": run_id, "case_id": d.case_id, "primary_provider_id": d.primary,
            "specialty_code": ctx.provider_info[d.primary]["specialty_code"], "tier": sc.tier,
            "risk_30": sc.risk_h[30], "risk_60": sc.risk_h[60], "risk_90": sc.risk_h[90],
            "utility_30": sc.utility_h[30], "utility_60": sc.utility_h[60], "utility_90": sc.utility_h[90],
            "dollars_exact": sc.dollars_exact, "dollars_est": sc.dollars_est, "dollars_basis": basis_of(sc),
            "member_impact": sc.member_impact, "severity": sc.severity, "evidence_strength": sc.evidence_strength,
            "precedent_fit": sc.precedent_fit, "est_hours": sc.est_hours, "trend": sc.trend,
            "hypotheses_json": _j([h["code"] for h in sc.hypotheses]), "subjects_json": _j(subjects),
            "channels_json": _j(sc.channels), "tier_reasons_json": _j(header["tierReasons"]),
            "header_json": _j(header),
            "fv_json": _j({"version": "fv_v1", "names": sc.fv_names, "vector": [round(x, 6) for x in sc.fv]})})
    # providers whose alerts a governed exception removed from the queue stay visible as Monitor items
    for sp in sorted(suppressed or [], key=lambda x: (x["excId"], x["provider"])):
        mon_n += 1
        monitors.append({
            "run_id": run_id, "monitor_id": f"MON-{mon_n:04d}", "provider_id": sp["provider"],
            "reasons_json": _j({"tierReasons": [f"Downgraded to Monitor by the approved exception {sp['excId']}"],
                                "hypotheses": sp["hypotheses"], "dollarsExact": 0.0,
                                "dollarsEstimated": sp["dollars"], "caseId": None, "exceptionId": sp["excId"],
                                "alerts": sp["alerts"],
                                "explanation": {
                                    "flagged": False, "confidenceLine": "Confidence: LOW - " + insight.INSUFFICIENT,
                                    "headline": f"Not escalated because the approved exception {sp['excId']} "
                                                "matches this provider's pattern.",
                                    "viaException": sp["excId"],
                                    "whatWasSeen": [h["text"] for h in sp["hypotheses"]],
                                    "missingEvidence": ["A finding that the provider is outside the exception's "
                                                        "conditions"],
                                    "whatWouldChangeThis": ["Retire the exception, or new evidence outside its "
                                                            "conditions"],
                                    "recommendedHumanAction": {"action": "MONITOR", "text": "Keep on the Monitor "
                                                               "list. " + insight.INSUFFICIENT}}}),
            "raise_json": _j(["Retire the exception, or a finding that the provider is outside its conditions"])})
    return {"cases": cases, "packs": packs, "lines": lines, "monitors": monitors, "in_capacity": in_cap,
            "graphs": graphs, "timelines": timelines, "case_precedents": case_prec}


def build_funnel(run_id: str, n_alerts: int, n_active: int, scored: list[ScoredCase], in_cap: dict[str, bool],
                 coverage: dict | None) -> dict:
    tiers = Counter(s.tier for s in scored)
    n_cases = tiers["HIGH"] + tiers["MEDIUM"]
    return {
        "runId": run_id,
        "stages": [
            {"key": "alerts", "label": "Alerts", "count": n_alerts},
            {"key": "active", "label": "Active alerts", "count": n_active},
            {"key": "cases", "label": "Cases", "count": n_cases},
            {"key": "inCapacity", "label": "In capacity", "count": sum(1 for v in in_cap.values() if v)},
        ],
        "tiers": {"HIGH": tiers["HIGH"], "MEDIUM": tiers["MEDIUM"], "MONITOR": tiers["LOW"]},
        "dollars": {"exact": round(sum(s.dollars_exact for s in scored if s.tier != "LOW"), 2),
                    "estimated": round(sum(s.dollars_est for s in scored if s.tier != "LOW"), 2)},
        "coverage": coverage, "capacityHours": DEFAULT_CAPACITY_HOURS, "diffFrom": None,
    }


def build_dashboard(run_id: str, scored: list[ScoredCase], funnel: dict) -> dict:
    by_scheme: dict[str, dict] = defaultdict(lambda: {"dollars": 0.0, "cases": 0})
    for s in scored:
        if s.tier == "LOW":
            continue
        top = s.hypotheses[0]["code"]
        by_scheme[top]["dollars"] += s.dollars_exact + s.dollars_est
        by_scheme[top]["cases"] += 1
    needs = sorted([s for s in scored if s.tier != "LOW"], key=lambda s: (-s.utility, s.draft.case_id))[:5]
    return {
        "runId": run_id,
        "kpis": {"alerts": funnel["stages"][0]["count"], "cases": funnel["stages"][2]["count"],
                 "high": funnel["tiers"]["HIGH"], "medium": funnel["tiers"]["MEDIUM"],
                 "monitor": funnel["tiers"]["MONITOR"], "exactDollars": funnel["dollars"]["exact"],
                 "estimatedDollars": funnel["dollars"]["estimated"]},
        "exposureByScheme": [{"scheme": k, "label": ref.HYPOTHESIS_TEXT[k], "dollars": round(v["dollars"], 2),
                              "cases": v["cases"]} for k, v in sorted(by_scheme.items())],
        "distributions": _distributions(scored),
        "networks": [{"caseId": s.draft.case_id, "providers": len(s.draft.providers) + len(s.draft.related),
                      "rules": sorted({a.rule_id for a in s.draft.alerts if a.rule_id.startswith("G-")}),
                      "dollars": round(s.dollars_exact + s.dollars_est, 2)}
                     for s in scored if s.tier != "LOW" and any(a.rule_id.startswith("G-") for a in s.draft.alerts)
                     and any(a.rule_id != "G-INFRA" for a in s.draft.alerts if a.rule_id.startswith("G-"))],
        "trends": dict(Counter(s.trend or "UNKNOWN" for s in scored if s.tier != "LOW")),
        "outlook": _outlook_summary(scored),
        "needsYouNow": [{"caseId": s.draft.case_id, "tier": s.tier, "primary": s.draft.primary,
                         "hypotheses": [h["code"] for h in s.hypotheses],
                         "dollars": round(s.dollars_exact + s.dollars_est, 2)}
                        for s in needs],
    }


def _distributions(scored: list[ScoredCase]) -> dict:
    cases = [s for s in scored if s.tier != "LOW"]
    buckets = ["0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"]
    hist = Counter(buckets[min(4, int(s.evidence_strength * 5))] for s in cases)
    agree = Counter(sum(1 for v in s.channels.values() if v >= 0.3) for s in cases)
    return {"confidence": {"HIGH": sum(1 for s in cases if s.tier == "HIGH"),
                           "MEDIUM": sum(1 for s in cases if s.tier == "MEDIUM"),
                           "LOW": sum(1 for s in scored if s.tier == "LOW")},
            "evidenceStrength": [{"bucket": b, "cases": hist.get(b, 0)} for b in buckets],
            "channelsAgreeing": [{"channels": k, "cases": v} for k, v in sorted(agree.items())],
            "risk": [{"bucket": b, "cases": sum(1 for s in cases if buckets[min(4, int(s.risk * 5))] == b)}
                     for b in buckets]}


def _outlook_summary(scored: list[ScoredCase]) -> dict:
    ps = {h: [s.outlook["horizons"][str(h)]["probability"] for s in scored
              if s.tier != "LOW" and s.outlook.get("available")] for h in (30, 60, 90)}
    return {"available": bool(ps[90]), "label": "Prioritization signal, not proof",
            "mean": {str(h): round(sum(v) / len(v), 4) if v else None for h, v in ps.items()},
            "top": [{"caseId": s.draft.case_id, "p90": s.outlook["horizons"]["90"]["probability"]}
                    for s in sorted((s for s in scored if s.tier != "LOW" and s.outlook.get("available")),
                                    key=lambda s: -s.outlook["horizons"]["90"]["probability"])[:5]]}


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))
