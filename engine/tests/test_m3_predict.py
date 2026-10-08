"""30/60/90-day outlook: features without look-ahead, honest labels, splits, baselines, and the queue re-ranking."""

import json
import math

import numpy as np
import pandas as pd
import pytest

from claimshield import reference as ref
from claimshield.detect.peer import _load
from claimshield.eval import labels as labels_mod
from claimshield.graph import graph as G
from claimshield.predict import features as F
from claimshield.predict import model as M


# ================================================================== features
def _snap(con, t, lines=None, hits=None):
    lines_all, providers, _ = _load(con)
    spec_of = dict(zip(providers["provider_id"], providers["specialty_code"], strict=True))
    hits_df = con.execute("SELECT rule_id, provider_id, service_dt, dollars FROM out_rule_hit").fetchdf() \
        if hits is None else hits
    tables = G.load_tables(con)
    enroll = dict(con.execute("SELECT provider_id, enroll_dt FROM provider").fetchall())
    refs = G.referral_lines(con, ref.WINDOW_START, ref.WINDOW_END)
    rg = G.referral_graph(refs)
    return F.build_snapshots(lines_all if lines is None else lines, hits_df, refs, tables["investigation"], enroll,
                             spec_of, G.control_groups(tables),
                             lambda asof: G.min_hops_to_confirmed(tables, rg, asof), ts=[t])


def test_features_at_a_snapshot_do_not_change_when_the_future_is_removed(claims_con):
    """The strongest leakage check: truncate every table at the end of month t and rebuild the same snapshot."""
    t = 12
    con = claims_con.cursor()
    end = F.snapshot_months()[t] + pd.offsets.MonthEnd(0)
    full = _snap(con, t).set_index("provider_id")
    lines, _p, _d = _load(con)
    hits = con.execute("SELECT rule_id, provider_id, service_dt, dollars FROM out_rule_hit").fetchdf()
    cut_lines = lines[lines["service_dt"] <= end]
    cut_hits = hits[pd.to_datetime(hits["service_dt"]) <= end]
    cut = _snap(con, t, cut_lines, cut_hits).set_index("provider_id")
    # referral edges and investigations are cut inside build_snapshots by the same as-of rule
    cols = [c for c in F.FEATURES if c != "hops_to_confirmed"]
    pd.testing.assert_frame_equal(full[cols].sort_index(), cut[cols].sort_index(), check_exact=False, rtol=1e-9)


def test_no_demographic_or_ground_truth_field_is_a_feature():
    banned = ("sex", "birth", "age", "gt_", "scheme", "label", "inject", "acuity")
    assert not [f for f in F.FEATURES if any(b in f.lower() for b in banned)]
    assert len(F.FEATURES) == len(set(F.FEATURES))


def test_feature_rows_are_complete_and_numeric(claims_con):
    snap = _snap(claims_con.cursor(), 16)
    assert set(F.FEATURES) <= set(snap.columns) and snap["provider_id"].nunique() >= 60
    assert not snap[F.FEATURES].isna().any().any()
    assert np.isfinite(snap[F.FEATURES].to_numpy(dtype=float)).all()


# ================================================================== labels and splits
def test_labels_mark_future_injected_dollars_and_stay_unknown_past_the_end(m1, claims_con):
    provs = sorted(p for (p,) in claims_con.execute("SELECT provider_id FROM provider").fetchall())
    lab = labels_mod.load_labels(claims_con.cursor(), m1["paths"]["gt"], provs).set_index(["provider_id", "t"])
    utl = "P-0045"                                   # utilization scheme from 2024-09 = month index 8
    assert lab.loc[(utl, 6), "y30"] == 0.0 and lab.loc[(utl, 7), "y30"] == 1.0 and lab.loc[(utl, 12), "y90"] == 1.0
    assert all(lab.loc[("P-0046", t), "y90"] == 0.0 for t in range(6, 21))       # decoy D1: nothing injected
    assert math.isnan(lab.loc[(utl, 23), "y30"]) and math.isnan(lab.loc[(utl, 22), "y60"])
    assert not math.isnan(lab.loc[(utl, 22), "y30"]) and not math.isnan(lab.loc[(utl, 20), "y90"])


def test_splits_are_disjoint_and_cover_every_provider(m1, claims_con):
    splits = labels_mod.load_splits(m1["paths"]["gt"])
    provs = {p for (p,) in claims_con.execute("SELECT provider_id FROM provider").fetchall()}
    assert set(splits) == provs and set(splits.values()) == {"train", "val", "test"}
    assert splits["P-0042"] == "test" and splits["P-0041"] == "train" and splits["P-0043"] == "val"
    assert {splits[p] for p in ("P-0062", "P-0063", "P-0064", "P-0065")} == {"test"}      # the ring stays together


# ================================================================== the model on constructed data
def _toy(n_per_split=12, rng_seed=0, signal=True):
    rng = np.random.default_rng(rng_seed)
    rows, splits = [], {}
    for split in ("train", "val", "test"):
        for i in range(n_per_split):
            p = f"{split[:2].upper()}{i}"
            splits[p] = split
            bad = i % 3 == 0
            for t in range(6, 24):
                row = {f: float(rng.normal()) for f in F.FEATURES}
                if signal and bad:
                    row["hits_90"] = float(rng.integers(3, 9))
                    row["max_strength_30"] = 0.9
                else:
                    row["hits_90"] = 0.0
                    row["max_strength_30"] = 0.0
                row.update({"provider_id": p, "t": t})
                rows.append(row)
    snaps = pd.DataFrame(rows)
    lab = snaps[["provider_id", "t"]].copy()
    bad = snaps["hits_90"] > 0
    for h in F.HORIZONS:
        lab[f"y{h}"] = bad.astype(float).where(lab["t"] + F.H_MONTHS[h] <= 23)
    return snaps, lab, splits


def test_model_learns_a_clear_signal_and_reports_baselines_with_intervals():
    snaps, lab, splits = _toy()
    r = M.run_prediction(snaps, lab, splits)
    assert r["eval"]["available"] is True
    h = r["eval"]["horizons"]["90"]
    assert h["chosen"] in ("hgb", "logit") and set(h["validationPrAuc"]) == {"hgb", "logit"}
    t = h["test"]
    assert t["metrics"]["model"]["prAuc"] >= 0.95 and t["metrics"]["model"]["rocAuc"] >= 0.95
    assert {"persistence_any_hit", "persistence_last_month"} <= set(t["metrics"])
    assert len(t["modelMinusPersistenceCI"]) == 2 and t["reliability"] and "brier" in t["metrics"]["model"]
    assert isinstance(t["beatsPersistence"], bool) and t["k"] >= 1
    # serving snapshot: probabilities per horizon for every provider, and local factors
    p = r["predictions"]
    assert len(p) == len(splits) and all(0 <= v[k] <= 1 for v in p.values() for k in ("30", "60", "90"))
    assert p["TR0"]["90"] > p["TR1"]["90"], "the provider with the signal scores higher"
    assert all(isinstance(v["factors"]["90"], list) for v in p.values())


def test_when_the_model_cannot_beat_persistence_the_report_says_so():
    snaps, lab, splits = _toy()
    # the signal is exactly persistence (hits_90 is the label), so the model cannot be better than that baseline
    r = M.run_prediction(snaps, lab, splits)
    t = r["eval"]["horizons"]["90"]["test"]
    best = max(t["metrics"]["persistence_any_hit"]["prAuc"], t["metrics"]["persistence_last_month"]["prAuc"])
    assert t["beatsPersistence"] is (t["metrics"]["model"]["prAuc"] > best)
    assert t["liftOverBestPersistence"] == pytest.approx(t["metrics"]["model"]["prAuc"] / best, abs=1e-3)


def test_no_positive_training_examples_gives_an_honest_empty_result():
    snaps, lab, splits = _toy(signal=False)
    lab[["y30", "y60", "y90"]] = lab[["y30", "y60", "y90"]].where(lab[["y30", "y60", "y90"]].isna(), 0.0)
    r = M.run_prediction(snaps, lab, splits)
    assert r["eval"] == {"available": False} and r["predictions"] == {}


def test_purge_gap_snapshots_are_never_used_for_training():
    snaps, lab, splits = _toy()
    poisoned = lab.copy()
    poisoned.loc[poisoned["t"].isin([14, 15]), ["y30", "y60", "y90"]] = 1.0     # would change the model if used
    a = M.run_prediction(snaps, lab, splits)["predictions"]
    b = M.run_prediction(snaps, poisoned, splits)["predictions"]
    assert a == b


def test_the_fit_is_deterministic():
    snaps, lab, splits = _toy()
    assert M.run_prediction(snaps, lab, splits) == M.run_prediction(snaps, lab, splits)


# ================================================================== what the pipeline produced
def _cases(app_con):
    return {r["primary_provider_id"]: r for r in app_con.execute("SELECT * FROM serving_case")}


def test_every_case_carries_a_three_horizon_outlook_with_a_caveat(app_con):
    for r in _cases(app_con).values():
        o = json.loads(r["header_json"])["outlook"]
        assert o["available"] is True and set(o["horizons"]) == {"30", "60", "90"}
        assert all(0 <= v["probability"] <= 1 for v in o["horizons"].values())
        assert "not evidence" in o["caveat"] and "never changes the tier" in o["caveat"]


def test_risk_h_follows_the_documented_formula_and_never_lowers_the_signal(app_con):
    for r in _cases(app_con).values():
        head = json.loads(r["header_json"])
        base = head["factors"]["risk"]
        for h in (30, 60, 90):
            p = head["outlook"]["horizons"][str(h)]["probability"]
            expected = 1 - (1 - base) * (1 - 0.30 * p)
            assert r[f"risk_{h}"] == pytest.approx(expected, abs=5e-4)
            assert r[f"risk_{h}"] >= base - 5e-4


def test_the_horizon_changes_the_queue_utility_but_not_the_tier(app_con):
    rows = app_con.execute("SELECT tier, utility_30, utility_60, utility_90 FROM serving_case").fetchall()
    assert any(len({round(r["utility_30"], 6), round(r["utility_60"], 6), round(r["utility_90"], 6)}) > 1
               for r in rows)
    assert all(r["tier"] in ("HIGH", "MEDIUM") for r in rows)


def test_scheme_providers_get_a_higher_outlook_than_ordinary_ones(app_con):
    cases = _cases(app_con)
    p90 = {prov: json.loads(c["header_json"])["outlook"]["horizons"]["90"]["probability"] for prov, c in cases.items()}
    scheme = [p90[p] for p in ("P-0041", "P-0044", "P-0045") if p in p90]
    ordinary = [p90[p] for p in ("P-0002", "P-0015", "P-0016", "P-0021", "P-0027") if p in p90]
    assert scheme and ordinary and float(np.mean(scheme)) > float(np.mean(ordinary))


def test_the_evaluation_compares_with_persistence_and_states_the_split(app_con):
    ev = json.loads(app_con.execute("SELECT eval_json FROM serving_eval").fetchone()[0])["prediction"]
    assert ev["available"] is True and "purge" in ev["split"] and ev["features"] == F.FEATURES
    for h in ("30", "60", "90"):
        info = ev["horizons"][h]
        assert info["chosen"] in ("hgb", "logit") and info["positives"]["train"] > 0
        m = info["test"]["metrics"]
        assert set(m) == {"model", "persistence_any_hit", "persistence_last_month"}
        assert isinstance(info["test"]["beatsPersistence"], bool)
        assert info["importance"] and info["importance"][0]["importance"] >= info["importance"][-1]["importance"]
    assert any("synthetic" in n for n in ev["notes"])
