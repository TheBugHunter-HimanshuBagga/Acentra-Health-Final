# ClaimShield Nexus

An SIU (Special Investigations Unit) intelligence platform for the Acentra Health Hiring Hackathon (Problem 3). It turns thousands of unexplained claim alerts into a short, ranked list of **evidence-backed cases** that investigators can understand, review and approve, and it **learns from every approved decision** (co-signed precedents and governed exception rules).

> All data is synthetic. The system produces *indicators that require human investigation*. It never labels anything as fraud, never takes an action without a human, and prediction is prioritisation, not proof.

## What is implemented (and verified)

| Area | What it does |
|---|---|
| Detection | Duplicate billing, upcoding, unbundling / procedure-code anomalies, excessive utilization, phantom/ghost patterns (death, inpatient overlap), impossible timing, geographic anomalies, peer comparison (robust z, shrinkage), temporal behaviour (CUSUM, growth, ramp), network (ownership groups, referral loops/concentration, shared infrastructure) |
| Corroboration | Four independent evidence channels (LINE, PEER, SELF, NETWORK). HIGH needs a recorded hard fact plus corroboration or three channels; peer-only or own-history-only signals stay on the Monitor list |
| Decoys | Legitimate look-alikes (D1 high-acuity, D2 shared building, D3, D4) are flagged weakly or not at all; the evaluation reports it |
| SIU queue | Ranked by risk, dollars (exact vs estimated shown separately), member impact, severity, evidence strength, with investigation hours against a capacity and a 30/60/90-day horizon selector |
| Prediction | 30/60/90-day outlook (HGB vs logistic regression chosen on validation), provider- and time-based split, bootstrap intervals, compared with persistence baselines; re-ranks the queue; shown as an estimate, never as evidence |
| Evidence packs | Closed, hashed world per case (evidence, numbers, timeline, network, precedents, policies, limitations) |
| Briefs | Seven-element investigation brief. Claude (server side only) may write it; a Java validator (V1-V15: citations, numbers, entities, wording, tier, actions, limitations) accepts or rejects it, one retry, then a deterministic template. Never shown unvalidated |
| Workflow | Investigator review (accept / modify / reject / request info), supervisor approval for high-impact actions (two-person rule), simulated action, close with rationale |
| Second Brain | Closing a case creates a precedent; a different supervisor co-signs; an UNFOUNDED, legitimate-reason precedent can become a **draft exception** in a closed DSL; simulation on real data with a lint verdict (BLOCK cannot be approved); governance (a third person) approves; the engine re-runs; the funnel diff names the changes; recorded-fact rules can never be excepted |
| Audit | Hash-chained, tamper-evident audit trail with verification and filters |
| Assistant | Read-only chat answered from validated facts (optional Claude phrasing passes a validator); refusals for medical, legal, action, injection, evasion; Sarvam translation of answers and voice (STT/TTS) in 10 Indian languages + English; falls back to English / typing when a service is down |
| Frontend | Onboarding and language choice, executive dashboard, queue, investigation workspace (brief, evidence explorer, claim lines, timeline, network graph, outlook, confidence, similar cases, decision, history), precedents, rules and exceptions, audit, library, assistant with voice |

## Architecture in one glance

```
Browser (React) ──▶ Spring Boot gateway :8080 ──▶ app.db (SQLite)  ◀── Python engine :8000 (internal only)
                        │  auth, workflow, audit, validators           analytics, detection, evidence packs
                        ├──▶ Claude (explains a closed evidence pack, never scores)
                        └──▶ Sarvam (translation / speech)
```

The engine writes only `serving_*` tables, the gateway only `wf_*` tables. Ground truth lives in a separate `gt.duckdb` that only the generator, the evaluation and the orchestrators may open (a test enforces it). API keys exist only in the gateway process.

## Quickstart

Requirements: Node 22+ (tested on 24), Python 3.12, Java 25, Maven 3.9, Docker (optional).

```bash
npm run setup     # Python venv + packages, web packages, Java build, creates .env
npm run pipeline  # generate synthetic data, run detection, publish data/app.db (+ claims.duckdb, gt.duckdb)
npm run dev       # web :5173, gateway :8080, engine :8000
```

Open http://localhost:5173. Demo accounts (passwords are in `gateway/src/main/resources/demo-users.csv`): `investigator`, `supervisor`, `governance`, `auditor`. With `DEMO_MODE=true` the top bar can switch role so one browser can show every approval.

Docker (gateway serves the built web app; the engine seeds its volume on first start):

```bash
docker compose up --build     # then open http://localhost:8080
```

### Configuration (`.env`, never committed)

`LLM_MODE=template|live` with `ANTHROPIC_API_KEY`; `VOICE_ENABLED=true` with `SARVAM_API_KEY`; `DEMO_MODE`; `ENGINE_URL`, `ENGINE_TOKEN`; `APP_DB_PATH`; `DATA_DIR`. With the defaults the app runs with no external keys (template briefs, typed chat, English).

## Quality gates

```bash
npm run fixture     # regenerate the gateway fixture from the real pipeline
npm test            # web (Vitest) + engine (pytest) + gateway (JUnit)
npm run lint
npm run build
npm run e2e:m1      # real engine data -> gateway review flow (no browser)
npm run e2e:ui      # real browser: login, onboarding, queue, case, approval, close, audit
npm run e2e:brain   # real browser + real engine: close, co-sign, exception, simulate, approve, re-run, diff
```

The e2e scripts start real servers, so run them from a normal terminal.

## Repository layout

| Path | What |
|---|---|
| `web/` | React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, GSAP, Lenis, Recharts, Cytoscape, i18next |
| `gateway/` | Spring Boot 4.1 (Java 25): security, workflow, audit, validators, Claude and Sarvam clients |
| `engine/` | Python 3.12: generator, detectors, graph, prediction, cases, evidence packs, precedents, exceptions |
| `contracts/` | Shared SQL and JSON schemas |
| `scripts/` | Cross-platform dev, e2e and translation scripts |
| `infra/` | Dockerfiles and the engine entrypoint |
| `docs/` | Design documents and the official problem statement |

## Honest limits

- Data is generated by `engine/claimshield/generate/mini.py`. The CMS synthetic-data adapter was **not** built; the generator is the data source.
- Precision and recall are measured against synthetic ground truth the generator injected; real-world accuracy is unknown. Prediction labels are synthetic too.
- The live Claude path has no API key in this repository, so it is exercised only through fakes; the template brief path and validator are fully tested.
- Interface text is translated at build time; evidence and policy text stay in English so every figure can be checked.
- Rotate any API key that was ever pasted into a chat or a terminal.
