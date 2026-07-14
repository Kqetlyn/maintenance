"""
Controlled Food Mixer operational-alias mapping.

Gold/Silver are operational nicknames found in maintenance descriptions. Source
asset IDs are never overwritten; callers use the derived canonical fields only
for mixer tracking and reliability grouping.
"""
from __future__ import annotations

import re
from typing import Any


FOOD_MIXER_GROUP = "Food Mixers"
GENERAL_LOW_RISK_ASSET_ID = "ENWA-240009"
GOLD_UNRESOLVED_ASSET_ID = "MIXER-GOLD-UNRESOLVED"
MIXER_UNRESOLVED_ASSET_ID = "MIXER-UNRESOLVED"

SPECIFIC_MIXER_ASSETS: dict[str, dict[str, Any]] = {
    "ENPD-240051": {
        "canonical_asset_id": "ENPD-240051",
        "canonical_asset_name": "Food Mixer 1",
        "display_alias": "Gold",
        "expected_alias": "Gold",
        "mapping_confidence": "High",
        "allow_mtbf": True,
        "notes": "Official Food Mixer 1 asset ID from Asset Master.",
    },
    "ENPD-240052": {
        "canonical_asset_id": "ENPD-240052",
        "canonical_asset_name": "Food Mixer 2",
        "display_alias": "Silver",
        "expected_alias": "Silver",
        "mapping_confidence": "High",
        "allow_mtbf": True,
        "notes": "Official Food Mixer 2 asset ID from Asset Master.",
    },
    "ENPD-240053": {
        "canonical_asset_id": "ENPD-240053",
        "canonical_asset_name": "Food Mixer 3",
        "display_alias": None,
        "expected_alias": None,
        "mapping_confidence": "High",
        "allow_mtbf": True,
        "notes": "Official Food Mixer 3 asset ID from Asset Master.",
    },
}

ALIAS_RULES: dict[str, dict[str, Any]] = {
    "Silver": {
        "keywords": ["น้องเงิน", "silver"],
        "canonical_asset_id": "ENPD-240052",
        "canonical_asset_name": "Food Mixer 2 (Silver)",
        "mapping_confidence": "High",
        "allow_mtbf": True,
        "notes": "Mapped from Silver mixer alias found in MR description.",
    },
    "Gold": {
        "keywords": ["น้องทอง", "สีทอง", "gold", "golden"],
        "canonical_asset_id": GOLD_UNRESOLVED_ASSET_ID,
        "canonical_asset_name": "Gold Mixer - Asset Unresolved",
        "mapping_confidence": "Low",
        "allow_mtbf": False,
        "notes": "Gold alias requires verification before assigning to a physical mixer.",
    },
}

MIXER_KEYWORDS = [
    "mixer",
    "mix",
    "mixed",
    "mixing",
    "เครื่อง mixer",
    "เครื่อง mix",
    "น้องทอง",
    "สีทอง",
    "น้องเงิน",
]

MULTIPLE_MACHINE_KEYWORDS = [
    "both machines",
    "both mixers",
    "2 machines",
    "two machines",
    "ทั้งสองเครื่อง",
    "2 เครื่อง",
]

# Future confirmed mappings can be added here without changing MTTR/MTBF code.
# Keys may be MR number, WO number, source asset ID, or "MR|WO".
MANUAL_OVERRIDES: dict[str, dict[str, Any]] = {}


def _compact(text: str) -> str:
    return re.sub(r"[\s\-_()/\[\]{}]+", "", text.lower())


def _normal_text(*values: Any) -> str:
    return " ".join(str(v or "").lower() for v in values)


def _contains_keyword(text: str, compact_text: str, keyword: str) -> bool:
    low = keyword.lower()
    if re.search(r"[a-z0-9]", low):
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(low)}(?![a-z0-9])", text)) or _compact(low) in compact_text
    return low in text or _compact(low) in compact_text


def detect_mixer_alias(description: str, asset_name: str = "", machine_group: str = "") -> dict[str, Any]:
    text = _normal_text(description, asset_name, machine_group)
    compact_text = _compact(text)
    aliases = [
        alias
        for alias, rule in ALIAS_RULES.items()
        if any(_contains_keyword(text, compact_text, kw) for kw in rule["keywords"])
    ]
    is_mixer = any(_contains_keyword(text, compact_text, kw) for kw in MIXER_KEYWORDS)
    if any(token in text for token in ("food mixer", "foodmixer")):
        is_mixer = True
    multiple = any(_contains_keyword(text, compact_text, kw) for kw in MULTIPLE_MACHINE_KEYWORDS)
    return {
        "is_mixer_related": is_mixer or bool(aliases),
        "aliases": aliases,
        "mixer_alias": " / ".join(aliases) if aliases else None,
        "multiple_machines_mentioned": multiple,
    }


def _display_name(base_name: str, alias: str | None) -> str:
    if alias and f"({alias})" not in base_name:
        return f"{base_name} ({alias})"
    return base_name


def _manual_override_key(row: dict[str, Any]) -> dict[str, Any] | None:
    candidates = [
        row.get("maintenance_order_id"),
        row.get("mr_number"),
        row.get("request_id"),
        row.get("work_order_id"),
        row.get("wo_number"),
        f"{row.get('maintenance_order_id') or row.get('mr_number') or row.get('request_id') or ''}|{row.get('work_order_id') or row.get('wo_number') or ''}",
        row.get("asset_id"),
    ]
    for key in candidates:
        clean = str(key or "").strip()
        if clean and clean in MANUAL_OVERRIDES:
            return MANUAL_OVERRIDES[clean]
    return None


def _base_result(source_asset_id: str, source_asset_name: str, detection: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_asset_id": source_asset_id,
        "source_asset_name": source_asset_name,
        "mixer_alias": detection["mixer_alias"],
        "mixer_aliases": detection["aliases"],
        "mixer_multiple_machines": detection["multiple_machines_mentioned"],
        "mixer_related": detection["is_mixer_related"],
        "canonical_asset_id": source_asset_id,
        "canonical_asset_name": source_asset_name,
        "canonical_machine_group": FOOD_MIXER_GROUP if detection["is_mixer_related"] else "",
        "alias_mtbf_include": True,
        "mapping_confidence": None,
        "mapping_note": None,
        "alias_mapping_status": None,
        "alias_mapping_review_status": None,
        "alias_mapping_review_required": False,
    }


def apply_mixer_alias_mapping(row: dict[str, Any]) -> dict[str, Any]:
    source_asset_id = str(row.get("asset_id") or "").strip().upper()
    source_asset_name = str(row.get("asset_name") or row.get("asset_display_name") or "").strip()
    description = str(row.get("description") or row.get("description_original") or row.get("remarks") or "").strip()
    machine_group = str(row.get("machine_group") or row.get("mappedMachineGroup") or "").strip()
    detection = detect_mixer_alias(description, source_asset_name, machine_group)
    result = _base_result(source_asset_id, source_asset_name, detection)

    manual = _manual_override_key(row)
    if manual:
        result.update(manual)
        result.update({
            "alias_mapping_status": "Manual override",
            "alias_mapping_review_status": "Confirmed",
            "mapping_confidence": manual.get("mapping_confidence", "High"),
            "mapping_note": manual.get("mapping_note", "Manual mixer alias override."),
            "canonical_machine_group": FOOD_MIXER_GROUP,
        })
        return result

    if source_asset_id in SPECIFIC_MIXER_ASSETS:
        cfg = SPECIFIC_MIXER_ASSETS[source_asset_id]
        expected_alias = cfg.get("expected_alias")
        detected_alias = detection["aliases"][0] if detection["aliases"] else None
        conflict = bool(expected_alias and detected_alias and detected_alias != expected_alias)
        canonical_name = cfg["canonical_asset_name"] if conflict else _display_name(cfg["canonical_asset_name"], detected_alias or cfg.get("display_alias"))
        result.update({
            "canonical_asset_id": cfg["canonical_asset_id"],
            "canonical_asset_name": canonical_name,
            "canonical_machine_group": FOOD_MIXER_GROUP,
            "alias_mtbf_include": bool(cfg.get("allow_mtbf", True)),
            "mapping_confidence": cfg.get("mapping_confidence", "High"),
            "alias_mapping_status": "Alias conflict" if conflict else "Confirmed by asset ID",
            "alias_mapping_review_status": "Conflict" if conflict else "Confirmed",
            "alias_mapping_review_required": conflict or detection["multiple_machines_mentioned"],
            "mapping_note": (
                f"{cfg['canonical_asset_name']} is normally associated with {expected_alias}, but this MR description states {detected_alias}. Verification required."
                if conflict else cfg.get("notes")
            ),
        })
        return result

    if source_asset_id == GENERAL_LOW_RISK_ASSET_ID and detection["is_mixer_related"]:
        aliases = set(detection["aliases"])
        if aliases == {"Silver"}:
            rule = ALIAS_RULES["Silver"]
            result.update({
                "canonical_asset_id": rule["canonical_asset_id"],
                "canonical_asset_name": rule["canonical_asset_name"],
                "canonical_machine_group": FOOD_MIXER_GROUP,
                "alias_mtbf_include": bool(rule["allow_mtbf"]),
                "mapping_confidence": rule["mapping_confidence"],
                "alias_mapping_status": "Alias inferred",
                "alias_mapping_review_status": "Alias inferred",
                "alias_mapping_review_required": detection["multiple_machines_mentioned"],
                "mapping_note": rule["notes"],
            })
            return result

        if "Gold" in aliases:
            rule = ALIAS_RULES["Gold"]
            result.update({
                "canonical_asset_id": rule["canonical_asset_id"],
                "canonical_asset_name": rule["canonical_asset_name"],
                "canonical_machine_group": FOOD_MIXER_GROUP,
                "alias_mtbf_include": False,
                "mapping_confidence": rule["mapping_confidence"],
                "alias_mapping_status": "Requires verification",
                "alias_mapping_review_status": "Unresolved",
                "alias_mapping_review_required": True,
                "mapping_note": rule["notes"],
            })
            return result

        result.update({
            "canonical_asset_id": MIXER_UNRESOLVED_ASSET_ID,
            "canonical_asset_name": "Mixer - Asset Unresolved",
            "canonical_machine_group": FOOD_MIXER_GROUP,
            "alias_mtbf_include": False,
            "mapping_confidence": "Low",
            "alias_mapping_status": "Requires verification",
            "alias_mapping_review_status": "Unresolved",
            "alias_mapping_review_required": True,
            "mapping_note": "Mixer keyword detected on generic Low Risk asset, but no specific mixer alias was identified.",
        })
        return result

    if detection["is_mixer_related"]:
        result.update({
            "canonical_asset_id": MIXER_UNRESOLVED_ASSET_ID,
            "canonical_asset_name": "Mixer - Asset Unresolved",
            "canonical_machine_group": FOOD_MIXER_GROUP,
            "alias_mtbf_include": False,
            "mapping_confidence": "Low",
            "alias_mapping_status": "Requires verification",
            "alias_mapping_review_status": "Unresolved",
            "alias_mapping_review_required": True,
            "mapping_note": "Mixer keyword detected, but the source asset is not a confirmed Food Mixer asset.",
        })

    return result


def alias_review_bucket(row: dict[str, Any]) -> str:
    status = str(row.get("alias_mapping_review_status") or row.get("alias_mapping_status") or "").lower()
    if "conflict" in status:
        return "Conflict"
    if "inferred" in status:
        return "Alias inferred"
    if "unresolved" in status or "verification" in status:
        return "Unresolved"
    if "confirmed" in status:
        return "Confirmed"
    return ""
