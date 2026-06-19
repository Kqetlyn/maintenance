"""
backend/db.py — SQLite database layer for the Maintenance Dashboard.

Phase 1: asset_master table.
Phase 2: work_orders + import_log tables.
Phase 3: load_work_orders_from_sql() — fast SQL-backed loader for the Downtime page.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

# ── Database path ──────────────────────────────────────────────────────────────
# Mirrors how every other service resolves DATA_DIR so Railway / local dev both
# work without extra configuration.
_BASE_DIR = Path(__file__).resolve().parent
_DEFAULT_DATA_DIR = _BASE_DIR.parent / "data"
DB_PATH = Path(os.environ.get("DATA_DIR") or str(_DEFAULT_DATA_DIR)) / "dashboard.db"

# Coarse lock so concurrent startup threads don't race on schema creation.
_INIT_LOCK = threading.Lock()

# ── Machine groups that count as "critical" (same set as asset_mapping.py) ────
_CRITICAL_MACHINE_GROUPS = frozenset({
    "Production Equipment",
    "Utilities",
    "Utilities / Support",
    "Refrigeration",
})


# ── Connection helper ─────────────────────────────────────────────────────────

@contextmanager
def get_connection():
    """
    Context-managed SQLite connection.

    Usage::

        with get_connection() as conn:
            rows = conn.execute("SELECT * FROM asset_master").fetchall()

    Commits on clean exit, rolls back on exception, always closes.
    """
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL mode: readers don't block writers and writers don't block readers.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Schema ────────────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
-- Phase 1: Asset Master
CREATE TABLE IF NOT EXISTS asset_master (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id            TEXT    NOT NULL UNIQUE,
    asset_name          TEXT,
    functional_location TEXT,
    stage               TEXT,
    category            TEXT,
    machine_group       TEXT,
    criticality         TEXT,
    is_critical         INTEGER DEFAULT 0,
    area                TEXT,
    source_file         TEXT,
    updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_am_stage         ON asset_master (stage);
CREATE INDEX IF NOT EXISTS idx_am_category      ON asset_master (category);
CREATE INDEX IF NOT EXISTS idx_am_criticality   ON asset_master (criticality);

-- Phase 2: Work Orders (MR / WO from D365 exports)
-- mr_number + wo_number form the natural composite key.
-- Empty string is stored for null IDs so the UNIQUE constraint works correctly.
CREATE TABLE IF NOT EXISTS work_orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_number            TEXT    NOT NULL DEFAULT '',
    wo_number            TEXT    NOT NULL DEFAULT '',
    asset_id             TEXT,
    asset_name           TEXT,
    functional_location  TEXT,
    stage                TEXT,
    category             TEXT,
    machine_group        TEXT,
    severity             TEXT,
    status               TEXT,
    description          TEXT,
    job_type             TEXT,
    trade                TEXT,
    actual_start         TEXT,
    actual_end           TEXT,
    created_date         TEXT,
    source_file          TEXT,
    data_validity_status TEXT,
    review_reason        TEXT,
    updated_at           TEXT,
    UNIQUE(mr_number, wo_number)
);
CREATE INDEX IF NOT EXISTS idx_wo_stage        ON work_orders (stage);
CREATE INDEX IF NOT EXISTS idx_wo_asset_id     ON work_orders (asset_id);
CREATE INDEX IF NOT EXISTS idx_wo_status       ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_wo_created_date ON work_orders (created_date);

-- Import audit log — one row per file import event.
CREATE TABLE IF NOT EXISTS import_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type   TEXT,
    source_file   TEXT,
    imported_at   TEXT,
    row_count     INTEGER,
    valid_count   INTEGER,
    invalid_count INTEGER,
    notes         TEXT
);
"""


def init_db() -> str:
    """
    Create the database file and all tables / indexes if they do not exist.
    Safe to call on every app startup — uses CREATE TABLE IF NOT EXISTS throughout.
    Returns the absolute path of the database file.
    """
    with _INIT_LOCK:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with get_connection() as conn:
            conn.executescript(_SCHEMA_SQL)
    return str(DB_PATH)


# ── Asset Master sync ─────────────────────────────────────────────────────────

def upsert_asset_master_from_mapping(asset_map: dict, source_file: str = "Asset_Master.xlsx") -> int:
    """
    Bulk-upsert asset rows from the dict produced by
    asset_mapping.load_asset_mapping()["asset_map"].

    Uses INSERT ... ON CONFLICT(asset_id) DO UPDATE so existing rows are updated
    in place (preserving their id) rather than deleted-and-reinserted.

    Returns the number of rows written.
    """
    if not asset_map:
        return 0

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    rows = []

    for entry in asset_map.values():
        # Normalise asset_id — always uppercase, strip whitespace.
        asset_id = str(entry.get("asset_id") or "").strip().upper()
        if not asset_id:
            continue

        # category  = Main Asset Group (broad grouping used for filtering)
        # machine_group = finer sub-group within the main group
        category      = str(entry.get("mappedMainAssetGroup") or entry.get("machine_group") or "").strip()
        machine_group = str(entry.get("mappedMachineGroup")   or entry.get("asset_machine_group") or "").strip()

        rows.append((
            asset_id,
            str(entry.get("display_name")       or entry.get("mappedAssetName")   or "").strip(),
            str(entry.get("location")            or entry.get("mappedLocation")    or "").strip(),
            str(entry.get("stage")               or entry.get("mappedStage")       or "").strip(),
            category,
            machine_group,
            str(entry.get("criticality") or "").strip(),
            1 if category in _CRITICAL_MACHINE_GROUPS else 0,
            str(entry.get("mappedSystemArea") or "").strip(),
            source_file,
            now,
        ))

    if not rows:
        return 0

    upsert_sql = """
        INSERT INTO asset_master
            (asset_id, asset_name, functional_location, stage, category,
             machine_group, criticality, is_critical, area, source_file, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
            asset_name          = excluded.asset_name,
            functional_location = excluded.functional_location,
            stage               = excluded.stage,
            category            = excluded.category,
            machine_group       = excluded.machine_group,
            criticality         = excluded.criticality,
            is_critical         = excluded.is_critical,
            area                = excluded.area,
            source_file         = excluded.source_file,
            updated_at          = excluded.updated_at
    """

    with get_connection() as conn:
        conn.executemany(upsert_sql, rows)

    return len(rows)


def sync_asset_master_from_file(data_dir: str | Path) -> dict:
    """
    Load the Asset Master Excel file via the existing asset_mapping loader and
    sync every asset row into the asset_master SQL table.

    This is the primary entry point called at startup and after an Asset Master
    refresh.  The Excel loader remains the source of truth; this function just
    mirrors its output into SQLite.

    Returns a status dict: {"ok": bool, "rows": int, "message": str}.
    """
    try:
        # Import here to avoid a circular import at module level.
        from asset_mapping import load_asset_mapping, ASSET_MASTER_FILENAME
        mapping = load_asset_mapping(str(data_dir))
        if not mapping.get("available"):
            return {"ok": False, "rows": 0, "message": mapping.get("message", "Asset Master not available.")}

        asset_map = mapping.get("asset_map", {})
        source_file = Path(mapping.get("path") or ASSET_MASTER_FILENAME).name
        written = upsert_asset_master_from_mapping(asset_map, source_file)
        return {
            "ok": True,
            "rows": written,
            "message": f"Synced {written} asset(s) from {source_file} into asset_master.",
        }
    except Exception as exc:
        return {"ok": False, "rows": 0, "message": f"Asset Master sync failed: {exc}"}


# ── Query helpers ─────────────────────────────────────────────────────────────

def query_asset_master(
    stage: str | None = None,
    category: str | None = None,
    is_critical: bool | None = None,
) -> list[dict]:
    """
    Fetch rows from asset_master with optional filters.
    Returns a list of plain dicts (same shape as a Row converted to dict).
    """
    conditions: list[str] = []
    params: list = []

    if stage:
        conditions.append("stage = ?")
        params.append(stage)
    if category:
        conditions.append("category = ?")
        params.append(category)
    if is_critical is not None:
        conditions.append("is_critical = ?")
        params.append(1 if is_critical else 0)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"SELECT * FROM asset_master {where} ORDER BY asset_id"

    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_db_status() -> dict:
    try:
        with get_connection() as conn:
            am_count   = conn.execute("SELECT COUNT(*) FROM asset_master").fetchone()[0]
            am_updated = conn.execute("SELECT MAX(updated_at) FROM asset_master").fetchone()[0]
            wo_count   = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
            wo_updated = conn.execute("SELECT MAX(updated_at) FROM work_orders").fetchone()[0]
        return {
            "ok": True,
            "db_path": str(DB_PATH),
            "asset_master_rows": am_count,
            "asset_master_last_updated": am_updated,
            "work_orders_rows": wo_count,
            "work_orders_last_updated": wo_updated,
        }
    except Exception as exc:
        return {"ok": False, "db_path": str(DB_PATH), "error": str(exc)}


# ── Work Orders sync ──────────────────────────────────────────────────────────

def upsert_work_orders(records: list[dict], source_file: str = "") -> dict:
    """
    Bulk-upsert enriched work-order records (as produced by
    downtime_service.load_work_order_downtime() after enrichment and
    resolved_stage annotation) into the work_orders table.

    Returns {"rows": int, "valid": int, "invalid": int}.
    """
    if not records:
        return {"rows": 0, "valid": 0, "invalid": 0}

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    rows = []
    valid_count = 0
    invalid_count = 0

    for rec in records:
        mr_number = str(rec.get("maintenance_order_id") or "").strip()
        wo_number = str(rec.get("work_order_id") or "").strip()
        if not mr_number and not wo_number:
            continue

        dq_flag = rec.get("data_quality_flag") or ""
        if dq_flag == "Valid":
            data_validity_status = "Valid"
            review_reason = None
            valid_count += 1
        else:
            data_validity_status = "Review"
            review_reason = dq_flag or "; ".join(rec.get("data_quality_flags") or [])
            invalid_count += 1

        rows.append((
            mr_number,
            wo_number,
            str(rec.get("asset_id") or "").strip() or None,
            str(rec.get("machine_equipment_name") or rec.get("asset_name") or "").strip() or None,
            str(rec.get("raw_functional_location") or "").strip() or None,
            str(rec.get("resolved_stage") or rec.get("mappedStage") or "").strip() or None,
            str(rec.get("mappedMainAssetGroup") or rec.get("equipment_category") or "").strip() or None,
            str(rec.get("machine_group") or "").strip() or None,
            str(rec.get("service_level") or "").strip() or None,
            str(rec.get("status") or "").strip() or None,
            str(rec.get("description_original") or rec.get("description") or "").strip() or None,
            str(rec.get("maintenance_job_type") or rec.get("job_type") or "").strip() or None,
            str(rec.get("system") or rec.get("job_trade") or rec.get("trade") or "").strip() or None,
            rec.get("maintenance_start_time") or rec.get("actual_start_time"),
            rec.get("maintenance_end_time") or rec.get("actual_end_time"),
            rec.get("request_created_time"),
            source_file,
            data_validity_status,
            review_reason,
            now,
        ))

    if not rows:
        return {"rows": 0, "valid": 0, "invalid": 0}

    upsert_sql = """
        INSERT INTO work_orders
            (mr_number, wo_number, asset_id, asset_name, functional_location,
             stage, category, machine_group, severity, status, description,
             job_type, trade, actual_start, actual_end, created_date,
             source_file, data_validity_status, review_reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mr_number, wo_number) DO UPDATE SET
            asset_id             = excluded.asset_id,
            asset_name           = excluded.asset_name,
            functional_location  = excluded.functional_location,
            stage                = excluded.stage,
            category             = excluded.category,
            machine_group        = excluded.machine_group,
            severity             = excluded.severity,
            status               = excluded.status,
            description          = excluded.description,
            job_type             = excluded.job_type,
            trade                = excluded.trade,
            actual_start         = excluded.actual_start,
            actual_end           = excluded.actual_end,
            created_date         = excluded.created_date,
            source_file          = excluded.source_file,
            data_validity_status = excluded.data_validity_status,
            review_reason        = excluded.review_reason,
            updated_at           = excluded.updated_at
    """

    with get_connection() as conn:
        conn.executemany(upsert_sql, rows)

    return {"rows": len(rows), "valid": valid_count, "invalid": invalid_count}


def log_import(
    source_type: str,
    source_file: str,
    row_count: int,
    valid_count: int,
    invalid_count: int,
    notes: str = "",
) -> int:
    """Insert one row into import_log and return its new id."""
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    sql = """
        INSERT INTO import_log
            (source_type, source_file, imported_at, row_count, valid_count, invalid_count, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """
    with get_connection() as conn:
        cursor = conn.execute(sql, (source_type, source_file, now, row_count, valid_count, invalid_count, notes))
        return cursor.lastrowid


# ── Phase 3: SQL-backed loader for the Downtime page ─────────────────────────

def load_work_orders_from_sql(stage: str | None = None) -> list[dict]:
    """
    Query work_orders (LEFT JOIN asset_master for criticality/area) and return
    raw SQL dicts.  Stage filter is applied in SQL — no further Python filtering needed.

    Caller is responsible for converting rows to enriched Python dicts
    (see downtime_service._sql_row_to_enriched).
    """
    params: list = []
    where_parts: list[str] = []

    if stage in ("Stage 1", "Stage 2"):
        where_parts.append("wo.stage = ?")
        params.append(stage)
    elif stage in ("Unmapped", "Missing Asset ID", "Needs Stage Review"):
        where_parts.append("wo.stage = ?")
        params.append(stage)
    # stage == "" or None → no filter (all stages)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
        SELECT
            wo.mr_number, wo.wo_number, wo.asset_id, wo.asset_name,
            wo.functional_location, wo.stage, wo.category, wo.machine_group,
            wo.severity, wo.status, wo.description, wo.job_type, wo.trade,
            wo.actual_start, wo.actual_end, wo.created_date,
            wo.source_file, wo.data_validity_status, wo.review_reason,
            wo.updated_at,
            am.criticality  AS am_criticality,
            am.is_critical  AS am_is_critical,
            am.area         AS am_area
        FROM work_orders wo
        LEFT JOIN asset_master am ON am.asset_id = wo.asset_id
        {where_sql}
        ORDER BY wo.created_date DESC
    """

    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]
