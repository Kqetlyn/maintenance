"""
backend/powerbi_adapter.py — Power BI direct export import adapter.

Handles detection, normalization, TTR validation, quality flagging, and
status normalization for Power BI D365 maintenance exports. Works through
the existing /api/downtime/import-work-orders endpoint without breaking
standard D365 Excel or CSV imports.

Detected format: POWERBI_MR_WO_TTR_EXPORT
Detected columns: Request State, Machine ID, Machine Name, Request ID,
  Requester, WO ID, Description, Location, JobTrade, JobTypeId,
  Responsible, WorkerG, Priority, ActualEnd, ActualStart, Sum of TTR_Hours
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

# ── Format identifiers ────────────────────────────────────────────────────────

POWERBI_MR_WO_TTR_FORMAT  = "POWERBI_MR_WO_TTR_EXPORT"
POWERBI_FULL_MR_WO_FORMAT = "POWERBI_FULL_MR_WO_EXPORT"
STANDARD_WO_FORMAT         = "work_orders"

# ── Power BI Full MR/WO signature (no TTR column) ────────────────────────────

# Must match ≥5 of these 6 keys to detect POWERBI_FULL_MR_WO_EXPORT.
_POWERBI_FULL_SIGNATURE_GROUPS: tuple[frozenset[str], ...] = (
    frozenset({"requeststate"}),
    frozenset({"machineid"}),
    frozenset({"machinename"}),
    frozenset({"requestid"}),
    frozenset({"actualstart", "actualstartdate"}),
    frozenset({"actualend", "actualenddate"}),
)
_POWERBI_FULL_THRESHOLD: int = 5

# ── Power BI TTR export signature ────────────────────────────────────────────

# Normalized column keys present in this specific PBI export format only.
_POWERBI_MR_WO_TTR_SIGNATURE: frozenset[str] = frozenset({
    "actualstart",
    "actualend",
    "sumofttrrhours",   # "Sum of TTR_Hours" normalized
    "sumofttr",         # shorter variant
})

# Generic PBI identity signals (Requester / Responsible / WorkerG).
_POWERBI_IDENTITY_COLUMNS: frozenset[str] = frozenset({
    "requester",
    "responsible",
    "workerg",
})

# Must match at least this many TTR/date signature columns for format detection.
_MR_WO_TTR_THRESHOLD: int = 2


def _norm(value: Any) -> str:
    """Normalize a column name to a lowercase alphanumeric key."""
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _detection_columns(df: Any) -> list:
    """
    Return the column list to use for Power BI format detection.

    Prefers the file's original (pre-alias) headers when the caller stashed
    them at df.attrs["raw_columns"]. Once column names have been rewritten to
    canonical names (e.g. "Asset" -> "Machine ID"), a plain D365 export and a
    genuine Power BI export become indistinguishable, since both end up using
    the same canonical headers — so detection must run on raw headers.
    """
    attrs = getattr(df, "attrs", None)
    if isinstance(attrs, dict) and attrs.get("raw_columns") is not None:
        return attrs["raw_columns"]
    return list(getattr(df, "columns", []))


def detect_powerbi_full_mr_wo(df: Any) -> bool:
    """
    Return True specifically for POWERBI_FULL_MR_WO_EXPORT:
    the full MR/WO export that has ActualStart/ActualEnd but NO TTR column.
    Requires ≥5 of the 6 signature columns and must NOT have TTR columns
    (those belong to POWERBI_MR_WO_TTR_EXPORT).
    """
    cols = {_norm(c) for c in _detection_columns(df)}
    hits = sum(1 for group in _POWERBI_FULL_SIGNATURE_GROUPS if cols & group)
    has_ttr = any(s in cols for s in (_POWERBI_MR_WO_TTR_SIGNATURE - {"actualstart", "actualend"}))
    return hits >= _POWERBI_FULL_THRESHOLD and not has_ttr


def detect_powerbi_export(df: Any) -> bool:
    """Return True when any Power BI export format is detected (generic check)."""
    cols = {_norm(c) for c in _detection_columns(df)}
    identity_hits = sum(1 for s in _POWERBI_IDENTITY_COLUMNS if s in cols)
    ttr_hits      = sum(1 for s in _POWERBI_MR_WO_TTR_SIGNATURE if s in cols)
    full_hits     = sum(1 for group in _POWERBI_FULL_SIGNATURE_GROUPS if cols & group)
    return identity_hits >= 2 or ttr_hits >= 1 or full_hits >= _POWERBI_FULL_THRESHOLD


def detect_powerbi_mr_wo_ttr(df: Any) -> bool:
    """
    Return True specifically for the POWERBI_MR_WO_TTR_EXPORT format that
    contains ActualStart, ActualEnd, and Sum of TTR_Hours.
    """
    cols = {_norm(c) for c in _detection_columns(df)}
    ttr_hits = sum(1 for s in _POWERBI_MR_WO_TTR_SIGNATURE if s in cols)
    has_id_cols = sum(1 for s in _POWERBI_IDENTITY_COLUMNS if s in cols)
    return ttr_hits >= _MR_WO_TTR_THRESHOLD or (ttr_hits >= 1 and has_id_cols >= 1)


def get_import_format_name(df: Any) -> str:
    """Return the format name string for the given DataFrame."""
    if detect_powerbi_full_mr_wo(df):
        return POWERBI_FULL_MR_WO_FORMAT
    if detect_powerbi_mr_wo_ttr(df):
        return POWERBI_MR_WO_TTR_FORMAT
    return STANDARD_WO_FORMAT


def get_powerbi_source_type(df: Any) -> str:
    """Return 'powerbi' if a Power BI format is detected, else 'work_orders'."""
    return "powerbi" if detect_powerbi_export(df) else "work_orders"


# ── Column extras not in WORK_ORDER_COLUMN_ALIASES ───────────────────────────

# Normalized key → canonical column name (supplements WORK_ORDER_ALIAS_LOOKUP).
POWERBI_EXTRA_ALIASES: dict[str, str] = {
    "requester":        "Created By",
    "responsible":      "Started By",
    "workerg":          "Worker Group",
    "workergroup":      "Worker Group",
    "workg":            "Worker Group",
    "workergrp":        "Worker Group",
    "actualstart":      "Actual Start Date",
    "actualend":        "Actual End Date",
    "sumofttrrhours":   "TTR(hr)",
    "sumofttr":         "TTR(hr)",
    "ttrhours":         "TTR(hr)",
    "ttrhour":          "TTR(hr)",
    "ttr_hours":        "TTR(hr)",
}

# ── Validation ────────────────────────────────────────────────────────────────

POWERBI_REQUIRED_CANONICAL: frozenset[str] = frozenset({
    "Request ID",
    "WO ID",
    "Machine ID",
    "Machine Name",
    "Description",
    "Request State",
    "Priority",
    "Actual Start Date",
    "Actual End Date",
    "TTR(hr)",
})

POWERBI_FULL_REQUIRED_CANONICAL: frozenset[str] = frozenset({
    "Request ID",
    "WO ID",
    "Machine ID",
    "Machine Name",
    "Description",
    "Request State",
    "Priority",
    "Actual Start Date",
    "Actual End Date",
})


def _build_column_map(df: Any) -> dict[str, str]:
    """Build raw_col → canonical_name mapping for every column in df."""
    try:
        from downtime_service import WORK_ORDER_ALIAS_LOOKUP, normalize_work_order_column_key
    except ImportError:
        return {str(c).strip(): str(c).strip() for c in getattr(df, "columns", [])}

    combined: dict[str, str] = dict(WORK_ORDER_ALIAS_LOOKUP)
    combined.update(POWERBI_EXTRA_ALIASES)

    result: dict[str, str] = {}
    for raw_col in getattr(df, "columns", []):
        clean = str(raw_col).strip()
        key = _norm(clean)
        canonical = (
            combined.get(key)
            or combined.get(normalize_work_order_column_key(clean))
            or clean
        )
        result[clean] = canonical
    return result


def validate_powerbi_columns(df: Any) -> dict:
    """
    Validate that all required canonical columns are resolvable from df.
    Returns ok, missing, found, column_map, sample_rows, total_rows, message.
    """
    col_map = _build_column_map(df)
    present = set(col_map.values())

    required = POWERBI_FULL_REQUIRED_CANONICAL if detect_powerbi_full_mr_wo(df) else POWERBI_REQUIRED_CANONICAL
    missing = sorted(required - present)
    found   = sorted(required & present)

    sample_rows: list[dict] = []
    try:
        head = df.head(10).dropna(how="all")
        for _, row in head.iterrows():
            mapped: dict[str, str] = {}
            for raw_col, canonical in col_map.items():
                val = row.get(raw_col)
                if val is None:
                    continue
                if isinstance(val, float) and math.isnan(val):
                    continue
                str_val = str(val).strip()
                if str_val:
                    mapped[canonical] = str_val
            if mapped:
                sample_rows.append(mapped)
            if len(sample_rows) >= 3:
                break
    except Exception:
        pass

    total_rows = len(df) if hasattr(df, "__len__") else 0

    message = (
        f"All {len(found)} required column(s) found. {total_rows} row(s) ready to import."
        if not missing
        else f"Missing required column(s): {', '.join(missing)}."
    )

    return {
        "ok": not missing,
        "missing": missing,
        "found": found,
        "column_map": col_map,
        "sample_rows": sample_rows,
        "total_rows": total_rows,
        "message": message,
    }


# ── Status normalization ──────────────────────────────────────────────────────

_FINISHED_STATES  = {"finished", "confirm", "closed", "completed", "done", "confirmed"}
_INPROGRESS_STATES = {"in progress", "inprogress", "started", "open", "rework", "re work", "rework"}
_NEW_STATES       = {"new", "created", "requested"}
_REJECTED_STATES  = {"rejected", "reject", "cancelled", "canceled"}


def normalize_request_state(raw: Any) -> str:
    """
    Derive a clean normalized status from the raw Request State value.
    Finished / Confirm / Closed / Completed → 'Finished'
    In Progress / Started / Open / reWork    → 'In Progress'
    New / Created / Requested                → 'New'
    Rejected                                 → 'Rejected'
    Anything else                            → original value (stripped)
    """
    v = str(raw or "").strip().lower()
    if v in _FINISHED_STATES:
        return "Finished"
    if v in _INPROGRESS_STATES:
        return "In Progress"
    if v in _NEW_STATES:
        return "New"
    if v in _REJECTED_STATES:
        return "Rejected"
    return str(raw or "").strip() or "Unknown"


# ── TTR computation ───────────────────────────────────────────────────────────

_DATE_FMTS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y")


def _parse_dt(s: Any) -> datetime | None:
    text = str(s or "").strip()
    if not text:
        return None
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def compute_ttr_hours(
    ttr_raw: Any,
    start_str: Any,
    end_str: Any,
) -> tuple[float | None, str | None]:
    """
    Return (ttr_hours, flag).

    Priority:
    1. ttr_raw (Sum of TTR_Hours) if numeric and > 0
    2. Derived from (ActualEnd - ActualStart)

    Flag is one of: None (OK), 'Missing ActualStart', 'Missing ActualEnd',
    'Invalid Date Sequence', 'Missing TTR'
    """
    has_start = bool(str(start_str or "").strip())
    has_end   = bool(str(end_str or "").strip())

    if not has_start:
        return None, "Missing ActualStart"
    if not has_end:
        return None, "Missing ActualEnd"

    start_dt = _parse_dt(start_str)
    end_dt   = _parse_dt(end_str)

    if start_dt and end_dt and end_dt < start_dt:
        return None, "Invalid Date Sequence"

    # Try the explicit TTR field first.
    ttr_str = str(ttr_raw or "").strip().replace(",", "")
    if ttr_str:
        try:
            val = float(ttr_str)
            if val >= 0:
                return round(val, 4), None
        except (ValueError, TypeError):
            pass

    # Derive from dates.
    if start_dt and end_dt and end_dt >= start_dt:
        return round((end_dt - start_dt).total_seconds() / 3600, 4), None

    return None, "Missing TTR"


# ── Data quality flags ────────────────────────────────────────────────────────

def build_data_quality_flags(
    asset_id: Any,
    wo_id: Any,
    actual_start: Any,
    actual_end: Any,
    ttr_flag: str | None,
    status: str = "",
) -> list[str]:
    """
    Build the quality flag list for a single row.
    Returns ['OK'] when everything is present and valid.

    Flags (non-exclusive):
      Missing Asset        — Machine ID blank
      Missing WO ID        — WO ID blank
      Missing ActualStart  — ActualStart blank
      Missing ActualEnd    — ActualEnd blank
      Invalid Date Sequence — ActualEnd < ActualStart
      Missing TTR          — TTR cannot be computed
    """
    flags: list[str] = []
    if not str(asset_id or "").strip():
        flags.append("Missing Asset")
    if not str(wo_id or "").strip():
        flags.append("Missing WO ID")
    if not str(actual_start or "").strip():
        flags.append("Missing ActualStart")
    if not str(actual_end or "").strip():
        flags.append("Missing ActualEnd")
    if ttr_flag and ttr_flag not in ("Missing ActualStart", "Missing ActualEnd"):
        flags.append(ttr_flag)
    return flags or ["OK"]


# ── Pre-import file stats ────────────────────────────────────────────────────

def compute_file_stats(df: Any) -> dict:
    """
    Compute per-file quality stats from the canonicalized DataFrame before
    any DB write. Used to populate the import response immediately.
    """
    try:
        import pandas as pd
    except ImportError:
        return {}

    total = len(df)
    missing_asset   = 0
    missing_wo      = 0
    missing_start   = 0
    missing_end     = 0
    bad_seq         = 0
    missing_ttr     = 0

    start_col  = "Actual Start Date"
    end_col    = "Actual End Date"
    ttr_col    = "TTR(hr)"
    asset_col  = "Machine ID"
    wo_col     = "WO ID"

    def _str(val: Any) -> str:
        """Convert a cell value to string, treating NaN/None/float-nan as empty."""
        if val is None:
            return ""
        try:
            if isinstance(val, float) and math.isnan(val):
                return ""
        except Exception:
            pass
        return str(val).strip()

    for _, row in df.iterrows():
        s_val = _str(row.get(start_col))  if start_col  in df.columns else ""
        e_val = _str(row.get(end_col))    if end_col    in df.columns else ""
        t_val = _str(row.get(ttr_col))    if ttr_col    in df.columns else ""
        a_val = _str(row.get(asset_col))  if asset_col  in df.columns else ""
        w_val = _str(row.get(wo_col))     if wo_col     in df.columns else ""

        if not a_val:
            missing_asset += 1
        if not w_val:
            missing_wo += 1
        if not s_val:
            missing_start += 1
        if not e_val:
            missing_end += 1

        if s_val and e_val:
            s_dt = _parse_dt(s_val)
            e_dt = _parse_dt(e_val)
            if s_dt and e_dt and e_dt < s_dt:
                bad_seq += 1

        if not t_val and not (s_val and e_val):
            missing_ttr += 1

    return {
        "total_rows":              total,
        "rows_with_missing_asset": missing_asset,
        "rows_with_missing_wo":    missing_wo,
        "rows_with_missing_start": missing_start,
        "rows_with_missing_end":   missing_end,
        "rows_with_bad_sequence":  bad_seq,
        "rows_with_missing_ttr":   missing_ttr,
    }
