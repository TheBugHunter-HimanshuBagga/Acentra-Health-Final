"""CMS DE-SynPUF (Sample 1) -> ClaimShield canonical data, plus a clearly labelled synthetic FWA overlay.

SOURCE   data/raw/cms_desynpuf/sample1/*.csv   (CMS 2008-2010 Data Entrepreneurs' Synthetic PUF, downloaded from cms.gov)
OUTPUT   <out>/claims.duckdb   canonical schema (engine/sql/canonical_schema.sql) + cms_* provenance tables
         <out>/gt.duckdb       ground truth of the OVERLAY ONLY (DE-SynPUF itself has no fraud labels)
         <out>/validation.json data-quality and referential-integrity report

What is real, derived, transformed and absent is written into the table `cms_provenance` and the report, and is shown
to users: nothing here pretends DE-SynPUF contains ownership, locations, referrals or fraud labels.

  SOURCE        member, claim ids, dates, HCPCS codes, allowed and paid amounts, tax numbers, NPIs, inpatient stays
  DERIVED       provider specialty (dominant service family), enrolment date (first service), member acuity (chronic
                flags), office place of service (from office visit codes), referral links (attending physician of an
                earlier facility claim for the same member), ownership groups (providers sharing a tax number),
                reference allowed amounts (median allowed per code)
  TRANSFORMED   every date is moved forward by SHIFT_YEARS so the data fills the engine's fixed analysis window; the
                spacing between events is unchanged
  NOT AVAILABLE units (set to 1), billed amounts, line dates (claim date used), coordinates and buildings, phone
                numbers, exclusions, prior investigations, NCCI pairs and MUE limits (so those rules find nothing)

Providers: DE-SynPUF NPIs are synthetic and mostly appear a handful of times, so only providers with enough lines to be
analysable are kept (their complete line history within the window).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

import duckdb

from claimshield.paths import SQL_DIR

SHIFT_YEARS = 15                    # 2009-01-01 .. 2010-12-31  ->  2024-01-01 .. 2025-12-31 (the engine window)
SRC_FROM, SRC_TO = "20090101", "20101231"
DATASET_NAME = "CMS DE-SynPUF 2008-2010 Sample 1"
SPECIALTIES = [
    ("CMS_PRIMARY_OFFICE", "Office visits (derived)", "PROFESSIONAL"),
    ("CMS_HOSPITAL_EM", "Hospital and facility visits (derived)", "PROFESSIONAL"),
    ("CMS_LAB", "Laboratory (derived)", "PROFESSIONAL"),
    ("CMS_IMAGING", "Imaging (derived)", "PROFESSIONAL"),
    ("CMS_PROCEDURES", "Procedures (derived)", "PROFESSIONAL"),
    ("CMS_DME_SUPPLY", "Equipment and supplies (derived)", "SUPPLIER"),
    ("CMS_OTHER", "Other services (derived)", "PROFESSIONAL"),
]
CARRIER_FILES = ("DE1_0_2008_to_2010_Carrier_Claims_Sample_1A.csv", "DE1_0_2008_to_2010_Carrier_Claims_Sample_1B.csv")
BENE_FILES = ("DE1_0_2008_Beneficiary_Summary_File_Sample_1.csv", "DE1_0_2009_Beneficiary_Summary_File_Sample_1.csv")
INPATIENT_FILE = "DE1_0_2008_to_2010_Inpatient_Claims_Sample_1.csv"
OUTPATIENT_FILE = "DE1_0_2008_to_2010_Outpatient_Claims_Sample_1.csv"
CHRONIC = ["SP_ALZHDMTA", "SP_CHF", "SP_CHRNKIDN", "SP_CNCR", "SP_COPD", "SP_DEPRESSN", "SP_DIABETES", "SP_ISCHMCHT",
           "SP_OSTEOPRS", "SP_RA_OA", "SP_STRKETIA"]

FAMILY_SQL = """CASE
  WHEN hcpcs IN ('99201','99202','99203','99204','99205','99211','99212','99213','99214','99215') THEN 'EM_OFFICE'
  WHEN hcpcs LIKE '99%' THEN 'EM_OTHER'
  WHEN hcpcs LIKE '8%' OR hcpcs = '36415' THEN 'LAB'
  WHEN hcpcs LIKE '7%' THEN 'IMAGING'
  WHEN regexp_matches(hcpcs, '^[0-9]') THEN 'PROCEDURE'
  WHEN left(hcpcs, 1) IN ('E', 'K', 'L', 'A') THEN 'DME_SUPPLY'
  ELSE 'OTHER' END"""
SPEC_OF_FAMILY = {"EM_OFFICE": "CMS_PRIMARY_OFFICE", "EM_OTHER": "CMS_HOSPITAL_EM", "LAB": "CMS_LAB",
                  "IMAGING": "CMS_IMAGING", "PROCEDURE": "CMS_PROCEDURES", "DME_SUPPLY": "CMS_DME_SUPPLY",
                  "OTHER": "CMS_OTHER"}
EM_LEVEL = {"99201": 1, "99202": 2, "99203": 3, "99204": 4, "99205": 5, "99211": 1, "99212": 2, "99213": 3,
            "99214": 4, "99215": 5}

PROVENANCE = [
    ("member", "member_id, birth_year, sex, death_dt", "SOURCE", "Beneficiary summary files 2008 and 2009"),
    ("member", "acuity_score", "DERIVED", "Count of the 11 chronic-condition flags divided by 11"),
    ("member", "coverage_start", "DERIVED", "2008-01-01 shifted: the first beneficiary file; no enrolment dates exist"),
    ("member_location", "region", "SOURCE", "SP_STATE_CODE"),
    ("member_location", "lat, lon", "NOT_AVAILABLE", "0.0 placeholders; geographic rules cannot run on this data"),
    ("provider", "provider_id", "DERIVED", "CP-nnnnn by service volume; the source NPI is kept in npi_syn"),
    ("provider", "npi_syn, tin_syn", "SOURCE", "PRF_PHYSN_NPI and TAX_NUM (synthetic identifiers in DE-SynPUF)"),
    ("provider", "specialty_code", "DERIVED", "Office-visit provider when office E&M codes are at least 15% of its lines (about the median; DE-SynPUF NPIs show no natural specialty), "
                                              "otherwise its dominant service family; peers share the derived group"),
    ("provider", "enroll_dt", "DERIVED", "Date of the provider's first line in the data (not a real enrolment date)"),
    ("claim, claim_line", "ids, dates, hcpcs, allowed, paid", "SOURCE", "Carrier claims; the claim date is the line date"),
    ("claim_line", "units", "NOT_AVAILABLE", "Set to 1; unit-based rules (MUE) cannot run"),
    ("claim_line", "billed_amt", "NOT_AVAILABLE", "NULL"),
    ("claim_line", "pos_code", "DERIVED", "'11' (office) for office visit codes only; otherwise NULL"),
    ("claim", "referring_provider_id", "DERIVED", "Attending physician of a facility claim for the same member in the 60 "
                                                  "days before; a care-path link, NOT a confirmed referral"),
    ("owner, ownership", "groups", "DERIVED", "Providers that share a TAX_NUM form one group; not a confirmed ownership"),
    ("inpatient_stay", "admit_dt, discharge_dt", "SOURCE", "Inpatient claims"),
    ("provider_location, facility, exclusion, investigation, ref_ncci_ptp, ref_mue", "all", "NOT_AVAILABLE",
     "Not part of DE-SynPUF; tables are empty or placeholders"),
    ("all dates", "dates", "TRANSFORMED", f"Moved forward {SHIFT_YEARS} years; spacing preserved"),
    ("claims and gt.duckdb", "overlay", "SYNTHETIC_OVERLAY", "Six injected scheme patterns on selected providers so "
                                                             "detection and prediction can be evaluated; DE-SynPUF has no labels"),
]


def _csv(raw: Path, name: str) -> str:
    return f"read_csv_auto('{(raw / name).as_posix()}', header=true, all_varchar=true, sample_size=-1)"


def _d(col: str) -> str:
    return f"(strptime({col}, '%Y%m%d')::DATE + INTERVAL {SHIFT_YEARS} YEAR)::DATE"


def ingest(raw: Path, claims_path: Path, *, min_lines: int = 200, max_providers: int = 700,
           log=print) -> dict:
    """Build the canonical claims database from the raw CMS files (no overlay yet)."""
    for suffix in ("", ".wal"):
        Path(str(claims_path) + suffix).unlink(missing_ok=True)
    claims_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(claims_path))
    con.execute((SQL_DIR / "canonical_schema.sql").read_text(encoding="utf-8"))
    con.execute("SET threads TO 4")

    # ---- carrier lines (wide -> long) inside the window --------------------------------------------------------
    log("carrier: unpivot lines")
    cols = ["DESYNPUF_ID", "CLM_ID", "CLM_FROM_DT"] + [f"{p}_{k}" for k in range(1, 14) for p in (
        "PRF_PHYSN_NPI", "TAX_NUM", "HCPCS_CD", "LINE_NCH_PMT_AMT", "LINE_ALOWD_CHRG_AMT")]
    first = True
    for f in CARRIER_FILES:             # each 1.2 GB file is parsed once, keeping only the needed columns
        sel = ", ".join(cols)
        stmt = f"SELECT {sel} FROM {_csv(raw, f)} WHERE CLM_FROM_DT BETWEEN '{SRC_FROM}' AND '{SRC_TO}'"
        con.execute(("CREATE TEMP TABLE c_wide AS " if first else "INSERT INTO c_wide ") + stmt)
        first = False
        log(f"  loaded {f}")
    parts = [f"""SELECT DESYNPUF_ID AS mem, CLM_ID AS cid, {k} AS k, CLM_FROM_DT AS fdt, PRF_PHYSN_NPI_{k} AS npi,
                TAX_NUM_{k} AS tax, HCPCS_CD_{k} AS hcpcs, LINE_NCH_PMT_AMT_{k} AS paid, LINE_ALOWD_CHRG_AMT_{k} AS allowed
                FROM c_wide WHERE HCPCS_CD_{k} IS NOT NULL AND PRF_PHYSN_NPI_{k} IS NOT NULL""" for k in range(1, 14)]
    con.execute("CREATE TEMP TABLE c_all AS " + " UNION ALL ".join(parts))
    con.execute("DROP TABLE c_wide")
    con.execute(f"""CREATE TEMP TABLE c_prov AS SELECT npi, count(*) AS n FROM c_all GROUP BY npi
                    HAVING count(*) >= {min_lines} ORDER BY n DESC, npi LIMIT {max_providers}""")
    n_sel = con.execute("SELECT count(*) FROM c_prov").fetchone()[0]
    log(f"providers kept: {n_sel}")
    con.execute("""CREATE TEMP TABLE c_xref AS SELECT npi, 'CP-' || lpad(CAST(row_number() OVER (ORDER BY n DESC, npi) AS
                   VARCHAR), 5, '0') AS provider_id FROM c_prov""")
    con.execute("""CREATE TEMP TABLE c_lines AS SELECT a.*, x.provider_id AS pid FROM c_all a JOIN c_xref x USING (npi)""")
    con.execute("DROP TABLE c_all")

    # ---- reference tables --------------------------------------------------------------------------------------
    con.execute("INSERT INTO ref_specialty VALUES " + ",".join(f"('{c}','{n}','{k}')" for c, n, k in SPECIALTIES))
    codes = con.execute(f"""SELECT hcpcs, {FAMILY_SQL} AS family, median(try_cast(allowed AS DOUBLE)) AS allowed
                            FROM c_lines GROUP BY hcpcs""").fetchall()
    con.executemany("INSERT INTO ref_hcpcs VALUES (?,?,?,?,?,?,?)",
                    [(h, f"CMS code {h} ({fam.lower().replace('_', ' ')})", fam, EM_LEVEL.get(h), None, False,
                      round(max(float(a or 0.0), 1.0), 2)) for h, fam, a in codes])
    con.execute("INSERT INTO ref_place_of_service VALUES ('11','Office',false)")

    # ---- members --------------------------------------------------------------------------------------------------
    log("members")
    flags = " + ".join(f"CASE WHEN {c} = '1' THEN 1 ELSE 0 END" for c in CHANNELS_FOR(CHRONIC))
    bene = " UNION ALL ".join(f"SELECT *, {i} AS yr FROM {_csv(raw, f)}" for i, f in enumerate(BENE_FILES))
    con.execute(f"""CREATE TEMP TABLE bene AS SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY DESYNPUF_ID
                    ORDER BY yr DESC) AS rn FROM ({bene})) WHERE rn = 1""")
    con.execute(f"""INSERT INTO member SELECT 'M-' || b.DESYNPUF_ID, CAST(left(b.BENE_BIRTH_DT, 4) AS SMALLINT) + {SHIFT_YEARS},
        CASE b.BENE_SEX_IDENT_CD WHEN '1' THEN 'M' ELSE 'F' END, DATE '2024-01-01',
        CASE WHEN b.BENE_DEATH_DT IS NULL THEN NULL ELSE {_d('b.BENE_DEATH_DT')} END,
        round(({flags}) / 11.0, 4)
        FROM bene b WHERE b.DESYNPUF_ID IN (SELECT DISTINCT mem FROM c_lines)""")
    con.execute("""INSERT INTO member_location SELECT 'M-' || DESYNPUF_ID, TRY_CAST(SP_STATE_CODE AS SMALLINT), 0.0, 0.0
                   FROM bene WHERE DESYNPUF_ID IN (SELECT DISTINCT mem FROM c_lines)
                   AND TRY_CAST(SP_STATE_CODE AS SMALLINT) IS NOT NULL""")
    con.execute("""INSERT INTO member_location SELECT member_id, 0, 0.0, 0.0 FROM member
                   WHERE member_id NOT IN (SELECT member_id FROM member_location)""")
    # lines of members the beneficiary files do not describe cannot be analysed
    con.execute("DELETE FROM c_lines WHERE 'M-' || mem NOT IN (SELECT member_id FROM member)")

    # ---- providers ------------------------------------------------------------------------------------------------
    log("providers")
    fam_map = "CASE " + " ".join(f"WHEN fam = '{k}' THEN '{v}'" for k, v in SPEC_OF_FAMILY.items()) + " END"
    con.execute(f"""CREATE TEMP TABLE pfam AS SELECT pid, fam, n, row_number() OVER (PARTITION BY pid ORDER BY n DESC, fam)
                    AS rk FROM (SELECT l.pid, r.family AS fam, count(*) AS n FROM c_lines l JOIN ref_hcpcs r
                    ON r.hcpcs = l.hcpcs GROUP BY 1, 2)""")
    con.execute(f"""CREATE TEMP TABLE ptax AS SELECT pid, tax FROM (SELECT pid, tax, row_number() OVER (PARTITION BY pid
                    ORDER BY count(*) DESC, tax) AS rk FROM c_lines GROUP BY pid, tax) WHERE rk = 1""")
    con.execute(f"""INSERT INTO provider SELECT x.provider_id, 'INDIVIDUAL', 'CMS NPI ' || x.npi,
        CASE WHEN (SELECT sum(n) FILTER (WHERE fam = 'EM_OFFICE') * 1.0 / sum(n) FROM pfam f WHERE f.pid = x.provider_id) >= 0.15
             THEN 'CMS_PRIMARY_OFFICE' ELSE (SELECT {fam_map} FROM pfam f WHERE f.pid = x.provider_id AND f.rk = 1) END,
        (SELECT {_d("min(fdt)")} FROM c_lines l WHERE l.pid = x.provider_id), 'ACTIVE', x.npi,
        (SELECT tax FROM ptax t WHERE t.pid = x.provider_id) FROM c_xref x""")
    con.execute("""INSERT INTO provider_location SELECT p.provider_id, COALESCE((SELECT mode(ml.region) FROM c_lines l
        JOIN member_location ml ON ml.member_id = 'M-' || l.mem WHERE l.pid = p.provider_id), 0), 0.0, 0.0, false, NULL, NULL
        FROM provider p""")

    # ---- inpatient stays and a care-path link per carrier claim ----------------------------------------------------
    log("inpatient stays and care-path links")
    con.execute(f"""INSERT INTO inpatient_stay SELECT 'S-' || lpad(CAST(row_number() OVER (ORDER BY CLM_ID) AS VARCHAR), 6, '0'),
        'M-' || DESYNPUF_ID, {_d('CLM_ADMSN_DT')}, {_d('NCH_BENE_DSCHRG_DT')}
        FROM {_csv(raw, INPATIENT_FILE)} WHERE CLM_ADMSN_DT IS NOT NULL AND NCH_BENE_DSCHRG_DT IS NOT NULL
        AND NCH_BENE_DSCHRG_DT >= CLM_ADMSN_DT AND 'M-' || DESYNPUF_ID IN (SELECT member_id FROM member)
        AND CLM_ADMSN_DT BETWEEN '{SRC_FROM}' AND '{SRC_TO}'""")
    fac = (f"SELECT DESYNPUF_ID AS mem, CLM_FROM_DT AS fdt, AT_PHYSN_NPI AS att FROM {_csv(raw, OUTPATIENT_FILE)} "
           f"WHERE AT_PHYSN_NPI IS NOT NULL AND CLM_FROM_DT BETWEEN '20081101' AND '{SRC_TO}' UNION ALL "
           f"SELECT DESYNPUF_ID, CLM_FROM_DT, AT_PHYSN_NPI FROM {_csv(raw, INPATIENT_FILE)} WHERE AT_PHYSN_NPI IS NOT NULL "
           f"AND CLM_FROM_DT BETWEEN '20081101' AND '{SRC_TO}'")
    con.execute(f"""CREATE TEMP TABLE fac AS SELECT f.mem, strptime(f.fdt, '%Y%m%d')::DATE AS fdt, x.provider_id AS att
                    FROM ({fac}) f JOIN c_xref x ON x.npi = f.att""")

    # ---- claims and lines ------------------------------------------------------------------------------------------
    log("claims and lines")
    con.execute("""CREATE TEMP TABLE c_first AS SELECT cid, mem, min(fdt) AS fdt,
        arg_min(pid, k) AS first_pid, arg_min(tax, k) AS tax FROM c_lines GROUP BY cid, mem""")
    con.execute(f"""CREATE TEMP TABLE c_ref AS SELECT c.cid, arg_max(f.att, f.fdt) AS ref_pid
        FROM c_first c JOIN fac f ON f.mem = c.mem AND f.fdt < strptime(c.fdt, '%Y%m%d')::DATE
        AND f.fdt >= strptime(c.fdt, '%Y%m%d')::DATE - INTERVAL 60 DAY GROUP BY c.cid""")
    con.execute(f"""INSERT INTO claim SELECT 'C-' || c.cid, 'CARRIER', 'M-' || c.mem, c.first_pid, c.first_pid,
        CASE WHEN r.ref_pid = c.first_pid THEN NULL ELSE r.ref_pid END, {_d('c.fdt')}, {_d('c.fdt')},
        CASE WHEN EXISTS (SELECT 1 FROM c_lines l WHERE l.cid = c.cid AND l.hcpcs IN ('99201','99202','99203','99204','99205','99211','99212','99213','99214','99215')) THEN '11' END, NULL,
        round(coalesce((SELECT sum(try_cast(l.paid AS DOUBLE)) FROM c_lines l WHERE l.cid = c.cid), 0), 2)
        FROM c_first c LEFT JOIN c_ref r USING (cid)""")
    con.execute(f"""INSERT INTO claim_line SELECT 'C-' || cid, k, {_d('fdt')}, hcpcs, NULL, NULL, 1, NULL,
        greatest(coalesce(try_cast(allowed AS DOUBLE), 0), 0), greatest(coalesce(try_cast(paid AS DOUBLE), 0), 0), pid,
        CASE WHEN hcpcs IN ('99201','99202','99203','99204','99205','99211','99212','99213','99214','99215')
             THEN '11' END FROM c_lines""")

    # ---- derived relationships ---------------------------------------------------------------------------------------
    log("ownership groups")
    con.execute("""INSERT INTO owner SELECT 'OWN-T' || substr(md5(tin_syn), 1, 8), 'Tax-number group ' || substr(md5(tin_syn), 1, 6)
                   FROM provider GROUP BY tin_syn HAVING count(*) >= 2""")
    con.execute("""INSERT INTO ownership SELECT p.provider_id, 'OWN-T' || substr(md5(p.tin_syn), 1, 8), true, 1.0
                   FROM provider p WHERE p.tin_syn IN (SELECT tin_syn FROM provider GROUP BY tin_syn HAVING count(*) >= 2)""")
    con.execute("DROP TABLE IF EXISTS c_prov")
    h = {}
    for t, order in (("member", "member_id"), ("provider", "provider_id"), ("claim", "claim_id"),
                     ("claim_line", "claim_id, line_no")):
        h[t] = hashlib.sha256(repr(con.execute(f"SELECT * FROM {t} ORDER BY {order}").fetchall()).encode()).hexdigest()
    con.execute("INSERT INTO gen_manifest VALUES ('CMS', 0, ?, ?, ?)",
                [json.dumps({"dataset": DATASET_NAME, "min_lines": min_lines, "max_providers": max_providers,
                             "shiftYears": SHIFT_YEARS}), json.dumps(h, sort_keys=True), datetime(2026, 10, 8)])
    con.execute("CREATE TABLE cms_provenance (table_name VARCHAR, fields VARCHAR, kind VARCHAR, note VARCHAR)")
    con.executemany("INSERT INTO cms_provenance VALUES (?,?,?,?)", PROVENANCE)
    con.execute("""CREATE TABLE cms_provider_xref AS SELECT x.provider_id, x.npi AS source_npi FROM c_xref x""")
    con.close()
    return {"providers": n_sel}


def CHANNELS_FOR(cols: list[str]) -> list[str]:        # kept as a function so the flag list stays in one place
    return cols


# ----------------------------------------------------------------------------------------------------- overlay
SCHEMES = [
    # (scheme_id, scheme_type, rule that should find it)
    ("OV-DUP", "DUP", "duplicate submissions"),
    ("OV-DOD", "DOD", "services after a recorded death"),
    ("OV-UPC", "UPC", "visit levels above peers"),
    ("OV-UTL", "UTL", "more lines per member than peers"),
    ("OV-PHB", "PHB", "office services during an inpatient stay"),
]


def overlay(claims_path: Path, gt_path: Path, seed: int = 20261008, log=print) -> dict:
    """Inject five labelled patterns on providers chosen by a hash, and write ONLY their labels to gt.duckdb."""
    for suffix in ("", ".wal"):
        Path(str(gt_path) + suffix).unlink(missing_ok=True)
    con = duckdb.connect(str(claims_path))

    def rank(sql: str, n: int) -> list[str]:
        return [r[0] for r in con.execute(sql).fetchall()][:n]

    def pick(pool: list[str], tag: str) -> str:
        return sorted(pool, key=lambda p: hashlib.sha256(f"{seed}{tag}{p}".encode()).hexdigest())[0]

    office = rank("""SELECT p.provider_id FROM provider p JOIN claim_line l ON l.rendering_provider_id = p.provider_id
        WHERE p.specialty_code = 'CMS_PRIMARY_OFFICE' AND l.hcpcs = '99213' GROUP BY 1 HAVING count(*) >= 150
        ORDER BY count(*) DESC""", 60)
    anyp = rank("SELECT provider_id FROM provider ORDER BY provider_id", 400)
    chosen = {"OV-DUP": pick(anyp, "dup"), "OV-DOD": pick(anyp[10:], "pha"), "OV-UPC": pick(office[5:], "upc"),
              "OV-UTL": pick(office[10:], "utl"), "OV-PHB": pick(anyp[20:], "phb")}
    labels: list[tuple] = []
    nxt = [con.execute("SELECT count(*) FROM claim").fetchone()[0] + 10_000_001]

    def new_claim(member: str, pid: str, dt, hcpcs: str, scheme: str, role: str, orig: str | None = None) -> None:
        cid = f"C-{nxt[0]}"
        nxt[0] += 1
        allowed = con.execute("SELECT reference_allowed FROM ref_hcpcs WHERE hcpcs = ?", [hcpcs]).fetchone()[0]
        pos = "11" if hcpcs in EM_LEVEL else None
        con.execute("INSERT INTO claim VALUES (?,?,?,?,?,NULL,?,?,?,NULL,?)",
                    [cid, "CARRIER", member, pid, pid, dt, dt, pos, allowed])
        con.execute("INSERT INTO claim_line VALUES (?,?,?,?,NULL,NULL,1,NULL,?,?,?,?)",
                    [cid, 1, dt, hcpcs, allowed, allowed, pid, pos])
        labels.append((cid, 1, scheme, "POSITIVE", role, orig))

    # DUP: copies of 60 of the provider's own lines (same member, date, code)
    pid = chosen["OV-DUP"]
    for member, dt, hcpcs in con.execute("""SELECT c.member_id, l.service_dt, l.hcpcs FROM claim_line l JOIN claim c USING (claim_id)
            WHERE l.rendering_provider_id = ? ORDER BY l.claim_id LIMIT 60""", [pid]).fetchall():
        new_claim(member, pid, dt, hcpcs, "OV-DUP", "duplicate")
    # PHA: services dated 10-70 days after a recorded death
    pid = chosen["OV-DOD"]
    dead = con.execute("SELECT member_id, death_dt FROM member WHERE death_dt IS NOT NULL ORDER BY member_id LIMIT 25").fetchall()
    for i, (member, dd) in enumerate(dead):
        for j in range(2):
            dt = con.execute("SELECT (?::DATE + ? * INTERVAL 1 DAY)::DATE", [dd, 10 + i + 5 * j]).fetchone()[0]
            if dt <= con.execute("SELECT DATE '2025-12-31'").fetchone()[0]:
                new_claim(member, pid, dt, "99213", "OV-DOD", "post_death")
    # UPC: relabel 70% of the provider's level-3 visits as level 5 (the original code is stored in gt)
    pid = chosen["OV-UPC"]
    rows = con.execute("SELECT claim_id, line_no FROM claim_line WHERE rendering_provider_id = ? AND hcpcs = '99213' "
                       "ORDER BY claim_id", [pid]).fetchall()
    allowed5 = con.execute("SELECT reference_allowed FROM ref_hcpcs WHERE hcpcs = '99215'").fetchone()[0]
    for cid, ln in rows[: int(len(rows) * 0.7)]:
        con.execute("UPDATE claim_line SET hcpcs = '99215', allowed_amt = ?, paid_amt = ? WHERE claim_id = ? AND line_no = ?",
                    [allowed5, allowed5, cid, ln])
        con.execute("UPDATE claim SET paid_amt = (SELECT sum(paid_amt) FROM claim_line WHERE claim_id = ?) WHERE claim_id = ?", [cid, cid])
        labels.append((cid, ln, "OV-UPC", "POSITIVE", "upcoded", json.dumps({"hcpcs": "99213"})))
    # UTL: eight extra visits for each of 40 of the provider's members, spread over the window
    pid = chosen["OV-UTL"]
    members = [r[0] for r in con.execute("""SELECT DISTINCT c.member_id FROM claim c WHERE c.rendering_provider_id = ?
                                            ORDER BY 1 LIMIT 40""", [pid]).fetchall()]
    for i, member in enumerate(members):
        for j in range(8):
            dt = con.execute("SELECT (DATE '2025-03-01' + ? * INTERVAL 1 DAY)::DATE", [(i * 7 + j * 31) % 300]).fetchone()[0]
            new_claim(member, pid, dt, "99213", "OV-UTL", "excess_visit")
    # PHB: office visits dated inside a member's inpatient stay
    pid = chosen["OV-PHB"]
    for member, adm in con.execute("""SELECT member_id, admit_dt + INTERVAL 1 DAY FROM inpatient_stay
            WHERE discharge_dt > admit_dt + INTERVAL 2 DAY ORDER BY stay_id LIMIT 30""").fetchall():
        new_claim(member, pid, adm, "99213", "OV-PHB", "during_stay")

    con.close()
    gt = duckdb.connect(str(gt_path))
    gt.execute("""
        CREATE TABLE gt_scheme (scheme_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, scheme_type VARCHAR NOT NULL,
                                split VARCHAR NOT NULL, subject_provider_id VARCHAR);
        CREATE TABLE gt_claim_label (claim_id VARCHAR NOT NULL, line_no SMALLINT NOT NULL, scheme_id VARCHAR NOT NULL,
                                     label VARCHAR NOT NULL, role VARCHAR NOT NULL, original_value_json VARCHAR,
                                     PRIMARY KEY (claim_id, line_no, scheme_id));
        CREATE TABLE gt_provider_split (provider_id VARCHAR PRIMARY KEY, split VARCHAR NOT NULL);
        CREATE TABLE gt_decoy_provider (scheme_id VARCHAR NOT NULL, provider_id VARCHAR NOT NULL,
                                        PRIMARY KEY (scheme_id, provider_id));
    """)
    for sid, st, _what in SCHEMES:
        gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", [sid, "SCHEME", st, "dev", chosen[sid]])
    gt.executemany("INSERT INTO gt_claim_label VALUES (?,?,?,?,?,?)", labels)
    con = duckdb.connect(str(claims_path), read_only=True)
    every = [r[0] for r in con.execute("SELECT provider_id FROM provider ORDER BY provider_id").fetchall()]
    con.close()

    def split_of(p: str) -> str:
        v = int.from_bytes(hashlib.sha256(p.encode()).digest()[:4], "big") % 100
        return "train" if v < 50 else "val" if v < 70 else "test"

    forced = {chosen["OV-DUP"]: "train", chosen["OV-DOD"]: "train", chosen["OV-UPC"]: "val", chosen["OV-UTL"]: "test",
              chosen["OV-PHB"]: "test"}
    gt.executemany("INSERT INTO gt_provider_split VALUES (?,?)", [(p, forced.get(p, split_of(p))) for p in every])
    gt.close()
    return {"schemes": {sid: chosen[sid] for sid, _s, _w in SCHEMES}, "positiveLines": len(labels)}


# ----------------------------------------------------------------------------------------------------- validation
def validate(claims_path: Path, out: Path | None = None) -> dict:
    con = duckdb.connect(str(claims_path), read_only=True)
    q = lambda s: con.execute(s).fetchone()[0]  # noqa: E731
    checks = {
        "claim_lines_without_claim": q("SELECT count(*) FROM claim_line l LEFT JOIN claim c USING (claim_id) WHERE c.claim_id IS NULL"),
        "claims_without_member": q("SELECT count(*) FROM claim c LEFT JOIN member m USING (member_id) WHERE m.member_id IS NULL"),
        "claims_without_provider": q("SELECT count(*) FROM claim c LEFT JOIN provider p ON p.provider_id = c.billing_provider_id WHERE p.provider_id IS NULL"),
        "lines_without_provider": q("SELECT count(*) FROM claim_line l LEFT JOIN provider p ON p.provider_id = l.rendering_provider_id WHERE p.provider_id IS NULL"),
        "referrals_without_provider": q("SELECT count(*) FROM claim c WHERE c.referring_provider_id IS NOT NULL AND c.referring_provider_id NOT IN (SELECT provider_id FROM provider)"),
        "thru_before_from": q("SELECT count(*) FROM claim WHERE thru_dt < from_dt"),
        "lines_with_negative_paid": q("SELECT count(*) FROM claim_line WHERE paid_amt < 0"),
        "claims_with_no_lines": q("SELECT count(*) FROM claim c WHERE NOT EXISTS (SELECT 1 FROM claim_line l WHERE l.claim_id = c.claim_id)"),
        "claim_total_differs_from_lines": q("""SELECT count(*) FROM claim c JOIN (SELECT claim_id, sum(paid_amt) s FROM claim_line GROUP BY 1) l USING (claim_id)
                                               WHERE abs(c.paid_amt - l.s) > 0.01"""),
        "providers_below_peer_minimum": q("SELECT count(*) FROM (SELECT specialty_code FROM provider GROUP BY 1 HAVING count(*) < 5)"),
    }
    report = {
        "dataset": DATASET_NAME, "dateRange": [str(r) for r in con.execute("SELECT min(service_dt), max(service_dt) FROM claim_line").fetchone()],
        "counts": {t: q(f"SELECT count(*) FROM {t}") for t in ("member", "provider", "claim", "claim_line", "inpatient_stay", "owner", "ownership", "ref_hcpcs")},
        "claimsWithCarePathLink": q("SELECT count(*) FROM claim WHERE referring_provider_id IS NOT NULL"),
        "membersWithDeathDate": q("SELECT count(*) FROM member WHERE death_dt IS NOT NULL"),
        "specialties": dict(con.execute("SELECT specialty_code, count(*) FROM provider GROUP BY 1 ORDER BY 2 DESC").fetchall()),
        "integrity": checks, "passed": all(v == 0 for k, v in checks.items() if k != "providers_below_peer_minimum"),
        "provenance": [dict(zip(("table", "fields", "kind", "note"), r)) for r in con.execute("SELECT * FROM cms_provenance").fetchall()],
    }
    con.close()
    if out:
        out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def build(raw: Path, out_dir: Path, *, min_lines: int = 200, max_providers: int = 700, log=print) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    claims, gt = out_dir / "claims.duckdb", out_dir / "gt.duckdb"
    info = ingest(raw, claims, min_lines=min_lines, max_providers=max_providers, log=log)
    log("overlay")
    ov = overlay(claims, gt, log=log)
    con = duckdb.connect(str(claims))
    con.execute("CREATE TABLE dataset_info (info_json VARCHAR)")
    con.execute("INSERT INTO dataset_info VALUES (?)", [json.dumps({
        "kind": "CMS_DESYNPUF_WITH_OVERLAY", "source": DATASET_NAME + " plus a synthetic FWA overlay",
        "dateShiftYears": SHIFT_YEARS,
        "note": "Real-shaped synthetic Medicare claims from CMS. Referral and ownership links are derived (care-path "
                "and shared tax number), geography is not available, and the labelled patterns are injected."})])
    con.close()
    report = validate(claims, out_dir / "validation.json")
    return {**info, **ov, "validation": {"passed": report["passed"], "counts": report["counts"]}}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build the CMS DE-SynPUF based ClaimShield dataset")
    ap.add_argument("--raw", default="data/raw/cms_desynpuf/sample1")
    ap.add_argument("--out", default="data/cms")
    ap.add_argument("--min-lines", type=int, default=200)
    ap.add_argument("--max-providers", type=int, default=700)
    a = ap.parse_args()
    print(json.dumps(build(Path(a.raw), Path(a.out), min_lines=a.min_lines, max_providers=a.max_providers), indent=2,
                     default=str))
