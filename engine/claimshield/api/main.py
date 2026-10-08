"""Internal engine API. Bound to 127.0.0.1 and reachable only from the Java gateway.

Every route requires the shared secret in the X-Engine-Token header. The engine runs ONE job at a time; a re-run
publishes a new complete run into app.db (serving_* only) and flips serving_current_run in one transaction.
"""

from __future__ import annotations

import hmac
import os
import threading
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException

from claimshield import __version__, paths
from claimshield.brain import exceptions as exc
from claimshield.brain import precedents as prec
from claimshield.db import app_db


def require_token(x_engine_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ENGINE_TOKEN", "dev-engine-token")
    if x_engine_token is None or not hmac.compare_digest(x_engine_token, expected):
        raise HTTPException(status_code=401, detail="invalid engine token")


@dataclass
class Job:
    job_id: str
    status: str = "RUNNING"
    stage: str = "queued"
    run_id: str | None = None
    error: str | None = None
    diff: dict | None = None
    summary: dict | None = None


@dataclass
class EngineState:
    claims_path: Path | None = None
    gt_path: Path | None = None
    app_path: Path | None = None
    workspace: object | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    jobs: dict[str, Job] = field(default_factory=dict)
    counter: int = 0

    def paths(self) -> tuple[Path, Path, Path | None]:
        return (self.claims_path or paths.claims_db_path(), self.gt_path or paths.gt_db_path(), self.app_path)

    def ws(self):
        from claimshield import analysis
        if self.workspace is None:
            claims, gt, _app = self.paths()
            self.workspace = analysis.load_workspace(claims, gt)
        return self.workspace

    def reset(self) -> None:
        if self.workspace is not None:
            self.workspace.close()
        self.workspace = None
        self.jobs.clear()


STATE = EngineState()
app = FastAPI(title="ClaimShield engine (internal)", version=__version__)


def configure(claims: Path, gt: Path, app_db_path: Path) -> None:
    """Point the engine at specific files (tests and the dev scripts)."""
    STATE.reset()
    STATE.claims_path, STATE.gt_path, STATE.app_path = claims, gt, app_db_path


@app.get("/internal/health", dependencies=[Depends(require_token)])
def health() -> dict:
    con = app_db.connect(STATE.app_path)
    try:
        row = con.execute(
            "select name from sqlite_master where type='table' and name='serving_current_run'"
        ).fetchone()
        run = None
        if row:
            r = con.execute("select run_id from serving_current_run where id=1").fetchone()
            run = r[0] if r else None
    finally:
        con.close()
    return {"status": "UP", "version": __version__, "currentRun": run, "busy": STATE.lock.locked()}


def _rules(items: list[dict]) -> list[exc.ExceptionRule]:
    try:
        return [exc.ExceptionRule.from_dict(d) for d in items]
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"bad exception: {e}") from e


def _run_job(job: Job, rules: list[exc.ExceptionRule], live: list[dict], capacity: float) -> None:
    from claimshield.pipeline import run_pipeline
    try:
        with STATE.lock:
            ws = STATE.ws()
            _claims, gt, app_path = STATE.paths()
            summary = run_pipeline(regenerate=False, app_path=app_path, gt_path=gt, capacity_hours=capacity,
                                   exceptions=rules, live_precedents=live, workspace=ws,
                                   progress=lambda s: setattr(job, "stage", s))
        job.run_id, job.diff, job.summary = summary["runId"], summary["diff"], {
            k: summary[k] for k in ("tiers", "stages", "suppressed")}
        job.status, job.stage = "DONE", "done"
    except Exception as e:                                           # noqa: BLE001 - reported to the caller
        job.status, job.error = "FAILED", f"{type(e).__name__}: {e}"
        traceback.print_exc()


@app.post("/internal/rerun", status_code=202, dependencies=[Depends(require_token)])
def rerun(body: dict) -> dict:
    if any(j.status == "RUNNING" for j in STATE.jobs.values()):
        raise HTTPException(status_code=409, detail="JOB_RUNNING")
    rules = _rules(body.get("exceptions", []))
    for r in rules:
        errs = exc.validate(r)
        if errs:
            raise HTTPException(status_code=422, detail=f"{r.exc_id}: " + "; ".join(errs))
    STATE.counter += 1
    job = Job(f"E-{STATE.counter}")
    STATE.jobs[job.job_id] = job
    threading.Thread(target=_run_job, args=(job, rules, body.get("livePrecedents", []),
                                            float(body.get("capacityDefaultHours", 240.0))), daemon=True).start()
    return {"engineJobId": job.job_id}


@app.get("/internal/jobs/{job_id}", dependencies=[Depends(require_token)])
def job(job_id: str) -> dict:
    j = STATE.jobs.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="unknown job")
    return {"status": j.status, "stage": j.stage, "runId": j.run_id, "error": j.error, "diff": j.diff,
            "summary": j.summary}


@app.post("/internal/exceptions/propose", dependencies=[Depends(require_token)])
def propose(body: dict) -> dict:
    """Draft an exception from a rejected case. The conditions come from a closed catalogue; nothing is free text."""
    with STATE.lock:
        ws = STATE.ws()
        provider = body["provider"]
        if provider not in ws.pfeat:
            raise HTTPException(status_code=404, detail="unknown provider")
        try:
            draft = exc.propose(
                case_id=body["caseId"], provider=provider, specialty=ws.spec_of[provider],
                rule_ids=list(body["ruleIds"]), reason_code=body["reasonCode"], pf=ws.pfeat[provider],
                support_n=int(body.get("supportN", 1)), source_precedent_id=body.get("sourcePrecedentId"),
                exc_id=body["excId"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
    return draft.to_dict()


@app.post("/internal/simulate", dependencies=[Depends(require_token)])
def simulate(body: dict) -> dict:
    from claimshield import analysis
    draft = _rules([body["draft"]])[0]
    errs = exc.validate(draft)
    if not STATE.lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="JOB_RUNNING")
    try:
        ws = STATE.ws()
        base = _rules(body.get("exceptions", []))
        if errs:    # a malformed draft is reported as a BLOCK, never run
            return {"alertsSuppressed": 0, "providersAffected": 0, "casesAffected": 0, "tierShifts": {},
                    "dollarsNoLongerReviewed": 0.0, "conflictsWithConfirmed": [], "breadthShare": 0.0,
                    "hardFactTouches": 0, "groundTruthPositivesLost": 0,
                    "lint": exc.lint(draft, confirmed_conflicts=[], breadth=0.0, hard_touches=0, gt_lost=0)}
        return analysis.simulate(ws, draft, base, body.get("livePrecedents", []))
    finally:
        STATE.lock.release()


@app.post("/internal/precedent/check", dependencies=[Depends(require_token)])
def precedent_check(body: dict) -> dict:
    """Conflict (cosine >= 0.9, opposite disposition) and reinforcement (>= 0.98, same disposition) detection."""
    with STATE.lock:
        ws = STATE.ws()
        conflicts, reinforces = [], []
        new_fv, disp = body["featureVector"], body["disposition"]
        existing = [{"precedentId": p.precedent_id, "featureVector": p.fv, "disposition": p.disposition}
                    for p in ws.seeds] + body.get("active", [])
        for e in existing:
            s = prec.similarity(new_fv, e["featureVector"], ws.fv_stats)
            if s >= 0.98 and e["disposition"] == disp:
                reinforces.append({"precedentId": e["precedentId"], "similarity": round(s, 4)})
            elif s >= 0.9 and {e["disposition"], disp} == {"CONFIRMED", "UNFOUNDED"}:
                conflicts.append({"precedentId": e["precedentId"], "similarity": round(s, 4)})
    return {"conflicts": conflicts, "reinforces": reinforces}
