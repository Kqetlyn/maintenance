"""
Standalone verifier for the 2026-07-23 import fix.

Runs entirely against a COPY of data/dashboard.db in a temp folder, so your
production database is never touched. It checks all three code changes:

  1. db.py            -> init_db() empties raw_powerbi_mr_wo_export and
                         deactivates POWERBI_FULL_MR_WO_EXPORT batches.
  2. downtime_service -> importing lands rows in the work_orders table.
  3. downtime_service -> /api/downtime source always resolves to work_orders,
                         even when an active full batch exists.
Plus a robustness check: a bad file returns a clean result instead of raising.

USAGE (from the repo root, using the SAME python that runs the app):

    python verify_import_fix.py "C:\\path\\to\\MR WO records 23.7.2026.xlsx"

If you omit the path it will look for an .xlsx with 'MR' and 'WO' in the name
next to this script and in the current folder.
"""
import os
import sys
import glob
import shutil
import sqlite3
import tempfile
import traceback

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(REPO_ROOT, "backend")
SRC_DB = os.path.join(REPO_ROOT, "data", "dashboard.db")

PASS = "PASS"
FAIL = "FAIL"
results = []


def check(label, ok, detail=""):
    results.append((ok, label, detail))
    print(f"  [{PASS if ok else FAIL}] {label}" + (f"  ({detail})" if detail else ""))


def find_xlsx():
    if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        return sys.argv[1]
    for base in (REPO_ROOT, os.getcwd()):
        for p in glob.glob(os.path.join(base, "*.xlsx")):
            name = os.path.basename(p).lower()
            if "mr" in name and "wo" in name:
                return p
    return None


def main():
    xlsx = find_xlsx()
    if not xlsx:
        print("ERROR: could not find the MR/WO .xlsx file.")
        print('Pass it explicitly:  python verify_import_fix.py "C:\\path\\to\\MR WO records 23.7.2026.xlsx"')
        return 2
    if not os.path.isfile(SRC_DB):
        print(f"ERROR: {SRC_DB} not found. Run this from the repo root.")
        return 2

    tmp = tempfile.mkdtemp(prefix="verify_import_")
    tmp_data = os.path.join(tmp, "data")
    os.makedirs(tmp_data, exist_ok=True)
    shutil.copy(SRC_DB, os.path.join(tmp_data, "dashboard.db"))

    # Point the app's runtime at the copy BEFORE importing any backend module.
    os.environ["DATA_DIR"] = tmp_data
    os.environ["ASYNC_WORK_ORDER_DB_IMPORT"] = "0"   # deterministic synchronous write
    os.environ["OLLAMA_ENABLED"] = "0"
    sys.path.insert(0, BACKEND)

    db_copy = os.path.join(tmp_data, "dashboard.db")
    print(f"\nUsing DB copy : {db_copy}")
    print(f"Using xlsx    : {xlsx}\n")

    # --- Seed a STALE active full batch + one raw row (pre-init) --------------
    con = sqlite3.connect(db_copy)
    con.execute(
        "INSERT INTO import_batches (batch_id, source_type, is_active, total_rows, "
        "valid_rows, review_rows, imported_at, source_file) VALUES (?,?,?,?,?,?,?,?)",
        ("stale_full_seed", "POWERBI_FULL_MR_WO_EXPORT", 1, 1, 1, 0,
         "2026-07-01T00:00:00Z", "OLD_TEMPLATE.xlsx"),
    )
    con.execute("INSERT INTO raw_powerbi_mr_wo_export (import_batch_id) VALUES ('stale_full_seed')")
    con.commit()
    con.close()

    # =========================================================================
    print("PHASE A — db.py startup cleanup (init_db)")
    import db as _db
    _db.init_db()
    con = sqlite3.connect(db_copy)
    active = con.execute(
        "SELECT COUNT(*) FROM import_batches WHERE source_type='POWERBI_FULL_MR_WO_EXPORT' AND is_active=1"
    ).fetchone()[0]
    raw = con.execute("SELECT COUNT(*) FROM raw_powerbi_mr_wo_export").fetchone()[0]
    con.close()
    check("no active POWERBI_FULL batch after startup", active == 0, f"active={active}")
    check("raw_powerbi_mr_wo_export emptied after startup", raw == 0, f"rows={raw}")

    # =========================================================================
    print("\nPHASE B — import lands in work_orders")
    import downtime_service as ds

    class FS:
        def __init__(self, path):
            self.filename = os.path.basename(path)
            self._src = path
        def save(self, dst):
            shutil.copy(self._src, dst)

    res = ds.import_work_order_file(FS(xlsx), replace=True)
    check("import returned ok=True", bool(res.get("ok")), str(res.get("message"))[:120])
    check("import wrote to work_orders table", res.get("sqlite_table") == "work_orders",
          f"table={res.get('sqlite_table')}")
    con = sqlite3.connect(db_copy)
    wo = con.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
    con.close()
    check("work_orders populated", wo > 0, f"rows={wo}")

    # =========================================================================
    print("\nPHASE C — /api/downtime always reads work_orders (ignores active full batch)")
    # Re-seed an active full batch AFTER init to prove the read path ignores it.
    con = sqlite3.connect(db_copy)
    con.execute(
        "INSERT INTO import_batches (batch_id, source_type, is_active, total_rows, "
        "valid_rows, review_rows, imported_at, source_file) VALUES (?,?,?,?,?,?,?,?)",
        ("stale_full_seed2", "POWERBI_FULL_MR_WO_EXPORT", 1, 1, 1, 0,
         "2026-07-02T00:00:00Z", "OLD_TEMPLATE2.xlsx"),
    )
    con.execute("INSERT INTO raw_powerbi_mr_wo_export (import_batch_id) VALUES ('stale_full_seed2')")
    con.commit()
    con.close()
    ds.clear_work_order_runtime_caches()
    payload = ds.load_work_order_downtime_sql()
    check("downtime source == work_orders", payload.get("source") == "work_orders",
          f"source={payload.get('source')}")
    check("downtime batch_id is None (full batch ignored)", payload.get("batch_id") is None,
          f"batch_id={payload.get('batch_id')}")
    check("downtime returned records", len(payload.get("records") or []) > 0,
          f"records={len(payload.get('records') or [])}")

    # =========================================================================
    print("\nPHASE D — robustness: a bad file does not raise")
    bad = os.path.join(tmp, "not_a_workbook.xlsx")
    with open(bad, "w", encoding="utf-8") as f:
        f.write("this is not a real spreadsheet")
    try:
        bad_res = ds.import_work_order_file(FS(bad), replace=False)
        check("bad file returns a result (no exception)", isinstance(bad_res, dict), "")
        check("bad file reports ok=False cleanly", bad_res.get("ok") is False,
              str(bad_res.get("message"))[:100])
    except Exception as exc:
        check("bad file returns a result (no exception)", False, f"raised {exc!r}")

    # --- Summary -------------------------------------------------------------
    shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[0]]
    print("\n" + "=" * 60)
    if failed:
        print(f"RESULT: {len(failed)} CHECK(S) FAILED")
        for _, label, detail in failed:
            print(f"   - {label}  {detail}")
        return 1
    print(f"RESULT: ALL {len(results)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(3)
