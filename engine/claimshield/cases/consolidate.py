"""Alerts to cases: entity consolidation and stable case IDs.

M1 links providers only through referral coupling (ownership/phone/address arrive with the graph work).
A provider with no active alert never becomes a case subject by merging; it can only appear as RELATED.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import duckdb

from claimshield.cases.alerts import Alert

MIN_COUPLED_REFERRALS = 30
MIN_COUPLED_SHARE = 0.25


@dataclass
class CaseDraft:
    primary: str
    providers: list[str]                       # component members, primary first
    related: list[str]                         # referring providers that are not merged subjects
    alerts: list[Alert] = field(default_factory=list)
    hits: list[dict] = field(default_factory=list)
    case_id: str = ""

    @property
    def subjects(self) -> list[tuple[str, str]]:
        out = [(self.primary, "PRIMARY")]
        out += [(p, "NETWORK") for p in self.providers if p != self.primary]
        out += [(p, "RELATED") for p in self.related]
        return out


class _UnionFind:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)   # deterministic root


def referral_pairs(con: duckdb.DuckDBPyConnection) -> tuple[dict[tuple[str, str], int], dict[str, int], dict[str, str]]:
    """(referrer, supplier) -> order count; supplier -> total referred orders; DME claim_id -> referrer."""
    rows = con.execute("""SELECT claim_id, referring_provider_id, billing_provider_id FROM claim
                          WHERE claim_type = 'DME' AND referring_provider_id IS NOT NULL""").fetchall()
    pair, total, claim_ref = defaultdict(int), defaultdict(int), {}
    for claim_id, referrer, supplier in rows:
        pair[(referrer, supplier)] += 1
        total[supplier] += 1
        claim_ref[claim_id] = referrer
    return pair, total, claim_ref


def consolidate(con: duckdb.DuckDBPyConnection, alerts: list[Alert], hits: list[dict]) -> list[CaseDraft]:
    active = sorted({a.provider_id for a in alerts if a.suppressed_by_exception_id is None})
    if not active:
        return []
    pair, total, claim_ref = referral_pairs(con)
    uf = _UnionFind(active)
    # strong links: a shared CONTROL owner, and groups joined by shared infrastructure (G-INFRA)
    owners = con.execute("""SELECT owner_id, LIST(provider_id ORDER BY provider_id) FROM ownership
                            WHERE is_control GROUP BY owner_id HAVING COUNT(*) >= 2""").fetchall()
    groups = [list(members) for _oid, members in owners]
    groups += [a.detail["group"] for a in alerts if a.rule_id == "G-INFRA" and a.detail]
    for members in groups:
        live = [p for p in members if p in uf.parent]
        for p in live[1:]:
            uf.union(live[0], p)
    for (referrer, supplier), n in sorted(pair.items()):
        if referrer in uf.parent and supplier in uf.parent:
            if n >= MIN_COUPLED_REFERRALS and n / total[supplier] >= MIN_COUPLED_SHARE:
                uf.union(referrer, supplier)

    comps: dict[str, list[str]] = defaultdict(list)
    for p in active:
        comps[uf.find(p)].append(p)

    alerts_by_provider = defaultdict(list)
    for a in alerts:
        if a.suppressed_by_exception_id is None:
            alerts_by_provider[a.provider_id].append(a)
    hits_by_provider = defaultdict(list)
    for h in hits:
        hits_by_provider[h["provider_id"]].append(h)

    drafts: list[CaseDraft] = []
    for root in sorted(comps):
        members = sorted(comps[root])
        primary = max(members, key=lambda p: (sum(a.dollars for a in alerts_by_provider[p]), p))
        ordered = [primary] + [p for p in members if p != primary]
        al = [a for p in ordered for a in alerts_by_provider[p]]
        ht = [h for p in ordered for h in hits_by_provider[p]]
        referrers = sorted({claim_ref[h["claim_id"]] for h in ht if h["claim_id"] in claim_ref} - set(ordered))
        drafts.append(CaseDraft(primary=primary, providers=ordered, related=referrers, alerts=al, hits=ht))
    return drafts


def assign_case_ids(drafts: list[CaseDraft], previous: dict[str, set[str]]) -> None:
    """Inherit an old case ID when subject overlap (Jaccard) >= 0.5, else mint a new one. Mutates drafts."""
    used: set[str] = set()
    next_n = 1 + max((int(c.split("-")[1]) for c in previous), default=0)
    for d in sorted(drafts, key=lambda x: x.primary):
        subj = {p for p, _ in d.subjects}
        best, best_j = None, 0.0
        for cid, old in sorted(previous.items()):
            if cid in used or not (subj | old):
                continue
            j = len(subj & old) / len(subj | old)
            if j >= 0.5 and j > best_j:
                best, best_j = cid, j
        if best is None:
            best = f"CASE-{next_n:04d}"
            next_n += 1
        used.add(best)
        d.case_id = best
