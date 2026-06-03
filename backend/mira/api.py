"""
MIRA HTTP routes (Flask Blueprint) — /api/mira/*.

Each route:
  1. receives filters (querystring or JSON body),
  2. calls the relevant KPI / query function (reusing dashboard logic),
  3. passes the output through privacyGuardService,
  4. sends the privacy-approved output to the active provider (mock by default),
  5. returns a clean response to the frontend.

Registered once in app.py via `app.register_blueprint(mira_bp)`. No existing
dashboard route is modified.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from . import config
from .core import context as ctx
from .privacy import privacy_guard_service as guard
from .providers import get_provider
from .services import kpi_query_service as kpi
from .modules.maintenance import assistant_service
from .reports import report_draft_service

mira_bp = Blueprint("mira", __name__, url_prefix="/api/mira")


def _read_filters() -> dict:
    """Merge JSON body + querystring into a raw filter dict (body wins)."""
    raw = {}
    for key in ctx.FILTER_KEYS:
        if request.args.get(key) is not None:
            raw[key] = request.args.get(key)
    if request.is_json:
        body = request.get_json(silent=True) or {}
        raw.update({k: v for k, v in body.items() if k in ctx.FILTER_KEYS})
        if "filters" in body and isinstance(body["filters"], dict):
            raw.update({k: v for k, v in body["filters"].items() if k in ctx.FILTER_KEYS})
    return raw


def _summary_response(intent: str, data: dict):
    """Guard -> provider -> envelope, for the single-intent KPI routes."""
    guarded = guard.guard_summary(data, mode="kpi_summary")
    answer = guard.mark_draft(get_provider().generate(intent, data))
    return jsonify({
        "ok": True,
        "intent": intent,
        "mode": "kpi_summary",
        "answer": answer,
        "data": guarded["data"],
        "provider": get_provider().name,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.get("/health")
def health():
    return jsonify({
        "ok": True,
        "service": "MIRA",
        "version": "0.1.0-prototype",
        "provider": get_provider().name,
        "local_llm_enabled": config.LOCAL_LLM_ENABLED,
        "row_cap_max": config.ROW_CAP_MAX,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.route("/summary", methods=["GET", "POST"])
def summary():
    """Consolidated KPI snapshot for the selected window/stage."""
    data = kpi.get_dashboard_kpi_summary(_read_filters())
    return _summary_response("monthly_summary", data)


@mira_bp.route("/query", methods=["POST"])
def query():
    """Free-text question -> intent routing -> KPI summary (or limited rows)."""
    body = request.get_json(silent=True) or {}
    question = body.get("question") or body.get("q") or ""
    limit = body.get("limit")
    result = assistant_service.ask(question, _read_filters(), limit=limit)
    return jsonify(result)


@mira_bp.route("/data-quality", methods=["GET", "POST"])
def data_quality():
    data = kpi.get_data_reliability_issues(_read_filters())
    return _summary_response("data_quality", data)


@mira_bp.route("/pm-schedule", methods=["GET", "POST"])
def pm_schedule():
    data = kpi.get_pm_schedule_status(_read_filters())
    return _summary_response("pm_schedule", data)


@mira_bp.route("/mttr", methods=["GET", "POST"])
def mttr():
    return _summary_response("mttr", kpi.get_mttr(_read_filters()))


@mira_bp.route("/mtbf", methods=["GET", "POST"])
def mtbf():
    return _summary_response("mtbf", kpi.get_mtbf(_read_filters()))


@mira_bp.route("/stage-compare", methods=["GET", "POST"])
def stage_compare():
    return _summary_response("stage_compare", kpi.get_stage_summary(_read_filters()))


@mira_bp.route("/work-orders", methods=["GET", "POST"])
def work_orders():
    """Limited Filtered Rows Mode — capped + scrubbed; never the full dataset."""
    limit = request.args.get("limit") or (request.get_json(silent=True) or {}).get("limit")
    raw = kpi.get_work_orders(_read_filters(), limit=limit)
    guarded = guard.guard_work_orders(raw, requested_limit=limit)
    answer = guard.mark_draft(get_provider().generate("work_order_search", guarded))
    return jsonify({
        "ok": True,
        "intent": "work_order_search",
        "mode": "limited_filtered_rows",
        "answer": answer,
        "data": guarded,
        "provider": get_provider().name,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.route("/report-draft", methods=["GET", "POST"])
def report_draft():
    """Monthly maintenance report draft (structured + markdown)."""
    return jsonify(report_draft_service.generate_monthly_maintenance_summary(_read_filters()))
