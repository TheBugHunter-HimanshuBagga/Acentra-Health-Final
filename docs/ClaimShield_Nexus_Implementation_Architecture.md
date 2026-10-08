# ClaimShield Nexus: Implementation Architecture

*How React, Spring Boot, Python, the databases, Claude and Sarvam fit together in code. Everything here is consistent with the scaffold that now exists in the repository (see §14). Where this document and an earlier one differ, **this one wins**; §15 lists the changes.*

---

## 1. Shape of the system (3 processes, 1 database file, no microservices)

```
Browser ──HTTPS, session cookie + CSRF──▶ Spring Boot gateway :8080 ──JDBC──▶ app.db (SQLite, WAL)  ◀──sqlite3── Python engine :8000
 (React SPA, no secrets)                    │  serves the built SPA            wf_*  (gateway writes)            serving_* (engine writes)
                                            │  holds ALL secrets                                                  │
                                            ├──HTTP 127.0.0.1 + X-Engine-Token──▶ engine internal API           └─ claims.duckdb, gt.duckdb (engine only)
                                            ├──HTTPS──▶ Anthropic API (Claude)
                                            └──HTTPS──▶ Sarvam API (STT, translate, TTS)
```

| Process | Role in one line |
|---|---|
| **React SPA** | Presentation only: no secrets, no business rules |
| **Spring Boot gateway** | Trust boundary: auth, RBAC, workflow, audit, LLM and Sarvam calls, validator, read APIs |
| **Python engine** | All analytics: data, detection, scoring, evidence packs, simulation. No network egress, no secrets |

**The single most important rule:** *engine writes `serving_*`, gateway writes `wf_*`; neither writes the other's tables.* Engine inputs that originate in `wf_*` (approved exceptions, active precedents) travel in request bodies.

---

## 2. Spring Boot responsibilities (kept minimal)

**Does:**
1. **Auth and RBAC:** session login, CSRF, four roles, the demo role switch.
2. **Read APIs that pass JSON through:** `serving_*` rows already hold finished JSON, so controllers return the stored text without mapping to POJOs.
3. **Workflow:** case state machine, review actions, approvals, closing, precedent and exception lifecycle.
4. **Queue packing:** sort stored utilities and apply capacity first-fit (about 15 lines).
5. **LLM service:** build prompt from the stored pack, call Claude, **validate**, fall back to a template brief.
6. **Chat and voice:** read-only tools over SQLite, validation, Sarvam STT/translate/TTS.
7. **Audit:** hash-chained append-only log and a verify endpoint.
8. **Job tracking:** start an engine re-run and expose its status.

**Does not:** read DuckDB; compute scores, tiers, or detections; train or run models; generate evidence packs; mutate `serving_*`; expose the engine to the browser.

**Package layout (`com.claimshield.gateway`):** `config/` (security, properties) · `auth/` · `api/` (controllers) · `workflow/` (cases, reviews, precedents, exceptions, jobs) · `llm/` (client, brief, chat, validator, template) · `voice/` (Sarvam client, protected tokens) · `audit/` · `engine/` (EngineClient). Roughly 20 classes at full build.

## 3. Python engine responsibilities

1. **Offline pipeline CLI** (`python -m claimshield.pipeline` via `node scripts/run-engine.mjs --module claimshield.pipeline`): generate or ingest data, inject, detect, alert, predict, then publish a run (Stage A + B). Run before the demo and in the demo-prep step.
2. **Internal API (FastAPI, 127.0.0.1:8000, `X-Engine-Token` required)**: only what must run on demand: **re-run Stage B**, **simulate** an exception, **propose** an exception. Nothing else; the engine does not answer case reads.
3. **Publishing:** one transaction writes the whole run into `serving_*`, then flips `serving_current_run`. Readers always see a complete run.
4. **Stable case IDs:** the engine reads the previous run's `serving_case` and lets a new case inherit an old ID when subject overlap (Jaccard) ≥ 0.5. That is why workflow rows can key on `case_id` alone.

## 4. Synchronous vs asynchronous

| Operation | Mode | Budget | Notes |
|---|---|---|---|
| All reads (`GET`) | sync | < 200 ms | JSON pass-through from SQLite |
| Review, approve, close, cosign | sync | < 300 ms | transactional, writes audit in the same transaction |
| Brief generation | **sync with timeout** | 25 s to Claude, then template | Cached by `(case_id, pack_sha256)`; hero-case briefs are **pre-generated** during demo prep so the demo normally hits the cache |
| Chat turn | sync | 25 s | up to 4 read-only tool calls |
| Transcribe (STT) | sync | 15 s | audio ≤ 28 s |
| Exception simulate / propose | sync | 10 s | engine call |
| **Re-run (Stage B)** | **async job** | seconds to ~30 s | `POST` returns `202 {jobId}`; UI polls `GET /api/jobs/{id}` every 500 ms. No SSE or websockets |
| Full pipeline (Stage A) | offline CLI, never via API | minutes | |

## 5. Database access

| Store | Python | Java | Browser |
|---|---|---|---|
| `data/claims.duckdb` | read/write | **never** | no |
| `data/gt.duckdb` | write (generation); read-only in train, eval, simulate | **never** | no |
| `app.db` `serving_*` | **write** (one transaction per run) | read | via gateway |
| `app.db` `wf_*` | **never** | **write** | via gateway |

- **SQLite settings (both processes):** `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`. In the scaffold these are in `gateway/src/main/resources/application.yml` (JDBC URL) and `engine/claimshield/db/app_db.py`.
- **Path:** both resolve `APP_DB_PATH` to the same absolute file (the scripts make relative paths absolute against the repo root).
- **Schema ownership:** `contracts/sql/serving_schema.sql` (applied by the engine; 18 tables) and `contracts/sql/wf_schema.sql` (applied by the gateway at startup; 11 tables). Both validated; the audit-log triggers reject `UPDATE`/`DELETE`.
- **Detached facts:** workflow rows reference cases by `case_id` and never by run, so decisions survive a re-run.

## 6. Authentication assumptions

- **Demo-grade, not production IAM:** four seeded users (one per role: INVESTIGATOR, SUPERVISOR, GOVERNANCE, AUDITOR), BCrypt-hashed. Record the seed credentials in the seed file and `README` for the team; never in chat or the UI.
- **Session cookie** (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS) plus **CSRF** via the `XSRF-TOKEN` cookie and `X-XSRF-TOKEN` header. *Spring Security's default CSRF handler masks the token, which breaks a SPA reading the cookie. Configure the plain request handler and confirm on day 1 **[verify for Spring Security 7]**.*
- **Same origin:** the SPA is served by the gateway in production and proxied by Vite in development, so no CORS configuration.
- **Demo role switch:** `POST /api/auth/switch-role` exists **only when `DEMO_MODE=true`**; it re-authenticates as the seeded user for the requested role. Production-like runs set `DEMO_MODE=false`.
- **Engine link:** shared secret `ENGINE_TOKEN` in the `X-Engine-Token` header, constant-time compared; the engine binds to 127.0.0.1 (internal Docker network only in compose).
- **Rate limits:** in-memory per-user token bucket on `brief`, `chat`, `voice` endpoints; a daily external-call budget degrades to template or text-only mode.

## 7. API error handling

All errors are `application/problem+json` (RFC 9457 shape):
```json
{ "type": "https://claimshield.local/errors/action-not-permitted", "title": "Action not permitted",
  "status": 422, "code": "ACTION_NOT_PERMITTED",
  "detail": "PREPAY_REVIEW_FLAG is not permitted for a MEDIUM case.", "traceId": "b3f1…",
  "errors": [{"field":"newAction","message":"must be one of REQUEST_RECORDS, PROVIDER_EDUCATION, MONITOR"}] }
```
| Code | HTTP | Meaning / UI behaviour |
|---|---|---|
| `AUTH_REQUIRED` | 401 | redirect to login |
| `FORBIDDEN_ROLE` | 403 | disabled control explains who can do it |
| `CSRF_INVALID` | 403 | silent token refresh, retry once |
| `NOT_FOUND` | 404 | empty state |
| `VALIDATION_FAILED` | 422 | field errors inline |
| `ACTION_NOT_PERMITTED` | 422 | action not in `permitted_actions` |
| `REASON_REQUIRED` | 422 | reason code required for Modify/Reject |
| `STATE_CONFLICT` | 409 | case not in a state allowing this; refresh |
| `SELF_APPROVAL_FORBIDDEN` | 403 | proposer cannot approve |
| `LINT_BLOCKED` | 409 | exception cannot be approved; show lint reasons |
| `JOB_RUNNING` | 409 | a re-run is already in progress |
| `RATE_LIMITED` | 429 | show retry-after |
| `ENGINE_UNAVAILABLE` | 503 | banner "analytics engine offline"; reads still work |
| `UPSTREAM_TIMEOUT` | 504 | only for non-degradable calls |
| *(Claude/Sarvam failures)* | **200** | **degrade, do not error**: `mode: "TEMPLATE"` / `FACTS_ONLY`, `voice: false` |

**Idempotency:** `POST` review, approve, close and cosign accept an `Idempotency-Key` header (UUID from the UI per click); a repeated key returns the original response (backed by the unique `idempotency_key` column), so a double-click never duplicates a decision.

## 8. Public REST API (`/api`, JSON, session cookie, CSRF on mutating calls)

### 8.1 Auth and profile
| Method + path | Body → Response |
|---|---|
| `POST /api/auth/login` | `{"username","password"}` → `200 {"user":{"id","username","displayName","role","language","onboarded"}}` |
| `POST /api/auth/logout` | → `204` |
| `GET /api/auth/me` | → `200` user object, or `401` |
| `PUT /api/me/prefs` | `{"language":"hi","onboarded":true,"onboardingSkipped":true}` → `200` prefs |
| `POST /api/auth/switch-role` *(demo only)* | `{"role":"SUPERVISOR"}` → `200` user object |

### 8.2 Run, funnel, dashboard, queue
| Method + path | Response (abridged) |
|---|---|
| `GET /api/runs/current` | `{"runId":"RUN-012","asof":"2026-09-30","createdAt","exceptionSet":["EXC-0001"],"precedentCount":103,"status":"COMPLETE"}` |
| `GET /api/funnel` | `{"runId","stages":[{"key":"alerts","label":"Alerts","count":4812},{"key":"active","count":1930},{"key":"cases","count":74},{"key":"inCapacity","count":37}],"tiers":{"HIGH":12,"MEDIUM":31,"MONITOR":31},"dollars":{"exact":1200000.0,"estimated":700000.0},"coverage":{"pct":0.91,"basis":"synthetic-ground-truth"},"diffFrom":null}` |
| `GET /api/dashboard` | stored JSON: KPIs, exposure by scheme, alerts vs cases series, needs-you-now, compounding strip |
| `GET /api/queue?horizon=90&capacityHours=240&tier=&scheme=&specialty=&status=` | see below |

```json
{ "runId":"RUN-012","horizon":90,"capacityHours":240,"usedHours":212.0,
  "items":[{ "caseId":"CASE-0417","rank":1,"tier":"HIGH","status":"IN_REVIEW",
    "subjects":[{"id":"P-0488","role":"PRIMARY","label":"DME supplier"}],"hypotheses":["DME","RNG"],
    "factors":{"risk":0.82,"dollarScore":0.74,"memberImpact":0.61,"severity":0.85,"evidenceStrength":0.78},
    "dollars":{"exact":48210.55,"estimated":61000.0,"basis":"EXACT"},"trend":"ESCALATING",
    "estHours":18.0,"inCapacity":true,"deferReason":null,"assignedTo":null }] }
```
Packing is done in the gateway: order by `utility_{horizon}` descending, first-fit against `capacityHours`.

### 8.3 Case reads (stored JSON passed through; all scoped to the current run)
| Path | Returns |
|---|---|
| `GET /api/cases/{caseId}` | `header_json` + workflow `status`, `assignedTo`, outlook `{30,60,90}`, tier reasons, channels |
| `GET /api/cases/{caseId}/evidence` | evidence items, numbers registry, limitations, permitted actions (from the pack) |
| `GET /api/cases/{caseId}/claims?evidenceId=&page=0&size=50` | `{"total":63,"items":[{"claimId","lineNo","memberId","providerId","serviceDt","hcpcs","label","units","paid","flagRole"}]}` |
| `GET /api/cases/{caseId}/graph` | `{"nodes":[{"id","type","label","x","y","role"}],"edges":[{"id","source","target","type","label","nClaims"}]}` |
| `GET /api/cases/{caseId}/timeline` | lanes for volume, flagged markers, context events (stays, death, enrolment, investigations), trend |
| `GET /api/cases/{caseId}/precedents` | `[{"precedentId","similarity","disposition","reasonCode","rationale","compare":[{"feature","case","precedent"}]}]` |
| `GET /api/monitor` | Monitor (Low) items with `reasons` and `whatWouldRaiseConfidence` |

### 8.4 Brief
| Method + path | Body → Response |
|---|---|
| `GET /api/cases/{caseId}/brief` | `200` latest brief for the current pack hash, or `204` if none |
| `POST /api/cases/{caseId}/brief` | `{"regenerate":false}` → `200` brief (sync; cached by pack hash) |

```json
{ "briefId":"B-7f3a","caseId":"CASE-0417","mode":"LLM","badge":"VALIDATED","generatedAt":"2026-09-30T10:12:03Z",
  "packSha256":"9c1e…","model":"claude-sonnet-5-5",
  "sections":{ "headline":{"text":"Indicators consistent with …","citations":["E1","E2"]},
    "summary":[{"text":"63 DME orders had no qualifying visit …","citations":["E1"]}],
    "timelineNotes":[], "networkNotes":[], "precedentNotes":[],
    "confidenceStatement":{"text":"…","citations":["TR1","TR2"]},
    "hypothesis":"DME","recommendedAction":"REQUEST_RECORDS",
    "actionRationale":{"text":"…","citations":["E1"]},
    "investigatorChecklist":[], "whatWouldChangeMyMind":[],
    "limitations":[{"text":"Peer group n=57","limitationIds":["L1"]}],
    "insufficientEvidence":false },
  "validation":{"passed":true,"retries":0,"fallbackReason":null,"checks":[{"id":"V2","result":"PASS"}]} }
```
When Claude fails or validation fails twice: **still `200`**, with `"mode":"TEMPLATE","badge":"TEMPLATE_FALLBACK","validation.fallbackReason":"VALIDATION_BLOCKED"` (or `API_ERROR`, `REFUSAL`, `TIMEOUT`, `BUDGET`).

### 8.5 Review, approval, close
| Method + path | Body → Response |
|---|---|
| `POST /api/cases/{caseId}/review` (`Idempotency-Key`) | `{"action":"MODIFY","newAction":"PREPAY_REVIEW_FLAG","hypothesis":"DME","reasonCode":"NEEDS_RECORDS","notes":"…"}` → `201 {"actionId","caseStatus":"ACTION_PROPOSED","requiresApproval":true,"approvalNeeded":"SUPERVISOR"}` |
| `GET /api/cases/{caseId}/reviews` | action history with AI-vs-human diff |
| `POST /api/review-actions/{actionId}/approve` (`Idempotency-Key`) | `{"decision":"APPROVE","notes":"…"}` → `200 {"status":"APPROVED","caseStatus":"ACTION_APPROVED"}` (403 `SELF_APPROVAL_FORBIDDEN` if proposer) |
| `POST /api/review-actions/{actionId}/execute` | simulate executing the approved action → `200 {"caseStatus":"ACTION_TAKEN","letter":{…}}` |
| `POST /api/cases/{caseId}/rationale-draft` | → `200 {"text":"…","aiDrafted":true}` (validated draft; the UI marks it "AI draft: edit required") |
| `POST /api/cases/{caseId}/close` (`Idempotency-Key`) | `{"outcome":"UNFOUNDED","reasonCode":"LEGIT_CLINICAL_PATTERN","rationale":"…","aiDrafted":false,"recovered":0}` → `201 {"caseStatus":"CLOSED","precedentId":"PRC-0103","precedentStatus":"PENDING_COSIGN","exceptionEligible":true}` |

### 8.6 Precedents and exceptions
| Method + path | Body → Response |
|---|---|
| `GET /api/precedents?status=&scheme=&specialty=` | list |
| `POST /api/precedents/{id}/cosign` | `{"decision":"CONFIRM"}` → `200` (status `ACTIVE`; triggers a re-run job; returns `{"jobId"}`) |
| `GET /api/exceptions?status=` | list |
| `POST /api/exceptions/propose` | `{"caseId","precedentId"}` → `201` draft: `{"excId":"EXC-0002","version":1,"status":"DRAFT","scope":{…},"condition":[{"field":"lines_per_member","op":"<=","value":14.0},{"field":"hard_fact_alert_count","op":"==","value":0}],"effect":"DOWNGRADE_TO_MONITOR","supportN":2,"flags":[]}` |
| `POST /api/exceptions/{excId}/simulate` | → `200` report (engine) and status `SIMULATED` |
| `POST /api/exceptions/{excId}/submit` | → `200` status `PENDING_APPROVAL` |
| `POST /api/exceptions/{excId}/approve` (`Idempotency-Key`) | `{"decision":"APPROVE","notes":"…"}` → `200 {"status":"APPROVED","jobId":"J-91"}` (Governance role; proposer ≠ approver; `409 LINT_BLOCKED` if verdict BLOCK) |
| `POST /api/exceptions/{excId}/retire` | → `200 {"jobId"}` |
| `POST /api/exceptions/{excId}/explain` | → `200` validated plain-language explanation |

### 8.7 Jobs
| Method + path | Response |
|---|---|
| `POST /api/runs/rerun` | `202 {"jobId":"J-91"}` (`409 JOB_RUNNING` if one is active) |
| `GET /api/jobs/{jobId}` | `{"jobId","status":"RUNNING","stage":"scoring","resultRunId":null,"diff":null}` → when done `{"status":"DONE","resultRunId":"RUN-013","diff":{"alerts":-312,"cases":-4,"tierChanges":[{"caseId":"CASE-0155","from":"MEDIUM","to":"MONITOR","via":"EXC-0002"}]}}` |

### 8.8 Knowledge, audit, trust
| Method + path | Response |
|---|---|
| `GET /api/knowledge/{policies\|rules\|glossary\|help}` | lists |
| `GET /api/knowledge/graph` | nodes and links for the Knowledge map |
| `GET /api/knowledge/lint` | open lint findings |
| `GET /api/audit?entityType=&entityId=&type=&from=&to=&cursor=&limit=50` | `{"items":[{"seq","ts","actor","role","eventType","entityType","entityId","payload","prevHash","hash"}],"nextCursor"}` |
| `GET /api/audit/verify` | `{"ok":true,"checked":1204,"lastSeq":1204,"firstBadSeq":null}` |
| `GET /api/audit/replay?caseId=&at=` | the pack, brief, decisions and exceptions in force at time `at` |
| `GET /api/eval` | stored evaluation JSON (ablation, calibration, decoys at HIGH, blind spots) |
| `GET /api/meta/provenance` | data provenance text and counts |
| `GET /api/health` | `{"status":"UP","engine":"UP","llm":"LIVE\|TEMPLATE\|DEGRADED","voice":"ON\|OFF\|DEGRADED","run":"RUN-012"}` (no secrets) |

### 8.9 Chat and voice
| Method + path | Body → Response |
|---|---|
| `POST /api/voice/transcribe` | multipart `audio` (WebM/Opus or MP4) + `language` → `{"transcript","languageCode":"hi-IN","languageProbability":0.97}` |
| `POST /api/chat` | `{"sessionId":null,"message":"यह केस पहले क्यों है?","lang":"hi","speak":true,"context":{"page":"case","caseId":"CASE-0417","horizon":90}}` → below |

```json
{ "sessionId":"S-12","messageId":"M-88","intent":"CASE_QA","mode":"LLM",
  "blocks":[{"text":"यह केस …","textEn":"This case ranks first because …","translated":true,"sourceIds":["E1","E3"]}],
  "links":[{"type":"CASE","id":"CASE-0417"}], "insufficientKnowledge":false,
  "validation":{"passed":true,"retries":0},
  "audio":{"mime":"audio/wav","base64":"…","summaryText":"…"} }
```
`mode` is `LLM`, `FACTS_ONLY` (validated retrieved facts when Claude fails), or `REFUSAL` (fixed, pre-translated template). `audio` is `null` when voice is off or fails.

## 9. Internal engine API (gateway → engine only; `X-Engine-Token`)

| Method + path | Request → Response |
|---|---|
| `GET /internal/health` | → `{"status":"UP","version","currentRun"}` *(implemented in the scaffold)* |
| `POST /internal/rerun` | `{"requestId","exceptions":[{"excId","version","scope","condition","effect"}],"livePrecedents":[{"precedentId","schemeType","specialtyCode","disposition","featureVector","closedDt"}],"capacityDefaultHours":240}` → `202 {"engineJobId":"E-4"}` (runs Stage B in a worker thread; **one job at a time**) |
| `GET /internal/jobs/{engineJobId}` | → `{"status":"RUNNING\|DONE\|FAILED","stage":"consolidation","runId":"RUN-013","error":null}` |
| `POST /internal/simulate` | `{"draft":{"scope","condition","effect"}}` → `{"alertsSuppressed":312,"providersAffected":9,"casesAffected":4,"dollarsNoLongerReviewed":84210.0,"tierShifts":{"MEDIUM->MONITOR":4},"conflictsWithConfirmed":[],"breadthShare":0.12,"hardFactTouches":0,"groundTruthPositivesLost":0,"lint":{"verdict":"PASS","reasons":[]}}` (`groundTruthPositivesLost` is non-null in the demo environment only) |
| `POST /internal/exceptions/propose` | `{"caseId","closure":{"outcome","reasonCode"},"precedentIds":["PRC-0057"]}` → draft exception (as in §8.6) |

Engine failures map to `ENGINE_UNAVAILABLE` (503) in the gateway; reads keep working from `serving_*`.

---

## 10. Claude integration (gateway)

- **Client:** official `com.anthropic:anthropic-java` (**2.70.0** is the current Maven Central release; the docs showed 2.60.0), `AnthropicOkHttpClient.fromEnv()`; key from `ANTHROPIC_API_KEY`. Abstract behind `LlmClient` with two implementations: `AnthropicLlmClient` and `TemplateOnlyClient`; `LLM_MODE=template|live` chooses.
- **Briefs:** structured output via the verified class-based form: `MessageCreateParams.builder().model(...).maxTokens(...).system(...).addUserMessage(packJson).outputConfig(BriefOutput.class).build()`; `BriefOutput` must be a **top-level or static nested class**. Models: `claude-sonnet-5-5` (briefs, chat), `claude-haiku-5-5` (optional verifier).
- **Do not** use `tool_choice: tool|any` on these models (HTTP 400).
- **Chat:** strict tools (`strict(true)`, `tool_choice` auto) for the read-only retrieval tools, plus a structured final answer. Limit: 4 tool calls per turn (strict-tool limits: ≤ 20 tools, ≤ 24 optional parameters).
- **Stop reasons:** handle `refusal` and `max_tokens` explicitly (output may not match the schema).
- **Caching:** cache the static system prompt and schema (minimum 512 tokens on Sonnet 5.5); the per-case pack follows the breakpoint. Confirm `cache_read_input_tokens > 0` on the second call.
- **Timeouts and breaker:** 25 s total, one retry with the validator's error codes, then template. A simple circuit breaker (3 consecutive fallbacks in 60 s → template mode for 5 minutes) sets `health.llm = DEGRADED`.
- **Audit:** every call logs model, prompt-template version, `prompt_sha256`, `pack_sha256`, `response_sha256`, stop reason, latency, retries, validation result.

## 11. Sarvam integration (gateway)

- **Client:** Spring `RestClient`; header **`api-subscription-key`** from `SARVAM_API_KEY`; per-call timeouts (STT 15 s, translate 10 s, TTS 15 s); one retry with jitter on 429/5xx; failures degrade, never error the request.
- **STT:** `POST https://api.sarvam.ai/speech-to-text` multipart: `file` (WebM/Opus accepted as-is), `model=saaras:v4`, `language_code`, `keyterms` (≤ 50 domain terms, v4 only). Audio < 30 s.
- **Translate:** `POST https://api.sarvam.ai/translate` JSON: `model=sarvam-translate:v1`, `source_language_code=en-IN`, `target_language_code`, `mode=formal`, `numerals_format=international`; ≤ 2,000 characters per call. Sentences carry citations as tokens (`⟦n1⟧`) that must survive; otherwise that sentence stays English.
- **TTS:** `POST https://api.sarvam.ai/text-to-speech` JSON: `text` (≤ 2,500 characters), `language_code`, `model=bulbul:v3`, `speaker`, `pace`, `speech_sample_rate=24000`. **Unverified:** response encoding (base64 vs bytes) and speaker-per-language; the adapter handles both encodings by content type.
- **Static UI strings** are translated at build time (not at runtime).

## 12. The five core flows

### 12.1 Evidence pack
`engine Stage B → serving_evidence_pack(pack_json, pack_sha256)` → gateway `GET …/evidence` returns it; `POST …/brief` loads it, builds the prompt, calls Claude, validates, stores `wf_brief` (unique on `(case_id, pack_sha256)`). The pack hash changes only when the run changes the case, so briefs are reused across unrelated re-runs.

### 12.2 Case review
```
UI POST /review  →  gateway: authz(role) → load serving_case + pack → check action ∈ permitted_actions
                    → check reason code (Modify/Reject) → insert wf_review_action (+ idempotency key)
                    → update wf_case_state → audit_event (REVIEW_ACTION)  [one transaction]
   if requires_approval:  status PENDING_APPROVAL → supervisor POST /approve (approver ≠ proposer)
                          → ACTION_APPROVED → POST /execute (simulated) → ACTION_TAKEN → POST /close
```

### 12.3 Precedent
```
POST /close → gateway: read serving_case.fv_json (features at case-open) → insert wf_precedent(status PENDING_COSIGN)
            → audit PRECEDENT_CREATED → conflict/reinforcement check (cosine vs ACTIVE precedents, in Java)
POST /precedents/{id}/cosign (second person) → status ACTIVE → start re-run job (livePrecedents in the body)
            → next run: engine computes precedent_fit with the new precedent → tier and brief change
```

### 12.4 Exception and re-run (the demo's climax)
```
close as UNFOUNDED + eligible reason → POST /exceptions/propose → engine miner → wf_exception_rule DRAFT
→ /simulate (engine) → SIMULATED, lint verdict → /submit → PENDING_APPROVAL
→ /approve (Governance) → gateway: status APPROVED → wf_job QUEUED → POST /internal/rerun (all approved exceptions + live precedents)
→ engine publishes RUN-013 (one transaction, flips serving_current_run) → UI polls /api/jobs/{id} → DONE with diff → funnel diff animation
```

### 12.5 Audit
Every state-changing service method writes an audit row **in the same transaction**: `prev_hash` is the previous row's `hash`; `hash = SHA-256(prev_hash ‖ canonical_json(payload))`. `GET /api/audit/verify` recomputes the chain. LLM, Sarvam, chat-tool, review, approval, close, precedent, exception, job and auth events are all logged (see the Second Brain document §15). SQLite triggers make the table append-only.

---

## 13. Reliability and demo-safety design
- **No hard external dependency on stage:** Claude and Sarvam degrade (template briefs, facts-only chat, text-only); the engine only needs to be up for re-run, simulate, propose.
- **Pre-generation:** the demo-prep step pre-generates and caches briefs for the hero cases, so the demo does not depend on a live Claude call.
- **One-command reset:** `npm run reset-demo` restores `data/app.db` from `data/demo/app.db.snapshot` (stop the services first).
- **Health banner:** `GET /api/health` drives the "Template mode" and "Voice unavailable" banners.

## 14. Monorepo structure (as it exists today, with planned files marked)

```
CareX-FINAL/                         (repo root)
├─ README.md                         (planned: quickstart)
├─ context.md                        project context hand-off
├─ package.json                      root scripts (setup, dev, test, lint, reset-demo, compose:*)
├─ docker-compose.yml                gateway + engine, one shared volume
├─ .env.example   .env               (.env is local, git-ignored)
├─ .gitignore
├─ config/
│  └─ gen.yaml                       seeds, sizes, scheme and decoy counts
├─ contracts/
│  ├─ README.md
│  ├─ sql/serving_schema.sql         18 serving_* tables (engine writes)
│  ├─ sql/wf_schema.sql              11 wf_* tables (gateway writes, applied at startup)
│  └─ schemas/                       (planned: evidence_pack.schema.json, brief_output.schema.json, chat_answer.schema.json)
├─ data/
│  ├─ raw/                           downloaded CMS and NCCI files (git-ignored)
│  ├─ processed/                     parquet snapshots (git-ignored)
│  └─ demo/                          app.db.snapshot for reset-demo (committed once built)
├─ docs/                             the design documents + source/PS_Hf.txt (official problem statement)
├─ infra/
│  ├─ Dockerfile.gateway             builds web, embeds it in the jar, Java 25 JRE
│  └─ Dockerfile.engine              python:3.12-slim + uvicorn
├─ scripts/
│  ├─ lib.mjs  dev.mjs  setup.mjs  run-gateway.mjs  run-engine.mjs  reset-demo.mjs
├─ engine/                           Python 3.12
│  ├─ pyproject.toml  requirements.txt  requirements.lock  .venv/ (local)
│  ├─ claimshield/
│  │  ├─ api/main.py                 internal FastAPI (health implemented)
│  │  ├─ db/app_db.py                SQLite connect (WAL) + serving schema apply
│  │  ├─ adapters/                   CMS adapter(s) and field checklist
│  │  ├─ generate/                   mini-generator, overlay, injectors, ground truth
│  │  ├─ features/                   provider-month/day features
│  │  ├─ detect/                     rules (SQL), stat, temporal
│  │  ├─ graph/                      graph signals
│  │  ├─ predict/                    30/60/90 models
│  │  ├─ cases/                      alerts, consolidation, scoring, tiers, queue utilities
│  │  ├─ evidence/                   evidence packs, template statements
│  │  ├─ eval/                       metrics, ablation
│  │  └─ pipeline.py                 (planned) offline CLI
│  ├─ sql/                           (planned) rule SQL files
│  └─ tests/                         pytest (4 tests passing)
├─ gateway/                          Spring Boot 4.1.1, Java 25
│  ├─ pom.xml                        web MVC, security, jdbc, validation, actuator, sqlite-jdbc, anthropic-java
│  └─ src/main/java/com/claimshield/gateway/{config,auth,api,workflow,llm,voice,audit,engine}/
│     src/main/resources/application.yml   src/test/java/...  (3 tests passing)
└─ web/                              React 19 + TypeScript + Vite 8
   ├─ package.json  vite.config.ts   (alias @, /api proxy, vitest)  components.json (shadcn)
   └─ src/
      ├─ components/ui/              shadcn components (installed)
      ├─ lib/utils.ts   test/setup.ts   App.tsx (compatibility smoke page)
      └─ (planned) app/ routes/ features/{queue,case,network,timeline,brief,review,knowledge,governance,audit,chat,voice}/ i18n/ stores/
```

**Local development:** `npm run setup` once, then `npm run dev` starts web (5173, proxies `/api`), gateway (8080) and engine (8000, 127.0.0.1) together with prefixed logs; `npm test` runs all three suites; `docker compose up --build` gives the prod-like runtime.

## 15. Changes from earlier documents
1. **Java 25 LTS** (installed; supported by Boot 4) instead of Java 21. **Spring Boot 4.1.1** (latest GA) instead of 4.0.x. The web starter is **`spring-boot-starter-webmvc`**.
2. **Case IDs are stable and engine-assigned**; `wf_*` rows key on `case_id` (the earlier `case_key` idea is dropped).
3. **Queue packing lives in the gateway** (stored utilities per horizon); the engine does not serve queue reads.
4. **Precedents:** `fv_json` is stored at case creation so precedent creation needs no engine call; live precedents reach the engine in the re-run body.
5. **No SSE or websockets:** jobs are polled.
6. **`@tanstack/react-table` is pinned to v8** (v9 exists; its API was not evaluated). `@types/cytoscape` is not installed (Cytoscape ships types).
7. **First milestone uses a mini-generator**, not the CMS files; the CMS adapter is a later swap-in (see the execution plan).
8. The root dev runner is a dependency-free script (`scripts/dev.mjs`) because `concurrently` pulled in a package with a critical advisory.

## 16. Milestone M1 implementation notes (where the code differs from, or settles, this document)

1. **Added error code `INVALID_CREDENTIALS` (401)** for a failed sign-in; unknown user and wrong password return the identical response (a dummy BCrypt comparison keeps timing similar). `AUTH_REQUIRED` remains for a missing session.
2. **Idempotency:** `Idempotency-Key` is honoured on `POST /cases/{id}/review` (unique column `wf_review_action.idempotency_key`). Approve, execute and close are idempotent **by state** (a repeat by the same actor returns the original result with `replayed: true`) because the schema has no key table, and the contract was kept unchanged.
3. **Single write lock:** every state change runs under one process-wide lock plus one DB transaction (`Tx.write`). This is what keeps the hash-chained audit log linear when requests arrive concurrently (tested with 8 parallel decisions).
4. **Audit hash:** `hash = SHA-256(prev_hash, ts, actor, role, event_type, entity_type, entity_id, payload_json joined by newlines)`, over the exact stored text of every column, so editing any of them is detected at that row. Genesis `prev_hash` is 64 zeros.
5. **Case dollars (engine):** `dollars_exact` is the sum, over distinct flagged lines, of the largest rule-attributed dollars for that line (pro-rata for unit-limit hits), not the full paid amount of the line. This avoids overstating the unit-limit rule.
6. **Login is CSRF-exempt** so a fresh browser can sign in; there is no login rate limit yet (demo-grade).
7. **Not built in M1 (by instruction):** brief generation (template or Claude), chat, voice, graph, prediction, peer/temporal detectors, precedent co-sign, exception proposal/simulate/approve/re-run, `/api/jobs`, engine HTTP link, gateway serving of the SPA for deep links. `GET /api/health` reports `engine: NOT_CONFIGURED`.
8. **Fixture data:** the paired-code and unit-limit tables used by the mini-generator are fixtures (`source_file = "FIXTURE (not CMS data)"`), not NCCI/MUE.

### Brief milestone notes
- The brief schema is `contracts/schemas/brief_output.schema.json`; validation lives in the gateway (BriefValidator, networknt json-schema-validator 3.x on Jackson 3). The engine only keeps the pack compatible (`engine/tests/test_brief_contract.py`).py).
- Added: sentence group case_context (seventh official element); validation.badge, rejectedAttempts (rule IDs and fields only); GET returns 204 when the stored brief was built from an older pack.
- Roles: POST needs INVESTIGATOR or SUPERVISOR; everyone signed in can GET.
