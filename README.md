# Maintenance Dashboard

Flask-based maintenance dashboard with Predictive Insights, PM Schedule, Spare Parts, and Downtime views. The application uses SQLite for operational state and reads approved Excel/CSV sources from a configurable runtime data directory.

## Access model

- `restricted`: all dashboard views plus user management.
- `public`: PM Schedule and Downtime only.

Existing legacy role names are normalized to these two roles. The route and permission model is enforced on both pages and APIs.

## Requirements

- Python 3.10 or newer
- Writable persistent storage for `DATA_DIR`
- Linux: Gunicorn for production (included in `requirements.txt`)
- Windows: Waitress for local/production-like use (included in `requirements.txt`)
- Node.js is not required at runtime; it is useful only for optional JavaScript syntax checks.

## Clean installation

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Linux/macOS:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Export the values from `.env` through the deployment platform or shell. Flask does not load `.env` automatically. At minimum, configure strong `DASHBOARD_MANAGEMENT_PASSWORD`, `DASHBOARD_STAFF_PASSWORD`, and `DASHBOARD_SECRET_KEY` values before the first start. Existing database users are preserved on restarts.

## Runtime data

`DATA_DIR` defaults to the project `data/` directory and may be overridden for deployments. All mutable caches, imports, triage verdicts, and the SQLite database follow this setting. Important canonical sources include:

- `master/Asset_Master.xlsx`
- `utility_maintenance_stage1_source.xlsx`
- `equipment_maintenance_schedule_source.xlsx`
- `spare_parts_master.xlsx`
- `work_order_imports/`, `spare_parts_imports/`, and `project_transactions_imports/`

Personal `Downloads` paths are not used. Optional external workbook locations can be set with the variables documented in [.env.example](.env.example).

## Validate before startup

The validator is read-only: it does not create a database, directories, users, or caches.

```powershell
python backend\validate_startup.py
python backend\validate_startup.py --json
```

It checks Python/dependencies, application files, route declarations, the data directory, existing database tables, expected source availability, and optional Ollama configuration.

## Run

Local Windows server:

```powershell
python backend\app.py
```

Production (same command as `Procfile`):

```bash
gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120
```

The public readiness endpoint is `GET /api/health`. It returns HTTP 200 when SQLite and required writable runtime directories are ready. Missing optional source files and Ollama state are reported separately without triggering heavy workbook loads.

## Tests

```powershell
python -m unittest discover -s backend\tests -p "test_*.py" -v
cd backend
python -m mira.tests.test_mira
```

The runtime safety suite starts the app against an isolated temporary database, verifies public/restricted role behavior, confirms the health endpoint, checks for duplicate route signatures, and forces failed replacement imports to prove the last valid data is rolled back intact.

## Import refresh behavior

- Work-order imports are accepted asynchronously to avoid reverse-proxy timeouts. Downtime refreshes when the database commit completes, and Predictive Insights refreshes if it has mounted.
- Spare-parts imports refresh their active view and also refresh mounted Predictive Insights.
- If Predictive Insights has not yet mounted, opening it performs the normal fresh load against the invalidated server caches.

Do not commit production workbooks, imported files, SQLite databases, backups, cache files, or generated secrets. The ignore rules cover new runtime artifacts; already tracked historical data should be removed only through an approved data-migration/deployment plan.
