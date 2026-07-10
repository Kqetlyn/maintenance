"""
backend/db.py — SQLite database layer for the Maintenance Dashboard.

Phase 1: asset_master table.
Phase 2: work_orders + import_log tables.
Phase 3: load_work_orders_from_sql() — fast SQL-backed loader for the Downtime page.
Phase 4: pm_schedule table + upsert/load helpers for the PM Schedule page.
Phase 5: spare_parts table + upsert/load helpers for the Spare Parts page.
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
# Resolves DATA_DIR from environment variable or defaults to local data directory
# for compatibility with different deployment environments.
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
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    # WAL mode: readers don't block writers and writers don't block readers.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # Limit WAL file growth so auto-checkpoint doesn't stall concurrent reads.
    conn.execute("PRAGMA wal_autocheckpoint=500")
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
CREATE INDEX IF NOT EXISTS idx_am_asset_name    ON asset_master (asset_name);
CREATE INDEX IF NOT EXISTS idx_am_function_loc  ON asset_master (functional_location);
CREATE INDEX IF NOT EXISTS idx_am_machine_group ON asset_master (machine_group);
CREATE INDEX IF NOT EXISTS idx_am_source_file   ON asset_master (source_file);

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
    translated_description TEXT,
    job_type             TEXT,
    trade                TEXT,
    actual_start         TEXT,
    actual_end           TEXT,
    created_date         TEXT,
    source_file          TEXT,
    data_validity_status TEXT,
    review_reason        TEXT,
    started_by           TEXT,
    created_by           TEXT,
    worker_group         TEXT,
    normalized_status    TEXT,
    ttr_hours            REAL,
    source_type          TEXT,
    updated_at           TEXT,
    UNIQUE(mr_number, wo_number)
);
CREATE INDEX IF NOT EXISTS idx_wo_stage        ON work_orders (stage);
CREATE INDEX IF NOT EXISTS idx_wo_asset_id     ON work_orders (asset_id);
CREATE INDEX IF NOT EXISTS idx_wo_status       ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_wo_created_date ON work_orders (created_date);
CREATE INDEX IF NOT EXISTS idx_wo_asset_name   ON work_orders (asset_name);
CREATE INDEX IF NOT EXISTS idx_wo_function_loc ON work_orders (functional_location);
CREATE INDEX IF NOT EXISTS idx_wo_machine_group ON work_orders (machine_group);
CREATE INDEX IF NOT EXISTS idx_wo_actual_start ON work_orders (actual_start);
CREATE INDEX IF NOT EXISTS idx_wo_actual_end   ON work_orders (actual_end);
CREATE INDEX IF NOT EXISTS idx_wo_severity     ON work_orders (severity);
CREATE INDEX IF NOT EXISTS idx_wo_source_file  ON work_orders (source_file);
CREATE INDEX IF NOT EXISTS idx_wo_stage_created ON work_orders (stage, created_date);

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
CREATE INDEX IF NOT EXISTS idx_import_source_type ON import_log (source_type);
CREATE INDEX IF NOT EXISTS idx_import_imported_at ON import_log (imported_at);
CREATE INDEX IF NOT EXISTS idx_import_source_file ON import_log (source_file);

-- import_batches: tracks every import session with batch-activation state.
-- Each POWERBI_FULL_MR_WO_EXPORT import creates a new batch; previous batches
-- are deactivated (not deleted) so data history is preserved.
CREATE TABLE IF NOT EXISTS import_batches (
    batch_id    TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_file TEXT,
    imported_at TEXT NOT NULL,
    is_active   INTEGER DEFAULT 1,
    total_rows  INTEGER DEFAULT 0,
    valid_rows  INTEGER DEFAULT 0,
    review_rows INTEGER DEFAULT 0,
    notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ib_type_active ON import_batches (source_type, is_active);
CREATE INDEX IF NOT EXISTS idx_ib_imported_at ON import_batches (imported_at);

-- raw_powerbi_mr_wo_export: stores Power BI Full MR/WO export rows per batch.
-- Kept separate from work_orders so PBI and legacy Excel imports never mix
-- in the active dashboard view.
CREATE TABLE IF NOT EXISTS raw_powerbi_mr_wo_export (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch_id  TEXT NOT NULL REFERENCES import_batches(batch_id),
    source_file      TEXT,
    imported_at      TEXT,
    request_id       TEXT,
    work_order_id    TEXT,
    asset_id         TEXT,
    asset_name       TEXT,
    request_state    TEXT,
    requester        TEXT,
    description      TEXT,
    location         TEXT,
    job_trade        TEXT,
    job_type_id      TEXT,
    request_type_id  TEXT,
    responsible      TEXT,
    worker_group     TEXT,
    priority         TEXT,
    actual_start     TEXT,
    actual_end       TEXT,
    normalized_status TEXT,
    ttr_hours        REAL,
    data_quality_flag TEXT,
    review_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pbi_batch      ON raw_powerbi_mr_wo_export (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_pbi_asset_id   ON raw_powerbi_mr_wo_export (asset_id);
CREATE INDEX IF NOT EXISTS idx_pbi_req_state  ON raw_powerbi_mr_wo_export (request_state);
CREATE INDEX IF NOT EXISTS idx_pbi_start      ON raw_powerbi_mr_wo_export (actual_start);
CREATE INDEX IF NOT EXISTS idx_pbi_dq         ON raw_powerbi_mr_wo_export (data_quality_flag);

-- Phase 4: PM Schedule tasks from all sources (utility_stage1, equipment_stage1,
-- feed_production, feed_utility). Stores the stable, non-date-relative fields from
-- _normalize_occurrence() so the PM page can reconstruct task dicts without reading
-- Excel. Date-sensitive booleans (isDone, isOverdue, etc.) are re-derived daily.
-- pm_task_id encodes source + asset + date so it is stable across imports.
CREATE TABLE IF NOT EXISTS pm_schedule (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    pm_task_id        TEXT    NOT NULL,
    asset_id          TEXT,
    asset_name        TEXT,
    stage             TEXT,
    main_asset_group  TEXT,
    sub_asset_group   TEXT,
    system_area       TEXT,
    location          TEXT,
    pm_description    TEXT,
    frequency         TEXT,
    planned_year      INTEGER,
    planned_month     INTEGER,
    planned_date      TEXT,
    planned_date_label TEXT,
    contractor_pic    TEXT,
    source_file       TEXT,
    source_slot       TEXT,
    source_label      TEXT,
    source_sheet      TEXT,
    mapping_status    TEXT,
    domain            TEXT,
    scope             TEXT,
    updated_at        TEXT,
    UNIQUE(pm_task_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_stage        ON pm_schedule (stage);
CREATE INDEX IF NOT EXISTS idx_pm_source_slot  ON pm_schedule (source_slot);
CREATE INDEX IF NOT EXISTS idx_pm_planned_year ON pm_schedule (planned_year);
CREATE INDEX IF NOT EXISTS idx_pm_planned_date ON pm_schedule (planned_date);
CREATE INDEX IF NOT EXISTS idx_pm_asset_id     ON pm_schedule (asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_asset_name   ON pm_schedule (asset_name);
CREATE INDEX IF NOT EXISTS idx_pm_main_group   ON pm_schedule (main_asset_group);
CREATE INDEX IF NOT EXISTS idx_pm_location     ON pm_schedule (location);
CREATE INDEX IF NOT EXISTS idx_pm_source_file  ON pm_schedule (source_file);
CREATE INDEX IF NOT EXISTS idx_pm_mapping_status ON pm_schedule (mapping_status);
CREATE INDEX IF NOT EXISTS idx_pm_stage_date   ON pm_schedule (stage, planned_date);

-- Phase 5: Spare Parts records (inventory, PO, movement).
-- One row per source record; transaction_type distinguishes the source table
-- ('inventory' | 'gen_po' | 'stage_po' | 'movement').
-- Stores enough pre-computed fields to reconstruct the full payload without
-- re-reading Excel.  No natural unique key — delete-then-insert per type.
CREATE TABLE IF NOT EXISTS spare_parts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    item_number      TEXT,
    item_name        TEXT,
    asset_id         TEXT,
    asset_name       TEXT,
    stage            TEXT,
    category         TEXT,
    transaction_type TEXT,
    quantity         REAL,
    unit_price       REAL,
    total_value      REAL,
    supplier         TEXT,
    po_number        TEXT,
    pr_number        TEXT,
    transaction_date TEXT,
    source_file      TEXT,
    classification   TEXT,
    min_stock        REAL,
    max_stock        REAL,
    unit             TEXT,
    location         TEXT,
    needs_review     INTEGER DEFAULT 0,
    extra_json       TEXT,
    updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sp_stage            ON spare_parts (stage);
CREATE INDEX IF NOT EXISTS idx_sp_transaction_type ON spare_parts (transaction_type);
CREATE INDEX IF NOT EXISTS idx_sp_item_number      ON spare_parts (item_number);
CREATE INDEX IF NOT EXISTS idx_sp_transaction_date ON spare_parts (transaction_date);
CREATE INDEX IF NOT EXISTS idx_sp_asset_id         ON spare_parts (asset_id);
CREATE INDEX IF NOT EXISTS idx_sp_asset_name       ON spare_parts (asset_name);
CREATE INDEX IF NOT EXISTS idx_sp_category         ON spare_parts (category);
CREATE INDEX IF NOT EXISTS idx_sp_source_file      ON spare_parts (source_file);
CREATE INDEX IF NOT EXISTS idx_sp_type_date        ON spare_parts (transaction_type, transaction_date);
CREATE INDEX IF NOT EXISTS idx_sp_stage_type_date  ON spare_parts (stage, transaction_type, transaction_date);

-- Phase 8: PO Spare 24-26.csv — controlled spare parts PO import (base table for PO analysis).
CREATE TABLE IF NOT EXISTS spare_po_lines (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number               TEXT,
    item_code               TEXT,
    item_description        TEXT,
    ordered_qty             REAL,
    uom                     TEXT,
    unit_price              REAL,
    currency                TEXT    DEFAULT 'THB',
    po_value_thb            REAL,
    requested_delivery_date TEXT,
    source_file             TEXT,
    updated_at              TEXT
);
CREATE INDEX IF NOT EXISTS idx_spl_po_number  ON spare_po_lines (po_number);
CREATE INDEX IF NOT EXISTS idx_spl_item_code  ON spare_po_lines (item_code);
CREATE INDEX IF NOT EXISTS idx_spl_date       ON spare_po_lines (requested_delivery_date);

-- Phase 8: On-hand list.xlsx — inventory item mapping and stock snapshot (not a PO source).
CREATE TABLE IF NOT EXISTS inventory_item_mapping (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    item_number         TEXT    NOT NULL UNIQUE,
    product_name        TEXT,
    inventory_unit      TEXT,
    item_group          TEXT,
    available_physical  REAL,
    physical_inventory  REAL,
    total_available     REAL,
    on_order            REAL,
    ordered_in_total    REAL,
    vendor_name         TEXT,
    stock_status        TEXT,
    source_file         TEXT,
    updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_iim_item_number ON inventory_item_mapping (item_number);
CREATE INDEX IF NOT EXISTS idx_iim_item_group  ON inventory_item_mapping (item_group);
"""


def _backup_db_once() -> None:
    """
    Copy dashboard.db → dashboard.db.bak before schema migrations, but only
    when the backup doesn't already exist (i.e., one backup per deployment).
    Safe to call on every startup — a no-op if the backup file already exists.
    """
    bak = DB_PATH.with_suffix(".db.bak")
    if DB_PATH.exists() and not bak.exists():
        import shutil
        try:
            shutil.copy2(str(DB_PATH), str(bak))
        except Exception:
            pass  # non-fatal — proceed with migration regardless


def init_db() -> str:
    """
    Create the database file and all tables / indexes if they do not exist.
    Safe to call on every app startup — uses CREATE TABLE IF NOT EXISTS throughout.
    Returns the absolute path of the database file.
    """
    with _INIT_LOCK:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _backup_db_once()
        with get_connection() as conn:
            conn.executescript(_SCHEMA_SQL)
            # Phase 5b: add extra_json column to existing spare_parts tables.
            try:
                conn.execute("ALTER TABLE spare_parts ADD COLUMN extra_json TEXT")
            except Exception:
                pass  # column already exists — safe to ignore
            # Phase 5c: add translated_description to work_orders.
            try:
                conn.execute("ALTER TABLE work_orders ADD COLUMN translated_description TEXT")
            except Exception:
                pass  # column already exists — safe to ignore
            # Phase 5d: add started_by / created_by to work_orders.
            for _col in ("started_by", "created_by"):
                try:
                    conn.execute(f"ALTER TABLE work_orders ADD COLUMN {_col} TEXT")
                except Exception:
                    pass  # column already exists — safe to ignore
            # Phase 5e: add worker_group (Power BI WorkerG field) to work_orders.
            try:
                conn.execute("ALTER TABLE work_orders ADD COLUMN worker_group TEXT")
            except Exception:
                pass  # column already exists — safe to ignore
            # Phase 5f: Power BI MR-WO-TTR import fields.
            for _col, _type in (
                ("normalized_status", "TEXT"),
                ("ttr_hours",         "REAL"),
                ("source_type",       "TEXT"),
            ):
                try:
                    conn.execute(f"ALTER TABLE work_orders ADD COLUMN {_col} {_type}")
                except Exception:
                    pass  # column already exists — safe to ignore
            # Phase 6: request_type_id on raw_powerbi_mr_wo_export (Request Type ID column).
            try:
                conn.execute(
                    "ALTER TABLE raw_powerbi_mr_wo_export ADD COLUMN request_type_id TEXT"
                )
            except Exception:
                pass  # column already exists or table not yet created — safe to ignore
            # Phase 7: D365 Maintenance Type + Functional Location Name on asset_master.
            for _col, _type in (
                ("maint_type_code", "TEXT"),
                ("maint_type",      "TEXT"),
                ("func_loc_name",   "TEXT"),
            ):
                try:
                    conn.execute(f"ALTER TABLE asset_master ADD COLUMN {_col} {_type}")
                except Exception:
                    pass  # column already exists — safe to ignore
            # Phase 8 tables are declared in _SCHEMA_SQL (CREATE TABLE IF NOT EXISTS),
            # so no ALTER TABLE migrations are needed here.
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
            str(entry.get("maint_type_code") or "").strip(),
            str(entry.get("maint_type")      or "").strip(),
            str(entry.get("func_loc_name")   or "").strip(),
        ))

    if not rows:
        return 0

    upsert_sql = """
        INSERT INTO asset_master
            (asset_id, asset_name, functional_location, stage, category,
             machine_group, criticality, is_critical, area, source_file, updated_at,
             maint_type_code, maint_type, func_loc_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            updated_at          = excluded.updated_at,
            maint_type_code     = excluded.maint_type_code,
            maint_type          = excluded.maint_type,
            func_loc_name       = excluded.func_loc_name
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

        # If mapping was already loaded from SQL, nothing to sync from Excel.
        if mapping.get("data_source") == "sql":
            asset_count = len(mapping.get("asset_map", {}))
            return {
                "ok": True,
                "rows": 0,
                "message": f"Asset Master already in SQL ({asset_count} asset(s)). No Excel sync needed.",
            }

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


def get_asset_master_sync_meta() -> dict:
    """Lightweight asset-master metadata read from SQL only."""
    try:
        with get_connection() as conn:
            summary = conn.execute(
                """
                SELECT
                    COUNT(*) AS asset_count,
                    MAX(updated_at) AS last_synced,
                    COUNT(DISTINCT machine_group) AS group_count
                FROM asset_master
                """
            ).fetchone()
            latest_source = conn.execute(
                """
                SELECT source_file
                FROM asset_master
                WHERE source_file IS NOT NULL AND TRIM(source_file) <> ''
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
        asset_count = int(summary["asset_count"] or 0)
        source_file = latest_source["source_file"] if latest_source else None
        return {
            "available": asset_count > 0,
            "path": source_file,
            "last_synced": summary["last_synced"],
            "asset_count": asset_count,
            "keyword_rule_count": None,
            "group_count": int(summary["group_count"] or 0),
            "message": (
                f"Loaded {asset_count} asset(s) from SQL asset_master."
                if asset_count > 0
                else "Asset master SQL table is empty."
            ),
            "data_source": "sql",
        }
    except Exception as exc:
        return {
            "available": False,
            "path": None,
            "last_synced": None,
            "asset_count": 0,
            "keyword_rule_count": None,
            "group_count": 0,
            "message": f"Asset master SQL metadata unavailable: {exc}",
            "data_source": "sql",
        }


def get_db_status() -> dict:
    try:
        with get_connection() as conn:
            am_count   = conn.execute("SELECT COUNT(*) FROM asset_master").fetchone()[0]
            am_updated = conn.execute("SELECT MAX(updated_at) FROM asset_master").fetchone()[0]
            wo_count   = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
            wo_updated = conn.execute("SELECT MAX(updated_at) FROM work_orders").fetchone()[0]
            pm_count   = conn.execute("SELECT COUNT(*) FROM pm_schedule").fetchone()[0]
            pm_updated = conn.execute("SELECT MAX(updated_at) FROM pm_schedule").fetchone()[0]
            sp_count   = conn.execute("SELECT COUNT(*) FROM spare_parts").fetchone()[0]
            sp_updated = conn.execute("SELECT MAX(updated_at) FROM spare_parts").fetchone()[0]
        return {
            "ok": True,
            "db_path": str(DB_PATH),
            "asset_master_rows": am_count,
            "asset_master_last_updated": am_updated,
            "work_orders_rows": wo_count,
            "work_orders_last_updated": wo_updated,
            "pm_schedule_rows": pm_count,
            "pm_schedule_last_updated": pm_updated,
            "spare_parts_rows": sp_count,
            "spare_parts_last_updated": sp_updated,
        }
    except Exception as exc:
        return {"ok": False, "db_path": str(DB_PATH), "error": str(exc)}


def get_overview_freshness() -> dict:
    """Combined SQL freshness snapshot for Overview / MIRA responses."""
    try:
        with get_connection() as conn:
            counts = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM asset_master) AS asset_master_rows,
                    (SELECT MAX(updated_at) FROM asset_master) AS asset_master_last_updated,
                    (SELECT COUNT(*) FROM work_orders) AS work_orders_rows,
                    (SELECT MAX(updated_at) FROM work_orders) AS work_orders_last_updated,
                    (SELECT COUNT(*) FROM pm_schedule) AS pm_schedule_rows,
                    (SELECT MAX(updated_at) FROM pm_schedule) AS pm_schedule_last_updated,
                    (SELECT COUNT(*) FROM spare_parts) AS spare_parts_rows,
                    (SELECT MAX(updated_at) FROM spare_parts) AS spare_parts_last_updated
                """
            ).fetchone()
            latest_rows = conn.execute(
                """
                SELECT source_type, source_file, imported_at, row_count, valid_count, invalid_count, notes
                FROM import_log
                WHERE id IN (
                    SELECT MAX(id)
                    FROM import_log
                    GROUP BY source_type
                )
                ORDER BY source_type ASC, id ASC
                """
            ).fetchall()

        source_files_used = [
            {
                "source_type": row["source_type"],
                "source_file": row["source_file"],
                "imported_at": row["imported_at"],
                "row_count": row["row_count"],
                "valid_count": row["valid_count"],
                "invalid_count": row["invalid_count"],
                "notes": row["notes"],
            }
            for row in latest_rows
        ]
        latest_import_time = max(
            (row["imported_at"] for row in latest_rows if row["imported_at"]),
            default=None,
        )
        table_last_updated = {
            "asset_master": counts["asset_master_last_updated"],
            "work_orders": counts["work_orders_last_updated"],
            "pm_schedule": counts["pm_schedule_last_updated"],
            "spare_parts": counts["spare_parts_last_updated"],
        }
        last_updated = max(
            [stamp for stamp in (*table_last_updated.values(), latest_import_time) if stamp],
            default=None,
        )
        return {
            "ok": True,
            "db_path": str(DB_PATH),
            "last_updated": last_updated,
            "latest_import_time": latest_import_time,
            "source_files_used": source_files_used,
            "tables": {
                "asset_master": {
                    "rows": int(counts["asset_master_rows"] or 0),
                    "last_updated": counts["asset_master_last_updated"],
                },
                "work_orders": {
                    "rows": int(counts["work_orders_rows"] or 0),
                    "last_updated": counts["work_orders_last_updated"],
                },
                "pm_schedule": {
                    "rows": int(counts["pm_schedule_rows"] or 0),
                    "last_updated": counts["pm_schedule_last_updated"],
                },
                "spare_parts": {
                    "rows": int(counts["spare_parts_rows"] or 0),
                    "last_updated": counts["spare_parts_last_updated"],
                },
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "db_path": str(DB_PATH),
            "last_updated": None,
            "latest_import_time": None,
            "source_files_used": [],
            "tables": {},
            "error": str(exc),
        }


# ── Work Orders sync ──────────────────────────────────────────────────────────

def upsert_work_orders(
    records: list[dict],
    source_file: str = "",
    source_type: str = "work_orders",
) -> dict:
    """
    Bulk-upsert enriched work-order records (as produced by
    downtime_service.load_work_order_downtime() after enrichment and
    resolved_stage annotation) into the work_orders table.

    Returns {"rows", "valid", "invalid", "inserted", "updated",
             "skipped", "missing_asset", "missing_dates"}.
    """
    if not records:
        return {"rows": 0, "valid": 0, "invalid": 0,
                "inserted": 0, "updated": 0, "skipped": 0,
                "missing_asset": 0, "missing_dates": 0}

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    rows = []
    valid_count   = 0
    invalid_count = 0
    missing_asset = 0
    missing_dates = 0

    for rec in records:
        mr_number = str(rec.get("maintenance_order_id") or "").strip()
        wo_number = str(rec.get("work_order_id") or "").strip()
        if not mr_number and not wo_number:
            continue

        dq_flag = rec.get("data_quality_flag") or ""
        dq_flags_list = rec.get("data_quality_flags") or []
        if dq_flag == "Valid":
            data_validity_status = "Valid"
            review_reason = None
            valid_count += 1
        else:
            data_validity_status = "Review"
            review_reason = dq_flag or "; ".join(dq_flags_list)
            invalid_count += 1

        # Quality counters for the import result message.
        asset_val = str(rec.get("asset_id") or "").strip()
        if not asset_val:
            missing_asset += 1
        start_val = rec.get("maintenance_start_time") or rec.get("actual_start_time") or ""
        end_val   = rec.get("maintenance_end_time") or rec.get("actual_end_time") or ""
        if not start_val or not end_val:
            missing_dates += 1

        # ttr_hours: use stored value (from PBI "Sum of TTR_Hours") or None.
        ttr_val = rec.get("ttr_hours")
        try:
            ttr_val = float(ttr_val) if ttr_val is not None else None
        except (ValueError, TypeError):
            ttr_val = None

        rows.append((
            mr_number,
            wo_number,
            asset_val or None,
            str(rec.get("machine_equipment_name") or rec.get("asset_name") or "").strip() or None,
            str(rec.get("raw_functional_location") or "").strip() or None,
            str(rec.get("resolved_stage") or rec.get("mappedStage") or "").strip() or None,
            str(rec.get("mappedMainAssetGroup") or rec.get("equipment_category") or "").strip() or None,
            str(rec.get("machine_group") or "").strip() or None,
            str(rec.get("service_level") or "").strip() or None,
            str(rec.get("status") or "").strip() or None,
            str(rec.get("description_original") or rec.get("description") or "").strip() or None,
            str(rec.get("translated_description") or "").strip() or None,
            str(rec.get("maintenance_job_type") or rec.get("job_type") or "").strip() or None,
            str(rec.get("system") or rec.get("job_trade") or rec.get("trade") or "").strip() or None,
            rec.get("maintenance_start_time") or rec.get("actual_start_time"),
            rec.get("maintenance_end_time") or rec.get("actual_end_time"),
            rec.get("request_created_time"),
            source_file,
            data_validity_status,
            review_reason,
            str(rec.get("started_by") or "").strip() or None,
            str(rec.get("created_by") or "").strip() or None,
            str(rec.get("worker_group") or "").strip() or None,
            str(rec.get("normalized_status") or "").strip() or None,
            ttr_val,
            source_type or "work_orders",
            now,
        ))

    if not rows:
        return {"rows": 0, "valid": 0, "invalid": 0,
                "inserted": 0, "updated": 0, "skipped": 0,
                "missing_asset": missing_asset, "missing_dates": missing_dates}

    upsert_sql = """
        INSERT INTO work_orders
            (mr_number, wo_number, asset_id, asset_name, functional_location,
             stage, category, machine_group, severity, status, description,
             translated_description,
             job_type, trade, actual_start, actual_end, created_date,
             source_file, data_validity_status, review_reason,
             started_by, created_by, worker_group,
             normalized_status, ttr_hours, source_type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mr_number, wo_number) DO UPDATE SET
            asset_id               = excluded.asset_id,
            asset_name             = excluded.asset_name,
            functional_location    = excluded.functional_location,
            stage                  = excluded.stage,
            category               = excluded.category,
            machine_group          = excluded.machine_group,
            severity               = excluded.severity,
            status                 = excluded.status,
            description            = excluded.description,
            translated_description = excluded.translated_description,
            job_type               = excluded.job_type,
            trade                  = excluded.trade,
            actual_start           = excluded.actual_start,
            actual_end             = excluded.actual_end,
            created_date           = excluded.created_date,
            source_file            = excluded.source_file,
            data_validity_status   = excluded.data_validity_status,
            review_reason          = excluded.review_reason,
            started_by             = excluded.started_by,
            created_by             = excluded.created_by,
            worker_group           = excluded.worker_group,
            normalized_status      = excluded.normalized_status,
            ttr_hours              = excluded.ttr_hours,
            source_type            = excluded.source_type,
            updated_at             = excluded.updated_at
    """

    with get_connection() as conn:
        count_before = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
        conn.executemany(upsert_sql, rows)
        count_after = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]

    inserted = max(0, count_after - count_before)
    updated  = max(0, len(rows) - inserted)

    return {
        "rows":          len(rows),
        "valid":         valid_count,
        "invalid":       invalid_count,
        "inserted":      inserted,
        "updated":       updated,
        "skipped":       0,
        "missing_asset": missing_asset,
        "missing_dates": missing_dates,
    }


def clear_work_orders(source_types: list[str] | tuple[str, ...] | None = None) -> dict:
    """Delete rows from the legacy work_orders table.

    Used when an uploaded MR/WO file is explicitly imported in replace mode.
    POWERBI_FULL_MR_WO_EXPORT imports use raw_powerbi_mr_wo_export batches and
    are intentionally not touched here.
    """
    with get_connection() as conn:
        before = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
        if source_types:
            values = [str(item or "").strip() for item in source_types if str(item or "").strip()]
            if values:
                placeholders = ",".join("?" for _ in values)
                conn.execute(f"DELETE FROM work_orders WHERE source_type IN ({placeholders})", values)
            else:
                conn.execute("DELETE FROM work_orders")
        else:
            conn.execute("DELETE FROM work_orders")
        after = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
    return {"deleted": max(0, before - after), "remaining": after}


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
            wo.severity, wo.status, wo.description, wo.translated_description,
            wo.job_type, wo.trade,
            wo.actual_start, wo.actual_end, wo.created_date,
            wo.source_file, wo.data_validity_status, wo.review_reason,
            wo.started_by, wo.created_by,
            wo.updated_at,
            wo.source_type, wo.normalized_status, wo.ttr_hours, wo.worker_group,
            am.criticality       AS am_criticality,
            am.is_critical       AS am_is_critical,
            am.area              AS am_area,
            am.functional_location AS am_func_loc,
            am.maint_type_code   AS am_maint_type_code,
            am.maint_type        AS am_maint_type,
            am.func_loc_name     AS am_func_loc_name
        FROM work_orders wo
        LEFT JOIN asset_master am ON am.asset_id = wo.asset_id
        {where_sql}
        ORDER BY wo.created_date DESC
    """

    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]


def repair_powerbi_quality_flags() -> dict:
    """
    Fix stored data_validity_status for Power BI records that were imported
    before the 'Confirm' lifecycle fix or before ActualStart/ActualEnd aliases
    were recognised.

    Sets Valid for:
      - Finished / Confirm records with both dates present and end >= start.
      - New / In Progress records (no date requirement for KPI inclusion).
    Leaves unchanged: Rejected / other review-status records.

    Returns {"repaired": int, "skipped": int}.
    """
    _FINISHED = frozenset({"finished", "confirm", "completed", "closed", "resolved", "done"})
    _OPEN     = frozenset({"new", "in progress", "inprogress"})

    def _parse(s: str):
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime((s or "").strip(), fmt)
            except ValueError:
                pass
        return None

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT rowid, status, actual_start, actual_end
            FROM work_orders
            WHERE source_type = 'powerbi'
              AND data_validity_status != 'Valid'
        """).fetchall()

        repaired = 0
        skipped  = 0
        for row in rows:
            status    = str(row["status"] or "").strip().lower()
            start_iso = row["actual_start"] or ""
            end_iso   = row["actual_end"]   or ""

            if status in _FINISHED and start_iso and end_iso:
                start_dt = _parse(start_iso)
                end_dt   = _parse(end_iso)
                if start_dt and end_dt and end_dt >= start_dt:
                    conn.execute(
                        "UPDATE work_orders SET data_validity_status = 'Valid', review_reason = NULL"
                        " WHERE rowid = ?",
                        (row["rowid"],),
                    )
                    repaired += 1
                    continue
            elif status in _OPEN:
                conn.execute(
                    "UPDATE work_orders SET data_validity_status = 'Valid', review_reason = NULL"
                    " WHERE rowid = ?",
                    (row["rowid"],),
                )
                repaired += 1
                continue

            skipped += 1

    return {"repaired": repaired, "skipped": skipped}


# ── Power BI Full MR/WO batch management ──────────────────────────────────────

def create_import_batch(
    batch_id: str,
    source_type: str,
    source_file: str,
    imported_at: str,
    total_rows: int = 0,
    valid_rows: int = 0,
    review_rows: int = 0,
    notes: str = "",
) -> dict:
    """Insert a new import_batches row and return it as a dict."""
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO import_batches
                (batch_id, source_type, source_file, imported_at,
                 is_active, total_rows, valid_rows, review_rows, notes)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
            """,
            (batch_id, source_type, source_file, imported_at,
             total_rows, valid_rows, review_rows, notes or ""),
        )
    return {
        "batch_id": batch_id, "source_type": source_type,
        "source_file": source_file, "imported_at": imported_at,
        "total_rows": total_rows, "valid_rows": valid_rows,
        "review_rows": review_rows,
    }


def deactivate_old_batches(source_type: str) -> int:
    """
    Mark all currently active batches of the given source_type as inactive.
    Called before inserting a new batch so the new one is the only active one.
    Returns the count of deactivated rows.
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE import_batches SET is_active = 0"
            " WHERE source_type = ? AND is_active = 1",
            (source_type,),
        )
        count = conn.execute(
            "SELECT changes()"
        ).fetchone()[0]
    return count


def get_active_powerbi_full_batch_id() -> str | None:
    """
    Return the batch_id of the latest active POWERBI_FULL_MR_WO_EXPORT batch,
    or None if no active batch exists.
    """
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT batch_id FROM import_batches
            WHERE source_type = 'POWERBI_FULL_MR_WO_EXPORT' AND is_active = 1
            ORDER BY imported_at DESC LIMIT 1
            """,
        ).fetchone()
    return row["batch_id"] if row else None


def get_active_powerbi_batch_info() -> dict | None:
    """Return the full import_batches row for the latest active PBI full batch."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM import_batches
            WHERE source_type = 'POWERBI_FULL_MR_WO_EXPORT' AND is_active = 1
            ORDER BY imported_at DESC LIMIT 1
            """,
        ).fetchone()
    return dict(row) if row else None


def insert_powerbi_full_records(batch_id: str, records: list[dict]) -> dict:
    """
    Bulk-insert rows into raw_powerbi_mr_wo_export for the given batch.
    Returns {"inserted": int}.
    """
    if not records:
        return {"inserted": 0}

    cols = (
        "import_batch_id", "source_file", "imported_at",
        "request_id", "work_order_id", "asset_id", "asset_name",
        "request_state", "requester", "description", "location",
        "job_trade", "job_type_id", "request_type_id", "responsible", "worker_group",
        "priority", "actual_start", "actual_end",
        "normalized_status", "ttr_hours", "data_quality_flag", "review_reason",
    )
    placeholders = ", ".join("?" * len(cols))
    sql = f"INSERT INTO raw_powerbi_mr_wo_export ({', '.join(cols)}) VALUES ({placeholders})"

    rows = [tuple(r.get(c) for c in cols) for r in records]
    with get_connection() as conn:
        conn.executemany(sql, rows)
    return {"inserted": len(rows)}


def load_powerbi_full_records(batch_id: str, stage: str | None = None) -> list[dict]:
    """
    Load all rows for a batch from raw_powerbi_mr_wo_export,
    LEFT JOIN asset_master for stage/criticality/area.
    Optional stage filter applied via asset_master.stage.
    """
    params: list = [batch_id]
    stage_clause = ""
    if stage:
        stage_clause = "AND (am.stage = ? OR (am.stage IS NULL AND ? = 'Unmapped'))"
        params.extend([stage, stage])

    sql = f"""
        SELECT
            pbi.*,
            am.stage        AS am_stage,
            am.category     AS am_category,
            am.machine_group AS am_machine_group,
            am.criticality  AS am_criticality,
            am.is_critical  AS am_is_critical,
            am.area         AS am_area
        FROM raw_powerbi_mr_wo_export pbi
        LEFT JOIN asset_master am ON am.asset_id = pbi.asset_id
        WHERE pbi.import_batch_id = ?
        {stage_clause}
        ORDER BY pbi.actual_start DESC
    """
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── Phase 4: SQL-backed loader for the PM Schedule page ──────────────────────

def upsert_pm_schedule(tasks: list[dict]) -> dict:
    """
    Bulk-upsert PM schedule task dicts (as produced by pm_schedule_service
    _normalize_occurrence / pm_feed_integration.build_feed_tasks_internal) into
    the pm_schedule table.

    Per-slot + per-year replace: existing rows for each (source_slot, planned_year)
    pair present in the new tasks are deleted before inserting, so removed tasks
    are not left as orphans.

    Returns {"rows": int}.
    """
    if not tasks:
        return {"rows": 0}

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    # Collect unique (source_slot, planned_year) pairs to delete before reinserting.
    slot_year_pairs: set[tuple] = set()
    for t in tasks:
        slot = str(t.get("sourceSlot") or "").strip()
        year = t.get("plannedYear")
        if slot:
            slot_year_pairs.add((slot, year))

    rows_to_insert = []
    for t in tasks:
        pm_task_id = str(t.get("pmTaskId") or "").strip()
        if not pm_task_id:
            continue
        rows_to_insert.append((
            pm_task_id,
            str(t.get("assetId") or "").strip() or None,
            str(t.get("assetName") or "").strip() or None,
            str(t.get("stage") or "").strip() or None,
            str(t.get("mainAssetGroup") or "").strip() or None,
            str(t.get("subAssetGroup") or "").strip() or None,
            str(t.get("systemArea") or "").strip() or None,
            str(t.get("location") or "").strip() or None,
            str(t.get("pmDescription") or "").strip() or None,
            str(t.get("frequency") or "").strip() or None,
            t.get("plannedYear"),
            t.get("plannedMonth"),
            str(t.get("plannedDate") or "").strip() or None,
            str(t.get("plannedDateLabel") or "").strip() or None,
            str(t.get("contractorOrPIC") or "").strip() or None,
            str(t.get("sourceFile") or "").strip() or None,
            str(t.get("sourceSlot") or "").strip() or None,
            str(t.get("sourceLabel") or "").strip() or None,
            str(t.get("sourceSheet") or "").strip() or None,
            str(t.get("mappingStatus") or "").strip() or None,
            str(t.get("domain") or "").strip() or None,
            str(t.get("scope") or "").strip() or None,
            now,
        ))

    if not rows_to_insert:
        return {"rows": 0}

    upsert_sql = """
        INSERT INTO pm_schedule
            (pm_task_id, asset_id, asset_name, stage, main_asset_group, sub_asset_group,
             system_area, location, pm_description, frequency,
             planned_year, planned_month, planned_date, planned_date_label,
             contractor_pic, source_file, source_slot, source_label, source_sheet,
             mapping_status, domain, scope, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pm_task_id) DO UPDATE SET
            asset_id          = excluded.asset_id,
            asset_name        = excluded.asset_name,
            stage             = excluded.stage,
            main_asset_group  = excluded.main_asset_group,
            sub_asset_group   = excluded.sub_asset_group,
            system_area       = excluded.system_area,
            location          = excluded.location,
            pm_description    = excluded.pm_description,
            frequency         = excluded.frequency,
            planned_year      = excluded.planned_year,
            planned_month     = excluded.planned_month,
            planned_date      = excluded.planned_date,
            planned_date_label = excluded.planned_date_label,
            contractor_pic    = excluded.contractor_pic,
            source_file       = excluded.source_file,
            source_slot       = excluded.source_slot,
            source_label      = excluded.source_label,
            source_sheet      = excluded.source_sheet,
            mapping_status    = excluded.mapping_status,
            domain            = excluded.domain,
            scope             = excluded.scope,
            updated_at        = excluded.updated_at
    """

    with get_connection() as conn:
        # Delete stale rows for each (source_slot, planned_year) pair before upserting.
        for slot, year in slot_year_pairs:
            if year is not None:
                conn.execute(
                    "DELETE FROM pm_schedule WHERE source_slot = ? AND planned_year = ?",
                    (slot, year),
                )
            else:
                conn.execute(
                    "DELETE FROM pm_schedule WHERE source_slot = ? AND planned_year IS NULL",
                    (slot,),
                )
        conn.executemany(upsert_sql, rows_to_insert)

    return {"rows": len(rows_to_insert)}


def load_pm_schedule_from_sql(stage: str | None = None, year: int | None = None) -> list[dict]:
    """
    Query pm_schedule with optional stage and year filters.
    Returns a list of raw SQL dicts (not yet enriched with date-relative fields).

    Caller converts rows via pm_schedule_service._sql_pm_row_to_task().
    """
    params: list = []
    where_parts: list[str] = []

    if stage in ("Stage 1", "Stage 2"):
        where_parts.append("stage = ?")
        params.append(stage)

    if year is not None:
        where_parts.append("planned_year = ?")
        params.append(year)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = f"""
        SELECT pm_task_id, asset_id, asset_name, stage, main_asset_group, sub_asset_group,
               system_area, location, pm_description, frequency,
               planned_year, planned_month, planned_date, planned_date_label,
               contractor_pic, source_file, source_slot, source_label, source_sheet,
               mapping_status, domain, scope, updated_at
        FROM pm_schedule
        {where_sql}
        ORDER BY planned_date ASC
    """

    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]


# ── Phase 5: SQL-backed loader for the Spare Parts page ──────────────────────

def upsert_spare_parts(rows: list[dict]) -> dict:
    """
    Bulk-replace spare parts records.  For each unique transaction_type present
    in rows, existing rows with that type are deleted before inserting.

    Returns {"rows": int, "types": list[str]}.
    """
    if not rows:
        return {"rows": 0, "types": []}

    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    types_to_replace = {str(r.get("transaction_type") or "").strip() for r in rows if r.get("transaction_type")}

    insert_rows = []
    for r in rows:
        insert_rows.append((
            str(r.get("item_number") or "").strip() or None,
            str(r.get("item_name") or "").strip() or None,
            str(r.get("asset_id") or "").strip() or None,
            str(r.get("asset_name") or "").strip() or None,
            str(r.get("stage") or "").strip() or None,
            str(r.get("category") or "").strip() or None,
            str(r.get("transaction_type") or "").strip() or None,
            r.get("quantity"),
            r.get("unit_price"),
            r.get("total_value"),
            str(r.get("supplier") or "").strip() or None,
            str(r.get("po_number") or "").strip() or None,
            str(r.get("pr_number") or "").strip() or None,
            str(r.get("transaction_date") or "").strip() or None,
            str(r.get("source_file") or "").strip() or None,
            str(r.get("classification") or "").strip() or None,
            r.get("min_stock"),
            r.get("max_stock"),
            str(r.get("unit") or "").strip() or None,
            str(r.get("location") or "").strip() or None,
            1 if r.get("needs_review") else 0,
            r.get("extra_json") or None,
            now,
        ))

    insert_sql = """
        INSERT INTO spare_parts
            (item_number, item_name, asset_id, asset_name, stage, category,
             transaction_type, quantity, unit_price, total_value,
             supplier, po_number, pr_number, transaction_date, source_file,
             classification, min_stock, max_stock, unit, location,
             needs_review, extra_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    with get_connection() as conn:
        for ttype in types_to_replace:
            conn.execute("DELETE FROM spare_parts WHERE transaction_type = ?", (ttype,))
        conn.executemany(insert_sql, insert_rows)

    return {"rows": len(insert_rows), "types": sorted(types_to_replace)}


def load_spare_parts_from_sql(
    stage: str | None = None,
    transaction_type: str | None = None,
) -> list[dict]:
    """
    Query spare_parts with optional stage and transaction_type filters.
    Returns a list of raw SQL dicts.

    Caller converts rows via spare_parts_service._sql_to_inventory_record() etc.
    """
    params: list = []
    where_parts: list[str] = []

    if stage in ("Stage 1", "Stage 2"):
        where_parts.append("stage = ?")
        params.append(stage)
    if transaction_type:
        where_parts.append("transaction_type = ?")
        params.append(transaction_type)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    sql = f"""
        SELECT id, item_number, item_name, asset_id, asset_name, stage, category,
               transaction_type, quantity, unit_price, total_value,
               supplier, po_number, pr_number, transaction_date, source_file,
               classification, min_stock, max_stock, unit, location,
               needs_review, extra_json, updated_at
        FROM spare_parts
        {where_sql}
        ORDER BY transaction_type, item_number
    """
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── Phase 8: Spare PO Lines (PO Spare 24-26.csv) ──────────────────────────────

def upsert_spare_po_lines(rows: list[dict]) -> int:
    """Replace all spare_po_lines and insert the new batch. Returns row count."""
    if not rows:
        return 0
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    with get_connection() as conn:
        conn.execute("DELETE FROM spare_po_lines")
        conn.executemany(
            """
            INSERT INTO spare_po_lines
                (po_number, item_code, item_description, ordered_qty, uom,
                 unit_price, currency, po_value_thb, requested_delivery_date,
                 source_file, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    str(r.get("po_number") or ""),
                    str(r.get("item_code") or ""),
                    str(r.get("item_description") or ""),
                    r.get("ordered_qty"),
                    str(r.get("uom") or ""),
                    r.get("unit_price"),
                    str(r.get("currency") or "THB"),
                    r.get("po_value_thb"),
                    str(r.get("requested_delivery_date") or ""),
                    str(r.get("source_file") or ""),
                    r.get("updated_at") or now,
                )
                for r in rows
            ],
        )
    return len(rows)


def load_spare_po_lines() -> list[dict]:
    """Load all spare_po_lines rows."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM spare_po_lines ORDER BY requested_delivery_date DESC, po_number"
        ).fetchall()
    return [dict(r) for r in rows]


# ── Phase 8: Inventory Item Mapping (On-hand list.xlsx) ───────────────────────

def upsert_inventory_item_mapping(rows: list[dict]) -> int:
    """Replace all inventory_item_mapping rows and insert the new batch."""
    if not rows:
        return 0
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    with get_connection() as conn:
        conn.execute("DELETE FROM inventory_item_mapping")
        conn.executemany(
            """
            INSERT INTO inventory_item_mapping
                (item_number, product_name, inventory_unit, item_group,
                 available_physical, physical_inventory, total_available,
                 on_order, ordered_in_total, vendor_name, stock_status,
                 source_file, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(item_number) DO UPDATE SET
                product_name        = excluded.product_name,
                inventory_unit      = excluded.inventory_unit,
                item_group          = excluded.item_group,
                available_physical  = excluded.available_physical,
                physical_inventory  = excluded.physical_inventory,
                total_available     = excluded.total_available,
                on_order            = excluded.on_order,
                ordered_in_total    = excluded.ordered_in_total,
                vendor_name         = excluded.vendor_name,
                stock_status        = excluded.stock_status,
                source_file         = excluded.source_file,
                updated_at          = excluded.updated_at
            """,
            [
                (
                    str(r.get("item_number") or "").upper(),
                    str(r.get("product_name") or ""),
                    str(r.get("inventory_unit") or ""),
                    str(r.get("item_group") or ""),
                    r.get("available_physical"),
                    r.get("physical_inventory"),
                    r.get("total_available"),
                    r.get("on_order"),
                    r.get("ordered_in_total"),
                    str(r.get("vendor_name") or ""),
                    str(r.get("stock_status") or ""),
                    str(r.get("source_file") or ""),
                    r.get("updated_at") or now,
                )
                for r in rows
            ],
        )
    return len(rows)


def load_inventory_item_mapping() -> list[dict]:
    """Load all inventory_item_mapping rows."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM inventory_item_mapping ORDER BY item_number"
        ).fetchall()
    return [dict(r) for r in rows]
