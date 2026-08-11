"""Phase 5B — equipment capability & approved-fallback resolution.

Fallback CANDIDATES are derived from the maintenance asset master (same machine_group +
same facility_stage, a different asset) — self-contained, no production dependency. A
candidate only becomes an APPROVED fallback when ``equipment_capability`` carries
``approved_fallback = 1`` AND all three sign-offs (production, engineering, QA).

The planner (Phase 4) may auto-assign approved fallbacks only; candidates are surfaced as
"possible alternatives" that still require approval. Approvals are maintained in a
controlled JSON file (``equipment_capability.json`` in the maintenance data dir) and
upserted idempotently into the DB — nothing is auto-approved.
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict

import db

try:
    from runtime_config import DATA_DIR
except Exception:                       # pragma: no cover - defensive
    DATA_DIR = "."

_CAPABILITY_FILE = os.path.join(str(DATA_DIR), "equipment_capability.json")
_SYNC_LOCK = threading.Lock()
_SYNC_STATE = {"mtime": None}


def sync_from_file(path: str | None = None) -> int:
    """Upsert approved-fallback definitions from the controlled JSON file into the DB.

    mtime-guarded: an unchanged file costs a single stat() and writes nothing, so this is
    cheap to call on every read. Returns the number of rows upserted this call.
    """
    path = path or _CAPABILITY_FILE
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return 0
    with _SYNC_LOCK:
        if _SYNC_STATE["mtime"] == mtime:
            return 0
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return 0
        rows = [{
            "asset_id": entry.get("substitute_asset_id"),
            "fallback_for_asset_id": entry.get("for_asset_id"),
            "capability_key": entry.get("capability_key"),
            "facility_stage": entry.get("facility_stage"),
            "equipment_family": entry.get("equipment_family"),
            "rated_capacity": entry.get("rated_capacity"),
            "capacity_unit": entry.get("capacity_unit"),
            "approved_fallback": entry.get("approved_fallback", True),
            "approved_by_production": entry.get("approved_by_production"),
            "approved_by_engineering": entry.get("approved_by_engineering"),
            "approved_by_qa": entry.get("approved_by_qa"),
            "approval_notes": entry.get("notes"),
            "source_updated_at": entry.get("source_updated_at"),
        } for entry in (data.get("approved_fallbacks") or [])]
        try:
            written = db.upsert_equipment_capability(rows)
        except Exception:
            # The table may not exist yet (pre-migration). Do not advance the mtime guard
            # so the sync retries once init_db has created equipment_capability.
            return 0
        _SYNC_STATE["mtime"] = mtime
        return written


def _capability_key(asset: dict) -> str:
    return asset.get("machine_group") or asset.get("category") or "unclassified"


def build_fallbacks(asset_ids: list[str]) -> dict:
    """Per requested original asset, its capability and the ranked fallback options.

    Approved fallbacks (all three sign-offs) rank first and are auto-assignable; the rest
    are candidates requiring approval.
    """
    sync_from_file()
    wanted = [str(a or "").strip().upper() for a in asset_ids if str(a or "").strip()]
    all_assets = db.query_asset_master()
    by_id = {str(a.get("asset_id")): a for a in all_assets}

    peers: dict = defaultdict(list)
    for asset in all_assets:
        peers[(_capability_key(asset), asset.get("stage"))].append(asset)

    approved = db.query_equipment_capability(for_asset_ids=wanted, approved_only=True)
    approved_pairs = {
        (str(row.get("fallback_for_asset_id") or "").upper(), str(row.get("asset_id") or "").upper()): row
        for row in approved
    }

    result: dict = {}
    for asset_id in wanted:
        asset = by_id.get(asset_id)
        if not asset:
            result[asset_id] = {
                "asset_id": asset_id, "capability_key": None, "facility_stage": None,
                "asset_name": None, "fallbacks": [], "approved_count": 0,
                "reason": "Unknown Asset ID.",
            }
            continue
        key = _capability_key(asset)
        stage = asset.get("stage")
        fallbacks = []
        for candidate in peers[(key, stage)]:
            candidate_id = str(candidate.get("asset_id"))
            if candidate_id == asset_id:
                continue
            approval = approved_pairs.get((asset_id, candidate_id.upper()))
            fallbacks.append({
                "asset_id": candidate_id,
                "asset_name": candidate.get("asset_name"),
                "facility_stage": candidate.get("stage"),
                "capability_key": key,
                "status": "approved" if approval else "candidate",
                "approvals": {
                    "production": bool(approval and approval.get("approved_by_production")),
                    "engineering": bool(approval and approval.get("approved_by_engineering")),
                    "qa": bool(approval and approval.get("approved_by_qa")),
                },
                "rated_capacity": (approval or {}).get("rated_capacity"),
                "approval_notes": (approval or {}).get("approval_notes"),
            })
        fallbacks.sort(key=lambda item: (item["status"] != "approved", item["asset_id"]))
        result[asset_id] = {
            "asset_id": asset_id,
            "capability_key": key,
            "facility_stage": stage,
            "asset_name": asset.get("asset_name"),
            "fallbacks": fallbacks,
            "approved_count": sum(1 for item in fallbacks if item["status"] == "approved"),
        }
    return result
