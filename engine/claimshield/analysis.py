"""One analysis of the claims data under a given set of governed exceptions and active precedents.

The expensive parts (rules, signals, prediction, features) are computed once into a Workspace. `analyse` then applies
exceptions, consolidates alerts into cases, scores them with precedent fit and builds the rows that get published, so a
simulation or a re-run costs a few seconds. Ground truth is passed in only as a path for the evaluation module.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from claimshield import reference as ref
from claimshield.brain import exceptions as exc
from claimshield.brain import precedents as prec
from claimshield.brain.pfeatures import provider_features
from claimshield.cases import alerts as alerts_mod
from claimshield.cases import rows as rows_mod
from claimshield.cases import views
from claimshield.cases.consolidate import assign_case_ids, consolidate
from claimshield.cases.score import ScoredCase, score_drafts
from claimshield.detect import rules, temporal
from claimshield.eval.metrics import evaluate, positive_lines_among
from claimshield.evidence.pack import PackContext
from claimshield.graph import graph as graph_mod


@dataclass
class Workspace:
    con: duckdb.DuckDBPyConnection
    gt_path: Path
    hits: list[dict]
    base_alerts: list
    prov: dict
    acuity: dict
    provider_lines: dict
    hcpcs_label: dict
    excl: dict
    units: dict
    hit_meta: dict
    pfeat: dict
    pred: dict
    view_data: views.ViewData
    seeds: list[prec.Precedent]
    fv_stats: dict
    spec_of: dict
    data_hash: str
    investigations: list[dict] = field(default_factory=list)
    member_region: dict = field(default_factory=dict)
    provider_region: dict = field(default_factory=dict)
    provider_rural: dict = field(default_factory=dict)
    provider_facility: dict = field(default_factory=dict)
    hcpcs_family: dict = field(default_factory=dict)

    def close(self) -> None:
        self.con.close()


def _infra_alerts(con) -> list[alerts_mod.Alert]:
    """One line-less G-INFRA alert per member of every group joined by shared infrastructure."""
    out = []
    for g in graph_mod.infra_alerts(graph_mod.load_tables(con)):
        for p in g.providers:
            out.append(alerts_mod.Alert(
                alert_id="", rule_id="G-INFRA", scheme_type="INF", provider_id=p, window_start=ref.ASOF.replace(day=1),
                window_end=ref.ASOF, score=g.strength, dollars=0.0, n_lines=0,
                detail={"group": g.providers, "links": g.detail["links"], "members": len(g.providers),
                        "strength": g.strength}))
    return out


def _predict(con, gt_path: Path, enroll: dict) -> dict:
    """30/60/90-day outlook per provider. Features come from the claims database only; the labels and the
    train/validation/test provider split come from the evaluation module."""
    from claimshield.detect.peer import _load
    from claimshield.eval import labels as labels_mod
    from claimshield.predict import features, model

    lines, providers, _dist = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    hits_df = con.execute("SELECT rule_id, provider_id, service_dt, dollars FROM out_rule_hit").fetchdf()
    tables = graph_mod.load_tables(con)
    referrals = graph_mod.referral_lines(con, ref.WINDOW_START, ref.WINDOW_END)
    rgraph = graph_mod.referral_graph(referrals)
    snaps = features.build_snapshots(
        lines, hits_df, referrals, tables["investigation"], enroll, spec_of, graph_mod.control_groups(tables),
        lambda asof: graph_mod.min_hops_to_confirmed(tables, rgraph, asof))
    labels = labels_mod.load_labels(con, gt_path, sorted(spec_of))
    return model.run_prediction(snaps, labels, labels_mod.load_splits(gt_path))


def _facility_map(con) -> dict:
    out: dict = defaultdict(list)
    for p, f in con.execute("SELECT provider_id, facility_id FROM provider_facility").fetchall():
        out[p].append(f)
    return dict(out)


def load_workspace(claims_path: Path, gt_path: Path) -> Workspace:
    con = duckdb.connect(str(claims_path))
    rules.run_all_rules(con)
    hits = alerts_mod.read_hits(con)
    base = alerts_mod.renumber(alerts_mod.build_alerts(hits) + _infra_alerts(con) + temporal.run_temporal_signals(con))
    prov = {r[0]: {"specialty_code": r[1], "name_syn": r[2], "enroll_dt": r[3]}
            for r in con.execute("SELECT provider_id, specialty_code, name_syn, enroll_dt FROM provider").fetchall()}
    spec_of = {p: v["specialty_code"] for p, v in prov.items()}
    pfeat = provider_features(con)
    pred = _predict(con, gt_path, {p: v["enroll_dt"] for p, v in prov.items()})
    invs = [{"id": i, "provider": p, "scheme": s, "closed": c, "disposition": d, "reason": r, "exposure": e}
            for i, p, s, c, d, r, e in con.execute(
                "SELECT investigation_id, provider_id, scheme_type, closed_dt, disposition, reason_code, exposure "
                "FROM investigation").fetchall()]
    seeds = prec.seed_precedents(pfeat, invs, spec_of)
    vecs = [prec.fv_vector(f, 0.0, 0) for f in pfeat.values()]
    stats = prec.fv_stats(vecs)
    for i in (prec.FV_NAMES.index("log_dollars"), prec.FV_NAMES.index("n_channels")):   # not defined per provider
        stats["mean"][i], stats["sd"][i] = 0.5, 0.3
    manifest = con.execute("SELECT table_hashes_json FROM gen_manifest").fetchone()[0]
    return Workspace(
        con=con, gt_path=gt_path, hits=hits, base_alerts=base, prov=prov,
        acuity=dict(con.execute("SELECT member_id, acuity_score FROM member").fetchall()),
        provider_lines=dict(con.execute(
            "SELECT rendering_provider_id, COUNT(*) FROM claim_line GROUP BY 1").fetchall()),
        hcpcs_label=dict(con.execute("SELECT hcpcs, short_label FROM ref_hcpcs").fetchall()),
        excl=dict(con.execute("SELECT provider_id, MIN(excl_dt) FROM exclusion GROUP BY 1").fetchall()),
        units={(c, n): u for c, n, u in con.execute(
            "SELECT DISTINCT l.claim_id, l.line_no, l.units FROM claim_line l "
            "JOIN out_rule_hit h ON h.claim_id = l.claim_id AND h.line_no = l.line_no").fetchall()},
        hit_meta={(h["claim_id"], h["line_no"], h["rule_id"]): h for h in hits}, pfeat=pfeat, pred=pred,
        view_data=views.load_view_data(con), seeds=seeds, fv_stats=stats, spec_of=spec_of,
        data_hash=hashlib.sha256(manifest.encode()).hexdigest(), investigations=invs,
        member_region=dict(con.execute("SELECT member_id, region FROM member_location").fetchall()),
        provider_region=dict(con.execute("SELECT provider_id, region FROM provider_location").fetchall()),
        provider_rural=dict(con.execute("SELECT provider_id, is_rural FROM provider_location").fetchall()),
        provider_facility=_facility_map(con),
        hcpcs_family=dict(con.execute("SELECT hcpcs, family FROM ref_hcpcs").fetchall()))


@dataclass
class Analysis:
    run_id: str
    alerts: list
    scored: list[ScoredCase]
    rows: dict
    funnel: dict
    dashboard: dict
    eval_doc: dict
    suppressed: dict[str, list]            # excId -> suppressed alerts
    exceptions: list[exc.ExceptionRule]
    precedents: list[prec.Precedent]
    lint: list[dict]
    seeds_rows: list[dict]


def _precedent_from_dict(d: dict) -> prec.Precedent:
    return prec.Precedent(d["precedentId"], "LIVE", d["schemeType"], d.get("specialtyCode"), d["disposition"],
                          d.get("reasonCode"), list(d["featureVector"]), list(d.get("ruleIds", [])),
                          d.get("rationale", ""), str(d.get("closedDt", "")), d.get("status", "ACTIVE"))


def _diff(prev: dict, scored: list[ScoredCase], monitors: list[dict], funnel: dict, suppressed: dict) -> dict:
    """What changed against the previous run: counts, tier changes (with the exception responsible), new cases."""
    if not prev:
        return {}
    pf = prev["funnel"]
    stage = {s["key"]: s["count"] for s in funnel["stages"]}
    pstage = {s["key"]: s["count"] for s in pf["stages"]}
    now = {s.draft.case_id: s for s in scored if s.tier != "LOW"}
    exc_of_provider = {a.provider_id: eid for eid, al in suppressed.items() for a in al}
    changes = []
    for cid, old in sorted(prev["cases"].items()):
        if cid in now:
            if now[cid].tier != old["tier"]:
                changes.append({"caseId": cid, "from": old["tier"], "to": now[cid].tier, "via": None})
            continue
        via = next((exc_of_provider[p] for p in old["providers"] if p in exc_of_provider), None)
        changes.append({"caseId": cid, "from": old["tier"], "to": "MONITOR", "via": via})
    new = sorted(set(now) - set(prev["cases"]))
    return {"fromRun": prev["runId"], "alerts": stage["alerts"] - pstage["alerts"],
            "active": stage["active"] - pstage["active"], "cases": stage["cases"] - pstage["cases"],
            "inCapacity": stage["inCapacity"] - pstage["inCapacity"], "tierChanges": changes, "newCases": new,
            "dollarsExact": round(funnel["dollars"]["exact"] - pf["dollars"]["exact"], 2),
            "dollarsEstimated": round(funnel["dollars"]["estimated"] - pf["dollars"]["estimated"], 2),
            "suppressedByException": {k: len(v) for k, v in sorted(suppressed.items())}}


def knowledge_lint(run_id: str, ws: Workspace, precedents: list[prec.Precedent], exceptions: list[exc.ExceptionRule],
                   suppressed: dict[str, list]) -> list[dict]:
    findings: list[dict] = []

    def add(kind: str, severity: str, entities: list[str], message: str) -> None:
        findings.append({"run_id": run_id, "finding_id": f"LF-{len(findings) + 1:03d}", "type": kind,
                         "severity": severity, "entities_json": json.dumps(entities), "message": message})

    active = [p for p in precedents if p.status == "ACTIVE"]
    for i, a in enumerate(active):
        for b in active[i + 1:]:
            s = prec.similarity(a.fv, b.fv, ws.fv_stats)
            if s >= 0.9 and {a.disposition, b.disposition} == {"CONFIRMED", "UNFOUNDED"}:
                add("CONFLICTING_PRECEDENTS", "WARN", [a.precedent_id, b.precedent_id],
                    f"{a.precedent_id} and {b.precedent_id} look alike (similarity {s:.2f}) but were closed "
                    f"differently")
            elif s >= 0.98 and a.disposition == b.disposition and a.source == "LIVE" and b.source == "LIVE":
                add("NEAR_DUPLICATE_PRECEDENTS", "INFO", [a.precedent_id, b.precedent_id],
                    f"{a.precedent_id} and {b.precedent_id} are near duplicates; treat as one reinforced precedent")
    for p in active:
        if p.source == "LIVE" and len(p.rationale) < 40:
            add("WEAK_PRECEDENT", "WARN", [p.precedent_id], f"{p.precedent_id} has a very short rationale")
    n_prov: Counter = Counter(ws.spec_of.values())
    for r in exceptions:
        used = len(suppressed.get(r.exc_id, []))
        spec = r.scope.get("specialty_code")
        affected = len({a.provider_id for a in suppressed.get(r.exc_id, [])})
        base = n_prov[spec] if spec else len(ws.spec_of)
        if used == 0:
            add("UNUSED_EXCEPTION", "INFO", [r.exc_id], f"{r.exc_id} suppressed no alert in this run")
        if base and affected / base > exc.BREADTH_WARN:
            add("OVER_BROAD_EXCEPTION", "WARN", [r.exc_id], f"{r.exc_id} affects {affected / base:.0%} of providers")
        if r.support_n < 2:
            add("LOW_SUPPORT_EXCEPTION", "WARN", [r.exc_id], f"{r.exc_id} rests on a single precedent")
        if r.review_due and r.review_due <= ref.ASOF.isoformat():
            add("STALE_EXCEPTION", "WARN", [r.exc_id], f"{r.exc_id} passed its review date {r.review_due}")
    section_ids = {s[0] for s in ref.POLICY_SECTIONS}
    for rid, v in sorted(ref.RULES.items()):
        if v[3] not in section_ids:
            add("POLICY_DRIFT", "WARN", [rid], f"{rid} cites policy section {v[3]}, which does not exist")
    return findings


def analyse(ws: Workspace, *, run_id: str, previous: dict | None = None,
            exceptions: list[exc.ExceptionRule] | None = None, live_precedents: list[dict] | None = None,
            capacity_hours: float = rows_mod.DEFAULT_CAPACITY_HOURS, store: bool = True) -> Analysis:
    previous = previous or {}
    exceptions = exceptions if exceptions is not None else list(exc.SEED_EXCEPTIONS)
    precedents = list(ws.seeds) + [_precedent_from_dict(p) for p in (live_precedents or [])]
    alerts = copy.deepcopy(ws.base_alerts)
    pfeat = copy.deepcopy(ws.pfeat)
    suppressed = exc.apply(alerts, pfeat, ws.spec_of, exceptions)
    if store:
        alerts_mod.store_alerts(ws.con, run_id, alerts)
    drafts = consolidate(ws.con, alerts, ws.hits)
    prev_subj = {cid: set(v["providers"]) for cid, v in previous.get("cases", {}).items()}
    assign_case_ids(drafts, prev_subj)
    enroll = {p: v["enroll_dt"] for p, v in ws.prov.items()}
    scored = score_drafts(drafts, acuity=ws.acuity, enroll=enroll, provider_lines=ws.provider_lines, asof=ref.ASOF,
                          predictions=ws.pred["predictions"], prediction_eval=ws.pred["eval"], pfeat=pfeat,
                          precedents=precedents, fv_stats=ws.fv_stats, specialty_of=ws.spec_of)
    in_case = {p for s in scored for p, _r in s.draft.subjects}
    sup_groups = []
    for eid, als in sorted(suppressed.items()):
        rule = next(r for r in exceptions if r.exc_id == eid)
        if rule.effect != "DOWNGRADE_TO_MONITOR":
            continue
        by_p: dict[str, list] = defaultdict(list)
        for a in als:
            by_p[a.provider_id].append(a)
        for p, pa in sorted(by_p.items()):
            if p in in_case:
                continue                                # the provider still has other, unexcepted alerts
            hyp = Counter()
            for a in pa:
                hyp[a.scheme_type] += a.dollars
            sup_groups.append({"excId": eid, "provider": p, "dollars": round(sum(a.dollars for a in pa), 2),
                               "hypotheses": [{"code": c, "text": ref.HYPOTHESIS_TEXT[c], "dollars": round(v, 2)}
                                              for c, v in sorted(hyp.items(), key=lambda kv: (-kv[1], kv[0]))],
                               "alerts": len(pa)})
    ctx = PackContext(run_id=run_id, asof=ref.ASOF, provider_info=ws.prov, hcpcs_label=ws.hcpcs_label,
                      exclusion_dt=ws.excl, member_region=ws.member_region, provider_region=ws.provider_region,
                      provider_rural=ws.provider_rural, provider_facility=ws.provider_facility,
                      hcpcs_family=ws.hcpcs_family, member_acuity=ws.acuity,
                      mean_acuity=(sum(ws.acuity.values()) / len(ws.acuity)) if ws.acuity else 0.0)
    rows = rows_mod.build_rows(run_id, scored, ctx, ws.units, ws.hit_meta, capacity_hours, view_data=ws.view_data,
                               suppressed=sup_groups)
    in_cap_lines = {k for s in scored if rows["in_capacity"].get(s.draft.case_id) for k in s.line_dollars}
    rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    provider_tier: dict[str, str] = {}
    for s in scored:
        for p, _role in s.draft.subjects:
            if rank[s.tier] > rank.get(provider_tier.get(p, ""), 0):
                provider_tier[p] = s.tier
    provider_case = {p: s.draft.case_id for s in scored for p, _r in s.draft.subjects}
    eval_doc = evaluate(ws.con, ws.gt_path, ws.hits, in_cap_lines, provider_tier, provider_case, alerts)
    eval_doc["prediction"] = ws.pred["eval"]
    n_active = sum(1 for a in alerts if a.suppressed_by_exception_id is None)
    funnel = rows_mod.build_funnel(run_id, len(alerts), n_active, scored, rows["in_capacity"], eval_doc["coverage"])
    funnel["tiers"]["MONITOR"] = len(rows["monitors"])
    funnel["suppressedByException"] = {k: len(v) for k, v in sorted(suppressed.items())}
    funnel["diffFrom"] = previous.get("runId")
    funnel["diff"] = _diff(previous, scored, rows["monitors"], funnel, suppressed)
    dashboard = rows_mod.build_dashboard(run_id, scored, funnel)
    # how many cases would sit in a different tier if no precedent existed (the "knowledge compounds" proof)
    plain = score_drafts(drafts, acuity=ws.acuity, enroll=enroll, provider_lines=ws.provider_lines, asof=ref.ASOF,
                         predictions=ws.pred["predictions"], prediction_eval=ws.pred["eval"], pfeat=pfeat,
                         precedents=None, fv_stats=ws.fv_stats, specialty_of=ws.spec_of)
    without = {s.draft.case_id: s.tier for s in plain}
    changed = [{"caseId": s.draft.case_id, "without": without.get(s.draft.case_id), "with": s.tier}
               for s in scored if without.get(s.draft.case_id) != s.tier]
    dashboard["compounding"] = {"tierChangedByPrecedent": changed,
        "activeExceptions": len(exceptions), "livePrecedents": len(live_precedents or []),
        "seedPrecedents": len(ws.seeds), "alertsSuppressed": sum(len(v) for v in suppressed.values()),
        "casesWithPrecedent": sum(1 for s in scored if s.matches and s.tier != "LOW"),
        "casesTotal": sum(1 for s in scored if s.tier != "LOW")}
    rows["seeds"] = [{"precedent_id": p.precedent_id, "investigation_id": None, "scheme_type": p.scheme_type,
                      "specialty_code": p.specialty_code, "disposition": p.disposition, "reason_code": p.reason_code,
                      "rule_ids_json": "[]", "feature_vector_json": rows_mod.dumps(
                          {"names": prec.FV_NAMES, "vector": p.fv}), "fv_version": prec.FV_VERSION,
                      "rationale": p.rationale, "exposure": None, "recovered": None, "closed_dt": p.closed_dt}
                     for p in ws.seeds]
    rows["lint"] = knowledge_lint(run_id, ws, precedents, exceptions, suppressed)
    return Analysis(run_id, alerts, scored, rows, funnel, dashboard, eval_doc, suppressed, exceptions, precedents,
                    rows["lint"], rows["seeds"])


# --------------------------------------------------------------------------------------------- simulation
def simulate(ws: Workspace, draft: exc.ExceptionRule, base_exceptions: list[exc.ExceptionRule],
             live_precedents: list[dict] | None = None) -> dict:
    """What would this exception do? Two dry analyses (without it and with it) compared."""
    base = analyse(ws, run_id="SIM-BASE", exceptions=base_exceptions, live_precedents=live_precedents, store=False)
    cand = analyse(ws, run_id="SIM-CAND", exceptions=base_exceptions + [draft], live_precedents=live_precedents,
                   store=False)
    hit = cand.suppressed.get(draft.exc_id, [])
    providers = sorted({a.provider_id for a in hit})
    base_cases = {s.draft.case_id: s for s in base.scored if s.tier != "LOW"}
    cand_cases = {s.draft.primary: s for s in cand.scored if s.tier != "LOW"}
    shifts: Counter = Counter()
    affected, dollars = [], 0.0
    for cid, s in sorted(base_cases.items()):
        c = cand_cases.get(s.draft.primary)
        if c is None or c.tier != s.tier:
            shifts[f"{s.tier}->{c.tier if c else 'MONITOR'}"] += 1
            affected.append(cid)
            dollars += s.dollars_exact + s.dollars_est
    conflicts = []
    for p in providers:
        fv = prec.fv_vector(ws.pfeat[p], 0.0, 0)
        for pr in base.precedents:
            if pr.disposition == "CONFIRMED" and pr.status == "ACTIVE" \
                    and prec.similarity(fv, pr.fv, ws.fv_stats) >= prec.STRONG_SIM:
                conflicts.append(pr.precedent_id)
    spec = draft.scope.get("specialty_code")
    pool = sum(1 for sp in ws.spec_of.values() if spec is None or sp == spec)
    hard = sum(1 for a in hit if a.rule_id in ref.HARD_FACT_RULES)
    lines = {(c, n) for a in hit for c, n, _d in a.lines}
    lost = positive_lines_among(ws.gt_path, lines) if lines else 0
    report = {"alertsSuppressed": len(hit), "providersAffected": len(providers), "providers": providers,
              "casesAffected": len(affected), "affectedCases": affected, "dollarsNoLongerReviewed": round(dollars, 2),
              "tierShifts": dict(sorted(shifts.items())), "conflictsWithConfirmed": sorted(set(conflicts)),
              "breadthShare": round(len(providers) / pool, 4) if pool else 0.0, "hardFactTouches": hard,
              "groundTruthPositivesLost": lost}
    report["lint"] = exc.lint(draft, confirmed_conflicts=report["conflictsWithConfirmed"],
                              breadth=report["breadthShare"], hard_touches=hard, gt_lost=lost)
    return report
