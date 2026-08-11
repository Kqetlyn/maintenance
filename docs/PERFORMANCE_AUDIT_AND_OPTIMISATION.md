# Maintenance Dashboard — Performance Audit & Optimisation

_Scope: Flask/SQLite maintenance dashboard. ~5,234 work-order records, growing.
Historical data retained in full — no records deleted or archived._

## 1. Bottleneck verdict (Phase 1 audit)

The bottleneck is **Python per-request processing over the full work-order table**,
**not** SQL, and not the database engine. Measured on the real hot paths with a
per-stage instrumentation harness (SQL time via connection tracing, Python
transform, serialization, payload size, `cProfile`, `EXPLAIN QUERY PLAN`):

| Builder (cold cache) | SQL | Python transform | Payload | Verdict |
|---|--:|--:|--:|---|
| `build_downtime_payload` (all stages) | ~80 ms | **2142 ms (65%)** | 4.3 MB | Python-bound |
| `build_downtime_payload` (current month) | ~75 ms | **1904 ms (90%)** | 4.3 MB | filter applied late, still full-table |
| `build_mtbf_work_order_history_payload` | ~40 ms | **1447 ms (92%)** | 1.6 MB (5,234 raw rows) | Python-bound + oversized payload |
| `build_inactive_critical_machines_payload` | ~45 ms | **5502 ms (99%)** | 0.1 MB | pathological Python hot loop |
| downtime (warm route cache) | — | — | — | **41 ms** |

SQL is 40–80 ms; the main work-order query already uses indexes
(`SCAN wo USING INDEX idx_wo_created_date` + `SEARCH am ... (asset_id=?)`), no
full scan, no temp B-tree. **Adding indexes or migrating to Postgres would not
have helped the measured bottleneck.**

### Root causes (from `cProfile`)
1. `pd.to_datetime()` called **per scalar ~5,200×** in `_critical_machine_parse_dt`
   (`downtime_service.py`) — 9 s of a 14.9 s profiled run; pandas re-guesses the
   datetime format for a 1-element array every call.
2. Per-request regex alias mapping over the whole table —
   `_contains_keyword` called **109,649×/request** (`mixer_alias_mapping.py`).
3. Full-table enrichment regardless of filter — `_sql_row_to_enriched` runs for
   **all 5,234 rows on every request**; the loader takes only a stage filter, no
   date range, so month/period filtering happens in Python after loading everything.
4. Repeated freshness scans — `SELECT MAX(updated_at)` full-scans run ~6×/build.
5. Oversized payloads — `/api/downtime` ships ~1,691 work orders (4.3 MB);
   `/api/downtime/mtbf-history` ships all 5,234 raw rows (1.6 MB).

### Corrections to initial assumptions (verified against the real schema)
- `work_orders` has **no `work_type` column** (it has `job_type`, `trade`,
  `category`); the stage column is `stage` (`Stage 1`/`Stage 2`/`Unmapped`), not
  `facility_stage`.
- **No `strftime()` date-filters exist in any SQL WHERE/GROUP clause** — nothing
  to convert to range queries. Dates are already stored as a consistent sortable
  ISO-8601 TEXT representation (`2026-07-22T12:33:27`).
- **WAL is already enabled**; busy waiting is handled by `sqlite3.connect(timeout=30)`.
  DB is a local file (`data/dashboard.db`), not a network share.
- A disk + in-process cache already exists (`_cached_json`, 600 s TTL, cleared on
  import); warm requests are 41 ms.
- `work_orders` already carries 13 indexes.

## 2. Changes made (all validated figure-for-figure identical)

Every change was checked with an **automated equivalence harness** that snapshots
the full payloads of 8 builder/filter combinations (all stages, Stage 1, Stage 2,
current month, year, MTBF all/Stage 1, inactive-critical), normalises floating
point and live "current age" fields, and fails on any numeric difference. Result
after all changes: **ALL FIGURES IDENTICAL**.

| # | Change | File | Before → after (cold, min-of-6) |
|---|---|---|---|
| 1 | ISO fast-path for datetime parsing, pandas kept as fallback for exotic formats (byte-identical) | `downtime_service.py` `_critical_machine_parse_dt` | inactive-critical **5551 → 859 ms (6.5×)** |
| 2 | Memoize the regex alias core (pure fn of normalised text) | `mixer_alias_mapping.py` `_detect_mixer_core` | mtbf **1567 → 721 ms (2.2×)** |
| 3 | Memoize hot pure normalizers (`_clean_text`, `_parse_timestamp`, `_normalize_criticality`, `_normalize_key`) with an unhashable-safe decorator | `downtime_management.py` | downtime **3278 → 1513 ms (2.2×)** |
| 4 | Index `updated_at` on the 4 tables probed by `SELECT MAX(updated_at)`; `PRAGMA optimize` | `db.py` `init_db()` | freshness scan **18 ms → 0.015 ms (1000×/call)** |
| 5 | Short-circuit `_manual_override_key` when no overrides configured (skips per-row key building ×5,234) | `mixer_alias_mapping.py` | ~30 ms/cold build |
| 6 | Route `/api/downtime/mtbf-history` through the shared disk cache (was rebuilt from scratch on every open) | `app.py` | **avoids rebuilding the 5,234-row payload per open** (cache miss→hit); compression was already handled globally |

Warm route-cache path stays at ~41 ms. Net cold-path (first request after
import, warm lru): **~3.3 s → ~0.8 s** on a quiet host (system-load variance is
large; only same-host A/B is trustworthy — see §5).

### Important framing: the cold path is a *once-per-import* cost
`_SQL_WO_CACHE` (per-stage enriched records) and `_DOWNTIME_CACHE`/`_cached_json`
(full payloads, 600 s TTL) persist across requests and are cleared only on
import. So the expensive full-table enrichment + MTBF computation is paid **once
per stage per process** (first request after startup or import), after which
every request is the warm ~41 ms. The optimisations above cut that first-load
cost ~4×; further cuts require larger restructures for a cost that is not
per-request.

## 2b. Phase 4 — historical summary tables (foundation + first read wired)

`backend/maintenance_summaries.py` creates and populates four tables from the raw
work orders, reusing the **exact** live predicates (imported from
`downtime_management`, never re-derived):

- `maintenance_daily_asset_summary` (event_date, stage, asset_id, …)
- `maintenance_monthly_asset_summary` (month, stage, asset_id, …)
- `maintenance_daily_backlog_snapshot` (date, stage — point-in-time, never summed)
- `asset_failure_intervals` (one row per validated MTBF gap)
- `maintenance_summary_meta` (data-version token = `MAX(updated_at)|row_count`)

**Proven byte-identical** to the live payload via pure SQL: yearly historical
trend and per-asset MTBF, all-stages and per-stage (Stage 1 / Stage 2).
`db.init_db()` creates the tables; `rebuild_summaries()` (full rebuild) populates
them and stamps the version.

**First read wired:** `build_management_downtime_payload`'s yearly historical
trend now reads from `maintenance_daily_asset_summary` when the summaries are
*fresh* for the current `work_orders` (version match), and falls back to the live
`_build_historical_trend` when stale or on any error — so figures can never
diverge (equivalence harness stays green; fresh→summary and stale→live paths both
verified identical). Isolated A/B: ~31 ms saved. The bigger consumers (historical
MTBF views, per-row enrichment) are not yet summary-backed — see §3.

Deliberately **not** done (would be dead weight today): composite
`(stage, actual_start)` / `(asset_id, actual_start)` indexes and a partial
open-WO index — no SQL query filters on a date range or open-status yet, so those
indexes are deferred until Phase 4/Phase 3 introduce queries that use them.

## 3. Remaining structural work (recommended, not yet done)

These are larger, calc-adjacent changes that should be reviewed as they land. The
equivalence harness gates each one.

- **Phase 4 (partial, done)** — summary tables built, populated, proven
  reconstruction, and the yearly trend read is wired (see §2b). **Remaining to
  finish Phase 4:**
  - Wire the **historical/rolling MTBF views** to `asset_failure_intervals`. This
    needs a small **asset-dimension** (per-asset name/machine_group/criticality/
    location + per-asset repair sums) because the MTBF payload carries per-asset
    metadata the interval table doesn't store. MTBF from intervals =
    Σinterval_minutes / Σinterval_count per bucket (already validated); the
    per-asset/group/criticality summary rows reproduce the existing
    average-of-per-asset-averages behaviour (must match exactly, not "fix").
  - Populate `preventive_count` / `corrective_count` / `confirmed_downtime_minutes`
    by mapping `maintenance_service.classify_corrective_work_order` (a **separate
    subsystem**, CSV month-files) into the summary rows, validated against the
    maintenance-overview page.
- **Phase 5 — incremental refresh (done, full-rebuild variant):**
  `rebuild_summaries_if_stale()` is registered on the work-order import completion
  callback (`_rebuild_summaries_after_import`), so every import refreshes the
  summaries and bumps the version. It is idempotent (no-op when the version is
  already current), so it is safe to call from any post-import path. A **full**
  rebuild is used because the common import path replaces the whole work_orders
  table; an *affected-asset/date-only* incremental rebuild is the future
  optimisation for when the ~1 s full rebuild grows (it needs the import to expose
  which asset_ids/dates changed).
- **Phase 6 — versioned cache (done):** `data_version` (=`MAX(updated_at)|count`,
  short-TTL cached in `app._data_version()`) is folded into the cache keys of
  `/api/downtime`, `/api/downtime/mtbf-history`, and the inactive-critical route.
  A data change therefore changes the key, so a stale payload can never be served
  even if an explicit invalidation is missed; imports also still clear the cache
  and reset the version cache. Caveat documented in `_work_orders_version`: an
  in-place edit that doesn't bump `updated_at` (only the repair-flags path today)
  won't move the token — harmless for the currently-wired reads, to be addressed
  when the MTBF views are wired.
- **Phase 7 — frontend (partial, done):**
  - `/api/downtime/mtbf-history` now disk-cached (was rebuilt per open). A global
    `after_request` handler already gzips all responses >2 KB (~13× on this
    payload), so the win here is avoiding the per-open Python rebuild, not
    compression.
  - Confirmed the other large fetches are **already lazy**: the MTBF-history load
    (`loadMtbfHistory`, opened on demand) and the all-years MR-movement fetch
    (`loadAllWorkOrderRowsForMovement`). `/api/downtime` itself is already gzipped
    (~272 KB) by `_cached_json`.
  - **Remaining:** true server-side pagination (default 50, max 200) for the
    detailed work-order table. This is a larger refactor because the client
    currently does **client-side category filtering + aggregation** over the full
    `management.work_orders` array (`applyCategoryFilter`), so pagination requires
    moving category filtering server-side (add a `category` param + paginated
    endpoint) rather than shipping the whole array. Lazy-load asset drawers / WO
    histories / large heatmaps. This is also what would let the backend skip
    enriching the full table on a cold request.

## 4. Phase 9 — PostgreSQL migration assessment

**Recommendation: stay on optimised SQLite. Do not migrate now.**

| Factor | Current state |
|---|---|
| SQLite limitations actually hit | None blocking. Single-writer lock is irrelevant at current concurrency; WAL already lets readers and the writer coexist. |
| Expected concurrent users | Low. Internal maintenance dashboard. |
| Application workers | **gunicorn `--workers 1`** (`Procfile`) — one process, requests serialised. No multi-process write contention exists to solve. |
| Write / update frequency | Bursty and infrequent: manual Excel/Power BI imports, occasional PM/edit updates. Not a high-write OLTP workload. |
| Database size & growth | ~31 MB file, `work_orders` ~5.2 k rows. Linear, modest growth. SQLite handles this size trivially. |
| Slow queries remaining after optimisation | None at the SQL layer (40–80 ms). Remaining cost is Python aggregation, addressed by summary tables (Phase 4), which Postgres would not change. |
| PostgreSQL migration effort | Non-trivial: stand up/host a server, connection pooling, migrate schema + data, adapt SQLite-specific SQL (`strftime`, `ON CONFLICT` upserts, `PRAGMA`, `datetime()`), CI/deploy changes, backups. |
| SQL compatibility issues | Date handling on ISO-TEXT columns, `INSERT ... ON CONFLICT` upserts, `sqlite3.Row` access, `PRAGMA`-based tuning would all need porting. |
| Backup & rollback | Today: file copy of `dashboard.db` (+ existing `.bak` snapshots). Simple and effective. |

**Migrate to PostgreSQL only if** the deployment later requires genuine
concurrent multi-service write access to the same database, many application
workers writing simultaneously, or the optimised SQLite implementation (after the
Phase 4 summary tables) still fails to meet response-time targets. None of these
conditions hold today. The single-worker deployment means the highest-value
concurrency win, if needed, is raising gunicorn workers/threads — which is a
config change, and only then would SQLite write-locking become worth re-evaluating.

## 5. How to re-run the validation / benchmark

The harness and benchmark scripts live in `scripts/perf/`
(`equiv_harness.py`, `bench.py`, `perf_audit.py`). Run from the repo root.
Recommended before shipping any further change:

```
python scripts/perf/equiv_harness.py baseline   # capture current figures
# ...make change...
python scripts/perf/equiv_harness.py compare     # must print ALL FIGURES IDENTICAL
python scripts/perf/bench.py 6                    # min/median cold-path timings
python scripts/perf/perf_audit.py                 # per-builder SQL/py/serialize/payload breakdown
```

`baseline_payloads.json.gz` is a generated, data-dependent snapshot (git-ignored);
regenerate it with `baseline` whenever the underlying data changes.
