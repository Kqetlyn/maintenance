"""
MIRA chat service - intelligent, read-only dashboard Q&A.

Flow:
    question
    -> intent router
    -> period extraction
    -> verified data retrieval
    -> optional MR description theme classification
    -> verified context JSON
    -> Ollama explanation (or rule-based fallback)
    -> structured chat answer

Numbers always come from verified backend functions. The LLM only writes wording.
"""

from __future__ import annotations

import calendar
import json
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime

from ... import config
from ...core import context as ctx
from ...providers import OllamaMiraProvider, generate_with_ollama, get_provider_status
from ...services import kpi_query_service as kpi

_TAGS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))),
    "data",
    "mira_description_tags.json",
)

_INTENT_RULES = [
    (
        "daily_follow_up_query",
        (
            "what should be followed up today",
            "follow up today",
            "follow-up today",
            "followup today",
            "what should be followed up",
            "daily follow-up",
            "daily follow up",
            "today's follow-up",
            "todays follow-up",
            "action items",
            "priorities today",
        ),
    ),
    (
        "report_wording_query",
        (
            "one-line",
            "one line",
            "monthly report",
            "report summary",
            "report sentence",
            "headline",
            "executive sentence",
            "slide summary",
        ),
    ),
    (
        "fault_theme_query",
        (
            "most common fault",
            "common fault",
            "common issue",
            "main fault",
            "main issue",
            "fault pattern",
            "fault theme",
            "type of fault",
            "type of issue",
            "cause of breakdown",
            "main cause",
            "root cause",
            "operation related",
            "operation-related",
            "what is the most common",
        ),
    ),
    (
        "recurring_issue_query",
        (
            "recurring",
            "repeated",
            "repeat issue",
            "keeps happening",
            "again and again",
            "same problem",
            "repeated issues",
        ),
    ),
    (
        "pm_overdue_query",
        (
            "overdue pm",
            "pm overdue",
            "overdue preventive",
            "pm tasks overdue",
            "which pm tasks are overdue",
            "which pm are overdue",
            "overdue maintenance",
        ),
    ),
    ("backlog_query", ("backlog", "carry-over", "carry over")),
    (
        "top_asset_query",
        (
            "which asset has the most mr",
            "asset has the most mr",
            "most mr",
            "most maintenance request",
            "top asset",
            "asset with most",
            "worst asset",
            "top actual machine asset",
        ),
    ),
    (
        "top_functional_location_query",
        (
            "which functional location",
            "highest workload",
            "functional location",
            "which area has the highest workload",
            "which location",
            "location workload",
            "area workload",
            "machine group",
        ),
    ),
    (
        "open_mr_query",
        (
            "open mr",
            "still open",
            "outstanding mr",
            "open work order",
            "top open",
            "unresolved",
            "open maintenance",
            "open / in progress",
        ),
    ),
    (
        "risk_insight_query",
        (
            "risk",
            "need attention",
            "needs attention",
            "machines need attention",
            "high risk",
            "asset risk",
            "attention list",
        ),
    ),
    (
        "spare_parts_consumption_query",
        (
            "highest consumption",
            "most consumed",
            "top consumed",
            "consumed spare",
            "spare consumption",
            "spare part consumption",
            "consumption",
        ),
    ),
    (
        "spare_parts_summary",
        (
            "spare part",
            "spare parts",
            "inventory",
            "in-stock",
            "in stock",
            "drawn from store",
            "non-stock",
            "services value",
        ),
    ),
    (
        "pm_summary",
        (
            "pm compliance",
            "pm issue",
            "pm issues",
            "pm status",
            "preventive maintenance",
            "pm schedule",
            "main pm",
            "pm performance",
            "compliance",
        ),
    ),
    (
        "downtime_summary",
        (
            "mttr",
            "mtbf",
            "downtime",
            "closure rate",
            "work order",
            "closure",
            "wo created",
            "mr raised",
            "maintenance request",
        ),
    ),
    (
        "maintenance_summary",
        (
            "summarise",
            "summarize",
            "summary",
            "performance",
            "overview",
            "how are we doing",
            "maintenance performance",
            "maintenance summary",
            "report",
        ),
    ),
]
_DEFAULT_INTENT = "maintenance_summary"

_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
_MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})

_THEME_PATTERNS = [
    (
        "Refrigeration / Cooling Issue",
        (
            r"refriger",
            r"\bcooling\b",
            r"\bcompressor\b",
            r"\bfreezer\b",
            r"\bchiller\b",
            r"\bcondenser\b",
            r"\bevaporator\b",
            r"\bcold room\b",
            r"\btemperature\b",
            r"\bdefrost\b",
        ),
    ),
    (
        "Sensor / Instrumentation Issue",
        (
            r"\bsensor\b",
            r"\bprobe\b",
            r"\btransmitter\b",
            r"\bgauge\b",
            r"calibrat",
            r"instrument",
            r"\breading\b",
            r"\bmeter\b",
        ),
    ),
    (
        "Electrical Fault",
        (
            r"electric",
            r"\bwiring\b",
            r"\bvoltage\b",
            r"\bpower\b",
            r"\bcircuit\b",
            r"\bmotor\b",
            r"\bcontactor\b",
            r"\bfuse\b",
            r"short circuit",
            r"\bpanel\b",
            r"\brelay\b",
            r"\binverter\b",
        ),
    ),
    ("Cleaning-Related Issue", (r"\bclean", r"\bhygiene\b", r"sanitat", r"\bwash\b")),
    (
        "Spare-Part-Related Issue",
        (r"\bspare\b", r"\breplace", r"\bworn\b", r"\bbearing\b", r"\bseal\b", r"\bbelt\b", r"\bgasket\b", r"\bo-ring\b"),
    ),
    ("PM-Related Issue", (r"\bpm\b", r"\bpreventive\b", r"scheduled maintenance", r"\binspection\b")),
    (
        "Facility / Building Issue",
        (r"\bbuilding\b", r"\bdoor\b", r"\bfloor\b", r"\broof\b", r"\bwall\b", r"\blight\b", r"\bfacility\b", r"\bceiling\b"),
    ),
    (
        "Utility Issue",
        (r"\bwater\b", r"\bsteam\b", r"\bboiler\b", r"air compressor", r"\bgas\b", r"\butility\b", r"\bpump\b", r"\bvalve\b", r"\bdrain\b"),
    ),
    (
        "Possible Operation-Related Issue",
        (r"\bmisuse\b", r"\bwrong\b", r"improper", r"\boperator\b", r"\bhandling\b", r"\boverload\b", r"not follow", r"incorrect"),
    ),
    (
        "Mechanical Fault",
        (
            r"mechanic",
            r"\bjam\b",
            r"abnormal sound",
            r"\bnoise\b",
            r"vibrat",
            r"\bleak",
            r"\bbroken\b",
            r"\bcrack",
            r"\bgear\b",
            r"\bchain\b",
            r"\bshaft\b",
            r"movement",
            r"\bstuck\b",
            r"\bblock",
            r"\bdamage",
        ),
    ),
]
_THEME_COMPILED = [(name, [re.compile(pattern, re.IGNORECASE) for pattern in patterns]) for name, patterns in _THEME_PATTERNS]
_UNKNOWN_THEME = "Unknown / Insufficient Information"

_CHAT_SYSTEM_PROMPT = (
    "You are MIRA, a read-only Maintenance Intelligence and Reporting Assistant. "
    "You answer questions using only the verified dashboard data provided in the context JSON. "
    "Do not invent numbers. Do not estimate missing values. Do not claim a root cause unless the "
    "description data clearly supports it. For fault analysis use cautious wording such as suggests, "
    "indicates, or may be related to. Keep answers concise, professional, and suitable for engineering management."
)

_READ_ONLY_RESPONSE = "MIRA is currently read-only and cannot modify maintenance records."
_READ_ONLY_PATTERNS = (
    r"\b(create|submit|add|edit|update|change|modify|close|delete|remove|cancel|approve)\b",
    r"\b(mr|maintenance request|wo|work order|pm|maintenance record|d365|excel|sharepoint|source file|record)\b",
)
_PM_QUERY_EXECUTOR = ThreadPoolExecutor(max_workers=2)
_PM_QUERY_TIMEOUT_SECONDS = 8
_PM_LOAD_WARNING = "PM verified detail is still loading from the source schedule files. Try the PM question again in a moment."


def classify_intent(question: str | None) -> str:
    text = (question or "").strip().lower()
    if not text:
        return _DEFAULT_INTENT
    for intent, keywords in _INTENT_RULES:
        if any(keyword in text for keyword in keywords):
            return intent
    return _DEFAULT_INTENT


def extract_period(question: str | None) -> dict:
    """Pull an explicit period from the question. Empty dict means use defaults."""
    text = (question or "").lower()
    out: dict = {}
    now = datetime.now()

    fy = re.search(r"\bfy\s*-?\s*(20\d{2})\b", text)
    if fy:
        out["year"] = int(fy.group(1))
        out["_fy"] = True

    ymatch = re.search(r"\b(20\d{2})\b", text)
    if ymatch and "year" not in out:
        out["year"] = int(ymatch.group(1))

    for name, idx in _MONTHS.items():
        if re.search(rf"\b{name}\b", text):
            out["month"] = idx
            break

    if "ytd" in text or "year to date" in text or "year-to-date" in text:
        out["month"] = None
        out["_ytd"] = True
    if "full year" in text or "all year" in text:
        out["month"] = None
        out["_full_year"] = True
    if "last month" in text or "previous month" in text:
        prev_m = now.month - 1 or 12
        out["month"] = prev_m
        out["year"] = now.year if now.month > 1 else now.year - 1
    elif "this month" in text or "current month" in text:
        out["_this_month"] = True
    return out


def resolve_filters(question: str, base_filters: dict | None) -> dict:
    """Apply the chat default of current-year YTD unless the question overrides it."""
    base = ctx.normalize_filters(base_filters)
    period = extract_period(question)
    now = datetime.now()
    merged = dict(base)
    merged["year"] = now.year
    merged["month"] = None
    merged["period_mode"] = "ytd"

    if "year" in period:
        merged["year"] = period["year"]
    if period.get("_fy"):
        merged["period_mode"] = "financial_year"
        merged["month"] = None
    elif period.get("_full_year"):
        merged["period_mode"] = "full_year"
        merged["month"] = None
    elif period.get("_ytd"):
        merged["period_mode"] = "ytd"
        merged["month"] = None
    elif period.get("_this_month"):
        merged["period_mode"] = "monthly"
        merged["month"] = base.get("month") or now.month
        merged["year"] = base.get("year") or now.year
    elif period.get("month"):
        merged["period_mode"] = "monthly"
        merged["month"] = period["month"]
        if "year" not in period:
            merged["year"] = base.get("year") or now.year

    return ctx.normalize_filters(merged)


def _row_description(row: dict) -> str:
    return str(row.get("translated_description") or row.get("description") or row.get("description_original") or "").strip()


def classify_theme(text: str) -> str:
    blob = str(text or "").strip()
    if len(blob) < 5:
        return _UNKNOWN_THEME
    for name, patterns in _THEME_COMPILED:
        if any(pattern.search(blob) for pattern in patterns):
            return name
    return _UNKNOWN_THEME


def _persist_description_tags(classified: list, filters: dict) -> int:
    """Best effort persistence of local AI-suggested theme tags for later review."""
    try:
        os.makedirs(os.path.dirname(_TAGS_PATH), exist_ok=True)
        store = {}
        if os.path.exists(_TAGS_PATH):
            try:
                with open(_TAGS_PATH, encoding="utf-8") as fh:
                    store = json.load(fh) or {}
            except Exception:
                store = {}
        period = ctx.month_label(filters)
        now = datetime.now().isoformat(timespec="seconds")
        for theme, row, desc in classified:
            mr_wo = str(row.get("work_order_id") or row.get("request_id") or "").strip()
            asset_id = str(row.get("asset_id") or "").strip()
            key = f"{mr_wo or asset_id or 'NA'}|{desc[:24]}"
            if key.strip("|") in ("", "NA"):
                continue
            store[key] = {
                "mr_wo": mr_wo,
                "asset_id": asset_id,
                "asset_name": str(row.get("machine_name") or "").strip(),
                "functional_location": str(row.get("raw_functional_location") or "").strip(),
                "description_snippet": re.sub(r"\s+", " ", desc)[:120],
                "suggested_theme": theme,
                "period": period,
                "classified_at": now,
                "source": "MIRA keyword classifier (AI-suggested; confirm by engineering review)",
            }
        if len(store) > 5000:
            store = dict(sorted(store.items(), key=lambda item: item[1].get("classified_at", ""), reverse=True)[:5000])
        tmp = _TAGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(store, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, _TAGS_PATH)
        return len(store)
    except Exception:
        return 0


def get_mr_description_theme_summary(filters: dict) -> dict:
    """Keyword-based MR description theme summary for the selected period."""
    normalized = ctx.normalize_filters(filters)
    rows = kpi._selected_period_work_order_rows(normalized)
    classified = []
    theme_counts: Counter[str] = Counter()
    for row in rows:
        desc = _row_description(row)
        theme = classify_theme(desc)
        theme_counts[theme] += 1
        classified.append((theme, row, desc))
    _persist_description_tags(classified, normalized)

    total_classified = sum(count for theme, count in theme_counts.items() if theme != _UNKNOWN_THEME)
    top = [(theme, count) for theme, count in theme_counts.most_common() if theme != _UNKNOWN_THEME]
    top_theme, top_count = (top[0] if top else (None, 0))

    top_asset = None
    top_location = None
    examples: list[str] = []
    if top_theme:
        theme_rows = [(row, desc) for theme, row, desc in classified if theme == top_theme]
        asset_counts = Counter(str(row.get("machine_name") or row.get("asset_id") or "Unknown").strip() for row, _ in theme_rows)
        loc_counts = Counter(str(row.get("raw_functional_location") or "Unspecified").strip() for row, _ in theme_rows)
        top_asset = asset_counts.most_common(1)[0][0] if asset_counts else None
        top_location = loc_counts.most_common(1)[0][0] if loc_counts else None
        for _, desc in theme_rows[:3]:
            snippet = re.sub(r"\s+", " ", desc)[:90]
            if snippet:
                examples.append(snippet)

    pct = round((top_count / len(rows)) * 100, 1) if rows and top_count else None
    return {
        "period": ctx.month_label(normalized),
        "rows_loaded": len(rows),
        "classified_descriptions": total_classified,
        "unknown_count": theme_counts.get(_UNKNOWN_THEME, 0),
        "top_theme": top_theme,
        "top_theme_count": top_count,
        "top_theme_pct": pct,
        "top_theme_asset": top_asset,
        "top_theme_functional_location": top_location,
        "theme_breakdown": [{"theme": theme, "count": count} for theme, count in theme_counts.most_common()],
        "example_descriptions": examples,
        "note": "These are AI-suggested classifications based on MR/WO descriptions. Final root cause should be confirmed by engineering review.",
        "source": "downtime MR descriptions (selected period)",
    }


def _fmt(value):
    if value is None:
        return "unavailable"
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _currency(value) -> str:
    if value is None:
        return "unavailable"
    try:
        return f"THB {float(value):,.0f}"
    except (TypeError, ValueError):
        return str(value)


def _row_metric(label: str, value) -> dict:
    return {"label": label, "value": _fmt(value)}


def _is_read_only_request(question: str | None) -> bool:
    text = (question or "").strip().lower()
    return all(re.search(pattern, text) for pattern in _READ_ONLY_PATTERNS)


def _downtime_warning_lines(mr: dict) -> list[str]:
    warnings = []
    if (mr.get("missing_asset_count") or 0) > 0:
        warnings.append(f"{_fmt(mr.get('missing_asset_count'))} MR records are missing Asset ID.")
    if (mr.get("general_area_asset_count") or 0) > 0:
        warnings.append(f"{_fmt(mr.get('general_area_asset_count'))} MR records use a general area or placeholder asset name.")
    if (mr.get("missing_functional_location_count") or 0) > 0:
        warnings.append(f"{_fmt(mr.get('missing_functional_location_count'))} MR records are missing functional location.")
    if (mr.get("unknown_status_count") or 0) > 0:
        warnings.append(f"{_fmt(mr.get('unknown_status_count'))} MR records have an unmapped status.")
    return warnings


def _follow_up(mr: dict, pm: dict, *, spare: dict | None = None, top_location: str | None = None) -> list[str]:
    items = []
    if mr.get("open_count"):
        items.append(f"Review {_fmt(mr['open_count'])} open / in-progress MR, including {_fmt(mr.get('carry_over_open_mr'))} carry-over open MR.")
    if pm.get("overdue_pm"):
        items.append(f"Action {_fmt(pm['overdue_pm'])} overdue PM tasks with the engineering team.")
    if pm.get("backlog_pm"):
        items.append(f"Clear {_fmt(pm['backlog_pm'])} backlog PM items that are still pending.")
    if top_location:
        items.append(f"Check workload concentration at {top_location}.")
    if mr.get("missing_asset_count") or mr.get("general_area_asset_count"):
        items.append("Validate MR master-data quality before sharing the summary externally.")
    if spare and (spare.get("top_consumed_part") or (spare.get("yoy_consumption_pct") or 0) > 10):
        items.append("Review high-consumption or high-value spare-parts usage.")
    return items[:4]


def _view_data_used(intent: str, filters: dict, warnings: list, *, source_tables=None, rows_loaded=None, rows_after_filter=None, kpi_values_used=None) -> dict:
    window = ctx.resolved_window(filters)
    return {
        "period_mode": filters.get("period_mode"),
        "period_label": ctx.month_label(filters),
        "date_range": f"{window['start_date'].isoformat()} to {window['end_date'].isoformat()}",
        "source_tables": source_tables or ["Downtime MR/WO rows", "PM schedule payload", "Spare parts payload"],
        "filters_applied": [
            f"Period used: {ctx.month_label(filters)}",
            f"Period mode: {filters.get('period_mode')}",
            f"Stage: {filters.get('stage')}",
            f"Asset category: {filters.get('mainAssetGroup') or 'All'}",
        ],
        "rows_loaded": rows_loaded or [],
        "rows_after_filter": rows_after_filter or [],
        "kpi_values_used": kpi_values_used or [],
        "data_warnings": warnings or [],
        "last_refreshed": datetime.now().astimezone().strftime("%d %b %Y, %I:%M %p"),
        "intent": intent,
    }


def _run_with_timeout(producer, *args, timeout_seconds: int = _PM_QUERY_TIMEOUT_SECONDS, **kwargs):
    future = _PM_QUERY_EXECUTOR.submit(producer, *args, **kwargs)
    try:
        return future.result(timeout=timeout_seconds), None
    except FutureTimeoutError:
        return None, _PM_LOAD_WARNING
    except Exception:
        return None, "PM verified detail could not be loaded from the source schedule files right now."


def build_context(intent: str, filters: dict, question: str) -> dict:
    """Return the verified context bundle that powers one chat response."""
    period = ctx.month_label(filters)
    out = {
        "intent": intent,
        "period": period,
        "answer_seed": "",
        "key_numbers": [],
        "insight": [],
        "follow_up": [],
        "theme": None,
        "risk": None,
        "context": {},
        "view_data_used": None,
        "warnings": [],
    }

    if intent == "maintenance_summary":
        verified = kpi.get_verified_downtime_metrics(filters)
        mr = verified.get("downtime_summary") or {}
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        pm = (pm_bundle or {}).get("metrics", {})
        out["context"] = {"downtime": mr, "pm": pm}
        out["answer_seed"] = f"For {period}, {_fmt(mr.get('total_work_orders'))} MR were raised and {_fmt(mr.get('closed_work_orders'))} were closed / confirmed."
        if pm_bundle:
            out["answer_seed"] += (
                f" PM compliance was {_fmt(pm.get('pm_compliance_percent'))}% with "
                f"{_fmt(pm.get('overdue_pm'))} overdue PM tasks."
            )
        elif pm_warning:
            out["answer_seed"] += f" {pm_warning}"
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr.get('total_work_orders'))}",
            f"Open / In Progress MR: {_fmt(mr.get('open_work_orders'))}",
            f"Closed / Confirmed MR: {_fmt(mr.get('closed_work_orders'))}",
            f"Closure Rate: {_fmt(mr.get('closure_rate_pct'))}%",
            f"Top Actual Machine Asset: {_fmt(mr.get('top_actual_machine_asset_name'))}",
            f"MTTR: {_fmt(verified.get('mttr_hours'))} h",
        ]
        if pm_bundle:
            out["key_numbers"].insert(4, f"PM Compliance: {_fmt(pm.get('pm_compliance_percent'))}%")
            out["key_numbers"].insert(5, f"PM Overdue: {_fmt(pm.get('overdue_pm'))}")
        out["insight"] = [
            f"Carry-over open MR remain at {_fmt(mr.get('carry_over_open_mr'))}, bringing total active workload to {_fmt(mr.get('total_active_workload'))}.",
            f"Corrective MR remain the larger share of workload at {_fmt(mr.get('corrective_count'))} versus {_fmt(mr.get('preventive_count'))} preventive MR.",
            f"Data quality issues flagged for follow-up: {_fmt(mr.get('data_quality_issue_count'))}.",
        ]
        if pm_warning:
            out["insight"].append(pm_warning)
        out["follow_up"] = _follow_up(mr, pm if pm_bundle else {"overdue_pm": 0, "backlog_pm": 0}, top_location=mr.get("top_functional_location_name"))
        out["warnings"] = _downtime_warning_lines(mr) + ((pm_bundle or {}).get("data_quality", {}).get("warnings") or [])
        if pm_warning:
            out["warnings"].append(pm_warning)
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows", "Downtime MTTR/MTBF summary"] + (["PM schedule payload"] if pm_bundle else []),
            rows_loaded=[
                _row_metric("Selected-period MR loaded", mr.get("selected_work_order_rows_count")),
                _row_metric("Carry-over open MR", mr.get("carry_over_open_mr")),
            ] + ([_row_metric("PM tasks loaded", pm.get("scheduled_pm"))] if pm_bundle else []),
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "downtime_summary":
        verified = kpi.get_verified_downtime_metrics(filters)
        mr = verified.get("downtime_summary") or {}
        out["context"] = verified
        out["answer_seed"] = (
            f"For {period}, {_fmt(mr.get('total_work_orders'))} MR were raised, {_fmt(mr.get('closed_work_orders'))} were "
            f"closed / confirmed, and {_fmt(mr.get('open_work_orders'))} remain open or in progress."
        )
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr.get('total_work_orders'))}",
            f"Open / In Progress MR: {_fmt(mr.get('open_work_orders'))}",
            f"Closed / Confirmed MR: {_fmt(mr.get('closed_work_orders'))}",
            f"Closure Rate: {_fmt(mr.get('closure_rate_pct'))}%",
            f"Carry-over Open MR: {_fmt(mr.get('carry_over_open_mr'))}",
            f"Total Active Workload: {_fmt(mr.get('total_active_workload'))}",
            f"Top Recorded Asset / Area: {_fmt(mr.get('top_recorded_asset_name'))}",
            f"Top Actual Machine Asset: {_fmt(mr.get('top_actual_machine_asset_name'))}",
            f"Top Functional Location: {_fmt(mr.get('top_functional_location_name'))}",
            f"MTTR: {_fmt(verified.get('mttr_hours'))} h",
            f"MTBF: {_fmt(verified.get('mtbf_hours'))} h",
        ]
        out["insight"] = [
            f"Closure rate was {_fmt(mr.get('closure_rate_pct'))}% for the selected period.",
            f"Corrective MR dominated period activity at {_fmt(mr.get('corrective_count'))} versus {_fmt(mr.get('preventive_count'))} preventive MR.",
            f"Data quality issues flagged: {_fmt(mr.get('data_quality_issue_count'))}.",
        ]
        out["follow_up"] = _follow_up(mr, {"overdue_pm": 0, "backlog_pm": 0}, top_location=mr.get("top_functional_location_name"))
        out["warnings"] = _downtime_warning_lines(mr)
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows", "Downtime MTTR/MTBF summary"],
            rows_loaded=[
                _row_metric("Selected-period MR loaded", mr.get("selected_work_order_rows_count")),
                _row_metric("Carry-over open MR", mr.get("carry_over_open_mr")),
            ],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "pm_summary":
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        overdue, overdue_warning = _run_with_timeout(kpi.get_overdue_pm_records, filters, limit=5)
        pm = (pm_bundle or {}).get("metrics", {})
        overdue = overdue or {}
        out["context"] = {"pm": pm, "overdue": overdue, "data_quality": (pm_bundle or {}).get("data_quality")}
        if not pm_bundle:
            warning_text = overdue_warning or pm_warning or _PM_LOAD_WARNING
            out["answer_seed"] = f"PM verified detail for {period} is still loading from the source schedule files."
            out["insight"] = [warning_text]
            out["follow_up"] = ["Try the PM question again in a moment once the verified schedule detail has loaded."]
            out["warnings"] = [warning_text]
            out["view_data_used"] = _view_data_used(intent, filters, out["warnings"], source_tables=["PM schedule payload"])
            return out
        out["answer_seed"] = (
            f"For {period}, {_fmt(pm.get('scheduled_pm'))} PM tasks are scheduled, {_fmt(pm.get('completed_pm'))} are manually completed, "
            f"and compliance stands at {_fmt(pm.get('pm_compliance_percent'))}%."
        )
        out["key_numbers"] = [
            f"PM Scheduled: {_fmt(pm.get('scheduled_pm'))}",
            f"PM Completed: {_fmt(pm.get('completed_pm'))}",
            f"PM Due This Month: {_fmt(pm.get('due_this_month'))}",
            f"PM Overdue: {_fmt(pm.get('overdue_pm'))}",
            f"PM Backlog: {_fmt(pm.get('backlog_pm'))}",
            f"PM Compliance: {_fmt(pm.get('pm_compliance_percent'))}%",
        ]
        out["insight"] = [
            "PM completion is counted only when manually marked Done.",
            f"Overdue PM currently totals {_fmt(pm.get('overdue_pm'))}, with backlog at {_fmt(pm.get('backlog_pm'))}.",
            f"{_fmt(overdue.get('overdue_count'))} overdue PM task rows are available for follow-up detail.",
        ]
        out["follow_up"] = [
            f"Review {_fmt(pm.get('overdue_pm'))} overdue PM tasks with the engineering team.",
            f"Work through {_fmt(pm.get('backlog_pm'))} backlog PM items still pending." if pm.get("backlog_pm") else "No PM backlog is currently flagged.",
        ]
        out["warnings"] = pm_bundle["data_quality"]["warnings"] + ([overdue_warning] if overdue_warning else [])
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["PM schedule payload"],
            rows_loaded=[_row_metric("PM tasks loaded", pm.get("scheduled_pm"))],
            rows_after_filter=[_row_metric("Overdue PM rows", overdue.get("overdue_count"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "pm_overdue_query":
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        overdue, overdue_warning = _run_with_timeout(kpi.get_overdue_pm_records, filters, limit=5)
        pm = (pm_bundle or {}).get("metrics", {})
        overdue = overdue or {}
        out["context"] = {"pm": pm, "overdue": overdue}
        if not pm_bundle or not overdue:
            warning_text = overdue_warning or pm_warning or _PM_LOAD_WARNING
            out["answer_seed"] = f"PM overdue detail for {period} is still loading from the source schedule files."
            out["insight"] = [warning_text]
            out["follow_up"] = ["Try this PM overdue question again in a moment for the latest verified task list."]
            out["warnings"] = [warning_text]
            out["view_data_used"] = _view_data_used(intent, filters, out["warnings"], source_tables=["PM schedule payload"])
            return out
        first = (overdue.get("records") or [None])[0]
        out["answer_seed"] = (
            f"{_fmt(overdue.get('overdue_count'))} PM tasks are currently overdue in {period}."
            + (f" The highest visible follow-up item is {first.get('asset_name')} at {first.get('system_area')}." if first else "")
        )
        out["key_numbers"] = [
            f"PM Overdue: {_fmt(overdue.get('overdue_count'))}",
            f"PM Backlog: {_fmt(pm.get('backlog_pm'))}",
        ]
        for index, task in enumerate(overdue.get("records") or [], start=1):
            out["key_numbers"].append(
                f"Overdue Task {index}: {_fmt(task.get('asset_name'))} / {_fmt(task.get('system_area'))} ({_fmt(task.get('days_overdue'))} days)"
            )
        out["insight"] = [
            f"PM overdue count is {_fmt(overdue.get('overdue_count'))} for the selected scope.",
            f"PM backlog remains {_fmt(pm.get('backlog_pm'))}.",
        ]
        out["follow_up"] = [
            "Prioritise the overdue PM list starting with the oldest items.",
            f"Review whether backlog PM at {_fmt(pm.get('backlog_pm'))} needs rescheduling or immediate action.",
        ]
        out["warnings"] = pm_bundle["data_quality"]["warnings"] + ([overdue_warning] if overdue_warning else [])
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["PM schedule payload"],
            rows_loaded=[_row_metric("All overdue PM rows", overdue.get("rows_loaded"))],
            rows_after_filter=[_row_metric("Filtered overdue PM rows", overdue.get("overdue_count"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "backlog_query":
        mr = kpi.get_mr_activity_summary(filters)
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        pm = (pm_bundle or {}).get("metrics", {})
        out["context"] = {"downtime": mr, "pm": pm}
        out["answer_seed"] = f"In {period}, backlog is mainly {_fmt(mr.get('carry_over_open_mr'))} carry-over open MR."
        if pm_bundle:
            out["answer_seed"] += f" PM backlog is {_fmt(pm.get('backlog_pm'))} tasks with {_fmt(pm.get('overdue_pm'))} overdue."
        elif pm_warning:
            out["answer_seed"] += f" {pm_warning}"
        out["key_numbers"] = [
            f"Carry-over Open MR: {_fmt(mr.get('carry_over_open_mr'))}",
            f"Open / In Progress MR: {_fmt(mr.get('open_count'))}",
        ]
        if pm_bundle:
            out["key_numbers"].append(f"PM Backlog: {_fmt(pm.get('backlog_pm'))}")
            out["key_numbers"].append(f"PM Overdue: {_fmt(pm.get('overdue_pm'))}")
        out["insight"] = [
            f"Total active MR workload rises to {_fmt(mr.get('total_active_workload'))} once carry-over open MR are included.",
        ]
        if pm_bundle:
            out["insight"].append("PM backlog and overdue PM should be reviewed together because both affect schedule compliance.")
        elif pm_warning:
            out["insight"].append(pm_warning)
        out["follow_up"] = _follow_up(mr, pm if pm_bundle else {"overdue_pm": 0, "backlog_pm": 0})
        out["warnings"] = _downtime_warning_lines(mr) + ((pm_bundle or {}).get("data_quality", {}).get("warnings") or [])
        if pm_warning:
            out["warnings"].append(pm_warning)
        out["view_data_used"] = _view_data_used(intent, filters, out["warnings"], kpi_values_used=out["key_numbers"])

    elif intent == "top_asset_query":
        assets = kpi.get_top_assets_by_mr_count(filters)
        recorded = assets.get("top_recorded_asset") or {}
        actual = assets.get("top_actual_machine_asset") or {}
        out["context"] = assets
        out["answer_seed"] = (
            f"The top recorded asset or area in {period} is {_fmt(recorded.get('asset_name'))} with {_fmt(recorded.get('mr_count'))} MR."
            + (f" The top actual machine asset is {_fmt(actual.get('asset_name'))} with {_fmt(actual.get('mr_count'))} MR." if actual.get("asset_name") else "")
        )
        out["key_numbers"] = [
            f"Top Recorded Asset / Area: {_fmt(recorded.get('asset_name'))} ({_fmt(recorded.get('mr_count'))} MR)"
            + (" - placeholder / general area" if recorded.get("is_placeholder") else ""),
            f"Top Actual Machine Asset: {_fmt(actual.get('asset_name'))} ({_fmt(actual.get('mr_count'))} MR)",
        ]
        out["insight"] = ["Recorded asset and actual machine asset are kept separate so general areas do not hide the real machine follow-up."]
        if recorded.get("is_placeholder"):
            out["insight"].append("The top recorded item is a placeholder or area, so the top actual machine asset is the better engineering follow-up point.")
        out["follow_up"] = [f"Review {_fmt(actual.get('asset_name') or recorded.get('asset_name'))} with engineering for repeat workload drivers."]
        out["warnings"] = [recorded.get("reason")] if recorded.get("is_placeholder") else []
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows"],
            rows_loaded=[_row_metric("Selected-period MR loaded", assets.get("rows_loaded"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "top_functional_location_query":
        locations = kpi.get_top_functional_locations(filters, limit=5)
        top = locations.get("top_functional_location") or {}
        out["context"] = locations
        out["answer_seed"] = f"The highest workload functional location in {period} is {_fmt(top.get('name'))} with {_fmt(top.get('mr_count'))} MR."
        out["key_numbers"] = [f"Top Functional Location: {_fmt(top.get('name'))} ({_fmt(top.get('mr_count'))} MR)"]
        for index, row in enumerate(locations.get("functional_locations") or [], start=1):
            out["key_numbers"].append(f"Location {index}: {_fmt(row.get('functional_location'))} ({_fmt(row.get('mr_count'))} MR)")
        out["insight"] = ["Functional location highlights where maintenance workload is concentrated operationally."]
        out["follow_up"] = [f"Review workload concentration at {_fmt(top.get('name'))}."]
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows"],
            rows_loaded=[_row_metric("Selected-period MR loaded", locations.get("rows_loaded"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "open_mr_query":
        open_rows = kpi.get_open_mr_records(filters, limit=5)
        out["context"] = open_rows
        first = (open_rows.get("records") or [None])[0]
        out["answer_seed"] = (
            f"{_fmt(open_rows.get('open_count'))} MR are still open or in progress in {period}, with "
            f"{_fmt(open_rows.get('carry_over_open_mr'))} carry-over open MR from before the period."
            + (f" One visible example is {first.get('asset_name')} at {first.get('functional_location')}." if first else "")
        )
        out["key_numbers"] = [
            f"Open / In Progress MR: {_fmt(open_rows.get('open_count'))}",
            f"Carry-over Open MR: {_fmt(open_rows.get('carry_over_open_mr'))}",
        ]
        for index, row in enumerate(open_rows.get("records") or [], start=1):
            out["key_numbers"].append(f"Open MR {index}: {_fmt(row.get('asset_name'))} / {_fmt(row.get('functional_location'))} ({_fmt(row.get('status'))})")
        out["insight"] = [f"Carry-over open MR remain material at {_fmt(open_rows.get('carry_over_open_mr'))}."]
        out["follow_up"] = ["Review the open MR list and prioritise the highest-severity unresolved items."]
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows"],
            rows_loaded=[_row_metric("Open selected-period MR rows", open_rows.get("rows_loaded"))],
            rows_after_filter=[_row_metric("Returned MR rows", len(open_rows.get("records") or []))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent in ("fault_theme_query", "recurring_issue_query"):
        theme = get_mr_description_theme_summary(filters)
        out["theme"] = theme
        out["context"] = {"theme_analysis": theme}
        if theme.get("top_theme"):
            if intent == "recurring_issue_query":
                assets = kpi.get_top_assets_by_mr_count(filters)
                actual = assets.get("top_actual_machine_asset") or {}
                out["context"]["top_assets"] = assets
                out["answer_seed"] = (
                    f"The strongest recurring pattern in {period} is {_fmt(theme.get('top_theme'))}, and the top actual machine asset "
                    f"by MR count is {_fmt(actual.get('asset_name'))} with {_fmt(actual.get('mr_count'))} MR."
                )
                out["key_numbers"] = [
                    f"Top Theme: {_fmt(theme.get('top_theme'))} ({_fmt(theme.get('top_theme_count'))}/{_fmt(theme.get('rows_loaded'))} MR)",
                    f"Top Actual Machine Asset: {_fmt(actual.get('asset_name'))} ({_fmt(actual.get('mr_count'))} MR)",
                    f"Top Functional Location for Theme: {_fmt(theme.get('top_theme_functional_location'))}",
                ]
                out["insight"] = [
                    "Recurring issue questions combine the theme pattern and the highest-frequency machine follow-up point.",
                    theme.get("note"),
                ]
                out["follow_up"] = ["Review the repeated-issue machine with engineering and confirm the actual root cause from MR history."]
            else:
                out["answer_seed"] = (
                    f"The most common fault theme in {period} is {_fmt(theme.get('top_theme'))}, based on "
                    f"{_fmt(theme.get('top_theme_count'))} of {_fmt(theme.get('rows_loaded'))} MR descriptions."
                )
                out["key_numbers"] = [
                    f"Top Fault Theme: {_fmt(theme.get('top_theme'))}",
                    f"Theme Count: {_fmt(theme.get('top_theme_count'))} of {_fmt(theme.get('rows_loaded'))} MR ({_fmt(theme.get('top_theme_pct'))}%)",
                    f"Top Related Asset: {_fmt(theme.get('top_theme_asset'))}",
                    f"Top Related Functional Location: {_fmt(theme.get('top_theme_functional_location'))}",
                ]
                out["insight"] = [
                    theme.get("note"),
                    f"Unknown or insufficient descriptions account for {_fmt(theme.get('unknown_count'))} MR." if theme.get("unknown_count") else "Description coverage is adequate for a theme indication.",
                ]
                out["follow_up"] = ["Confirm the suggested fault theme through engineering review before assigning a root cause."]
        else:
            out["answer_seed"] = (
                "Description theme analysis did not return a dominant pattern for the selected period. "
                "I can still summarise MR counts, top assets, functional locations, and open workload from verified dashboard data."
            )
            out["warnings"] = ["MR description theme analysis did not return a dominant classified pattern for the selected period."]
            out["follow_up"] = ["Use the verified downtime summary to review top assets, functional locations, and open workload."]
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR descriptions"],
            rows_loaded=[_row_metric("MR descriptions loaded", theme.get("rows_loaded"))],
            rows_after_filter=[_row_metric("Classified descriptions", theme.get("classified_descriptions"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "daily_follow_up_query":
        mr = kpi.get_mr_activity_summary(filters)
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        pm = (pm_bundle or {}).get("metrics", {})
        top_location = kpi.get_top_functional_locations(filters, limit=1)
        spare_top = kpi.get_top_spare_parts_consumption(filters, limit=3)
        out["context"] = {"downtime": mr, "pm": pm, "top_location": top_location, "spare": spare_top}
        out["answer_seed"] = f"Today's follow-up for {period} is centered on {_fmt(mr.get('open_count'))} open or in-progress MR."
        if pm_bundle:
            out["answer_seed"] += (
                f" PM follow-up also includes {_fmt(pm.get('overdue_pm'))} overdue PM tasks and "
                f"{_fmt(pm.get('backlog_pm'))} backlog PM items."
            )
        elif pm_warning:
            out["answer_seed"] += f" {pm_warning}"
        out["key_numbers"] = [
            f"Open MR: {_fmt(mr.get('open_count'))}",
            f"Carry-over Open MR: {_fmt(mr.get('carry_over_open_mr'))}",
            f"Top Functional Location: {_fmt((top_location.get('top_functional_location') or {}).get('name'))}",
            f"Data Quality Issues: {_fmt(mr.get('data_quality_issue_count'))}",
            f"Top Consumed Spare Part: {_fmt(spare_top.get('top_consumed_part'))}",
        ]
        if pm_bundle:
            out["key_numbers"].insert(2, f"PM Overdue: {_fmt(pm.get('overdue_pm'))}")
            out["key_numbers"].insert(3, f"PM Backlog: {_fmt(pm.get('backlog_pm'))}")
        out["insight"] = [
            f"Total active MR workload is {_fmt(mr.get('total_active_workload'))} once carry-over open MR are included.",
            f"The highest workload functional location is {_fmt((top_location.get('top_functional_location') or {}).get('name'))}.",
            f"Data quality issues remain at {_fmt(mr.get('data_quality_issue_count'))} flagged MR rows.",
        ]
        if pm_warning:
            out["insight"].append(pm_warning)
        out["follow_up"] = _follow_up(
            mr,
            pm if pm_bundle else {"overdue_pm": 0, "backlog_pm": 0},
            spare={"top_consumed_part": spare_top.get("top_consumed_part")},
            top_location=(top_location.get("top_functional_location") or {}).get("name"),
        )
        out["warnings"] = _downtime_warning_lines(mr) + ((pm_bundle or {}).get("data_quality", {}).get("warnings") or [])
        if pm_warning:
            out["warnings"].append(pm_warning)
        out["view_data_used"] = _view_data_used(intent, filters, out["warnings"], kpi_values_used=out["key_numbers"])

    elif intent == "risk_insight_query":
        from . import risk_service

        risk = risk_service.get_asset_risk_insights(filters)
        top = (risk.get("top_assets") or [None])[0]
        out["context"] = {"risk": risk}
        out["risk"] = risk
        out["answer_seed"] = (
            f"For {period}, {_fmt(risk.get('high_attention_count'))} assets are High Attention and "
            f"{_fmt(risk.get('medium_attention_count'))} are Medium Attention."
            + (f" The highest visible risk item is {top.get('asset_name')} (risk {top.get('risk_score')})." if top else "")
        )
        out["key_numbers"] = [
            f"High Attention Assets: {_fmt(risk.get('high_attention_count'))}",
            f"Medium Attention Assets: {_fmt(risk.get('medium_attention_count'))}",
            f"Assets Assessed: {_fmt(risk.get('assets_assessed'))}",
        ]
        for asset in risk.get("top_assets") or []:
            out["key_numbers"].append(
                f"{_fmt(asset.get('asset_name'))}: risk {_fmt(asset.get('risk_score'))} ({_fmt(asset.get('risk_level'))}, {_fmt(asset.get('mr_count'))} MR)"
            )
        out["insight"] = [risk.get("note") or "Risk is a follow-up signal, not a failure prediction."]
        out["follow_up"] = ["Prioritise the High Attention asset list with engineering review."]
        out["warnings"] = risk.get("data_notes", [])
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Downtime MR/WO rows", "PM schedule payload", "Spare parts payload"],
            kpi_values_used=out["key_numbers"],
        )

    elif intent in ("spare_parts_summary", "spare_parts_consumption_query"):
        spare = kpi.get_verified_spare_parts_metrics(filters)
        top = kpi.get_top_spare_parts_consumption(filters, limit=5)
        out["context"] = {"spare": spare, "consumption": top}
        out["answer_seed"] = (
            f"For {period}, current in-stock spare parts total {_fmt(spare.get('current_in_stock_items'))} items, "
            f"while drawn-from-store value is {_currency(spare.get('drawn_from_store_value'))}."
        )
        out["key_numbers"] = [
            f"Current In-Stock Spare Parts: {_fmt(spare.get('current_in_stock_items'))}",
            f"Current In-Stock Value: {_currency(spare.get('current_in_stock_value'))}",
            f"Drawn from Store Value: {_currency(spare.get('drawn_from_store_value'))}",
            f"Non-Stock Value: {_currency(spare.get('non_stock_value'))}",
            f"Services Value: {_currency(spare.get('services_value'))}",
            f"Top Consumed Spare Part: {_fmt(spare.get('top_consumed_part'))}",
            f"YoY Consumption: {_fmt(spare.get('yoy_consumption_pct'))}%",
        ]
        for index, item in enumerate(top.get("parts") or [], start=1):
            out["key_numbers"].append(f"Top Part {index}: {_fmt(item.get('part_name'))} ({_currency(item.get('value'))})")
        out["insight"] = [
            "Services include repair and cleaning.",
            f"The top consumed spare part is {_fmt(spare.get('top_consumed_part'))}.",
            f"YoY consumption change is {_fmt(spare.get('yoy_consumption_pct'))}% for {spare.get('yoy_label')}.",
        ]
        out["follow_up"] = ["Review high-consumption parts and service-related spend with the maintenance and stores teams."]
        out["warnings"] = spare.get("data_notes") or []
        out["view_data_used"] = _view_data_used(
            intent,
            filters,
            out["warnings"],
            source_tables=["Spare parts payload", "Project transactions history"],
            rows_loaded=[
                _row_metric("Inventory rows loaded", spare.get("inventory_rows_loaded")),
                _row_metric("Project transaction rows loaded", top.get("rows_loaded")),
            ],
            rows_after_filter=[_row_metric("Filtered project transaction rows", top.get("rows_after_filter"))],
            kpi_values_used=out["key_numbers"],
        )

    elif intent == "report_wording_query":
        verified = kpi.get_verified_downtime_metrics(filters)
        mr = verified.get("downtime_summary") or {}
        pm_bundle, pm_warning = _run_with_timeout(kpi.get_verified_pm_metrics, filters)
        pm = (pm_bundle or {}).get("metrics", {})
        out["context"] = {"downtime": mr, "pm": pm}
        out["answer_seed"] = (
            f"{period} maintenance performance shows {_fmt(mr.get('closed_work_orders'))} MR closed or confirmed out of "
            f"{_fmt(mr.get('total_work_orders'))} raised"
        )
        if pm_bundle:
            out["answer_seed"] += (
                f", while PM compliance stands at {_fmt(pm.get('pm_compliance_percent'))}% and "
                f"follow-up is still needed on {_fmt(pm.get('overdue_pm'))} overdue PM tasks."
            )
        else:
            out["answer_seed"] += ", while PM detail is still loading from the source schedule files."
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr.get('total_work_orders'))}",
            f"Closed / Confirmed MR: {_fmt(mr.get('closed_work_orders'))}",
            f"Closure Rate: {_fmt(mr.get('closure_rate_pct'))}%",
        ]
        if pm_bundle:
            out["key_numbers"].append(f"PM Compliance: {_fmt(pm.get('pm_compliance_percent'))}%")
        out["insight"] = ["This line is designed for slide or report use and stays grounded in verified KPI values."]
        out["warnings"] = _downtime_warning_lines(mr) + ((pm_bundle or {}).get("data_quality", {}).get("warnings") or [])
        if pm_warning:
            out["warnings"].append(pm_warning)
        out["view_data_used"] = _view_data_used(intent, filters, out["warnings"], kpi_values_used=out["key_numbers"])

    else:
        out["intent"] = "general_dashboard_help"
        out["answer_seed"] = (
            "I can summarise verified maintenance KPIs, downtime and MR trends, PM status, spare-parts consumption, "
            "top assets, functional locations, open MR, overdue PM, fault themes, and daily follow-up items."
        )
        out["insight"] = ["Examples: Summarise YTD maintenance performance, Which asset has the most MR, What are the main PM issues."]
        out["view_data_used"] = _view_data_used(intent, filters, out["warnings"])

    return out


def _rule_based_answer(intent: str, period: str, context_data: dict, key_numbers: list, theme: dict | None) -> str:
    if key_numbers:
        return f"For {period}: " + "; ".join(key_numbers[:5]) + "."
    if theme and theme.get("top_theme"):
        return (
            f"The most common issue theme in {period} is {theme['top_theme']}, based on "
            f"{theme['top_theme_count']} of {theme['rows_loaded']} classified MR descriptions."
        )
    return f"No verified data was available for {period}."


def _provider_mode_label(status: dict) -> str:
    status_text = str((status or {}).get("status") or "").strip().lower()
    if (status or {}).get("provider") == "ollama" or (status or {}).get("llm"):
        return "Ollama connected"
    if "not running" in status_text:
        return "LLM unavailable"
    return "Rule-based fallback"


def _read_only_response(question: str, base_filters: dict | None) -> dict:
    status = get_provider_status()
    filters = resolve_filters(question or "", base_filters)
    return {
        "ok": True,
        "intent": "read_only_guard",
        "period": ctx.month_label(filters),
        "period_used": f"Period used: {ctx.month_label(filters)}",
        "filters": filters,
        "answer": _READ_ONLY_RESPONSE,
        "key_numbers_used": [],
        "insight": ["I can explain verified maintenance dashboard data, but I cannot create, edit, close, or update source records."],
        "recommended_follow_up": ["Use the normal maintenance workflow to update MR, WO, PM, D365, or source files."],
        "view_data_used": _view_data_used("read_only_guard", filters, []),
        "provider": "rule_based",
        "provider_status": status["status"],
        "provider_mode_label": _provider_mode_label(status),
        "llm_active": False,
        "read_only": True,
    }


def answer(question: str, base_filters: dict | None) -> dict:
    if _is_read_only_request(question):
        return _read_only_response(question or "", base_filters)

    intent = classify_intent(question)
    filters = resolve_filters(question or "", base_filters)
    built = build_context(intent, filters, question or "")
    period = built["period"]

    rule_text = built.get("answer_seed") or _rule_based_answer(
        built["intent"],
        period,
        built["context"],
        built["key_numbers"],
        built["theme"],
    )

    provider = OllamaMiraProvider()
    used_llm = False
    answer_text = rule_text
    if config.LOCAL_LLM_ENABLED and config.PROVIDER_MODE in ("auto", "ollama") and provider.resolve_model():
        try:
            compact = {
                "question": question,
                "intent": built["intent"],
                "period_mode": filters.get("period_mode"),
                "period_label": period,
                "date_range": (built["view_data_used"] or {}).get("date_range"),
                "verified_key_numbers": built["key_numbers"],
                "insight": built.get("insight"),
                "recommended_follow_up": built["follow_up"],
                "data_warnings": built["warnings"],
            }
            if built["theme"] and built["theme"].get("top_theme"):
                theme = built["theme"]
                compact["fault_theme"] = {
                    "top_theme": theme["top_theme"],
                    "count": theme["top_theme_count"],
                    "total": theme["rows_loaded"],
                    "pct": theme["top_theme_pct"],
                    "top_asset": theme["top_theme_asset"],
                    "top_location": theme["top_theme_functional_location"],
                    "examples": theme["example_descriptions"],
                }
            style_instruction = (
                "Return one management-ready sentence only."
                if built["intent"] == "report_wording_query"
                else "Return only the short direct Answer text in 2-4 concise sentences. Do not add headings or bullets."
            )
            user_prompt = (
                f'Answer this question: "{question}"\n\n'
                "Use ONLY the verified figures in the JSON below; never introduce a number not present in it. "
                "If a value is unavailable, say so. For fault themes use cautious wording "
                "(suggests/indicates) and recommend engineering review. "
                f"{style_instruction}\n\n"
                f"VERIFIED_CONTEXT_JSON:\n{json.dumps(compact, default=str, ensure_ascii=False)}\n"
            )
            llm = generate_with_ollama(
                _CHAT_SYSTEM_PROMPT,
                user_prompt,
                model=provider.resolve_model(),
                timeout=15,
            ).strip()
            if llm:
                answer_text = llm
                used_llm = True
        except Exception:
            answer_text = rule_text

    status = get_provider_status()
    result = {
        "ok": True,
        "intent": built["intent"],
        "period": period,
        "period_used": f"Period used: {period}",
        "filters": filters,
        "answer": answer_text,
        "key_numbers_used": built["key_numbers"],
        "insight": built.get("insight") or [],
        "recommended_follow_up": built["follow_up"],
        "view_data_used": built["view_data_used"],
        "provider": "ollama" if used_llm else "rule_based",
        "provider_status": status["status"],
        "provider_mode_label": "Ollama connected" if used_llm else "Rule-based fallback",
        "llm_active": used_llm,
        "read_only": True,
    }
    if built["theme"]:
        result["theme_analysis"] = built["theme"]
    if built.get("risk"):
        result["risk_insights"] = built["risk"]
    return result
