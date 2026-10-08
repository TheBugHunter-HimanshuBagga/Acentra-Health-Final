"""The CMS DE-SynPUF adapter on tiny files in the same format as the real ones."""
import csv
import json
from pathlib import Path

import duckdb
import pytest

from claimshield.adapters import cms_desynpuf as cms

CARRIER_COLS = ["DESYNPUF_ID", "CLM_ID", "CLM_FROM_DT"] + [
    f"{p}_{k}" for k in range(1, 14)
    for p in ("PRF_PHYSN_NPI", "TAX_NUM", "HCPCS_CD", "LINE_NCH_PMT_AMT", "LINE_ALOWD_CHRG_AMT")]
CHRONIC = cms.CHRONIC


def _write(path: Path, cols: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


@pytest.fixture()
def raw(tmp_path):
    d = tmp_path / "raw"
    d.mkdir()
    members = [f"MEM{i:03d}" for i in range(6)]
    # two providers, 12 lines each, in 2009; provider N1 shares a tax number with N2
    rows_a, rows_b, n = [], [], 0
    for npi, tax in (("N1", "T1"), ("N2", "T1")):
        for i in range(12):
            n += 1
            row = {"DESYNPUF_ID": members[i % 6], "CLM_ID": f"CL{n:04d}", "CLM_FROM_DT": f"2009{(i % 12) + 1:02d}15"}
            row.update({"PRF_PHYSN_NPI_1": npi, "TAX_NUM_1": tax, "HCPCS_CD_1": "99213" if i % 3 else "85025",
                        "LINE_NCH_PMT_AMT_1": "40.00", "LINE_ALOWD_CHRG_AMT_1": "50.00"})
            (rows_a if n % 2 else rows_b).append(row)
    rows_b.append({"DESYNPUF_ID": "MEM000", "CLM_ID": "OUT", "CLM_FROM_DT": "20070101", "PRF_PHYSN_NPI_1": "N1",
                   "TAX_NUM_1": "T1", "HCPCS_CD_1": "99213", "LINE_NCH_PMT_AMT_1": "1", "LINE_ALOWD_CHRG_AMT_1": "1"})
    _write(d / cms.CARRIER_FILES[0], CARRIER_COLS, rows_a)
    _write(d / cms.CARRIER_FILES[1], CARRIER_COLS, rows_b)
    bcols = ["DESYNPUF_ID", "BENE_BIRTH_DT", "BENE_DEATH_DT", "BENE_SEX_IDENT_CD", "SP_STATE_CODE"] + CHRONIC
    for i, f in enumerate(cms.BENE_FILES):
        _write(d / f, bcols, [{"DESYNPUF_ID": m, "BENE_BIRTH_DT": "19400101", "BENE_DEATH_DT": "20100301" if m == "MEM005" else "",
                               "BENE_SEX_IDENT_CD": "1", "SP_STATE_CODE": "5", **{c: "1" if j < 2 else "2" for j, c in enumerate(CHRONIC)}}
                              for m in members])
    icols = ["DESYNPUF_ID", "CLM_ID", "CLM_ADMSN_DT", "NCH_BENE_DSCHRG_DT", "CLM_FROM_DT", "AT_PHYSN_NPI"]
    _write(d / cms.INPATIENT_FILE, icols, [{"DESYNPUF_ID": "MEM001", "CLM_ID": "I1", "CLM_ADMSN_DT": "20090601",
                                            "NCH_BENE_DSCHRG_DT": "20090605", "CLM_FROM_DT": "20090601", "AT_PHYSN_NPI": "N2"}])
    _write(d / cms.OUTPATIENT_FILE, ["DESYNPUF_ID", "CLM_FROM_DT", "AT_PHYSN_NPI"], [])
    return d


def test_ingest_maps_and_shifts(raw, tmp_path):
    db = tmp_path / "claims.duckdb"
    cms.ingest(raw, db, min_lines=10, log=lambda *_: None)
    con = duckdb.connect(str(db), read_only=True)
    assert con.execute("SELECT count(*) FROM provider").fetchone()[0] == 2
    assert con.execute("SELECT count(*) FROM claim_line").fetchone()[0] == 24      # the 2007 line is outside the window
    lo, hi = con.execute("SELECT min(service_dt), max(service_dt) FROM claim_line").fetchone()
    assert str(lo) >= "2024-01-01" and str(hi) <= "2025-12-31"
    assert con.execute("SELECT count(*) FROM member WHERE death_dt = DATE '2025-03-01'").fetchone()[0] == 1
    assert con.execute("SELECT acuity_score FROM member LIMIT 1").fetchone()[0] == pytest.approx(2 / 11, abs=1e-3)
    assert con.execute("SELECT pos_code FROM claim_line WHERE hcpcs = '99213' LIMIT 1").fetchone()[0] == "11"
    assert con.execute("SELECT count(*) FROM claim_line WHERE hcpcs = '85025' AND pos_code IS NOT NULL").fetchone()[0] == 0


def test_shared_tax_number_is_a_derived_ownership_group(raw, tmp_path):
    db = tmp_path / "claims.duckdb"
    cms.ingest(raw, db, min_lines=10, log=lambda *_: None)
    con = duckdb.connect(str(db), read_only=True)
    assert con.execute("SELECT count(*) FROM owner").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM ownership").fetchone()[0] == 2
    kinds = {r[0] for r in con.execute("SELECT kind FROM cms_provenance WHERE table_name LIKE 'owner%'").fetchall()}
    assert kinds == {"DERIVED"}


def test_validation_report_passes_and_labels_gaps(raw, tmp_path):
    db = tmp_path / "claims.duckdb"
    cms.ingest(raw, db, min_lines=10, log=lambda *_: None)
    out = tmp_path / "validation.json"
    report = cms.validate(db, out)
    assert report["passed"] is True
    assert all(v == 0 for k, v in report["integrity"].items() if k != "providers_below_peer_minimum")
    kinds = {p["kind"] for p in report["provenance"]}
    assert {"SOURCE", "DERIVED", "TRANSFORMED", "NOT_AVAILABLE", "SYNTHETIC_OVERLAY"} <= kinds
    assert json.loads(out.read_text())["dataset"] == cms.DATASET_NAME


def test_ground_truth_never_enters_the_claims_database(raw, tmp_path):
    db = tmp_path / "claims.duckdb"
    cms.ingest(raw, db, min_lines=10, log=lambda *_: None)
    tables = {r[0] for r in duckdb.connect(str(db), read_only=True).execute("SHOW TABLES").fetchall()}
    assert not any(t.startswith("gt_") for t in tables)
