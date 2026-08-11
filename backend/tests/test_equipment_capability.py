"""Phase 5B — capability / approved-fallback resolution and the approval gate."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import equipment_capability_service as capability


ASSETS = [
    {"asset_id": "BP-1", "asset_name": "Bratt Pan 1", "stage": "Stage 1", "machine_group": "Bratt Pans"},
    {"asset_id": "BP-2", "asset_name": "Bratt Pan 2", "stage": "Stage 1", "machine_group": "Bratt Pans"},
    {"asset_id": "BP-9", "asset_name": "Bratt Pan (S2)", "stage": "Stage 2", "machine_group": "Bratt Pans"},
    {"asset_id": "CO-1", "asset_name": "Combi Oven 1", "stage": "Stage 1", "machine_group": "Combi Ovens"},
]


def _patch(monkeypatch, approved_rows):
    monkeypatch.setattr(capability, "sync_from_file", lambda *a, **k: 0)
    monkeypatch.setattr(capability.db, "query_asset_master", lambda: list(ASSETS))
    monkeypatch.setattr(capability.db, "query_equipment_capability",
                        lambda for_asset_ids=None, approved_only=False: list(approved_rows) if approved_only else [])


def test_candidates_are_same_group_and_stage(monkeypatch):
    _patch(monkeypatch, [])
    result = capability.build_fallbacks(["BP-1"])
    fb = result["BP-1"]["fallbacks"]
    ids = {f["asset_id"] for f in fb}
    assert ids == {"BP-2"}                       # BP-9 is Stage 2, CO-1 is a Combi Oven
    assert fb[0]["status"] == "candidate"        # nothing approved yet
    assert result["BP-1"]["approved_count"] == 0


def test_stage_2_same_name_is_not_a_candidate(monkeypatch):
    _patch(monkeypatch, [])
    result = capability.build_fallbacks(["BP-9"])
    assert result["BP-9"]["fallbacks"] == []     # only Stage 2 Bratt Pan present; no same-stage peer


def test_full_signoff_makes_candidate_approved(monkeypatch):
    approved = [{"fallback_for_asset_id": "BP-1", "asset_id": "BP-2",
                 "approved_by_production": 1, "approved_by_engineering": 1, "approved_by_qa": 1,
                 "rated_capacity": 1.0, "approval_notes": "ok"}]
    _patch(monkeypatch, approved)
    result = capability.build_fallbacks(["BP-1"])
    fb = result["BP-1"]["fallbacks"][0]
    assert fb["status"] == "approved"
    assert fb["approvals"] == {"production": True, "engineering": True, "qa": True}
    assert result["BP-1"]["approved_count"] == 1


def test_partial_signoff_stays_candidate(monkeypatch):
    # query_equipment_capability(approved_only=True) only returns fully-approved rows, so a
    # partially-approved pair simply never appears -> the candidate stays a candidate.
    _patch(monkeypatch, [])
    result = capability.build_fallbacks(["BP-1"])
    assert result["BP-1"]["fallbacks"][0]["status"] == "candidate"
    assert result["BP-1"]["approved_count"] == 0


def test_unknown_asset_reports_reason(monkeypatch):
    _patch(monkeypatch, [])
    result = capability.build_fallbacks(["NOPE"])
    assert result["NOPE"]["fallbacks"] == []
    assert result["NOPE"]["reason"] == "Unknown Asset ID."
