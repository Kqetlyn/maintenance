"""
MIRA HTTP routes (Flask Blueprint) - /api/mira/*.

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
from .modules.maintenance import assistant_service
from .modules.maintenance import chat_service
from .modules.maintenance import risk_service
from .privacy import privacy_guard_service as guard
from .providers import get_provider, get_provider_status, generate_structured_summary
from .reports import report_draft_service
from .services import kpi_query_service as kpi
from .services import presentation_service as presentation

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


def _read_summary_type() -> str | None:
    summary_type = request.args.get("summaryType") or request.args.get("summary_type")
    if request.is_json:
        body = request.get_json(silent=True) or {}
        summary_type = body.get("summaryType") or body.get("summary_type") or summary_type
    return summary_type


def _summary_response(intent: str, data: dict, *, filters: dict | None = None, response_type: str | None = None):
    """Guard -> provider -> envelope, for the single-intent KPI routes."""
    provider = get_provider()
    guarded = guard.guard_summary(data, mode="kpi_summary")
    answer = guard.mark_draft(provider.generate(intent, data))
    presentation_model = presentation.build_presentation(
        intent,
        data,
        filters,
        mode="kpi_summary",
        provider_name=provider.name,
        response_type=response_type,
    )
    return jsonify({
        "ok": True,
        "intent": intent,
        "mode": "kpi_summary",
        "answer": answer,
        "data": guarded["data"],
        "presentation": guard._deep_redact(presentation_model),
        "provider": provider.name,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.route("/overview", methods=["GET", "POST"])
def overview():
    """FAST verified-metrics overview (NO LLM) — renders KPI cards immediately.

    Numbers are deterministic backend KPIs. The AI wording is fetched separately
    via /ai-summary so the page never blocks on Ollama.
    """
    raw = _read_filters()
    filters = ctx.normalize_filters(raw)
    data = kpi.get_dashboard_kpi_summary(filters)
    status = get_provider_status()
    pres = presentation.build_presentation(
        "monthly_summary", data, filters, provider_name=status["provider"],
    )
    guarded = guard.guard_summary(data, mode="kpi_summary")
    return jsonify({
        "ok": True,
        "filters": filters,
        "presentation": guard._deep_redact(pres),
        "data": guarded["data"],
        "provider_status": status,
        "draft_label": config.DRAFT_LABEL,
    })


@mira_bp.route("/risk", methods=["GET", "POST"])
def risk():
    """Backend-calculated maintenance risk insights (read-only; not a prediction)."""
    raw = _read_filters()
    if request.is_json:
        body = request.get_json(silent=True) or {}
        if isinstance(body.get("filters"), dict):
            raw = {**raw, **{k: v for k, v in body["filters"].items() if k in ctx.FILTER_KEYS}}
    result = risk_service.get_asset_risk_insights(ctx.normalize_filters(raw))
    return jsonify(guard._deep_redact(result))


@mira_bp.route("/ai-summary", methods=["GET", "POST"])
def ai_summary():
    """Verified metrics -> Ollama (or rule-based) -> structured summary JSON.

    The numbers come ONLY from the verified backend KPI summary; the LLM just
    writes the wording. The frontend renders KPI cards from `data`/`view_data_used`
    immediately and shows this AI summary when ready.
    """
    raw = _read_filters()
    filters = ctx.normalize_filters(raw)
    data = kpi.get_dashboard_kpi_summary(filters)                     # verified metrics
    pres = presentation.build_presentation(
        "monthly_summary", data, filters, provider_name=get_provider().name,
    )
    warnings = pres.get("data_notes") or []
    structured = generate_structured_summary(                          # Ollama or rule-based
        data, question=None, filters=filters, warnings=warnings,
    )
    status = get_provider_status()
    guarded = guard.guard_summary(data, mode="kpi_summary")
    return jsonify({
        "ok": True,
        "filters": filters,
        "summary": guard._deep_redact(structured),
        "provider": structured.get("provider"),
        "provider_status": status["status"],
        "llm_active": structured.get("provider") == "ollama",
        "llm_model": structured.get("model"),
        "view_data_used": guard._deep_redact(pres.get("view_data_used")),
        "data": guarded["data"],
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.get("/health")
def health():
    status = get_provider_status()
    return jsonify({
        "ok": True,
        "service": "MIRA",
        "version": "0.1.0-prototype",
        "provider": status["provider"],
        "provider_status": status["status"],
        "llm_active": status["llm"],
        "llm_model": status.get("model"),
        "local_llm_enabled": config.LOCAL_LLM_ENABLED,
        "row_cap_max": config.ROW_CAP_MAX,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.route("/summary", methods=["GET", "POST"])
def summary():
    """Consolidated KPI snapshot for the selected window/stage."""
    filters = _read_filters()
    response_type = _read_summary_type()
    data = kpi.get_dashboard_kpi_summary(filters, include_spare_parts=True)
    return _summary_response("monthly_summary", data, filters=filters, response_type=response_type)


@mira_bp.route("/query", methods=["POST"])
def query():
    """Free-text question -> intent routing -> KPI summary (or limited rows)."""
    body = request.get_json(silent=True) or {}
    question = body.get("question") or body.get("q") or ""
    limit = body.get("limit")
    result = assistant_service.ask(question, _read_filters(), limit=limit)
    return jsonify(result)


@mira_bp.route("/chat", methods=["POST"])
def chat():
    """Intelligent read-only Q&A: intent + period extraction -> verified data -> wording.

    The question period (e.g. "April 2026") overrides the dashboard filter, so the
    answer never falls back to a generic YTD summary when a month was asked for.
    """
    body = request.get_json(silent=True) or {}
    question = body.get("question") or body.get("q") or ""
    base_filters = _read_filters()
    if isinstance(body.get("filters"), dict):
        base_filters = {**base_filters, **{k: v for k, v in body["filters"].items() if k in ctx.FILTER_KEYS}}
    result = chat_service.answer(question, base_filters)
    return jsonify(guard._deep_redact(result))


@mira_bp.route("/data-quality", methods=["GET", "POST"])
def data_quality():
    filters = _read_filters()
    data = kpi.get_data_reliability_issues(filters)
    return _summary_response("data_quality", data, filters=filters)


@mira_bp.route("/pm-schedule", methods=["GET", "POST"])
def pm_schedule():
    filters = _read_filters()
    data = kpi.get_pm_schedule_status(filters)
    return _summary_response("pm_schedule", data, filters=filters)


@mira_bp.route("/mttr", methods=["GET", "POST"])
def mttr():
    filters = _read_filters()
    return _summary_response("mttr", kpi.get_mttr(filters), filters=filters)


@mira_bp.route("/mtbf", methods=["GET", "POST"])
def mtbf():
    filters = _read_filters()
    return _summary_response("mtbf", kpi.get_mtbf(filters), filters=filters)


@mira_bp.route("/stage-compare", methods=["GET", "POST"])
def stage_compare():
    filters = _read_filters()
    return _summary_response("stage_compare", kpi.get_stage_summary(filters), filters=filters)


@mira_bp.route("/work-orders", methods=["GET", "POST"])
def work_orders():
    """Limited Filtered Rows Mode - capped + scrubbed; never the full dataset."""
    limit = request.args.get("limit") or (request.get_json(silent=True) or {}).get("limit")
    filters = _read_filters()
    raw = kpi.get_work_orders(filters, limit=limit)
    guarded = guard.guard_work_orders(raw, requested_limit=limit)
    provider = get_provider()
    answer = guard.mark_draft(provider.generate("work_order_search", guarded))
    presentation_model = presentation.build_presentation(
        "work_order_search",
        guarded,
        filters,
        mode="limited_filtered_rows",
        provider_name=provider.name,
    )
    return jsonify({
        "ok": True,
        "intent": "work_order_search",
        "mode": "limited_filtered_rows",
        "answer": answer,
        "data": guarded,
        "presentation": guard._deep_redact(presentation_model),
        "provider": provider.name,
        "draft_label": config.DRAFT_LABEL,
        "disclaimer": config.MODEL_DISCLAIMER,
    })


@mira_bp.route("/report-draft", methods=["GET", "POST"])
def report_draft():
    """Monthly maintenance report draft (structured + markdown)."""
    return jsonify(report_draft_service.generate_monthly_maintenance_summary(_read_filters()))
