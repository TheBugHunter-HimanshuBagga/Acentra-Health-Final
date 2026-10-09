# ClaimShield Nexus: Demo Guide

A beginner-friendly, step-by-step guide to running and presenting the project. Every command, path, endpoint and number here was taken from the repository or from a run of it. Where a number comes from one particular run, it says so. All data is **synthetic**.

---

## 0. The one-minute explanation

> Insurers get thousands of unexplained fraud alerts. ClaimShield Nexus combines weak signals (rules, peer comparison, a provider's own history, ownership and referral networks), seals the evidence for each case, ranks the few cases worth a person's time, and explains them. An AI writes the explanations, but every sentence is checked against the evidence and a human makes every decision.

Three ideas to repeat during the demo:

1. **Risk is not confidence.** Risk = how much attention a case deserves. Confidence = how sure we are, from the evidence.
2. **The AI never decides.** It can only phrase checked evidence; if the check fails you see a labelled fallback.
3. **People decide, two people for big actions, and everything is in a tamper-evident audit log.**

---

## 1. Prerequisites

| Need | Version used | Needed for |
|---|---|---|
| Docker Desktop | any recent | Easiest run (Option A) |
| Node.js | 22+ (tested on 24) | Dev mode (Option B), e2e tests |
| Python | 3.12 | Dev mode engine |
| Java (JDK) | 25 | Dev mode gateway |
| Maven | 3.9 | Dev mode gateway |
| A browser | Chrome or Edge | Demo |

You do **not** need any API key to run the demo: with defaults the app runs in `LLM_MODE=template` (deterministic explanations, clearly labelled "Deterministic fallback").

---

## 2. Environment variables (`.env` in the project root; never committed)

Copy `.env.example` to `.env`. `npm run setup` does this for you.

| Variable | Default | Meaning |
|---|---|---|
| `LLM_MODE` | `template` | `template` = no AI calls; `live` = call Gemini/Claude |
| `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` (up to `_6` in the config) | empty | Gemini keys, rotated by the key pool. Gateway only; never sent to the browser |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Model for the pool |
| `GEMINI_RPM`, `GEMINI_TPM` | `12`, `200000` in `.env.example` (config default `0` = model-family default) | Per-key safety limits |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_BRIEF`, `ANTHROPIC_MODEL_FAST` | empty / `claude-sonnet-5-5` / `claude-haiku-5-5` | Optional Claude for briefs; Gemini is tried first, Claude second |
| `SARVAM_API_KEY`, `VOICE_ENABLED` | empty / `false` | Voice and translation (10 Indian languages) |
| `DEMO_MODE` | `true` | Shows the role switcher in the top bar. Must be `false` outside demos |
| `ENGINE_URL`, `ENGINE_TOKEN` | `http://127.0.0.1:8000`, `dev-engine-token` | Gateway to engine link (loopback) |
| `APP_DB_PATH` | `data/app.db` | The shared SQLite file |

Never paste real keys into chat or commit them; if a key was ever shared, rotate it.

---

## 3. Database setup (what happens automatically)

You do not create tables by hand.

- **Gateway** applies `contracts/sql/wf_schema.sql` to SQLite on every start (`CREATE TABLE IF NOT EXISTS`): 20 `wf_*` tables. It also seeds the four demo users and one approved exception (EXC-0001) when empty.
- **Engine** (`python -m claimshield.pipeline`, wrapped by `npm run pipeline`) generates the synthetic claims into `data/claims.duckdb`, the answer key into `data/gt.duckdb`, runs detection and publishes `serving_*` tables into `data/app.db`.
- **Docker**: the engine's entrypoint runs the pipeline on first start into a shared volume.

Check a database yourself (read-only):

```bash
# SQLite tables
python -c "import sqlite3;c=sqlite3.connect('data/app.db');print([r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")])"
```

---

## 4. Start the project

### Option A: Docker (recommended for a demo)

```bash
cd <project folder>
docker compose up --build
```

Open **http://localhost:8080**. The first start takes a few minutes (it builds images and generates the data). Stop with `docker compose stop`; remove everything including data with `docker compose down -v`.

### Option B: development mode

```bash
cd <project folder>
npm run setup      # once: Python venv + packages, web packages, Java build, creates .env
npm run pipeline   # once: generate synthetic data and publish data/app.db
npm run dev        # web :5173, gateway :8080, engine :8000
```

Open **http://localhost:5173**. Do not run Option A and B together: both use port 8080.

### Turning the AI on (optional)

Put your keys in `.env`, set `LLM_MODE=live`, restart (`docker compose up -d --build gateway`, or restart `npm run dev`). Check usage as the governance user at `GET /api/ai/usage`.

---

## 5. Sign in and roles

Passwords for the demo users are in `gateway/src/main/resources/demo-users.csv` (demo only). The page `/home` is a public landing page; `/login` is the sign-in page. Anonymous visitors to `/` are sent to `/home`.

| User | Role | Can do |
|---|---|---|
| `investigator` | INVESTIGATOR | Review cases, propose actions, close cases, ask copilot/chat, give feedback, request a specialist |
| `supervisor` | SUPERVISOR | Everything an investigator can, plus approve high-impact actions, co-sign precedents, join specialist chats, approve knowledge |
| `governance` | GOVERNANCE | Simulate/submit/approve/retire exceptions, approve knowledge, see AI usage, join specialist chats |
| `auditor` | AUDITOR | Read-only: audit trail, transcripts; cannot generate AI output or write |

With `DEMO_MODE=true` the top bar has an "act as role" selector, so one browser can show every approval. For the **two-person chat** use two browser windows (one normal, one private/incognito) with different users.

On first sign-in each user sees a language screen (11 languages). Pick one or "Skip for now".

---

## 6. Tour of every major feature

| Screen (menu) | What to look at | How it works inside |
|---|---|---|
| **Dashboard** | Pipeline strip (claims, signals, corroboration, evidence, SIU case, human decision, Second Brain), KPIs, funnel, exposure by scheme, confidence distribution, evidence-strength chart, trends and networks, institutional knowledge, "How we know it works" | `GET /api/dashboard`, `/funnel`, `/eval`; built by the engine from the run |
| **SIU queue** | Ranked cases with tier, risk, confidence, evidence, impact, exposure, hours; filters, saved views (browser only), capacity (hours) and horizon (30/60/90) | `GET /api/queue`; utility = risk x exposure x impact etc. against investigator hours |
| **Case workspace** | Left rail (dollars, ranking factors), Risk/Evidence/Confidence triad, "Why this case?" with the 7-step reasoning chain, AI reasoning, Copilot, Challenge, impact with "Why do we believe this?", evidence explorer, claim lines, timeline, 30/60/90 outlook, similar past cases, decision panel, history | Pack from `GET /api/cases/{id}/evidence`; decision via `POST /api/cases/{id}/review` |
| **Investigate** (investigation canvas) | Relationship graph, search, filters, Claims layer, inspector, copilot, **Simulate investigation** playback, minimap | `GET /graph`, `/claims`, `/evidence`, `/timeline`; layout and playback computed in the browser from those records |
| **The Lab** | Detector recall/precision against synthetic ground truth, decoys, ring recovery, outlook model vs baselines | `GET /api/eval` |
| **Precedents** | Closed-case precedents; supervisors co-sign | `POST /api/precedents/{id}/cosign` |
| **Rules and exceptions** | Draft exception, simulate on real data, lint, approve (governance), re-run | `/api/exceptions/*`, `/api/runs/rerun` |
| **Audit** | Hash-chained events, filters, **Verify chain** | `GET /api/audit`, `/audit/verify` |
| **Library** | Policies, rules, glossary, help | `GET /api/knowledge/*` |
| **Messages** (all roles except auditor) | Direct conversations with one colleague, attach a case to any message; supervisors/governance also have an *Assistant requests* tab for people the chatbot could not help | `/api/dm/*`, `/api/people`; `/api/agent/queue`, `/api/handoff/*` |
| **Bell (top bar)** | Notifications for requests, joins, messages | `GET /api/notifications` (polled every 4 s) |
| **Assistant (round button, bottom right)** | Questions answered from validated facts, voice if enabled, "Connect me to a human specialist" | `POST /api/chat` |
| **Ctrl+K** | Jump to a page or case | local, uses the queue |

---

## 7. End-to-end demo scenarios

Numbers below were seen in the verified Docker run (RUN-002, seeded); your values should be the same because the data is generated from a fixed seed, but check before quoting.

### Scenario 1: From alerts to a decision (about 4 minutes), as `investigator` then `supervisor`

1. Sign in as `investigator`. **Dashboard**: the strip shows 347 alerts becoming 341 after approved exceptions, 18 evidence packs and 18 cases.
2. **SIU queue**: top row **CASE-0014**, HIGH. Click it.
3. **Case workspace**: exposure **$15,456.00** (**$4,857.60 exact** + **$10,598.40 estimated**, shown separately, never added silently). Risk **0.94**, evidence strength **0.77**, confidence **HIGH**.
4. Scroll to **Why this case?** and open the reasoning chain (RETRIEVE, INTERPRET, APPLY RULES, PROPOSE, SCORE, CITE, HUMAN REVIEW). Evidence E1: lines dated after a recorded date of death (hard fact); E2: members who see no other provider (peer signal).
5. **Decision**: choose **Accept** (default action REQUEST_RECORDS needs no approval). Expected: status moves to ACTION_APPROVED.
6. To show approval, pick a HIGH case and choose **Modify** to `PREPAY_REVIEW_FLAG` or `REFER_EXTERNAL`: expected status **ACTION_PROPOSED**, "Waiting for a supervisor to approve."
7. Switch role to `supervisor` (top bar) or sign in as supervisor, approve the action, then execute it, then close the case with a rationale. Expected: **CLOSED**, a precedent created.
8. **Audit** (as supervisor): click **Verify chain**. Expected: "Chain verified: N events intact."

### Scenario 2: The investigation canvas (about 3 minutes)

1. Menu **Investigate**. The network flies in: the primary provider P-0044 in the centre, an owner group, and members.
2. Type `P-0044` in search, press Enter: the camera centres on it, the inspector opens.
3. Read the **Copilot reading** card: it states the risk, confidence and strongest signals from the evidence pack, with citations (E1, E2). Suggestions change with the selection.
4. Open the **Copilot** tab and ask `Show me the suspicious claims`. Expected: the Claims layer turns on, claim tiles appear, unrelated entities dim, and the answer states how many claims and members, for example "I found 40 claims ... contributing to the risk signal" (it shows the highest-paid claims and says so).
5. Click a link (edge): the link becomes the focus; the inspector shows source, target, type, frequency, basis ("derived from records").
6. Press **Simulate investigation**. Watch signals travel along links, claims light up, the step card update, the risk meter climb to **0.94**, and the final step **SIU review recommended** with "A person makes the final decision". Use the speed buttons (0.5x to 4x), step, scrub, click timeline markers.
7. While paused, ask `Why did the risk increase?`. Expected: an answer from the step currently on screen (the risk before and after, and the evidence).
8. Ask something outside the records: `What is the capital of France?`. Expected: "The evidence pack for this case does not contain that, so I will not guess..."

### Scenario 3a: Direct message with a case attached (about 2 minutes), two windows

1. Window A: sign in as `governance`, open **Messages**, click **New conversation**, choose *Ivy Investigator*, pick a case under *About a case*, write your input, **Send**.
2. Window B: sign in as `investigator`. The bell shows an unread notification (it stays inside the screen on any window size). Click it: the conversation opens with the attached case card (links to the case workspace and the investigation canvas). Reply; window A sees it within a few seconds.

### Scenario 3: Assistant asks for a specialist (about 3 minutes), two windows

1. Window A: sign in as `investigator`. Open the assistant, type `I want to talk to a human specialist`, click **Connect me to a human specialist**. Expected: "Waiting for a human specialist".
2. Window B (private window): sign in as `supervisor`. Expected: the bell shows **1 unread**, and a toast says you have an unread notification. Open the bell, click "... needs a specialist".
3. On **Messages**, tab **Assistant requests** (it opens from the notification), click **Join the conversation**, type a reply and send.
4. Window A: the chat shows "Connected to ..." and the reply; the bell shows a notification too. Reply; window B sees it.
5. Notifications are stored: a specialist who signs in *after* the request still sees it.

### Scenario 4: Governed learning (about 3 minutes)

1. Close a case as UNFOUNDED with a legitimate reason code (investigator/supervisor).
2. As `supervisor`: **Precedents**, co-sign the new precedent (a different person than the closer).
3. As the proposer: draft an exception from it (**Rules and exceptions**), run **Simulate**, read the lint verdict (PASS, WARN or BLOCK; BLOCK cannot be approved), **Submit**.
4. As `governance` (a third person): **Approve**. The engine re-runs; the funnel diff names the changed cases. Recorded-fact rules (such as billing after death) can never be excepted.
5. A browser end-to-end test (`npm run e2e:brain`) automates exactly this path.

### Scenario 5: Honest uncertainty

Open a LOW or Monitor item (Monitor list on the queue). Expected: "Insufficient evidence - human review required.", the missing evidence listed, and no recommendation beyond MONITOR.

---

## 8. API examples (curl)

The session uses a cookie and a CSRF header. Replace `<password>` with the password from `demo-users.csv`.

```bash
BASE=http://localhost:8080
JAR=/tmp/cs.jar

# 1) get a CSRF cookie, then sign in
curl -s -c $JAR $BASE/api/auth/me > /dev/null
curl -s -b $JAR -c $JAR -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"investigator","password":"<password>"}'
# -> {"id":"U-investigator","username":"investigator","role":"INVESTIGATOR",...}

XSRF=$(grep XSRF-TOKEN $JAR | awk '{print $7}')

# 2) read the ranked queue
curl -s -b $JAR "$BASE/api/queue?horizon=90&capacityHours=1000"

# 3) one case and its sealed evidence pack
curl -s -b $JAR $BASE/api/cases/CASE-0014
curl -s -b $JAR $BASE/api/cases/CASE-0014/evidence

# 4) ask the copilot (needs the CSRF header because it is a POST)
curl -s -b $JAR -X POST $BASE/api/cases/CASE-0014/copilot \
  -H 'Content-Type: application/json' -H "X-XSRF-TOKEN: $XSRF" \
  -d '{"question":"How confident are we, and why?"}'
# -> {"badge":"TEMPLATE_FALLBACK" (or "VALIDATED" when live),"content":{"answerable":true,"sections":{"answer":[...]}}}

# 5) notifications
curl -s -b $JAR $BASE/api/notifications
curl -s -b $JAR -X POST $BASE/api/notifications/read -H 'Content-Type: application/json' \
  -H "X-XSRF-TOKEN: $XSRF" -d '{"all":true}'
```

Expected errors: no session gives `401 AUTH_REQUIRED`; missing CSRF header on a POST gives `403 CSRF_INVALID`; an auditor asking the copilot gives `403 FORBIDDEN_ROLE`; an empty question gives `422 VALIDATION_FAILED`; more than 12 copilot questions in a minute gives `429 RATE_LIMITED`; an unknown path gives `404 NOT_FOUND`.

---

## 9. Edge cases and what the app does

| Situation | Behaviour |
|---|---|
| AI keys missing or `LLM_MODE=template` | Deterministic text from the evidence pack, badge "Deterministic fallback"; nothing breaks |
| AI returns an invented number or a forbidden word | Validator rejects, one retry with the valid placeholder list, then the fallback (reason shown) |
| All Gemini keys rate-limited | Pool rotates, waits up to 6 s, then the fallback |
| Wrong password 8 times for one user in a minute | `429`, wait a minute; other users unaffected |
| Same review submitted twice with the same `Idempotency-Key` | Not duplicated; reuse for another case gives `409` |
| Approving your own action, or an action not awaiting approval | Refused (`403` / `409`) |
| Closing an already closed case | `409` |
| Handoff message containing an email, phone or SSN pattern | `422`, "please do not share personal identifiers" |
| Reading another person's handoff | `404` (existence not revealed) |
| Engine down | Stored results still shown; re-runs and simulations paused with a banner |
| Chat closed with the X | Page stays intact (a past crash was fixed; there is also an error boundary) |
| Many members around a provider (more than 18) | Members start collapsed on the canvas; double-click a provider to expand |

---

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Port 8080 or 5173 already in use | Stop the other run (`docker compose stop`, or Ctrl+C the dev run). Docker and dev mode both use 8080 |
| Login says username or password incorrect in Docker though the CSV password is right | The Docker volume was seeded with different users earlier. `docker compose down -v` then `docker compose up --build` |
| Page shows the AI panels as "Deterministic fallback" | `LLM_MODE` is `template` (the default). Set `live` and add keys, then restart the gateway |
| Dashboard empty or "queue not available" | The pipeline has not run. Dev mode: `npm run pipeline`. Docker: wait for the engine healthcheck (first start can take minutes) |
| `npm run reset-demo` says no snapshot | `data/demo/` is empty in this checkout; the snapshot file `data/demo/app.db.snapshot` has not been created. Use `docker compose down -v` to reset instead |
| Browser pane or screenshot tools time out | The preview window is hidden; bring it to the front |
| Tests: gateway port tests skipped | 5 Gemini loopback tests need a real port; run them in a normal terminal (`mvn -q -o test "-Dtest=GeminiTest"`) |
| e2e fails on a busy machine | Close other servers on 8080/5173/8000 and rerun `npm run e2e:ui` |
| Curl POST returns 403 CSRF_INVALID | Add `-H "X-XSRF-TOKEN: <value of the XSRF-TOKEN cookie>"` |

Run the test suites:

```bash
npm run test:engine      # pytest (232 passed in the last run)
npm run test:gateway     # JUnit (199 run, 0 failures, 5 skipped)
npm run test:web         # Vitest (76 passed)
npm run lint
npm run build
npm run e2e:ui           # real browser, starts its own servers on 8080/5173; stop Docker first
npm run e2e:brain        # Second Brain flow, starts the engine too
```

---

## 11. Presentation script (about 8 minutes)

**Opening (30 s).** *Show `/home`.* "Insurers drown in alerts. We turn them into a few ranked, evidence-backed cases. Everything here is synthetic; the system gives indicators, not findings." Point at the logo on the globe (cursor reacts) and the line "Every alert. The right case."

**1. Dashboard (45 s).** *Sign in as investigator.* "The strip is our pipeline: claims, signals, corroboration, evidence, cases, human decision, learning. Under the hood 20 detectors across four independent channels (claim lines, peers, a provider's own history, networks) raise alerts; alerts are consolidated into cases." *(Internally: `detect/*`, `cases/*`.)*

**2. Queue (45 s).** "Ranked by risk, dollars, member impact, severity and evidence, against how many investigator hours we have. Change the capacity and the ranking cut-off moves." *(Internally: `QueueService`.)*

**3. Case workspace (2 min).** Open CASE-0014. "Three numbers kept apart: risk 0.94 says it deserves attention; evidence 0.77 says how much proof; confidence HIGH says how sure we are, derived from evidence only. Exposure is $4,857.60 exact plus $10,598.40 estimated, never merged." Open the reasoning chain: "Retrieve, interpret, apply rules, propose, score, cite, human review: the path from data to a recommendation." Click "Why do we believe this?" on an impact number: "Every number lists its source fields and evidence ids." Show the AI panel and say: "This text was checked: every sentence cites an evidence id and every number is a placeholder resolved by the backend. If the check fails we show a labelled fallback." *(Internally: evidence pack, `ChatValidator`.)* Record a decision; show the approval requirement for a high-impact action.

**4. Investigation canvas (2 min).** "This is the relationship view." Search P-0044, select it, read the copilot reading. Ask "Show me the suspicious claims" and "Trace the path from P-0044 to M-..." (use ids visible on screen). Press Simulate: "The playback is built from this case's own records: ownership, claims, members, each evidence item, then the risk building up to exactly the engine's score, ending with a human review recommendation." *(Internally: `features/investigate/simulation.ts`.)* Say the limits aloud: "Links are derived from records, not confirmed relationships."

**5. Two-person chat (1 min).** Show window A requesting a specialist and window B's bell and reply. "Notifications are stored per person; message text is never in them; messages are audited by hash."

**6. Governance and audit (45 s).** "A closed case becomes a precedent, a second person co-signs it, an exception can be drafted, simulated on real data, and approved by a third role. Recorded-fact rules can never be excepted. The audit log is hash-chained and append-only: verify it live."

**7. Lab and honesty (30 s).** Open The Lab: "Recall is exact and precision is a lower bound, measured against synthetic ground truth the detectors never see. We make no real-world accuracy claim."

**Closing (15 s).** "The AI explains, people decide, and we say so when we are not sure."

---

## 12. Demo risks and how to handle them

1. **AI shows "Deterministic fallback"** (template mode or a failed validation). Say it is the safe path by design; if you want live AI, switch to `live`, open your key cases once beforehand (outputs are cached per evidence pack) and keep to about 10 explanations a minute.
2. **Free-tier daily Gemini limits are unknown** and not tracked by the app (only per-minute windows).
3. **Slow live answers** (2 to 26 s seen); the UI shows a loading state.
4. **First Docker start is slow** while data is generated.
5. **Stale Docker volume** with old users breaks sign-in; use `docker compose down -v`.
6. **Question about "13 detectors" on the landing page**: the code registers 20; the landing figure is wrong (see Documentation, section 12).
7. **Likely follow-ups you cannot fully answer**: real-world accuracy (unknown), production scalability (SQLite prototype), the CMS dataset (built but not the default; two overlay patterns have very low recall).
8. **Browser-only saved views** and a list (not graph) for institutional memory: mention proactively if asked.

---

## 13. Likely evaluator / interviewer questions

**Q: How is this different from a normal alert dashboard?**
It combines four independent evidence channels, seals each case into a hashed evidence pack, separates risk from evidence and confidence, ranks against investigator capacity, and every explanation is validated against the pack.

**Q: Does the AI detect fraud?**
No. Detection is deterministic code (rules, statistics, graph, time series). The AI only phrases evidence that is already in the pack, and its output is validated. It cannot change a tier, a score, a dollar figure or a recommendation.

**Q: What stops the AI from inventing facts?**
Structured output with evidence ids and number placeholders; a validator checks ids exist, placeholders are known and owned by a cited id, no forbidden words, the stated tier equals the computed tier; one retry; then a labelled deterministic fallback. Unvalidated text is never shown.

**Q: What do "risk", "evidence" and "confidence" mean?**
Risk: how much attention (severity, exposure, impact). Evidence: strength and number of independent channels agreeing. Confidence: HIGH/MEDIUM/LOW derived from evidence and contradictions, not from risk. LOW says "Insufficient evidence - human review required."

**Q: How do you know it works?**
On synthetic data with injected schemes and decoys we measure recall (exact) and precision (a lower bound) per detector, decoys falsely flagged, ring recovery, and the outlook model against persistence baselines on held-out providers and later months. This is not real-world accuracy and we say so.

**Q: How does the 30/60/90-day prediction work?**
Gradient boosting versus logistic regression chosen on validation, provider- and time-based splits, bootstrap intervals, compared with simple baselines. The target is a documented synthetic future-risk label, so it is a ranking score, not a probability of fraud.

**Q: How do you prevent leakage?**
Ground truth lives in a separate DuckDB file that only the generator, evaluation and orchestrators may open (a test enforces this); the outlook model uses a purge gap between train and test periods and provider-disjoint splits.

**Q: Why two languages (Java and Python)?**
Python for data science (pandas, scikit-learn, DuckDB); Java/Spring for security, transactions and the audit chain. They communicate over an internal, token-protected HTTP link and share one SQLite file with a single writer per table family.

**Q: Why SQLite?**
Simplicity for a prototype: one file, ACID, WAL. It would be replaced by Postgres for concurrent production use.

**Q: How is security handled?**
Session cookie (HttpOnly, SameSite=Lax), CSRF token, BCrypt, role checks in services, login throttling, API keys only on the server, engine behind a token, hash-chained append-only audit log, PII refusal in chat. Weaknesses: committed demo passwords, in-memory rate limits, no CSP.

**Q: What are the roles and the approval rules?**
Investigator, supervisor, governance, auditor. High-impact actions (prepay review flag, external referral) on HIGH cases need a supervisor; precedent co-sign and exception approval need a different person; auditors are read-only.

**Q: What does the Gemini key pool do?**
Rotates up to several keys, tracks per-key requests and tokens per minute with headroom, parks a key on HTTP 429 or after repeated failures, caches identical requests, and falls back to the deterministic text if no key is available within 6 seconds. Usage (never keys) is at `/api/ai/usage`.

**Q: What does the second dataset (CMS) add?**
It shows the pipeline running on the official CMS DE-SynPUF synthetic Medicare claims (about 488,000 claims in our subset) with every field labelled source, derived, transformed or unavailable. It is not the default dataset, derived relationships are not confirmed, and recall on two injected patterns was low.

**Q: What would you build next?**
Postgres with row-level security, WebSocket handoff, a memory-graph view, server-side saved views, a real dataset-understanding step, real-label evaluation with expert review, and a closer look at the low-recall CMS patterns.

**Q: What are the known limitations?**
All metrics are synthetic; handoff uses Server-Sent Events and polling; saved views live in the browser; AI output sometimes falls back; the CMS dataset is not wired as the default; light mode and mobile were not fully reviewed for the newest screens.
