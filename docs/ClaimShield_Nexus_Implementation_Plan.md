# ClaimShield Nexus: Implementation Plan

*Acentra Health Hiring Hackathon, Final Round, Problem 3*
*Positioning: "An SIU Second Brain: it turns thousands of unexplained alerts into a small set of evidence-backed cases, and gets smarter with every investigator decision."*

> **What "verified" means in this document.** Dataset facts carry a link to their source. Anything marked **[verify]** could not be confirmed from the source during research, for example because the site blocked automated fetching. Check those items in a browser in the first hour. This plan contains **no invented statistics**. Thresholds marked *(tunable)* are design choices for you to set, not facts about the real world.

---

## 1. Datasets: what exists and what we use

### 1.1 Candidates compared

| Dataset | What it gives us | Gaps for FWA | Legal / ethics | Verdict |
|---|---|---|---|---|
| **CMS Synthetic Medicare Enrollment, FFS Claims & PDE (2023 release)**: [data.cms.gov collection](https://data.cms.gov/collection/synthetic-medicare-enrollment-fee-for-service-claims-and-prescription-drug-event), [User Guide (May 2023)](https://data.cms.gov/sites/default/files/2023-05/d51e1218-68c3-4c7c-9598-0b81f22fe903/User%20Guide%20-%20CMS%20Synthetic%20RIF%20Files%20May%202023_AM508_v2.pdf) | Synthetic "realistic-but-not-real" enrollment and claims for **8,671 beneficiaries** ([ResDAC](https://resdac.org/cms-public-use-files-for-researcher-use)). RIF (research file) layout. A third-party load reports 7 claim types (carrier, DME, outpatient, inpatient, SNF, HHA, hospice), claims from late 2014 to Mar 2023, pipe-delimited, about 1 GB, with carrier at about 1.12M lines / 90.7k claims and DME at about 103.8k lines ([GitHub project](https://github.com/ameer0108-a/medicare-claims)) **[verify counts yourselves]** | No FWA labels, no ownership, no facility geo, no investigation history | Public synthetic file. The guide states the usual privacy restrictions don't apply | **PRIMARY BASE** |
| **CMS 2008–2010 DE-SynPUF**: [overview](https://www.cms.gov/Research-Statistics-Data-and-Systems/Downloadable-Public-Use-Files/SynPUFs/DE_Syn_PUF), [Sample 1 download](https://www.cms.gov/Research-Statistics-Data-and-Systems/Downloadable-Public-Use-Files/SynPUFs/DESample01), [User Doc](https://cms.gov/Research-Statistics-Data-and-Systems/Downloadable-Public-Use-Files/SynPUFs/Downloads/SynPUF_DUG.pdf) | 5 file types (Beneficiary, Inpatient, Outpatient, Carrier, PDE) in 20 samples. Carrier has `PRF_PHYSN_NPI_1–13`, `TAX_NUM_1–13`, `HCPCS_CD_1–13`. Beneficiary file has death date, and there are no claims after death | ICD-9 era (2008–2010). The user doc says provider codes were **altered and assigned to beneficiaries based only on geography**, and dates were **perturbed**. So provider "behavior" in the base data is essentially random. No DME file, no labels | Public synthetic. CMS says it is suited to software development and training, not inference | **FALLBACK BASE** |
| **Synthea** ([CSV data dictionary](https://github.com/synthetichealth/synthea/wiki/CSV-File-Data-Dictionary)) | Generator. `providers.csv` has `Speciality`, `Lat`, `Lon`. `claims.csv` has `Referring Provider ID` and `Supervising Provider ID`. `claims_transactions.csv` has `Procedure Code`, `Modifier1/2`, `Units`, `Place of Service`. Also `organizations.csv` and `payers.csv` | Procedure-code system in claims not confirmed (Synthea clinical files use SNOMED CT), which makes NCCI/MUE rules hard **[verify]**. Needs Java. Schema is unlike payer claims | Open source **[verify license in repo]** | Use only if both CMS files fail |
| **NCCI PTP edits (Practitioner)**: [CMS page](https://www.cms.gov/medicare-medicaid-coordination/national-correct-coding-initiative-ncci/ncci-medicare/medicare-ncci-procedure-procedure-ptp-edits) | Real Column 1 / Column 2 code pairs that should not be billed together (unbundling). Latest listed: **2026 Q4, effective Oct 1 2026** | n/a (reference rules) | Downloads go through an **AMA license** click-through because CPT content is AMA-copyrighted. Use locally and **do not commit the raw files to a public repo** | **USE**: unbundling rules |
| **NCCI MUE (Practitioner / DME)**: [CMS page](https://www.cms.gov/medicare-medicaid-coordination/national-correct-coding-initiative-ncci/ncci-medicare/medicare-ncci-medically-unlikely-edits) | Maximum units per code per day. Updated quarterly. Some MUE values are confidential, so not every code has one | n/a | Same AMA license note | **USE**: excessive-units rules |
| **Medicare Physician & Other Practitioners: by Provider and Service** ([catalog.data.gov](https://catalog.data.gov/dataset/medicare-physician-other-practitioners-by-provider-and-service-23337)) | Real, aggregated NPI × HCPCS × place-of-service volumes and payments. Rows from ≤10 beneficiaries are suppressed. Excludes DMEPOS | Real provider identities | Public, but **real providers** | **OPTIONAL**: aggregate by specialty only, to calibrate peer distributions. **Never** join to or label individual providers |
| **OIG LEIE exclusion list** ([OIG page](https://oig.hhs.gov/exclusions/exclusions_list.asp), [record layout](https://oig.hhs.gov:443/exclusions/files/leie_record_layout.pdf)) | 18 fields (`LASTNAME … NPI … EXCLTYPE, EXCLDATE, REINDATE, WAIVERDATE, WAIVERSTATE`) | Real people | Public, but real names | **Copy the schema only.** Generate a synthetic exclusion table |
| Kaggle "Healthcare Provider Fraud Detection Analysis" (rohitrox) | Provider-level "PotentialFraud" labels on Medicare-style claims | License and provenance **could not be verified**. Unknown labeling process | Unclear | **Do not use.** Judges may ask where the labels came from, and you would have no answer |

### 1.2 Decision

**No public dataset contains FWA ground truth, ownership networks, or investigation history.** That is expected, and it works in our favor because injecting our own patterns gives us measurable ground truth.

**Recommended composition:**
1. **Base claims (legitimate background):** CMS Synthetic Medicare FFS Claims (2023), carrier + DME + outpatient + inpatient + beneficiary files.
2. **Coding-rule reference:** NCCI PTP Practitioner and MUE Practitioner/DME tables, current quarter.
3. **Our synthetic overlay (Python generator, seeded):**
   - Provider registry (specialty, address, phone, tenure)
   - Facilities with lat/lon
   - Owners and ownership links
   - Referrals
   - Exclusion list
   - Prior investigations
   - **Injected FWA schemes and decoys with ground-truth labels**
4. **Our synthetic knowledge corpus:** about 15–25 short, versioned payer-policy sections written by us (e.g. "DME-POL-4.2 Power mobility requires a documented face-to-face visit by the ordering practitioner within N days"). These are what briefs cite. Label each one "Synthetic policy for demo, modeled on public CMS concepts."

**Fallback ladder:**
- If the CMS 2023 files cannot be parsed or mapped within **2 hours**, switch to DE-SynPUF Sample 1 (carrier + beneficiary).
- If that also fails, switch to a **pure-Python claims generator** (write it early anyway; see §19). The rest of the pipeline is unchanged because everything maps to one canonical schema (§2).

**Hour-0 tasks:**
- Download the CMS 2023 collection in a browser. Automated fetches got HTTP 403.
- Open the data dictionary and confirm the carrier and DME line-level field names (claim ID, beneficiary ID, from/thru dates, performing NPI, referring NPI, HCPCS, modifiers, units, place of service, line payment, provider specialty) **[verify]**.
- Download NCCI PTP Practitioner and MUE Practitioner/DME (accept the AMA license).

**ID hygiene:** re-key every NPI and TIN in the base data to `SYN-P-000123` or `SYN-T-0042`. Synthetic NPIs could collide with real NPIs, and we never want a demo screen that appears to accuse a real provider.

---

## 2. Canonical data schema and how datasets connect

Load everything into **one canonical schema**. Every downstream component reads only this.

```
-- Reference / knowledge
ref_hcpcs(code, short_label, category, is_timed, assumed_minutes*)   -- *our labeled assumption, only for timed codes in demo
ref_ncci_ptp(col1, col2, modifier_ind, eff_dt, del_dt)               -- from CMS
ref_mue(code, mue_value, mai, file_type)                             -- from CMS
policy_section(section_id, doc_id, title, text, version, eff_dt)     -- our synthetic policy corpus
rule_registry(rule_id, version, name, family, sql_or_fn, severity, policy_section_ids, status, approved_by, approved_at)
exception_rule(exc_id, version, scope_json, effect, source_precedent_id, status, approved_by)

-- Entities
member(member_id, birth_yr, sex*, state, county, death_dt)           -- *never used as a model feature
provider(provider_id, type[indiv|org], name_syn, specialty, address_id, phone, tin_syn, enroll_dt, status)
facility(facility_id, name_syn, type, address_id)
address(address_id, line, city, state, zip, lat, lon)
owner(owner_id, name_syn)
ownership(owner_id, entity_id, entity_type, pct, start_dt)
exclusion(provider_id, excl_type, excl_dt, reinstate_dt)             -- synthetic, LEIE-shaped

-- Claims
claim(claim_id, claim_type[carrier|dme|op|ip|snf|hha|hospice], member_id,
      billing_prov, rendering_prov, referring_prov, facility_id,
      from_dt, thru_dt, pos, dx1..dx4, paid_amt)
claim_line(claim_id, line_no, hcpcs, mod1, mod2, units, line_dt, line_paid)

-- History / truth
investigation(inv_id, subject_ids[], opened_dt, closed_dt, scheme_type, disposition[confirmed|unfounded|education], recovered_amt, rationale)
ground_truth(scheme_id, scheme_type, subject_ids[], claim_ids[], start_dt, end_dt, difficulty, split[train|test])

-- App / workflow (OLTP)
alert(alert_id, rule_id, rule_version, family[rule|stat|graph|temporal|predict], subject_id, claim_ids[], score, dollars, created_run_id)
case(case_id, subject_ids[], status, risk, dollars, member_impact, severity, evidence_strength, confidence_tier, priority, est_hours, assigned_to)
case_alert(case_id, alert_id)
evidence_item(evidence_id, case_id, type, statement, values_json, source_refs_json, method, rule_version)
brief(brief_id, case_id, model, prompt_hash, output_json, validation_json, created_at)
review_action(action_id, case_id, actor, role, action, reason_code, notes, ai_proposal_json, created_at)
precedent(precedent_id, case_id, signature_json, disposition, rationale, approved_by, embedding?)
audit_event(seq, ts, actor, event_type, entity_id, payload_json, prev_hash, hash)
```

**How the sources connect:**
- `member` comes from beneficiary files and `claim` / `claim_line` from claim files, keyed on beneficiary ID and claim ID.
- Every distinct performing, billing or referring NPI in the claims becomes a `provider` (re-keyed). If the RIF has a specialty code, use it **[verify]**. Otherwise infer specialty from the provider's dominant HCPCS family.
- The overlay generator adds `address`, `facility`, `owner`, `ownership`, `exclusion`, `investigation`, and **schemes** (new claims or modified claims), all seeded and reproducible.
- `claim_line.hcpcs` joins `ref_ncci_ptp` and `ref_mue`. Rules join `policy_section` through `rule_registry.policy_section_ids`. That join is what makes citations possible.

---

## 3. Synthetic FWA scenarios and ground truth

Inject into the most recent ~18 months of data, so earlier months act as baseline and as history for the predictor. Use **two seeds**: seed A for development and tuning, seed B for a held-out test set. Report metrics on seed B only, so you never tune against the test injections.

| ID | Scheme | How to inject | Primary detector | Difficulty |
|---|---|---|---|---|
| S1 | Duplicate billing | Re-emit existing lines with the same member, provider, HCPCS and DOS. Variant: change modifier or shift DOS ±1 day | R-DUP-01/02 | Easy/Med |
| S2 | Upcoding (E&M) | For chosen providers, shift office-visit levels upward (e.g. 99213 → 99214/99215) from month M | Peer distribution shift + temporal change | Med |
| S3 | Unbundling | Add Column-2 codes from **real NCCI PTP pairs** on the same DOS as the Column-1 code, without an allowed modifier | R-PTP-01 | Easy |
| S4 | Excessive units | Units above the MUE value for that code | R-MUE-01 | Easy |
| S5 | Phantom services | (a) Services dated after `death_dt`. (b) Professional services at a distant outpatient location during the member's inpatient stay. (c) "Ghost" members who appear only with this provider | R-DOD-01, R-IP-01, stat | Easy/Med/Hard |
| S6 | Impossible timing | A provider bills more timed minutes per day than a working day allows (uses the labeled `assumed_minutes`). Same member at two facilities far apart on the same day | R-TIME-01, R-GEO-01 | Med |
| S7 | Excessive utilization | Visits per member per month far above the provider's peer group | Peer z-score + IsolationForest | Med |
| S8 | DME mill | New supplier (short tenure), high-cost DME HCPCS, most orders from 1–3 prescribers, members far from the supplier, no qualifying visit before the order | R-DME-01 + referral concentration + distance | Med/Hard |
| S9 | Referral / kickback ring | One owner controls 2 clinics plus 1 DME or lab. Shared address or phone. Concentrated closed-loop referrals | Graph: shared-owner component, referral concentration | Hard |
| S10 | Excluded provider billing | Provider in synthetic `exclusion` keeps billing after `excl_dt` | R-EXCL-01 | Easy |
| **D1–D4 decoys (legitimate)** | High-volume dialysis-like or infusion provider. Large group practice legitimately sharing one medical-building address. Rural provider with long member distances. Specialty clinic with naturally high E&M levels | Should **not** become High-confidence cases. These drive the human-review and exception demo | n/a |
| **Escalators** | About a third of schemes ramp up in volume over time. Some subjects have prior *confirmed* investigations, and some have *unfounded* ones | Drives 30/60/90 prediction and precedent fit | n/a |

**Ground-truth artifacts:**
- `ground_truth` with `scheme_id`, `scheme_type`, subjects, `claim_ids`, window, difficulty, split
- A claim-level boolean `is_injected`
- A provider-level label `fwa_any`

**Prior investigations:** generate about 150–300 closed `investigation` records spread across earlier months, covering a mix of confirmed, unfounded and education outcomes and a mix of scheme types, each with a 2–3 sentence rationale. These are the **seed precedent library**.

Keep the injection rate low enough that alerts are a needle-in-haystack problem (a few percent of providers, *tunable*), but high enough that each scheme has several instances.

---

## 4. Detection architecture (4 families, all explainable)

Every detector emits `alert` rows tagged with a **family**. Confidence later depends on how many *independent families* agree.

### 4.1 Rules (family = `rule`): DuckDB SQL, versioned in `rule_registry`
| Rule | Logic (simplified) | Cites |
|---|---|---|
| R-DUP-01 | Same member, provider, HCPCS, DOS, modifiers, count > 1 | POL-BILL-1.1 |
| R-DUP-02 | Same as above but modifiers differ or DOS ±1, same paid amount | POL-BILL-1.2 |
| R-PTP-01 | Two lines on the same member/provider/DOS match `ref_ncci_ptp(col1,col2)` active on DOS, and modifier rules are not satisfied | NCCI PTP + POL-CODE-2.1 |
| R-MUE-01 | Sum of units per code/member/DOS > `ref_mue.mue_value` | NCCI MUE + POL-CODE-2.2 |
| R-DOD-01 | `line_dt > member.death_dt` | POL-ELIG-3.1 |
| R-IP-01 | Non-inpatient professional line during an inpatient stay at a facility more than X km away *(tunable)* | POL-BILL-1.4 |
| R-TIME-01 | Σ `assumed_minutes` of timed codes per provider per day > threshold *(tunable)* | POL-BILL-1.5 |
| R-GEO-01 | Same member, same day, two facilities more than X km apart *(tunable)* | POL-BILL-1.6 |
| R-EXCL-01 | Billing provider in `exclusion` with `line_dt ≥ excl_dt` | POL-ENR-5.1 |
| R-DME-01 | DME claim with no visit by the referring provider in the prior N days *(tunable)* | DME-POL-4.2 |

Each alert stores `rule_id@version`, the implicated `claim_ids`, and `dollars` (the sum of `line_paid` on the implicated lines).

### 4.2 Statistical / ML (family = `stat`): provider-month features
- **Peer group:** specialty × state, falling back to specialty nationally if n is too small. Always store `peer_n`, because it feeds the limitations section.
- **Features:**
  - Paid per member
  - Services per member
  - Distinct members per day
  - Share of top-level E&M codes
  - Mean member distance
  - Share of new members
  - Share of high-cost HCPCS
  - Month-over-month growth
- **Peer z-scores and percentiles:** the explanation layer. "Share of 99215 = 0.62, peer median 0.18, 99th pct of 214 peers." Every number is computed from your data, never written in by hand.
- **IsolationForest** (scikit-learn) on standardized features gives an anomaly score. **Explain it with the top-3 absolute peer z-scores**, not SHAP. That is simpler, deterministic and readable.
- Emit an alert when the anomaly percentile is at least the top x% *(tunable)* **and** at least one z-score is ≥ 3 *(tunable)*.

### 4.3 Graph (family = `graph`): NetworkX
- **Nodes:** provider, owner, address, phone, facility. Members are aggregated into edge weights, not added as nodes, to keep the graph small.
- **Edges:** `owns`, `located_at`, `uses_phone`, `refers_to(weight = #claims, $)`, `shares_members(weight = Jaccard)`.
- **Signals:**
  1. **Shared-infrastructure components:** providers linked through the same owner, address or phone (connected components on that subgraph).
  2. **Referral concentration:** the share of a provider's (especially DME's) volume coming from its top-3 referrers.
  3. **Closed-loop referrals:** A→B→C with a shared owner, found with simple cycle detection on the small owner-scoped subgraph.
  4. **Proximity to confirmed precedents:** within 2 hops of a provider in a *confirmed* investigation.
  5. **Communities** (`networkx.community.louvain_communities`): used to *group* cases, not as standalone evidence.

### 4.4 Temporal (family = `temporal`)
- **Rolling 30/90-day volume and $ against the provider's own baseline:** flag growth above the peer p95 growth rate *(tunable)*.
- **New-provider ramp:** high volume within the first N months of `enroll_dt`.
- **Simple change-point:** largest month-over-month jump in the E&M top-level share. A plain difference is enough; no change-point library needed.

### 4.5 Prediction (family = `predict`): see §5. It is a *ranking input*, never evidence of FWA by itself.

---

## 5. 30/60/90-day risk prediction

**Unit:** provider × monthly snapshot date `t`.

**Features at `t`** (using only data at or before `t`, with no leakage):
- Rule-alert counts by family over the last 90 and 180 days
- IsolationForest percentile and top z-scores
- Growth rates
- Tenure
- Graph features (component size, referral concentration, distance to confirmed precedents)
- Prior investigations: count of confirmed / unfounded
- $ implicated over the last 90 days

**Labels** `y_h` for h ∈ {30, 60, 90}: 1 if, in `(t, t+h]`, the provider has ground-truth injected activity **and** either (a) implicated $ in the window exceeds the prior window ("escalating") or (b) a new scheme type appears. Otherwise 0. Write this definition on the slide. It is a synthetic, transparent label.

**Model:** scikit-learn `HistGradientBoostingClassifier`, one per horizon (3 small models). Use logistic regression as a fallback or baseline.

**Validation:** time-based split. Train on snapshots before T_split and test after, with test schemes coming from seed B.

**Reported metrics:** ROC-AUC, PR-AUC, precision@k, and a reliability (calibration) plot. Calibrate with `CalibratedClassifierCV(method="isotonic")` only if the plot is clearly off.

**UI:** "Risk outlook: 30d 0.41 · 60d 0.55 · 90d 0.63", with the top drivers taken from the feature values against peers, plus a fixed caveat: *"Trained on synthetic labels; indicates prioritization, not wrongdoing."*

Keep this to about 10% of total effort. It is a required box to tick, not the centerpiece.

---

## 6. Alert → case → SIU prioritization pipeline

```
alerts (thousands) ──► entity resolution ──► case consolidation ──► scoring ──► confidence tier ──► capacity-aware queue
```

1. **Entity resolution:** group alerts by subject provider. Then merge providers into one **network case** if they share an owner, address or phone, **or** sit in the same graph component and both have alerts.
2. **Case object:** subjects, alerts, implicated claims, window, *scheme hypotheses* (from the alert families: duplicate → billing error/abuse; PTP/MUE → coding abuse; DME + referral concentration → DME mill pattern; and so on).
3. **Scores (each 0–1, all shown in the UI):**
   - `risk`: weighted fusion of max rule severity, anomaly percentile, graph signal and 90-day prediction. Set the weights by hand first and tune them on seed A.
   - `dollars`: rule alerts use Σ paid on implicated lines (exact). Stat alerts use excess over peer: (provider metric − peer median) × volume, labeled "estimated".
   - `member_impact`: # members affected, plus a harm-type weight (phantom or unnecessary services > coding errors).
   - `severity`: from the scheme-type table in `rule_registry`.
   - `evidence_strength`: f(# independent families, deterministic rule present?, share of the provider's claims implicated, precedent support).
   - `precedent_fit`: similarity-weighted share of *confirmed* vs *unfounded* among the top-k similar precedents.
4. **Confidence tier (deterministic, explainable):**
   - **High:** ≥ 2 families **including** ≥ 1 deterministic rule, $ above threshold, and no matching *unfounded* precedent or approved exception.
   - **Medium:** a single strong family, *or* conflicting signals, *or* a mixed precedent.
   - **Low:** a single statistical signal, *or* a small peer group (`peer_n` < threshold), *or* a matching *unfounded* precedent. Outcome: **"Monitor: insufficient evidence"**. No case is opened, and the reason is logged.
5. **Priority and queue:**
   - `priority = risk × log1p(dollars) × severity × (1 + member_impact)`, adjusted by tier.
   - `est_hours` comes from case complexity (# subjects, # claims, network or not).
   - **Greedy knapsack** against capacity (e.g. 3 investigators × 40 h): sort by priority / est_hours and fill until capacity is used.
   - Each row has a "Why ranked here" panel showing every factor.

The headline funnel numbers are computed live from your data: **alerts → cases → High/Medium/Low → in-capacity queue**, plus **% of injected $ covered by in-capacity cases**.

---

## 7. Evidence-pack design (the only input the LLM ever sees)

```json
{
  "case_id": "C-0417",
  "subjects": [{"id":"SYN-P-000881","type":"DME supplier","specialty":"DME","tenure_months":7}],
  "scores": {"risk":0.82,"dollars":48210.55,"dollars_basis":"exact","evidence_strength":0.78,
             "confidence_tier":"HIGH","tier_reasons":["3 independent families","deterministic rule R-DME-01","no unfounded precedent"]},
  "evidence": [
    {"id":"E1","type":"rule_hit","rule":"R-DME-01@v2","statement":"{n} DME claims had no qualifying visit by the ordering provider within {days} days",
     "values":{"n":63,"days":45},"claim_ids":["…"],"policy_refs":["DME-POL-4.2"]},
    {"id":"E2","type":"graph","statement":"{share} of orders came from {k} prescribers",
     "values":{"share":0.91,"k":2},"edges":[["SYN-P-000412","SYN-P-000881","refers_to"]]},
    {"id":"E3","type":"graph","statement":"Supplier shares owner {owner} with prescriber clinic {clinic}",
     "values":{"owner":"SYN-O-0031","clinic":"SYN-P-000412"}},
    {"id":"E4","type":"stat","statement":"Mean member distance {d} km vs peer median {pm} km (pctl {p}, n={n})",
     "values":{"d":118.2,"pm":14.0,"p":99.1,"n":57}},
    {"id":"E5","type":"precedent","statement":"Similar closed case {pid}: disposition {disp}",
     "values":{"pid":"INV-0142","disp":"confirmed","similarity":0.84}},
    {"id":"E6","type":"prediction","statement":"90-day escalation risk {p90}","values":{"p90":0.63}}
  ],
  "policies": [{"id":"DME-POL-4.2","version":"v1","text":"…"}],
  "limitations": ["Peer group n=57 (DME, state)", "Labels and policies are synthetic", "Distance uses ZIP centroids"],
  "allowed_actions": ["REQUEST_RECORDS","PREPAY_REVIEW_FLAG","PROVIDER_EDUCATION","MONITOR","REFER_EXTERNAL(requires supervisor)"],
  "forbidden_terms": ["fraud","fraudulent","criminal","guilty","stole","illegal"]
}
```

The numbers above are illustrative of the format only. Real values are filled from the data.

**Rules for the pack:**
- Statements are **templates filled server-side**.
- The LLM may only reference evidence IDs. It never sees raw tables and never computes numbers.

---

## 8. Retrieve → Interpret → Apply Rules → Propose → Score → Cite

| Step | Implementation | Deterministic or LLM |
|---|---|---|
| **Retrieve** | For the case: implicated claims (DuckDB), peer stats, graph ego-network (2 hops), `policy_section`s linked through `rule_registry`, top-k precedents (structured signature match on scheme type + rule IDs + specialty, then cosine similarity on the feature vector; optionally BM25 over rationales) | Deterministic |
| **Interpret** | Map codes to `ref_hcpcs.short_label`. Resolve entities (shared owner/address/phone). Choose the peer group. Build scheme hypotheses from the families present | Deterministic. Optionally the LLM writes a plain-language summary of *what the codes mean* from `ref_hcpcs` labels only |
| **Apply rules** | Run rules at their current versions. **Apply approved `exception_rule`s first**: suppressed or downgraded alerts are recorded *with the exception ID*, so suppression is itself cited | Deterministic |
| **Propose** | The LLM receives the evidence pack and returns structured JSON: `summary_sentences[] {text, evidence_ids[]}`, `hypothesis` (from allowed list), `recommended_action` (from `allowed_actions`), `what_would_change_my_mind[]`, `limitations[]` | **LLM**, constrained |
| **Score** | Scores and tier are computed before the LLM runs (§6). The LLM **cannot** change them, only explain them | Deterministic |
| **Cite** | The validator (§17) checks every sentence's evidence IDs and numbers. The UI renders each citation as a chip linking to claims, the graph edge, the policy section or the precedent | Deterministic |

---

## 9. Human review and approval workflow

**Roles:**
- **Investigator:** reviews cases and proposes actions.
- **SIU Supervisor:** approves high-impact actions and assigns work.
- **Rule Governance reviewer:** approves exception rules.
- **Auditor:** read-only, can replay any decision.

**Case state machine:**
```
NEW → TRIAGED → IN_REVIEW → ACTION_PROPOSED → (supervisor) ACTION_APPROVED → ACTION_TAKEN → CLOSED{CONFIRMED|UNFOUNDED|EDUCATION|INSUFFICIENT}
                         ↘ NEED_INFO ↗
MONITOR (low tier, no case)  ── re-evaluated each run
```

**Investigator actions:** `Accept AI proposal`, `Modify` (change action or hypothesis), `Reject` (mark false positive), `Request info`.
- A **reason code is mandatory**, e.g. `LEGIT_CLINICAL_PATTERN`, `DOC_SUPPORTS_BILLING`, `DATA_ERROR`, `CONFIRMED_PATTERN`, `NEEDS_RECORDS`, plus free-text notes.

**Two-person rule:** `PREPAY_REVIEW_FLAG`, `REFER_EXTERNAL`, and any exception rule need a second role to approve. The AI can never execute an action.

**"AI vs human" diff:** every `review_action` stores what the AI proposed next to what the human decided. Override rate per rule becomes a dashboard metric for rule-quality feedback.

Actions are **simulated** (status change, a generated records-request letter as PDF/markdown, a notification). The prototype never touches real payment systems.

---

## 10. Precedent / knowledge-compounding loop

The organizers' loop is INGEST → QUERY → LINT/REVIEW → UPDATE → COMPOUND. Here is how each step maps:

1. **Ingest:** on case close, create a `precedent` containing:
   - `signature` (scheme type, rule IDs, specialty, feature vector, graph pattern)
   - `disposition`
   - `rationale`
   - `approved_by`
   - linked evidence IDs
2. **Query:** every new case retrieves its top-k precedents. They appear as evidence (E5 above) and feed `precedent_fit` and the confidence tier.
3. **Lint / review (the differentiator):** when a case is closed **UNFOUNDED** with `LEGIT_CLINICAL_PATTERN`, the system **drafts an exception rule** in a tiny JSON DSL:
   ```json
   {"scope":{"specialty":"Nephrology","hcpcs_in":["…"],"rule_ids":["R-STAT-UTIL"]},
    "condition":"visits_per_member_month <= 14",
    "effect":"DOWNGRADE_TO_MONITOR",
    "source_precedent":"P-0207"}
   ```
   It then runs the **lint**:
   - **Conflict check:** would it suppress any alert matching a *confirmed* precedent's signature?
   - **Breadth check:** how many providers and $ does it touch? Flag it if it is broad.
   - **Backtest** on history plus seed-A ground truth: alerts suppressed, true positives lost, $ no longer reviewed.
   - Output: "Suppresses 312 alerts across 9 providers; 0 ground-truth positives lost; no conflict with confirmed precedents." These figures come from your run.
4. **Update:** the Rule Governance reviewer approves it. A new `exception_rule` version goes live, and an `audit_event` is written.
5. **Compound:**
   - Re-run detection. The alert count falls and the decoy provider drops to Monitor.
   - A new similar case now shows *"Downgraded per EXC-0007 (from precedent P-0207, approved by …)."*
   - Confirmed and unfounded dispositions also append labels for the next model retrain (a "Retrain" button, if time allows).

---

## 11. Storage architecture

| Store | Use | Why |
|---|---|---|
| **DuckDB file** (`claims.duckdb`) | Canonical claims, reference tables, features, alerts, cases (written by the batch pipeline) | Columnar and fast on about 1M+ rows. SQL rules are trivial. Native pandas/Parquet |
| **SQLite** (`app.db`) | Workflow: review actions, briefs, precedents, exception rules, audit log | Simple OLTP, a single file, no server to fail during the demo |
| **Parquet** (`/data/raw`, `/data/processed`) | Raw and intermediate snapshots | Reproducibility |
| **No vector DB** | The precedent and policy corpus is small (hundreds of items). Use NumPy cosine on feature vectors, optionally `rank_bm25` on text | Fewer moving parts |
| **Audit log** | Append-only `audit_event`, each row stores `prev_hash` and `hash = SHA256(prev_hash + payload)`. A `/audit/verify` endpoint re-checks the chain | Tamper-evident trail. Cheap to build and impressive to show |

Postgres is unnecessary for a hackathon. Swap to it only if you deploy multi-user.

---

## 12. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Data / ML | Python 3.11, pandas, DuckDB, scikit-learn (IsolationForest, HistGradientBoosting, CalibratedClassifierCV), NetworkX | All mature, pip-installable, no GPU |
| Backend | FastAPI + Pydantic, Uvicorn | Pydantic models double as the LLM output schema |
| LLM | Claude via the Anthropic API, with structured output (tool use / JSON schema). A mid-tier model for briefs, a small model for cheap text tasks | Abstract behind `llm_client.py` so you can swap providers or use **template-only mode** if there is no API access at the venue |
| Frontend | React + Vite + TypeScript, Tailwind + shadcn/ui, TanStack Table, Recharts, Cytoscape.js (`react-cytoscapejs`) for the network graph | The team already ships React/Vite. Avoid Streamlit for the final UI, because it reads as a prototype |
| Docs / PDF | Markdown → HTML for the brief, browser print-to-PDF for "export brief" | No PDF library risk |
| Ops | `make pipeline`, `make api`, `make web`. Seeded and deterministic. `.env` for the API key | One-command reset before the demo |

---

## 13. Services and APIs

**Batch pipeline** (`pipeline/`, run offline and on "Re-run"):
`ingest.py` → `overlay_generate.py` → `inject_schemes.py` → `features.py` → `rules.py` → `stat_detect.py` → `graph_detect.py` → `temporal.py` → `predict.py` → `cases.py` (consolidate + score + tier + queue) → `evidence.py`

**FastAPI endpoints:**
```
GET  /api/dashboard/funnel                   alerts→cases→tiers→queue, $ coverage, run_id
GET  /api/queue?capacity_hours=120           ranked in-capacity cases + "why ranked"
GET  /api/cases/{id}                         case, scores, tier reasons, subjects
GET  /api/cases/{id}/evidence                evidence pack
GET  /api/cases/{id}/graph                   2-hop subgraph (nodes, labeled edges)
GET  /api/cases/{id}/timeline                claims/alerts over time
POST /api/cases/{id}/brief                   generate → validate → store (cached by pack hash)
POST /api/cases/{id}/review                  {action, reason_code, notes}
POST /api/cases/{id}/actions/{aid}/approve   supervisor approval (two-person rule)
GET  /api/cases/{id}/precedents              top-k similar precedents
POST /api/exceptions/propose                 from a closed UNFOUNDED case
POST /api/exceptions/{id}/simulate           lint + backtest report
POST /api/exceptions/{id}/approve            governance approval → new rule version
POST /api/pipeline/rerun                     re-run detection (seeded subset for speed)
GET  /api/providers/{id}/risk                30/60/90 outlook + drivers
GET  /api/audit?entity_id=                   audit replay
GET  /api/audit/verify                       hash-chain check
GET  /api/eval                               metrics vs ground truth (seed B)
POST /api/cases/{id}/ask                     (stretch) grounded Q&A over the evidence pack only
```

---

## 14. MVP: build these first, in order

1. Canonical schema plus ingestion of the base claims, *or* the Python generator. Then overlay and injection of **S1, S3, S4, S5a, S8, S9, S10** plus **2 decoys**, with ground truth.
2. Rules R-DUP-01, R-PTP-01, R-MUE-01, R-DOD-01, R-EXCL-01, R-DME-01, each with `policy_section` citations.
3. Peer z-scores plus IsolationForest. Graph: shared-owner/address components and referral concentration.
4. Alert → case consolidation, the scores, the **deterministic confidence tier**, and the capacity-aware queue.
5. Evidence pack → LLM brief → **validator** → template fallback.
6. UI: funnel dashboard, queue, case workspace (brief with citation chips, evidence table, network graph, timeline), review panel.
7. Review workflow with reason codes, the two-person rule on one action type, and the hash-chained audit log.
8. **Precedent loop:** close an UNFOUNDED decoy → propose exception → simulate → approve → re-run → show the drop and the citation.
9. `/api/eval` page: rules-only vs stat-only vs graph-only vs fused (precision@k, recall, $ coverage) on seed B.

## 15. Only if time remains
- S2 upcoding, S6 timing/geo, S7 utilization, S5b/c phantom variants
- 30/60/90 prediction UI with a calibration plot. Build the model in MVP+1 even if the UI is basic, because the problem statement requires it
- Retrain-from-feedback button
- "Ask this case" grounded Q&A
- Policy wiki page that auto-links precedents to policy sections
- Records-request letter generator
- Fairness panel: alert rates by state or rurality, and a note that no member demographics are used as features
- Role-based views with masked member fields

---

## 16. Evaluating against synthetic ground truth

Report on **seed B (held out)**. Never tune on it.

| Level | Metric | Notes |
|---|---|---|
| Claim | Precision and recall per rule | Deterministic rules should score near-perfect on their own scheme. If they don't, it's a bug, so treat this table as a test suite too |
| Provider | PR-AUC, precision@k (k = queue size at capacity), recall@k | **Ablation:** rules only / stat only / graph only / fused. This is the slide that justifies "two complementary approaches" |
| Network | % of injected rings where ≥ X% of members land in one case | Shows graph value on S9 |
| Triage | Alerts → cases reduction ratio. % of injected $ inside in-capacity cases. Decoys reaching High tier (target: 0) | The headline funnel |
| Prediction | ROC-AUC and PR-AUC per horizon on a time split, plus a reliability plot | Honest caveat about synthetic labels |
| LLM brief | % sentences with valid citations, numeric mismatch count (target 0), forbidden-term count (target 0), fallback rate | Computed by the validator over all generated briefs |
| Knowledge loop | Alerts suppressed by approved exceptions, ground-truth positives lost (target 0) | From the backtest |
| Difficulty breakdown | Recall by scheme difficulty (easy/med/hard) | Show what you **miss**. Judges trust a team that reports its own blind spots |

---

## 17. Preventing hallucinations and unsupported accusations

1. **The LLM never produces numbers.** Sentences reference `{E4.values.d}`-style placeholders or evidence IDs. The server renders the numbers.
2. **Structured output only:** `summary_sentences[{text, evidence_ids[]}]`, `recommended_action ∈ allowed_actions`, `hypothesis ∈ allowed_hypotheses`.
3. **Validator** (deterministic, runs on every brief):
   - Every sentence has ≥ 1 valid evidence ID.
   - Every number in the text matches a value in the cited evidence.
   - Every entity ID mentioned exists in the pack.
   - No forbidden terms.
   - The action is in the allowed list.
   - The tier mentioned equals the computed tier.
   - **On failure:** one retry with the validation errors, then the **template brief** (deterministic, always correct). Show a "Validated ✓ / Template fallback" badge.
4. **Controlled language:** "indicators consistent with", "warrants review", "pattern observed". Never "fraud", "fraudulent" or "guilty". The system recommends *review*, never a sanction.
5. **Low-confidence path:** for a Low tier the brief template is fixed: "Insufficient evidence to open a case. Signals: … What would raise confidence: …"
6. **Mandatory limitations section,** auto-generated (small peer n, estimated $, synthetic data, distance approximation) plus any the LLM adds *from the pack*.
7. **No autonomous actions:** every action is gated, and high-impact ones need two people.
8. **No protected attributes as features:** member sex, age and race are excluded from ML features and the exclusion is documented. The provider-disruption flag appears when the subject is a sole provider in an area.
9. **Data is not instructions:** free-text fields (notes, rationales) are wrapped as quoted data in prompts. The LLM has no tools that write data.
10. **Everything is logged:** prompt hash, model, pack hash, output, validation result, and the human decision all go to the hash-chained audit log.

---

## 18. Making the live demo impressive (about 6 minutes)

1. **Hook (20s):** "Payers drown in alerts. Here are about N thousand alerts from this run…" The funnel animates down to a few dozen in-capacity cases covering X% of injected $. All numbers are live from your run.
2. **Queue (40s):** capacity slider (3 → 2 investigators) and the queue re-packs. Open "Why ranked here".
3. **Network case (90s):** DME-mill / shared-owner ring.
   - Graph lights up with labeled edges (owner, address, referral 91%).
   - Brief with citation chips: click one to see the claims, click another to see policy DME-POL-4.2.
   - Confidence **High**, with reasons.
   - The 90-day outlook.
4. **Honesty moment (40s):** open a **Low** item. "Insufficient evidence. Here's what would change our mind." Say the line: *"A confident wrong answer is riskier than an explicit knowledge gap."*
5. **Human control (40s):** the investigator proposes a pre-pay review flag, the supervisor approval is required, the second role approves, and the audit trail shows AI proposal vs human decision.
6. **Knowledge compounding (90s), the climax:**
   - Open the decoy dialysis-like provider (Medium). The investigator rejects it with `LEGIT_CLINICAL_PATTERN`.
   - The system drafts an exception and runs lint + backtest: "suppresses N alerts, 0 true positives lost."
   - Governance approves. **Re-run.** The funnel count drops, and the next similar case shows "Downgraded per EXC-0007 from precedent P-0207."
7. **Proof (30s):** eval page with the ablation table (fused beats any single method), the blind-spot row, and `/audit/verify ✓`.
8. **Close (10s):** "Every investigator decision makes the next thousand decisions better, with an audit trail for each one."

**Demo hygiene:**
- Pre-run the pipeline and pre-generate briefs (cached by pack hash). Allow one live LLM call with a cached fallback.
- Use a "reset demo" script.
- Have a recorded backup video.
- Use fixed seeds.
- Rehearse 3 times.

---

## 19. Build plan

### Team roles (4 people; with 3, merge C and D's workflow parts)
- **A: Data & Rules:** ingestion, overlay generator, scheme injection, ground truth, SQL rules, policy corpus.
- **B: ML, Graph & Eval:** features, peer stats, IsolationForest, graph, prediction, evaluation and ablation.
- **C: Backend, LLM & Governance:** FastAPI, cases/scoring/queue, evidence pack, LLM + validator, workflow, precedents, exceptions, audit.
- **D: Frontend & Demo:** React UI, graph viz, demo script, slides, backup video.

### 24-hour plan
| Hours | A: Data/Rules | B: ML/Graph | C: Backend/LLM | D: Frontend |
|---|---|---|---|---|
| 0–2 | Download CMS files + NCCI/MUE. Confirm fields. **Freeze canonical schema with everyone** | Features spec. Prepare the pure-Python fallback generator skeleton | FastAPI skeleton, SQLite tables, evidence-pack Pydantic models, mock JSON | Vite app shell, routing, layout, mock data from C's JSON |
| 2–6 | Ingest → DuckDB. Re-key IDs. Overlay (providers, addresses, owners, facilities, exclusions). Inject S1/S3/S4/S5a/S10 + ground truth | Peer z-scores + IsolationForest on provider-month | Case consolidation + scoring + tier + queue (on A's early output) | Dashboard funnel + queue table |
| 6–10 | Inject S8/S9 + decoys + investigations history. Rules SQL + `rule_registry` + policy corpus (15 sections) | Graph build: components, referral concentration, precedent proximity | Evidence-pack builder. LLM brief + **validator** + template fallback | Case workspace: brief with citation chips, evidence table |
| 10–14 | Seed B injection. Rule unit tests vs ground truth | Eval endpoint: ablation, precision@k, $ coverage | Review workflow, reason codes, two-person approval, hash-chained audit | Cytoscape network view, timeline, review panel |
| **14 (checkpoint)** | **End-to-end path works: run → queue → case → brief → review → audit. If not, cut stretch scope now** | | | |
| 14–18 | Exception DSL application inside the rules engine | Backtest/lint for exception proposals. 30/60/90 model (simple) | Precedent creation + retrieval + exception propose/simulate/approve + rerun endpoint | Precedent panel, exception flow screens, eval page |
| 18–21 | Data QA, demo case curation (pick the 4 hero cases) | Calibration plot, risk outlook endpoint | Brief caching, error handling, reset script | Polish, empty/loading/error states, "why ranked" panel |
| 21–24 | **Freeze code at 21.** Rehearse ×3, record backup video, slides (architecture, chain, eval, responsible AI) | | | |

### 48-hour plan (same backbone, more depth)
- **Hours 0–14:** as above, but with a calmer pace and full rule tests.
- **Hours 14–24:** S2 upcoding, S6 timing/geo, S7 utilization. Temporal detectors. Full prediction with time-split eval.
- **Hours 24–32:** precedent loop polish, retrain-from-feedback, records-request letter, fairness panel, role-based views with masking.
- **Hours 32–38:** "Ask this case" grounded Q&A (evidence-pack only, same validator). Policy wiki page.
- **Hours 38–42:** robustness: re-run on seed B live, performance, UI polish.
- **Hours 42–48:** freeze, rehearse, video, slides, judge Q&A prep (data provenance, label definition, limitations).

---

## 20. Biggest technical risks and fallbacks

| Risk | Early signal | Fallback |
|---|---|---|
| CMS 2023 files are hard to parse or map | Not loaded by hour 2 | DE-SynPUF Sample 1, or the pure-Python generator (same canonical schema) |
| Base data has no specialty or referring NPI **[verify]** | Fields absent in the dictionary | Infer specialty from dominant HCPCS family. Generate referrals in the overlay |
| NCCI pairs don't intersect codes in the base data | Few R-PTP hits on non-injected data | That's fine. Inject from real pairs. Keep only the PTP/MUE rows for codes that are present |
| Too many stat/graph false positives flood cases | Cases > capacity × 5 | Raise thresholds on seed A. Require ≥ 2 families for case creation. Low tier → Monitor |
| Injected patterns too easy ("of course it found them") | Perfect scores everywhere | Add hard variants (near-duplicates, mild upcoding), decoys and noise. Report recall by difficulty |
| LLM unavailable, slow or hallucinating | Validator failures, latency > 10 s | Cached briefs. Template brief mode is always available. Validator blocks anything bad |
| Graph view becomes unreadable | > ~40 nodes | Case subgraph only, 2 hops, collapse members into edge weights, precomputed layout |
| Prediction looks fake | AUC suspiciously high | Show the label definition, time split and calibration. Present it as a prioritization input |
| Integration chaos | Mismatched JSON at hour 10 | Freeze schema and Pydantic contracts at hour 2. C serves mock JSON from hour 1 |
| Demo-day failure | n/a | Local-only run (no cloud dependency except the LLM), reset script, cached outputs, recorded video |

---

## Summary

**Recommended dataset:** CMS *Synthetic Medicare Enrollment, FFS Claims & PDE* (2023, data.cms.gov) as legitimate background, plus NCCI PTP and MUE tables as real coding rules, plus our seeded overlay (providers, ownership, referrals, facilities, synthetic exclusions, investigation history) and **injected schemes and decoys with ground truth**. Fallback: DE-SynPUF Sample 1, then a pure-Python generator.

**Recommended stack:** Python, DuckDB, pandas, scikit-learn, NetworkX · FastAPI + Pydantic · Claude via the Anthropic API with structured output + a deterministic validator + template fallback · SQLite with a hash-chained audit log · React + Vite + TS + Tailwind/shadcn + Cytoscape.js + Recharts.

**Recommended architecture:** batch pipeline (rules + stat + graph + temporal + predict) → alerts → case consolidation → deterministic scores and confidence tiers → capacity-aware queue → evidence pack → constrained LLM brief → validator → human review with a two-person rule → actions → precedents → linted, backtested exception rules → re-run.

**MVP scope:** §14 items 1–9.

**Demo flow:** funnel → capacity queue → network case with cited brief → Low-confidence "not enough evidence" → supervisor approval → reject decoy → exception lint/backtest → approve → re-run shows learning → eval ablation + audit verify.

**What NOT to build:**
- A chatbot as the main UI
- LLM-generated scores or numbers
- Deep learning, GNNs or LLM-based detection
- A vector DB, Kafka, Kubernetes, microservices or authentication systems
- Real-provider data joins (LEIE names, real NPIs)
- Any automatic deny/suspend action
- The words "fraud" or "fraudulent" in outputs
- A full-country graph visualization
- More than about 10% of your time on prediction
