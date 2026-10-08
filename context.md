# ClaimShield Nexus: Project Context

*Hand-off summary. Read section 0 first: it is the verified final state (2026-10-08). Sections 4-13 are build history; where they say "not built yet" the code supersedes them.*

---

## 0A. HACKATHON-GRADE UPGRADE (2026-10-09): what changed after section 0

Additive on top of everything below; nothing removed.

- **Engine**: evidence pack `pk_v1` now also carries `impact` (IM1..IM8 with EXACT/ESTIMATED/DERIVED basis, why, evidence ids, source fields), `confidence` (risk, evidence and confidence kept apart; routes HIGH_NONBLOCKING / EXPERT_REVIEW / ESCALATE_INSUFFICIENT with the text "Insufficient evidence - human review required."), `reasoning` (RS1..RS7: retrieve, interpret, apply rules, propose, score, cite, human review), `explanation` (why flagged / why not flagged) and per-evidence `observation`. Code: `engine/claimshield/evidence/insight.py`; tests `engine/tests/test_insight.py`.
- **Gateway**: server-side Gemini key pool (`ai/GeminiPool`, `GeminiLlmClient`, `RoutingLlmClient`; per-key RPM/TPM windows, 429 rotation and cooldown, backoff, circuit breaker, request cache, no secrets logged; `GET /api/ai/usage`), grounded AI reasoning with the existing validator and a labelled deterministic fallback (`reasoning/ReasoningService`), governed feedback and knowledge (`LearningService`: feedback categories, extracted lessons PENDING_REVIEW then approved by a different supervisor/governance user, approved knowledge informs explanations only), institutional memory endpoint, human handoff in the same chat (`HandoffService`, SSE stream, specialist desk, PII refusal, every message audited by hash). New tables are in `contracts/sql/wf_schema.sql` (wf_ai_output, wf_feedback, wf_knowledge_item, wf_handoff, wf_handoff_message).
- **Web**: Case workspace shows the Risk/Evidence/Confidence triad, case impact with "Why do we believe this?", the reasoning chain, why flagged / not flagged, AI reasoning (validated or labelled fallback), feedback, institutional memory; queue has confidence/evidence/impact/exposure columns, filters, saved views (browser storage) and search; dashboard has distributions, networks, trends, outlook; network view has search, filter and expand; command palette (Ctrl+K); specialist desk page; chat handoff. 87 new interface strings translated into the 10 languages.
- **CMS DE-SynPUF**: `engine/claimshield/adapters/cms_desynpuf.py` ingests the real files, labels each field SOURCE / DERIVED / TRANSFORMED / NOT_AVAILABLE / SYNTHETIC_OVERLAY (`cms_provenance`, `data/cms/validation.json`), derives ownership groups (shared tax number) and care-path links (not confirmed), adds five labelled overlay patterns whose labels live only in `data/cms/gt.duckdb`, and was run through the full pipeline into `data/cms/app-cms.db` (10,202 alerts, 528 cases). Details and recall in `docs/CMS_DESYNPUF.md`. The gateway still serves the generated dataset by default.
- **Gates run 2026-10-09**: engine pytest 231 passed; gateway `mvn -q -o test` 189 run, 0 failures, 5 skipped; web vitest 55 passed; tsc clean; oxlint 0 errors (warnings only); production build OK; `npm run e2e:ui` passed.
- **Added 2026-10-09 (copilot round)**: `reasoning/CopilotService` + endpoints `POST /api/cases/{id}/copilot` (one question, 12/min per user, 300 chars, "not in the pack" is an allowed answer), `/challenge` (devil's advocate from conflicting and missing evidence), `/network-analysis` (graph metrics counted by the backend, AI only narrates). Same validator, one retry with the valid placeholder list, labelled fallback. Core-care protection (`insight.is_core_care`) marks emergency, critical-care, dialysis and chemotherapy lines and blocks automation eligibility. Web: `CopilotViews.tsx`, redesigned `NetworkSection` (metrics, inspector, zoom controls, AI reading), container-query layouts so the case page no longer clips at laptop widths. Verified live with the three Gemini keys: 8 of 8 calls validated, keys used evenly, no rate limiting. Tests now: gateway 194 run/0 fail, web 59 pass, e2e:ui passes with the copilot steps.
- **Investigation canvas (2026-10-09)**: `web/src/features/investigate/` (`/investigate`, `/investigate/:caseId`). Custom SVG scene graph with its own camera (pan, wheel zoom, drag-and-pin, multi-select, fit, centre, reset, fullscreen, search, type filters, claims layer, double-click expand), typed entity tiles, curved links with labels and travelling signals, an inspector rebuilt per selection (provider, owner, member, claim, relationship), a copilot that reads the selection and drives the graph (show claims, everyone connected through X, trace path A to B; anything else goes to the validated server copilot), and a playback built from the case's own records (ownership, claims, members, each evidence item, relationships, risk build-up ending on the engine score, SIU recommendation with the human decision). Only real entities are drawn; unscored providers show no risk; links are labelled derived. Tests: `investigate.test.ts` (11), e2e step in `m1.spec.ts`.
- **Round 2026-10-09 (desk, brand, motion)**: per-person notifications (`wf_notification`, `NotificationService`, `GET /api/notifications`, `POST /api/notifications/read`; a request notifies every supervisor and governance user, joins/messages/closes notify the other person, repeated messages fold into one entry, message text is never in a notification); bell with unread badge, popover and toasts in the header, sign-in summary toast; specialist desk opens from a notification (`/agent?open=`). Landing: the supplied brand mark floats on the dither globe and tilts, glows and ripples with the cursor (`kit/logo-globe.tsx`, `public/claimshield-mark.webp`). Login: `WorkflowOrbit`, a knotted non-linear loop where claims travel and each stage wakes and names itself. Case workspace: the old Network section is replaced by a link into the investigation canvas (the AI network reading moved into the canvas inspector). Canvas: ambient link flow, breathing primary, staggered entrance, camera fly-in, parallax grid, minimap, step card during playback. E2E now also covers the two-person chat (`zz-handoff.spec.ts`, two browser contexts; it must run after `m1.spec.ts` because it clears first-sign-in onboarding).
- **Not done / honest limits**: SSE not WebSocket; saved views in the browser; memory graph is a list; no Gemini dataset-understanding role; the live Gemini path was only exercised through fakes and a loopback server; CMS recall for duplicates and utilization overlay patterns is low (see docs); synthetic metrics are not real-world accuracy.
- **Security**: three Gemini keys and the Sarvam key live only in the git-ignored `.env`. They were pasted into chat: rotate them.

---

## 0. FINAL STATE (verified 2026-10-08, evening): READY for the demo

Everything below was run and passed in this session. Treat the code as the source of truth; older sections further down describe the build history and some "not built" wording in them is stale (see section 10).

### Gates run (all PASS)
| Command | Result |
|---|---|
| `npm run fixture` | PASS (RUN-001, 18 cases, 10 monitor, tiers HIGH 6 / MEDIUM 12 / MONITOR 10) |
| engine pytest (`npm run test:engine`) | 216 passed |
| gateway `mvn -q -o test` | 166 passed (ChatIT 18, LiveBriefIT 2, BriefFallbackIT 5, KnowledgeIT 13, AiUnitTest 13, SpaForwardIT 2 ...) |
| web `vitest` | 48 passed |
| `npm run lint` (oxlint + ruff) | PASS |
| `npm run build` | PASS (vite warns the JS chunk is 1.4 MB; harmless) |
| `npm run e2e:m1` | PASS |
| `npm run e2e:ui` | PASS (real Edge: language onboarding, dashboard, queue, case with timeline/network/outlook/confidence assertions, brief, modify + supervisor approval + carry out + close, audit verify) |
| `npm run e2e:brain` | PASS (real engine: close UNFOUNDED, co-sign, propose, simulate, submit, governance approve, re-run RUN-002, "compared with RUN-001", audit chain) |
| `docker compose config -q`, `docker compose build`, `docker compose up -d` | PASS. Engine seeded `/data` on first start, healthcheck gates the gateway, `/api/health` UP, SPA root and deep link 200, login + queue + case via the container, manual re-run produced RUN-002 |

### Visual redesign (done after the first READY, verified)
The frontend was restyled to match the Allotiq product theme exactly, at the user's request (colours, type, radius; no text, logo or assets copied):
- Tokens in `web/src/tokens.css` + `web/src/design.css`: dark `#0c0e0d` ink / cream `#f2f0e9` text / lime `#d4ff3a` accent; light warm paper `#f2f0e9` / ink `#0c0e0d` / deep green `#00583f`; viz colours `#18a06b #4f86ff #e0691f #8f78ff #d95596`; radius 1.125rem; pill buttons. Fonts: Geist, Geist Mono (uppercase eyebrow labels), Bricolage Grotesque (headings), Instrument Serif italic (hero accent).
- Dark and light are both designed; theme persists in `localStorage` (`claimshield-theme`, default dark) and switches with a circular View-Transition reveal (`web/src/lib/theme.ts`).
- GSAP + Lenis: Lenis smooth scroll driven by the GSAP ticker and synced to ScrollTrigger; hero line-mask reveal and scroll parallax, ScrollReveal sections, count-up numbers, animated bars, page transitions, Flow pipeline (line draw + one decorative pulse), dot-matrix `SignalField` canvas (decorative; pauses off-screen). All guarded for reduced motion and jsdom.
- Screens: Dashboard hero ("Your SIU Second Brain.") with the 7-stage pipeline using real counts and a ticker of real run data; posture band; SIU queue as an operations console (search, tier/horizon filters, 4-meter signal column, expandable "why it ranks here" rows); investigation workspace in 3 columns (identity | brief, evidence, claim lines, timeline, network, precedents, history | outlook, confidence, decision); provenance chips FACT / SIGNAL / CORROBORATION / PREDICTION (dashed, hatched) / HUMAN DECISION with a legend; Cytoscape network with hover trace/dim and entrance animation; 30/60/90 outlook labelled "Prioritization signal — not proof of future misconduct."; Second Brain loop strip on Precedents; governance stepper with a two-person indicator; audit as a hash-chain timeline that lights up when verified; ChatDock as an evidence-grounded copilot (grounded banner, context chip, source chips).
- New UI strings are in `web/src/i18n/ui.en.json` and were translated into 10 languages with `scripts/translate-json.mjs`.
- Verified after the redesign: `tsc`, oxlint, `npm run build`, vitest 48 pass, `npm run e2e:ui` and `npm run e2e:brain` pass in a real browser; screenshots of dashboard, queue, workspace, precedents, mobile (390 px) and light theme were inspected with Playwright/Edge.
- Not re-verified after the redesign: the Docker image (rebuild with `docker compose up --build` to see the new UI on :8080); governance, audit and library pages were checked structurally by the e2e flows but only precedents/dashboard/queue/workspace were inspected visually.

### What exists (all implemented)
Engine: all official FWA behaviours (duplicate, upcoding, unbundling/PTP, MUE/excessive utilization, phantom: death/inpatient/ghost, impossible timing, geographic), PEER/SELF/NETWORK channels, decoys D1-D4, graph, temporal (CUSUM/growth/ramp), 30/60/90 prediction, cases, scoring, evidence packs, precedents, exception DSL, simulation, re-run, funnel diff. Gateway: auth/roles, two-person rule, hash-chained audit, brief + validator V1-V15 with fallback ladder, knowledge/exception governance, chat + voice (Sarvam), Claude client (server only), SPA deep-link forwarding. Web: onboarding, dashboard, queue, case workspace, precedents, governance, audit, library, assistant with voice, 11 languages for interface chrome.

### Evaluation facts (synthetic ground truth, seeded run)
- All 19 injected schemes are flagged; every rule has recall 1.0 on its injected lines; decoys falsely flagged: 0 lines; D1 decoys reach MEDIUM at most (never HIGH); D2/D3/D4 stay LOW; the ownership ring is recovered as one case; temporal detector caught 5 of 20 scheme providers (median delay 1 month).
- Prediction is weak and the UI says so: HGB beats persistence at 30/60 days (lift 1.05/1.09) but the bootstrap CIs include zero and at 90 days it does not beat persistence (0.99); probabilities are over-confident (bins predicted ~0.95 observed ~0.6). The outlook section tells users it is a ranking score, not a calibrated chance, never evidence.

### Safety checks confirmed (code + tests)
Never labels fraud (forbidden-term checks in the brief and chat validators, templates reviewed); peer-only / own-history-only signals are tier LOW (Monitor) (`test_m2`: `tier == "LOW"`); recorded-fact rules cannot be scoped into an exception (`test_brain`); BLOCK lint cannot be submitted or approved (`KnowledgeIT` LINT_BLOCKED); the simulation BLOCKs excepting a real injected scheme (seen live in e2e:brain); proposer cannot approve and closer cannot co-sign (`SELF_APPROVAL_FORBIDDEN`); validator rejects fabricated numbers, citations, entities (`BriefValidatorTest` 54 cases, `ChatIT`); AI failure falls back to the template / validated facts / English / typing; API keys exist only in the gateway process (`.env` is git-ignored, no key appears in tracked files); ground truth is opened only by generate/, eval/ and orchestrators (guard test in `test_pack_publish.py`).

### Limitations (honest)
- The CMS synthetic-data adapter (`engine/claimshield/adapters/` is an empty placeholder) and a multi-seed evaluation were NOT built; the deterministic generator is the only data source and results are for one seed (20261008). Do not claim real-world accuracy.
- No Anthropic key in the repo: the live Claude path is exercised only through fakes (`LiveBriefIT`, `ChatIT`); the template path and validator are fully tested. Sarvam translation/STT/TTS were verified live with the provided key earlier in the session.
- The SPA is served by the gateway only in Docker (jar embeds `web/dist`); in development Vite serves it.
- First Docker start takes ~60-90 s while the engine generates data.
- All files under `data/e2e*` were removed; the scratch API dumps and Playwright artefacts were deleted.

### Start the demo
```bash
npm run pipeline        # once: generates data/claims.duckdb, gt.duckdb, app.db (RUN-001)
npm run dev             # web http://localhost:5173, gateway :8080, engine :8000
# or, containerised (open http://localhost:8080):
docker compose up --build
```
Demo users (`gateway/src/main/resources/demo-users.csv`): investigator, supervisor, governance, auditor; `DEMO_MODE=true` shows the role switcher in the top bar. Reset: `npm run reset-demo` (dev) or `docker compose down -v` (Docker).

### Judge flow (5-6 min)
1. Sign in as investigator, pick a language (or skip). Dashboard: 347 alerts become 18 cases and 10 monitor items; exact vs estimated dollars; "needs you now".
2. SIU queue: change the horizon 30/60/90 and the investigator hours; open the top HIGH case (CASE-0014) and read why it ranks (risk, dollars, member impact, severity, evidence strength, hours).
3. Case workspace: evidence explorer (filter by channel, show claim lines), timeline chart, network graph, 30/60/90 outlook (note the honesty caveat), confidence view and limitations.
4. Generate the investigation brief: badge Validated; every sentence cites evidence IDs; no typed numbers. Ask the assistant a question (optionally in Hindi / by voice).
5. Decide: Modify to PREPAY_REVIEW_FLAG with a reason, "waits for a supervisor"; switch to SUPERVISOR, Approve; back to investigator, Carry out; close CONFIRMED with a rationale.
6. Second Brain: open a decoy-look-alike MEDIUM case (CASE-0016: R-TIME-01 + S-UTL), Reject (LEGIT_CLINICAL_PATTERN), close UNFOUNDED; as SUPERVISOR co-sign on Precedents; Propose exception, Simulate, Submit; as GOVERNANCE approve and re-run; Rules page shows "compared with RUN-001" and the tier changes.
7. Audit (auditor): filter by case, Verify chain.
Story line: thousands of claims -> independent evidence channels -> few cases -> why it is ranked -> context (network, timeline) -> future risk -> Claude explains only validated evidence -> human decides -> the decision becomes governed knowledge -> next run learns -> everything auditable.

### Security / credential notes
- The Sarvam key was pasted in chat; it is only in the git-ignored `.env`. Rotate it. Never print or commit keys; `.env.example` has blanks.
- Demo passwords are random, demo-only, in `demo-users.csv`; `DEMO_MODE` must be false outside demos.

### Gotchas for the next maintainer
- JDK HttpClient must use HTTP/1.1 toward uvicorn (done in `HttpEngineClient`); h2c upgrade breaks POST bodies.
- `e2e:ui` must run only `m1.spec.ts` (done); `brain.spec.ts` needs the real engine and shares the onboarding state of a DB.
- Tests with two `LlmClient`/`BriefCandidateSource` beans need `@Primary` on the fake. `ChatService.resetRateLimits()` exists for tests.
- Write multi-line Python edit scripts with the file tool, not bash heredocs containing triple quotes.
- `.dockerignore` excludes `data/`, `node_modules`, `.venv`, `gateway/target`.

---

## 1. The project

- **Event:** Acentra Health Hiring Hackathon, Final Round. **Chosen problem: #3, ClaimShield Nexus** (marked Hard): a fraud, waste and abuse (FWA) platform for a payer's Special Investigations Unit (SIU).
- **Source of truth:** the official problem statement, copied to [`docs/source/PS_Hf.txt`](docs/source/PS_Hf.txt) (original at `Documents\PS Hf.txt`). Every requirement must be implemented and none weakened.
- **Organizer expectations (as relayed by the user in text):** a "Second Brain": connected knowledge that compounds. Reasoning chain: retrieve → interpret → apply rules → propose → score → cite → human review → knowledge compounds. Plus confidence-aware AI, human-in-the-loop, auditability, workflow orchestration, a working end-to-end prototype and not a chatbot.
- **Caveat:** the presentation screenshots were never actually attached (the only recent screenshots were from an unrelated disaster-portal app). Presentation points come from the user's pasted text.
- **Positioning:** "An SIU Second Brain: it turns thousands of unexplained alerts into a small set of evidence-backed cases, and gets smarter with every investigator decision."

### Official requirements
1. Load and analyze synthetic claims plus provider, member, facility, referral, relationship and investigation data.
2. Detect duplicate billing, upcoding, unbundling, phantom services, excessive utilization, impossible timing.
3. Use at least two complementary approaches.
4. Show relationships among providers, members, facilities, referrals, locations, ownership indicators and claims.
5. Predict repeat or escalating FWA over a selected 30/60/90-day horizon.
6. SIU queue ranked by risk, potential dollars, member impact, severity, evidence strength and investigation capacity.
7. Explainable brief: evidence, timeline, network context, confidence, limitations, recommended human-review action.
8. Outcome: thousands of alerts become a smaller ranked set of evidence-backed cases.
9. General: synthetic data only, clear user journey, evidence shown, responsible AI, working end-to-end flow.

### Extra team requirements
React + TypeScript + Vite, Tailwind + shadcn/ui, GSAP, Lenis; minimal Java Spring Boot; Python for data/ML/graph; Claude for grounded explanation only; Sarvam for multilingual voice; multilingual chatbot; first-login language selection with skippable onboarding; a visually exceptional investigation workbench; all API keys held server-side.

---

## 2. Documents (all in `docs/`)

| File | Covers |
|---|---|
| `ClaimShield_Nexus_Implementation_Plan.md` | First plan and dataset research. **Superseded in parts** |
| `ClaimShield_Nexus_Final_Architecture.md` | Stack, services, security, deployment, requirements traceability matrix |
| `ClaimShield_Nexus_Data_Architecture.md` | Sources, full schema/DDL, ground truth, splits, decoys, generation, seeding |
| `ClaimShield_Nexus_Intelligence_Engine.md` | Detectors, formulas, consolidation, scoring, tiers, queue, prediction, evaluation |
| `ClaimShield_Nexus_AI_Second_Brain.md` | Evidence packs, brief generation, validator, human review, precedents, exceptions, audit, chatbot, Sarvam |
| `ClaimShield_Nexus_Frontend_Design.md` | Design system, 17 screens, motion rules, accessibility, the 6-minute demo |
| **`ClaimShield_Nexus_Implementation_Architecture.md`** | **Exact REST APIs and JSON, ownership rules, sync/async, auth, errors, Claude/Sarvam integration, flows, monorepo tree** |
| **`ClaimShield_Nexus_Execution_Plan.md`** | **48-hour plan, milestones, MUST/SHOULD/STRETCH/DO-NOT, definition of done, demo prep/reset, fallbacks, checklists** |

**Where documents conflict, the later one wins.** The Implementation Architecture §15 lists the changes.

---

## 3. Design in brief

- **Data:** CMS synthetic Medicare claims as the realistic base (swap-in), plus our generated overlay and ground truth; NCCI code-pair and MUE tables as real billing rules (AMA click-through; never commit raw files). **First milestone runs on a small in-house generator**; the CMS adapter is a later swap-in. 36 scheme instances across 13 types cover all six official behaviours; 14 legitimate decoys across 5 types. Ground truth lives in a separate `gt.duckdb` that detectors never open.
- **Engine:** four evidence channels (line facts, peer comparison, self-change, network); deterministic confidence tiers; capacity-aware queue; prediction orders the queue but is never evidence. Detection runs once offline; the fast stage (exceptions, merging, scoring, queue) re-runs in seconds.
- **AI:** Claude explains a closed, validated evidence pack and never scores. A Java validator is the only path to the user (placeholders for numbers, citations required, forbidden lexicon). Precedents need a supervisor co-sign; exceptions come from a deterministic miner, are linted by simulation and need Governance approval; the whole loop ends in a funnel diff.
- **Implementation:** 3 processes, 1 SQLite file. **Engine writes `serving_*`, gateway writes `wf_*`, neither writes the other's.** Spring Boot is minimal (auth, workflow, audit, jobs, Claude, Sarvam, pass-through reads). Async only for re-run (polling). Errors are problem+json; Claude/Sarvam failures degrade to `200` with a fallback mode.

---

## 4A. MILESTONE M1: IMPLEMENTED AND VERIFIED

**Vertical slice:** mini-generator -> six rules -> alerts -> case consolidation -> scoring -> SIU queue -> evidence pack -> investigator review (Accept / Modify / Reject / Request info) -> supervisor approval -> simulated action -> final decision -> hash-chained audit. Works end to end in a real browser.

| Layer | What exists |
|---|---|
| **Engine** (`engine/claimshield/`) | `generate/mini.py` (deterministic; about 19k claim lines, 15k claims, 300 members, 40 providers, 9 injected scheme instances plus 1 decoy; claim IDs indistinguishable by format; ground truth in a **separate** `gt.duckdb`); six SQL rules in `engine/sql/rules/` (R-DUP-01, R-PTP-01, R-MUE-01, R-DOD-01, R-EXCL-01, R-DME-01); `cases/alerts.py` (alert grain rule x provider x month), `cases/consolidate.py` (referral-coupling merge, stable case IDs by subject overlap), `cases/score.py` (risk noisy-OR, severity, member impact, evidence strength, deterministic tier, utility, hours, trend, first-fit packing), `evidence/pack.py` (pk_v1 packs with numbers registry and rendered statements), `eval/metrics.py`, `publish.py` (one transaction, flips `serving_current_run`), `pipeline.py` CLI, `make_fixture.py` |
| **Gateway** (`gateway/.../gateway/`) | Session login plus CSRF cookie for the SPA, 4 seeded demo users (`demo-users.csv`), problem+json errors, read APIs (run, funnel, dashboard, eval, queue with capacity packing, monitor, case, evidence, claims), workflow service (review, reviews, approve, execute, close, precedents), hash-chained audit (list, verify), one write lock plus one transaction per change |
| **Web** (`web/src/`) | Login, queue (horizon and capacity controls), case page (evidence, claim lines, decision panel, approvals, close, history), audit page (verify chain), demo role switcher. Functional only: no brief, no i18n, no polish, no graph or charts |

**Results on the seeded run (RUN-001):** 18,864 lines -> 737 rule hits -> **94 alerts** -> **8 cases** (2 HIGH: excluded provider and post-death billing; 6 MEDIUM) plus **1 Monitor** item. **Recall 1.0 on all six rules; 12 of 12 decoy lines never flagged; 96% of injected-positive dollars sit in in-capacity cases.** Precision is a lower bound (natural hits in base data would be unlabelled).

### M1 test results (run 2026-10-08)
| Suite | Result |
|---|---|
| Engine (`pytest`) | **72 passed**: 24 rule edge-case tests; generator determinism, no-lineage and recall; scoring, tier, consolidation and ID stability; evidence-pack schema; publisher atomicity; ownership isolation |
| Gateway (`mvn test`) | **51 run, 0 failed, 1 skipped** (the skipped one is the fresh-DB end-to-end test, enabled via `npm run e2e:m1`) |
| Web (`vitest`) | **31 passed** |
| `npm run e2e:m1` | **PASSED**: fresh engine database -> gateway full review, approve, execute, close, audit flow |
| `npm run e2e:ui` | **PASSED (2 of 2)**: real browser (Edge via Playwright) against real Tomcat, Vite and a fresh engine database |
| Lint | ruff clean; oxlint passes (warnings only, in generated shadcn files) |
| Mutation checks | Deliberately breaking 3 rules, 3 gateway controls (two-person rule, permitted-action check, audit-in-transaction) and 2 UI rules was each caught by tests; sources restored byte for byte |

**Real bugs found by tests while building (all fixed):** audit hash design simplified to hash exact stored text; Boot 4 and Jackson 3 API differences; Spring's `csrf()` test helper silently disables the real cookie mechanism within a context (cookie test isolated in `CsrfIT`); UI role switch left the header stale (cache cleared instead of reset); **UI confirmation vanished after recording a decision** (found only by the real-browser test; regression tests added); the fixture tool tripped the ground-truth isolation guard (allowlisted as an orchestrator).

**Commands:** `npm run pipeline` (generate, detect, publish into `data/app.db`), `npm run fixture` (regenerate the gateway test fixture), `npm test`, `npm run e2e:m1`, `npm run e2e:ui` (**run from a normal terminal**), `npm run dev`.

**M1 limits and deviations are in `docs/ClaimShield_Nexus_Implementation_Architecture.md` section 16.** Headlines: alerts number in the **tens**, not thousands (that scale needs the CMS data or larger generation); only the LINE evidence channel exists, so HIGH comes only from the two direct-fact rules and most cases are MEDIUM (by design); paired-code and unit-limit tables are **fixtures, not CMS data**; no train/validation/test split yet.

---

## 4. What was built earlier (the scaffold)

Monorepo at `C:\Users\Himanshu Bagga\Documents\CareX-FINAL`. The toolchain, contracts and plumbing below pre-date M1; M1 (section 4A) is built on them.

| Area | State |
|---|---|
| `web/` | Vite 8 + React 19 + TypeScript 6 app; Tailwind v4; shadcn initialised (Radix, Lucide, Inter) with 31 components added; all libraries installed; a **compatibility smoke page** (`App.tsx`) imports Recharts, Cytoscape, GSAP, Lenis, i18next and shadcn; **build passes, 1 Vitest test passes** |
| `gateway/` | Spring Boot **4.1.1** on **Java 25** (Initializr project): webmvc, security, jdbc, validation, actuator, devtools, **sqlite-jdbc 3.53.4.0**, **anthropic-java 2.70.0**; `application.yml` (WAL SQLite, schema init, config keys); **3 JUnit tests pass** (context loads, 11 `wf_` tables created, audit log is append-only) |
| `engine/` | Python 3.12 venv; pandas, numpy, scipy, scikit-learn, DuckDB, NetworkX, PyArrow, FastAPI, uvicorn, pydantic, pytest, ruff installed (**`requirements.txt` + `requirements.lock`**); internal API with **`X-Engine-Token`** auth and `/internal/health`; SQLite helper (WAL); package skeleton; **4 pytest tests pass, ruff clean** |
| `contracts/sql/` | `serving_schema.sql` (18 tables) and `wf_schema.sql` (11 tables), both validated; audit triggers reject UPDATE/DELETE |
| `scripts/` | Cross-platform `setup`, `dev` (3 services, prefixed logs, no dependencies), `run-gateway`, `run-engine`, `reset-demo` |
| Root | `package.json` scripts, `.env.example` + `.env`, `.gitignore`, `docker-compose.yml` (validated by `docker compose config`), two Dockerfiles (**not built**), `config/gen.yaml`, `README.md` |
| End-to-end check | `npm run dev` from a normal terminal started web (5173), gateway (8080, 2.1 s) and engine (8000); the engine rejected a missing token with 401 and accepted the right one; clean shutdown verified |
| Not a git repo | `git init` has not been run |

**Run it:** `npm run setup` (once), `npm run dev`, `npm test`.

### Installed versions (exact)
Web: react/react-dom 19.3.0 · vite 8.3.3 · typescript 6.0.3 · tailwindcss and @tailwindcss/vite 4.3.3 · gsap 3.15.0 · @gsap/react 2.1.2 · lenis 1.3.26 · recharts 3.8.0 (pinned by the shadcn chart component) · react-is 19.3.0 · cytoscape 3.34.3 · zustand 5.0.15 · @tanstack/react-query 5.104.1 · **@tanstack/react-table 8.21.3 (pinned to v8; v9 exists, not evaluated)** · react-router-dom 7.18.4 · i18next 26.4.2 · react-i18next 17.0.16 · lucide-react 1.53.0 · sonner 2.0.8 · cmdk 1.1.1 · shadcn 4.21.4 · vitest 5.0.3 · @playwright/test 1.64.0 (Chromium installed) · Fontsource: Inter Variable, JetBrains Mono Variable and Noto Sans for 9 Indian scripts.
Engine: pandas 3.0.6 · numpy 2.5.3 · scikit-learn 1.9.1 · DuckDB 1.5.6 · NetworkX 3.7 · SciPy 1.18.1 · PyArrow 25.0.1 · FastAPI 0.142.4 · uvicorn 0.54.0 · pydantic 2.13.5 · pytest 9.1.1 · ruff 0.16.10.
Toolchain on this machine: Node 24.11.0, npm 11.6.1, Python 3.12.10, Java 25 LTS, Maven 3.9.11, Docker 29.1.3. No `make`, no `uv`, no `pnpm`.

---

## 5. Verified vs. still unverified

### Verified (by running it or reading a source)
- **Engine APIs smoke-tested in the installed versions:** `IsolationForest`, `HistGradientBoostingClassifier` with `sample_weight` and `monotonic_cst`, Platt calibration, `theilslopes`, `networkx.simple_cycles(length_bound)`, DuckDB over pandas, Parquet. (Closes the earlier "day-1 library check".)
- **Frontend compatibility:** the whole stack builds and tests together (TS 6 + Vite 8 + Tailwind 4 + shadcn + Recharts 3 + Cytoscape + GSAP + Lenis). `@types/cytoscape` is a stub because Cytoscape ships its own types. All 11 Fontsource package names exist (closes that item).
- **Spring Boot:** latest GA is 4.1.1 (4.0.8 is the older line); the web starter is named `spring-boot-starter-webmvc`; Java 25 works.
- **Claude API:** forced `tool_choice` (`tool`/`any`) returns a **400 on Sonnet 5.5**; use structured outputs (`output_config.format`) and strict tools with `auto`; 512-token cache minimum.
- **Sarvam:** header `api-subscription-key`; STT `saaras:v4` default (under 30 s, WebM accepted, `keyterms` v4-only, `mode` v3-only); TTS `bulbul:v3` (≤ 2,500 chars, 11 languages); translate `sarvam-translate:v1` (≤ 2,000 chars, `numerals_format`).
- **CMS DE-SynPUF:** provider IDs were reassigned by geography and dates perturbed. NCCI files sit behind an AMA click-through (latest listed: 2026 Q4).

### Still unverified (resolve early)
- **CMS 2023 synthetic file field names** (data.cms.gov blocks automated access) and whether referring/ordering provider IDs exist. The data design uses an adapter checklist with fallbacks.
- **Sarvam TTS response encoding** (base64 vs bytes) and which voices suit which language.
- **Claude structured outputs with extended thinking** (design avoids thinking); the Java SDK builder in a real call.
- **Spring Security 7 CSRF handler** for a SPA reading the cookie (default handler masks the token); **SQLite FTS5** availability in the bundled driver.
- **Cytoscape style transitions** for the edge-reveal animation; whether Lenis's React wrapper runs its own loop (design uses the core class instead).
- **Docker base image tags** (`maven:3.9-eclipse-temurin-25`, `eclipse-temurin:25-jre`, `node:24-slim`, `python:3.12-slim`) and the images themselves have not been built.
- NCCI bypass-modifier list and MUE adjudication semantics (written from memory, marked **[verify]**).

---

## 6. Known issues and quirks

- **The assistant's sandboxed shells cannot open network selectors:** a plain `Selector.open()` Java call fails with "Unable to establish loopback connection" there, but works in your own terminal. So Tomcat cannot bind in those shells; **run `npm run dev` from your normal terminal** (verified working). This is not a project or machine problem.
- **`npm audit`:** root is clean (0). `web` reports 7 high findings, all inside the `shadcn` CLI's own dependency chain (`braces` → `micromatch` → `fast-glob` → `@shadcn/registry`/`ts-morph`). None of those packages appear in the production bundle (checked). `npm audit fix --force` would downgrade shadcn to 1.0.0, so it was not applied. `shadcn` sits in `dependencies` because `index.css` imports `shadcn/tailwind.css`.
- I replaced `concurrently` (a critical advisory in `shell-quote`) with `scripts/dev.mjs`.
- Harmless warnings: Node `DEP0190` (child process with `shell: true`) in the dev scripts; Maven's Guice/`sun.misc.Unsafe` warnings on JDK 25; sqlite-jdbc native-access warning; Starlette's `httpx2` deprecation notice in tests; Vite's >500 kB chunk notice (route-level code splitting is planned); Spring prints a generated dev password (default security config until `SecurityConfig` exists).
- `GatewayApplicationTests` and `SchemaInitTest` write to `target/test-app.db` or `../data/app.db`; both are git-ignored.

---

## 7. Honest caveats about the design

- Scores and weights (risk, severity, effort model) are **design judgements**, tuned lightly on validation then frozen.
- The evaluation proves the engine is **correct and consistent**, not that it finds real fraud (we wrote both the injected schemes and the detectors).
- Prevalence is **enriched**; natural rule hits in the base data are unlabelled, so **recall is exact but precision is a lower bound**. Test has only 13 scheme instances (claim-line and dollar metrics are primary).
- Shared-owner referral rings usually land at **Medium**; IsolationForest may add nothing (report it and drop it); the prediction must beat a "recent alerts" persistence baseline or say it doesn't.
- The Java gateway costs about 4–6 hours of boilerplate. If nobody can staff Java, fold its jobs into Python and drop the gateway (don't build both halfway).
- The team-size condition from the first recommendation still stands: about 3+ capable developers and 20+ hours.

---

## 8. Corrections made along the way
1. Forced single tool call → **structured outputs** (docs patched).
2. Sarvam STT `saaras:v3` → `saaras:v4` default (docs patched).
3. Earlier plan deferred upcoding, timing, utilization and collapsed members out of the graph → **all six behaviours and all node types are mandatory**.
4. Prediction became a **selectable horizon that re-ranks the queue**.
5. LLM validator moved from Python to **Java**.
6. Spring Boot 4.0.x/Java 21 → **4.1.1/Java 25**; case IDs are **engine-assigned and stable**; queue packing lives in the **gateway**; **no SSE** (polling); `@tanstack/react-table` pinned to **v8**.
7. First milestone uses a **mini-generator**, with CMS as a later swap-in.

---

## 9. What to do next

Superseded: everything in the original plan is built; see section 0 for the final state and the optional leftovers.

## 4B. MILESTONE: INVESTIGATION BRIEF + VALIDATOR (implemented)

- **Contract:** `contracts/schemas/brief_output.schema.json` (closed schema, additionalProperties false). Seven official elements: evidence = summary, timeline = timeline_notes, network context = network_notes, confidence = confidence_statement, limitations, recommended human-review action = recommended_action + action_rationale, supporting case/risk context = case_context. Every sentence is {text, evidence_ids[]}; numbers are {{ID.key}} placeholders.
- **Gateway** (`gateway/src/main/java/com/claimshield/gateway/brief/`): BriefTemplate (deterministic builder from the pack), BriefValidator (schema V1 plus V2-V15; V16 LLM verifier not built), BriefRenderer (fills numbers from numbers.fmt[0], keeps citations, Markdown copy), BriefService (L0 model, L1 one retry, L2 template with TEMPLATE_FALLBACK badge, L3 503 BRIEF_UNAVAILABLE; cached per case+pack hash in wf_brief; audit event BRIEF_GENERATED), BriefCandidateSource (the seam where Claude plugs in; no implementation yet).
- **API:** GET /api/cases/{id}/brief (200 or 204; stale packs give 204), POST (INVESTIGATOR/SUPERVISOR only). Case detail gains briefAvailable.
- **Strictness choices:** free-typed numbers are blocked even if equal to a registry value; digits are allowed only in dates, entity/code/policy/evidence IDs from the pack, or verbatim pack text of an item the same sentence cites. Rejected model text is never returned: rejectedAttempts keeps rule IDs and field paths only.
- **Web:** BriefPanel in the case page (generate button, badge, seven titled sections with citation chips, validation disclosure).
- **Tests:** BriefValidatorTest (48), BriefIT (6), BriefFallbackIT (5), engine test_brief_contract (21), BriefPanel.test (6), brief steps in e2e:m1 and e2e:ui. Mutation check: disabling any of V3-V12 fails tests.

## 4C. MILESTONE M2: REMAINING FWA BEHAVIOURS + PEER CHANNEL (IMPLEMENTED)

Request: upcoding, impossible timing, excessive utilization, phantom services, decoys D1-D4; a PEER evidence channel so corroborated cases reach HIGH; no graph, prediction, chat, voice, CMS or polish; M1, brief and validator not redesigned.

### What exists now
- **Line rules (SQL, `engine/sql/rules/`)**: `r_time_01` (R-TIME-01, scheme TMA: typical minutes per provider-day over 720, dollars ESTIMATED pro rata, minutes are OUR assumption in `ref_hcpcs.typical_minutes`), `r_geo_01` (R-GEO-01, TMB: same member and date at providers more than 100 km apart; flags the claim from the provider the member used less in the prior 180 days, ties to lower paid then larger provider id), `r_ip_01` (R-IP-01, PHB: office/home service strictly between admit and discharge of an inpatient stay).
- **PEER channel (`engine/claimshield/detect/peer.py`)**: S-UPC (share of level 4-5 office E&M lines, trailing 3 months, shrunk toward the peer median, needs 20 E&M lines and a 0.15 gap), S-UTL (lines per member per month, 8+ members, 1.5x peer median), S-GHOST (share of members whose only provider in the prior 12 months is this one, 25%+), S-DIST (mean member-to-provider km, 100+). Peer group = same specialty, at least 5 peers, robust z (median, 1.4826 x MAD, floored) of 3 or more, and a pattern must show in at least 2 of the 6 evaluated months. Strength = min(1, 0.4 + 0.15 x (z - 3)). Hits go into the same `out_rule_hit` table with JSON stats in `detail`; dollars are ESTIMATED (or 0 for S-DIST).
- **Scoring/pack**: exact vs estimated dollars (`ref.ESTIMATED_RULES`; an exact rule wins per line), `ScoredCase.dollars_est`, case `dollars_basis` EXACT/MIXED/ESTIMATED, header `dollars.estimated`. `decide_tier` is UNCHANGED: a peer signal alone is LOW (Monitor), LINE hard fact + PEER with strength 0.65+ is HIGH, LINE without a hard fact + PEER is MEDIUM. Pack evidence now has `type` `peer_stat`, `dollarsBasis`, line evidence ordered before peer evidence, numbers `E#.share/peer/peers/acuity/peerAcuity/lpm/km/months/days/cap`, `S.dollarsExact`, `S.dollarsEstimated` (`S.dollars` = their sum), limitation L2 reworded and optional L4 about peer comparisons and estimated dollars. Contract change in `contracts/schemas/evidence_pack.schema.json` (peer_stat, `[RS]-` detector pattern, `dollarsBasis`).
- **Generator (`generate/mini.py`)**: 61 providers (P-0041..P-0061 added), 360 members + 30 ghost members, regions with lat/lon (D3 in a remote fourth place), 28 legitimate inpatient stays, region-aware visits (a member is never in two regions on one day), acuity-dependent visit levels, new tables `provider_location`, `member_location`, `inpatient_stay`. Schemes: P-0041 upcoding + duplicates (HIGH), P-0042 upcoding alone (Monitor), P-0043 impossible daily time (MEDIUM, with peer upcoding), P-0044 ghost members, 6 of them recorded deceased (HIGH), P-0045 utilization + duplicates (HIGH), P-0060 distant same-day claims (MEDIUM), P-0061 billing during stays (MEDIUM). Decoys (provider-level ground truth in `gt_scheme`/`gt_decoy_provider`): D1 P-0046 recurring treatment (flagged by S-UTL, Monitor), D2 shared buildings P-0037..40 and P-0023..26 (NO detector until the graph work; completely quiet), D3 P-0059 sole rural radiologist (S-DIST, Monitor), D4 P-0053 high-acuity cardiologist (S-UPC and S-UTL, Monitor). D5 (line-level modifier decoys) is unchanged and still never flagged.
- **Eval**: line recall per rule (peer rules only over the evaluated window), provider recall per scheme, decoy providers with `flaggedBy`, best tier, `reachedHigh`, `opensCase`.
- **Brief**: the template says "estimated exposure" instead of "recorded amounts" when the primary item is estimated, and splits recorded vs estimated dollars in the case context. Validator untouched.
- **Web**: queue shows total dollars and "of which estimated"; case page shows exact + estimated and marks estimated evidence.

### Result of the seeded run (RUN-001)
14 cases (5 HIGH, 9 MEDIUM) + 5 Monitor items (P-0032, P-0042, P-0046, P-0053, P-0059). Recall 1.0 on all 12 rules/signals, every injected scheme provider flagged, 0 of 12 D5 decoy lines flagged, no decoy provider reaches HIGH or opens a case.

### Honest limits
- Peer statistics use small synthetic peer groups (3 to 24); the upcoding gap and persistence guards exist because small groups are noisy. Evaluation is against injected ground truth.
- Typical minutes, distances and thresholds are demo assumptions, not CMS data. D2 needs the graph work to mean anything. Peer-only patterns never open a case by design.
- Case IDs skip numbers because Monitor items consume IDs (existing behaviour).

### Tests added/changed
`engine/tests/test_m2.py` (SQL rules, peer maths, scoring, pipeline outcomes, decoys), updated `test_generator.py`, `test_pack_publish.py`, `tests/helpers.py` (TinyDb now has `ref_hcpcs`, `place`, `stay`, `pos`); gateway `BriefValidatorTest` (+4, data-independent now), `ReadApiIT`/`AuditIT` (counts come from the fixture); web `Queue.test.tsx`.

## 10. Not built (everything else listed in earlier sections IS built)

Only: the CMS synthetic-data adapter, multi-seed evaluation, a live Anthropic key run. See section 0, Limitations.

---

## 11. Verification log

Superseded by section 4A (M1 results). Earlier scaffold-time checks (dev stack boot, audits, SQL contracts, compose validation) still hold.

## 12. Open decisions for the team
1. **Team size and time** (plan assumes 3-4 developers, 48 h; 24 h cut line marked).
2. **CMS adapter vs generator:** M1 deliberately uses the mini-generator; attempt the CMS swap-in in a 2-hour box and keep the generator if the field checklist fails.
3. **Git:** run `git init` once the branch workflow is agreed.
4. **Demo credentials** are in `gateway/src/main/resources/demo-users.csv` (random demo-only passwords); replace before any shared deployment.
5. **Which API keys and modes** (`LLM_MODE`, `VOICE_ENABLED`) the demo machine uses.

## 13. Next steps (optional)
Optional only: the CMS adapter attempt, a multi-seed evaluation, and a run with a real Anthropic key. Nothing required is open.
