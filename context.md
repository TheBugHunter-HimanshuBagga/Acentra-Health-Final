# ClaimShield Nexus: Project Context

*Hand-off summary of everything decided and built so far. Read this first. Last updated 2026-10-08 after **milestone M1 was implemented and verified** (see section 4A).*

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

1. Hour 0 (partly done): confirm the sandbox quirk does not affect teammates' machines; **start the CMS download in a browser** (parallel, non-blocking); read the Sarvam TTS reference; one real Claude structured-output call from Java.
2. **IC0:** write `contracts/schemas/evidence_pack.schema.json` and the fixture cases; seed the four users.
3. **Build M1** (execution plan §2): mini-generator → six rules → alerts → cases → evidence → review → decision → audit. Do not add anything optional before it works end to end.
4. Then layer: all six behaviours → Claude brief → graph and prediction → precedent/exception/re-run → chat → voice → polish.
5. Optional housekeeping: `git init` and a first commit (not done); run `docker compose build` once to verify the image tags.

## 4B. MILESTONE: INVESTIGATION BRIEF + VALIDATOR (implemented)

- **Contract:** `contracts/schemas/brief_output.schema.json` (closed schema, additionalProperties false). Seven official elements: evidence = summary, timeline = timeline_notes, network context = network_notes, confidence = confidence_statement, limitations, recommended human-review action = recommended_action + action_rationale, supporting case/risk context = case_context. Every sentence is {text, evidence_ids[]}; numbers are {{ID.key}} placeholders.
- **Gateway** (`gateway/src/main/java/com/claimshield/gateway/brief/`): BriefTemplate (deterministic builder from the pack), BriefValidator (schema V1 plus V2-V15; V16 LLM verifier not built), BriefRenderer (fills numbers from numbers.fmt[0], keeps citations, Markdown copy), BriefService (L0 model, L1 one retry, L2 template with TEMPLATE_FALLBACK badge, L3 503 BRIEF_UNAVAILABLE; cached per case+pack hash in wf_brief; audit event BRIEF_GENERATED), BriefCandidateSource (the seam where Claude plugs in; no implementation yet).
- **API:** GET /api/cases/{id}/brief (200 or 204; stale packs give 204), POST (INVESTIGATOR/SUPERVISOR only). Case detail gains briefAvailable.
- **Strictness choices:** free-typed numbers are blocked even if equal to a registry value; digits are allowed only in dates, entity/code/policy/evidence IDs from the pack, or verbatim pack text of an item the same sentence cites. Rejected model text is never returned: rejectedAttempts keeps rule IDs and field paths only.
- **Web:** BriefPanel in the case page (generate button, badge, seven titled sections with citation chips, validation disclosure).
- **Tests:** BriefValidatorTest (48), BriefIT (6), BriefFallbackIT (5), engine test_brief_contract (21), BriefPanel.test (6), brief steps in e2e:m1 and e2e:ui. Mutation check: disabling any of V3-V12 fails tests.

## 4C. MILESTONE M2: REMAINING FWA BEHAVIOURS + PEER CHANNEL (IN PROGRESS, REPO CURRENTLY BROKEN)

**User request (verbatim intent):** implement upcoding, impossible timing, excessive utilization, phantom services, decoys D1-D4; add the PEER evidence channel so corroborated cases can reach HIGH; use the existing architecture, evidence-pack contract, scoring, workflow and tests; do NOT redesign M1/brief/validator; write real code and tests; regenerate the gateway fixture with `npm run fixture`; run the full suite and the real E2E; NO graph, prediction, chat, voice, CMS or polish. Final report format: 1 files changed, 2 behaviours implemented, 3 test results, 4 bugs fixed, 5 exact next step.

### WARNING: current state does not run
`engine/claimshield/detect/rules.py` now imports `claimshield.detect.peer.run_peer_signals`, but **`detect/peer.py` does not exist yet**. Until it is written, the engine pipeline, `npm run fixture`, `npm test` (engine tests and the fixture-dependent gateway parts) fail at import/run. The generator (`generate/mini.py`) has NOT been touched yet, so the new SQL rules would find no data. Nothing in gateway/web was changed for M2 yet. The gateway, web and brief work from the previous milestone is intact and was green BEFORE M2 started (gateway 110 run/0 fail/1 skipped; engine 93; web 37; `e2e:m1` and `e2e:ui` passed).

### Done so far in M2 (all under `engine/`)
- `claimshield/reference.py`: new constants (`TIME_CAP_MINUTES=720`, `GEO_KM=100`, `GEO_HISTORY_DAYS=180`, peer thresholds `PEER_MIN_PEERS=5`, `PEER_Z_ALERT=3.0`, `PEER_SHRINK_K=10`, `PEER_WINDOW_MONTHS=6`, `PEER_MIN_EM=30`, `PEER_MIN_MEMBERS=8`, `UPC_MIN_GAP=0.15`, `UTL_MIN_RATIO=1.5`, `GHOST_MIN_SHARE=0.25`, `DIST_MIN_KM=60`, `GHOST_LOOKBACK_MONTHS=12`). `RULES` now has 13 entries: SQL rules R-TIME-01 (scheme TMA, not a hard fact), R-GEO-01 (TMB, hard), R-IP-01 (PHB, hard), and PEER signals S-UPC (UPC), S-UTL (UTL), S-GHOST (PHC), S-DIST (DIS), none a hard fact. New sets `ESTIMATED_RULES`, `PEER_RULES`, `SQL_RULES`, `CHANNEL_OF`. Also extended: `SCHEME_WEIGHTS`, `HYPOTHESIS_TEXT`, `RULE_TEMPLATE` (placeholders `{{EV.share}}`, `{{EV.peer}}`, `{{EV.peers}}`, `{{EV.lpm}}`, `{{EV.acuity}}`, `{{EV.peerAcuity}}`, `{{EV.km}}`, `{{EV.cap}}`, `{{EV.days}}`, `{{EV.months}}`), 7 new `POLICY_SECTIONS` (POL-CODE-2.3, POL-TIME-6.1, POL-TIME-6.2, POL-ELIG-3.2, POL-ELIG-3.3, POL-UTIL-7.1, POL-UTIL-7.2) and glossary GL-PEER, GL-TIME. RULE: templates and evidence names must contain NO digits (the brief validator V5 rejects free digits; that is why S-UPC says "levels four and five").
- `engine/sql/canonical_schema.sql`: new tables `provider_location(provider_id, region, lat, lon, is_rural, building_id, phone_syn)`, `member_location(member_id, region, lat, lon)`, `inpatient_stay(stay_id, member_id, admit_dt, discharge_dt)`.
- `engine/sql/rules/r_time_01.sql` (param `$cap`; flags every line of a provider-day over the cap; dollars = paid x excess/total, ESTIMATED), `r_ip_01.sql` (non-facility POS strictly between admit and discharge), `r_geo_01.sql` (params `$km`, `$history`; same member and date, providers more than km apart; flags the claim from the provider the member used less in the prior 180 days, ties to the lower paid claim then the larger provider id). None of the three SQL files has been executed yet; expect to debug them.
- `detect/rules.py`: `RULE_FILES` and `_params` extended; `run_all_rules(con, store=True, peer=True)` appends `run_peer_signals(con)` (HIT_COLUMNS shape, rule_id such as `S-UPC`, `detail` = JSON stats, dollars = estimated per line).

### Remaining work (in this order)
1. **`engine/claimshield/detect/peer.py`**: `run_peer_signals(con) -> DataFrame[HIT_COLUMNS]`. Evaluate the last 6 months (2025-07..12) with trailing 3-month windows. Peer group = same specialty excluding self; fewer than `PEER_MIN_PEERS` peers means no signal. Robust z = (x - median)/(1.4826*MAD) with a MAD floor; rates shrunk toward the peer median by n/(n+k). Alert when z >= 3 plus the absolute-gap guard. Signals: S-UPC (level 4-5 share of office E&M lines via `ref_hcpcs.em_level`, n_em >= 30; flagged lines = that month's level 4-5 lines; est dollars = n_em_month x max(0, shrunk share - peer median) x (avg allowed L45 - avg allowed L123), spread over lines; `detail` JSON carries share, peer median, n peers, z, provider mean acuity, peer mean acuity), S-UTL (lines per distinct member per month, >= 8 members and >= 1.5x peer median; lines of members above the threshold; est dollars = (lpm - peer median) x n_members x avg paid per line), S-GHOST (share of the provider's members whose ONLY provider over the prior 12 months is this one; flagged lines = their lines that month; est dollars = their paid), S-DIST (mean Haversine km member to provider vs peers, >= 60 km; dollars 0). Peer strength per alert from z, e.g. min(1, 0.4 + 0.15*(z-3)); `cases/alerts.py build_alerts` must use that per-alert strength for PEER rules (today it uses the fixed base strength from `ref.RULES`).
2. **Generator `generate/mini.py`** (keep named RNG streams; new components get new stream names). Append providers P-0041..P-0062. Required roles: upc_a=P-0041 upcoding plus duplicates (corroborated, expect HIGH); upc_b=P-0042 upcoding alone (peer only, expect Monitor); tma=P-0043 (about 10 days with 22 extra 99215 visits, over 720 minutes, spread over at least 3 months); phc=P-0044 ghost-member billing (30 ghost members with no other claims, 6 with a recorded death so R-DOD fires); utl=P-0045 utilization plus R-MUE hits (corroborated); D1=P-0046 sustained recurring-treatment pattern that looks like UTL but is legitimate; D4 = a high-acuity cardiologist whose panel has high acuity (make level probability depend on member acuity for everyone); D3 = sole rural radiologist at a remote 4th location that region-2 members travel to; tmb = a clinic in another region billing members who are billed elsewhere the same day; phb = a clinic billing office visits during inpatient stays; D2 = two buildings x 4 unrelated providers sharing `building_id`/`phone_syn` (NO detector until the graph milestone; say so honestly). Make legit data region-aware (member and provider regions, 90% same-region choice, skip a legit visit if the member already has a visit that day in another region, skip legit visits during inpatient stays, create about 25 legit stays) so the new SQL rules are clean on legit data. Write `provider_location`, `member_location`, `inpatient_stay`; ghost members are excluded from legit visits. Ground truth: provider-level decoys D1-D4 as `gt_scheme` rows with kind DECOY (D1-D4 lines are NOT line-labelled DECOY_NEGATIVE; D5 stays line-level). Update `N_MEMBERS`/scale test (15k-25k lines), `ROLE`, `SCHEMES`.
3. **Scoring, dollars, pack** (`cases/score.py`, `cases/rows.py`, `evidence/pack.py`): split line dollars into EXACT and ESTIMATED by `ESTIMATED_RULES` (an exact rule wins per line); add `ScoredCase.dollars_est`; case row `dollars_est` and `dollars_basis` EXACT/ESTIMATED/MIXED; header `dollars.estimated`; dscore uses exact+estimated; `channels["PEER"]` = max peer alert strength; leave `decide_tier` unchanged (peer-only => LOW => Monitor; LINE hard + PEER with es >= 0.65 => HIGH; LINE non-hard + PEER => MEDIUM). Update `fv` features and `raise_conf` text. Pack: evidence `channel` from `ref.CHANNEL_OF`, evidence `type` `peer_stat` for peer items, numbers `E#.share/peer/peers/acuity/peerAcuity/lpm/km/months/days/cap/n/dollars`, plus `S.dollarsExact` and `S.dollarsEstimated`; update limitation L2 (it must no longer say "line rules only"; trend, network and prediction are still unavailable); add an optional limitation that peer comparisons are statistical; cite policies/glossary for the new rules. **Contract change** in `contracts/schemas/evidence_pack.schema.json`: evidence `type` enum adds `peer_stat`; the `detector` pattern must accept `S-UPC@v1` (for example `^[RS]-[A-Z]+(-[0-9]{2})?@v[0-9]+$`).
4. **Pipeline and eval** (`pipeline.py`, `eval/metrics.py`): extend `SCHEME_TO_RULE`; line recall for rules and provider-level recall for peer signals; for decoy providers D1-D4 report which signal flagged them and the best tier reached (must never be HIGH); D5 line decoys must still never be flagged; pass a provider->tier map into `evaluate`. Keep the ground-truth isolation rule (only `generate/`, `eval/`, `pipeline.py`, `paths.py`, `make_fixture.py` may reference gt).
5. **Brief template tweak** (`gateway/src/main/java/com/claimshield/gateway/brief/BriefTemplate.java`): when the primary evidence channel is PEER or dollars are estimated, do not say "recorded amounts"; use `{{S.dollarsEstimated}}` wording; every number stays a placeholder. Add a Java test. Do not otherwise change the validator.
6. **Tests**: SQL rule tests (TinyDb in `engine/tests/helpers.py`) for R-TIME, R-GEO, R-IP positives and negatives; peer-signal unit tests (small-peer skip, MAD floor, shrinkage, thresholds, acuity context); generator tests (new schemes present and found, legit data clean for the new SQL rules, decoys D1/D3/D4 flagged by peer signals only and never HIGH, D2 providers in no HIGH case, D5 still never flagged); scoring tests (LINE hard + PEER => HIGH, LINE non-hard + PEER => MEDIUM, PEER only => Monitor, exact/estimated split); pack schema and placeholder tests for peer evidence. Update M1 tests that hard-code counts or tiers (`test_pack_publish.py`, `test_generator.py` scale and "no hit outside positives" which must call `run_all_rules(..., peer=False)`, pipeline summary keys). Update gateway tests that depend on fixture composition (they use `caseWith(scheme, tier)` and `allCaseIds()`: check `ReadApiIT`, `WorkflowIT`, `QueuePackingTest`, `BriefIT`, `BriefFallbackIT`, `M1EndToEndIT`) and web test builders if the case/queue types gain fields.
7. **Regenerate and verify**: `npm run fixture`, then `npm test`, `npm run lint`, `npm run e2e:m1`, and `npm run e2e:ui` (run the last in the user's Terminal panel with the terminal tool; sandboxed shells cannot bind ports). Update this file, `README.md` and the architecture doc, then give the 5-part final report.

### Design decisions already taken (do not re-litigate)
- Peer-only signals never open a case: they become Monitor items (LOW) with "what would raise confidence". Corroboration (LINE + PEER) is how a case reaches HIGH or MEDIUM. This matches the existing `decide_tier`.
- Decoys D1-D4 are honest false positives of the peer statistics (D2 of a graph detector that does not exist yet); the system must show context (acuity, rural, recurring) and never rate them HIGH. Graph, prediction, the SELF (temporal) channel, chat, voice, CMS adapter and polish are out of scope for M2.
- Estimated dollars are always labelled ESTIMATED and kept separate from exact dollars; numbers in packs and briefs stay registry placeholders.
- Ownership boundaries are unchanged: the engine writes only `serving_*`; the gateway writes only `wf_*`.

### Environment reminders
- Windows. Bash heredocs and `node -e "..."` with apostrophes or backticks break in this environment; write files with the Write or Edit tools. The working directory drifts; use absolute paths.
- Engine python: `engine/.venv/Scripts/python.exe`. Maven offline works (`mvn -q -o ...`) from `gateway/`; surefire reports are in `gateway/target/surefire-reports`.
- Demo passwords live only in `gateway/src/main/resources/demo-users.csv`; never repeat them in chat.
- M1 (vertical slice) and the Brief + Validator milestone are complete and documented in sections 4A and 4B above.

---

## 10. Not built yet

Claude-written briefs (the template brief and validator are built, see 4B), chat, voice, Sarvam, graph, peer/temporal/IsolationForest detectors, 30/60/90 prediction, precedent co-sign and conflict checks, exception proposal/simulation/governance/re-run and the funnel diff, `/api/jobs`, the gateway-to-engine HTTP link, knowledge screens, i18n and onboarding, the CMS adapter and CMS-based dataset, train/validation/test split and multi-seed evaluation, the gateway serving the built SPA for deep links, Docker image builds, `git init`.

---

## 11. Verification log

Superseded by section 4A (M1 results). Earlier scaffold-time checks (dev stack boot, audits, SQL contracts, compose validation) still hold.

## 12. Open decisions for the team
1. **Team size and time** (plan assumes 3-4 developers, 48 h; 24 h cut line marked).
2. **CMS adapter vs generator:** M1 deliberately uses the mini-generator; attempt the CMS swap-in in a 2-hour box and keep the generator if the field checklist fails.
3. **Git:** run `git init` once the branch workflow is agreed.
4. **Demo credentials** are in `gateway/src/main/resources/demo-users.csv` (random demo-only passwords); replace before any shared deployment.
5. **Which API keys and modes** (`LLM_MODE`, `VOICE_ENABLED`) the demo machine uses.

## 13. Next concrete steps (in order)
1. **FINISH M2 (section 4C)**: peer.py, generator, scoring/pack/eval, tests, fixture regeneration, full suite and E2E. The template brief and validator are DONE (section 4B).
2. Remaining official behaviours: upcoding, impossible timing (minutes and geography), excessive utilization (frequency), phantom services (inpatient overlap, ghost members); decoys D1-D4. This adds the PEER channel so HIGH can come from corroboration.
3. Precedent co-sign, exception propose/simulate/approve, the gateway-to-engine re-run job and the funnel diff (the Second Brain proof).
4. Graph and timeline views; 30/60/90 prediction; Claude brief; chat; voice; polish.
