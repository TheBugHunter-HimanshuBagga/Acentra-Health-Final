# ClaimShield Nexus: Execution Plan (3–4 developers)

*Baseline: **48 hours**. A **24-hour cut line** is marked in §1 for a shorter event. The repository scaffold already exists and runs (`npm run setup`, `npm run dev`, `npm test`), so hour 0 starts with working tooling, not with installs.*

**Ruling principle:** the end-to-end core ships first and is protected. **Nothing optional (Claude, graph, prediction, chat, voice, polish) may delay milestone M1.** Optional features are added in layers, each of which must leave the system demo-able.

**One planning decision that differs from the design documents:** milestone M1 runs on a **small in-house generator** (about 20k claim lines), *not* on the CMS files. The CMS mapping is the single highest-uncertainty task (field names unverified, downloads blocked for automation, AMA click-through for NCCI), so it is a swap-in at M2 behind the same canonical schema, never on the critical path.

---

## 0. Team roles and parallel workstreams

| Role | 4 developers | 3 developers (merge) |
|---|---|---|
| **A: Data & Detection** (Python) | generator, canonical DuckDB schema, injectors, ground truth, rules, alerts, CMS adapter | **Python** (A + B): everything under `engine/`, ML and graph after M2 |
| **B: Cases, Graph & ML** (Python) | consolidation, scoring, tiers, queue inputs, evidence packs, graph, prediction, exceptions/simulate, eval | |
| **C: Gateway & AI** (Java) | security, read APIs, workflow, audit, jobs, Claude, validator, chat, Sarvam | **Java + integration** (C) |
| **D: Frontend** (React) | shell, queue, case room, review, network, timeline, governance, chat/voice, polish | **Web** (D) |

**Ownership rule:** each role owns its directory (`engine/`, `gateway/`, `web/`); `contracts/` changes need a note in the team channel and an update on both sides the same hour. Merge to the main branch at least every 2 hours.

**Integration checkpoints:** IC0 contracts frozen (H2) · IC1 gateway serves fixture data to the UI (H8) · **M1 core loop (H14)** · IC2 real data replaces fixtures and Claude on (H24) · IC3 precedent loop and re-run (H32) · IC4 chat, voice, onboarding (H40) · **code freeze H42**.

---

## 1. Hour-by-hour plan (48 h)

Times are hours from kickoff. **▶** marks a milestone or checkpoint; **✂24** marks the cut line if only 24 hours exist (stop everything below it and use the fallbacks in §8).

| Hours | A: Data & Detection | B: Cases, Graph & ML | C: Gateway & AI | D: Frontend |
|---|---|---|---|---|
| **0–2** | Read the data and engine docs; profile what the mini-generator must produce; start the **CMS download in a browser** (parallel, non-blocking) | Draft `evidence_pack` schema (`pk_v1`) and the case JSON shapes | Read the implementation architecture; seed the 4 users | App shell, routing, auth screen against mock data |
| **▶ IC0 (H2): freeze contracts** | `contracts/schemas/evidence_pack.schema.json`, response shapes in doc §8 agreed, SQL schemas already in place; fixtures of 5 sample cases written | | | |
| **2–6** | **Mini-generator:** members, providers, ~20k lines; canonical DuckDB tables; injectors DUP, PTP, MUE, DOD, EXCL, DME with ground truth in `gt.duckdb` | **Fixture publisher:** writes the fixture cases into `app.db` `serving_*` through `app_db.py` so the gateway and UI have real shapes immediately | `SecurityConfig` (session, CSRF), auth endpoints, problem+json handler, **audit service** (hash chain) + tests | Queue page, case page skeleton, TanStack Query client |
| **6–8** | Rules R-DUP-01, R-PTP-01, R-MUE-01, R-DOD-01, R-EXCL-01, R-DME-01 (SQL) | Case consolidation v1 (by provider), scoring formulas v1 | Read controllers: run, funnel, queue (with capacity packing), case, evidence, claims | Wire queue and case header to the real API |
| **▶ IC1 (H8): UI renders fixture data through the gateway** | | | | |
| **8–12** | Alerts table, dedup, **rule tests against ground truth** (pytest) | Tier logic v1 (deterministic), evidence pack v1 (templates), **`pipeline.py` publishes a real run** | Workflow: `review`, `approve`, `close`, case state machine, idempotency, audit-in-transaction | Case room v1: evidence table, claim lines, **review panel** (accept/modify/reject, reason codes) |
| **12–14** | Fix data and rule issues found in integration | Tune thresholds on the dev split | `GET/POST brief` with the **template brief** (no Claude yet) | Template brief display, decision flow end to end |
| **▶ M1 (H14): SYNTHETIC DATA → DETECTION → ALERT → CASE → EVIDENCE → INVESTIGATOR REVIEW → FINAL DECISION, with audit** | | | | |
| **14–20** | Remaining official behaviours: **upcoding, unbundling variants, excessive utilization, impossible timing (daily minutes + geo), phantom (stay, ghost)**; decoys D1–D5 | Peer statistics and IsolationForest; temporal CUSUM, growth, ramp; consolidation with network links | **Claude brief** (structured output + validator + fallback); health endpoint and banners | Dashboard: funnel (custom SVG), KPI strip; queue polish (five-factor signature, capacity bar) |
| **20–24** | **CMS adapter attempt** (2 h box). If the field checklist fails, stay on the generator | Capacity-aware queue inputs (`utility_30/60/90`); Monitor list; dashboard JSON | Chat service skeleton (tools, validator) behind a flag; rate limits; precedent creation on close | Network tab (Cytoscape + table view), timeline tab |
| **▶ IC2 (H24): real data + Claude live + all six official behaviours detected.** **✂24: stop here and polish; skip everything below except the precedent loop.** | | | | |
| **24–28** | Seed investigations (~100) and policy corpus (~20 sections), glossary, help articles | **Graph signals** (G-OWNREF, G-REFCONC, G-INFRA), graph JSON with preset layout | Cosign, **precedent conflict/reinforce checks**, exception endpoints, job tracking, `EngineClient` | Brief memo component, **citation chips + linked brushing**, confidence panel |
| **28–32** | Eval inputs: second seed for test split | **Prediction** (logistic baseline, then boosted trees), `precedent_fit`, **exception miner, `/simulate`, `/rerun`** | Wire `/rerun` + job polling; **audit verify and replay** endpoints | Precedent panel; **Governance screen**: proposal, simulation report, approve; **funnel diff animation** |
| **▶ IC3 (H32): reject a decoy → precedent → exception → simulate → approve → re-run → funnel diff works end to end** | | | | |
| **32–36** | Hero-case curation (§9) | Eval metrics, ablation table, calibration | Chat + **translation with protected tokens**; Sarvam client; voice transcribe | Language picker, **onboarding (skippable)**, i18n for 11 languages (build-time strings) |
| **36–40** | Demo snapshot builder | Knowledge lint; evaluation page data | Voice end to end; TTS; degradation paths | Chat sheet, mic states, audit ledger, Trust page |
| **▶ IC4 (H40): chat + voice + onboarding work in at least 3 languages** | | | | |
| **40–42** | Final data freeze; build the **demo snapshot** | Freeze thresholds; last regression | Pre-generate hero briefs; config freeze | Polish, reduced-motion pass, responsive pass |
| **▶ CODE FREEZE (H42): only bug fixes with a team sign-off** | | | | |
| **42–48** | Rehearsal ×3; metrics for slides | Rehearsal; fallback drills | Rehearsal; fallback drills; recorded video | Rehearsal; slides; recorded video; README; submission checklist (§14) |

**3-developer variant:** Python (A+B) pushes **graph, prediction, IsolationForest, knowledge lint and eval** after M2 and drops **IsolationForest first**; Web (D) postpones **timeline, knowledge constellation, light theme, audit replay slider**; Java (C) keeps everything but the **chat verifier**.

---

## 2. Exact MVP milestone M1 (hour 14)

> **Synthetic data → detection → alert → case → evidence → investigator review → final decision (with audit).**

| Stage | M1 scope (and nothing more) |
|---|---|
| Synthetic data | Mini-generator: ~300 members, ~40 providers, ~20k lines in the canonical DuckDB schema; 6 injected schemes (DUP, PTP, MUE, DOD, EXCL, DME) + 1 decoy; `gt.duckdb` |
| Detection | The 6 deterministic rules, tested against ground truth |
| Alert | `alert` rows, deduped per (rule, provider, month) |
| Case | Consolidation by provider; scores v1; **tier** (deterministic); case IDs |
| Evidence | Evidence pack v1 with templated statements and a numbers registry; claim lines |
| Review | Login → queue (list) → case page (evidence table, claim lines) → **Accept / Modify / Reject** with reason code; supervisor approval for a high-impact action |
| Final decision | **Close** the case (outcome + rationale) → `CLOSED`, a `PENDING_COSIGN` precedent row |
| Audit | Every step above is an audit row; `/api/audit/verify` returns OK |
| Brief | **Deterministic template brief only** |

**Explicitly not in M1:** Claude, graph, prediction, peer statistics, charts, animations, chat, voice, i18n, onboarding, CMS. **M1 passes only if a teammate who didn't build it can run `npm run dev`, log in, and complete a decision without help.** Record a 2-minute screen capture of it as the safety net.

---

## 3. MUST BUILD (the product is incomplete without these)

1. M1 core loop with audit and the two-person rule.
2. **All six official behaviours** detected (duplicate, upcoding, unbundling, phantom, excessive utilization, impossible timing), each with an injected scheme, a detector and a test.
3. **At least two complementary approaches** (rules + peer-statistical; add temporal and graph if M2 passes).
4. Alerts → cases consolidation, **tiers**, **SIU queue with all six factors and capacity**; funnel from thousands of alerts to a short ranked list.
5. Evidence pack and **validated brief** (Claude if available, template otherwise) containing all seven official elements.
6. **Network view of providers, members, facilities, referrals, locations, ownership, claims** (Cytoscape + table view).
7. **30/60/90-day risk** with a selectable horizon that affects ranking.
8. Human review panel, approvals, **audit trail with verify**.
9. **Precedent → exception → simulate → approve → re-run → funnel diff** (the Second Brain proof).
10. Confidence tiers with the explicit "insufficient evidence" outcome.
11. Responsible-AI controls: validator, forbidden lexicon, no AI write path, synthetic-data banner.
12. First-login language selection and skippable onboarding.
13. Multilingual chatbot (text) with validation.

## 4. SHOULD BUILD (build if M2 and M3 are green)
Claim timeline lanes; evidence explorer drawer; knowledge map (list view acceptable); governance override-rate and lint tabs; Trust/eval page with ablation; voice (STT + TTS) in 3+ languages; spoken summary; IsolationForest; dashboard compounding strip; light theme; print/report view; CMS adapter swap-in.

## 5. STRETCH
Knowledge constellation graph; audit replay slider; Lenis on all four designated pages; chat verifier (Haiku); records-request letter generator; retrain-from-feedback; fairness panel; role-masked views; multi-seed evaluation report; Docker-based demo environment.

## 6. DO NOT BUILD
A chat-first interface; LLM-generated scores or numbers; deep learning or GNNs; a vector database; microservices, Kafka, Kubernetes; SSE or websockets; real-provider data or any real-data join; any automatic punitive action; the word "fraud" in outputs; user management screens; a custom component library; full 22-language support; native mobile; real payment integration; anything that edits `serving_*` from Java or `wf_*` from Python.

---

## 7. Definition of done, per component

| Component | Done when |
|---|---|
| **Generator and injectors** | Deterministic (same seed → same table hashes); each injected scheme has labelled lines in `gt.duckdb`; DQ gates pass (FKs, dates, totals, no normal provider over the minute cap); no lineage column anywhere in `core` |
| **Each rule** | SQL file with `rule_id@version`; unit test: recall ≥ target on its scheme, **zero hits on the matching D5 hard negative**; policy citation exists |
| **Peer/temporal/graph detector** | Produces signals with metrics JSON; a test on injected positives; alarm rate on normal providers reported |
| **Case builder** | IDs stable across two runs of the same data; consolidation merges ring members and not shared-building providers; tier tests cover each rule in the tier table |
| **Evidence pack** | Validates against `evidence_pack.schema.json`; every number the brief may use is in `numbers`; hash is deterministic |
| **Publisher** | One transaction; `serving_current_run` flips last; killing the process mid-publish leaves the previous run readable |
| **Gateway: auth** | Login/logout/me; CSRF enforced; 401/403 as problem+json; role matrix test |
| **Gateway: workflow** | State machine rejects illegal transitions (`409`); idempotency key replays; self-approval blocked; every action writes an audit row in the same transaction |
| **Gateway: audit** | Chain verifies; tamper test (edit via a raw connection that bypasses the trigger in a test DB) is detected; triggers block UPDATE/DELETE |
| **Validator** | Unit tests for each BLOCK rule (fabricated number, missing citation, unknown ID, forbidden word, wrong tier, disallowed action); fallback template renders all seven brief elements |
| **Claude client** | Brief returns validated output on the 5 hero cases; refusal, `max_tokens`, timeout and invalid JSON each lead to a template with a reason code |
| **Chat** | Refusal fixtures pass; answers cite tool-returned IDs only; works with Claude off (`FACTS_ONLY`) |
| **Sarvam** | Transcribe and TTS work for 3 languages; each failure path degrades without an error screen; protected-token round trip test passes |
| **Frontend: queue and case room** | Keyboard operable; skeletons, empty and error states exist; linked brushing works; no console errors |
| **Frontend: governance** | Funnel diff animates from real job output; BLOCK verdict disables approve with an explanation |
| **Frontend: i18n** | 11 languages load; Indic font subset loads lazily; no clipped labels at +40% text length |
| **Reset** | `npm run reset-demo` returns to the snapshot in under 10 seconds; verified 3 times |

---

## 8. Failure fallbacks (decide now, not on stage)

| Risk | Early signal | Fallback |
|---|---|---|
| CMS files unusable | Field checklist fails in the 2-hour box (H20–22) | Stay on the generator; present "CMS-shaped synthetic data" honestly; keep the adapter code as a documented stub |
| Not enough Python hours | M1 slips past H16 | Drop IsolationForest, prediction trees (use logistic), graph to two signals |
| Claude unavailable or slow | Health shows DEGRADED | `LLM_MODE=template`; hero briefs pre-generated and cached; template badge is visible and honest |
| Sarvam unavailable | STT/TTS errors | `VOICE_ENABLED=false`; chat remains typed; demo voice from a recorded clip |
| Cytoscape trouble | Edge reveal or rendering issues | Table view as default; SVG fallback renderer for ≤ 60 nodes |
| Re-run too slow on stage | > 30 s | Pre-compute RUN-013 into the snapshot as a hidden run and flip `serving_current_run` in one SQL statement during the demo, still showing the real approval and funnel diff |
| SQLite lock contention | `database is locked` | Single publisher transaction; `busy_timeout=5000`; stop the pipeline CLI during the demo |
| Merge chaos | Contract mismatches | Contracts changed only in `contracts/`; fixtures for each endpoint; fix forward within the hour |
| Sandbox/environment | Local port binding fails in some restricted shells | Run the dev stack from a normal terminal (verified working on this machine) |
| Power or network on demo day | | Local-only run; recorded 6-minute backup video; screenshots of every hero screen |

---

## 9. Demo data preparation

1. **Seed and size:** `config/gen.yaml` seed fixed (`20261008`); regenerate until the hero cases below exist, then **freeze the seed** and never regenerate afterwards.
2. **Hero cases (curate exactly these, mark them in a `demo/heroes.json`):**
   - **H1: HIGH, DME mill + ring:** all four evidence channels, a shared owner, an exact-dollar rule hit. Used for the Room, graph, timeline, brief, review and supervisor approval.
   - **H2: HIGH, upcoding with a precedent citation:** shows the brief citing a precedent.
   - **H3: phantom (service inside an inpatient stay):** the timeline band moment.
   - **H4: LOW / Monitor:** the "insufficient evidence" screen.
   - **H5: D1 decoy (recurring-treatment center), test split, MEDIUM:** the rejected case that drives the exception; the seed precedent (`PRC-0057`-like) and the **pre-approved EXC-0001** (shared building) must exist.
3. **Run the pipeline**, then **pre-generate and cache briefs** for H1–H5 (`POST /brief` once each, with `LLM_MODE=live`), confirm all are Validated.
4. **Pre-compute the post-exception run** (the real result of approving the D1 exception) and keep it as a spare.
5. **Save the snapshot:** copy `data/app.db` to `data/demo/app.db.snapshot` (stop the services first); commit it.
6. **Accounts:** one user per role; the demo role switcher on.
7. **Pre-test:** the Hindi voice question on the real microphone and speakers; the exact script words; a cached answer for it.
8. **Provenance panel:** text ready to state what is CMS-derived, what is generated, and what is not available (labels, ownership, investigations).

## 10. Demo reset strategy
- **Before every run-through:** stop services → `npm run reset-demo` → start services → open the language screen in a fresh private window (so first-login onboarding appears) → confirm `/api/health`.
- **Inside the demo:** the exception approval is the only state change that matters; it is repeatable via reset.
- **If something breaks mid-demo:** switch to the recorded video for that segment, never debug live.

## 11. Testing checklist

**Automated (`npm test`, must be green at every integration checkpoint):** web (Vitest: component and store tests), engine (pytest: rules vs ground truth, determinism, publisher atomicity, as-of leakage), gateway (JUnit: security matrix, workflow state machine, audit chain, validator, schema init).

**Manual per checkpoint**
- M1: complete a decision end to end as two roles; verify audit chain.
- IC2: all six behaviours appear on the queue; brief renders with citations; template fallback triggers when the API key is removed.
- IC3: the whole exception loop; funnel diff matches the job output.
- IC4: three languages in text and voice; mic permission denied path; offline path.
- Accessibility: keyboard-only pass of queue → case → review; reduced-motion pass; contrast spot check.
- Failure drills: unplug network; set `LLM_MODE=template`; stop the engine; each must degrade visibly and safely.
- Security: no keys in the built bundle (grep for `sk-`, `ANTHROPIC`, `SARVAM`); `DEMO_MODE=false` removes the role switch; engine unreachable from outside localhost.

---

## 12. Final pre-submission checklist
- [ ] `npm run setup && npm run dev` works on a **clean clone** (on at least one teammate's machine)
- [ ] `npm test` green; `npm run lint` clean
- [ ] `.env` is **not** committed; `.env.example` is current; no API keys anywhere in the repo or bundle
- [ ] `data/raw/` not committed (NCCI behind an AMA license); license and attribution notes written
- [ ] Synthetic-data banner and provenance panel visible; no real provider, member or patient data
- [ ] `data/demo/app.db.snapshot` committed; `npm run reset-demo` verified
- [ ] Hero briefs cached and Validated; `LLM_MODE` and `VOICE_ENABLED` set for the demo environment
- [ ] README: what it is, quickstart, architecture diagram, how to run the demo, known limits
- [ ] "What these numbers prove and don't prove" is on the Trust page and in the slides
- [ ] 6-minute backup video recorded and tested; screenshots of every hero screen saved
- [ ] Slides: problem → funnel → Room → Second Brain loop → responsible AI → evaluation honesty → roadmap
- [ ] Rehearsed three times from a reset; timings noted; one person owns the clicker, one the narration, one watches the fallback
- [ ] Submission artifacts uploaded (repo link, video, slides), and a last-minute freeze tag created
