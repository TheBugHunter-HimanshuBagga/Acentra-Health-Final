"""30/60/90-day repeat-or-escalating risk: one shallow boosted-tree model per horizon, compared with a logistic
regression, and always compared with two persistence baselines that it must beat to deserve a place in the queue.

Splits (by provider AND by time, with a purge gap):
  train  : train providers, snapshots t = 6..13
  val    : val providers,   snapshots t = 6..13   (model choice and importance)
  purge  : snapshots t = 14..15 are never used
  test   : test providers,  snapshots t = 16..20  (reported once)
  serve  : the last snapshot (t = 23) for every provider, with the model refit on train + val providers

This module never opens the ground-truth database: labels and splits arrive as plain data from the orchestrator.
The prediction only informs the risk term of the queue ranking; it never changes the evidence or the tier.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from claimshield.predict.features import FEATURES, HORIZONS

TRAIN_T = range(6, 14)
TEST_T = range(16, 21)
SERVE_T = 23
SEED = 7
N_BOOT = 200

FEATURE_TEXT = {
    "hits_30": "rule hits this month", "hits_90": "rule hits in 90 days", "hits_180": "rule hits in 180 days",
    "hit_dollars_90": "dollars on rule hits in 90 days", "max_strength_30": "strongest rule hit this month",
    "max_strength_90": "strongest rule hit in 90 days", "hard_fact_90": "a recorded-fact rule hit in 90 days",
    "z_high_share": "high-level visit share against peers", "z_lines_per_member": "lines per member against peers",
    "z_paid_per_member": "paid per member against peers", "growth_90d": "growth of billed dollars",
    "z_growth": "growth against peers", "cusum_alarm": "a lasting change from its own history",
    "cusum_max": "size of the change from its own history", "cusum_months_since_onset": "months since the change began",
    "tenure_months": "months since enrolment", "self_referral_share": "referrals kept inside its owner group",
    "referral_top3_share": "referrals from its top three sources", "hops_to_confirmed": "distance to a confirmed case",
    "prior_confirmed": "earlier confirmed investigations", "prior_investigations": "earlier investigations",
    "months_since_closure": "months since its last investigation", "n_members": "members seen",
    "log_paid_90": "dollars billed in 90 days",
}


def _hgb(seed: int = SEED) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.05, l2_regularization=1.0,
                                          min_samples_leaf=20, random_state=seed)


def _logit(seed: int = SEED):
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, class_weight="balanced", max_iter=500,
                                                              random_state=seed))


def _weights(y: np.ndarray) -> np.ndarray:
    pos = max(1.0, float(y.sum()))
    neg = max(1.0, float(len(y) - y.sum()))
    return np.where(y == 1, len(y) / (2 * pos), len(y) / (2 * neg))


def _fit(kind: str, x: pd.DataFrame, y: np.ndarray, seed: int):
    if kind == "hgb":
        m = _hgb(seed)
        m.fit(x[FEATURES], y, sample_weight=_weights(y))
    else:
        m = _logit(seed)
        m.fit(x[FEATURES], y)
    return m


def _pr(y, s) -> float | None:
    return float(average_precision_score(y, s)) if y.sum() > 0 else None


def _roc(y, s) -> float | None:
    return float(roc_auc_score(y, s)) if 0 < y.sum() < len(y) else None


def _prec_at_k(y, s, k: int) -> float:
    order = np.argsort(-np.asarray(s), kind="stable")[:k]
    return float(np.asarray(y)[order].mean()) if k else 0.0


def _boot(y: np.ndarray, scores: dict[str, np.ndarray], providers: np.ndarray, seed: int) -> dict:
    """Bootstrap over PROVIDERS (rows of one provider are correlated): CI of PR-AUC and of the lift over persistence."""
    rng = np.random.default_rng(seed)
    uniq = np.unique(providers)
    idx_of = {p: np.where(providers == p)[0] for p in uniq}
    draws = {k: [] for k in scores}
    lift = []
    for _ in range(N_BOOT):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        rows = np.concatenate([idx_of[p] for p in pick])
        yy = y[rows]
        if yy.sum() == 0:
            continue
        pr = {k: average_precision_score(yy, v[rows]) for k, v in scores.items()}
        for k, v in pr.items():
            draws[k].append(v)
        lift.append(pr["model"] - pr["persistence_any_hit"])
    ci = lambda v: [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)] if v else None  # noqa: E731
    return {"prAucCI": {k: ci(v) for k, v in draws.items()}, "modelMinusPersistenceCI": ci(lift)}


def _reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    out = []
    edges = np.linspace(0, 1, bins + 1)
    for i in range(bins):
        sel = (p >= edges[i]) & ((p < edges[i + 1]) if i < bins - 1 else (p <= edges[i + 1]))
        if sel.any():
            out.append({"bin": f"{edges[i]:.1f}-{edges[i + 1]:.1f}", "n": int(sel.sum()),
                        "predicted": round(float(p[sel].mean()), 4), "observed": round(float(y[sel].mean()), 4)})
    return out


def run_prediction(snaps: pd.DataFrame, labels: pd.DataFrame, splits: dict[str, str], seed: int = SEED) -> dict:
    """Returns {"predictions": {provider: {"30": p, ..., "factors": {...}}}, "eval": {...}}."""
    df = snaps.merge(labels, on=["provider_id", "t"], how="left")
    df["split"] = df["provider_id"].map(splits).fillna("train")
    serve = df[df["t"] == SERVE_T].copy()
    result: dict = {"predictions": {}, "eval": {"available": False}}
    horizons_eval: dict = {}
    for h in HORIZONS:
        y_col = f"y{h}"
        lab = df[df[y_col].notna()]
        tr = lab[(lab["split"] == "train") & lab["t"].isin(TRAIN_T)]
        va = lab[(lab["split"] == "val") & lab["t"].isin(TRAIN_T)]
        te = lab[(lab["split"] == "test") & lab["t"].isin(TEST_T)]
        if tr[y_col].sum() == 0 or tr[y_col].sum() == len(tr):
            continue
        ytr, yva, yte = tr[y_col].to_numpy(), va[y_col].to_numpy(), te[y_col].to_numpy()
        models = {k: _fit(k, tr, ytr, seed) for k in ("hgb", "logit")}
        val_pr = {k: (_pr(yva, m.predict_proba(va[FEATURES])[:, 1]) if len(va) else None) for k, m in models.items()}
        chosen = max(val_pr, key=lambda k: (val_pr[k] if val_pr[k] is not None else -1, k == "hgb"))
        # the model that serves is refit on train + val providers; the test providers stay untouched
        trva = pd.concat([tr, va])
        final = _fit(chosen, trva, trva[y_col].to_numpy(), seed)
        info: dict = {"chosen": chosen, "validationPrAuc": {k: (round(v, 4) if v is not None else None)
                                                           for k, v in val_pr.items()},
                      "rows": {"train": len(tr), "val": len(va), "test": len(te)},
                      "positives": {"train": int(ytr.sum()), "val": int(yva.sum()), "test": int(yte.sum())}}
        if len(te) and yte.sum() > 0:
            p_te = models[chosen].predict_proba(te[FEATURES])[:, 1]
            base_any = (te["hits_90"] > 0).to_numpy().astype(float)
            base_last = te["max_strength_30"].to_numpy()
            k = max(1, int(round(0.1 * len(te))))
            scores = {"model": p_te, "persistence_any_hit": base_any, "persistence_last_month": base_last}
            m = {name: {"prAuc": round(_pr(yte, s), 4), "rocAuc": (round(_roc(yte, s), 4) if _roc(yte, s) is not None
                                                                      else None),
                        "precisionAtTopDecile": round(_prec_at_k(yte, s, k), 4)} for name, s in scores.items()}
            m["model"]["brier"] = round(float(brier_score_loss(yte, p_te)), 4)
            m["model"]["prevalence"] = round(float(yte.mean()), 4)
            boot = _boot(yte, scores, te["provider_id"].to_numpy(), seed)
            best_base = max(m["persistence_any_hit"]["prAuc"], m["persistence_last_month"]["prAuc"])
            info["test"] = {"metrics": m, "k": k, **boot, "reliability": _reliability(yte, p_te),
                            "liftOverBestPersistence": round(m["model"]["prAuc"] / best_base, 3) if best_base else None,
                            "beatsPersistence": bool(m["model"]["prAuc"] > best_base)}
        if len(va) and yva.sum() > 0:
            imp = permutation_importance(models[chosen], va[FEATURES], yva, scoring="average_precision",
                                         n_repeats=5, random_state=seed)
            info["importance"] = sorted(({"feature": f, "label": FEATURE_TEXT[f],
                                          "importance": round(float(max(0.0, v)), 4)}
                                         for f, v in zip(FEATURES, imp.importances_mean, strict=True)),
                                        key=lambda r: -r["importance"])[:10]
            imp_map = dict(zip(FEATURES, np.maximum(0.0, imp.importances_mean), strict=True))
        else:
            imp_map = dict.fromkeys(FEATURES, 0.0)
        horizons_eval[str(h)] = info
        probs = final.predict_proba(serve[FEATURES])[:, 1]
        pct = serve[FEATURES].rank(pct=True)
        for (_, row), p, (ri, _r2) in zip(serve.iterrows(), probs, pct.iterrows(), strict=True):
            entry = result["predictions"].setdefault(row["provider_id"], {"factors": {}})
            entry[str(h)] = round(float(p), 4)
            contrib = {f: imp_map[f] * abs(pct.loc[ri, f] - 0.5) * 2 for f in FEATURES}
            top = sorted(contrib, key=lambda f: -contrib[f])[:3]
            entry["factors"][str(h)] = [
                {"feature": f, "label": FEATURE_TEXT[f],
                 "direction": "higher" if pct.loc[ri, f] >= 0.5 else "lower"} for f in top if contrib[f] > 0]
    if horizons_eval:
        result["eval"] = {
            "available": True, "model": "HistGradientBoostingClassifier (depth 3) vs L2 logistic regression, chosen "
            "on validation PR-AUC", "horizons": horizons_eval, "features": FEATURES,
            "split": {"train": "train providers, snapshots 6-13", "validation": "val providers, snapshots 6-13",
                      "purge": "snapshots 14-15 unused", "test": "test providers, snapshots 16-20",
                      "serve": "snapshot 23 for every provider, model refit on train + val providers"},
            "notes": ["The label is synthetic: positive injected dollars in the horizon. It shows the pipeline is "
                      "consistent, not real-world predictive power.",
                      "Factors are associations (importance x deviation from other providers), not causes.",
                      "The prediction only moves the risk term of the queue ranking; it never changes evidence or "
                      "the tier."]}
    return result
