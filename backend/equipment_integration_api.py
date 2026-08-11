"""Token-protected, read-only maintenance API for the production dashboard."""

from __future__ import annotations

import datetime as dt
import hmac
import logging
import os
import re
from functools import wraps

from flask import Blueprint, jsonify, request

import availability_service as avail
import db
import equipment_capability_service as capability
from downtime_management import build_management_downtime_payload
from downtime_service import load_work_order_downtime_sql
from mira.services.kpi_query_service import _classify_preventive_corrective_row
from pm_schedule_service import build_pm_schedule_payload
from runtime_config import DATA_DIR


bp = Blueprint("maintenance_v1", __name__)
_LOG = logging.getLogger("app.maintenance_service_api")
_LOG.setLevel(logging.INFO)
_ASSET_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")
_FALSE_VALUES = {"0", "false", "no", "off"}
_PLACEHOLDER_TOKEN_PREFIXES = ("replace-with", "your_", "changeme")


def _truthy(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _token_is_configured(value):
    token = str(value or "").strip()
    return bool(token) and not token.lower().startswith(_PLACEHOLDER_TOKEN_PREFIXES)


def _service_config_state():
    raw_flag = os.environ.get("MAINTENANCE_API_ENABLED")
    normalized = str(raw_flag or "").strip().lower()
    if normalized in _FALSE_VALUES:
        return "disabled"
    if not _token_is_configured(os.environ.get("MAINTENANCE_API_SERVICE_TOKEN")):
        return "not_configured"
    return "enabled"


def _error(message, status):
    return jsonify({"ok": False, "error": message, "message": message}), status


def _service_auth(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        config_state = _service_config_state()
        _LOG.info(
            "maintenance_service_config feature_flag=%s state=%s token_configured=%s",
            os.environ.get("MAINTENANCE_API_ENABLED", "unset") or "unset",
            config_state,
            _token_is_configured(os.environ.get("MAINTENANCE_API_SERVICE_TOKEN")),
        )
        if config_state == "disabled":
            return _error("Maintenance integration API is disabled.", 503)
        if config_state == "not_configured":
            return _error("Maintenance integration API is not configured.", 503)
        expected = str(os.environ.get("MAINTENANCE_API_SERVICE_TOKEN", "")).strip()
        auth = str(request.headers.get("Authorization") or "").strip()
        supplied = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not supplied:
            supplied = str(request.headers.get("X-Service-Token") or "").strip()
        if not supplied:
            return _error("Service authentication is required.", 401)
        if not expected or not hmac.compare_digest(supplied, expected):
            return _error("Service caller is not authorised.", 403)
        allowed = {value.strip() for value in str(os.environ.get("MAINTENANCE_ALLOWED_CALLERS", "")).split(",") if value.strip()}
        caller = str(request.headers.get("X-Caller-ID") or "").strip()
        if allowed and caller not in allowed:
            return _error("Service caller is not authorised.", 403)
        _LOG.info("maintenance_v1 method=%s path=%s caller=%s", request.method, request.path, caller or "unspecified")
        return view(*args, **kwargs)
    return wrapper


def _date(value, field):
    try:
        return dt.date.fromisoformat(str(value or ""))
    except ValueError as exc:
        raise ValueError(f"{field} must use YYYY-MM-DD.") from exc


def _validate_range(from_value, to_value):
    start, end = _date(from_value, "from"), _date(to_value, "to")
    if start > end:
        raise ValueError("from must not be after to.")
    maximum = int(os.environ.get("MAINTENANCE_API_MAX_DATE_RANGE_DAYS", "730"))
    if (end - start).days > maximum:
        raise ValueError(f"Date range must not exceed {maximum} days.")
    return start, end


def _validate_asset_id(asset_id):
    value = str(asset_id or "").strip()
    if not _ASSET_ID_RE.fullmatch(value):
        raise ValueError("Asset IDs may contain only letters, numbers, periods, underscores, and hyphens.")
    return value


def _validate_stage(stage):
    value = str(stage or "").strip()
    if value.lower().startswith("stage "):
        value = value[6:].strip()
    if value not in {"1", "2"}:
        raise ValueError("Facility Stage must be 1 or 2.")
    return value


def _parse_datetime(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _validate_datetime(value, field):
    parsed = _parse_datetime(value)
    if parsed is None:
        raise ValueError(f"{field} must be an ISO 8601 date-time.")
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def _validate_datetime_range(from_value, to_value):
    start = _validate_datetime(from_value, "from/planned_start")
    end = _validate_datetime(to_value, "to/planned_end")
    if end <= start:
        raise ValueError("The window end must be after the window start.")
    maximum = int(os.environ.get("MAINTENANCE_API_MAX_WINDOW_DAYS", "31"))
    if (end - start).days > maximum:
        raise ValueError(f"Availability window must not exceed {maximum} days.")
    return start, end


def _event_datetime(row):
    return _parse_datetime(row.get("actual_start_time") or row.get("request_created_time") or row.get("start_time"))


def _in_period(row, start, end):
    event = _event_datetime(row)
    return bool(event and start <= event.date() <= end)


def _source_through(source_payload, records):
    values = [_event_datetime(row) for row in records]
    latest = max((value for value in values if value), default=None)
    return (latest.isoformat() if latest else source_payload.get("last_synced"))


def _pm_context(asset_ids, start, end):
    tasks = []
    for year in range(start.year, end.year + 1):
        payload = build_pm_schedule_payload(
            stage="all", year=year, period_mode="custom",
            start=max(start, dt.date(year, 1, 1)).isoformat(),
            end=min(end, dt.date(year, 12, 31)).isoformat(),
        )
        tasks.extend((payload.get("schedule") or {}).get("tasks") or [])
    today = dt.date.today()
    result = {}
    for asset_id in asset_ids:
        rows = [row for row in tasks if str(row.get("assetId") or "").strip() == asset_id]
        if not rows:
            result[asset_id] = {"pm_status": None, "pm_due_date": None,
                                "note": "No canonical PM schedule task was found for this Asset ID."}
            continue
        def rank(row):
            status = str(row.get("scheduleStatus") or "").strip().lower()
            planned = _date(row.get("plannedDate"), "plannedDate") if row.get("plannedDate") else dt.date.max
            return (0 if "overdue" in status else 1 if "due soon" in status else 2 if planned >= today else 3, planned)
        chosen = sorted(rows, key=rank)[0]
        raw = str(chosen.get("scheduleStatus") or "").strip().lower()
        if "overdue" in raw:
            status = "overdue"
        elif "due soon" in raw:
            status = "due_soon"
        elif "complete" in raw or "done" in raw:
            status = "completed"
        else:
            status = "scheduled"
        result[asset_id] = {"pm_status": status, "pm_due_date": chosen.get("plannedDate"),
                            "note": "Status comes from the existing PM schedule service."}
    return result


def _mttr_mtbf(period_rows, historical_rows, start, end, asset_id):
    start_dt = dt.datetime.combine(start, dt.time.min)
    end_dt = dt.datetime.combine(end, dt.time.max)
    payload = build_management_downtime_payload(
        period_rows, [], start_dt, end_dt, str(DATA_DIR),
        mtbf_records=period_rows, historical_records=historical_rows,
    )
    mttr = (payload.get("summary") or {}).get("overall_mttr_hours")
    selected_mtbf = (((payload.get("mtbf") or {}).get("views") or {}).get("selected_period") or {})
    asset_row = next((row for row in selected_mtbf.get("asset_rows") or [] if row.get("asset_id") == asset_id), None)
    mtbf_hours = asset_row.get("average_mtbf_hours") if asset_row else None
    return mttr, (round(float(mtbf_hours) / 24, 3) if mtbf_hours is not None else None)


def _asset_summary(asset, all_rows, period_rows, start, end, pm):
    asset_id = asset["asset_id"]
    classified = [(row, _classify_preventive_corrective_row(row)[0]) for row in period_rows]
    corrective = [row for row, kind in classified if kind == "corrective"]
    preventive = [row for row, kind in classified if kind == "preventive"]
    mttr, mtbf_days = _mttr_mtbf(period_rows, all_rows, start, end, asset_id)
    completed = [(_parse_datetime(row.get("actual_end_time") or row.get("end_time")), row) for row in all_rows]
    last_completed = max((value for value, _row in completed if value), default=None)
    last_breakdown = max((_event_datetime(row) for row in corrective if _event_datetime(row)), default=None)
    invalid_count = sum(1 for row in period_rows if str(row.get("data_quality_flag") or "").strip().lower() != "valid")
    notes = [
        "open_work_orders is current across the owned work-order source; period counts use the requested dates.",
        "asset_status is unavailable because work-order evidence is not an operating-state field.",
    ]
    if mttr is None:
        notes.append("MTTR cannot be calculated for the selected period from eligible completed repair durations.")
    if mtbf_days is None:
        notes.append("MTBF cannot be calculated because there are insufficient completed failure intervals in the selected period.")
    if pm.get("note"):
        notes.append(pm["note"])
    return {
        "asset_id": asset_id,
        "asset_name": asset.get("asset_name"),
        "stage": asset.get("stage"),
        "functional_location": asset.get("functional_location"),
        "open_work_orders": sum(1 for row in all_rows if bool(row.get("is_open"))),
        "corrective_work_orders": len(corrective),
        "preventive_work_orders": len(preventive),
        "selected_period_work_orders": len(period_rows),
        "mttr_hours": round(float(mttr), 3) if mttr is not None else None,
        "mtbf_days": mtbf_days,
        "last_breakdown_at": last_breakdown.isoformat() if last_breakdown else None,
        "last_completed_maintenance_at": last_completed.isoformat() if last_completed else None,
        "pm_status": pm.get("pm_status"),
        "pm_due_date": pm.get("pm_due_date"),
        "asset_status": None,
        "data_quality": "sufficient" if period_rows and invalid_count == 0 else "limited" if period_rows else "no_period_records",
        "metric_notes": notes,
    }


def _load_context(asset_ids, start, end, asset_stages=None):
    assets = {row["asset_id"]: row for row in db.query_asset_master() if row.get("asset_id") in asset_ids}
    asset_stages = asset_stages or {}
    mismatched = [
        asset_id for asset_id, expected in asset_stages.items()
        if asset_id in assets and _validate_stage(assets[asset_id].get("stage")) != expected
    ]
    if mismatched:
        raise ValueError(
            "Facility Stage does not match the maintenance asset master for: "
            + ", ".join(sorted(mismatched))
        )
    source = load_work_order_downtime_sql()
    records = source.get("records") or []
    rows_by_asset = {asset_id: [] for asset_id in assets}
    for row in records:
        asset_id = str(row.get("asset_id") or row.get("canonical_asset_id") or "").strip()
        if asset_id in rows_by_asset:
            rows_by_asset[asset_id].append(row)
    pm = _pm_context(set(assets), start, end) if assets else {}
    summaries = []
    for asset_id, asset in assets.items():
        all_rows = rows_by_asset[asset_id]
        period_rows = [row for row in all_rows if _in_period(row, start, end)]
        summaries.append(_asset_summary(asset, all_rows, period_rows, start, end, pm.get(asset_id) or {}))
    summaries.sort(key=lambda row: row["asset_id"])
    return source, records, summaries, sorted(set(asset_ids) - set(assets))


@bp.get("/api/v1/maintenance/health")
@_service_auth
def health():
    source = load_work_order_downtime_sql()
    records = source.get("records") or []
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    source_through = _source_through(source, records)
    _LOG.info("maintenance_health result=ok source_through=%s", source_through or "not_available")
    return jsonify({"status": "ok", "generated_at": now, "source_through": source_through})


@bp.post("/api/v1/maintenance/assets/summary")
@_service_auth
def asset_summaries():
    body = request.get_json(silent=True) or {}
    asset_ids = body.get("asset_ids")
    asset_stages = body.get("asset_stages")
    maximum = int(os.environ.get("MAINTENANCE_API_MAX_ASSETS_PER_REQUEST", "100"))
    if not isinstance(asset_ids, list) or not asset_ids or len(asset_ids) > maximum:
        return _error(f"asset_ids must contain 1 to {maximum} values.", 422)
    if asset_stages is not None and not isinstance(asset_stages, dict):
        return _error("asset_stages must be an Asset ID to facility Stage object.", 422)
    try:
        clean_ids = sorted({_validate_asset_id(value) for value in asset_ids})
        _LOG.info("maintenance_asset_summary requested_asset_ids=%d", len(clean_ids))
        clean_stages = {
            _validate_asset_id(asset_id): _validate_stage(stage)
            for asset_id, stage in (asset_stages or {}).items()
            if str(asset_id).strip() in clean_ids
        }
        start, end = _validate_range(body.get("from"), body.get("to"))
    except ValueError as exc:
        return _error(str(exc), 422)
    try:
        source, records, assets, unmatched = _load_context(clean_ids, start, end, clean_stages)
        _LOG.info("maintenance_asset_summary returned_summaries=%d unmatched_asset_ids=%d",
                  len(assets), len(unmatched))
        return jsonify({
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source_through": _source_through(source, records),
            "period": {"from": start.isoformat(), "to": end.isoformat()},
            "assets": assets, "unmatched_asset_ids": unmatched,
        })
    except ValueError as exc:
        return _error(str(exc), 422)
    except Exception:
        _LOG.exception("maintenance_v1 summary failed")
        return _error("Maintenance summary could not be generated.", 500)


@bp.get("/api/v1/maintenance/assets/<asset_id>/work-orders")
@_service_auth
def asset_work_orders(asset_id):
    try:
        asset_id = _validate_asset_id(asset_id)
        start, end = _validate_range(request.args.get("from"), request.args.get("to"))
        limit = int(request.args.get("limit", "50"))
        offset = int(request.args.get("offset", "0"))
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("limit must be 1-100 and offset must be non-negative.")
    except (ValueError, TypeError) as exc:
        return _error(str(exc), 422)
    asset = next((row for row in db.query_asset_master() if row.get("asset_id") == asset_id), None)
    if not asset:
        return _error("Unknown Asset ID.", 404)
    source = load_work_order_downtime_sql()
    rows = [row for row in source.get("records") or [] if row.get("asset_id") == asset_id and _in_period(row, start, end)]
    rows.sort(key=lambda row: _event_datetime(row) or dt.datetime.min, reverse=True)
    safe_rows = [{
        "work_order_id": row.get("work_order_id"),
        "maintenance_order_id": row.get("maintenance_order_id"),
        "status": row.get("status"),
        "maintenance_job_type": row.get("maintenance_job_type"),
        "actual_start_at": row.get("actual_start_time"),
        "actual_end_at": row.get("actual_end_time"),
        "ttr_hours": row.get("ttr_hours"),
        "data_quality_flag": row.get("data_quality_flag"),
    } for row in rows[offset:offset + limit]]
    return jsonify({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_through": _source_through(source, source.get("records") or []),
        "asset_id": asset_id, "from": start.isoformat(), "to": end.isoformat(),
        "total": len(rows), "limit": limit, "offset": offset, "work_orders": safe_rows,
    })


# ── Availability (read-only; Phase 1) ──────────────────────────────────────────
# Availability is derived from confirmed downtime_event intervals (verified/partial)
# with a live work-order proxy fallback. This endpoint NEVER writes downtime_event —
# materialisation of WO-derived proxy events is the Phase 7 ingestion job's job.

def _compute_availability(items):
    """Shared availability computation for the GET and POST routes.

    ``items`` is a list of {asset_id, facility_stage(optional), window_start, window_end}
    with validated, naive datetimes. Loads the WO source, confirmed events and PM
    context once, then defers the interval algebra to ``availability_service``.
    """
    asset_ids = sorted({item["asset_id"] for item in items})
    assets = {row["asset_id"]: row for row in db.query_asset_master() if row.get("asset_id") in asset_ids}

    # Fail closed on a Stage 1/Stage 2 mismatch so a window is never answered with the
    # wrong stage's data (canonical asset_id + facility_stage join is non-negotiable).
    mismatched = sorted({
        item["asset_id"] for item in items
        if item.get("facility_stage") and item["asset_id"] in assets
        and _validate_stage(item["facility_stage"]) != _validate_stage(assets[item["asset_id"]].get("stage"))
    })
    if mismatched:
        raise ValueError(
            "facility_stage does not match the maintenance asset master for: "
            + ", ".join(mismatched))

    overall_start = min(item["window_start"] for item in items)
    overall_end = max(item["window_end"] for item in items)

    source = load_work_order_downtime_sql()
    records = source.get("records") or []
    rows_by_asset = {asset_id: [] for asset_id in asset_ids}
    for row in records:
        asset_id = str(row.get("asset_id") or row.get("canonical_asset_id") or "").strip()
        if asset_id in rows_by_asset:
            rows_by_asset[asset_id].append(row)

    confirmed_rows = db.query_downtime_events(
        asset_ids=asset_ids, start_iso=overall_start.isoformat(), end_iso=overall_end.isoformat(),
        confirmed_only=True,
    )
    confirmed_by_asset: dict = {}
    for row in confirmed_rows:
        confirmed_by_asset.setdefault(str(row.get("asset_id") or "").strip().upper(), []).append(row)

    pm = _pm_context(set(assets), overall_start.date(), overall_end.date()) if assets else {}

    results = []
    for item in items:
        asset_id = item["asset_id"]
        asset = assets.get(asset_id)
        if asset is None:
            results.append({
                "asset_id": asset_id, "facility_stage": item.get("facility_stage"),
                "status": "unknown", "confirmed_downtime_minutes": 0.0,
                "proxy_downtime_minutes": 0.0, "capacity_factor": 1.0,
                "availability_confidence": "unknown", "auto_block_eligible": False,
                "overlapping_events": [], "next_pm_date": None,
                "reason": "Asset ID not found in the maintenance asset master.", "warnings": [],
            })
            continue
        facility_stage = item.get("facility_stage") or asset.get("stage")
        results.append(avail.build_asset_availability(
            asset_id=asset_id, facility_stage=facility_stage,
            window_start=item["window_start"], window_end=item["window_end"],
            confirmed_events=confirmed_by_asset.get(asset_id.upper(), []),
            work_orders=rows_by_asset.get(asset_id, []),
            pm=pm.get(asset_id) or {},
        ))
    unmatched = sorted(set(asset_ids) - set(assets))
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_through": _source_through(source, records),
        "assets": results, "unmatched_asset_ids": unmatched,
    }


@bp.get("/api/v1/maintenance/assets/<asset_id>/availability")
@_service_auth
def asset_availability(asset_id):
    try:
        asset_id = _validate_asset_id(asset_id)
        window_start, window_end = _validate_datetime_range(request.args.get("from"), request.args.get("to"))
    except (ValueError, TypeError) as exc:
        return _error(str(exc), 422)
    try:
        payload = _compute_availability([{
            "asset_id": asset_id, "window_start": window_start, "window_end": window_end,
        }])
    except ValueError as exc:
        return _error(str(exc), 422)
    except Exception:
        _LOG.exception("maintenance_v1 availability (single) failed")
        return _error("Availability could not be generated.", 500)
    if asset_id in payload["unmatched_asset_ids"]:
        return _error("Unknown Asset ID.", 404)
    return jsonify({
        "generated_at": payload["generated_at"], "source_through": payload["source_through"],
        "period": {"from": window_start.isoformat(), "to": window_end.isoformat()},
        "asset": payload["assets"][0],
    })


@bp.post("/api/v1/maintenance/assets/availability")
@_service_auth
def assets_availability():
    body = request.get_json(silent=True) or {}
    requested = body.get("assets")
    maximum = int(os.environ.get("MAINTENANCE_API_MAX_ASSETS_PER_REQUEST", "100"))
    if not isinstance(requested, list) or not requested or len(requested) > maximum:
        return _error(f"assets must contain 1 to {maximum} entries.", 422)
    items = []
    try:
        for entry in requested:
            if not isinstance(entry, dict):
                raise ValueError("Each assets entry must be an object.")
            asset_id = _validate_asset_id(entry.get("asset_id"))
            window_start, window_end = _validate_datetime_range(
                entry.get("planned_start"), entry.get("planned_end"))
            item = {"asset_id": asset_id, "window_start": window_start, "window_end": window_end}
            if entry.get("facility_stage") is not None:
                item["facility_stage"] = "Stage " + _validate_stage(entry.get("facility_stage"))
            items.append(item)
    except (ValueError, TypeError) as exc:
        return _error(str(exc), 422)
    try:
        return jsonify(_compute_availability(items))
    except ValueError as exc:
        return _error(str(exc), 422)
    except Exception:
        _LOG.exception("maintenance_v1 availability (batch) failed")
        return _error("Availability could not be generated.", 500)


@bp.get("/api/v1/maintenance/downtime/calendar")
@_service_auth
def downtime_calendar():
    try:
        start, end = _validate_range(request.args.get("from"), request.args.get("to"))
        stage_arg = request.args.get("facility_stage")
        stage_num = _validate_stage(stage_arg) if stage_arg else None
    except ValueError as exc:
        return _error(str(exc), 422)
    stage_label = f"Stage {stage_num}" if stage_num else None
    assets = {row["asset_id"]: row for row in db.query_asset_master(stage=stage_label)} if stage_label \
        else {row["asset_id"]: row for row in db.query_asset_master()}

    window_start = dt.datetime.combine(start, dt.time.min)
    window_end = dt.datetime.combine(end, dt.time.max)
    source = load_work_order_downtime_sql()
    # Confirmed (verified/partial) come from downtime_event; proxy stays live from the WO
    # source below. This keeps proxy single-sourced even after Phase 7 materialises proxy
    # rows into downtime_event, so the calendar never double-counts a work order.
    confirmed_rows = db.query_downtime_events(
        asset_ids=list(assets), start_iso=window_start.isoformat(), end_iso=window_end.isoformat(),
        facility_stage=stage_label, confirmed_only=True,
    )

    by_date: dict = {}

    def _add(date_iso, asset_id, entry):
        day = by_date.setdefault(date_iso, {})
        day.setdefault(asset_id, []).append(entry)

    for event in confirmed_rows:
        asset_id = str(event.get("asset_id") or "").strip()
        if asset_id not in assets:
            continue
        s = avail.parse_dt(event.get("unavailable_start") or event.get("downtime_start"))
        e = avail.parse_dt(event.get("unavailable_end") or event.get("downtime_end")) or window_end
        for date_iso, day_start, day_end in avail.split_by_day(s, e, start, end):
            _add(date_iso, asset_id, {
                "source": "downtime_event", "work_order_id": event.get("wo_number"),
                "event_id": event.get("id"),
                "confidence": (event.get("availability_confidence") or "proxy"),
                "start": day_start.isoformat(), "end": day_end.isoformat(),
                "minutes": avail.total_minutes([(day_start, day_end)]),
            })

    for row in source.get("records") or []:
        asset_id = str(row.get("asset_id") or "").strip()
        if asset_id not in assets:
            continue
        s = avail.parse_dt(row.get("actual_start_time") or row.get("start_time"))
        e = avail.parse_dt(row.get("actual_end_time") or row.get("end_time"))
        if s is None or e is None:            # open WO: no bounded interval to place
            continue
        for date_iso, day_start, day_end in avail.split_by_day(s, e, start, end):
            _add(date_iso, asset_id, {
                "source": "work_order", "work_order_id": row.get("work_order_id"), "event_id": None,
                "confidence": "proxy", "start": day_start.isoformat(), "end": day_end.isoformat(),
                "minutes": avail.total_minutes([(day_start, day_end)]),
            })

    dates = [{
        "date": date_iso,
        "assets": [{
            "asset_id": asset_id,
            "facility_stage": assets[asset_id].get("stage"),
            "asset_name": assets[asset_id].get("asset_name"),
            "events": sorted(events, key=lambda entry: entry["start"]),
            "confirmed_downtime_minutes": round(sum(
                entry["minutes"] for entry in events
                if entry["source"] == "downtime_event" and entry["confidence"] in ("verified", "partial")), 2),
            "proxy_downtime_minutes": round(sum(
                entry["minutes"] for entry in events if entry["source"] == "work_order"), 2),
        } for asset_id, events in sorted(day.items())],
    } for date_iso, day in sorted(by_date.items())]

    return jsonify({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_through": _source_through(source, source.get("records") or []),
        "facility_stage": stage_label, "from": start.isoformat(), "to": end.isoformat(),
        "dates": dates,
    })


@bp.post("/api/v1/maintenance/equipment/fallbacks")
@_service_auth
def equipment_fallbacks():
    """Phase 5B — capability + approved/candidate fallbacks for the planner (read-only).

    Candidates come from the asset master (same machine_group + stage); a candidate is
    ``approved`` only with all three sign-offs. Auto-assignment is the planner's decision
    and is limited to ``approved`` entries.
    """
    body = request.get_json(silent=True) or {}
    asset_ids = body.get("asset_ids")
    maximum = int(os.environ.get("MAINTENANCE_API_MAX_ASSETS_PER_REQUEST", "100"))
    if not isinstance(asset_ids, list) or not asset_ids or len(asset_ids) > maximum:
        return _error(f"asset_ids must contain 1 to {maximum} values.", 422)
    try:
        clean_ids = sorted({_validate_asset_id(value) for value in asset_ids})
    except ValueError as exc:
        return _error(str(exc), 422)
    try:
        assets = capability.build_fallbacks(clean_ids)
    except Exception:
        _LOG.exception("maintenance_v1 fallbacks failed")
        return _error("Equipment fallbacks could not be generated.", 500)
    return jsonify({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "assets": [assets[asset_id] for asset_id in clean_ids if asset_id in assets],
    })
