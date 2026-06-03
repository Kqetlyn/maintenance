"""
kpiQueryService — MIRA's read-only window onto dashboard KPI outputs.

EVERY value returned here is extracted from the SAME builders the dashboard uses:

    * downtime_service.build_downtime_payload        -> MTTR, MTBF, open/closed WO,
                                                        data-reliability counts, WO rows
    * maintenance_service.build_maintenance_overview_payload -> preventive vs corrective
    * pm_schedule_service.build_pm_schedule_payload  -> PM schedule status, Stage 1/2
    * asset_mapping.load_asset_mapping               -> asset-group / stage context

MIRA does NOT recompute MTTR / MTBF / open work orders / PM status. It only reads,
selects, and reshapes already-computed outputs so its answers can never conflict
with the dashboard. Per-asset / per-group filters select subsets of rows the
builder ALREADY computed — they never trigger a different calculation.
"""

from __future__ import annotations

import os
import time

# Existing dashboard builders (top-level modules on the backend path).
from downtime_service import build_downtime_payload
from maintenance_service import build_maintenance_overview_payload
from pm_schedule_service import build_pm_schedule_payload

from ..core import context as ctx

# Tiny per-process memo so one MIRA request that needs several KPIs does not call
# the same heavy (already-cached) builder repeatedly. Short TTL; keyed by inputs.
_MEMO: dict[tuple, tuple[float, object]] = {}
_MEMO_TTL_SECONDS = 30


def _memoized(key, producer):
    now = time.time()
    hit = _MEMO.get(key)
    if hit and (now - hit[0]) < _MEMO_TTL_SECONDS:
        return hit[1]
    value = producer()
    _MEMO[key] = (now, value)
    return value


# ── Underlying payloads (cached by the dashboard + memoised here) ────────────────
def _downtime_management(filters: dict) -> dict:
    period = ctx.resolve_downtime_period(filters)
    key = ("downtime", filters["stage"], period["period"], period["month"], period["start"], period["end"])

    def produce():
        payload = build_downtime_payload(
            period=period["period"],
            month=period["month"],
            start=period["start"],
            end=period["end"],
            work_orders_only=True,
            stage=filters["stage"],
        )
        return payload.get("management", {}) or {}

    return _memoized(key, produce)


def _pm_payload(filters: dict) -> dict:
    key = ("pm", filters["stage"], filters["year"], filters["month"])
    return _memoized(key, lambda: build_pm_schedule_payload(
        stage=filters["stage"], year=filters["year"], month=filters["month"],
    ))


def _overview_payload(filters: dict) -> dict:
    mv = ctx.month_value(filters)
    key = ("overview", filters["year"], mv)
    return _memoized(key, lambda: build_maintenance_overview_payload(
        month_value=mv, year=filters["year"], mix_month_value=mv,
    ))


# ── Helpers to narrow already-computed rows by asset / group ─────────────────────
def _matches_asset_group(row: dict, filters: dict) -> bool:
    if filters.get("assetId"):
        rid = str(row.get("asset_id") or "").upper()
        if rid != filters["assetId"].upper():
            return False
    if filters.get("mainAssetGroup"):
        grp = str(row.get("machine_group") or row.get("mainAssetGroup") or "").lower()
        if filters["mainAssetGroup"].lower() not in grp:
            return False
    return True


# ── Public KPI functions (snake_case primary; camelCase aliases at bottom) ───────
def get_mttr(filters: dict) -> dict:
    """MTTR (Mean Time To Repair), reused from the downtime management summary."""
    f = ctx.normalize_filters(filters)
    mgmt = _downtime_management(f)
    s = mgmt.get("summary", {})
    result = {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "overall_mttr_hours": s.get("overall_mttr_hours"),
        "highest_mttr_machine_group": s.get("highest_mttr_machine_group"),
        "highest_mttr_hours": s.get("highest_mttr_hours"),
        "valid_ttr_work_orders": s.get("valid_ttr_work_orders"),
        "total_work_orders": s.get("total_work_orders"),
        "unit": "hours",
        "source": "downtime dashboard (overall_mttr_hours)",
    }
    if f.get("mainAssetGroup") or f.get("assetId"):
        rows = [r for r in mgmt.get("machine_group_rows", []) if _matches_asset_group(r, f)]
        if rows:
            result["filtered_groups"] = [
                {"machine_group": r.get("machine_group"), "mttr_hours": r.get("mttr_hours"),
                 "work_order_count": r.get("work_order_count")}
                for r in rows[:10]
            ]
    return result


def get_mtbf(filters: dict) -> dict:
    """MTBF (Mean Time Between Failures), reused from the downtime MTBF views."""
    f = ctx.normalize_filters(filters)
    mgmt = _downtime_management(f)
    mtbf = mgmt.get("mtbf", {}) or {}
    views = mtbf.get("views", {}) or {}
    selected_key = mtbf.get("selected_view") or "selected_period"
    view = views.get(selected_key) or views.get("selected_period") or {}
    s = view.get("summary", {}) if isinstance(view, dict) else {}
    result = {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "overall_average_mtbf_hours": s.get("overall_average_mtbf_hours"),
        "lowest_mtbf_hours": s.get("lowest_mtbf_hours"),
        "lowest_mtbf_asset_name": s.get("lowest_mtbf_asset_name"),
        "highest_mtbf_hours": s.get("highest_mtbf_hours"),
        "assets_with_valid_mtbf": s.get("assets_with_valid_mtbf"),
        "repeated_failure_assets": s.get("repeated_failure_assets"),
        "selected_view": selected_key,
        "scope_label": s.get("scope_label"),
        "unit": "hours",
        "source": "downtime dashboard MTBF views",
    }
    if f.get("assetId") or f.get("mainAssetGroup"):
        rows = [r for r in view.get("asset_rows", []) if _matches_asset_group(r, f)] if isinstance(view, dict) else []
        if rows:
            result["filtered_assets"] = [
                {"asset_id": r.get("asset_id"), "asset_name": r.get("asset_name"),
                 "average_mtbf_hours": r.get("average_mtbf_hours"),
                 "reliability_status": r.get("reliability_status")}
                for r in rows[:10]
            ]
    return result


def get_open_work_orders(filters: dict) -> dict:
    """Open vs closed/finished work orders, reused from the downtime summary."""
    f = ctx.normalize_filters(filters)
    mgmt = _downtime_management(f)
    s = mgmt.get("summary", {})
    total = s.get("total_work_orders") or 0
    open_count = s.get("open_work_orders") or 0
    return {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "total_work_orders": total,
        "open_work_orders": open_count,
        "closed_work_orders": max(total - open_count, 0),
        "requires_attention_count": s.get("requires_attention_count"),
        "source": "downtime dashboard summary (total/open)",
    }


def get_preventive_corrective_summary(filters: dict) -> dict:
    """Preventive vs corrective mix, reused from the maintenance overview payload."""
    f = ctx.normalize_filters(filters)
    overview = _overview_payload(f)
    mix = overview.get("maintenance_mix", {}) or {}
    return {
        "window": ctx.month_label(f),
        "month": mix.get("month"),
        "preventive_count": mix.get("preventive_scheduled"),
        "corrective_count": mix.get("corrective_work_orders"),
        "preventive_ratio_pct": mix.get("preventive_ratio"),
        "corrective_ratio_pct": mix.get("corrective_ratio"),
        "performance_status": mix.get("performance_status"),
        "total": mix.get("total"),
        "source": "maintenance overview maintenance_mix",
    }


def get_data_reliability_issues(filters: dict) -> dict:
    """Data-quality / reliability issue counts, reused from the downtime payload."""
    f = ctx.normalize_filters(filters)
    mgmt = _downtime_management(f)
    s = mgmt.get("summary", {})
    group_rows = mgmt.get("machine_group_rows", []) or []
    mtbf_summary = ((mgmt.get("mtbf", {}) or {}).get("views", {}) or {}).get("selected_period", {})
    mtbf_summary = mtbf_summary.get("summary", {}) if isinstance(mtbf_summary, dict) else {}
    return {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "requires_attention_count": s.get("requires_attention_count"),
        "invalid_missing_ttr_count": s.get("invalid_missing_ttr_count"),
        "valid_ttr_work_orders": s.get("valid_ttr_work_orders"),
        "total_work_orders": s.get("total_work_orders"),
        "mttr_missing_total": sum(int(r.get("mttr_missing_count") or 0) for r in group_rows),
        "mtbf_missing_total": sum(int(r.get("mtbf_missing_count") or 0) for r in group_rows),
        "duplicate_work_order_count": mtbf_summary.get("duplicate_work_order_count"),
        "source": "downtime dashboard quality flags",
    }


def get_pm_schedule_status(filters: dict) -> dict:
    """Preventive maintenance schedule status, reused from build_pm_schedule_payload."""
    f = ctx.normalize_filters(filters)
    pm = _pm_payload(f)
    overview = pm.get("overview", {}) or {}
    kpis = overview.get("kpis", {}) or {}
    charts = overview.get("charts", {}) or {}
    dq = (overview.get("dataQuality", {}) or {}).get("counts", {})
    return {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "total_scheduled": kpis.get("totalScheduled"),
        "due_this_month": kpis.get("dueThisMonth"),
        "due_soon": kpis.get("dueSoon"),
        "completed": kpis.get("completed"),
        "compliance_pct": kpis.get("compliancePct"),
        "overdue": kpis.get("overdue"),
        "backlog": kpis.get("backlog"),
        "coverage": kpis.get("coverage"),
        "missing_mapping": kpis.get("missingMapping"),
        "needs_review": kpis.get("needsReview"),
        "by_stage": charts.get("scheduledByStage"),
        "by_main_group": charts.get("workloadByMainGroup"),
        "data_quality": dq,
        "equipment_total": (pm.get("equipment", {}).get("kpis", {}) or {}).get("totalScheduled"),
        "utility_total": (pm.get("utility", {}).get("kpis", {}) or {}).get("totalScheduled"),
        "source": "pm_schedule_service.build_pm_schedule_payload",
    }


def get_stage_summary(filters: dict) -> dict:
    """Stage 1 vs Stage 2 side-by-side, reusing the per-stage builders."""
    base = ctx.normalize_filters(filters)
    stages = {}
    for stage_key in ("stage1", "stage2"):
        sf = dict(base)
        sf["stage"] = stage_key
        stages[stage_key] = {
            "open_work_orders": get_open_work_orders(sf),
            "mttr": get_mttr(sf),
            "mtbf": get_mtbf(sf),
            "pm_schedule": get_pm_schedule_status(sf),
            "preventive_corrective": get_preventive_corrective_summary(sf),
        }
    return {"window": ctx.month_label(base), "stage1": stages["stage1"], "stage2": stages["stage2"]}


def get_dashboard_kpi_summary(filters: dict) -> dict:
    """One consolidated KPI snapshot built entirely from existing dashboard outputs."""
    f = ctx.normalize_filters(filters)
    open_wo = get_open_work_orders(f)
    mttr = get_mttr(f)
    mtbf = get_mtbf(f)
    pc = get_preventive_corrective_summary(f)
    dq = get_data_reliability_issues(f)
    pm = get_pm_schedule_status(f)
    return {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "filters": f,
        "work_orders": {
            "total": open_wo["total_work_orders"],
            "open": open_wo["open_work_orders"],
            "closed": open_wo["closed_work_orders"],
        },
        "mttr_hours": mttr["overall_mttr_hours"],
        "mtbf_hours": mtbf["overall_average_mtbf_hours"],
        "preventive_count": pc["preventive_count"],
        "corrective_count": pc["corrective_count"],
        "performance_status": pc["performance_status"],
        "data_reliability_issue_count": dq["requires_attention_count"],
        "pm_schedule": {
            "total_scheduled": pm["total_scheduled"],
            "due_this_month": pm["due_this_month"],
            "overdue": pm["overdue"],
            "compliance_pct": pm["compliance_pct"],
            "backlog": pm["backlog"],
        },
        "asset_groups": pm.get("by_main_group"),
        "stage_breakdown": pm.get("by_stage"),
    }


# ── Limited Filtered Rows Mode (NOT default) ─────────────────────────────────────
# Returns a small, field-limited slice of work-order rows the builder already
# computed. The privacy guard still scrubs and caps this before it leaves MIRA.
def get_work_orders(filters: dict, limit: int | None = None) -> dict:
    """Limited work-order lookup. Never returns the full raw dataset."""
    f = ctx.normalize_filters(filters)
    mgmt = _downtime_management(f)
    rows = mgmt.get("work_orders", []) or []

    def keep(row):
        if not _matches_asset_group(row, f):
            return False
        if f.get("status"):
            want = f["status"].lower()
            cat = str(row.get("status_category") or "").lower()
            state = str(row.get("request_state") or "").lower()
            if want in {"open"} and not row.get("is_open"):
                return False
            if want in {"closed", "finished"} and row.get("is_open"):
                return False
            if want not in {"open", "closed", "finished"} and want not in cat and want not in state:
                return False
        if f.get("maintenanceType"):
            mt = f["maintenanceType"].lower()
            blob = " ".join(str(row.get(k) or "") for k in ("maintenance_job_type", "job_trade")).lower()
            if mt not in blob:
                return False
        if f.get("subAssetGroup"):
            if f["subAssetGroup"].lower() not in str(row.get("machine_group") or "").lower():
                return False
        return True

    filtered = [r for r in rows if keep(r)]
    total_matched = len(filtered)
    # The privacy guard enforces the final cap; we pass a generous pre-slice.
    # `limit` may arrive as a string (querystring) — coerce safely and keep the
    # pre-slice >= the guard's max cap so the guard can apply the real limit.
    try:
        hint = int(limit) if limit not in (None, "") else None
    except (TypeError, ValueError):
        hint = None
    pre_slice = filtered[: max(hint or 0, 50)]
    return {
        "window": ctx.month_label(f),
        "stage": f["stage"],
        "total_matched": total_matched,
        "rows": pre_slice,                # raw rows; privacy guard scrubs + caps next
        "source": "downtime dashboard work_orders (filtered)",
    }


# ── camelCase aliases (match the spec's required function names) ─────────────────
getDashboardKpiSummary = get_dashboard_kpi_summary
getWorkOrders = get_work_orders
getMTTR = get_mttr
getMTBF = get_mtbf
getOpenWorkOrders = get_open_work_orders
getPreventiveCorrectiveSummary = get_preventive_corrective_summary
getDataReliabilityIssues = get_data_reliability_issues
getPMScheduleStatus = get_pm_schedule_status
getStageSummary = get_stage_summary
