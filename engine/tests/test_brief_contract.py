"""Contract tests for the investigation-brief schema shared with the gateway (which owns the validator).

The gateway builds and validates briefs; the engine only has to keep the evidence pack compatible with them. These
tests pin the schema itself and check that a brief written the way the gateway writes it fits every pack the engine
produces: all cited IDs are pack IDs, and the mandatory limitations the brief must carry exist in the pack.
"""

import copy
import json
from pathlib import Path

import jsonschema
import pytest

REPO = Path(__file__).resolve().parents[2]
BRIEF_SCHEMA = json.loads((REPO / "contracts" / "schemas" / "brief_output.schema.json").read_text(encoding="utf-8"))
ACTIONS = {"REQUEST_RECORDS", "PROVIDER_EDUCATION", "MONITOR", "PREPAY_REVIEW_FLAG", "REFER_EXTERNAL"}


def sentence(text: str, *ids: str) -> dict:
    return {"text": text, "evidence_ids": list(ids)}


def minimal_brief() -> dict:
    return {
        "headline": sentence("Headline text", "E1"),
        "summary": [sentence("Summary text", "E1")],
        "case_context": [sentence("Context text", "TR1")],
        "timeline_notes": [sentence("2025-01-01: First flagged service.", "T1")],
        "network_notes": [sentence("No network evidence is available.", "L2")],
        "precedent_notes": [],
        "confidence_statement": sentence("Computed tier is MEDIUM.", "TR1"),
        "hypothesis": "DUP",
        "recommended_action": "REQUEST_RECORDS",
        "action_rationale": sentence("Suggested next step.", "E1"),
        "investigator_checklist": [sentence("Open the lines.", "E1")],
        "what_would_change_my_mind": [sentence("Records would lower concern.", "E1")],
        "limitations": [{"text": "All data is synthetic.", "limitation_ids": ["L1"]}],
        "insufficient_evidence": False,
    }


def errors(doc: dict) -> list[str]:
    v = jsonschema.Draft202012Validator(BRIEF_SCHEMA)
    return [e.message for e in v.iter_errors(doc)]


def test_schema_is_a_valid_draft_2020_12_schema():
    jsonschema.Draft202012Validator.check_schema(BRIEF_SCHEMA)
    assert BRIEF_SCHEMA["additionalProperties"] is False


def test_minimal_brief_is_accepted():
    assert errors(minimal_brief()) == []


@pytest.mark.parametrize(
    "section",
    ["headline", "summary", "case_context", "timeline_notes", "network_notes", "precedent_notes",
     "confidence_statement", "hypothesis", "recommended_action", "action_rationale", "investigator_checklist",
     "what_would_change_my_mind", "limitations", "insufficient_evidence"],
)
def test_every_section_is_required(section):
    doc = minimal_brief()
    del doc[section]
    assert errors(doc), f"{section} should be required"


def test_unknown_fields_are_rejected_at_every_level():
    doc = minimal_brief()
    doc["risk_score"] = 0.9
    assert errors(doc)
    doc = minimal_brief()
    doc["summary"][0]["confidence"] = 1
    assert errors(doc)
    doc = minimal_brief()
    doc["limitations"][0]["extra"] = 1
    assert errors(doc)


def test_the_required_elements_cannot_be_empty_or_uncited():
    for section in ("summary", "case_context", "timeline_notes", "network_notes", "investigator_checklist",
                    "what_would_change_my_mind", "limitations"):
        doc = minimal_brief()
        doc[section] = []
        assert errors(doc), f"{section} must not be empty"
    doc = minimal_brief()
    doc["summary"][0]["evidence_ids"] = []
    assert errors(doc)
    doc = minimal_brief()
    doc["limitations"][0]["limitation_ids"] = ["E1"]
    assert errors(doc)


def test_action_enum_matches_the_engines_policy_table():
    from claimshield import reference as ref

    schema_actions = set(BRIEF_SCHEMA["properties"]["recommended_action"]["enum"])
    assert schema_actions == ACTIONS
    for tier in ("LOW", "MEDIUM", "HIGH"):
        offered = {a["action"] for a in ref.permitted_actions(tier)}
        assert offered <= schema_actions, f"{tier} offers an action the brief schema cannot express"
    doc = minimal_brief()
    doc["recommended_action"] = "DENY_CLAIMS"
    assert errors(doc)


def test_every_published_pack_carries_what_a_brief_must_cite(app_con):
    """The gateway template cites E*, TR*, T*, L* IDs and quotes pack wording; they must exist for every case."""
    packs = [json.loads(r[0]) for r in app_con.execute("SELECT pack_json FROM serving_evidence_pack")]
    assert packs
    for p in packs:
        assert p["evidence"], p["caseId"]
        assert p["scores"]["tierReasons"], p["caseId"]
        assert p["timeline"], p["caseId"]
        mandatory = {lim["id"] for lim in p["limitations"] if lim["mandatory"]}
        assert {"L1", "L2"} <= mandatory, p["caseId"]
        assert p["permittedActions"], p["caseId"]
        assert p["defaultAction"] in {a["action"] for a in p["permittedActions"]}, p["caseId"]
        assert p["hypotheses"], p["caseId"]
        for key in ("S.risk", "S.dollars"):
            assert key in p["numbers"], (p["caseId"], key)
        # the validator treats numbers as placeholders owned by an evidence item: every E-key must have its owner
        owners = {k.split(".")[0] for k in p["numbers"]}
        assert owners <= {e["id"] for e in p["evidence"]} | {"S"}, p["caseId"]


def test_schema_copy_is_not_mutated_by_validation():
    before = copy.deepcopy(BRIEF_SCHEMA)
    errors(minimal_brief())
    assert BRIEF_SCHEMA == before
