# ClaimShield Nexus: Intelligence Engine

*Detection, consolidation, scoring and prediction. Uses the table and column names from `ClaimShield_Nexus_Data_Architecture.md` and the process split from `ClaimShield_Nexus_Final_Architecture.md` (Python computes; Java validates and governs).*

**Language rule (applies to every output string):** the engine produces **indicators that require human investigation**. It never outputs "fraud", "fraudulent" or a probability of guilt. Scores are *prioritisation scores*. Hypothesis labels come from the fixed vocabulary in §11.

**What I did and did not verify.** Every library named here (pandas, DuckDB, NumPy, SciPy, scikit-learn, NetworkX) is long-standing and the functions used are standard (`IsolationForest`, `HistGradientBoostingClassifier`, `LogisticRegression`, `CalibratedClassifierCV`, `scipy.stats.theilslopes`, `networkx.connected_components`/`simple_cycles`/`shortest_path_length`). I did **not** verify specific current versions or any newer parameter in this session. Day-1 task: `pip install` the lot into one locked environment and run an import-and-fit smoke test. Two items are marked **[verify]** because I am relying on memory of CMS policy, not a source I fetched.

---

## 1. Pipeline overview

```
claims ──► SIGNALS ──► ALERTS ──► (exceptions) ──► ENTITY CONSOLIDATION ──► CASES ──► SCORES ──► CONFIDENCE TIER ──► QUEUE
 (core)    (detectors)  (dedup)     (Stage B)          (graph components)               (formulas)   (rules)          (capacity)
 └─────────────── Stage A: heavy, run once offline ───────────────┘ └──────────── Stage B: fast, re-runnable in seconds ────────────┘
```

| Stage | Input | Output table | Cost |
|---|---|---|---|
| **A1 Features** | `claim`, `claim_line`, refs | `feat_provider_month`, `feat_provider_day`, `feat_graph_edge` | DuckDB SQL; O(lines) |
| **A2 Detectors** | features + lines | `out.signal`, `out.signal_line` | seconds each on a few hundred thousand lines (expected; measure on first run) |
| **A3 Alerting (dedup)** | signals | `out.alert`, `out.alert_line` | trivial |
| **A4 Prediction** | features, alerts, investigations | `out.prediction` (30/60/90) | seconds |
| **B1 Exceptions** | alerts + approved `exception_rule`s | `alert.suppressed_by_exception_id` | trivial |
| **B2 Consolidation** | active alerts + relationship graph | `out.case`, `case_subject`, `case_alert` | NetworkX on a few hundred nodes |
| **B3 Scoring and tier** | cases | scores, `confidence_tier`, `tier_reasons` | NumPy |
| **B4 Queue** | scored cases + capacity | `rank`, `in_capacity` | O(n log n) |
| **B5 Evidence packs** | everything above | `evidence_pack` | per case |

**Why two stages:** detection is deterministic given the data, so only exceptions, merging, scoring and the queue change when a human approves a rule. Re-running Stage B alone keeps the "approve an exception → watch the funnel change" demo to seconds.

**New tables this engine adds to the data architecture**
| Table | Key | Columns |
|---|---|---|
| `out.signal` | `signal_id` | `detector_id`, `detector_version`, `channel`, `scheme_type`, `provider_id`, `member_id` null, `window_start`, `window_end`, `strength` (0–1), `dollars`, `dollars_basis` (`EXACT`\|`ESTIMATED`), `metrics_json` (observed, peer median, z, n, …) |
| `out.signal_line` | (`signal_id`, `claim_id`, `line_no`) | links a signal to implicated lines |
| `out.case_channel` | (`case_id`, `channel`) | `strength`, `n_alerts` |
| `out.case_hypothesis` | (`case_id`, `scheme_type`) | `dollars`, `share` |
| `out.monitor_item` | `monitor_id` | `provider_id`, `reasons_json`, `what_would_raise_confidence_json`, `run_id` |
| `out.case_precedent` | (`case_id`, `precedent_id`) | `similarity`, `disposition` |

---

## 2. Evidence channels (the unit of "independent")

Corroboration counts **channels**, which are defined by *what data the method looks at*, not by which library ran it:

| Channel | Looks at | Detectors |
|---|---|---|
| **LINE** | facts about individual claim lines versus a published rule or a recorded fact | all `R-*` rules |
| **PEER** | a provider metric compared with the provider's peer group | `S-UPC`, `S-UTL`, `S-GHOST`, `S-DIST`, `S-IF` |
| **SELF** | a provider metric compared with its own history | `T-CUSUM`, `T-GROWTH`, `T-RAMP` |
| **NETWORK** | relationships among providers, owners, addresses, facilities, referrals | `G-OWNREF`, `G-REFCONC`, `G-INFRA`, `G-LOOP` |
| *(context, not a channel)* | | `G-PROX` (nearness to confirmed precedents), the 30/60/90 prediction, precedent similarity |

The prediction is **never evidence**. It orders the queue and informs the UI, but it cannot raise `evidence_strength` or the tier, because it is itself computed from the alerts.

---

## 3. Shared statistical building blocks

**Peer group:** `ref_specialty.peer_group`. Baseline for month *t* uses all peer provider-months in the trailing 12 months. If `peer_n < 15` the peer comparison still runs but sets `low_peer_flag = true`.

**Robust z (resistant to the injected providers contaminating the baseline):**
```python
def robust_z(x, peer_values, mad_floor):
    med = np.median(peer_values)
    mad = np.median(np.abs(peer_values - med))
    return (x - med) / (1.4826 * max(mad, mad_floor))   # mad_floor = 0.05*|med| + 1e-6, so a flat peer group cannot explode z
```

**Small-sample shrinkage for proportions** (so a provider with 6 visits cannot look extreme):
```python
def shrunk_share(k, n, peer_share, a=20):                # a = prior strength (pseudo-visits)
    return (k + a * peer_share) / (n + a)
```
Detectors that use a share require a minimum count `n ≥ n_min` (default 30) after rolling over the last 3 months.

**Strength mapping** (every detector reports a 0–1 strength):
```python
def strength_from_z(z, z0=2.5, z1=7.0):  return float(np.clip((z - z0) / (z1 - z0), 0, 1))
```
Deterministic rules use a fixed `base_strength` from `rule_registry.params_json` (exact-fact rules 1.0, judgement rules 0.7–0.9).

**Alert thresholds are deliberately permissive** (`z0 = 2.5`) so the funnel starts in the thousands. Case-level selectivity comes later from channels, tiers and capacity.

---

## 4. Signal families

Each table below covers: algorithm and library · inputs → features · output · explanation shown · evaluation metric · computational cost.

### 4.1 Deterministic rules (channel LINE) — DuckDB SQL

**Why appropriate:** the official behaviours include facts a rule can state exactly (a duplicate, a published code-pair edit, a service after death). Rules are auditable, versioned, and cite policy sections. They are also the only family whose output a payer can act on without statistical argument.

| ID | Algorithm | Inputs → features | Output (signal) | Explanation shown | Metric | Cost |
|---|---|---|---|---|---|---|
| **R-DUP-01** exact duplicate | `GROUP BY member, rendering_provider, service_dt, hcpcs, modifier1, modifier2, units` with `COUNT(*) > 1`; keep the earliest line as context, flag the rest | `claim_line`, `claim` | per provider-month: copies' lines, dollars = Σ `paid_amt` of copies (**EXACT**), strength 1.0 | "N lines duplicate an earlier line (same member, date, code, modifiers, units)"; claim IDs; policy `POL-BILL-1.1` | line recall, precision (lower bound) | hash aggregate, O(n) |
| **R-DUP-02** near duplicate | Same member/provider/code with `service_dt` within ±1 day, **or** same date with differing modifiers; same `allowed_amt`; **excluded** when either modifier is in `REPEAT_OR_DISTINCT_MODS` (e.g. 76, 77, 91, LT, RT, 59, XE, XP, XS, XU — configurable) or the code family is THERAPY / DIALYSIS / INFUSION; skips lines already flagged by R-DUP-01 | same | same, strength 0.8 | pair of lines side by side; which modifiers differ | recall/precision; **hard negative: D5 must not fire** | self-join keyed by member+provider+code; O(n) |
| **R-PTP-01** unbundling | Join line pairs (same member, rendering provider, `service_dt`) to `ref_ncci_ptp` (col1/col2 active on `service_dt`). Violation if `modifier_ind = 0`, or `modifier_ind = 1` and neither line carries a bypass modifier (`PTP_BYPASS_MODS`, configurable; initial list from CMS NCCI policy **[verify]**) | lines, `ref_ncci_ptp` | per provider-month; dollars = `paid_amt` of the Column 2 line (**EXACT**); strength 0.9 | the code pair, the edit indicator, the missing modifier; policy section | recall/precision; D5 hard negative (pair with valid modifier must not fire) | join on code pair; O(pairs) |
| **R-MUE-01** units over limit | `MAI = 1`: `units > mue_value` per line. `MAI 2/3` (as published; confirm semantics **[verify]**): Σ units per member/provider/code/day > `mue_value`. Dollars = `paid × (units − mue)/units` | lines, `ref_mue` | per provider-month; **EXACT** (pro-rata); strength 0.9 | observed units vs limit; MAI | recall/precision | O(n) |
| **R-DOD-01** service after death | `service_dt > member.death_dt` | lines, `member` | **EXACT**; strength 1.0 | date of service vs death date | recall (≈ exact by construction) | O(n) |
| **R-IP-01** service during inpatient stay elsewhere | Line with a non-facility place of service (office/home) and `admit_dt < service_dt < discharge_dt` for a stay of the same member | lines, `inpatient_stay`, `ref_place_of_service` | **EXACT**; strength 0.85 | stay dates and facility vs the line's place of service | recall/precision | interval join; O(n log n) |
| **R-TIME-01** daily-minute overload | Σ(`typical_minutes × units`) per provider per day from `feat_provider_day` > `cap_minutes` (default 720 = 12 h, tuned on val). Dollars = day paid × excess/total (**ESTIMATED**). Minutes come from our `ref_hcpcs.typical_minutes` assumption, **not CMS data** | `feat_provider_day` | strength = `clip((minutes − cap)/cap, 0, 1)` × 0.8 | the day, minutes, the code mix; **assumption stated in the card** | recall on TMA; no normal provider over cap (DQ gate) | O(provider-days) |
| **R-GEO-01** same member, distant places, same day | Same member and `service_dt`, two lines whose location (facility address, else provider practice address) differs by > `geo_km` (default 100, tuned); excludes telehealth place-of-service codes | lines, `address`, `facility`, `provider` | Haversine in SQL; dollars = the smaller line (**EXACT**); strength 0.8 | both locations with distance | recall on TMB | O(n) joins |
| **R-EXCL-01** excluded provider billing | Billing/rendering provider in `exclusion` and `service_dt ≥ excl_dt` and (`reinstate_dt` is null or `service_dt < reinstate_dt`) | lines, `exclusion` | **EXACT**; strength 1.0 | exclusion type/date, lines after it | recall | O(n) |
| **R-DME-01** DME order without a qualifying visit | DME claim whose ordering provider has **no CARRIER claim** for that member in `[order_dt − 60d, order_dt]` (60 tunable). If the ordering provider is missing, **no alert** and a limitation flag "ordering provider unavailable" | `claim`, `referral` | **EXACT** dollars; strength 0.8 | order date, ordering provider, last visit date (or "none") | recall on DME; limitation rate | indexed lookup |

Rules are written once as SQL files, registered in `rule_registry` with `rule_id@version`, `params_json`, `base_strength`, and linked to `policy_section`s through `rule_policy`.

**Dedup precedence:** R-DUP-01 → R-DUP-02; a line is credited to the highest-precedence rule in its family.

### 4.2 Statistical and anomaly detection (channel PEER) — pandas + SciPy + scikit-learn

**Why appropriate:** upcoding, over-utilisation, ghost-member patterns and unfamiliar behaviours are *distributional*; no rule can state them. Peer comparison is how payers actually screen them, and every number it produces is human-readable.

| ID | Algorithm | Inputs → features | Output | Explanation shown | Metric | Cost |
|---|---|---|---|---|---|---|
| **S-UPC** | Rolling 3-month **level 4–5 share of office E&M lines** per provider; shrunk toward the peer share; robust z against peers; requires `n_em ≥ 30` | `claim_line` joined to `ref_hcpcs.em_level`; `feat_provider_month.em_high_share` | strength from z; dollars (**ESTIMATED**) = `n_em × max(0, share − peer_median) × (avg_allowed_L45 − avg_allowed_L123)` | "level 4–5 share 0.62 vs peer median 0.18 (peer n=57, 99th pct)"; also shows `acuity_mean` as context; low-peer flag | provider-level PR-AUC on UPC; D4 false-positive rate | monthly aggregate |
| **S-UTL** | Lines per member per month vs peers; robust z; requires ≥ 20 members. Secondary: count of members above peer p99 visits | `feat_provider_month.lines_per_member` | dollars (**ESTIMATED**) = `max(0, lpm − peer_median) × n_members × avg_paid_per_line` | observed vs peer chart; top members by visit count | PR-AUC on UTL; D1 handling | aggregate |
| **S-GHOST** | **Exclusive-member share**: share of the provider's members with no claims from any other provider in the prior 12 months and a narrow code mix; robust z vs peers; requires ≥ 20 members | `claim` (member × provider pairs) | dollars (**ESTIMATED**, upper bound) = paid on those members' lines; strength from z | count and share of exclusive members, their code mix | recall on PHC | member-provider pivot |
| **S-DIST** | Mean member-to-provider distance (Haversine) vs peers; robust z | `member.address_id`, provider/facility address | strength from z; no dollars of its own | mean km vs peer median; map | recall on DME; D3 false-positive rate | O(claims) |
| **S-IF** | **IsolationForest** over the 10 peer-normalised z features (`z_em_high, z_lines_per_member, z_mean_member_km, z_paid, z_paid_per_member, z_share_new_members, z_exclusive_member_share, z_growth_90d, z_referral_top3_share, z_n_members`); fit on **train-split** provider-months; `n_estimators=200`, `max_samples=256`, fixed `random_state`; convert to a percentile against the fit distribution; **alert only if percentile ≥ 0.99 and at least one \|z\| ≥ 3** so every alert has a human-readable reason | `feat_provider_month` | strength = `(pct − 0.99)/0.01`; no dollars | top-3 \|z\| features with peer context. **No SHAP**, because deviation from peers is simpler and deterministic | PR-AUC of the score on all positive providers; **incremental recall** = positives missed by rules found by S-IF; alarm rate on normal providers | ~10⁴ rows × 10 features; seconds |

**Why IsolationForest and nothing heavier:** unsupervised, no labels needed for fitting, fast on ~10⁴ rows, deterministic with a fixed seed. Its role is to catch patterns we did not hand-code and to corroborate other channels. If the ablation shows it adds nothing over the other detectors, say so in the eval page rather than keep it for decoration.

### 4.3 Graph analytics (channel NETWORK) — NetworkX

**Why appropriate:** the problem statement names "coordinated networks" and "ownership indicators, referrals, locations". These are relational patterns that no claim-by-claim method sees. The graph is small (hundreds of providers), so NetworkX is enough.

**Graphs built**
- **A, infrastructure (undirected):** provider–owner (control only: `is_control`), provider–address, provider–phone, provider–facility.
- **B, referral (directed, weighted):** provider → provider, weight = referral count and dollars over the trailing 6 months, from `referral`.
- **C, co-patient (used only on demand):** provider–provider member-overlap, built only for pairs already linked in A or B.

| ID | Algorithm | Inputs → features | Output | Explanation shown | Metric | Cost |
|---|---|---|---|---|---|---|
| **G-OWNREF** | For each **control-owner group** *G* (size ≥ 2): `self_referral_share = Σ dollars(a→b, a,b ∈ G) / Σ dollars(a→x, a ∈ G)`; alert if share ≥ 0.5, ≥ 30 referrals, group size ≥ 2 | `ownership`, `referral` | strength = `clip((share − 0.5)/0.4, 0, 1)`; dollars (**ESTIMATED**, upper bound) = paid on the referral-linked claims within *G* | owner → entities, the within-group referral flows, share | ring recovery rate (all ring members in one case) | O(edges) |
| **G-REFCONC** | `referral_top3_share` = top-3 referrers' dollars / total referred-in dollars for a provider (6 months); alert if share ≥ 0.8 **and** robust z vs specialty peers ≥ 3 **and** ≥ 30 referrals | `referral` | strength from z | top referrers and shares | recall on DME | O(edges) |
| **G-LOOP** | Within each control-owner group and each same-address group (size ≤ 25; otherwise skip and flag), enumerate **directed cycles of length 2–4** via `simple_cycles` where each edge has ≥ 5 referrals | graph B subgraphs | strength = `min(1, 0.5 + 0.1 × n_cycles)` | the cycle paths | recall on RNG | small subgraphs only |
| **G-INFRA** | Connected components of graph A; shared link types score `owner 0.5, phone 0.3, address 0.2, facility 0.2` (sum, **capped at 0.4** because shared infrastructure alone is weak evidence) | graph A | group-level signal (primary subject = lowest provider ID, all members as subjects) | which links are shared | **D2 must not reach HIGH**; ring recall | linear |
| **G-PROX** *(context only)* | `min_hops_to_confirmed`: shortest path (≤ 2) in A ∪ B to a provider with a `CONFIRMED` investigation closed before the as-of date | graphs, `investigation` | attribute used in precedent fit and evidence; **not** a channel | the path | contribution to prediction | BFS |

**Graph features written for every provider** (used by prediction and by the exception DSL): `shared_infra_degree`, `building_unrelated_owner_count`, `self_referral_share`, `referral_top3_share`, `n_referrers`, `min_hops_to_confirmed`.

### 4.4 Temporal analytics (channel SELF) — NumPy + SciPy

**Why appropriate:** "escalating" is a time property. A provider's *change* against its own history is also immune to peer-group mismatch, which makes it a genuinely different view from PEER.

| ID | Algorithm | Inputs → features | Output | Explanation shown | Metric | Cost |
|---|---|---|---|---|---|---|
| **T-CUSUM** | One-sided **CUSUM** on monthly standardised metrics (`em_high_share` shrunk, `lines_per_member`, `paid_per_member`). Baseline μ₀, σ₀ from the provider's first 6 eligible months; `σ₀ = max(sd, 0.5 × peer monthly sd)`; `k = 0.5`, `h = 5` (tuned on val); alarm month and magnitude recorded | `feat_provider_month` | strength = `clip(S/(2h), 0, 1)`; dollars from the alarmed metric's estimate | "share rose from 0.17 to 0.52 starting month 18" with the CUSUM curve | **detection delay** (months from onset to alarm); false alarms per 1,000 normal provider-months | O(provider-months) |
| **T-GROWTH** | `g = log((paid_90d + ε)/(paid_prev90d + ε))`; robust z vs peers; requires `paid_prev90d ≥ min` | `feat_provider_month.growth_90d` | strength from z | 90-day vs prior-90-day dollars | same as above | trivial |
| **T-RAMP** | Provider tenure < 12 months **and** `paid_90d ≥` peer p75 of *mature* providers; strength grows with the ratio | `provider.enroll_dt`, features | strength = `clip(ratio/3, 0, 1)` × 0.8 | tenure and volume vs mature peers | recall on DME | trivial |
| **Escalation trend** *(label, not an alert)* | **Theil–Sen slope** (`scipy.stats.theilslopes`) on monthly alert dollars over 6 months; label `ESCALATING` if slope > 0 and last-3-month dollars ≥ 1.25× the prior 3 months; `DECLINING` if ≤ 0.8×; else `STABLE`; needs ≥ 2 months with alerts | `out.alert` history | trend label + slope on the case | small chart in the case header | agreement with the generator's profile (ESCALATING / BURST / CORRECTED) | trivial |

---

## 5. Alerting and de-duplication (signals → alerts)

**Alert grain:** one alert per **(detector, provider, calendar month)** for line-based detectors; one per **(detector, provider, window)** for window metrics; one per **component** for `G-INFRA` / `G-OWNREF`. This turns hundreds of thousands of lines into **thousands** of alerts without losing line-level traceability (`alert_line`).

```python
def to_alerts(signals):
    alerts = []
    for key, grp in groupby(signals, key=lambda s: (s.detector_id, s.provider_id, s.month)):
        lines   = union_of(s.lines for s in grp)                # a line counts once per detector
        alerts.append(Alert(
            detector=key[0], provider=key[1], window=span(grp),
            score=max(s.strength for s in grp),                 # max, never sum
            dollars=sum(paid[l] for l in lines) if lines else max(s.dollars for s in grp),
            basis='EXACT' if lines and all(s.basis=='EXACT' for s in grp) else 'ESTIMATED'))
    return alerts
```

**De-duplication rules**
1. Within a detector: lines are unioned, scores are maxed.
2. Within a scheme family: higher-precedence rule claims the line (R-DUP-01 before R-DUP-02).
3. Across detectors: **no summing of dollars.** Dollars are combined at the case level (§7.4) by line union.
4. Suppressed alerts (by an exception) are kept with `suppressed_by_exception_id` for audit and for the funnel diff; they are excluded from consolidation.

---

## 6. Entity consolidation (alerts → cases)

```python
# Providers with at least one active alert in the case window (default: last 6 months before as-of)
active = {a.provider for a in alerts if not a.suppressed and a.window_end >= asof - months(6)}

uf = UnionFind(active)
for p, q in pairs_with_links(active):                            # candidate pairs share some link
    strong = control_owner(p, q) or referral_coupled(p, q)       # coupled: >= 30 referrals AND >= 25% of either side's referral dollars
    weak_types = {t for t in (shared_phone(p, q), shared_address(p, q), shared_facility(p, q)) if t}
    if strong or (len(weak_types) >= 1 and hypotheses(p) & hypotheses(q)):   # weak links merge only when both carry the same scheme hypothesis
        uf.union(p, q)

cases = [Case(subjects=comp, primary=max(comp, key=alert_dollars)) for comp in uf.components()]
```

- A **shared building alone never merges providers**.
- A provider whose alerts span several scheme types gets **one case with several hypotheses** (`case_hypothesis`), not several cases.
- **Recurrence:** if the provider had a case closed within the last 90 days, the new case is linked as `RECURRENCE` (closed-case IDs are passed in by Java).
- **Stable case IDs across re-runs:** a new component inherits the ID of the previous case with the largest subject overlap if Jaccard ≥ 0.5, otherwise it gets a new ID. Java owns the ID map so reviewer state survives a re-run.
- `G-INFRA` groups are consolidated like any other: the D2 shared-building providers become one case that is expected to be Low/Medium and then downgraded by the pre-approved exception.

---

## 7. Case scoring

All components are in [0, 1]. Weights are **design judgements** the SIU can change, not statistics; they are tuned only lightly on validation (to keep decoys out of HIGH and hard positives in at least MEDIUM) and then frozen.

### 7.1 Channel strengths
```python
s_c = max(a.score for a in case_alerts if channel(a) == c)           # c in {LINE, PEER, SELF, NETWORK}
```

### 7.2 Risk (a prioritisation score, not a probability of wrongdoing)
```python
W = {'LINE': 0.85, 'PEER': 0.60, 'SELF': 0.50, 'NETWORK': 0.70}
risk_signal = 1 - prod(1 - W[c] * s_c for c in channels)             # noisy-OR: independent channels reinforce, one weak channel cannot saturate
risk_h = 1 - (1 - risk_signal) * (1 - 0.30 * p_h)                    # p_h = predicted repeat/escalation probability for the selected horizon h ∈ {30, 60, 90}
```
`risk_30`, `risk_60`, `risk_90` are all stored; the UI's horizon selector picks which one drives the queue.

### 7.3 Severity
```python
severity = max(ref_scheme_type.severity_weight[t] for t in hypotheses)
```
Initial triage weights (judgement): `EXC 1.0, PHA 0.95, PHC 0.90, RNG 0.90, DME 0.85, PHB 0.80, TMA 0.70, TMB 0.70, UPC 0.60, UNB 0.55, DUP 0.50, EXU 0.50, UTL 0.45`.

### 7.4 Dollar impact
```python
exact_union = sum(paid[l] for l in union(alert_lines of LINE-backed alerts))      # each line once, whichever rules flagged it
est_max     = max((a.dollars for a in case_alerts if a.basis == 'ESTIMATED'), default=0)
dollars     = max(exact_union, est_max)                                           # max, not sum: no double counting
basis       = 'EXACT' if exact_union >= est_max else 'ESTIMATED (peer-excess / upper bound)'
dollar_score = clip(log1p(dollars) / log1p(D_ref), 0, 1)                          # D_ref = 95th percentile of case dollars in this run
```
The UI always shows `exact_union` and `est_max` separately so nobody mistakes an estimate for a recoverable amount.

### 7.5 Member impact
```python
n_m          = len(distinct members on implicated lines) + len(members of exclusive/ghost sets)
impact_count = 1 - exp(-n_m / 25)
harm         = max(ref_scheme_type.harm_weight[t] for t in hypotheses)       # services billed but possibly not delivered, or equipment to distant members, weigh more than coding errors
member_impact = impact_count * (0.4 + 0.6 * harm)
```

### 7.6 Precedent fit
```python
# top-5 precedents with closed_dt <= asof, same scheme family or specialty, cosine similarity >= 0.6 on the fv_v1 vector (z-scored, clipped to ±5)
outcome = {'CONFIRMED': +1.0, 'EDUCATION': +0.5, 'INSUFFICIENT': -0.3, 'UNFOUNDED': -1.0}
precedent_fit = sum(sim_i * outcome[d_i]) / sum(sim_i)     if matches else 0.0     # flag no_precedent when empty
```

### 7.7 Evidence strength
```python
n_ch   = sum(1 for s in s_c.values() if s >= 0.3)
C      = {0: 0.0, 1: 0.25, 2: 0.60, 3: 0.85, 4: 1.0}[n_ch]                       # corroboration across independent channels
D      = 1.0 if any(hard_fact_rule_hit) else 0.0                                 # a deterministic exact-fact line rule fired
X      = min(1.0, months_with_alerts / 3)                                        # persistence
P      = (precedent_fit + 1) / 2 if matches else 0.5                             # neutral when no precedent
ES     = 0.45*C + 0.25*D + 0.20*X + 0.10*P
if low_peer_flag or small_volume_flag:  ES *= 0.70                               # data-adequacy penalty
```
`hard_fact_rule_hit` = any of `R-DUP-01, R-PTP-01, R-MUE-01, R-DOD-01, R-IP-01, R-GEO-01, R-EXCL-01` with `EXACT` dollars; the inference-heavy `R-TIME-01` and `R-DME-01` count as LINE channel but not as hard facts.

### 7.8 Confidence tier (deterministic, ordered rules; first match wins)

| Order | Condition | Tier |
|---|---|---|
| 1 | An approved exception matches the case | **LOW** (disposition `MONITOR`, reason cites the exception) |
| 2 | `R-EXCL-01` or `R-DOD-01` exact hit with dollars ≥ `d_min` | **HIGH** (direct recorded fact) |
| 3 | `precedent_fit ≤ -0.5` with ≥ 2 `UNFOUNDED` precedents at similarity ≥ 0.75 | **LOW** |
| 4 | `n_ch = 1` and that channel is `PEER` or `SELF`, or `ES < 0.35`, or `low_peer_flag` with `n_ch = 1` | **LOW** |
| 5 | (`n_ch ≥ 3`) or (`n_ch ≥ 2` and `D = 1`), and `ES ≥ 0.65`, and `precedent_fit > -0.25`, and not data-inadequate | **HIGH** |
| 6 | otherwise | **MEDIUM** |

- **HIGH** → proceeds into the SIU queue with the recommended action; workflow still requires human approval.
- **MEDIUM** → queue, labelled "expert review".
- **LOW** → **not a case.** Goes to `monitor_item` with `reasons` and `what_would_raise_confidence`, built from the missing channels (e.g. "no line-level rule hit", "peer group n = 9", "signal in 1 month only", "similar prior case closed unfounded").
- A network-only case (the shared-owner ring) normally lands at **MEDIUM**, because it has one channel and no hard fact. That is intended and shown honestly: *network evidence alone justifies expert review, not a stronger claim.*

### 7.9 Investigation capacity and the queue
```python
utility = (0.30*risk_h + 0.20*dollar_score + 0.15*member_impact + 0.15*severity + 0.20*ES) * {'HIGH': 1.0, 'MEDIUM': 0.75}[tier]

est_hours = clip(4 + 1.5*n_subjects + 0.5*ceil(n_flagged_lines/50) + 3*(n_hypotheses-1), 4, 40)   # synthetic effort model; labelled as an assumption

remaining = capacity_hours          # e.g. investigators * hours_per_week * weeks; UI parameter
for c in sorted(cases, key=lambda c: -c.utility):                        # transparent, explainable ordering
    c.rank = next_rank()
    if c.est_hours <= remaining: c.in_capacity = True; remaining -= c.est_hours
    else:                        c.in_capacity = False; c.defer_reason = 'exceeds remaining capacity'   # first-fit: a smaller later case can still fit
```
Every factor appears as its own column plus a "why ranked here" breakdown (weight × value). The capacity slider re-runs only this step.

### 7.10 Funnel numbers (all computed, none typed)
`signals → alerts → active alerts (after exceptions) → cases → HIGH / MEDIUM / LOW(Monitor) → in-capacity queue`, plus *% of injected dollars inside in-capacity cases* (a synthetic-ground-truth figure shown on the eval page).

---

## 8. Predictive ML: 30/60/90-day repeat or escalating risk

| Item | Specification |
|---|---|
| **Algorithm and library** | `sklearn.ensemble.HistGradientBoostingClassifier`, **one model per horizon** (30, 60, 90). Baseline for comparison: `LogisticRegression` (L2, standardised inputs). Pick the better by validation PR-AUC. Optional `monotonic_cst` on the risk-increasing features for explainability (confirm in the installed version). Class imbalance handled with `sample_weight` |
| **Settings (start point)** | `max_depth=3`, `max_iter≈150`, `learning_rate=0.05`, `l2_regularization=1.0`, `min_samples_leaf=20`, fixed `random_state`. Small data → shallow and regularised on purpose |
| **Unit and snapshots** | provider × month-end snapshot *t*. Train/val snapshots m10–m21 on train/val providers; **purge gap m22–m24**; test snapshots m25–m33 on **test** providers |
| **Features (as of *t* only)** | alert counts by channel over 90 and 180 days; alert dollars over 90 days; max rule base strength; latest `anomaly_pctile`; top peer z-scores; `growth_90d`; escalation slope and trend label; CUSUM alarm flag and months since; tenure; `self_referral_share`; `referral_top3_share`; `min_hops_to_confirmed`; counts of prior investigations by disposition with `closed_dt ≤ t`; months since the last closure; volume (`n_members`, `paid`). **Excluded:** member sex, age and any demographic; every `gt_*` field |
| **Label** | `gt_pred_label.y` as defined in the data architecture: positive injected dollars in `(t, t+h]` **and** (positive injected dollars in the prior 180 days **or** future daily dollar rate ≥ 1.25× the prior 90-day rate). The label is **synthetic and transparent**; say so on the slide |
| **Output** | `prob` per provider × horizon in `out.prediction`; calibration via `CalibratedClassifierCV(method='sigmoid')` **only if** the reliability curve is clearly off (Platt scaling suits small data better than isotonic) |
| **Explainability** | **Global:** permutation importance on validation. **Local:** the top-3 features ranked by `permutation_importance × percentile deviation` for that provider, shown as "associated factors", with the caveat "association, not cause". No SHAP, because it is not supported natively for this estimator and adds complexity for little value |
| **Evaluation** | PR-AUC, ROC-AUC, Brier score, a 10-bin reliability curve, **precision@k** with *k* = queue size, each with bootstrap CIs. **Baselines that must be beaten:** (1) "any alert in the last 90 days", (2) "last month's risk score". Report the lift. If the model does not beat persistence, say so |
| **Cost** | a few thousand rows × ~30 features × 3 models; seconds |
| **Why appropriate** | tabular, small, imbalanced; boosted shallow trees are the standard strong baseline, need little tuning, and handle missing values natively. A deep model would add risk and no credibility |
| **Role in the system** | ranks and informs; contributes only to `risk_h` via the 0.30 term; **never** raises evidence strength or tier |

---

## 9. Parameter table (tuned on validation only, then frozen into `rule_registry.params_json`)

| Parameter | Default | Tuned on |
|---|---|---|
| `z0` / `z1` (alert threshold / full strength) | 2.5 / 7.0 | val (alert volume) |
| `n_min` shares / `a` shrinkage | 30 / 20 | fixed |
| `peer_n_min` | 15 | fixed |
| Isolation percentile | 0.99 | val |
| CUSUM `k` / `h` | 0.5 / 5 | val (delay vs false alarms) |
| `cap_minutes` / `geo_km` / DME visit window | 720 / 100 / 60 days | val |
| Referral thresholds (`share`, `n_referrals`) | 0.5 and 0.8 / 30 | val |
| Channel weights `W`, risk lambda | as above | **lightly**; frozen |
| Utility weights, tier thresholds | as above | **lightly**; frozen |

**Protocol:** tune on val; write the values to the registry; run test once per frozen build; for variance run five master seeds.

---

## 10. Evaluation plan

| Level | Metric | Notes |
|---|---|---|
| Line, per rule | recall; precision as a **lower bound** (natural hits in the CMS base are unlabelled) | by difficulty; unit tests require near-exact recall on exact-fact schemes |
| Provider, per statistical detector | PR-AUC, precision@k, alarm rate on normal providers, incremental recall beyond rules | |
| Graph | ring recovery (all ring members in one case); D2 decoys never HIGH; share of flagged edges that are real | |
| Temporal | median detection delay by scheme and profile; false alarms per 1,000 normal provider-months | |
| Prediction | PR-AUC, ROC-AUC, Brier, reliability, precision@k vs baselines | |
| Pipeline | alerts → cases funnel; **% of injected dollars in in-capacity cases**; decoys reaching HIGH (target 0); **case purity** (share of a case's subjects from one scheme) and **fragmentation** (cases per scheme instance, target 1) | |
| Ablation | rules only → + peer → + self → + network → full | the "complementary approaches" slide |

**What these numbers prove, and what they do not.** The injected patterns and the detectors were written by the same team, so this evaluation shows that the engine is *correct and internally consistent*. It does not show detection power on real fraud. Three things reduce, but do not remove, that gap: test schemes are drawn from a shifted parameter distribution and start later; hard variants are included; and decoys are built to defeat naive detectors. State this limit in the demo; judges respect it.

---

## 11. Language and output vocabulary

| `scheme_type` | Hypothesis text (fixed templates) |
|---|---|
| DUP | "Billing pattern consistent with duplicate submission" |
| UPC | "Visit-level mix shifted toward higher-level codes than peers" |
| UNB | "Code combinations that published coding edits do not allow together" |
| EXU / UTL | "Service units / frequency above published limits or peer norms" |
| PHA / PHB / PHC | "Services dated after a recorded death / during a recorded inpatient stay / for members with no other care contact" |
| TMA / TMB | "Billed activity exceeding a plausible working day / same-day services at distant locations" |
| DME | "Equipment orders concentrated in few prescribers without qualifying visits" |
| RNG | "Referrals circulating within a commonly controlled group of providers" |
| EXC | "Billing by an entity listed as excluded" |

Allowed recommended actions (the LLM must pick from these): `REQUEST_RECORDS`, `PREPAY_REVIEW_FLAG` (needs supervisor), `PROVIDER_EDUCATION`, `MONITOR`, `REFER_EXTERNAL` (needs supervisor). The engine never outputs "deny", "recoup" or "refer for prosecution".

---

## 12. Implementation notes

- **Layout:** `engine/features.py`, `engine/rules/*.sql`, `engine/stat.py`, `engine/graph.py`, `engine/temporal.py`, `engine/predict.py`, `engine/alerts.py`, `engine/consolidate.py`, `engine/score.py`, `engine/queue.py`, `engine/evidence.py`. Every detector implements `run(asof, params) -> list[Signal]` so tests can call it in isolation.
- **Determinism:** fixed seeds; sorted inputs; no reliance on set ordering.
- **Isolation from ground truth:** detectors open only `claims.duckdb`; `predict.py` (labels) and `eval/` open `gt.duckdb`; a test fails if any other module imports the ground-truth path.
- **As-of discipline:** every feature, precedent and prior investigation is filtered by `date ≤ asof`; a unit test perturbs future rows and checks outputs do not change.
- **Limitation flags the engine must emit when true:** `low_peer_flag`, `small_volume_flag`, `ordering_provider_missing`, `estimated_dollars`, `minute_assumption`, `synthetic_data`, `partial_window`, `group_too_large_skipped`.

## 13. Build priority inside the engine (matches the MVP in the earlier plan)

1. Rules R-DUP-01, R-PTP-01, R-MUE-01, R-DOD-01, R-EXCL-01, R-DME-01, then R-DUP-02, R-IP-01, R-TIME-01, R-GEO-01 (all required).
2. `features.py` + S-UPC + S-UTL + S-DIST + S-GHOST.
3. Alerting, consolidation, scoring, tier, queue.
4. Graph: G-OWNREF, G-REFCONC, G-INFRA (then G-LOOP, G-PROX).
5. Temporal: T-CUSUM, T-GROWTH, T-RAMP, trend label.
6. Prediction (logistic baseline first, then boosted trees), then S-IF.
7. Evaluation harness and ablation.
