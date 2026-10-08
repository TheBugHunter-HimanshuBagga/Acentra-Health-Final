# ClaimShield Nexus

An SIU (Special Investigations Unit) intelligence platform for the Acentra Health Hiring Hackathon (Problem 3). It turns thousands of unexplained claim alerts into a short, ranked list of **evidence-backed cases** that investigators can understand, review and approve, and it **learns from every approved decision** (precedents and governed exception rules).

> All data is synthetic. The system produces *indicators that require human investigation*. It never labels anything as fraud and never takes an action without a human.

## Architecture in one glance

```
Browser (React) ──▶ Spring Boot gateway :8080 ──▶ app.db (SQLite)  ◀── Python engine :8000 (internal only)
                        │  auth, workflow, audit, validator            analytics, detection, evidence packs
                        ├──▶ Claude (explains a closed evidence pack, never scores)
                        └──▶ Sarvam (Indian-language STT / translation / TTS)
```
Engine writes `serving_*` tables, gateway writes `wf_*` tables, neither writes the other's. See `docs/ClaimShield_Nexus_Implementation_Architecture.md`.

## Quickstart (Windows, macOS, Linux)

Requirements: Node 22+ (tested on 24), Python 3.12, Java 25 (Boot 4 supports 17+), Maven 3.9, Docker (optional).

```bash
npm run setup     # Python venv + packages, web packages, Java build, creates .env
npm run dev       # web :5173, gateway :8080, engine :8000 (127.0.0.1) with prefixed logs
npm test          # web (Vitest) + engine (pytest) + gateway (JUnit)
npm run lint
npm run pipeline     # generate data, run the six rules, build cases and packs, publish into data/app.db
npm run e2e:m1       # fresh engine DB -> gateway full review flow (no browser)
npm run e2e:ui       # real browser (Edge/Chromium) against real servers; run from a normal terminal
npm run fixture      # regenerate the gateway test fixture from the real pipeline
npm run reset-demo   # restore data/app.db from data/demo/app.db.snapshot (services stopped)
docker compose up --build   # prod-like: gateway (serves the SPA) + engine
```
Put API keys in `.env` (never commit it). With `LLM_MODE=template` and `VOICE_ENABLED=false` the app runs with no external keys.

## Repository layout

| Path | What |
|---|---|
| `web/` | React 19 + TypeScript + Vite, Tailwind v4, shadcn/ui, GSAP, Lenis, Recharts, Cytoscape |
| `gateway/` | Spring Boot 4.1 (Java 25): security, workflow, audit, Claude and Sarvam integration |
| `engine/` | Python 3.12: data generation, detection, graph, prediction, cases, evidence packs |
| `contracts/` | Shared SQL schemas and JSON schemas (change here first) |
| `config/` | Generation and injection settings (seeds, sizes) |
| `data/` | `raw/` (git-ignored downloads), `processed/`, `demo/` (committed snapshot) |
| `docs/` | Design documents and the official problem statement |
| `scripts/` | Cross-platform dev scripts |
| `infra/` | Dockerfiles |

## Documents
Start with `context.md`, then `docs/ClaimShield_Nexus_Execution_Plan.md` (what to build in which hour) and `docs/ClaimShield_Nexus_Implementation_Architecture.md` (APIs, flows). Deeper design: data, engine, AI/Second Brain, frontend.

## Milestone M1 (implemented)
Synthetic data -> six rules -> alerts -> cases -> scores -> SIU queue -> evidence pack -> investigator review (Accept/Modify/Reject) -> supervisor approval -> action -> decision -> audit, in a real browser. Demo logins are seeded from `gateway/src/main/resources/demo-users.csv` (demo-only random passwords); use the role switcher in the header to act as the supervisor and auditor.

## Investigation brief
Each case can generate a validated brief (evidence, timeline, network context, confidence, limitations, recommended human-review action, case/risk context). It is built deterministically from the evidence pack and passes a strict validator (citations, numbers, entities, actions, wording). A future model-written brief goes through the same validator and falls back to the template if it fails.

## Honest limits
- Evaluation is against **synthetic ground truth we injected**; it shows the engine is correct and consistent, not real-world detection power.
- Prevalence is enriched for evaluation; natural rule hits in the base data are unlabelled, so precision is a lower bound.
- Demo-grade authentication only.
