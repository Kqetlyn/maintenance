"""
Standalone Maintenance Dashboard — Flask backend.
Serves only the Maintenance page and its required API endpoints.
"""

from datetime import datetime
from flask import Flask, jsonify, redirect, send_from_directory, request
import os

# ── Service imports ─────────────────────────────────────────────────────────────
# The legacy maintenance overview / utility / equipment builders are no longer
# imported here — those endpoints were removed. PM Schedule, Spare Parts and
# Downtime have their own services below.
from pm_schedule_service import build_pm_schedule_payload
from pm_schedule_overrides import save_override as save_pm_override
from pm_planner_store import (
    get_asset_catalog,
    create_tasks as create_planner_tasks,
    update_task as update_planner_task,
    delete_task as delete_planner_task,
)
from pm_schedule_sources import (
    get_pm_schedule_last_synced,
)
from spare_parts_service import (
    build_spare_parts_payload,
    build_project_transactions_payload,
    build_all_years_transactions_payload,
    build_external_po_payload,
    build_asset_parts_intelligence_context,
    import_spare_inventory_file,
    import_external_po_file,
    import_project_transactions_file,
    get_maintenance_import_status,
)
# downtime_service is needed by the Maintenance "Analysis" and "Downtime" tabs
# (/api/downtime?period=all_years&work_orders_only=1) and by spare_parts_service
from downtime_service import (
    build_downtime_payload,
    build_mtbf_work_order_history_payload,
    get_work_order_import_status,
    import_work_order_file,
)
try:
    from mira.api import mira_bp
except Exception as mira_import_error:
    mira_bp = None
else:
    mira_import_error = None

# ── Path configuration ────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
# DATA_DIR can be overridden via environment variable for deployed environments
# (e.g. Railway persistent volume mounted at /data)
DATA_DIR = os.environ.get("DATA_DIR") or os.path.abspath(os.path.join(BASE_DIR, "..", "data"))
os.makedirs(DATA_DIR, exist_ok=True)
ASSET_MASTER_RELATIVE_PATH = os.path.join("master", "Asset_Master.xlsx")

# ── App setup ─────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=FRONTEND_DIR)
APP_VERSION = "2026-06-08-stabilise-1"
_BACKEND_START = datetime.now()

import json as _json
import time as _time
import threading as _threading

# Route-level response cache: the heavy pages (downtime ~32 MB, pm-schedule
# ~13 MB) are expensive to BUILD (14-50s) and the dict-level caches are fragile
# under the threaded dev server. Caching the fully-serialized response bytes by
# URL for a short window makes repeat loads instant regardless — and the build
# happens at most once per window (warmed at startup). Mutations clear it.
_ROUTE_CACHE = {}              # key -> (monotonic_ts, json_bytes)
_ROUTE_CACHE_TTL = 180.0
_ROUTE_CACHE_LOCK = _threading.Lock()


def _cached_json(key, builder):
    now = _time.monotonic()
    hit = _ROUTE_CACHE.get(key)
    if hit is not None and (now - hit[0]) < _ROUTE_CACHE_TTL:
        return app.response_class(hit[1], mimetype="application/json")
    body = _json.dumps(builder(), default=str)
    with _ROUTE_CACHE_LOCK:
        _ROUTE_CACHE[key] = (now, body)
    return app.response_class(body, mimetype="application/json")


def _invalidate_route_cache():
    """Drop cached responses + payload dict caches so the next request rebuilds
    fresh after an edit/upload."""
    with _ROUTE_CACHE_LOCK:
        _ROUTE_CACHE.clear()
    for mod, attr in (("pm_schedule_service", "_PM_PAGE_PAYLOAD_CACHE"), ("downtime_service", "_DOWNTIME_CACHE")):
        try:
            import importlib
            getattr(importlib.import_module(mod), attr).clear()
        except Exception:
            pass


# Endpoints that actually change dashboard data — a successful POST to any of
# these invalidates the response cache so the next load reflects the change.
_MUTATION_PREFIXES = (
    "/api/maintenance/pm-schedule/",   # update / plan / delete
    "/api/downtime/import",
    "/api/maintenance/import",
)


@app.after_request
def _clear_cache_after_mutation(response):
    try:
        if request.method == "POST" and any(request.path.startswith(p) for p in _MUTATION_PREFIXES):
            _invalidate_route_cache()
    except Exception:
        pass
    return response


import gzip as _gzip


@app.after_request
def _gzip_large_responses(response):
    """Gzip large responses. The dashboard payloads are 13-32 MB and the dev
    server transmits uncompressed bytes at <1 MB/s, which was the real cause of
    slow page loads (the build/cache were already fast). Gzip shrinks them ~10-15x
    so they transfer in ~1s. Browsers decompress transparently."""
    try:
        if (
            response.status_code != 200
            or response.direct_passthrough
            or "Content-Encoding" in response.headers
            or "gzip" not in request.headers.get("Accept-Encoding", "").lower()
        ):
            return response
        data = response.get_data()
        if len(data) < 2048:
            return response
        compressed = _gzip.compress(data, 5)
        response.set_data(compressed)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(compressed))
        response.headers["Vary"] = "Accept-Encoding"
    except Exception:
        pass
    return response


if mira_bp is not None:
    app.register_blueprint(mira_bp)
else:
    print(f"MIRA routes unavailable: {mira_import_error}")


@app.route("/api/health")
def api_health():
    """Lightweight liveness/readiness probe — never triggers a heavy load."""
    import downtime_service as _dt
    import pm_schedule_service as _pm

    def _has(*names):
        for n in names:
            parts = n if isinstance(n, tuple) else (n,)
            if os.path.exists(os.path.join(DATA_DIR, *parts)):
                return True
        return False

    ollama_enabled = (
        os.environ.get("LLM_PROVIDER", "").lower() == "ollama"
        or os.environ.get("OLLAMA_ENABLED", "").lower() in {"1", "true", "yes"}
    )
    return jsonify({
        "status": "ok",
        "version": APP_VERSION,
        "startTime": _BACKEND_START.isoformat(),
        "uptimeSeconds": round((datetime.now() - _BACKEND_START).total_seconds()),
        "data": {
            "mrDataLoaded": bool(getattr(_dt, "_WO_LOAD_CACHE", {}).get("payload")),
            "sparePartsDataLoaded": _has("spare_parts_master.xlsx"),
            "pmDataLoaded": bool(getattr(_pm, "_PM_PAGE_PAYLOAD_CACHE", None)) or _has("equipment_maintenance_schedule_source.xlsx"),
            "assetMasterPresent": _has(("master", "Asset_Master.xlsx")),
        },
        "caches": {
            "downtimeWarm": bool(getattr(_dt, "_DOWNTIME_CACHE", None)),
            "pmPageWarm": bool(getattr(_pm, "_PM_PAGE_PAYLOAD_CACHE", None)),
            "assetProfilesCached": _ASSET_PROFILE_CACHE.get("profiles") is not None,
        },
        "ollama": {
            "enabled": ollama_enabled,
            "baseUrl": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            "model": os.environ.get("OLLAMA_MODEL", "qwen2.5:7b"),
        },
    })


@app.after_request
def apply_cache_headers(response):
    """Prevent stale caches for API JSON; allow short browser cache for static assets."""
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ── Frontend routes ───────────────────────────────────────────────────────────

@app.route("/")
def root():
    """Root URL serves the Maintenance page, defaulting to the Downtime view."""
    if not str(request.args.get("view", "")).strip():
        return redirect("/?view=downtime")
    return send_from_directory(os.path.join(FRONTEND_DIR, "Maintenance"), "index.html")


@app.route("/Downtime")
@app.route("/Downtime/index.html")
def downtime_root():
    """Downtime is part of the Maintenance page; embed mode still serves the HTML file."""
    embed_mode = str(request.args.get("embed", "")).strip().lower() in {"1", "true", "yes", "on"}
    if embed_mode:
        return send_from_directory(os.path.join(FRONTEND_DIR, "Downtime"), "index.html")
    return redirect("/?view=downtime")


@app.route("/<path:path>")
def frontend_files(path):
    """Catch-all static file server for CSS, JS, shared assets, etc."""
    return send_from_directory(FRONTEND_DIR, path)


# ── Asset list (shared by Maintenance Analysis tab and Downtime) ──────────────
from asset_mapping import load_asset_mapping, build_refrigeration_tree, get_asset_mapping_meta
import asset_resolver

# ── Downtime routes (needed by Maintenance "Analysis" tab) ───────────────────

# Smart-matching asset profiles are built once from the asset master and cached
# (rebuilt only when the master changes). The slim profile is what the frontend
# matcher needs for live search + selected-asset matching.
_ASSET_PROFILE_CACHE = {"signature": None, "profiles": None}


def _slim_profile(profile):
    return {
        "assetId": profile["assetId"],
        "canonicalName": profile["canonicalName"],
        "nameTokens": profile["nameTokens"],
        "number": profile["number"],
        "aliases": profile["aliases"],
        "relatedKeywords": profile["relatedKeywords"],
        "functionalLocation": profile["functionalLocation"],
        "machineGroup": profile["machineGroup"],
    }


def get_cached_asset_profiles(mapping, signature):
    if _ASSET_PROFILE_CACHE["signature"] == signature and _ASSET_PROFILE_CACHE["profiles"] is not None:
        return _ASSET_PROFILE_CACHE["profiles"]
    inputs = []
    for group in mapping.get("groups", []):
        for entry in group.get("asset_entries", []):
            inputs.append({
                "asset_id": entry.get("asset_id"),
                "name": entry.get("mappedAssetName") or entry.get("asset_display_name"),
                "machine_group": entry.get("mappedMainAssetGroup") or group.get("machine_group"),
                "functional_location": entry.get("mappedLocation") or entry.get("mappedSystemArea") or group.get("location"),
            })
    full = asset_resolver.build_all_asset_profiles(inputs)
    profiles = {aid: _slim_profile(p) for aid, p in full.items()}
    _ASSET_PROFILE_CACHE["signature"] = signature
    _ASSET_PROFILE_CACHE["profiles"] = profiles
    return profiles


@app.route("/api/asset-list")
def asset_list_api():
    try:
        mapping = load_asset_mapping(DATA_DIR)
        if not mapping["available"]:
            return jsonify({"machines": [], "error": mapping["message"]}), 404

        # Build grouped machine list matching the old response shape
        machines = []
        for group in mapping["groups"]:
            assets = [
                {
                    "asset_id": e["asset_id"],
                    "label": e["asset_display_name"],
                    "mappedStage": e.get("mappedStage"),
                    "mappedAssetName": e.get("mappedAssetName") or e.get("asset_display_name"),
                    "mappedMainAssetGroup": e.get("mappedMainAssetGroup") or group.get("mappedMainAssetGroup"),
                    "mappedSubAssetGroup": e.get("mappedSubAssetGroup"),
                    "mappedLocation": e.get("mappedLocation") or group.get("mappedLocation"),
                    "mappedSystemArea": e.get("mappedSystemArea"),
                    "mappingStatus": e.get("mappingStatus"),
                }
                for e in group.get("asset_entries", [])
            ]
            machines.append({
                "machine_name": group["machine_group"],
                "location": group["location"],
                "criticality": group["criticality"],
                "mappedStage": group.get("mappedStage"),
                "mappedMainAssetGroup": group.get("mappedMainAssetGroup") or group["machine_group"],
                "mappedSubAssetGroup": group.get("mappedSubAssetGroup"),
                "mappedLocation": group.get("mappedLocation") or group["location"],
                "mappedSystemArea": group.get("mappedSystemArea"),
                "mappingStatus": group.get("mappingStatus"),
                "asset_count": len(assets),
                "assets": assets,
            })

        meta = get_asset_mapping_meta(DATA_DIR)
        return jsonify({
            "machines": machines,
            "refrigeration_tree": build_refrigeration_tree(mapping),
            "asset_profiles": get_cached_asset_profiles(mapping, meta.get("last_synced")),
            "meta": meta,
        })
    except Exception as exc:
        return jsonify({"machines": [], "error": str(exc)}), 500


@app.route("/api/downtime")
def downtime_data():
    period = request.args.get("period")
    month = request.args.get("month")
    work_orders_only = str(request.args.get("work_orders_only", "")).strip().lower() in {"1", "true", "yes", "on"}
    return _cached_json(
        ("downtime", request.full_path),
        lambda: build_downtime_payload(period, month, request.args.get("start"), request.args.get("end"), work_orders_only=work_orders_only, stage=request.args.get("stage")),
    )


@app.route("/api/downtime/import-work-orders", methods=["GET", "POST"])
def downtime_import_work_orders():
    if request.method == "GET":
        return jsonify(get_work_order_import_status())
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No work order file uploaded."}), 400
    replace = str(request.form.get("replace", "true")).strip().lower() not in {"0", "false", "no"}
    result = import_work_order_file(upload, replace=replace)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/downtime/mtbf-history")
def downtime_mtbf_history():
    return jsonify(build_mtbf_work_order_history_payload(stage=request.args.get("stage")))


def get_path_mtime_iso(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
    except (FileNotFoundError, OSError, ValueError):
        return None


def get_page_last_synced(page_key):
    key = (page_key or "").strip().lower()

    if key == "maintenance":
        return get_pm_schedule_last_synced() or get_maintenance_import_status().get("last_synced")

    if key == "downtime":
        sources = get_work_order_import_status().get("sources") or []
        latest_source = max((source.get("last_modified") for source in sources if source.get("last_modified")), default=None)
        return latest_source or get_path_mtime_iso(os.path.join(DATA_DIR, ASSET_MASTER_RELATIVE_PATH))

    return None
@app.route("/api/page-sync/<page_key>")
def page_sync(page_key):
    return jsonify({"page": page_key, "last_synced": get_page_last_synced(page_key)})


# ── Maintenance API routes ────────────────────────────────────────────────────

@app.route("/api/maintenance/pm-schedule")
def maintenance_pm_schedule():
    """Unified Preventive Maintenance schedule tracking (Stage 1 + Stage 2)."""
    return _cached_json(
        ("pm-schedule", request.full_path),
        lambda: build_pm_schedule_payload(
            stage=request.args.get("stage", "all"),
            year=request.args.get("year", type=int),
            month=request.args.get("month"),
        ),
    )


@app.route("/api/maintenance/pm-schedule/update", methods=["POST"])
def maintenance_pm_schedule_update():
    """Persist a single PM status update into the local override file.

    Edits are never written back to the read-only source workbooks; they are saved
    to data/pm_schedule_updates.json keyed by pmTaskId and merged on display.
    """
    body = request.get_json(silent=True) or {}
    task_id = body.get("pmTaskId") or body.get("taskId")
    if not task_id:
        return jsonify({"ok": False, "message": "pmTaskId is required."}), 400
    try:
        # Manual planner tasks are edited in their own store; imported tasks use the
        # read-only override layer.
        if str(task_id).startswith("manual_"):
            record = update_planner_task(task_id, body)
        else:
            record = save_pm_override(task_id, body)
        return jsonify({"ok": True, "record": record})
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"ok": False, "message": f"Could not save PM update: {exc}"}), 500


@app.route("/api/maintenance/pm-assets")
def maintenance_pm_assets():
    """Searchable asset catalogue from Asset_Master for the planner form."""
    return jsonify({"assets": get_asset_catalog()})


@app.route("/api/maintenance/pm-schedule/plan", methods=["POST"])
def maintenance_pm_schedule_plan():
    """Create a manual PM task (with optional recurrence) in the local planner store."""
    body = request.get_json(silent=True) or {}
    confirm = bool(body.get("confirm"))
    try:
        result = create_planner_tasks(body, confirm=confirm)
        status = 200 if result.get("ok") else 409  # 409 -> needs duplicate confirmation
        return jsonify(result), status
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive
        return jsonify({"ok": False, "message": f"Could not create PM task: {exc}"}), 500


@app.route("/api/maintenance/pm-schedule/delete", methods=["POST"])
def maintenance_pm_schedule_delete():
    """Delete a manually planned PM task (imported tasks can only be Cancelled)."""
    body = request.get_json(silent=True) or {}
    task_id = body.get("pmTaskId") or body.get("taskId")
    if not task_id or not str(task_id).startswith("manual_"):
        return jsonify({"ok": False, "message": "Only manually planned PM tasks can be deleted."}), 400
    deleted = delete_planner_task(task_id)
    return jsonify({"ok": deleted, "deleted": deleted})


# Legacy maintenance overview / utility / equipment endpoints removed — those
# pages are no longer in use (only PM Schedule, Spare Parts, Downtime and MIRA
# remain). PM Schedule is served by pm_schedule_service; the old maintenance_service
# list/summary/equipment builders are no longer wired to any route.


@app.route("/api/maintenance/spare_parts")
def maintenance_spare_parts():
    return jsonify(build_spare_parts_payload())


@app.route("/api/maintenance/project_transactions")
def maintenance_project_transactions():
    return jsonify(build_project_transactions_payload())


@app.route("/api/maintenance/project_transactions_all")
def maintenance_project_transactions_all():
    return jsonify(build_all_years_transactions_payload())


@app.route("/api/maintenance/external_po")
def maintenance_external_po():
    return jsonify(build_external_po_payload())


@app.route("/api/maintenance/asset-parts-intelligence")
def maintenance_asset_parts_intelligence():
    return jsonify(
        build_asset_parts_intelligence_context(
            query=request.args.get("query"),
            asset_id=request.args.get("assetId"),
            asset_name=request.args.get("assetName"),
            asset_family=request.args.get("assetFamily"),
            machine_group=request.args.get("machineGroup"),
            date_from=request.args.get("dateFrom"),
            date_to=request.args.get("dateTo"),
            include_related_matches=request.args.get("includeRelatedMatches", "true"),
            include_low_confidence=request.args.get("includeLowConfidence", "false"),
        )
    )


@app.route("/api/maintenance/import-status")
def maintenance_import_status():
    return jsonify(get_maintenance_import_status())


@app.route("/api/maintenance/import/spare-inventory", methods=["POST"])
def maintenance_import_spare_inventory():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No inventory file uploaded."}), 400
    result = import_spare_inventory_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/maintenance/import/external-po", methods=["POST"])
def maintenance_import_external_po():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No external parts file uploaded."}), 400
    result = import_external_po_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


@app.route("/api/maintenance/import/project-transactions", methods=["POST"])
def maintenance_import_project_transactions():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "message": "No project transactions file uploaded."}), 400
    result = import_project_transactions_file(upload)
    return jsonify(result), (200 if result.get("ok") else 400)


# ── Entry point ───────────────────────────────────────────────────────────────

def _free_port(port):
    """Best-effort: kill any process already holding the port before we bind, so
    a fresh launch never collides with a stale/hung instance (the dev server gets
    relaunched a lot and old python app.py processes pile up). Local dev only;
    never raises."""
    import subprocess
    import signal
    try:
        my_pid = str(os.getpid())
        if os.name == "nt":
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                if f":{port} " in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1] if parts else ""
                    if pid.isdigit() and pid not in (my_pid, "0"):
                        subprocess.run(["taskkill", "/f", "/pid", pid], capture_output=True)
        else:
            out = subprocess.run(["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True).stdout
            for pid in out.split():
                if pid.isdigit() and pid != my_pid:
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except OSError:
                        pass
    except Exception:
        pass


def _prewarm_caches():
    """Warm the route response cache in the background so the first real request
    isn't a cold ~40s build. Hits the routes via the test client so the cached
    response bytes are populated. Best-effort; never raises, never blocks startup."""
    def _warm():
        try:
            with app.test_client() as client:
                client.get("/api/downtime")
                client.get("/api/maintenance/pm-schedule")
        except Exception:
            pass

    _threading.Thread(target=_warm, name="cache-prewarm", daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    debug = os.environ.get("FLASK_DEBUG", "0") not in {"0", "false", "no"}
    # Only the first (parent) run frees the port; the reloader child must not.
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        _free_port(port)
    # Warm caches only in the process that actually serves (the reloader child,
    # or the single process when debug is off).
    if os.environ.get("WERKZEUG_RUN_MAIN") or not debug:
        _prewarm_caches()
    print(f"Maintenance standalone server starting on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
