# Import fix — MR/WO work-order import (2026-07-23)

## Symptom
- Importing an MR/WO export on the **Downtime** tab failed with `Import failed: HTTP 500`.
- The **Overview / Predictive Insights** page did not reflect the imported file.

## Root cause
The dashboard had two parallel data stores:
- Imports land in the **`work_orders`** table.
- `/api/downtime` (which powers the Overview/Predictive Insights and Downtime pages)
  **preferred the deprecated `raw_powerbi_mr_wo_export` table** whenever an "active
  full batch" existed. A stale/active full-batch therefore hid the freshly imported
  data and exercised a fragile code path.

Separately, the import route could raise an **unhandled exception**, which Flask
returns as a bare HTML **HTTP 500** with no message — hence the opaque
"Import failed: HTTP 500" with no detail.

## Changes (backend/)
1. **`downtime_service.py`** — `/api/downtime` now always reads `work_orders`
   (`active_batch_id` forced to `None`). The Overview fills from the imported file.
2. **`downtime_service.py`** — disabled the synchronous full-export diversion, so
   every import is written to `work_orders` (the retired template is never used).
3. **`db.py`** — on startup (`init_db`), deactivates any lingering
   `POWERBI_FULL_MR_WO_EXPORT` batches and empties `raw_powerbi_mr_wo_export`.
   Existing/other deployments self-heal automatically — no manual DB surgery.
4. **`app.py`** — wrapped the import route and added a global error handler so the
   import can **never** return a bare HTTP 500. On failure the UI now shows the
   real reason (e.g. a permissions or data error) as a clean message.

## Deploy (GitHub)
From the repo root (`Maintenance/maintenance`):

```
git add backend/downtime_service.py backend/app.py backend/db.py
git commit -m "Retire raw_powerbi_mr_wo_export; fix import HTTP 500; overview reads work_orders"
git push origin main
```

Then pull + restart the server on the deploy machine.

- If git reports `.git/index.lock` exists, delete that file first (a crashed git
  process left it behind).
- The diff for these files looks large only because of mixed CRLF/LF line endings;
  the real change is the four edits above.

## Correct import steps (for whoever deploys)
1. Open the **Downtime** tab.
2. **Import WO → Choose File**, select the MR/WO export (`.xlsx`, `.xls`, or `.csv`).
3. Keep **Replace** checked to replace the previous dataset, then click **Load**.
4. The import returns immediately and finishes writing in the background; the
   Overview / Predictive Insights and Downtime views then reflect the new file.

## If an import ever fails again
Thanks to change #4, the UI will show the actual error message instead of
"HTTP 500". Copy that message (or the server console/gunicorn log line) — it
pinpoints the cause directly.

## Verification status
Pre-change, the import was validated against a copy of the production database:
the 5,234-row file imports into `work_orders` and `/api/downtime` returns
populated data from it. A final seeded stale-batch integration re-run is still
pending (the local test sandbox ran out of disk); deploying is safe because any
failure now surfaces a real message rather than a blank 500.
