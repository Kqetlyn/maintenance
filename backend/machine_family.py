"""
machine_family.py — Canonical machine family classification.

Centralised lookup used by:
  - downtime_service.py (_sql_row_to_enriched)
  - downtime_management.py (enrich_work_order_records)
  - mira services (presentation_service, predictive_service)

Add/update MACHINE_FAMILY_RULES when new asset types are introduced.
Rules are matched in order; first match wins.
"""
import re

# ── Machine family rules ───────────────────────────────────────────────────────
# (regex pattern, canonical_family_name)
# Matched against: asset_name + " " + fine_machine_group, lower-cased.
# Broad category tokens (Production Equipment etc.) are stripped before matching.

MACHINE_FAMILY_RULES: list[tuple[str, str]] = [
    # Production Equipment ─────────────────────────────────────────────────────
    ("bratt.?pan",                          "Bratt Pan"),
    ("spiral.?blast.?freezer",              "Spiral Blast Freezer"),
    ("air.?blast.?freezer|blast.?freezer",  "Air Blast Freezer"),
    ("blast.?chiller",                      "Blast Chiller"),
    ("combi.?oven",                         "Combi Oven"),
    ("food.?mixer|planetary.?mixer",        "Food Mixer"),
    ("packing.?machine|packaging.?machine", "Packing Machine"),
    ("dicing.?machine|dicer",               "Dicing Machine"),
    ("slicing.?machine|slicer",             "Slicing Machine"),
    ("conveyor",                            "Conveyor"),
    ("cooking.?kettle|tilting.?kettle|steam.?jacketed", "Cooking Kettle"),
    ("tilting.?pan",                        "Tilting Pan"),
    ("vacuum.?pack|vacuum.?seal",           "Vacuum Packing Machine"),
    ("tray.?seal",                          "Tray Sealer"),
    ("labelling.?machine|labeler|label.?applicator", "Labelling Machine"),
    ("metal.?detector",                     "Metal Detector"),
    ("checkweigher|check.?weigher",         "Checkweigher"),
    ("wrapping.?machine|wrapper",           "Wrapping Machine"),
    ("filling.?machine|filler",             "Filling Machine"),
    ("portion.?cutter|portion.?cut",        "Portion Cutter"),
    ("tumbler|marinator",                   "Tumbler / Marinator"),
    ("oven(?!.*combi)",                     "Conventional Oven"),
    ("deep.?fry|fryer",                     "Fryer"),
    ("smoker|smoking.?chamber",             "Smoker"),
    ("grinder|mincer|meat.?grinder",        "Meat Grinder"),
    ("band.?saw|bone.?saw",                 "Band Saw"),
    ("injection.?machine",                  "Injection Machine"),
    ("tenderizer",                          "Tenderizer"),
    ("de-?rinder|rinding",                  "De-rinder"),
    ("de-?boner|deboning|boner",            "De-boner"),
    # Refrigeration ────────────────────────────────────────────────────────────
    ("evaporator.*cdu|cdu.*evaporator|cdu", "Evaporator CDU"),
    ("evaporator",                          "Evaporator"),
    ("freezer.?room|cold.?store",           "Freezer Room"),
    ("cold.?room|chilled.?room|cool.?room", "Cold Room"),
    ("blast.?freezer",                      "Air Blast Freezer"),
    ("chiller(?!.*blast)",                  "Chiller"),
    ("freezer(?!.*(room|store))",           "Freezer Unit"),
    ("condenser.?unit|condensing.?unit",    "Condenser Unit"),
    ("cooling.?tower",                      "Cooling Tower"),
    ("heat.?exchanger",                     "Heat Exchanger"),
    ("refriger",                            "Refrigeration System"),
    # Utilities ────────────────────────────────────────────────────────────────
    ("sand.?filter|media.?filter",          "Sand Filter Tank"),
    ("ro.?system|reverse.?osmosis",         "RO System"),
    ("water.?treatment",                    "Water Treatment"),
    ("water.?softener|softener",            "Water Softener"),
    ("boiler(?!.*pump)",                    "Boiler"),
    ("air.?compressor|compressor.?air|compressed.?air", "Air Compressor"),
    ("pump(?!.*(heat|boiler))",             "Pump"),
    ("air.?handling|ahu",                   "Air Handling Unit"),
    ("hvac|air.?conditioning",              "HVAC / Air Conditioning"),
    ("exhaust.?fan|ventilat",               "Ventilation Fan"),
    ("generator|genset",                    "Generator"),
    ("transformer|electrical.?panel|panel.?board", "Electrical Panel"),
    ("ups|uninterruptible",                 "UPS"),
    ("lift|elevator",                       "Lift / Elevator"),
    ("forklift",                            "Forklift"),
    # Facility ─────────────────────────────────────────────────────────────────
    ("guardhouse|gate.?house",              "Guardhouse"),
    ("lighting|light.?fitting|lamp",        "Lighting"),
    ("cctv|camera|security.?system",        "CCTV / Security"),
    ("fire.?extinguisher|sprinkler|fire.?suppress", "Fire Safety"),
    ("weighing.?scale|platform.?scale",     "Weighing Scale"),
    ("plumbing|drain(?!.*(compressor))",    "Plumbing / Drainage"),
    ("building|structure|roof",             "Building Infrastructure"),
    ("door(?!.*seal)|gate(?!.*(forklift|guardhouse))", "Door / Gate"),
]

# ── Compiled rules (lazy-initialised) ─────────────────────────────────────────
_COMPILED: list[tuple[re.Pattern, str]] | None = None

def _get_compiled() -> list[tuple[re.Pattern, str]]:
    global _COMPILED
    if _COMPILED is None:
        _COMPILED = [(re.compile(pat, re.IGNORECASE), fam) for pat, fam in MACHINE_FAMILY_RULES]
    return _COMPILED


# ── Broad category tokens to strip before keyword matching ────────────────────
_BROAD_TOKENS = re.compile(
    r"\b(production equipment|facility[/ ]*building|facility|utilities|refrigeration|"
    r"unknown[/ ]*review|unmapped\s*asset|unknown|review|unclassified|unmapped)\b",
    re.IGNORECASE,
)

# Trailing unit numbers / codes — "1", "No. 2", "#3", "Unit 4", "CDU12-UC12 7"
_UNIT_SUFFIX = re.compile(
    r"\s+(?:no\.?\s*|#\s*|unit\s*|-\s*)?\d+[\w\-]*$",
    re.IGNORECASE,
)


def classify_machine_family(
    asset_name: str = "",
    fine_machine_group: str = "",   # mappedMachineGroup — specific group if available
    broad_category: str = "",       # mappedMainAssetGroup — broad grouping for context
) -> dict:
    """
    Return a dict:
      {
        "machine_family": str,     # canonical family (e.g. "Combi Oven")
        "machine_category": str,   # broad category for filtering
        "source": str,             # how it was derived
      }

    Derivation priority:
      1. Keyword match on fine_machine_group (most authoritative)
      2. Keyword match on asset_name
      3. Strip trailing unit number from asset_name → use base name
      4. Fall back to broad_category (if not a placeholder)
      5. "Unmapped / Review"
    """
    rules = _get_compiled()
    cat = str(broad_category or "").strip()

    for src_text, src_label in [
        (fine_machine_group, "machine_group"),
        (asset_name,         "asset_name"),
    ]:
        cleaned = _BROAD_TOKENS.sub("", str(src_text or "")).strip()
        if len(cleaned) < 3:
            continue
        for pat, family in rules:
            if pat.search(cleaned):
                return {"machine_family": family, "machine_category": cat, "source": src_label}

    # Strip unit number from asset_name and use the base as family
    base_name = _UNIT_SUFFIX.sub("", _BROAD_TOKENS.sub("", str(asset_name or "")).strip()).strip()
    if len(base_name) >= 3 and base_name.lower() not in {"unknown", "unmapped", "review", "unclassified", ""}:
        return {"machine_family": base_name, "machine_category": cat, "source": "stripped_name"}

    # Category fallback
    if cat and cat not in {"Unknown / Review", "Unmapped", "Unmapped Asset", "Unclassified", ""}:
        return {"machine_family": cat, "machine_category": cat, "source": "category_fallback"}

    return {"machine_family": "Unmapped / Review", "machine_category": cat or "Unclassified", "source": "unmapped"}


def strip_unit_number(name: str) -> str:
    """'Combi Oven 2' → 'Combi Oven', 'Bratt Pan 3' → 'Bratt Pan'."""
    result = _UNIT_SUFFIX.sub("", str(name or "")).strip()
    return result or str(name or "").strip()
