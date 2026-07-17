"""Portable runtime paths shared by Maintenance Dashboard services.

All mutable application data lives below ``DATA_DIR``. Deployments may set
``DATA_DIR`` to an absolute or relative path; the project-local ``data``
directory remains the default for backwards compatibility.
"""

from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR") or PROJECT_ROOT / "data").expanduser().resolve()
CACHE_DIR = DATA_DIR / "_dashboard_cache"
WORK_ORDER_IMPORT_DIR = DATA_DIR / "work_order_imports"
SPARE_PARTS_IMPORT_DIR = DATA_DIR / "spare_parts_imports"
PROJECT_TRANSACTIONS_IMPORT_DIR = DATA_DIR / "project_transactions_imports"
UPLOAD_TMP_DIR = DATA_DIR / "_upload_tmp"


def ensure_runtime_directories() -> tuple[Path, ...]:
    """Create only the known writable runtime directories."""
    paths = (
        DATA_DIR,
        CACHE_DIR,
        WORK_ORDER_IMPORT_DIR,
        SPARE_PARTS_IMPORT_DIR,
        PROJECT_TRANSACTIONS_IMPORT_DIR,
        UPLOAD_TMP_DIR,
    )
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)
    return paths
