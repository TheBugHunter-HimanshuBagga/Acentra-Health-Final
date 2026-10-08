"""Mini synthetic generator for milestone M1 (about 20k claim lines).

Everything is derived from one master seed through named child seeds, so a rebuild is reproducible.
Claim IDs are assigned AFTER injection from one sorted global counter, so injected and base claims are
indistinguishable by format. Ground truth goes to a separate DuckDB file (gt.duckdb).
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from claimshield import reference as ref
from claimshield.paths import SQL_DIR

N_MEMBERS = 300
VISIT_RATE = 2.2          # mean claims per member-month
WINDOW_DAYS = (ref.WINDOW_END - ref.WINDOW_START).days

# fixed roles so the demo cases are easy to find and test (see docs/ClaimShield_Nexus_Execution_Plan.md)
SPECIALTY_PLAN = (
    [("PRIMARY_CARE", "INDIVIDUAL")] * 14
    + [("CARDIOLOGY", "INDIVIDUAL")] * 4
    + [("PHYSICAL_THERAPY", "INDIVIDUAL")] * 4
    + [("RADIOLOGY", "INDIVIDUAL")] * 4
    + [("ORTHOPEDICS", "INDIVIDUAL")] * 4
    + [("DME_SUPPLIER", "ORGANIZATION")] * 6
    + [("CLINIC", "ORGANIZATION")] * 4
)
P = lambda n: f"P-{n:04d}"  # noqa: E731
ROLE = {
    "dup_a": P(2), "dup_b": P(15), "ptp_ecg": P(16), "ptp_inj": P(27), "mue": P(21), "dod": P(5),
    "excl": P(7), "excl_stops": P(10), "dme_mill": P(31), "dme_small": P(32), "dme_ref_a": P(3),
    "dme_ref_b": P(4), "decoy": P(28),
}
# (rule the scheme is meant to trigger, subject provider role)
SCHEMES = [
    ("SCH-DUP-01", "DUP", ROLE["dup_a"]),
    ("SCH-DUP-02", "DUP", ROLE["dup_b"]),
    ("SCH-PTP-01", "PTP", ROLE["ptp_ecg"]),
    ("SCH-PTP-02", "PTP", ROLE["ptp_inj"]),
    ("SCH-MUE-01", "MUE", ROLE["mue"]),
    ("SCH-DOD-01", "DOD", ROLE["dod"]),
    ("SCH-EXC-01", "EXC", ROLE["excl"]),
    ("SCH-DME-01", "DME", ROLE["dme_mill"]),
    ("SCH-DME-02", "DME", ROLE["dme_small"]),
]


def _rng(seed: int, name: str) -> np.random.Generator:
    h = int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big")
    return np.random.default_rng(np.random.SeedSequence(entropy=seed, spawn_key=(h,)))


@dataclass
class Line:
    service_dt: date
    hcpcs: str
    units: int = 1
    modifier1: str | None = None
    modifier2: str | None = None
    line_no: int = 0
    key: int = 0


@dataclass
class Claim:
    key: int
    claim_type: str
    member_id: str
    provider_id: str
    referring_id: str | None
    from_dt: date
    pos: str
    lines: list[Line] = field(default_factory=list)


class Builder:
    def __init__(self, seed: int):
        self.seed = seed
        self.claims: list[Claim] = []
        self._claim_key = 0
        self._line_key = 0
        # (claim_key, line_key, scheme, label, role, original value json)
        self.labels: list[tuple[int, int, str, str, str, str | None]] = []
        self.members: dict[str, dict] = {}
        self.providers: dict[str, dict] = {}
        self.exclusions: list[dict] = []
        self.visit_days: set[tuple[str, str, date]] = set()

    # -- helpers -------------------------------------------------------------------------------------------
    def new_claim(self, claim_type, member_id, provider_id, from_dt, lines, referring_id=None, pos="11"):
        self._claim_key += 1
        c = Claim(self._claim_key, claim_type, member_id, provider_id, referring_id, from_dt, pos)
        for ln in lines:
            self.add_line(c, ln)
        self.claims.append(c)
        return c

    def add_line(self, claim: Claim, line: Line) -> Line:
        self._line_key += 1
        line.key = self._line_key
        line.line_no = len(claim.lines) + 1
        claim.lines.append(line)
        return line

    def label(self, claim: Claim, line: Line, scheme: str, label: str, role: str, orig: dict | None = None):
        self.labels.append((claim.key, line.key, scheme, label, role, json.dumps(orig) if orig else None))


def _month_start(i: int) -> date:
    y = ref.WINDOW_START.year + (ref.WINDOW_START.month - 1 + i) // 12
    m = (ref.WINDOW_START.month - 1 + i) % 12 + 1
    return date(y, m, 1)


def _pick_em(r: np.random.Generator) -> str:
    return str(r.choice(["99213", "99214", "99215"], p=[0.70, 0.25, 0.05]))


def _legit_lines(spec: str, day: date, r: np.random.Generator) -> list[Line]:
    if spec == "PRIMARY_CARE":
        lines = [Line(day, _pick_em(r))]
        if r.random() < 0.15:
            lines.append(Line(day, "36415"))
            if r.random() < 0.6:
                lines.append(Line(day, "85025"))
        return lines
    if spec == "CARDIOLOGY":
        lines = [Line(day, _pick_em(r))]
        if r.random() < 0.5:
            lines.append(Line(day, "93000"))
        return lines
    if spec == "PHYSICAL_THERAPY":
        return [Line(day, "97110", units=int(r.integers(1, 4)))]
    if spec == "RADIOLOGY":
        return [Line(day, "71046", units=int(r.choice([1, 2], p=[0.6, 0.4])))]
    if spec == "ORTHOPEDICS":
        x = r.random()
        if x < 0.65:
            return [Line(day, _pick_em(r))]
        if x < 0.80:
            return [Line(day, "20610")]                       # procedure only
        return [Line(day, "99213", modifier1="25"), Line(day, "20610")]   # allowed pair (modifier 25)
    return [Line(day, _pick_em(r))]                           # CLINIC


def generate(seed: int = 20261008) -> Builder:
    b = Builder(seed)
    r_prov, r_mem, r_vis, r_dme = (_rng(seed, n) for n in ("providers", "members", "visits", "dme"))

    # ---- providers -------------------------------------------------------------------------------------
    for i, (spec, ptype) in enumerate(SPECIALTY_PLAN, start=1):
        pid = P(i)
        enroll = date(2015, 1, 1)
        if spec == "DME_SUPPLIER":
            enroll = date(2019, 1, 1) + timedelta(days=int(r_prov.integers(0, 700)))
        b.providers[pid] = dict(provider_id=pid, provider_type=ptype, name_syn=f"Synthetic {spec.title()} {i:02d}",
                                specialty_code=spec, enroll_dt=enroll, status="ACTIVE",
                                npi_syn=f"SYN{i:07d}", tin_syn=f"SYN-T-{i:04d}")
    b.providers[ROLE["excl"]]["status"] = "EXCLUDED"

    pros = [p for p, d in b.providers.items() if d["specialty_code"] in
            ("PRIMARY_CARE", "CARDIOLOGY", "PHYSICAL_THERAPY", "RADIOLOGY", "ORTHOPEDICS", "CLINIC")]
    primary_care = [p for p in pros if b.providers[p]["specialty_code"] == "PRIMARY_CARE"]
    by_spec = defaultdict(list)
    for p in pros:
        by_spec[b.providers[p]["specialty_code"]].append(p)

    # ---- members ---------------------------------------------------------------------------------------
    for i in range(1, N_MEMBERS + 1):
        mid = f"M-{i:06d}"
        b.members[mid] = dict(member_id=mid, birth_year=int(r_mem.integers(1935, 1965)),
                              sex=str(r_mem.choice(["F", "M"])), coverage_start=ref.WINDOW_START,
                              death_dt=None, acuity_score=round(float(r_mem.beta(2, 3)), 3))
    member_ids = sorted(b.members)
    dead = sorted(r_mem.choice(member_ids, size=8, replace=False).tolist())
    for mid in dead:
        b.members[mid]["death_dt"] = date(2024, 6, 1) + timedelta(days=int(r_mem.integers(0, 480)))
    primary_of = {m: str(r_mem.choice(primary_care)) for m in member_ids}
    therapy = set(r_mem.choice(member_ids, size=60, replace=False).tolist())

    # exclusions: a scheme provider (keeps billing) and one that legitimately stops billing
    excl_dt = date(2025, 3, 1)
    b.exclusions.append(dict(exclusion_id="X-0001", provider_id=ROLE["excl"], excl_type="SYNTHETIC-EXCL",
                             excl_dt=excl_dt, reinstate_dt=None))
    stop_dt = date(2025, 6, 1)
    b.exclusions.append(dict(exclusion_id="X-0002", provider_id=ROLE["excl_stops"], excl_type="SYNTHETIC-EXCL",
                             excl_dt=stop_dt, reinstate_dt=None))
    b.providers[ROLE["excl_stops"]]["status"] = "EXCLUDED"

    # ---- legitimate visits ---------------------------------------------------------------------------------
    carrier_visits: list[tuple[str, str, date]] = []   # (member, billing provider, date) for DME qualification
    for mi in range(24):
        ms = _month_start(mi)
        mdays = ((_month_start(mi + 1) if mi < 23 else date(2026, 1, 1)) - ms).days
        for mid in member_ids:
            n = int(r_vis.poisson(VISIT_RATE))
            for _ in range(n):
                roll = r_vis.random()
                if roll < 0.70:
                    prov = primary_of[mid]
                elif roll < 0.82:
                    prov = str(r_vis.choice(by_spec["CARDIOLOGY"]))
                elif roll < 0.90 and mid in therapy:
                    prov = str(r_vis.choice(by_spec["PHYSICAL_THERAPY"]))
                elif roll < 0.95:
                    prov = str(r_vis.choice(by_spec["RADIOLOGY"]))
                else:
                    prov = str(r_vis.choice(by_spec["ORTHOPEDICS"] + by_spec["CLINIC"]))
                day = ms + timedelta(days=int(r_vis.integers(0, min(mdays, 28))))
                death = b.members[mid]["death_dt"]
                if death and day > death:
                    continue
                if prov == ROLE["excl_stops"] and day >= stop_dt:
                    continue
                if (mid, prov, day) in b.visit_days:
                    continue
                b.visit_days.add((mid, prov, day))
                spec = b.providers[prov]["specialty_code"]
                b.new_claim("CARRIER", mid, prov, day, _legit_lines(spec, day, r_vis))
                carrier_visits.append((mid, prov, day))

    # ---- legitimate DME orders (each has a qualifying visit by the ordering provider) --------------------------
    legit_suppliers = [P(i) for i in range(33, 37)]
    visits_by_member = defaultdict(list)
    for mid, prov, day in carrier_visits:
        if b.providers[prov]["specialty_code"] == "PRIMARY_CARE":
            visits_by_member[mid].append((day, prov))
    ordered: set[tuple[str, str]] = set()
    cand_members = sorted(visits_by_member)
    for sup in legit_suppliers:
        for _ in range(95):
            mid = str(r_dme.choice(cand_members))
            day0, ref_prov = visits_by_member[mid][int(r_dme.integers(0, len(visits_by_member[mid])))]
            order_day = day0 + timedelta(days=int(r_dme.integers(1, 40)))
            code = str(r_dme.choice(["E0601", "E1390"]))
            death = b.members[mid]["death_dt"]
            if order_day > ref.WINDOW_END or (death and order_day > death) or (mid, code) in ordered:
                continue
            ordered.add((mid, code))
            b.new_claim("DME", mid, sup, order_day, [Line(order_day, code)], referring_id=ref_prov, pos="12")

    _inject(b, member_ids, carrier_visits, r_dme)
    return b


# ===== injection ==========================================================================================
def _inject(b: Builder, member_ids: list[str], carrier_visits, r) -> None:
    ri = {name: _rng(b.seed, "inject:" + name) for name in ("dup", "ptp", "mue", "dod", "excl", "dme", "decoy")}
    by_prov: dict[str, list[Claim]] = defaultdict(list)
    for c in b.claims:
        by_prov[c.provider_id].append(c)
    window_mid = date(2024, 12, 31)

    # DUP: exact copies of existing claims (new claim, identical member/date/code/modifiers/units)
    for scheme, prov, n in (("SCH-DUP-01", ROLE["dup_a"], 25), ("SCH-DUP-02", ROLE["dup_b"], 15)):
        pool = [c for c in by_prov[prov] if c.from_dt >= window_mid and c.claim_type == "CARRIER"]
        for idx in sorted(ri["dup"].choice(len(pool), size=min(n, len(pool)), replace=False).tolist()):
            orig = pool[idx]
            clones = [Line(x.service_dt, x.hcpcs, x.units, x.modifier1, x.modifier2) for x in orig.lines]
            copy = b.new_claim("CARRIER", orig.member_id, orig.provider_id, orig.from_dt, clones)
            for ol, cl in zip(orig.lines, copy.lines, strict=True):
                b.label(orig, ol, scheme, "CONTEXT", "ORIGINAL")
                b.label(copy, cl, scheme, "POSITIVE", "DUPLICATE_COPY")

    # PTP (a): add the tracing-only ECG line to claims that already have the full ECG (pair never allowed)
    pool = [c for c in by_prov[ROLE["ptp_ecg"]] if any(ln.hcpcs == "93000" for ln in c.lines)]
    for idx in sorted(ri["ptp"].choice(len(pool), size=min(30, len(pool)), replace=False).tolist()):
        c = pool[idx]
        ln = b.add_line(c, Line(c.from_dt, "93005"))
        b.label(c, ln, "SCH-PTP-01", "POSITIVE", "ADDED_COL2")
    # PTP (b): add an E&M line without modifier 25 to procedure-only claims (pair allowed only with a modifier)
    pool = [c for c in by_prov[ROLE["ptp_inj"]] if [ln.hcpcs for ln in c.lines] == ["20610"]]
    for idx in sorted(ri["ptp"].choice(len(pool), size=min(25, len(pool)), replace=False).tolist()):
        c = pool[idx]
        ln = b.add_line(c, Line(c.from_dt, "99213"))
        b.label(c, ln, "SCH-PTP-02", "POSITIVE", "ADDED_COL2")

    # MUE: inflate units on therapy lines well above the limit (limit is 4)
    pool = [(c, ln) for c in by_prov[ROLE["mue"]] for ln in c.lines
            if ln.hcpcs == "97110" and c.from_dt >= date(2024, 7, 1)]
    for idx in sorted(ri["mue"].choice(len(pool), size=min(30, len(pool)), replace=False).tolist()):
        c, ln = pool[idx]
        b.label(c, ln, "SCH-MUE-01", "POSITIVE", "EXCESS_UNITS", {"units": ln.units})
        ln.units = 8

    # DOD: claims billed after a member's recorded death
    dead = [m for m in member_ids if b.members[m]["death_dt"]]
    made = 0
    for m in dead:
        d0 = b.members[m]["death_dt"]
        for _ in range(3):
            day = d0 + timedelta(days=int(ri["dod"].integers(10, 90)))
            if day > ref.WINDOW_END:
                continue
            c = b.new_claim("CARRIER", m, ROLE["dod"], day, [Line(day, "99213")])
            b.label(c, c.lines[0], "SCH-DOD-01", "POSITIVE", "POST_DEATH")
            made += 1
    assert made >= 15, f"too few post-death claims generated ({made})"

    # EXCL: every line billed by the excluded provider on/after the exclusion date is a positive
    excl_dt = date(2025, 3, 1)
    for c in by_prov[ROLE["excl"]]:
        for ln in c.lines:
            if ln.service_dt >= excl_dt:
                b.label(c, ln, "SCH-EXC-01", "POSITIVE", "EXCLUDED_BILLING")

    # DME: orders by the mill and by a small supplier for members WITHOUT a qualifying visit by the ordering provider
    for scheme, sup, referrer, n, lo, hi in (
        ("SCH-DME-01", ROLE["dme_mill"], ROLE["dme_ref_a"], 40, date(2025, 2, 1), date(2025, 12, 15)),
        ("SCH-DME-02", ROLE["dme_small"], ROLE["dme_ref_b"], 3, date(2025, 4, 1), date(2025, 4, 25)),
    ):
        made, tries = 0, 0
        while made < n and tries < 5000:
            tries += 1
            m = str(ri["dme"].choice(member_ids))
            day = lo + timedelta(days=int(ri["dme"].integers(0, (hi - lo).days + 1)))
            death = b.members[m]["death_dt"]
            if death and day > death:
                continue
            if any(mm == m and pv == referrer and day - timedelta(days=ref.DME_VISIT_WINDOW_DAYS) <= dd <= day
                   for mm, pv, dd in carrier_visits_index(b, m)):
                continue
            code = str(ri["dme"].choice(["E0601", "E1390", "K0823"], p=[0.25, 0.25, 0.5]))
            c = b.new_claim("DME", m, sup, day, [Line(day, code)], referring_id=referrer, pos="12")
            b.label(c, c.lines[0], scheme, "POSITIVE", "NO_QUALIFYING_VISIT")
            made += 1
        assert made == n, f"{scheme}: only {made}/{n} orders generated"

    # Decoy D5 (must NOT alert): same-day repeat with repeat modifier 76, and units exactly at the day limit
    dec = ROLE["decoy"]
    pool = [c for c in by_prov[dec] if [ln.hcpcs for ln in c.lines] == ["20610"]]
    for idx in sorted(ri["decoy"].choice(len(pool), size=min(12, len(pool)), replace=False).tolist()):
        c = pool[idx]
        rep = b.new_claim("CARRIER", c.member_id, dec, c.from_dt, [Line(c.from_dt, "20610", modifier1="76")])
        b.label(rep, rep.lines[0], "DEC-D5-01", "DECOY_NEGATIVE", "LEGIT_REPEAT_MOD76")


def carrier_visits_index(b: Builder, member_id: str):
    """Visits (member, billing provider, date) from carrier claims of one member. Cached per builder."""
    cache = getattr(b, "_cv_cache", None)
    if cache is None:
        cache = defaultdict(list)
        for c in b.claims:
            if c.claim_type == "CARRIER":
                cache[c.member_id].append((c.member_id, c.provider_id, c.from_dt))
        b._cv_cache = cache
    return cache[member_id]


# ===== finalize: assign IDs, compute money, write DuckDB ====================================================
def _money(hcpcs: str, units: int) -> tuple[float, float, float]:
    allowed = round(ref.REFERENCE_ALLOWED[hcpcs] * units, 2)
    return round(allowed * 2.2, 2), allowed, round(allowed * 0.8, 2)


def _insert(con, table: str, rows: list, columns: list[str]) -> None:
    """Bulk insert through a DataFrame (executemany is far too slow in DuckDB)."""
    df = pd.DataFrame(rows, columns=columns)
    con.register("_ins_df", df)
    con.execute(f"INSERT INTO {table} SELECT * FROM _ins_df")
    con.unregister("_ins_df")


def write_databases(b: Builder, claims_path: Path, gt_path: Path, run_label: str = "GEN") -> dict:
    # drop claims dated after death except injected post-death ones are already present; sort deterministically
    ordered = sorted(b.claims, key=lambda c: (c.from_dt, c.member_id, c.provider_id, c.key))
    claim_id = {c.key: f"C-{i:010d}" for i, c in enumerate(ordered, start=1)}

    claim_rows, line_rows = [], []
    for c in ordered:
        paid_total = 0.0
        for ln in c.lines:
            billed, allowed, paid = _money(ln.hcpcs, ln.units)
            paid_total += paid
            line_rows.append((claim_id[c.key], ln.line_no, ln.service_dt, ln.hcpcs, ln.modifier1, ln.modifier2,
                              ln.units, billed, allowed, paid, c.provider_id, c.pos))
        claim_rows.append((claim_id[c.key], c.claim_type, c.member_id, c.provider_id, c.provider_id,
                           c.referring_id, c.from_dt, c.from_dt, c.pos, None, round(paid_total, 2)))

    for p in (claims_path, gt_path):
        for suffix in ("", ".wal"):
            Path(str(p) + suffix).unlink(missing_ok=True)
    claims_path.parent.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(str(claims_path))
    con.execute((SQL_DIR / "canonical_schema.sql").read_text(encoding="utf-8"))
    _insert(con, "ref_specialty", ref.SPECIALTIES, ["specialty_code", "name", "category"])
    _insert(con, "ref_hcpcs", ref.HCPCS,
            ["hcpcs", "short_label", "family", "em_level", "typical_minutes", "is_timed", "reference_allowed"])
    _insert(con, "ref_ncci_ptp",
            [(i, c1, c2, ind, date(2024, 1, 1), None, ref.FIXTURE_SOURCE)
             for i, (c1, c2, ind) in enumerate(ref.FIXTURE_PTP, start=1)],
            ["ptp_id", "col1_hcpcs", "col2_hcpcs", "modifier_ind", "eff_dt", "del_dt", "source_file"])
    _insert(con, "ref_mue", ref.FIXTURE_MUE, ["hcpcs", "service_type", "mue_value", "mai"])
    _insert(con, "ref_place_of_service", ref.POS, ["pos_code", "label", "is_facility"])
    _insert(con, "member",
            [(m["member_id"], m["birth_year"], m["sex"], m["coverage_start"], m["death_dt"], m["acuity_score"])
             for m in sorted(b.members.values(), key=lambda x: x["member_id"])],
            ["member_id", "birth_year", "sex", "coverage_start", "death_dt", "acuity_score"])
    _insert(con, "provider",
            [(p["provider_id"], p["provider_type"], p["name_syn"], p["specialty_code"], p["enroll_dt"],
              p["status"], p["npi_syn"], p["tin_syn"])
             for p in sorted(b.providers.values(), key=lambda x: x["provider_id"])],
            ["provider_id", "provider_type", "name_syn", "specialty_code", "enroll_dt", "status", "npi_syn", "tin_syn"])
    _insert(con, "exclusion",
            [(e["exclusion_id"], e["provider_id"], e["excl_type"], e["excl_dt"], e["reinstate_dt"])
             for e in b.exclusions],
            ["exclusion_id", "provider_id", "excl_type", "excl_dt", "reinstate_dt"])
    _insert(con, "claim", claim_rows,
            ["claim_id", "claim_type", "member_id", "billing_provider_id", "rendering_provider_id",
             "referring_provider_id", "from_dt", "thru_dt", "pos_code", "dx1", "paid_amt"])
    _insert(con, "claim_line", line_rows,
            ["claim_id", "line_no", "service_dt", "hcpcs", "modifier1", "modifier2", "units", "billed_amt",
             "allowed_amt", "paid_amt", "rendering_provider_id", "pos_code"])

    hashes = {}
    for t, order in (("member", "member_id"), ("provider", "provider_id"), ("claim", "claim_id"),
                     ("claim_line", "claim_id, line_no")):
        rows = con.execute(f"SELECT * FROM {t} ORDER BY {order}").fetchall()
        hashes[t] = hashlib.sha256(repr(rows).encode()).hexdigest()
    con.execute("INSERT INTO gen_manifest VALUES (?,?,?,?,?)",
                (run_label, b.seed, json.dumps({"n_members": N_MEMBERS, "visit_rate": VISIT_RATE}),
                 json.dumps(hashes, sort_keys=True), datetime(2026, 10, 8)))
    con.close()

    # ---- ground truth: a SEPARATE file that detectors never open --------------------------------------------
    gt = duckdb.connect(str(gt_path))
    gt.execute("""
        CREATE TABLE gt_scheme (scheme_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, scheme_type VARCHAR NOT NULL,
                                split VARCHAR NOT NULL, subject_provider_id VARCHAR);
        CREATE TABLE gt_claim_label (claim_id VARCHAR NOT NULL, line_no SMALLINT NOT NULL, scheme_id VARCHAR NOT NULL,
                                     label VARCHAR NOT NULL, role VARCHAR NOT NULL, original_value_json VARCHAR,
                                     PRIMARY KEY (claim_id, line_no, scheme_id));
        CREATE TABLE gt_provider_split (provider_id VARCHAR PRIMARY KEY, split VARCHAR NOT NULL);
    """)
    subject = {s[0]: (s[1], s[2]) for s in SCHEMES}
    scheme_ids = sorted({lab[2] for lab in b.labels})
    for sid in scheme_ids:
        if sid.startswith("DEC-"):
            gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", (sid, "DECOY", "D5", "dev", ROLE["decoy"]))
        else:
            st, prov = subject[sid]
            gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", (sid, "SCHEME", st, "dev", prov))
    line_no_of = {(c.key, ln.key): ln.line_no for c in b.claims for ln in c.lines}
    _insert(gt, "gt_claim_label",
            [(claim_id[ck], line_no_of[(ck, lk)], sid, lab, role, orig)
             for ck, lk, sid, lab, role, orig in b.labels],
            ["claim_id", "line_no", "scheme_id", "label", "role", "original_value_json"])
    _insert(gt, "gt_provider_split", [(p, "dev") for p in sorted(b.providers)], ["provider_id", "split"])
    gt.close()
    return {"claims": len(claim_rows), "lines": len(line_rows), "hashes": hashes}


def build(claims_path: Path, gt_path: Path, seed: int = 20261008) -> dict:
    return write_databases(generate(seed), claims_path, gt_path)


if __name__ == "__main__":  # pragma: no cover
    from claimshield.paths import claims_db_path, gt_db_path
    print(build(claims_db_path(), gt_db_path()))
