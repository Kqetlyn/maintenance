"""
backend/powerbi_full_import.py — Import handler for the Power BI Full MR/WO export.

Format: POWERBI_FULL_MR_WO_EXPORT
Columns: Request State, Machine ID, Machine Name, Request ID, Requester,
         WO ID, Description, Location, JobTrade, JobTypeId, Responsible,
         WorkerG, Priority, ActualEnd, ActualStart

TTR is calculated from ActualStart and ActualEnd only — this format has no
TTR column. Each import creates a new batch that deactivates the previous
active batch, so the dashboard always shows the latest import only.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from powerbi_adapter import POWERBI_FULL_MR_WO_FORMAT


# ── Column alias map: normalized key → internal field name ───────────────────

_ALIAS: dict[str, str] = {
    "requeststate": "request_state",
    "machineid":    "asset_id",
    "machinename":  "asset_name",
    "requestid":    "request_id",
    "requester":    "requester",
    "createdby":    "requester",
    "woid":         "work_order_id",
    "workorderid":  "work_order_id",
    "description":  "description",
    "location":     "location",
    "jobtrade":     "job_trade",
    "jobtypeid":    "job_type_id",
    "requesttypeid": "request_type_id",
    "responsible":  "responsible",
    "startedby":    "responsible",
    "workerg":      "worker_group",
    "workergroup":  "worker_group",
    "priority":     "priority",
    "actualend":    "actual_end",
    "actualenddate": "actual_end",
    "actualstart":  "actual_start",
    "actualstartdate": "actual_start",
}

# ── Status normalization ──────────────────────────────────────────────────────

_FINISHED   = frozenset({"finished", "completed", "closed", "done"})
_CONFIRM    = frozenset({"confirm", "confirmed"})
_INPROGRESS = frozenset({"in progress", "inprogress", "started", "open"})
_REWORK     = frozenset({"rework", "re work"})
_NEW        = frozenset({"new", "created", "requested"})
_REJECTED   = frozenset({"rejected", "reject", "cancelled", "canceled"})

# ── Date parsing ──────────────────────────────────────────────────────────────

_DATE_FMTS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y",
)


def _norm(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def _str(val: Any) -> str:
    """Convert DataFrame cell to string, treating NaN/None as empty."""
    if val is None:
        return ""
    try:
        if isinstance(val, float) and math.isnan(val):
            return ""
    except Exception:
        pass
    return str(val).strip()


def _parse_dt(s: Any) -> datetime | None:
    text = _str(s)
    if not text:
        return None
    for fmt in _DATE_FMTS:
        try:
            dt = datetime.strptime(text, fmt)
            if dt.year < 1901:   # reject 1900-01-01 Excel/D365 null placeholders
                return None
            return dt
        except ValueError:
            pass
    return None


# ── Core calculation helpers ──────────────────────────────────────────────────

def _normalize_status(raw: Any) -> str:
    v = str(raw or "").strip().lower()
    if v in _FINISHED:
        return "Finished"
    if v in _CONFIRM:
        return "Confirm"
    if v in _INPROGRESS:
        return "In Progress"
    if v in _REWORK:
        return "reWork"
    if v in _NEW:
        return "New"
    if v in _REJECTED:
        return "Rejected"
    return str(raw or "").strip() or "Unknown"


def _compute_ttr(start_val: Any, end_val: Any) -> tuple[float | None, str | None]:
    """
    Compute TTR hours from ActualStart and ActualEnd.
    Returns (ttr_hours, flag) where flag is None when the value is valid.

    Flag values: None | 'Missing ActualStart' | 'Missing ActualEnd' |
                 'Invalid Date Sequence'
    """
    start_str = _str(start_val)
    end_str   = _str(end_val)

    if not start_str:
        return None, "Missing ActualStart"
    if not end_str:
        return None, "Missing ActualEnd"

    start_dt = _parse_dt(start_str)
    end_dt   = _parse_dt(end_str)

    if start_dt is None:
        return None, "Missing ActualStart"
    if end_dt is None:
        return None, "Missing ActualEnd"
    if end_dt < start_dt:
        return None, "Invalid Date Sequence"

    return round((end_dt - start_dt).total_seconds() / 3600, 4), None


_INCOMPLETE_STATUSES: frozenset[str] = frozenset(
    {"Confirm", "In Progress", "New", "Rejected", "reWork", "Unknown"}
)


def _quality_flags(
    asset_id: str,
    work_order_id: str,
    ttr_flag: str | None,
    norm_status: str = "",
) -> list[str]:
    """
    Build data quality flags for a single PBI full row.
    Returns ["Valid"] when no issues, or a list of flag strings.

    PBI full exports have no Created/Raised Date and no SLA data,
    so those checks are intentionally omitted here.

    Key rule: "Missing ActualEnd" is only a data-quality issue for Finished records.
    Open/incomplete statuses (New, Confirm, In Progress, Rejected, reWork) with a
    placeholder or blank ActualEnd are expected — those rows are valid for count KPIs
    but excluded from MTTR without being flagged as bad data.
    """
    flags: list[str] = []
    if not asset_id:
        flags.append("Missing Asset")
    if not work_order_id:
        flags.append("Missing Work Order ID")

    if ttr_flag == "Missing ActualStart":
        flags.append("Missing ActualStart")
    elif ttr_flag == "Missing ActualEnd":
        # Only flag as a quality issue when the record should have an end date.
        if norm_status not in _INCOMPLETE_STATUSES:
            flags.append("Missing ActualEnd")
        # else: open/incomplete record — not a data error
    elif ttr_flag == "Invalid Date Sequence":
        flags.append("Invalid Date Sequence")
    # Other ttr_flag values are unexpected — surface them.
    elif ttr_flag:
        flags.append(ttr_flag)

    return flags or ["Valid"]


def _map_row(raw: dict) -> dict:
    """Map a DataFrame row dict (any column names) to internal field names."""
    out: dict[str, str] = {}
    for key, val in raw.items():
        internal = _ALIAS.get(_norm(key))
        if internal:
            out[internal] = _str(val)
    return out


# ── Public import entry point ─────────────────────────────────────────────────

def import_powerbi_full_export(df: Any, source_file: str = "") -> dict:
    """
    Import a POWERBI_FULL_MR_WO_EXPORT DataFrame into a new SQLite batch.

    Steps:
      1. Build batch_id and imported_at timestamp.
      2. Map + validate each row; compute TTR and quality flags.
      3. Back up the DB (no-op if backup already exists this session).
      4. Deactivate all previous POWERBI_FULL_MR_WO_EXPORT batches.
      5. Create the new import_batch row.
      6. Bulk-insert into raw_powerbi_mr_wo_export.

    Returns the full import result dict (same shape as existing import handlers).
    """
    import db as _db

    imported_at = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    batch_id    = (
        f"pbi_full_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        f"_{uuid.uuid4().hex[:6]}"
    )

    # ── Row processing ────────────────────────────────────────────────────────
    records:      list[dict] = []
    seen_keys:    set        = set()
    dup_count     = 0
    bad_seq       = 0
    miss_start    = 0
    miss_end      = 0      # finished records with missing/placeholder ActualEnd
    open_excluded = 0      # incomplete/open records with placeholder ActualEnd (valid, excluded from MTTR)
    valid_ttr     = 0

    for _, raw_row in df.iterrows():
        row = _map_row(dict(raw_row))

        request_id    = row.get("request_id",    "")
        work_order_id = row.get("work_order_id", "")
        asset_id      = row.get("asset_id",      "")
        actual_start  = row.get("actual_start",  "")
        actual_end    = row.get("actual_end",    "")

        # Dedup within batch per spec rule 5
        dedup_key = (
            (request_id, work_order_id)
            if work_order_id
            else (request_id, asset_id, actual_start)
        )
        if dedup_key in seen_keys:
            dup_count += 1
            continue
        seen_keys.add(dedup_key)

        ttr_hours, ttr_flag = _compute_ttr(actual_start, actual_end)
        norm_status         = _normalize_status(row.get("request_state", ""))
        flags               = _quality_flags(asset_id, work_order_id, ttr_flag, norm_status)
        is_valid            = flags == ["Valid"]

        # Tally stats
        if ttr_flag == "Missing ActualStart":
            miss_start += 1
        elif ttr_flag == "Missing ActualEnd":
            if norm_status in _INCOMPLETE_STATUSES:
                open_excluded += 1   # open record with placeholder end — valid, not MTTR
            else:
                miss_end += 1        # finished record missing its end date
        elif ttr_flag == "Invalid Date Sequence":
            bad_seq += 1
        elif ttr_hours is not None:
            valid_ttr += 1

        records.append({
            "import_batch_id":   batch_id,
            "source_file":       source_file,
            "imported_at":       imported_at,
            "request_id":        request_id,
            "work_order_id":     work_order_id,
            "asset_id":          asset_id,
            "asset_name":        row.get("asset_name",   ""),
            "request_state":     row.get("request_state",""),
            "requester":         row.get("requester",    ""),
            "description":       row.get("description",  ""),
            "location":          row.get("location",     ""),
            "job_trade":         row.get("job_trade",      ""),
            "job_type_id":       row.get("job_type_id",   ""),
            "request_type_id":   row.get("request_type_id", ""),
            "responsible":       row.get("responsible",  ""),
            "worker_group":      row.get("worker_group", ""),
            "priority":          row.get("priority",     ""),
            "actual_start":      actual_start,
            "actual_end":        actual_end,
            "normalized_status": norm_status,
            "ttr_hours":         ttr_hours,
            "data_quality_flag": "Valid" if is_valid else "; ".join(flags),
            "review_reason":     "" if is_valid else "; ".join(flags),
        })

    total_rows  = len(records) + dup_count
    valid_rows  = sum(1 for r in records if r["data_quality_flag"] == "Valid")
    review_rows = len(records) - valid_rows

    # ── DB write (atomic: deactivate old → create batch → insert rows) ────────
    _db._backup_db_once()
    insert_result = _db.replace_powerbi_full_batch(
        batch_id=batch_id,
        source_type=POWERBI_FULL_MR_WO_FORMAT,
        source_file=source_file,
        imported_at=imported_at,
        records=records,
        valid_rows=valid_rows,
        review_rows=review_rows,
    )
    prev_batch_id = insert_result.get("previous_batch_id")
    deactivated = insert_result.get("deactivated", 0)

    return {
        "ok":                              True,
        "import_type":                     POWERBI_FULL_MR_WO_FORMAT,
        "source_file":                     source_file,
        "import_batch_id":                 batch_id,
        "sqlite_table":                    "raw_powerbi_mr_wo_export",
        "imported_at":                     imported_at,
        "total_rows":                      total_rows,
        "rows_imported":                   insert_result.get("inserted", 0),
        "duplicate_rows_skipped":          dup_count,
        "rows_with_invalid_date_sequence":       bad_seq,
        "rows_open_excluded_from_mttr":          open_excluded,
        "rows_with_missing_start":               miss_start,
        "rows_with_missing_end_finished":        miss_end,
        "rows_valid_for_ttr_mttr":               valid_ttr,
        "rows_review":                     review_rows,
        "previous_active_batch":           prev_batch_id or "none",
        "previous_batches_deactivated":    deactivated,
        "message": (
            f"Imported {insert_result.get('inserted', 0)} records (batch {batch_id}). "
            f"{valid_ttr} rows valid for TTR/MTTR. "
            f"{open_excluded} open/incomplete rows excluded from MTTR (no ActualEnd). "
            f"{bad_seq} rows excluded from MTTR (Invalid Date Sequence). "
            f"{dup_count} duplicates skipped. "
            f"Previous batch {'replaced' if prev_batch_id else 'was none'}."
        ),
    }
