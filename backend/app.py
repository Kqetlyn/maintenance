"""
Standalone Maintenance Dashboard — Flask backend.
Serves only the Maintenance page and its required API endpoints.
"""

from datetime import datetime
from flask import Flask, jsonify, redirect, send_from_directory, request
import os

# ── Service imports (all kept — Maintenance page depends on all of them) ────────
from maintenance_service import (
    build_maintenance_overview_payload,
    build_filter_payload,
    build_list_payload,
    build_monthly_payload,
    build_summary_payload,
    build_timeline_payload,
    build_equipment_filter_payload,
    build_equipment_list_payload,
    build_equipment_monthly_payload,
    build_equipment_summary_payload,
    build_equipment_timeline_payload,
)
from spare_parts_service import (
    build_spare_parts_payload,
    build_project_transactions_payload,
    build_all_years_transactions_payload,
    build_external_po_payload,
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

# ── Path configuration ────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
# DATA_DIR can be overridden via environment variable for deployed environments
# (e.g. Railway persistent volume mounted at /data)
DATA_DIR = os.environ.get("DATA_DIR") or os.path.abspath(os.path.join(BASE_DIR, "..", "data"))
os.makedirs(DATA_DIR, exist_ok=True)

# ── App setup ─────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=FRONTEND_DIR)


@app.after_request
def apply_cache_headers(response):
    """Prevent stale caches for API JSON; allow short browser cache for static assets."""
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ── Frontend routes ───────────────────────────────────────────────────────────

@app.route("/")
def root():
    """Root URL serves the Maintenance page directly."""
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

# ── Downtime routes (needed by Maintenance "Analysis" tab) ───────────────────

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
                {"asset_id": e["asset_id"], "label": e["asset_display_name"]}
                for e in group.get("asset_entries", [])
            ]
            machines.append({
                "machine_name": group["machine_group"],
                "location": group["location"],
                "criticality": group["criticality"],
                "asset_count": len(assets),
                "assets": assets,
            })

        return jsonify({
            "machines": machines,
            "refrigeration_tree": build_refrigeration_tree(mapping),
            "meta": get_asset_mapping_meta(DATA_DIR),
        })
    except Exception as exc:
        return jsonify({"machines": [], "error": str(exc)}), 500


@app.route("/api/downtime")
def downtime_data():
    period = request.args.get("period")
    month = request.args.get("month")
    work_orders_only = str(request.args.get("work_orders_only", "")).strip().lower() in {"1", "true", "yes", "on"}
    return jsonify(build_downtime_payload(period, month, request.args.get("start"), request.args.get("end"), work_orders_only=work_orders_only))


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
    return jsonify(build_mtbf_work_order_history_payload())


def get_path_mtime_iso(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).isoformat()
    except (FileNotFoundError, OSError, ValueError):
        return None


def get_page_last_synced(page_key):
    key = (page_key or "").strip().lower()

    if key == "maintenance":
        return get_maintenance_import_status().get("last_synced")

    if key == "downtime":
        sources = get_work_order_import_status().get("sources") or []
        latest_source = max((source.get("last_modified") for source in sources if source.get("last_modified")), default=None)
        return latest_source or get_path_mtime_iso(os.path.join(DATA_DIR, "AssetList_Edit.xlsx"))

    return None


@app.route("/api/page-sync/<page_key>")
def page_sync(page_key):
    return jsonify({"page": page_key, "last_synced": get_page_last_synced(page_key)})


# ── Maintenance API routes ────────────────────────────────────────────────────

@app.route("/api/maintenance/overview")
def maintenance_overview():
    return jsonify(
        build_maintenance_overview_payload(
            month_value=request.args.get("month"),
            status=request.args.get("status", "all"),
            category=request.args.get("category", "all"),
            search=request.args.get("search", ""),
            sort=request.args.get("sort", "date_asc"),
            year=request.args.get("year", type=int),
            mix_month_value=request.args.get("mix_month"),
        )
    )


@app.route("/api/maintenance/utility/summary")
def maintenance_utility_summary():
    return jsonify(build_summary_payload(request.args.get("year", type=int)))


@app.route("/api/maintenance/utility/monthly")
def maintenance_utility_monthly():
    return jsonify(build_monthly_payload(request.args.get("month"), request.args.get("year", type=int)))


@app.route("/api/maintenance/utility/list")
def maintenance_utility_list():
    return jsonify(
        build_list_payload(
            month_value=request.args.get("month"),
            status=request.args.get("status", "all"),
            category=request.args.get("category", "all"),
            location=request.args.get("location", "all"),
            inspection=request.args.get("inspection", "all"),
            search=request.args.get("search", ""),
            sort=request.args.get("sort", "due_date_asc"),
            year=request.args.get("year", type=int),
            aggregate=request.args.get("aggregate", "occurrence"),
        )
    )


@app.route("/api/maintenance/utility/timeline")
def maintenance_utility_timeline():
    return jsonify(build_timeline_payload(request.args.get("year", type=int), request.args.get("month")))


@app.route("/api/maintenance/utility/filters")
def maintenance_utility_filters():
    return jsonify(build_filter_payload(request.args.get("year", type=int)))


@app.route("/api/maintenance/equipment/summary")
def maintenance_equipment_summary():
    return jsonify(build_equipment_summary_payload(request.args.get("year", type=int)))


@app.route("/api/maintenance/equipment/monthly")
def maintenance_equipment_monthly():
    return jsonify(build_equipment_monthly_payload(request.args.get("month"), request.args.get("year", type=int)))


@app.route("/api/maintenance/equipment/list")
def maintenance_equipment_list():
    return jsonify(
        build_equipment_list_payload(
            month_value=request.args.get("month"),
            status=request.args.get("status", "all"),
            category=request.args.get("category", "all"),
            location=request.args.get("location", "all"),
            inspection=request.args.get("inspection", "all"),
            search=request.args.get("search", ""),
            sort=request.args.get("sort", "due_date_asc"),
            year=request.args.get("year", type=int),
            aggregate=request.args.get("aggregate", "occurrence"),
            priority=request.args.get("priority", "all"),
            critical=request.args.get("critical", "all"),
            week=request.args.get("week", "all"),
        )
    )


@app.route("/api/maintenance/equipment/timeline")
def maintenance_equipment_timeline():
    return jsonify(build_equipment_timeline_payload(request.args.get("year", type=int), request.args.get("month")))


@app.route("/api/maintenance/equipment/filters")
def maintenance_equipment_filters():
    return jsonify(build_equipment_filter_payload(request.args.get("year", type=int)))


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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "0") not in {"0", "false", "no"}
    print(f"Maintenance standalone server starting on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
