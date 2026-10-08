# ClaimShield Nexus: Final Architecture & Stack

*Supersedes the architecture sections of `ClaimShield_Nexus_Implementation_Plan.md`. Dataset choices, scheme injection, detection logic, scoring and the demo script in that file still stand unless §11 below says otherwise.*

**Source of truth:** the official problem statement. §12 maps every official requirement to a component, a demo artifact and a test. Where the old plan weakened a requirement, §11 reverses it.

---

## 0. Verification status (what I checked, what I could not)

| Item | Status | Source / note |
|---|---|---|
| Spring Boot 4.0.x on Java 17+; first-class Java 25 support | Verified (third-party, April 2026) | [HeroDevs](https://www.herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026), [issoh.co.jp](https://www.issoh.co.jp/tech/details/10124/). 4.1 was "targeted May 2026", so **check spring.io for the current patch before pinning** |
| Vite needs Node 20.19+ or 22.12+ | Verified | [create-vite](https://depscope.dev/pkg/npm/create-vite), [Vite 7 notes](https://alternativeto.net/news/2025/6/vite-7-0-drops-node-js-18-updates-browser-targets-and-adds-buildapp-hook). Sources conflict on whether the current major is 7 or 8, so pin whatever `npm create vite@latest` generates |
| Tailwind v4 via `@tailwindcss/vite`; shadcn/ui new projects start on React 19 + Tailwind v4; `toast` replaced by `sonner`; `@/*` alias must be set before `shadcn init` | Verified | [shadcn Vite install](https://www.shadcn.io/ui/installation/vite), [shadcn issue 6585](https://github.com/shadcn-ui/ui/issues/6585) |
| GSAP free including all plugins; install `gsap` from public npm; `@gsap/react` provides `useGSAP`; no `.npmrc` token needed | Verified | [GSAP README](https://cdn.jsdelivr.net/npm/gsap@3.15.0/README.md), [gsap-skills](https://www.skills.sh/greensock/gsap-skills/gsap-plugins). `gsap-trial` is deprecated, so don't use it |
| Lenis: package `lenis`, React adapter `lenis/react`, must share one animation loop with ScrollTrigger | Verified in principle | [Lenis README](https://cdn.jsdelivr.net/npm/lenis@1.3.18/README.md). **Not verified:** whether `<ReactLenis>` runs its own loop in your installed version. Follow the README for that version and test scroll/trigger sync on day 1 |
| Sarvam: Saaras v3 STT (23 languages incl. English, `mode` param: transcribe/translate/…), real-time endpoint **≤30 s audio**; Bulbul v3 TTS (11 languages, **≤2,500 chars/request**); Sarvam-Translate (22 languages, **≤2,000 chars**, formal only); Mayura (11 languages, ≤1,000 chars) | Verified from docs snippets | [Saaras](https://docs.sarvam.ai/api-reference-docs/models/saaras), [Bulbul](https://docs.sarvam.ai/api-reference-docs/text-to-speech/models/bulbul), [Translate](https://docs.sarvam.ai/api-reference-docs/text/translate-text.md). **Docs disagree** on Mayura's language count, Bulbul sample rates and batch STT limits. Confirm at hour 0. Saarika v2.5 is legacy, so don't use it |
| Anthropic Java SDK `com.anthropic:anthropic-java` (docs show 2.60.0, Java 8+), `AnthropicOkHttpClient.fromEnv()` | Verified | [Java SDK docs](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/java). **CORRECTION (verified later):** forced tool calls (`tool_choice` of `tool`/`any`) return a **400 error on Sonnet 5.5, Opus 5.5 and Fable 5.1**. Use **structured outputs** (`output_config.format` with `type: json_schema`; supported on `claude-sonnet-5-5` and `claude-haiku-5-5`) and `strict: true` tools with `tool_choice: auto`. See [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools). Details in `ClaimShield_Nexus_AI_Second_Brain.md` |
| Sarvam REST auth header name, exact request fields | **Not verified** | Read the API reference at hour 0. There is no official Java SDK that I confirmed, so call REST via Spring `RestClient` |
| Recharts / Cytoscape.js / TanStack / react-i18next versions vs React 19 | **Not verified** | Install on day 1 and run the smoke build. Each has a drop-in alternative (listed in §10) |

---

## 1. The one stack

| Layer | Choice |
|---|---|
| Frontend | **React 19 + TypeScript + Vite**, Tailwind v4 + shadcn/ui, **GSAP** (+ `@gsap/react`), **Lenis** on marketing-style pages only, TanStack Query (server state), Zustand (UI state), react-i18next, TanStack Table, Cytoscape.js (graph), Recharts (charts), sonner (toasts) |
| API gateway / workflow | **Java 21 LTS + Spring Boot 4.0.x**: Web MVC, Security, JDBC (`JdbcClient`, no JPA), Validation, Actuator. Serves the built SPA from the same origin |
| Analytics engine | **Python 3.12**: pandas, DuckDB, scikit-learn, NetworkX, pytest. Batch pipeline plus a small **internal-only FastAPI** bound to `127.0.0.1` |
| LLM | **Anthropic Claude** (`claude-sonnet-5-5` for briefs and chat; `claude-haiku-5-5` for cheap tasks like intent routing) called **only from Spring Boot** |
| Voice / translation | **Sarvam** (Saaras STT: `saaras:v4` is the documented default, `mode` only exists on `saaras:v3`; `bulbul:v3` TTS; `sarvam-translate:v1`) called **only from Spring Boot** |
| Storage | **DuckDB** (+ Parquet) private to Python. **SQLite (WAL)** as the serving + workflow store, accessed by both. No Postgres, no vector DB |
| Runtime | Two processes (Spring Boot, Python engine), one `docker compose up`, one-command reset |

Two processes, not microservices: Python is the compute engine and Java is the trust boundary.

**Why Java at all:** nothing in the official problem statement needs it, but it earns its place in four ways: (1) it is the only process that holds API keys, (2) it enforces RBAC and the two-person approval rule, (3) it owns the workflow state machine and the hash-chained audit log, (4) it hosts the LLM validator, which is the control that blocks unsupported accusations. If the team cannot staff Java, collapse (1)–(4) into the Python FastAPI and drop the gateway. Do not build both halfway.

---

## 2. System architecture

```
 Browser (React SPA, same origin)
    │  HTTPS, session cookie + CSRF token, no keys in the bundle
    ▼
┌──────────────────────── Spring Boot (public) ────────────────────────┐
│ Security/RBAC │ Case & workflow API │ Review/approval state machine   │
│ Audit (hash chain) │ Precedent & exception governance                  │
│ LLM service: prompt builder → Claude → VALIDATOR → store              │
│ Chat service: read-only tools → Claude → VALIDATOR → translate → TTS  │
│ Voice proxy: Sarvam STT / Translate / TTS                              │
└───────┬──────────────────────────────┬────────────────────────────────┘
        │ JDBC (read serving_*,        │ HTTP 127.0.0.1 only
        │ write wf_*)                  │ POST /rerun /simulate /evidence
        ▼                              ▼
   SQLite app.db (WAL) ◄──────── Python engine ──► DuckDB claims.duckdb + Parquet
                          writes serving_*         (private to Python)
                                │
                                ▼
          Anthropic API · Sarvam API  (outbound from Spring Boot only)
```

**Ownership rule that makes SQLite safe:** Python writes only `serving_*` tables, always versioned by `run_id`, in one transaction. Java writes only `wf_*` tables. A single `current_run` pointer row flips atomically when a run completes. Java never reads DuckDB, and Python never writes `wf_*`.

---

## 3. Service responsibilities

### Python engine (compute; no secrets, no outbound network)
- **Batch (`make pipeline`, run once before the demo):** ingest CMS files, build the overlay, inject schemes with ground truth, compute features, run the **rules, peer-anomaly (IsolationForest), graph and temporal detectors** over everything, train the **30/60/90 models**, write `serving_alerts`, `serving_features`, `serving_predictions`, and the ground-truth tables.
- **Case builder (fast stage, seconds):** apply approved exception rules → consolidate alerts to cases → compute risk, dollars, member impact, severity, evidence strength, precedent fit, confidence tier → capacity-aware queue → build **evidence packs** and graph subgraphs (with precomputed deterministic layout) → write `serving_*` for a new `run_id`.
- **Internal endpoints:**
  - `POST /rerun`: runs the fast stage only, taking the active exception rules from Java in the request body. Detection is *not* recomputed, which keeps "re-run" under about 30 seconds.
  - `POST /simulate`: backtests a draft exception rule (alerts and dollars suppressed, ground-truth positives lost, conflicts with confirmed precedents).
  - `GET /health`.
- **Evaluation:** `make eval` writes `serving_eval` (seed B, ablation, calibration).

### Spring Boot (workflow, trust boundary)
- **AuthN/AuthZ:** four roles (Investigator, SIU Supervisor, Rule Governance, Auditor).
- **Read APIs** over `serving_*` for the dashboard, queue, cases, graph, timeline, predictions, eval.
- **Workflow:** case state machine, review actions with mandatory reason codes, **two-person approval**, action simulation, precedent creation on close, exception propose → simulate → approve → rerun.
- **LLM service:** builds the prompt from an evidence pack, calls Claude, **validates**, falls back to the deterministic template, stores the result.
- **Chat service:** grounded multilingual Q&A with read-only retrieval tools (§5).
- **Voice proxy:** Sarvam STT, translate and TTS.
- **Audit:** append-only, hash-chained event log with a verify endpoint.

### React SPA
Workbench UI, onboarding, animations, citation chips, graph and timeline views, chat/voice UI, i18n. It holds **no secrets and no business rules**.

---

## 4. Data flow

**A. Offline (once):** raw CMS files → Python ingest (re-key NPIs/TINs to synthetic IDs) → overlay + scheme injection (seed A for tuning, seed B held out) → DuckDB → detectors → alerts → `serving_*` (run 1).

**B. Triage (every run):** alerts → exception filter → case consolidation → scores and tier → queue sized to investigator hours → evidence packs → UI.

**C. Brief:** open case → `POST /cases/{id}/brief` → Java loads the evidence pack → Claude (structured output, `output_config.format` JSON schema) → **validator** → store `wf_brief` (+ validation result, prompt hash, model) → UI renders sentences with citation chips. A cache keyed by pack hash prevents repeat calls.

**D. Human decision:** investigator Accept / Modify / Reject / Request info (+ reason code) → supervisor approval if high-impact → simulated action → case close → `precedent` row → if rejected as legitimate, **draft exception** → `/simulate` → Governance approves → Java calls `/rerun` with the active exceptions → new `run_id` → funnel diff shown.

**E. Chat / voice:** audio ≤30 s → Saaras STT (`saaras:v4`) → text → Claude with read-only tools (RBAC-filtered) → structured English answer with evidence IDs → **validator** → per-sentence translation (Sarvam-Translate) into the user's language → optional Bulbul TTS of a short spoken summary → UI shows translated text, original English toggle, and citation chips.

Every step in A–E emits an `audit_event`.

---

## 5. AI architecture

**Principle: Claude explains; it never detects, scores or invents.** All numbers, tiers and risk values are computed by Python, frozen into the evidence pack, and re-checked by Java after Claude responds.

### 5.1 Brief generation
1. **Input:** the evidence pack only (evidence items with IDs, scores, tier and reasons, policy sections, precedents, limitations, allowed actions, forbidden terms).
2. **Output schema** (structured output via `output_config.format`; the schema is **static**, with no case-specific enums, and content checks live in the validator):
   `{ summary: [{text, evidence_ids[]}], hypothesis ∈ allowed, recommended_action ∈ allowed, timeline_notes: [{text, evidence_ids[]}], network_notes: [...], what_would_change_my_mind: [...], limitations: [...] }`
3. **Validator (Java, deterministic):**
   - Every sentence has ≥1 evidence ID, and every ID exists in the pack.
   - Every number in the text matches a value in a cited evidence item (with tolerance rules for rounding and currency formatting).
   - No entity ID outside the pack.
   - No forbidden term ("fraud", "fraudulent", "criminal", "guilty", …).
   - `recommended_action` and `hypothesis` come from the allowed lists.
   - Any tier the text mentions equals the computed tier.
   - Low-tier cases use the fixed "insufficient evidence" wording.
4. **On failure:** one retry with the validator's errors appended. If it fails again, the **deterministic template brief** is shown with a "Template (validation fallback)" badge. The UI never shows an unvalidated brief.

### 5.2 Precedent reasoning
Retrieval is structural: match on scheme type, rule IDs, specialty and graph pattern, then cosine similarity on the feature vector (NumPy). Precedents enter the pack as evidence items, so they are cited and validated like everything else. There is no vector database, because the corpus is hundreds of rows.

### 5.3 Multilingual chatbot (grounded, not generic)
- **Scope:** answers about the funnel, queue, a case, a provider's evidence, policies, precedents, and "why was this ranked here". It refuses to speculate about guilt and says "not enough evidence" when the data doesn't support an answer.
- **Retrieval is tool use**, implemented in Java as read-only functions: `get_funnel`, `get_queue`, `get_case(id)`, `get_evidence(id)`, `get_policy(id)`, `search_precedents(q)`. Tools run under the caller's role, so RBAC applies to the chatbot too.
- **Answer format:** same structured schema as briefs (sentences + evidence IDs), same validator.
- **Language path:** the answer is validated **in English**, then translated sentence by sentence so each sentence keeps its citation chips. Numerals and IDs are protected with placeholders during translation and re-inserted afterwards. An "English original" toggle is always available. *Known limitation:* translation can alter phrasing, so the validated English text is the legal record and the translation is a view of it.
- **Voice:** push-to-talk, hard cap 30 s (the real-time STT limit). TTS speaks a short summary (the TTS limit is 2,500 characters per request), not the whole brief.
- **Language support:** UI strings for the **11 Bulbul/Mayura languages** (English + 10 Indian) get full text and voice. Remaining languages (Sarvam-Translate covers 22) can be offered text-only if time allows.

### 5.4 Prompt-injection and safety
Free-text fields (notes, precedent rationales) are passed as quoted data. The LLM has no write tools. Output is schema-bound and validated, so an injected instruction can at worst produce text that fails validation.

---

## 6. Database and storage architecture

| Store | Owner | Contents |
|---|---|---|
| `claims.duckdb` + Parquet | Python | Canonical claims, reference tables (NCCI PTP/MUE), features, raw detector output, ground truth |
| `app.db` (SQLite, WAL) `serving_*` | Python writes, Java reads | `run`, `current_run`, `alert`, `case`, `case_alert`, `evidence_pack` (JSON), `graph_json` (nodes, edges, layout), `timeline_json`, `prediction` (provider × horizon), `queue`, `eval`, `precedent_seed`, `policy_section`, `rule_registry` |
| `app.db` `wf_*` | Java | `user`, `user_pref` (language, onboarded), `review_action`, `brief`, `precedent`, `exception_rule`, `chat_session`, `chat_message`, `audit_event` |

- **Audit:** `audit_event(seq, ts, actor, role, type, entity, payload_json, prev_hash, hash)` with `hash = SHA-256(prev_hash ‖ canonical(payload))`. SQLite triggers reject UPDATE and DELETE on this table. `GET /api/audit/verify` recomputes the chain.
- **Why SQLite and not Postgres:** a single file, no server to fail on stage, one-command reset. Concurrency is safe under the ownership rule above. If you deploy for multiple concurrent users, swapping to Postgres is a driver and DDL change only.
- **Schema loading:** a plain `schema.sql` at startup. No Flyway or JPA.

---

## 7. Frontend architecture

**Routes**
`/login` → `/onboarding` (first login only) → `/` (funnel dashboard) · `/queue` · `/cases/:id` (workbench) · `/precedents` · `/rules` (exceptions + governance) · `/audit` · `/eval` · persistent **chat/voice drawer** on every page.

**Onboarding (requirement):** on first login the user must see a **language selection** step (11 languages, native names, one tap). Next comes a **tour of four cards that can be skipped from every step**. Both choices persist to `wf_user_pref` and `localStorage`. The language can be changed later from the top bar.

**Workbench layout (`/cases/:id`)**
- Left: case header (tier badge, risk, dollars, member impact, severity, evidence strength, 30/60/90 selector with predicted risk and drivers).
- Center: tabs for **Brief** (sentences with citation chips), **Network** (Cytoscape), **Timeline**, **Evidence table**.
- Right: review panel (Accept / Modify / Reject / Request info, reason code, notes, supervisor approval status), precedents, limitations.
- Chat drawer overlays and is aware of the open case.

**Network view (official requirement: show relationships among providers, members, facilities, referrals, locations, ownership indicators and claims):** node types are provider, member (capped to the highest-dollar N), facility, address (location), owner and flagged claim. Edge types are `refers_to`, `owns`, `located_at`, `treated_at`, `billed_by`, `uses_phone`. Each edge has a label and a claim count. Clicking any node or edge opens the underlying claims table. Layout comes from the server (deterministic), so there is no layout jitter.

**State and data:** TanStack Query for all server data, Zustand only for UI (selected horizon, drawer open, language). Types are generated from the shared JSON schemas in `/contracts`.

**Animation (GSAP):**
- Dashboard funnel counts up and the funnel narrows from N alerts to the in-capacity cases.
- Queue re-packing animation when capacity changes.
- Graph edges reveal in sequence from the case's strongest evidence.
- Citation chips resolve into the brief as it renders.
- Confidence-tier badge and the "Insufficient evidence" state have distinct, restrained transitions.
- Page and onboarding transitions.
- Wrap everything in `gsap.matchMedia()` so `prefers-reduced-motion` disables motion. Use `useGSAP` for cleanup.

**Lenis:** enable only on `/login`, `/onboarding` and the printable brief/report view. **Disable it inside the workbench**, which has several internal scroll panes (tables, chat, graph), and mark those containers with `data-lenis-prevent`. Run Lenis from GSAP's ticker so ScrollTrigger stays in sync.

**Visual design:** dense but calm, dark-first with a light theme, one accent color for risk tiers (high/medium/low must also differ by icon and text, not color alone), tabular numerals for money, consistent spacing from shadcn tokens. Spend the design effort on the case workspace and the funnel; everything else uses stock shadcn components.

---

## 8. Security

- **Keys:** `ANTHROPIC_API_KEY` and the Sarvam key live in server environment variables, bound via `@ConfigurationProperties`. They are never in the frontend bundle. CI check: build the SPA and grep it for key-shaped strings and forbid any `VITE_*` variable containing "KEY". Logs redact auth headers. `.env` is git-ignored; ship `.env.example`.
- **Auth:** Spring Security, session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS), CSRF token via cookie repository, BCrypt-hashed seeded demo users, one per role. Record the demo credentials in the repo's seed/README file, not in chat or the UI.
- **RBAC:** enforced server-side on every endpoint and on chatbot tools. Two-person rule: the approver cannot be the proposer.
- **Python engine:** listens on `127.0.0.1` only, shared secret header from Java, no outbound network, never exposed by compose.
- **Abuse limits:** per-user rate limit on chat, voice and brief endpoints, a daily external-call budget with graceful "text-only / template mode" degradation, request size limits (audio ≤30 s, text length caps that match Sarvam's per-request limits).
- **Privacy:** synthetic data only, shown in a persistent banner. Audio is processed in memory and not stored. The audit log stores prompt hashes and decisions, not raw audio.
- **Responsible AI controls:** controlled language ("indicators", never "fraud"), no autonomous actions, no member demographics as model features, sole-provider disruption warning on cases, mandatory limitations section.

---

## 9. Deployment

- **Demo target:** a laptop. `docker compose up` starts two containers (Spring Boot serving the built SPA on one origin, and the Python engine on an internal network) sharing one volume for `app.db` and the data files. No CORS configuration is needed because of the single origin.
- **Makefile:** `make data` (download + ingest + inject), `make pipeline`, `make eval`, `make reset-demo` (restores `app.db` to a known snapshot), `make dev` (Vite dev server with proxy to Spring Boot).
- **Optional:** one small cloud VM with the same compose file, behind a reverse proxy with TLS, if judges want a URL. Skip it unless the venue network is unreliable.
- **Offline resilience:** the system runs with no network. Briefs and chat answers fall back to cached/template mode, and voice is disabled with a visible notice. Pre-generate and cache the briefs for the hero cases.

---

## 10. Testing

| Layer | What | Tool |
|---|---|---|
| Detection | Each rule's precision and recall on injected schemes must meet thresholds, so the rule table is a test suite. Pipeline determinism (same seed → same output hash) | pytest |
| Evaluation | Seed B metrics, ablation (rules / stat / graph / fused), precision@k at queue capacity, recall by difficulty, decoys reaching High tier = 0 | pytest + `make eval` |
| Validator | Fabricated number, missing citation, unknown ID, forbidden term, wrong tier, disallowed action, rounding tolerance | JUnit 5 |
| LLM behaviour | Recorded-response fixtures (no network in CI). Adversarial prompts: "is Dr. X a fraudster?", prompt injection inside a rationale field, asking for another role's data | JUnit + fixtures |
| Contracts | JSON schemas in `/contracts` validated on both sides (evidence pack, serving tables, engine requests) | pytest + JUnit |
| Security | RBAC matrix via MockMvc (investigator cannot approve; approver ≠ proposer; auditor read-only), audit-chain tamper test, secrets-in-bundle grep | JUnit, CI script |
| UI | Three Playwright smoke specs: first-login onboarding with skip, queue → case → brief → review, reject → exception → re-run. Plus a manual voice check | Playwright |
| Demo | Full rehearsal three times from `make reset-demo`, plus a recorded backup video | Manual |

**Compatibility smoke on day 1:** install the whole frontend stack on a blank project and build it. This is the only way to settle the unverified items (Recharts, Cytoscape, TanStack, react-i18next, Lenis loop behaviour). Drop-in alternatives if one fails: Recharts → visx or hand-rolled SVG; Cytoscape → sigma.js; react-i18next → a 40-line context with JSON dictionaries.

---

## 11. Exact tradeoffs and what to remove from the existing plan

### Tradeoffs
| Decision | Cost | Why we accept it |
|---|---|---|
| Java gateway in front of Python | About 4–6 hours of boilerplate; two languages; JSON contracts must stay in sync | Clear security boundary, a natural home for workflow, audit and the validator, and the stack the brief asked for. Mitigated by JSON-schema contracts and no JPA |
| Internal FastAPI instead of Java spawning Python scripts | One more process | Subprocess calls are fragile on Windows laptops and stage machines. HTTP on localhost is easy to health-check and mock |
| Validator in Java, not Python | Evidence-value logic lives in the gateway | It sits on the only path to the user, so it cannot be bypassed |
| Validate in English, then translate | Translation may alter phrasing | Keeps validation exact and citations attached per sentence. English original is always available |
| SQLite as the shared store | Single-writer limits | Ownership split avoids conflicts, and the demo is single-user |
| "Re-run" recomputes only the case stage | Detection isn't recomputed live | Makes the learning-loop demo take seconds and be reliable. Detection is deterministic, so skipping it changes nothing for an exception rule |
| Precomputed graph layout | Layout isn't interactive-physics | No jitter, faster, deterministic screenshots |
| Lenis only outside the workbench | Less "smooth" inside the app | Prevents scroll-conflict bugs across panes, and the workbench is where reliability matters |
| 11 full-support languages, not 22 | Smaller language menu | Matches what the voice stack supports. More can be text-only later |
| No streaming of briefs | Less "live typing" feel | Nothing unvalidated reaches the screen. Use GSAP reveal for polish instead |
| Backtest uses ground truth | Not available in real life | Labelled "synthetic-ground-truth backtest (demo environment)"; real deployments would use confirmed precedents |

### Remove from the existing plan
- **FastAPI as the public API** (now internal-only; Java is the public API).
- **LLM client and validator in Python** (moved to Java).
- **React-only auth/CORS thinking** (single origin, Spring Security).
- **Isotonic calibration, Louvain communities, "Retrain from feedback" button** (cut; keep a simple logistic fallback and a reliability plot only).
- **"Ask this case" as a stretch** (replaced by the mandatory multilingual chatbot).
- **Fairness panel, role-masked views, policy wiki page, records-request letter generator** (cut to stretch; keep only a static responsible-AI panel).
- **Postgres mention, Streamlit mention** (not used).
- **BM25 option** for precedents (structural match + cosine only).
- **Per-scheme "if time remains" status for S2, S6, S7 and for member/facility nodes** (reversed; see below).

### Reverse (the old plan weakened these official requirements)
1. **All six claim-level behaviours are mandatory:** duplicate billing, upcoding, unbundling, phantom services, excessive utilization, impossible timing. The old plan deferred upcoding (S2), impossible timing (S6) and excessive utilization (S7). They move into the MVP, each with an injected scheme, a detector and a test.
2. **The graph must show members, facilities, locations, ownership indicators and claims**, not just providers. The old plan collapsed members into edge weights. The new network view includes capped member and flagged-claim nodes.
3. **30/60/90 prediction is a selectable UI control** per case/provider, not a background model. One model per horizon, shown with drivers and a calibration plot.
4. **Queue ranking must show every official factor:** risk, potential dollars, member impact, severity, evidence strength and investigation capacity. Each has a column and a "why ranked here" breakdown.
5. **Briefs must contain all seven elements:** evidence, timeline, network context, confidence, limitations, recommended human-review action. The brief schema now has fields for each, and the validator rejects a brief missing one.
6. **"Thousands of alerts" must be literally true:** tune alert thresholds so the funnel starts in the thousands. The cases that remain are the "smaller, ranked set".

---

## 12. Requirements traceability matrix

**Legend:** *Component* = where it is built · *Proof* = what the judges see · *Test* = how we verify it.

### A. Official problem statement: core capabilities

| # | Official requirement | Component(s) | Proof in the demo | Test |
|---|---|---|---|---|
| A1 | Load and analyze synthetic claims **and** related provider, member, facility, referral, relationship and investigation data | Python ingest + overlay generator → DuckDB; canonical schema (claim, claim_line, provider, member, facility, address, owner, ownership, referral edges, investigation) | "Data" panel on the dashboard: row counts per entity, data-provenance note (CMS synthetic + our overlay) | pytest: schema and referential integrity; row-count assertions; seed determinism |
| A2 | Detect **duplicate billing** | Rules R-DUP-01/02 (SQL); injected S1 | Case with duplicate lines highlighted in the evidence table | pytest precision/recall on S1 |
| A3 | Detect **upcoding** | Peer-distribution shift (E&M level share vs specialty peers, z-score) + temporal change-point; injected S2 | Evidence item "share of top-level codes 0.62 vs peer median 0.18" with percentile | pytest on S2; recall by difficulty |
| A4 | Detect **unbundling** | R-PTP-01 using real NCCI PTP pairs; injected S3 | Evidence lists the Column 1 / Column 2 pair and policy citation | pytest on S3 |
| A5 | Detect **phantom services** | R-DOD-01 (after death), R-IP-01 (during inpatient stay elsewhere), ghost-member stat check; injected S5a/b/c | Timeline shows the claim after the date of death | pytest on S5 variants |
| A6 | Detect **excessive utilization** | Peer z-score + IsolationForest on visits/member/month; R-MUE-01 for unit limits; injected S4/S7 | Utilization vs peer chart in the case | pytest on S4, S7; decoy D1 must not reach High |
| A7 | Detect **impossible timing** | R-TIME-01 (minutes per day), R-GEO-01 (same member, distant facilities, same day); injected S6 | Timeline marker "same day, two facilities N km apart" | pytest on S6 |
| A8 | Use **at least two complementary approaches** | Four detector families (rules, statistical/ML, graph, temporal); **corroboration across families drives confidence** | Ablation table (rules-only vs stat-only vs graph-only vs fused) on `/eval` | pytest ablation: fused ≥ each single method on precision@k |
| A9 | **Show relationships** among providers, members, facilities, referrals, locations, ownership indicators and claims | Python graph builder (NetworkX) → `graph_json` (server layout); Cytoscape network view with all six node types and typed, labelled edges | Network tab: owner → clinics → DME supplier, member and claim nodes, edge claim counts; click-through to claims | Contract test on node/edge types; Playwright: open network, click edge, see claims |
| A10 | **Predict** likelihood of repeat or escalating FWA over a **selected 30-, 60- or 90-day horizon** | Python `HistGradientBoosting` × 3 horizons, time-split validation, `serving_prediction`; horizon selector in UI | Horizon selector on the case header, predicted risk, drivers, calibration plot and caveat | pytest: no leakage (features use data ≤ t); ROC/PR-AUC reported; UI test for selector |
| A11 | **SIU queue** ranking by **risk, potential dollars, member impact, severity, evidence strength, investigation capacity** | Python case scoring + capacity-aware greedy packing; Java queue API; React queue table with a capacity control | Queue with six factor columns, "why ranked here" panel, capacity slider that re-packs the queue | pytest: ordering and packing logic; Playwright: change capacity, queue changes |
| A12 | **Explainable investigation brief** with evidence, timeline, network context, confidence, limitations, recommended human-review action | Evidence pack (Python) → Claude (Java) → validator → brief UI with all seven sections | Brief tab with citation chips, timeline, network summary, tier + reasons, limitations, recommended action | JUnit: schema requires every section; validator tests; fixtures for LLM failure |
| A13 | **Desired outcome:** thousands of unexplained alerts → smaller ranked set of evidence-backed cases | Alert → case consolidation, tiering, capacity packing | Funnel animation: alerts → cases → High/Medium/Low → in-capacity queue, with % of injected dollars covered | pytest: alert count in the thousands, reduction ratio asserted, $ coverage computed |

### B. Official general guidelines

| # | Requirement | Component(s) | Proof | Test |
|---|---|---|---|---|
| B1 | Use only public or synthetic data | CMS synthetic files, synthetic overlay, re-keyed NPIs/TINs, no real LEIE/provider joins | Persistent "synthetic data" banner; data-provenance panel | Script asserts no raw NPI patterns survive in serving tables |
| B2 | Clear user journey: what the user enters, what the system does, what it returns, what happens when uncertain | Onboarding tour (skippable), step captions in the workbench, uncertainty states by tier | 4-card tour; "What happens next" strip on each case; Low tier shows "Insufficient evidence" and next steps | Playwright onboarding spec |
| B3 | Show evidence, sources or data fields supporting important outputs | Evidence items with IDs, citation chips linking to claims, rules (id@version), policy sections, graph edges, precedents | Click any chip → source drawer | Validator: no sentence without a valid evidence ID |
| B4 | Responsible AI: explain limitations, human in the loop, fail safely | Limitations section; validator + template fallback; two-person rule; controlled language; no autonomous actions | Low-confidence path, supervisor approval screen, "Template (validation fallback)" badge | JUnit: forbidden terms, RBAC matrix, fallback path |
| B5 | Working end-to-end flow, not screens or a generic chatbot | Full pipeline from data to decision to precedent, all backed by real services | Live demo from dashboard through to re-run | Playwright e2e specs; `make reset-demo` rehearsal |

### C. Organizer "Second Brain" expectations

| # | Expectation | Component(s) | Proof | Test |
|---|---|---|---|---|
| C1 | Connected context (documents, policies, rules, definitions, precedents, operational signals) | `policy_section`, `rule_registry`, data dictionary, precedent store, evidence pack | Source drawer shows policy, rule version, precedent, claims together | Contract tests on pack contents |
| C2 | Retrieve → Interpret → Apply rules → Propose → Score → Cite | Engine retrieval and rules, code-label interpretation, LLM proposal, deterministic score, validator | Each step labelled on the case view (provenance strip) | Integration test traces one case through every step |
| C3 | Confidence-aware (High / Medium / Low, explicit knowledge gap) | Deterministic tier from family corroboration, precedent fit, peer-group size | Tier badge with reasons; Low cases say what would raise confidence | pytest: tier boundaries; decoys never High |
| C4 | Human-in-the-loop: review, approve, reject, correct, escalate | Spring workflow, reason codes, supervisor approval, "AI proposed vs human decided" | Review panel and approval screen | RBAC tests; state-machine tests |
| C5 | Governance and auditability | Hash-chained `audit_event`, run IDs, rule versions, prompt hashes; audit replay | `/audit` page with replay and "chain verified ✓" | Tamper test: modify a row, verify fails |
| C6 | Workflow orchestration (knowledge → reasoning → recommendation → approval → action) | State machine; simulated action with status change and notification | Case moves New → … → Closed with visible actions | State-machine tests; e2e |
| C7 | Knowledge compounds (approved outcomes become reusable precedent) | `precedent` on close → exception draft → `/simulate` → governance approval → `/rerun` → new `run_id` | Reject a legitimate look-alike → lint/backtest → approve → funnel drops, next case cites the exception | pytest: backtest correctness; e2e spec; funnel diff asserted |
| C8 | Fail safely; avoid confident wrong answers | Template fallback; "not enough evidence" outputs; chatbot refusal template | Low-confidence demo moment | Adversarial prompt fixtures |

### D. Additional requirements set by the team

| # | Requirement | Component(s) | Proof | Test |
|---|---|---|---|---|
| D1 | React + TS + Vite, Tailwind + shadcn/ui | Frontend app | Whole UI | Build + lint in CI |
| D2 | GSAP premium animation | Funnel, queue packing, graph reveal, citation chips, onboarding; `useGSAP`; reduced-motion support | Dashboard and case animations | Manual + reduced-motion check |
| D3 | Lenis smooth scrolling | Lenis on login, onboarding and report view only, driven by GSAP ticker | Smooth scroll on those pages; workbench panes stay native | Day-1 sync test with ScrollTrigger |
| D4 | Minimal Java Spring Boot layer where useful | Spring Boot gateway (security, workflow, LLM + voice proxy, validator, audit) | Architecture slide | JUnit suites above |
| D5 | Python for data, detection, ML, graph, evaluation | Python engine | Eval page | pytest |
| D6 | Claude for grounded reasoning/explanation only | Java LLM service; Python computes all scores; validator | "Validated ✓" badge; template fallback | Validator and fixtures |
| D7 | Sarvam for multilingual voice / STT / TTS | Java voice proxy: Saaras `saaras:v4`, `sarvam-translate:v1`, `bulbul:v3` | Speak in Hindi → cited answer in Hindi → spoken summary | Fixture-based unit tests; manual voice check; limits enforced (30 s, 2,500/2,000 chars) |
| D8 | Secure backend handling of all API keys | Env-only secrets in Spring Boot; no keys in the SPA; redaction; rate limits | Security slide | Bundle-grep CI check; log-redaction test |
| D9 | Synthetic CMS claims + synthetic FWA overlay with ground truth | CMS synthetic claims + generator + two seeds | Eval page and data panel | Generator tests |
| D10 | Rules + ML/anomaly + graph + temporal | Four detector families | Ablation table | pytest |
| D11 | 30/60/90 prediction, SIU prioritization, briefs, review, audit, precedent loop | See A10, A11, A12, C4, C5, C7 | Demo flow | See rows above |
| D12 | **Multilingual chatbot** | Java chat service (read-only tools, RBAC-filtered), validator, per-sentence translation, drawer UI with text and voice | Chat drawer answering "why is this case ranked first?" in the user's language with citation chips | Fixture tests; adversarial prompts; language-switch spec |
| D13 | **First-login language selection + skippable onboarding** | `/onboarding` route; `wf_user_pref`; i18n JSON for 11 languages | First login shows language picker, then the skippable tour | Playwright onboarding spec |
| D14 | **Visually exceptional investigation workbench** | Case workspace design, funnel, network view, GSAP motion, dark/light themes | The demo itself | Visual QA checklist at hour 21 |

---

## Final summary

**The stack:** React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + GSAP + Lenis · Java 21 + Spring Boot 4.0.x (the only holder of secrets, the workflow owner, the validator) · Python 3.12 (pandas, DuckDB, scikit-learn, NetworkX, internal FastAPI) · Claude for validated explanations · Sarvam for STT, translation and TTS · SQLite + DuckDB · two processes via `docker compose`.

**What to do in the first hour:**
1. Download the CMS files in a browser and confirm field names.
2. Blank-project install of the full frontend stack and build it, to settle the unverified library items.
3. Read the Sarvam API reference for the auth header and request fields, and the Anthropic Java SDK page for the tool-use builder.
4. Freeze the `/contracts` JSON schemas (evidence pack, serving tables, engine requests).
