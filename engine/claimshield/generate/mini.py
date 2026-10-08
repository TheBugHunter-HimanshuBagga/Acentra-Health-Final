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

N_MEMBERS = 360
N_GHOST = 30
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
    # M2 additions (P-0041..P-0061): extra peers and the new scheme / decoy providers
    + [("PRIMARY_CARE", "INDIVIDUAL")] * 12
    + [("CARDIOLOGY", "INDIVIDUAL")] * 4
    + [("RADIOLOGY", "INDIVIDUAL")] * 3
    + [("CLINIC", "ORGANIZATION")] * 2
    # M3: the four practices of the referral ring (one control owner, patients passed around in a cycle)
    + [("ORTHOPEDICS", "INDIVIDUAL")] * 4
)
P = lambda n: f"P-{n:04d}"  # noqa: E731
ROLE = {
    "dup_a": P(2), "dup_b": P(15), "ptp_ecg": P(16), "ptp_inj": P(27), "mue": P(21), "dod": P(5),
    "excl": P(7), "excl_stops": P(10), "dme_mill": P(31), "dme_small": P(32), "dme_ref_a": P(3),
    "dme_ref_b": P(4), "decoy": P(28),
    "upc_a": P(41), "upc_b": P(42), "tma": P(43), "phc": P(44), "utl": P(45), "d1": P(46),
    "d4": P(53), "d3": P(59), "tmb": P(60), "phb": P(61),
    "d1b": P(47),
}
# decoy providers D1-D4 (provider-level ground truth; D5 stays line-level). D2 = two multi-tenant buildings.
DECOY_PROVIDERS = [
    ("DEC-D1-01", "D1", [ROLE["d1"]]),
    ("DEC-D1-02", "D1", [ROLE["d1b"]]),
    ("DEC-D2-01", "D2", [P(n) for n in (37, 38, 39, 40)]),
    ("DEC-D2-02", "D2", [P(n) for n in (23, 24, 25, 26)]),
    ("DEC-D3-01", "D3", [ROLE["d3"]]),
    ("DEC-D4-01", "D4", [ROLE["d4"]]),
]
REGION_CENTER = [(40.0, -75.0), (40.0, -73.0), (39.0, -76.5)]
REMOTE_CENTER = (38.0, -77.2)         # the sole rural provider of decoy D3, region 3
REMOTE_REGION = 3
RING = [P(n) for n in (62, 63, 64, 65)]
UPC_START = {"SCH-UPC-01": date(2024, 9, 1), "SCH-UPC-02": date(2025, 3, 1)}
DUP_START = {"SCH-DUP-01": date(2024, 7, 1), "SCH-DUP-03": date(2025, 2, 1), "SCH-DUP-04": date(2025, 1, 1)}
# train / validation / test providers for every scheme and decoy instance (others are hashed 50/20/30)
SPLIT_OF = {P(2): "train", P(41): "train", P(45): "train", P(44): "train", P(21): "train", P(16): "train",
            P(5): "train", P(46): "train", P(37): "train", P(38): "train", P(39): "train", P(40): "train",
            P(15): "val", P(27): "val", P(43): "val", P(7): "val", P(53): "val", P(3): "val", P(4): "val",
            P(42): "test", P(60): "test", P(61): "test", P(31): "test", P(32): "test", P(59): "test",
            P(23): "test", P(24): "test", P(25): "test", P(26): "test", **{p: "test" for p in RING}}
# prior investigations (history, closed before the as-of date): provider, scheme, opened, closed, disposition, reason
PRIOR_INVESTIGATIONS = [
    (P(8), "DUP", date(2024, 1, 15), date(2024, 3, 20), "EDUCATION", "NEEDS_RECORDS", 2400.0, 0.0),
    (P(9), "UPC", date(2024, 2, 1), date(2024, 5, 10), "CONFIRMED", "CONFIRMED_PATTERN", 18000.0, 9000.0),
    (P(47), "UTL", date(2024, 2, 20), date(2024, 6, 1), "UNFOUNDED", "LEGIT_CLINICAL_PATTERN", 9000.0, 0.0),
    (P(17), "UPC", date(2024, 3, 5), date(2024, 7, 12), "UNFOUNDED", "LEGIT_HIGH_ACUITY", 6000.0, 0.0),
    (P(20), "EXU", date(2024, 3, 25), date(2024, 8, 2), "EDUCATION", "NEEDS_RECORDS", 3100.0, 400.0),
    (P(24), "UNB", date(2024, 4, 14), date(2024, 8, 30), "CONFIRMED", "CONFIRMED_PATTERN", 5200.0, 5200.0),
    (P(34), "DME", date(2024, 5, 2), date(2024, 10, 9), "INSUFFICIENT", "DATA_ERROR", 12000.0, 0.0),
    (P(36), "DME", date(2024, 6, 3), date(2024, 11, 18), "CONFIRMED", "CONFIRMED_PATTERN", 21000.0, 14000.0),
    (P(38), "PHB", date(2024, 7, 9), date(2024, 12, 4), "UNFOUNDED", "LEGIT_SHARED_BUILDING", 2000.0, 0.0),
    (P(40), "UTL", date(2024, 8, 21), date(2025, 2, 27), "UNFOUNDED", "LEGIT_CLINICAL_PATTERN", 7600.0, 0.0),
]
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
    ("SCH-DUP-03", "DUP", ROLE["upc_a"]),
    ("SCH-DUP-04", "DUP", ROLE["utl"]),
    ("SCH-UPC-01", "UPC", ROLE["upc_a"]),
    ("SCH-UPC-02", "UPC", ROLE["upc_b"]),
    ("SCH-TMA-01", "TMA", ROLE["tma"]),
    ("SCH-PHC-01", "PHC", ROLE["phc"]),
    ("SCH-UTL-01", "UTL", ROLE["utl"]),
    ("SCH-TMB-01", "TMB", ROLE["tmb"]),
    ("SCH-PHB-01", "PHB", ROLE["phb"]),
    ("SCH-RNG-01", "RNG", RING[0]),
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
        self.prov_region: dict[str, int] = {}
        self.prov_loc: dict[str, dict] = {}
        self.mem_loc: dict[str, dict] = {}
        self.stays: dict[str, list[tuple[date, date]]] = {}
        self.ghosts: list[str] = []
        self.day_region: dict[tuple[str, date], int] = {}
        self.primary_of: dict[str, str] = {}
        self.owners: dict[str, str] = {}
        self.ownership: list[tuple[str, str, bool, float]] = []
        self.facilities: list[tuple[str, str, str | None]] = []
        self.prov_fac: list[tuple[str, str]] = []

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


def _pick_em(r: np.random.Generator, acuity: float = 0.4) -> str:
    """Visit level depends on member acuity: sicker members legitimately need higher levels."""
    hi = float(np.clip(0.06 + 0.6 * acuity + 1.6 * max(0.0, acuity - 0.5), 0.05, 0.85))
    return str(r.choice(["99213", "99214", "99215"], p=[1 - hi, 0.7 * hi, 0.3 * hi]))


def _legit_lines(spec: str, day: date, r: np.random.Generator, acuity: float = 0.4) -> list[Line]:
    if spec == "PRIMARY_CARE":
        lines = [Line(day, _pick_em(r, acuity))]
        if r.random() < 0.15:
            lines.append(Line(day, "36415"))
            if r.random() < 0.6:
                lines.append(Line(day, "85025"))
        return lines
    if spec == "CARDIOLOGY":
        lines = [Line(day, _pick_em(r, acuity))]
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
            return [Line(day, _pick_em(r, acuity))]
        if x < 0.80:
            return [Line(day, "20610")]                       # procedure only
        return [Line(day, "99213", modifier1="25"), Line(day, "20610")]   # allowed pair (modifier 25)
    return [Line(day, _pick_em(r, acuity))]                           # CLINIC


def _in_stay(b: Builder, mid: str, day: date) -> bool:
    return any(a < day < d for a, d in b.stays.get(mid, ()))


def _region_ok(b: Builder, mid: str, prov: str, day: date) -> bool:
    """A member cannot be in two regions on one date; records the region when free."""
    have = b.day_region.get((mid, day))
    if have is not None and have != b.prov_region[prov]:
        return False
    b.day_region[(mid, day)] = b.prov_region[prov]
    return True


def generate(seed: int = 20261008) -> Builder:
    b = Builder(seed)
    r_prov, r_mem, r_vis, r_dme = (_rng(seed, n) for n in ("providers", "members", "visits", "dme"))
    r_geo, r_stay, r_ghost, r_ref = (_rng(seed, n) for n in ("geo", "stays", "ghost", "refs"))

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
    b.providers[ROLE["dme_mill"]]["enroll_dt"] = date(2025, 1, 15)

    # ---- ownership and facilities: one control owner per provider, except the ring; investors hold small stakes
    for pid in b.providers:
        oid = "OWN-RING" if pid in RING else f"OWN-{int(pid[2:]):04d}"
        b.owners.setdefault(oid, "Synthetic Ring Holdings" if pid in RING else f"Synthetic Owner {int(pid[2:]):04d}")
        b.ownership.append((pid, oid, True, 1.0))
    d2 = [g[2] for g in DECOY_PROVIDERS if g[1] == "D2"]
    plain = [p for p in sorted(b.providers) if p not in RING and p not in d2[0] and p not in d2[1]]
    picks = [str(x) for x in r_geo.choice(plain, size=9, replace=False)]
    for k in range(3):
        oid = f"OWN-INV{k + 1}"
        b.owners[oid] = f"Synthetic Investor {k + 1}"
        for pid in picks[k * 3:(k + 1) * 3]:
            b.ownership.append((pid, oid, False, 0.2))        # a minority stake does not link providers
    hosp = [str(x) for x in r_geo.choice(plain, size=12, replace=False)]
    for k in range(6):
        fid = f"F-{k + 1:04d}"
        b.facilities.append((fid, f"Synthetic Facility {k + 1}", f"FB-{k + 1:03d}"))
        for pid in hosp[k * 2:(k + 1) * 2]:
            b.prov_fac.append((pid, fid))

    # ---- locations: three regions, the decoy D3 provider sits alone in a remote fourth place ----------------
    buildings = {p: ("B-001", "SYN-PHN-001") for p in d2[0]}
    buildings.update({p: ("B-002", "SYN-PHN-002") for p in d2[1]})
    for pid in b.providers:
        n = int(pid[2:])
        if pid == ROLE["d3"]:
            region, (clat, clon), rural = REMOTE_REGION, REMOTE_CENTER, True
        else:
            region, (clat, clon), rural = n % 3, REGION_CENTER[n % 3], n % 3 == 2
        b.prov_region[pid] = region
        bld, phone = buildings.get(pid, (None, f"SYN-PHN-{100 + n:03d}"))
        b.prov_loc[pid] = dict(provider_id=pid, region=region, lat=round(clat + float(r_geo.normal(0, 0.03)), 5),
                               lon=round(clon + float(r_geo.normal(0, 0.03)), 5), is_rural=rural,
                               building_id=bld, phone_syn=phone)

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
    # ghost members: enrolled, but no provider other than the phantom-billing one ever sees them
    for i in range(1, N_GHOST + 1):
        gid = f"M-{N_MEMBERS + i:06d}"
        b.members[gid] = dict(member_id=gid, birth_year=int(r_ghost.integers(1935, 1965)),
                              sex=str(r_ghost.choice(["F", "M"])), coverage_start=ref.WINDOW_START,
                              death_dt=date(2025, 2, 1) if i <= 6 else None,
                              acuity_score=round(float(r_ghost.beta(2, 3)), 3))
        b.ghosts.append(gid)
    for mid in sorted(b.members):
        reg = int(r_geo.integers(0, 3))
        clat, clon = REGION_CENTER[reg]
        b.mem_loc[mid] = dict(member_id=mid, region=reg, lat=round(clat + float(r_geo.normal(0, 0.05)), 5),
                              lon=round(clon + float(r_geo.normal(0, 0.05)), 5))

    for gid in b.ghosts:
        b.mem_loc[gid]["region"] = b.prov_region[ROLE["phc"]]
        b.mem_loc[gid]["lat"], b.mem_loc[gid]["lon"] = (
            round(REGION_CENTER[b.prov_region[ROLE["phc"]]][0] + float(r_geo.normal(0, 0.05)), 5),
            round(REGION_CENTER[b.prov_region[ROLE["phc"]]][1] + float(r_geo.normal(0, 0.05)), 5))

    def pick(cands: list[str], mid: str, r: np.random.Generator) -> str:
        """Mostly a provider in the member's own region, sometimes any."""
        local = [p for p in cands if b.prov_region[p] == b.mem_loc[mid]["region"]]
        pool = local if local and r.random() < 0.9 else cands
        return str(r.choice(pool))

    primary_of = {m: pick(primary_care, m, r_mem) for m in member_ids}
    b.primary_of = primary_of
    therapy = set(r_mem.choice(member_ids, size=60, replace=False).tolist())
    # decoy D4: a cardiology panel made of the sickest members (their higher visit levels are legitimate)
    d4_region = [m for m in member_ids if b.mem_loc[m]["region"] == b.prov_region[ROLE["d4"]]]
    d4_panel = set(sorted(d4_region, key=lambda m: (-b.members[m]["acuity_score"], m))[:30])
    other_cardio = [p for p in by_spec["CARDIOLOGY"] if p != ROLE["d4"]]

    # legitimate inpatient stays (members are not seen in an office during them)
    alive = [m for m in member_ids if not b.members[m]["death_dt"]]
    for mid in sorted(r_stay.choice(alive, size=28, replace=False).tolist()):
        admit = date(2024, 3, 1) + timedelta(days=int(r_stay.integers(0, 600)))
        b.stays.setdefault(mid, []).append((admit, admit + timedelta(days=int(r_stay.integers(4, 10)))))

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
                if mid in d4_panel and roll < 0.45:
                    prov = ROLE["d4"]
                elif roll < 0.70:
                    prov = primary_of[mid]
                elif roll < 0.82:
                    prov = ROLE["d4"] if mid in d4_panel else pick(other_cardio, mid, r_vis)
                elif roll < 0.90 and mid in therapy:
                    prov = pick(by_spec["PHYSICAL_THERAPY"], mid, r_vis)
                elif roll < 0.95:
                    if b.mem_loc[mid]["region"] == 2 and r_vis.random() < 0.7:
                        prov = ROLE["d3"]          # the only radiologist anywhere near the rural county
                    else:
                        prov = pick([p for p in by_spec["RADIOLOGY"] if p != ROLE["d3"]], mid, r_vis)
                else:
                    prov = pick(by_spec["ORTHOPEDICS"] + by_spec["CLINIC"], mid, r_vis)
                day = ms + timedelta(days=int(r_vis.integers(0, min(mdays, 28))))
                death = b.members[mid]["death_dt"]
                if death and day > death:
                    continue
                if prov == ROLE["excl_stops"] and day >= stop_dt:
                    continue
                if (mid, prov, day) in b.visit_days or _in_stay(b, mid, day):
                    continue
                if not _region_ok(b, mid, prov, day):
                    continue
                b.visit_days.add((mid, prov, day))
                spec = b.providers[prov]["specialty_code"]
                referrer = None
                if spec in ("CARDIOLOGY", "ORTHOPEDICS", "PHYSICAL_THERAPY", "RADIOLOGY") \
                        and prov != primary_of[mid] and r_ref.random() < 0.35:
                    referrer = primary_of[mid]
                b.new_claim("CARRIER", mid, prov, day,
                            _legit_lines(spec, day, r_vis, b.members[mid]["acuity_score"]), referring_id=referrer)
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
            if order_day > ref.WINDOW_END or (death and order_day > death) or (mid, code) in ordered \
                    or _in_stay(b, mid, order_day):
                continue
            ordered.add((mid, code))
            b.new_claim("DME", mid, sup, order_day, [Line(order_day, code)], referring_id=ref_prov, pos="12")

    _inject(b, member_ids, carrier_visits, r_dme)
    return b


# ===== injection ==========================================================================================
def _inject(b: Builder, member_ids: list[str], carrier_visits, r) -> None:
    ri = {name: _rng(b.seed, "inject:" + name)
          for name in ("dup", "ptp", "mue", "dod", "excl", "dme", "decoy", "upc", "utl", "phc", "tma", "tmb", "phb",
                       "ring")}
    by_prov: dict[str, list[Claim]] = defaultdict(list)
    for c in b.claims:
        by_prov[c.provider_id].append(c)
    window_mid = date(2024, 12, 31)

    # UPC: move a share of level 3-4 office lines to level 5 from 2025 on (the provider's high-level share rises)
    for scheme, prov in (("SCH-UPC-01", ROLE["upc_a"]), ("SCH-UPC-02", ROLE["upc_b"])):
        for c in by_prov[prov]:
            if c.claim_type != "CARRIER" or c.from_dt < UPC_START[scheme]:
                continue
            for ln in c.lines:
                if ln.hcpcs in ("99213", "99214") and ri["upc"].random() < 0.75:
                    b.label(c, ln, scheme, "POSITIVE", "UPCODED", {"hcpcs": ln.hcpcs})
                    ln.hcpcs = "99215"

    # DUP: exact copies of existing claims (new claim, identical member/date/code/modifiers/units)
    for scheme, prov, n in (("SCH-DUP-01", ROLE["dup_a"], 25), ("SCH-DUP-02", ROLE["dup_b"], 15),
                          ("SCH-DUP-03", ROLE["upc_a"], 20), ("SCH-DUP-04", ROLE["utl"], 12)):
        pool = [c for c in by_prov[prov] if c.from_dt >= DUP_START.get(scheme, window_mid)
                and c.claim_type == "CARRIER"]
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
            if (death and day > death) or _in_stay(b, m, day):
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

    members_alive = list(member_ids)

    def extra_visits(prov: str, per_month: int, months, scheme: str | None) -> None:
        """Extra office visits for the provider's own panel: scheme UTL (labelled) or decoy D1 (recurring care)."""
        panel = sorted(m for m, pp in b.primary_of.items() if pp == prov)
        assert len(panel) >= 8, f"{prov} panel too small ({len(panel)})"
        for mi in months:
            ms = _month_start(mi)
            for mid in panel:
                made, tries = 0, 0
                while made < per_month and tries < 80:
                    tries += 1
                    day = ms + timedelta(days=int(ri["utl"].integers(0, 28)))
                    death = b.members[mid]["death_dt"]
                    if (death and day > death) or (mid, prov, day) in b.visit_days or _in_stay(b, mid, day) \
                            or not _region_ok(b, mid, prov, day):
                        continue
                    b.visit_days.add((mid, prov, day))
                    c = b.new_claim("CARRIER", mid, prov, day,
                                    [Line(day, _pick_em(ri["utl"], b.members[mid]["acuity_score"]))])
                    if scheme:
                        b.label(c, c.lines[0], scheme, "POSITIVE", "EXCESS_VISIT")
                    made += 1

    extra_visits(ROLE["utl"], 5, range(8, 24), "SCH-UTL-01")     # scheme: far more visits per member than peers
    extra_visits(ROLE["d1"], 4, range(0, 24), None)                 # decoy D1: sustained recurring treatment
    extra_visits(ROLE["d1b"], 4, range(0, 24), None)                # the older twin with a closed unfounded case

    # D1 group-session days: a recurring-treatment centre legitimately runs 26 half-hour sessions in a day, which
    # trips the daily-time rule. Context only, never a scheme (label DECOY_CONTEXT).
    for prov, scheme in ((ROLE["d1"], "DEC-D1-01"), (ROLE["d1b"], "DEC-D1-02")):
        for mi in range(14, 22):
            day = _month_start(mi) + timedelta(days=17)
            made = 0
            for mid in ri["decoy"].permutation(members_alive).tolist():
                if made >= 26:
                    break
                death = b.members[mid]["death_dt"]
                if (b.mem_loc[mid]["region"] != b.prov_region[prov] or (death and day > death)
                        or (mid, prov, day) in b.visit_days or _in_stay(b, mid, day)
                        or not _region_ok(b, mid, prov, day)):
                    continue
                b.visit_days.add((mid, prov, day))
                c = b.new_claim("CARRIER", mid, prov, day, [Line(day, "99214")])
                b.label(c, c.lines[0], scheme, "DECOY_CONTEXT", "LEGIT_GROUP_SESSION")
                made += 1
            for c in b.claims:
                if c.provider_id == prov and c.from_dt == day:
                    for ln in c.lines:
                        if not any(lb[1] == ln.key for lb in b.labels):
                            b.label(c, ln, scheme, "DECOY_CONTEXT", "LEGIT_GROUP_SESSION")

    # PHC: monthly office visits billed for ghost members nobody else ever sees; the first six are recorded deceased
    for gid in b.ghosts:
        for mi in range(6, 24):
            day = _month_start(mi) + timedelta(days=int(ri["phc"].integers(0, 28)))
            if (gid, ROLE["phc"], day) in b.visit_days:
                continue
            b.visit_days.add((gid, ROLE["phc"], day))
            c = b.new_claim("CARRIER", gid, ROLE["phc"], day, [Line(day, "99213")])
            b.label(c, c.lines[0], "SCH-PHC-01", "POSITIVE", "GHOST_BILLING")

    # TMA: ten days with 22 extra 40-minute visits (880 typical minutes, over the 720 cap). Every line of those
    # days is implicated, including the provider's ordinary visits on the same day.
    tma = ROLE["tma"]
    for mi in range(8, 20):
        day = _month_start(mi) + timedelta(days=11)
        made = 0
        for mid in ri["tma"].permutation(members_alive).tolist():
            if made >= 22:
                break
            if b.mem_loc[mid]["region"] != b.prov_region[tma]:
                continue
            death = b.members[mid]["death_dt"]
            if (death and day > death) or (mid, tma, day) in b.visit_days or _in_stay(b, mid, day) \
                    or not _region_ok(b, mid, tma, day):
                continue
            b.visit_days.add((mid, tma, day))
            b.new_claim("CARRIER", mid, tma, day, [Line(day, "99215")])
            made += 1
        assert made == 22, f"TMA day {day}: only {made} members available"
        for c in b.claims:
            if c.provider_id == tma and c.from_dt == day:
                for ln in c.lines:
                    b.label(c, ln, "SCH-TMA-01", "POSITIVE", "DAY_OVERLOAD")

    # TMB: a clinic in another region bills members on a day they were seen far away (24 cases, 3 a month at most)
    tmb = ROLE["tmb"]
    seen_on: dict[tuple[str, str], list[date]] = defaultdict(list)
    for m, pv, d in carrier_visits:
        seen_on[(m, pv)].append(d)
    cand = [(m, pv, d) for m, pv, d in carrier_visits
            if date(2024, 10, 1) <= d <= date(2025, 11, 30) and b.prov_region[pv] != b.prov_region[tmb]
            and (m, tmb, d) not in b.visit_days and not b.members[m]["death_dt"]
            # the far place must be the member's usual provider, so the clinic is the unfamiliar side
            and any(d - timedelta(days=ref.GEO_HISTORY_DAYS) <= x < d for x in seen_on[(m, pv)])]
    per_month: dict[tuple[int, int], int] = defaultdict(int)
    made = 0
    used_members: set[str] = set()
    for i in ri["tmb"].permutation(len(cand)).tolist():
        m, _pv, d = cand[i]
        if made >= 24 or per_month[(d.year, d.month)] >= 3 or m in used_members:
            continue
        used_members.add(m)
        b.visit_days.add((m, tmb, d))
        c = b.new_claim("CARRIER", m, tmb, d, [Line(d, "99213")])
        b.label(c, c.lines[0], "SCH-TMB-01", "POSITIVE", "DISTANT_SAME_DAY")
        per_month[(d.year, d.month)] += 1
        made += 1
    assert made == 24, f"TMB: only {made} distant-day claims"

    # RNG: four practices under one control owner pass patients round in a circle (A refers to B refers to C ...)
    for mi in range(8, 24):
        ms = _month_start(mi)
        for referrer_p, biller in zip(RING, RING[1:] + RING[:1], strict=True):
            made = 0
            for mid in ri["ring"].permutation(members_alive).tolist():
                if made >= 10:
                    break
                if b.mem_loc[mid]["region"] != b.prov_region[biller] or b.members[mid]["death_dt"]:
                    continue
                day = ms + timedelta(days=int(ri["ring"].integers(0, 28)))
                if (mid, biller, day) in b.visit_days or _in_stay(b, mid, day) or not _region_ok(b, mid, biller, day):
                    continue
                b.visit_days.add((mid, biller, day))
                c = b.new_claim("CARRIER", mid, biller, day,
                                [Line(day, _pick_em(ri["ring"], b.members[mid]["acuity_score"]))],
                                referring_id=referrer_p)
                b.label(c, c.lines[0], "SCH-RNG-01", "POSITIVE", "RING_REFERRED")
                made += 1

    # PHB: a clinic bills office visits for members while they are inpatients elsewhere
    phb = ROLE["phb"]
    for mid, lst in sorted(b.stays.items()):
        for admit, disch in lst:
            day = admit + timedelta(days=int(ri["phb"].integers(1, (disch - admit).days)))
            if (mid, phb, day) in b.visit_days:
                continue
            b.visit_days.add((mid, phb, day))
            c = b.new_claim("CARRIER", mid, phb, day, [Line(day, "99213")])
            b.label(c, c.lines[0], "SCH-PHB-01", "POSITIVE", "DURING_STAY")


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
    _insert(con, "provider_location",
            [(p["provider_id"], p["region"], p["lat"], p["lon"], p["is_rural"], p["building_id"], p["phone_syn"])
             for p in sorted(b.prov_loc.values(), key=lambda x: x["provider_id"])],
            ["provider_id", "region", "lat", "lon", "is_rural", "building_id", "phone_syn"])
    _insert(con, "member_location",
            [(m["member_id"], m["region"], m["lat"], m["lon"])
             for m in sorted(b.mem_loc.values(), key=lambda x: x["member_id"])],
            ["member_id", "region", "lat", "lon"])
    stay_rows = [(f"S-{i:04d}", mid, a, d) for i, (mid, a, d) in enumerate(
        sorted((mid, a, d) for mid, lst in b.stays.items() for a, d in lst), start=1)]
    _insert(con, "inpatient_stay", stay_rows, ["stay_id", "member_id", "admit_dt", "discharge_dt"])
    _insert(con, "owner", sorted(b.owners.items()), ["owner_id", "name_syn"])
    _insert(con, "ownership", b.ownership, ["provider_id", "owner_id", "is_control", "pct"])
    _insert(con, "facility", b.facilities, ["facility_id", "name_syn", "building_id"])
    _insert(con, "provider_facility", b.prov_fac, ["provider_id", "facility_id"])
    _insert(con, "investigation",
            [(f"INV-{i:04d}", p, st, o, c, disp, rc, ex, rec)
             for i, (p, st, o, c, disp, rc, ex, rec) in enumerate(PRIOR_INVESTIGATIONS, start=1)],
            ["investigation_id", "provider_id", "scheme_type", "opened_dt", "closed_dt", "disposition",
             "reason_code", "exposure", "recovered"])
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
        CREATE TABLE gt_decoy_provider (scheme_id VARCHAR NOT NULL, provider_id VARCHAR NOT NULL,
                                        PRIMARY KEY (scheme_id, provider_id));
    """)
    subject = {s[0]: (s[1], s[2]) for s in SCHEMES}
    scheme_ids = sorted({lab[2] for lab in b.labels})
    for sid in scheme_ids:
        if sid.startswith("DEC-D5"):
            gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", (sid, "DECOY", "D5", "dev", ROLE["decoy"]))
        elif sid.startswith("DEC-"):
            continue                  # provider-level decoys are inserted from DECOY_PROVIDERS below
        else:
            st, prov = subject[sid]
            gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", (sid, "SCHEME", st, "dev", prov))
    for sid, dtype, provs in DECOY_PROVIDERS:
        gt.execute("INSERT INTO gt_scheme VALUES (?,?,?,?,?)", (sid, "DECOY", dtype, "dev", provs[0]))
        for pv in provs:
            gt.execute("INSERT INTO gt_decoy_provider VALUES (?,?)", (sid, pv))
    line_no_of = {(c.key, ln.key): ln.line_no for c in b.claims for ln in c.lines}
    _insert(gt, "gt_claim_label",
            [(claim_id[ck], line_no_of[(ck, lk)], sid, lab, role, orig)
             for ck, lk, sid, lab, role, orig in b.labels],
            ["claim_id", "line_no", "scheme_id", "label", "role", "original_value_json"])
    def split_of(pid: str) -> str:
        if pid in SPLIT_OF:
            return SPLIT_OF[pid]
        h = int.from_bytes(hashlib.sha256(pid.encode()).digest()[:4], "big") % 100
        return "train" if h < 50 else "val" if h < 70 else "test"

    _insert(gt, "gt_provider_split", [(p, split_of(p)) for p in sorted(b.providers)], ["provider_id", "split"])
    gt.close()
    return {"claims": len(claim_rows), "lines": len(line_rows), "hashes": hashes}


def build(claims_path: Path, gt_path: Path, seed: int = 20261008) -> dict:
    return write_databases(generate(seed), claims_path, gt_path)


if __name__ == "__main__":  # pragma: no cover
    from claimshield.paths import claims_db_path, gt_db_path
    print(build(claims_db_path(), gt_db_path()))
