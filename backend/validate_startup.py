"""Read-only startup validation for the Maintenance Dashboard.

Run before deployment with the same environment variables as the web process:

    python backend/validate_startup.py
    python backend/validate_startup.py --json

The validator never creates directories, databases, users, or cache files.
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import os
import sqlite3
import sys
from pathlib import Path

from runtime_config import DATA_DIR, PROJECT_ROOT


REQUIRED_PACKAGES = ("flask", "pandas", "openpyxl", "xlrd", "deep_translator")
SERVER_PACKAGES = ("gunicorn", "waitress")
REQUIRED_TABLES = {
    "asset_master",
    "work_orders",
    "import_log",
    "pm_schedule",
    "spare_parts",
    "users",
}
REQUIRED_FILES = (
    PROJECT_ROOT / "backend" / "app.py",
    PROJECT_ROOT / "frontend" / "Maintenance" / "index.html",
    PROJECT_ROOT / "frontend" / "Downtime" / "index.html",
    PROJECT_ROOT / "backend" / "templates" / "login.html",
)
OPTIONAL_DATA_SOURCES = (
    DATA_DIR / "master" / "Asset_Master.xlsx",
    DATA_DIR / "utility_maintenance_stage1_source.xlsx",
    DATA_DIR / "equipment_maintenance_schedule_source.xlsx",
    DATA_DIR / "spare_parts_master.xlsx",
)


def _check_route_definitions(path: Path) -> tuple[int, list[str]]:
    """Return literal route count and duplicate endpoint function names."""
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    endpoints: list[str] = []
    route_count = 0
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        has_route = False
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            func = call.func if call else None
            if isinstance(func, ast.Attribute) and func.attr == "route":
                route_count += 1
                has_route = True
        if has_route:
            endpoints.append(node.name)
    duplicates = sorted({name for name in endpoints if endpoints.count(name) > 1})
    return route_count, duplicates


def validate() -> dict:
    checks: list[dict] = []

    def add(name: str, status: str, message: str) -> None:
        checks.append({"name": name, "status": status, "message": message})

    if sys.version_info >= (3, 10):
        add("python", "ok", sys.version.split()[0])
    else:
        add("python", "error", f"Python 3.10+ required; found {sys.version.split()[0]}")

    missing = [name for name in REQUIRED_PACKAGES if importlib.util.find_spec(name) is None]
    add(
        "dependencies",
        "error" if missing else "ok",
        "Missing: " + ", ".join(missing) if missing else "Required import packages are available.",
    )
    servers = [name for name in SERVER_PACKAGES if importlib.util.find_spec(name) is not None]
    missing_servers = [name for name in SERVER_PACKAGES if name not in servers]
    add(
        "wsgi_servers",
        "error" if missing_servers else "ok",
        (
            f"Available: {', '.join(servers) or 'none'}; missing: {', '.join(missing_servers) or 'none'}."
        ),
    )

    parent = DATA_DIR.parent
    if DATA_DIR.is_dir():
        writable = os.access(DATA_DIR, os.W_OK)
        add("data_directory", "ok" if writable else "error", f"{DATA_DIR} (writable={writable})")
    else:
        parent_writable = parent.is_dir() and os.access(parent, os.W_OK)
        add(
            "data_directory",
            "warning" if parent_writable else "error",
            f"{DATA_DIR} does not exist; the app can create it only when its parent is writable={parent_writable}.",
        )

    missing_files = [str(path) for path in REQUIRED_FILES if not path.is_file()]
    add(
        "application_files",
        "error" if missing_files else "ok",
        "Missing: " + ", ".join(missing_files) if missing_files else "Backend, dashboard shells, and login template are present.",
    )

    route_total = 0
    route_duplicates: list[str] = []
    for route_file in (PROJECT_ROOT / "backend" / "app.py", PROJECT_ROOT / "backend" / "mira" / "api.py"):
        try:
            count, duplicates = _check_route_definitions(route_file)
            route_total += count
            route_duplicates.extend(duplicates)
        except Exception as exc:
            add("route_definitions", "error", f"Could not parse {route_file.name}: {exc}")
            break
    else:
        add(
            "route_definitions",
            "error" if route_duplicates else "ok",
            f"{route_total} literal route registrations; duplicate endpoints: {route_duplicates or 'none'}.",
        )

    db_path = DATA_DIR / "dashboard.db"
    if not db_path.is_file():
        add("database", "warning", f"{db_path} does not exist; it will be initialized on first startup.")
    else:
        try:
            uri = db_path.resolve().as_uri() + "?mode=ro"
            with sqlite3.connect(uri, uri=True, timeout=5) as conn:
                tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            missing_tables = sorted(REQUIRED_TABLES - tables)
            add(
                "database",
                "warning" if missing_tables else "ok",
                f"Readable at {db_path}; missing tables: {missing_tables or 'none'}.",
            )
        except Exception as exc:
            add("database", "error", f"Could not open {db_path} read-only: {exc}")

    present_sources = [path.name for path in OPTIONAL_DATA_SOURCES if path.is_file()]
    missing_sources = [path.name for path in OPTIONAL_DATA_SOURCES if not path.is_file()]
    add(
        "optional_data_sources",
        "ok" if not missing_sources else "warning",
        f"Present: {present_sources or 'none'}; unavailable: {missing_sources or 'none'}.",
    )

    ollama_enabled = os.environ.get("OLLAMA_ENABLED", "").lower() in {"1", "true", "yes"} or os.environ.get("LLM_PROVIDER", "").lower() == "ollama"
    add(
        "optional_ollama",
        "warning" if ollama_enabled else "ok",
        (
            f"Enabled; runtime connectivity must be checked at {os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')}."
            if ollama_enabled
            else "Disabled; rule-based predictive summaries remain available."
        ),
    )

    errors = sum(item["status"] == "error" for item in checks)
    warnings = sum(item["status"] == "warning" for item in checks)
    return {"ok": errors == 0, "errors": errors, "warnings": warnings, "checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()
    result = validate()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for item in result["checks"]:
            print(f"[{item['status'].upper():7}] {item['name']}: {item['message']}")
        print(f"Result: errors={result['errors']}, warnings={result['warnings']}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
