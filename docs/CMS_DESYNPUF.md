# CMS DE-SynPUF (Sample 1): what was downloaded and how it maps to ClaimShield

Official source: CMS "2008-2010 Data Entrepreneurs' Synthetic Public Use File (DE-SynPUF)", Sample 1
(https://www.cms.gov/data-research/statistics-trends-and-reports/medicare-claims-synthetic-public-use-files/cms-2008-2010-data-entrepreneurs-synthetic-public-use-file-de-synpuf/de10-sample-1).
It is fully synthetic Medicare-style data published by CMS. No real patient data. Downloaded on 2026-10-08.

Saved in the project at `data/raw/cms_desynpuf/sample1/` (git-ignored, see `.gitignore`). `MANIFEST.json` in that folder lists URL, size and SHA-256 of every file.

## Files

| File (extracted CSV) | Download | Zip size | CSV size | Rows | Grain |
|---|---|---|---|---|---|
| `DE1_0_2008_Beneficiary_Summary_File_Sample_1.csv` | cms.gov `.../synpufs/downloads/` | 3.1 MB | 14.6 MB | 116,352 | one row per beneficiary, 2008 |
| `DE1_0_2009_Beneficiary_Summary_File_Sample_1.csv` | same | 3.2 MB | 14.5 MB | 114,538 | one row per beneficiary, 2009 |
| `DE1_0_2008_to_2010_Inpatient_Claims_Sample_1.csv` | same | 4.2 MB | 16.7 MB | 66,773 claim segments (66,705 claims) | one row per inpatient claim segment |
| `DE1_0_2008_to_2010_Outpatient_Claims_Sample_1.csv` | same | 34.5 MB | 161.8 MB | 790,790 segments (779,815 claims) | one row per outpatient claim segment |
| `DE1_0_2008_to_2010_Carrier_Claims_Sample_1A.csv` | downloads.cms.gov `/files/` | 113.2 MB | 1.24 GB | 2,370,667 | one row per carrier (professional) claim, up to 13 service lines in wide columns |
| `DE1_0_2008_to_2010_Carrier_Claims_Sample_1B.csv` | same | 113.3 MB | 1.24 GB | 2,370,668 | same |
| `DE1_0_codebook.pdf`, `synpuf_dug.pdf` | cms.gov | 0.8 MB, 1.0 MB | | | official codebook and data user guide |

Not downloaded: Prescription Drug Events (105 MB, drugs are outside the SIU claim-line rules). The 2010 beneficiary file for Sample 1 is not hosted by CMS at any link on the page (404), so beneficiary data covers 2008 and 2009 only; claims run 2008-01-01 to 2010-12-31 (carrier) and 2007-11-27 to 2010-12-31 (institutional).

Profile (DuckDB): carrier 1A+1B = 4.74 M claims, about 98.6 K distinct beneficiaries, 498 K distinct first-line physician NPIs per file, dates 2008-01-01..2010-12-31, about 1.76 populated service lines per claim in the first five slots (max 13). Beneficiary files carry 1,814 (2008) and 1,784 (2009) death dates. Inpatient: 2,675 institutions (PRVDR_NUM), total claim payments $639 M; outpatient: 6,294 institutions, $225 M.

## Schemas

**Beneficiary summary (32 columns):** DESYNPUF_ID, BENE_BIRTH_DT, BENE_DEATH_DT, BENE_SEX_IDENT_CD, BENE_RACE_CD, BENE_ESRD_IND, SP_STATE_CODE, BENE_COUNTY_CD, BENE_HI_CVRAGE_TOT_MONS, BENE_SMI_CVRAGE_TOT_MONS, BENE_HMO_CVRAGE_TOT_MONS, PLAN_CVRG_MOS_NUM, 11 chronic-condition flags (SP_ALZHDMTA, SP_CHF, SP_CHRNKIDN, SP_CNCR, SP_COPD, SP_DEPRESSN, SP_DIABETES, SP_ISCHMCHT, SP_OSTEOPRS, SP_RA_OA, SP_STRKETIA), annual reimbursement / beneficiary responsibility / primary-payer amounts for inpatient (MEDREIMB_IP, BENRES_IP, PPPYMT_IP), outpatient (_OP) and carrier (_CAR).

**Carrier claims (142 columns):** DESYNPUF_ID, CLM_ID, CLM_FROM_DT, CLM_THRU_DT, ICD9_DGNS_CD_1..8, then for line k = 1..13: PRF_PHYSN_NPI_k, TAX_NUM_k, HCPCS_CD_k, LINE_NCH_PMT_AMT_k, LINE_BENE_PTB_DDCTBL_AMT_k, LINE_BENE_PRMRY_PYR_PD_AMT_k, LINE_COINSRNC_AMT_k, LINE_ALOWD_CHRG_AMT_k, LINE_PRCSG_IND_CD_k, LINE_ICD9_DGNS_CD_k.

**Inpatient claims (81 columns):** DESYNPUF_ID, CLM_ID, SEGMENT, CLM_FROM_DT, CLM_THRU_DT, PRVDR_NUM, CLM_PMT_AMT, NCH_PRMRY_PYR_CLM_PD_AMT, AT_PHYSN_NPI, OP_PHYSN_NPI, OT_PHYSN_NPI, CLM_ADMSN_DT, ADMTNG_ICD9_DGNS_CD, CLM_PASS_THRU_PER_DIEM_AMT, NCH_BENE_IP_DDCTBL_AMT, NCH_BENE_PTA_COINSRNC_LBLTY_AM, NCH_BENE_BLOOD_DDCTBL_LBLTY_AM, CLM_UTLZTN_DAY_CNT, NCH_BENE_DSCHRG_DT, CLM_DRG_CD, ICD9_DGNS_CD_1..10, ICD9_PRCDR_CD_1..6, HCPCS_CD_1..45.

**Outpatient claims (76 columns):** same identifiers (DESYNPUF_ID, CLM_ID, SEGMENT, dates, PRVDR_NUM, CLM_PMT_AMT, NCH_PRMRY_PYR_CLM_PD_AMT, AT/OP/OT_PHYSN_NPI), NCH_BENE_BLOOD_DDCTBL_LBLTY_AM, ICD9_DGNS_CD_1..10, ICD9_PRCDR_CD_1..6, NCH_BENE_PTB_DDCTBL_AMT, NCH_BENE_PTB_COINSRNC_AMT, ADMTNG_ICD9_DGNS_CD, HCPCS_CD_1..45. All values are quoted strings; dates are `YYYYMMDD`; amounts are dollars.

## Mapping to the ClaimShield canonical model (`engine/sql/canonical_schema.sql`)

| ClaimShield table.column | DE-SynPUF source | Notes |
|---|---|---|
| `member.member_id` | `DESYNPUF_ID` | |
| `member.birth_year` | year of `BENE_BIRTH_DT` | |
| `member.sex` | `BENE_SEX_IDENT_CD` (1 male, 2 female) | display only |
| `member.coverage_start` | 2008-01-01 (first beneficiary file) | no enrollment dates in the data |
| `member.death_dt` | `BENE_DEATH_DT` (2008, 2009 files) | enables the date-of-death rule for 2008-2009 only |
| `member.acuity_score` | count of the 11 `SP_*` chronic flags / 11 | derived |
| `member_location.region` | `SP_STATE_CODE`, `BENE_COUNTY_CD` | no lat/lon in the data |
| `provider.provider_id`, `npi_syn` | carrier `PRF_PHYSN_NPI_k`; institutional `PRVDR_NUM` | synthetic identifiers |
| `provider.tin_syn` | carrier `TAX_NUM_k` | |
| `provider.specialty_code` | not available | peer groups would need a substitute (claim type plus dominant HCPCS family) |
| `claim.claim_id` | `CLM_ID` (carrier, inpatient, outpatient) | |
| `claim.claim_type` | CARRIER for carrier files; OUTPATIENT and INPATIENT would need adding to the enum | currently CARRIER or DME |
| `claim.billing_provider_id` / `rendering_provider_id` | `TAX_NUM_1` / `PRF_PHYSN_NPI_1`; institutional `PRVDR_NUM` / `AT_PHYSN_NPI` | |
| `claim.from_dt`, `thru_dt` | `CLM_FROM_DT`, `CLM_THRU_DT` | |
| `claim.paid_amt` | sum of `LINE_NCH_PMT_AMT_k` (carrier), `CLM_PMT_AMT` (institutional) | |
| `claim_line.hcpcs` | `HCPCS_CD_k` (carrier lines 1..13; institutional 1..45) | wide-to-long unpivot |
| `claim_line.allowed_amt`, `paid_amt` | `LINE_ALOWD_CHRG_AMT_k`, `LINE_NCH_PMT_AMT_k` | carrier only; institutional has claim-level amounts |
| `claim_line.service_dt` | `CLM_FROM_DT` | no per-line service date |
| `claim_line.units`, `billed_amt`, `pos_code` | not available | units would default to 1 |
| `inpatient_stay` | inpatient `CLM_ADMSN_DT`, `NCH_BENE_DSCHRG_DT`, `DESYNPUF_ID`, `CLM_DRG_CD` | enables the inpatient-overlap rule |
| `ref_hcpcs`, `ref_ncci_ptp`, `ref_mue`, `ref_place_of_service` | not part of DE-SynPUF | would come from the public CMS HCPCS, NCCI and MUE files |
| `owner`, `ownership`, `facility`, `provider_facility`, `provider_location`, `exclusion` | not available | no ownership, building, phone, location or exclusion data |
| `investigation` and `gt.duckdb` ground truth | not available | DE-SynPUF has no fraud labels |

## What this means for the detectors

- Works with minimal mapping: duplicate billing, date-of-death, inpatient overlap, utilization volume per beneficiary and provider, temporal patterns (CUSUM, growth), peer comparison once a peer group exists.
- Needs data DE-SynPUF lacks: impossible timing (no minutes or units), geographic anomalies (no coordinates), MUE rules (no units), unbundling rules (needs the NCCI table), the whole NETWORK channel (no ownership, buildings or referrals), specialty peers.
- No ground truth: precision, recall, decoys and the prediction labels cannot be measured on this data. The deterministic generator stays the evaluated source; DE-SynPUF is a realism and scale check (4.7 M claims) and could later be loaded as an unlabeled "scoring" dataset.



## The adapter (built)

`engine/claimshield/adapters/cms_desynpuf.py` turns the files above into the canonical model and runs the real pipeline on it.

```bash
cd engine
python -m claimshield.adapters.cms_desynpuf --raw ../data/raw/cms_desynpuf/sample1 --out ../data/cms   # ~90 s
python -c "from pathlib import Path; from claimshield.pipeline import run_pipeline; d=Path('../data/cms'); run_pipeline(regenerate=False, app_path=d/'app-cms.db', claims_path=d/'claims.duckdb', gt_path=d/'gt.duckdb')"   # ~6 min
```

Outputs in `data/cms/`: `claims.duckdb` (canonical tables plus `cms_provenance`, `cms_provider_xref`, `dataset_info`), `gt.duckdb` (labels of the overlay only), `validation.json` (integrity checks and the provenance table).

### What each field is
| Kind | Content |
|---|---|
| SOURCE | member ids, birth year, sex, death date, claim ids, HCPCS codes, allowed and paid amounts, NPIs and tax numbers (synthetic in DE-SynPUF), inpatient stays |
| DERIVED | provider specialty group (office-visit provider when office E&M codes are at least 15% of lines, else the dominant family), provider enrolment date (first line), member acuity (chronic flags / 11), place of service `11` for office E&M codes, ownership group (providers sharing a tax number), care-path link (attending physician of a facility claim for the same member in the previous 60 days) |
| TRANSFORMED | every date moved forward 15 years to fit the engine window (2024-01-01..2025-12-31); spacing preserved |
| NOT AVAILABLE | units (1), billed amount, coordinates, buildings, phone numbers, exclusions, NCCI pairs, MUE limits |
| SYNTHETIC OVERLAY | five injected scheme patterns (duplicates, services after death, upcoding, excess utilization, office visits during an inpatient stay) with labels in `gt.duckdb` only |

Derived relationships are never shown as confirmed. DE-SynPUF NPIs are heavy-tailed: only providers with at least 200 lines in 2009-2010 are kept (614 providers, 81,293 members, about 488,000 claims, 924,000 lines, 37,049 inpatient stays, 34 tax-number groups). The care-path link is rare (23 claims) because facility attending physicians are seldom among the kept providers. Referral-ring and geography rules therefore cannot fire on this data.

### Result of the run
Integrity checks all pass (`validation.json`). The pipeline produced 65,684 rule hits, 10,202 alerts and 528 cases (147 high, 381 medium confidence). Recall on the overlay: date of death 1.0, inpatient overlap 1.0, upcoding 1.0, duplicates 0.07, utilization 0. Duplicates and utilization were not found because the injected copies carry new claim ids and spread over the window and the peer rule needs a larger gap than the heavy-tailed real volumes leave; this is reported, not tuned away. These numbers measure recovery of a synthetic overlay, not real-world accuracy.
