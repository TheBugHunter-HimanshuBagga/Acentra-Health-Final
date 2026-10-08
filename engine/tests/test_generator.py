"""Mini-generator: determinism, scale, no lineage leakage, and agreement between rules and ground truth."""

from pathlib import Path

import duckdb

from claimshield.detect import rules
from claimshield.eval.metrics import SCHEME_TO_RULE
from claimshield.generate import mini


def test_generation_is_deterministic(tmp_path):
    a = mini.build(tmp_path / "a.duckdb", tmp_path / "ga.duckdb", seed=123)
    b = mini.build(tmp_path / "b.duckdb", tmp_path / "gb.duckdb", seed=123)
    c = mini.build(tmp_path / "c.duckdb", tmp_path / "gc.duckdb", seed=124)
    assert a["hashes"] == b["hashes"]
    assert a["hashes"] != c["hashes"]


def test_scale_is_about_twenty_thousand_lines(m1):
    lines = m1["summary"]["generated"]["lines"]
    assert 15_000 <= lines <= 25_000


def test_claim_tables_carry_no_lineage_columns(claims_con):
    banned = ("inject", "scheme", "label", "origin", "synthetic", "gt_", "source")
    for table in ("claim", "claim_line", "member", "provider"):
        cols = [r[0].lower() for r in claims_con.execute(f"DESCRIBE {table}").fetchall()]
        assert not [c for c in cols if any(b in c for b in banned)], (table, cols)


def test_ground_truth_lives_in_a_separate_file(m1, claims_con):
    names = {r[0] for r in claims_con.execute("SHOW TABLES").fetchall()}
    assert not any(n.startswith("gt_") for n in names)
    gt = duckdb.connect(str(m1["paths"]["gt"]), read_only=True)
    assert {"gt_scheme", "gt_claim_label"} <= {r[0] for r in gt.execute("SHOW TABLES").fetchall()}
    gt.close()


def test_claim_ids_are_one_contiguous_sequence(claims_con):
    ids = [r[0] for r in claims_con.execute("SELECT claim_id FROM claim ORDER BY claim_id").fetchall()]
    assert ids == [f"C-{i:010d}" for i in range(1, len(ids) + 1)]


def test_every_official_rule_scheme_is_present_and_every_positive_is_found(m1, claims_con):
    gt = duckdb.connect(str(m1["paths"]["gt"]), read_only=True)
    pos = gt.execute("""SELECT s.scheme_type, l.claim_id, l.line_no FROM gt_claim_label l
                        JOIN gt_scheme s USING (scheme_id) WHERE l.label = 'POSITIVE'""").fetchall()
    gt.close()
    assert {p[0] for p in pos} == set(SCHEME_TO_RULE)          # all six behaviours are injected
    hits = rules.run_all_rules(claims_con.cursor(), store=False)
    flagged = {(r, c, n) for r, c, n in zip(hits.rule_id, hits.claim_id, hits.line_no, strict=True)}
    for st, c, n in pos:
        assert (SCHEME_TO_RULE[st], c, n) in flagged, f"missed {st} {c}:{n}"


def test_no_rule_fires_outside_the_labelled_positives_clean_generator(m1, claims_con):
    """The generator's legitimate data is rule-clean, so precision is exactly 1.0 here (a lower bound in general)."""
    gt = duckdb.connect(str(m1["paths"]["gt"]), read_only=True)
    pos = {(c, n) for c, n in gt.execute(
        "SELECT claim_id, line_no FROM gt_claim_label WHERE label = 'POSITIVE'").fetchall()}
    gt.close()
    hits = rules.run_all_rules(claims_con.cursor(), store=False)
    extra = {(c, n) for c, n in zip(hits.claim_id, hits.line_no, strict=True)} - pos
    assert not extra, f"{len(extra)} unlabelled hits"


def test_decoys_are_never_flagged(m1, claims_con):
    assert m1["summary"]["decoys"]["lines"] > 0
    assert m1["summary"]["decoys"]["falselyFlagged"] == 0


def test_no_normal_claim_after_death_or_for_stopped_excluded_provider(claims_con):
    # only the injected post-death scheme (provider P-0005) may bill after death
    rows = claims_con.execute("""SELECT DISTINCT l.rendering_provider_id FROM claim_line l
        JOIN claim c USING (claim_id) JOIN member m USING (member_id)
        WHERE m.death_dt IS NOT NULL AND l.service_dt > m.death_dt""").fetchall()
    assert {r[0] for r in rows} == {mini.ROLE["dod"]}
    n = claims_con.execute("""SELECT COUNT(*) FROM claim_line l
        JOIN exclusion e ON e.provider_id = l.rendering_provider_id
        WHERE e.provider_id = ? AND l.service_dt >= e.excl_dt""", [mini.ROLE["excl_stops"]]).fetchone()[0]
    assert n == 0


def test_database_files_exist(m1):
    for p in m1["paths"].values():
        assert Path(p).exists()
