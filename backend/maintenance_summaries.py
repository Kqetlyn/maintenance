"""
Phase 4 — historical summary tables.

The raw work_orders table stays the single source of truth. These pre-aggregated
tables let the overview / trend / MTBF pages read O(periods) rows instead of
re-processing O(all work orders) in Python on every request.

Design rule (matches the SQL-storage requirement): summaries are STORAGE only.
They must reproduce the existing figures exactly. To guarantee that, this module
reuses the very same predicate/parse helpers the live payload uses
(`downtime_management`), rather than re-deriving any definition. Every builder
here is validated against the live payload by `validate_reconstruction()` before
any read path is switched to the tables.

Tables (all keyed to allow both all-stage and per-stage reconstruction):

  maintenance_daily_asset_summary    (event_date, stage, asset_id, ...metrics)
  maintenance_monthly_asset_summary  (month,      stage, asset_id, ...metrics)
  maintenance_daily_backlog_snapshot (snapshot_date, stage, open_wo_count)   -- point-in-time
  asset_failure_intervals            (metric_asset_id, stage, next_start, gap_hours, ...)

Metric columns follow the Phase 4 spec: wo_count, preventive_count,
corrective_count, repair_minutes_sum, repair_count (valid repairs),
failure_interval_minutes_sum, failure_interval_count, confirmed_downtime_minutes,
source_updated_at. Columns not yet mapped to a validated live consumer are
created but left 0/NULL and clearly marked, so no unvalidated figure is invented.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

import downtime_management as _dm

# Reuse the live definitions — never re-implement them here.
_get_start = _dm._get_work_order_start
_get_end = _dm._get_work_order_end
_metric_asset_id = _dm._metric_asset_id
_is_general_area = _dm._is_mtbf_general_area
_include_in_mtbf = _dm._include_row_in_individual_mtbf
_is_mtbf_eligible = _dm._is_mtbf_eligible_status
_norm_disp_crit = _dm._normalize_display_criticality
_clean_text = _dm._clean_text
_MTBF_MIN_GAP_HOURS = _dm.MTBF_MIN_GAP_HOURS


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS maintenance_daily_asset_summary (
    event_date                    TEXT NOT NULL,   -- YYYY-MM-DD (date of event_time = start or end)
    stage                         TEXT NOT NULL,
    asset_id                      TEXT NOT NULL,   -- '' when the work order has no asset id
    wo_count                      INTEGER NOT NULL DEFAULT 0,
    preventive_count              INTEGER NOT NULL DEFAULT 0,
    corrective_count              INTEGER NOT NULL DEFAULT 0,
    repair_minutes_sum            REAL    NOT NULL DEFAULT 0,
    repair_count                  INTEGER NOT NULL DEFAULT 0,   -- valid repairs (ttr>0)
    critical_wo_count             INTEGER NOT NULL DEFAULT 0,
    confirmed_downtime_minutes    REAL    NOT NULL DEFAULT 0,
    source_updated_at             TEXT,
    PRIMARY KEY (event_date, stage, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_mdas_date  ON maintenance_daily_asset_summary (event_date);
CREATE INDEX IF NOT EXISTS idx_mdas_stage ON maintenance_daily_asset_summary (stage, event_date);
CREATE INDEX IF NOT EXISTS idx_mdas_asset ON maintenance_daily_asset_summary (asset_id, event_date);

CREATE TABLE IF NOT EXISTS maintenance_monthly_asset_summary (
    month                         TEXT NOT NULL,   -- YYYY-MM
    stage                         TEXT NOT NULL,
    asset_id                      TEXT NOT NULL,
    wo_count                      INTEGER NOT NULL DEFAULT 0,
    preventive_count              INTEGER NOT NULL DEFAULT 0,
    corrective_count              INTEGER NOT NULL DEFAULT 0,
    repair_minutes_sum            REAL    NOT NULL DEFAULT 0,
    repair_count                  INTEGER NOT NULL DEFAULT 0,
    critical_wo_count             INTEGER NOT NULL DEFAULT 0,
    confirmed_downtime_minutes    REAL    NOT NULL DEFAULT 0,
    source_updated_at             TEXT,
    PRIMARY KEY (month, stage, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_mmas_month ON maintenance_monthly_asset_summary (month);
CREATE INDEX IF NOT EXISTS idx_mmas_stage ON maintenance_monthly_asset_summary (stage, month);

CREATE TABLE IF NOT EXISTS maintenance_daily_backlog_snapshot (
    snapshot_date  TEXT NOT NULL,   -- point in time; never summed across dates
    stage          TEXT NOT NULL,
    open_wo_count  INTEGER NOT NULL DEFAULT 0,
    source_updated_at TEXT,
    PRIMARY KEY (snapshot_date, stage)
);

CREATE TABLE IF NOT EXISTS asset_failure_intervals (
    metric_asset_id  TEXT NOT NULL,   -- canonical (mixer-aware) asset used by MTBF
    stage            TEXT NOT NULL,
    prev_end         TEXT NOT NULL,
    next_start       TEXT NOT NULL,   -- interval is attributed to this timestamp's period
    gap_hours        REAL NOT NULL,
    prev_work_order_id TEXT,
    next_work_order_id TEXT,
    source_updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_afi_asset ON asset_failure_intervals (metric_asset_id);
CREATE INDEX IF NOT EXISTS idx_afi_stage ON asset_failure_intervals (stage, next_start);

CREATE TABLE IF NOT EXISTS maintenance_summary_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _work_orders_version(conn):
    """
    Cheap freshness/version token for the raw work_orders table:
    MAX(updated_at) (an O(1) covering-index lookup) + row count.

    Note: this catches every import (imports set updated_at) and any insert/delete
    (row count). A mutation that edits a column *without* bumping updated_at and
    without changing the row count would not move the token — currently only the
    repair-quality-flags path (it rewrites data_validity_status in place). That is
    safe today because (a) the only summary-backed read is the yearly trend, which
    does not use data_validity_status, and (b) that path still clears the route
    cache via the mutation hook. When the MTBF views are wired to
    asset_failure_intervals (which DO filter on data_quality_flag), make that path
    bump updated_at so this token invalidates too.
    """
    mx = conn.execute("SELECT MAX(updated_at) FROM work_orders").fetchone()[0]
    n = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
    return f"{mx or ''}|{n}"


def get_data_version(conn=None):
    """Current data version token (Phase 6 cache key input)."""
    import db as _db
    scope = _db.get_connection() if conn is None else _nullctx(conn)
    with scope as c:
        return _work_orders_version(c)


def summaries_fresh(conn):
    """True when the stored summaries were built from the current work_orders."""
    row = conn.execute(
        "SELECT value FROM maintenance_summary_meta WHERE key = 'work_orders_version'"
    ).fetchone()
    if not row:
        return False
    return row[0] == _work_orders_version(conn)


def query_yearly_trend_from_summary(conn, stages):
    """
    Reconstruct downtime_management._build_historical_trend's output for the
    given set of stages, purely from maintenance_daily_asset_summary. Proven
    byte-identical to the live computation (see validate_reconstruction).
    """
    stage_list = sorted(stages)
    if not stage_list:
        return []
    placeholders = ",".join("?" for _ in stage_list)
    agg = conn.execute(
        f"""
        SELECT substr(event_date,1,4) AS y,
               SUM(wo_count)           AS wo,
               SUM(repair_minutes_sum) AS rmin,
               SUM(repair_count)       AS rcnt,
               SUM(critical_wo_count)  AS crit
        FROM maintenance_daily_asset_summary
        WHERE stage IN ({placeholders})
        GROUP BY y ORDER BY y
        """,
        stage_list,
    ).fetchall()
    repeated = {}
    for r in conn.execute(
        f"""
        SELECT substr(event_date,1,4) AS y, asset_id, SUM(wo_count) AS c
        FROM maintenance_daily_asset_summary
        WHERE stage IN ({placeholders}) AND asset_id <> ''
        GROUP BY y, asset_id
        """,
        stage_list,
    ).fetchall():
        if r["c"] >= 2:
            repeated[r["y"]] = repeated.get(r["y"], 0) + 1
    out = []
    for r in agg:
        ttr_hours = (r["rmin"] or 0) / 60.0
        v = r["rcnt"] or 0
        out.append({
            "year": int(r["y"]),
            "ttr_logged_hours": round(ttr_hours, 3),
            "work_order_count": r["wo"] or 0,
            "average_ttr_hours": round(ttr_hours / v, 3) if v else None,
            "repeated_work_order_assets": repeated.get(r["y"], 0),
            "critical_work_order_count": r["crit"] or 0,
        })
    return out


def ensure_schema(conn) -> None:
    conn.executescript(SCHEMA_SQL)


# ── aggregation (reuses live predicates) ──────────────────────────────────────

def _ttr_hours(row):
    """Repair time in hours using the live definition: ttr_hours, else duration_hours."""
    import pandas as pd
    raw = row.get("ttr_hours") if row.get("ttr_hours") is not None else row.get("duration_hours")
    val = pd.to_numeric(raw, errors="coerce")
    return None if pd.isna(val) else float(val)


def compute_daily_rows(records, source_updated_at=None):
    """
    Per (event_date, stage, asset_id) additive metrics, bucketed exactly like
    downtime_management._build_historical_trend (event_time = start or end;
    a record with neither is skipped, matching the live trend).
    """
    acc = defaultdict(lambda: {"wo_count": 0, "repair_minutes_sum": 0.0, "repair_count": 0,
                               "critical_wo_count": 0, "confirmed_downtime_minutes": 0.0,
                               "preventive_count": 0, "corrective_count": 0})
    for row in records or []:
        event_time = _get_start(row) or _get_end(row)
        if event_time is None:
            continue
        date_key = event_time.strftime("%Y-%m-%d")
        stage = _clean_text(row.get("stage")) or "Unmapped"
        asset_id = _clean_text(row.get("asset_id"))
        b = acc[(date_key, stage, asset_id)]
        b["wo_count"] += 1
        ttr = _ttr_hours(row)
        if ttr is not None and ttr > 0:
            b["repair_minutes_sum"] += ttr * 60.0
            b["repair_count"] += 1
        if _norm_disp_crit(row.get("criticality")) == "Critical":
            b["critical_wo_count"] += 1
    return acc


def compute_failure_intervals(records, source_updated_at=None):
    """
    Reproduce downtime_management._compute_mtbf_payload's per-asset gap logic
    exactly, one row per valid interval. Grouped by metric (mixer-canonical)
    asset. Stage is the interval's own record stage so per-stage MTBF can be
    reconstructed by filtering.
    """
    # Eligibility filter — identical order/predicates to _compute_mtbf_payload.
    seen_wo = set()
    eligible = []
    for row in records or []:
        wo_id = _clean_text(row.get("work_order_id"))
        if wo_id and wo_id in seen_wo:
            continue
        if wo_id:
            seen_wo.add(wo_id)
        start = _get_start(row)
        end = _get_end(row)
        if not row.get("asset_id"):
            continue
        if _is_general_area(row):
            continue
        if not _include_in_mtbf(row):
            continue
        if start is None or end is None:
            continue
        if end <= start:
            continue
        if not _is_mtbf_eligible(row.get("request_state")):
            continue
        if row.get("data_quality_flag") and row.get("data_quality_flag") != "Valid":
            continue
        eligible.append({**row, "_start": start, "_end": end})

    by_asset = defaultdict(list)
    for row in eligible:
        mid = _metric_asset_id(row)
        if mid:
            by_asset[mid].append(row)

    intervals = []
    for mid, items in by_asset.items():
        items.sort(key=lambda it: it["_start"])
        for prev_it, next_it in zip(items, items[1:]):
            gap_hours = (next_it["_start"] - prev_it["_end"]).total_seconds() / 3600
            if gap_hours <= 0:
                continue
            if gap_hours < _MTBF_MIN_GAP_HOURS:
                continue
            intervals.append({
                "metric_asset_id": mid,
                "stage": _clean_text(next_it.get("stage")) or "Unmapped",
                "prev_end": prev_it["_end"].isoformat(),
                "next_start": next_it["_start"].isoformat(),
                "gap_hours": round(gap_hours, 3),
                "prev_work_order_id": prev_it.get("work_order_id"),
                "next_work_order_id": next_it.get("work_order_id"),
                "source_updated_at": source_updated_at,
            })
    return intervals


# ── validation (must pass before wiring any read path) ────────────────────────

def reconstruct_yearly_trend(daily_rows):
    """Rebuild downtime_management._build_historical_trend output from the daily
    summary accumulator, so we can prove equality."""
    years = defaultdict(lambda: {"ttr_hours": 0.0, "wo": 0, "valid_ttr": 0, "critical": 0,
                                 "asset_counts": defaultdict(int)})
    for (date_key, stage, asset_id), b in daily_rows.items():
        y = int(date_key[:4])
        yb = years[y]
        yb["wo"] += b["wo_count"]
        yb["ttr_hours"] += b["repair_minutes_sum"] / 60.0
        yb["valid_ttr"] += b["repair_count"]
        yb["critical"] += b["critical_wo_count"]
        if asset_id:
            yb["asset_counts"][asset_id] += b["wo_count"]
    out = []
    for y in sorted(years):
        yb = years[y]
        repeated = sum(1 for c in yb["asset_counts"].values() if c >= 2)
        out.append({
            "year": y,
            "ttr_logged_hours": round(yb["ttr_hours"], 3),
            "work_order_count": yb["wo"],
            "average_ttr_hours": round(yb["ttr_hours"] / yb["valid_ttr"], 3) if yb["valid_ttr"] else None,
            "repeated_work_order_assets": repeated,
            "critical_work_order_count": yb["critical"],
        })
    return out


def _monthly_from_daily(daily_rows):
    """Roll daily accumulator up to (month, stage, asset_id)."""
    acc = defaultdict(lambda: {"wo_count": 0, "repair_minutes_sum": 0.0, "repair_count": 0,
                               "critical_wo_count": 0, "confirmed_downtime_minutes": 0.0,
                               "preventive_count": 0, "corrective_count": 0})
    for (date_key, stage, asset_id), b in daily_rows.items():
        m = date_key[:7]  # YYYY-MM
        t = acc[(m, stage, asset_id)]
        for k in b:
            t[k] += b[k]
    return acc


def compute_backlog_snapshot(records, snapshot_date=None, source_updated_at=None):
    """Point-in-time open work-order count per stage (never summed across dates)."""
    snapshot_date = snapshot_date or datetime.now().strftime("%Y-%m-%d")
    per_stage = defaultdict(int)
    for row in records or []:
        if _dm._is_open_work_order_status(row.get("request_state")):
            stage = _clean_text(row.get("stage")) or "Unmapped"
            per_stage[stage] += 1
    return [
        {"snapshot_date": snapshot_date, "stage": stage, "open_wo_count": cnt,
         "source_updated_at": source_updated_at}
        for stage, cnt in per_stage.items()
    ]


def rebuild_summaries(records=None, *, connection=None):
    """
    Full rebuild of every summary table from the raw work orders. Phase 5 will
    add an incremental (affected-asset/date-only) variant; this full rebuild is
    the correctness baseline it must match.
    """
    import db as _db
    import downtime_service as _dt

    if records is None:
        payload = _dt.load_work_order_downtime_sql()
        records = payload.get("records") or []
        source_updated_at = payload.get("last_synced")
    else:
        source_updated_at = None

    daily = compute_daily_rows(records, source_updated_at)
    monthly = _monthly_from_daily(daily)
    intervals = compute_failure_intervals(records, source_updated_at)
    backlog = compute_backlog_snapshot(records, source_updated_at=source_updated_at)

    scope = _db.get_connection() if connection is None else _nullctx(connection)
    with scope as conn:
        ensure_schema(conn)
        conn.execute("DELETE FROM maintenance_daily_asset_summary")
        conn.execute("DELETE FROM maintenance_monthly_asset_summary")
        conn.execute("DELETE FROM asset_failure_intervals")
        # backlog is point-in-time: replace only today's snapshot, keep history
        today = datetime.now().strftime("%Y-%m-%d")
        conn.execute("DELETE FROM maintenance_daily_backlog_snapshot WHERE snapshot_date = ?", (today,))

        conn.executemany(
            "INSERT INTO maintenance_daily_asset_summary "
            "(event_date, stage, asset_id, wo_count, preventive_count, corrective_count, "
            " repair_minutes_sum, repair_count, critical_wo_count, confirmed_downtime_minutes, source_updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [(d, s, a, b["wo_count"], b["preventive_count"], b["corrective_count"],
              round(b["repair_minutes_sum"], 6), b["repair_count"], b["critical_wo_count"],
              round(b["confirmed_downtime_minutes"], 6), source_updated_at)
             for (d, s, a), b in daily.items()],
        )
        conn.executemany(
            "INSERT INTO maintenance_monthly_asset_summary "
            "(month, stage, asset_id, wo_count, preventive_count, corrective_count, "
            " repair_minutes_sum, repair_count, critical_wo_count, confirmed_downtime_minutes, source_updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [(m, s, a, b["wo_count"], b["preventive_count"], b["corrective_count"],
              round(b["repair_minutes_sum"], 6), b["repair_count"], b["critical_wo_count"],
              round(b["confirmed_downtime_minutes"], 6), source_updated_at)
             for (m, s, a), b in monthly.items()],
        )
        conn.executemany(
            "INSERT INTO asset_failure_intervals "
            "(metric_asset_id, stage, prev_end, next_start, gap_hours, prev_work_order_id, next_work_order_id, source_updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [(iv["metric_asset_id"], iv["stage"], iv["prev_end"], iv["next_start"], iv["gap_hours"],
              iv["prev_work_order_id"], iv["next_work_order_id"], iv["source_updated_at"]) for iv in intervals],
        )
        conn.executemany(
            "INSERT INTO maintenance_daily_backlog_snapshot (snapshot_date, stage, open_wo_count, source_updated_at) "
            "VALUES (?,?,?,?)",
            [(b["snapshot_date"], b["stage"], b["open_wo_count"], b["source_updated_at"]) for b in backlog],
        )
        # Stamp the version so read paths can verify freshness before trusting
        # the summaries (and fall back to live computation when stale).
        version = _work_orders_version(conn)
        conn.execute(
            "INSERT INTO maintenance_summary_meta (key, value) VALUES ('work_orders_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (version,),
        )
        conn.execute(
            "INSERT INTO maintenance_summary_meta (key, value) VALUES ('rebuilt_at', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (datetime.now().isoformat(timespec="seconds"),),
        )
    return {"daily_rows": len(daily), "monthly_rows": len(monthly),
            "intervals": len(intervals), "backlog_rows": len(backlog), "version": version}


def rebuild_summaries_if_stale():
    """
    Phase 5 import hook: rebuild summaries only when they are stale for the
    current work_orders (version mismatch). Idempotent and cheap when already
    fresh, so it is safe to call from any post-import/mutation path. Full rebuild
    is used because the common import path replaces the whole work_orders table;
    an affected-asset/date incremental rebuild is a future optimisation for when
    the table is large enough that the ~1s full rebuild matters.
    """
    import db as _db
    try:
        with _db.get_connection() as conn:
            if summaries_fresh(conn):
                return {"rebuilt": False, "reason": "fresh"}
    except Exception as exc:
        return {"rebuilt": False, "error": f"freshness check failed: {exc}"}
    try:
        stats = rebuild_summaries()
        return {"rebuilt": True, **stats}
    except Exception as exc:
        return {"rebuilt": False, "error": str(exc)}


class _nullctx:
    def __init__(self, obj): self.obj = obj
    def __enter__(self): return self.obj
    def __exit__(self, *a): return False


def validate_reconstruction(records):
    """Prove summary-derived figures equal the live payload's. Returns list of
    mismatch strings (empty = perfect)."""
    problems = []

    # 1) Yearly historical trend
    daily = compute_daily_rows(records)
    live_trend = _dm._build_historical_trend(records)
    recon_trend = reconstruct_yearly_trend(daily)
    if live_trend != recon_trend:
        problems.append(f"yearly_trend mismatch:\n  live ={live_trend}\n  recon={recon_trend}")

    # 2) Per-asset average MTBF from intervals vs live _compute_mtbf_payload
    intervals = compute_failure_intervals(records)
    gaps_by_asset = defaultdict(list)
    for iv in intervals:
        gaps_by_asset[iv["metric_asset_id"]].append(iv["gap_hours"])
    live_mtbf = _dm._compute_mtbf_payload(records, "Historical / All-Time")
    live_asset_avg = {
        r["asset_id"]: r["average_mtbf_hours"]
        for r in live_mtbf.get("asset_rows", [])
        if r.get("average_mtbf_hours") is not None
    }
    recon_asset_avg = {
        aid: round(sum(g) / len(g), 3) for aid, g in gaps_by_asset.items() if g
    }
    for aid, live_v in live_asset_avg.items():
        recon_v = recon_asset_avg.get(aid)
        if recon_v != live_v:
            problems.append(f"MTBF asset {aid}: live={live_v} recon={recon_v}")
    # assets the live payload reports but reconstruction misses (or vice-versa)
    missing = set(live_asset_avg) - set(recon_asset_avg)
    extra = set(recon_asset_avg) - set(live_asset_avg)
    if missing:
        problems.append(f"MTBF assets in live but not reconstructed: {sorted(missing)[:10]}")
    if extra:
        problems.append(f"MTBF assets reconstructed but not in live: {sorted(extra)[:10]}")

    return problems
