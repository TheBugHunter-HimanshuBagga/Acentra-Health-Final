"""Precedents: feature vectors (fv_v1), similarity, precedent fit, and the seed library.

A precedent is a closed investigation turned into knowledge. Its feature vector describes the provider as it looked
when the case OPENED (never later: no hindsight). A new case is compared with the precedents of the same scheme
family or specialty by cosine similarity on z-scored vectors (clipped to +-5); the outcome of the similar cases
moves the evidence strength and, with two strong "unfounded" matches, the tier.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

FV_VERSION = "fv_v1"
FV_NAMES = ["em_high_share", "lines_per_member", "dup_share", "ptp_share", "mue_share", "referral_top3_share",
            "self_referral_share", "mean_member_km", "tenure_months", "log_dollars", "n_channels", "acuity_mean"]
FV_SCALE = {"em_high_share": 1.0, "lines_per_member": 10.0, "dup_share": 0.1, "ptp_share": 0.1, "mue_share": 0.1,
            "referral_top3_share": 1.0, "self_referral_share": 1.0, "mean_member_km": 200.0,
            "tenure_months": 120.0, "log_dollars": 12.0, "n_channels": 4.0, "acuity_mean": 1.0}
OUTCOME = {"CONFIRMED": 1.0, "EDUCATION": 0.5, "INSUFFICIENT": -0.3, "UNFOUNDED": -1.0}
MIN_SIM = 0.6
STRONG_SIM = 0.75
TOP_N = 5
DISPOSITION_TEXT = {"CONFIRMED": "as a confirmed pattern", "EDUCATION": "with provider education",
                    "INSUFFICIENT": "with insufficient evidence", "UNFOUNDED": "as unfounded"}
REASON_TEXT = {"LEGIT_CLINICAL_PATTERN": "a legitimate clinical pattern", "LEGIT_SHARED_BUILDING": "a shared building",
               "LEGIT_RURAL_ACCESS": "rural access", "LEGIT_HIGH_ACUITY": "a high-acuity patient mix",
               "DOC_SUPPORTS_BILLING": "documentation that supports the billing", "DATA_ERROR": "a data error",
               "CONFIRMED_PATTERN": "a confirmed pattern", "NEEDS_RECORDS": "records still needed"}


@dataclass
class Precedent:
    precedent_id: str
    source: str                  # SEED | LIVE
    scheme_type: str
    specialty_code: str | None
    disposition: str
    reason_code: str | None
    fv: list[float]
    rule_ids: list[str] = field(default_factory=list)
    rationale: str = ""
    closed_dt: str = "2024-12-31"
    status: str = "ACTIVE"


@dataclass
class Match:
    precedent: Precedent
    similarity: float
    compare: list[dict]


def fv_vector(pf: dict[str, float], dollars: float, n_channels: int) -> list[float]:
    raw = dict(pf, log_dollars=math.log1p(max(0.0, dollars)), n_channels=float(n_channels))
    return [round(float(np.clip(raw.get(n, 0.0) / FV_SCALE[n], 0.0, 1.0)), 6) for n in FV_NAMES]


def fv_stats(vectors: list[list[float]]) -> dict:
    a = np.array(vectors, dtype=float)
    return {"mean": [round(float(x), 6) for x in a.mean(axis=0)], "sd": [round(float(x), 6) for x in a.std(axis=0)]}


def zvec(v: list[float], stats: dict) -> np.ndarray:
    sd = np.maximum(np.array(stats["sd"], dtype=float), 0.05)
    return np.clip((np.array(v, dtype=float) - np.array(stats["mean"], dtype=float)) / sd, -5, 5)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(a @ b / (na * nb)) if na > 0 and nb > 0 else 0.0


def similarity(a: list[float], b: list[float], stats: dict) -> float:
    return cosine(zvec(a, stats), zvec(b, stats))


def match(fv: list[float], precedents: list[Precedent], schemes: set[str], specialty: str | None, stats: dict,
          top: int = TOP_N, min_sim: float = MIN_SIM) -> list[Match]:
    out = []
    for p in precedents:
        if p.status != "ACTIVE":
            continue
        if p.scheme_type not in schemes and (specialty is None or p.specialty_code != specialty):
            continue
        s = similarity(fv, p.fv, stats)
        if s >= min_sim:
            out.append(Match(p, s, compare(fv, p.fv)))
    out.sort(key=lambda m: (-m.similarity, m.precedent.precedent_id))
    return out[:top]


def compare(case_fv: list[float], prec_fv: list[float]) -> list[dict]:
    """Feature-by-feature comparison shown next to a precedent ("why similar")."""
    rows = [{"feature": n, "case": round(a * FV_SCALE[n], 4), "precedent": round(b * FV_SCALE[n], 4)}
            for n, a, b in zip(FV_NAMES, case_fv, prec_fv, strict=True)]
    rows.sort(key=lambda r: abs(r["case"] - r["precedent"]) / max(FV_SCALE[r["feature"]], 1e-9))
    return rows[:5]


def fit(matches: list[Match]) -> tuple[float, int]:
    """precedent_fit in [-1, 1] and the number of strong UNFOUNDED matches."""
    if not matches:
        return 0.0, 0
    num = sum(m.similarity * OUTCOME[m.precedent.disposition] for m in matches)
    den = sum(m.similarity for m in matches)
    strong = sum(1 for m in matches if m.precedent.disposition == "UNFOUNDED" and m.similarity >= STRONG_SIM)
    return float(num / den), strong


# ----------------------------------------------------------------------------------------------- seed library
# (scheme, disposition, reason, how many, feature overrides on the population average). These are SYNTHETIC archetypes
# written for the demo, not derived from the current claims. D1-like unfounded recurring treatment is deliberately
# represented only by the real prior investigation of provider P-0047, so the compounding story starts with one match.
ARCHETYPES = [
    ("DUP", "CONFIRMED", "CONFIRMED_PATTERN", 5, {"dup_share": 0.05}),
    ("UPC", "CONFIRMED", "CONFIRMED_PATTERN", 5, {"em_high_share": 0.80}),
    ("RNG", "CONFIRMED", "CONFIRMED_PATTERN", 3, {"self_referral_share": 0.95, "referral_top3_share": 0.90}),
    ("DME", "CONFIRMED", "CONFIRMED_PATTERN", 3, {"referral_top3_share": 0.95, "tenure_months": 8.0}),
    ("UNB", "EDUCATION", "NEEDS_RECORDS", 3, {"ptp_share": 0.04}),
    ("EXU", "EDUCATION", "NEEDS_RECORDS", 3, {"mue_share": 0.06}),
    ("UPC", "UNFOUNDED", "LEGIT_HIGH_ACUITY", 2, {"em_high_share": 0.58, "acuity_mean": 0.66}),
    ("DIS", "UNFOUNDED", "LEGIT_RURAL_ACCESS", 2, {"mean_member_km": 125.0, "is_sole_provider_county": 1.0}),
    ("PHC", "INSUFFICIENT", "DATA_ERROR", 1, {"referral_top3_share": 0.4}),
]
TEXT = {
    "CONFIRMED": "Records confirmed the pattern and the provider was asked to repay.",
    "EDUCATION": "The billing rule was explained to the provider and the claims were corrected.",
    "UNFOUNDED": "Review found a legitimate explanation; no further action was taken.",
    "INSUFFICIENT": "The data available did not support a conclusion; the item stayed on watch.",
}


def seed_precedents(pfeat: dict[str, dict[str, float]], investigations: list[dict], specialty_of: dict[str, str],
                    seed: int = 20261008) -> list[Precedent]:
    """The library the system starts with: the real prior investigations plus synthetic archetypes."""
    rng = np.random.default_rng(seed)
    pop = {k: float(np.mean([f[k] for f in pfeat.values()])) for k in next(iter(pfeat.values()))}
    out: list[Precedent] = []
    n = 0
    for inv in sorted(investigations, key=lambda i: i["id"]):
        n += 1
        pf = pfeat.get(inv["provider"], pop)
        out.append(Precedent(
            f"PRC-{n:04d}", "SEED", inv["scheme"], specialty_of.get(inv["provider"]), inv["disposition"],
            inv["reason"], fv_vector(pf, inv.get("exposure") or 0.0, 2), [], TEXT[inv["disposition"]] +
            " (prior investigation " + inv["id"] + ")", str(inv["closed"])))
    for scheme, disp, reason, count, over in ARCHETYPES:
        for _ in range(count):
            n += 1
            pf = dict(pop)
            for k, v in over.items():
                pf[k] = v * float(rng.uniform(0.9, 1.1))
            out.append(Precedent(
                f"PRC-{n:04d}", "SEED", scheme, None, disp, reason, fv_vector(pf, 15000.0, 2), [],
                "Synthetic seed precedent. " + TEXT[disp], "2024-12-31"))
    return out
