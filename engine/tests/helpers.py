"""Tiny hand-built databases for precise rule tests (the generator is tested separately)."""

from __future__ import annotations

from datetime import date

import duckdb

from claimshield import reference as ref
from claimshield.paths import SQL_DIR


class TinyDb:
    def __init__(self):
        self.con = duckdb.connect(":memory:")
        self.con.execute((SQL_DIR / "canonical_schema.sql").read_text(encoding="utf-8"))
        for s in ref.SPECIALTIES:
            self.con.execute("INSERT INTO ref_specialty VALUES (?,?,?)", s)
        for p in ref.POS:
            self.con.execute("INSERT INTO ref_place_of_service VALUES (?,?,?)", p)
        for i, (c1, c2, ind) in enumerate(ref.FIXTURE_PTP, start=1):
            self.con.execute("INSERT INTO ref_ncci_ptp VALUES (?,?,?,?,?,?,?)",
                             (i, c1, c2, ind, date(2024, 1, 1), None, ref.FIXTURE_SOURCE))
        for m in ref.FIXTURE_MUE:
            self.con.execute("INSERT INTO ref_mue VALUES (?,?,?,?)", m)
        self._n = 0
        self.members: set[str] = set()
        self.providers: set[str] = set()

    def member(self, mid="M1", death=None):
        if mid not in self.members:
            self.con.execute("INSERT INTO member VALUES (?,?,?,?,?,?)",
                             (mid, 1950, "F", date(2024, 1, 1), death, 0.5))
            self.members.add(mid)

    def provider(self, pid="P1", spec="PRIMARY_CARE"):
        if pid not in self.providers:
            self.con.execute("INSERT INTO provider VALUES (?,?,?,?,?,?,?,?)",
                             (pid, "INDIVIDUAL", f"Prov {pid}", spec, date(2015, 1, 1), "ACTIVE", f"SYN-{pid}",
                              f"T-{pid}"))
            self.providers.add(pid)

    def exclusion(self, pid, excl_dt, reinstate=None):
        self.provider(pid)
        self.con.execute("INSERT INTO exclusion VALUES (?,?,?,?,?)", (f"X-{pid}", pid, "T", excl_dt, reinstate))

    def claim(self, lines, *, member="M1", provider="P1", day=date(2025, 1, 10), claim_type="CARRIER",
              referring=None):
        """lines = [(hcpcs, units, modifier1, modifier2)] or [(hcpcs,)]. Returns the claim id."""
        self.member(member)
        self.provider(provider)
        if referring:
            self.provider(referring)
        self._n += 1
        cid = f"C-{self._n:010d}"
        self.con.execute("INSERT INTO claim VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (cid, claim_type, member, provider, provider, referring, day, day, "11", None, 0.0))
        for i, ln in enumerate(lines, start=1):
            hcpcs = ln[0]
            units = ln[1] if len(ln) > 1 else 1
            m1 = ln[2] if len(ln) > 2 else None
            m2 = ln[3] if len(ln) > 3 else None
            allowed = round(ref.REFERENCE_ALLOWED.get(hcpcs, 50.0) * units, 2)
            self.con.execute("INSERT INTO claim_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                             (cid, i, day, hcpcs, m1, m2, units, allowed * 2.2, allowed, round(allowed * 0.8, 2),
                              provider, "11"))
        return cid

    def run(self, rule_id):
        from claimshield.detect import rules
        return rules.run_rule(self.con, rule_id)
