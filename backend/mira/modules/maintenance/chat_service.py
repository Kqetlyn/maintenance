"""
MIRA chat service — intelligent, read-only dashboard Q&A.

Flow (never the reverse):
    question
    -> intent router          (classify_intent)
    -> period extraction      (extract_period: "April 2026" -> month=4, year=2026)
    -> verified data retrieval (reuse kpi_query_service — the dashboard builders)
    -> optional MR description theme classification (deterministic keyword themes)
    -> verified context JSON
    -> Ollama explanation (or rule-based fallback)
    -> structured chat answer

Numbers ALWAYS come from the verified backend functions; the LLM only writes
wording. The question period overrides the dashboard filter. Read-only.
"""

from __future__ import annotations

import calendar
import json
import os
import re
from collections import Counter
from datetime import datetime

from ...core import context as ctx
from ...services import kpi_query_service as kpi
from ... import config
from ...providers import generate_with_ollama, get_provider_status, OllamaMiraProvider

# Local analysis store for AI-suggested MR description theme tags. Lives under the
# gitignored data/ dir — NEVER written back to source Excel / D365 / SharePoint.
_TAGS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))),
    "data", "mira_description_tags.json",
)

# ── Intent routing (ordered; first match wins, specific first) ──────────────────
_INTENT_RULES = [
    ("recurring_issue_query", ("recurring", "repeated", "repeat issue", "keeps happening",
                               "again and again", "same problem")),
    ("fault_theme_query", ("most common fault", "common fault", "common issue", "main fault",
                           "main issue", "fault pattern", "fault theme", "type of fault",
                           "type of issue", "cause of breakdown", "main cause", "root cause",
                           "misuse", "operation related", "operation-related", "what is the most common")),
    ("pm_overdue_query", ("overdue pm", "pm overdue", "overdue preventive", "pm tasks overdue",
                          "which pm", "overdue maintenance")),
    ("backlog_query", ("backlog",)),
    ("pm_summary", ("pm compliance", "pm issue", "pm issues", "pm status", "preventive maintenance",
                    "pm schedule", "main pm", "pm performance", "compliance")),
    ("spare_parts_consumption_query", ("highest consumption", "most consumed", "top consumed",
                                       "consumed spare", "spare consumption", "spare part consumption",
                                       "consumption")),
    ("spare_parts_summary", ("spare part", "spare parts", "inventory", "in-stock", "in stock")),
    ("top_functional_location_query", ("functional location", "highest workload", "which area",
                                       "which location", "location workload", "area workload",
                                       "worst machine group", "machine group")),
    ("risk_insight_query", ("risk", "need attention", "needs attention", "machines need attention",
                            "high risk", "asset risk", "which machines need", "attention list")),
    ("top_asset_query", ("most mr", "most maintenance request", "which asset", "top asset",
                         "worst asset", "asset with most", "machine with most", "which machine")),
    ("open_mr_query", ("open mr", "still open", "outstanding mr", "open work order", "top open",
                       "unresolved", "open maintenance")),
    ("follow_up_query", ("follow up", "follow-up", "followup", "today", "what should",
                         "action items", "priorities", "to do")),
    ("report_wording_query", ("one-line", "one line", "monthly report", "report summary",
                              "report sentence", "headline", "executive sentence")),
    ("downtime_summary", ("mttr", "mtbf", "downtime", "closure rate", "work order", "closure",
                          "wo created", "carry-over", "carry over")),
    ("maintenance_summary", ("summarise", "summarize", "summary", "performance", "overview",
                             "how are we doing", "this month", "report")),
]
_DEFAULT_INTENT = "maintenance_summary"


def classify_intent(question: str | None) -> str:
    text = (question or "").strip().lower()
    if not text:
        return _DEFAULT_INTENT
    for intent, keywords in _INTENT_RULES:
        if any(kw in text for kw in keywords):
            return intent
    return _DEFAULT_INTENT


# ── Period extraction ───────────────────────────────────────────────────────────
_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
_MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})


def extract_period(question: str | None) -> dict:
    """Pull an explicit period from the question. Empty dict -> use base filters.

    Returns keys among {year, month, _ytd, _fy} (month=None means an explicit YTD).
    """
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
    if "last month" in text or "previous month" in text:
        prev_m = now.month - 1 or 12
        out["month"] = prev_m
        out["year"] = now.year if now.month > 1 else now.year - 1
    elif "this month" in text or "current month" in text:
        out["month"] = now.month
        out.setdefault("year", now.year)
    return out


def resolve_filters(question: str, base_filters: dict | None) -> dict:
    """Merge base (dashboard) filters with the question period (question wins)."""
    base = ctx.normalize_filters(base_filters)
    period = extract_period(question)
    merged = dict(base)
    if "year" in period:
        merged["year"] = period["year"]
    if "month" in period:                       # may be None for explicit YTD
        merged["month"] = period["month"]
    return ctx.normalize_filters(merged)


# ── Deterministic MR description theme classification ───────────────────────────
# Backend (not LLM) computes the counts so numbers are never invented. Themes are
# AI-suggested/keyword-based and must be confirmed by engineering review.
_THEME_PATTERNS = [
    ("Refrigeration / Cooling Issue", (r"refriger", r"\bcooling\b", r"\bcompressor\b", r"\bfreezer\b",
                                       r"\bchiller\b", r"\bcondenser\b", r"\bevaporator\b", r"\bcold room\b",
                                       r"\btemperature\b", r"\bdefrost\b")),
    ("Sensor / Instrumentation Issue", (r"\bsensor\b", r"\bprobe\b", r"\btransmitter\b", r"\bgauge\b",
                                        r"calibrat", r"instrument", r"\breading\b", r"\bmeter\b")),
    ("Electrical Fault", (r"electric", r"\bwiring\b", r"\bvoltage\b", r"\bpower\b", r"\bcircuit\b",
                          r"\bmotor\b", r"\bcontactor\b", r"\bfuse\b", r"short circuit", r"\bpanel\b",
                          r"\brelay\b", r"\binverter\b")),
    ("Cleaning-Related Issue", (r"\bclean", r"\bhygiene\b", r"sanitat", r"\bwash\b")),
    ("Spare-Part-Related Issue", (r"\bspare\b", r"\breplace", r"\bworn\b", r"\bbearing\b", r"\bseal\b",
                                  r"\bbelt\b", r"\bgasket\b", r"\bo-ring\b")),
    ("PM-Related Issue", (r"\bpm\b", r"\bpreventive\b", r"scheduled maintenance", r"\binspection\b")),
    ("Facility / Building Issue", (r"\bbuilding\b", r"\bdoor\b", r"\bfloor\b", r"\broof\b", r"\bwall\b",
                                   r"\blight\b", r"\bfacility\b", r"\bceiling\b")),
    ("Utility Issue", (r"\bwater\b", r"\bsteam\b", r"\bboiler\b", r"air compressor", r"\bgas\b",
                       r"\butility\b", r"\bpump\b", r"\bvalve\b", r"\bdrain\b")),
    ("Possible Operation-Related Issue", (r"\bmisuse\b", r"\bwrong\b", r"improper", r"\boperator\b",
                                          r"\bhandling\b", r"\boverload\b", r"not follow", r"incorrect")),
    ("Mechanical Fault", (r"mechanic", r"\bjam\b", r"abnormal sound", r"\bnoise\b", r"vibrat", r"\bleak",
                          r"\bbroken\b", r"\bcrack", r"\bgear\b", r"\bchain\b", r"\bshaft\b", r"movement",
                          r"\bstuck\b", r"\bblock", r"\bdamage")),
]
_THEME_COMPILED = [(name, [re.compile(p, re.IGNORECASE) for p in pats]) for name, pats in _THEME_PATTERNS]
_UNKNOWN_THEME = "Unknown / Insufficient Information"


def _row_description(row: dict) -> str:
    return str(
        row.get("translated_description") or row.get("description")
        or row.get("description_original") or ""
    ).strip()


def classify_theme(text: str) -> str:
    blob = str(text or "").strip()
    if len(blob) < 5:
        return _UNKNOWN_THEME
    for name, patterns in _THEME_COMPILED:
        if any(p.search(blob) for p in patterns):
            return name
    return _UNKNOWN_THEME


def _persist_description_tags(classified: list, f: dict) -> int:
    """Best-effort: store AI-suggested theme tags in a LOCAL analysis file.

    Only the allowed fields are saved (MR/WO, asset id/name, functional location, a
    short description snippet, suggested theme). Never written to source Excel/D365.
    """
    try:
        os.makedirs(os.path.dirname(_TAGS_PATH), exist_ok=True)
        store = {}
        if os.path.exists(_TAGS_PATH):
            try:
                with open(_TAGS_PATH, encoding="utf-8") as fh:
                    store = json.load(fh) or {}
            except Exception:
                store = {}
        period = ctx.month_label(f)
        now = datetime.now().isoformat(timespec="seconds")
        for theme, row, desc in classified:
            mr_wo = str(row.get("work_order_id") or row.get("request_id") or "").strip()
            asset_id = str(row.get("asset_id") or "").strip()
            key = f"{mr_wo or asset_id or 'NA'}|{desc[:24]}"
            if key.strip("|") in ("", "NA"):
                continue
            store[key] = {
                "mr_wo": mr_wo, "asset_id": asset_id,
                "asset_name": str(row.get("machine_name") or "").strip(),
                "functional_location": str(row.get("raw_functional_location") or "").strip(),
                "description_snippet": re.sub(r"\s+", " ", desc)[:120],
                "suggested_theme": theme, "period": period, "classified_at": now,
                "source": "MIRA keyword classifier (AI-suggested; confirm by engineering review)",
            }
        if len(store) > 5000:  # keep the most recent
            store = dict(sorted(store.items(), key=lambda kv: kv[1].get("classified_at", ""), reverse=True)[:5000])
        tmp = _TAGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(store, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, _TAGS_PATH)
        return len(store)
    except Exception:
        return 0  # persistence is best-effort; never break the chat


def get_mr_description_theme_summary(filters: dict) -> dict:
    """Keyword-based MR description theme summary for the selected period."""
    f = ctx.normalize_filters(filters)
    rows = kpi._selected_period_work_order_rows(f)
    classified = []
    theme_counts: Counter[str] = Counter()
    for row in rows:
        desc = _row_description(row)
        theme = classify_theme(desc)
        theme_counts[theme] += 1
        classified.append((theme, row, desc))
    _persist_description_tags(classified, f)

    total_classified = sum(c for t, c in theme_counts.items() if t != _UNKNOWN_THEME)
    top = [(t, c) for t, c in theme_counts.most_common() if t != _UNKNOWN_THEME]
    top_theme, top_count = (top[0] if top else (None, 0))

    # Top asset + functional location for the dominant theme.
    top_asset = top_fl = None
    examples = []
    if top_theme:
        theme_rows = [(r, d) for (t, r, d) in classified if t == top_theme]
        a = Counter(str(r.get("machine_name") or r.get("asset_id") or "Unknown").strip() for r, _ in theme_rows)
        fl = Counter(str(r.get("raw_functional_location") or "Unspecified").strip() for r, _ in theme_rows)
        top_asset = a.most_common(1)[0][0] if a else None
        top_fl = fl.most_common(1)[0][0] if fl else None
        # Short, de-identified example snippets (no names/PO/cost — descriptions only).
        for _, d in theme_rows[:3]:
            snippet = re.sub(r"\s+", " ", d)[:90]
            if snippet:
                examples.append(snippet)

    pct = round((top_count / len(rows)) * 100, 1) if rows and top_count else None
    return {
        "period": ctx.month_label(f),
        "rows_loaded": len(rows),
        "classified_descriptions": total_classified,
        "unknown_count": theme_counts.get(_UNKNOWN_THEME, 0),
        "top_theme": top_theme,
        "top_theme_count": top_count,
        "top_theme_pct": pct,
        "top_theme_asset": top_asset,
        "top_theme_functional_location": top_fl,
        "theme_breakdown": [{"theme": t, "count": c} for t, c in theme_counts.most_common()],
        "example_descriptions": examples,
        "note": "These are AI-suggested / keyword-based classifications of MR descriptions. "
                "Final root cause should be confirmed by engineering review.",
        "source": "downtime MR descriptions (selected period)",
    }


# ── Per-intent verified context ─────────────────────────────────────────────────
def _fmt(v):
    if v is None:
        return "unavailable"
    if isinstance(v, float):
        return f"{v:g}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def build_context(intent: str, f: dict, question: str) -> dict:
    """Return {context, key_numbers, follow_up, theme, view_data_used} for an intent."""
    period = ctx.month_label(f)
    out = {"intent": intent, "period": period, "key_numbers": [], "follow_up": [],
           "theme": None, "context": {}, "view_data_used": None, "warnings": []}

    if intent in ("maintenance_summary",):
        mr = kpi.get_mr_activity_summary(f)
        pm = kpi.get_verified_pm_metrics(f)["metrics"]
        sp = kpi.get_spare_parts_summary(f)
        out["context"] = {"downtime": mr, "pm": pm, "spare": sp}
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr['mr_raised'])}", f"Open/In Progress: {_fmt(mr['open_count'])}",
            f"Closed/Confirmed: {_fmt(mr['closed_count'])}", f"Closure Rate: {_fmt(mr['closure_rate_pct'])}%",
            f"Carry-over Open MR: {_fmt(mr['carry_over_open_mr'])}", f"Total Active Workload: {_fmt(mr['total_active_workload'])}",
            f"Preventive/Corrective: {_fmt(mr['preventive_count'])}/{_fmt(mr['corrective_count'])}",
            f"PM Compliance: {_fmt(pm['pm_compliance_percent'])}%", f"PM Overdue: {_fmt(pm['overdue_pm'])}",
        ]
        out["follow_up"] = _follow_up(mr, pm)
        out["warnings"] = kpi.get_verified_pm_metrics(f)["data_quality"]["warnings"]

    elif intent == "downtime_summary":
        mr = kpi.get_mr_activity_summary(f)
        out["context"] = {"downtime": mr}
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr['mr_raised'])}", f"Open: {_fmt(mr['open_count'])}",
            f"Closed: {_fmt(mr['closed_count'])}", f"Closure Rate: {_fmt(mr['closure_rate_pct'])}%",
            f"Carry-over Open: {_fmt(mr['carry_over_open_mr'])}", f"Total Active: {_fmt(mr['total_active_workload'])}",
            f"Preventive/Corrective: {_fmt(mr['preventive_count'])}/{_fmt(mr['corrective_count'])}",
        ]
        out["follow_up"] = [f"Review {_fmt(mr['open_count'])} open/in-progress MR."] if mr["open_count"] else []

    elif intent in ("pm_summary", "pm_overdue_query", "backlog_query"):
        v = kpi.get_verified_pm_metrics(f)
        pm = v["metrics"]
        out["context"] = {"pm": pm, "data_quality": v["data_quality"]}
        out["key_numbers"] = [
            f"PM Scheduled: {_fmt(pm['scheduled_pm'])}", f"PM Completed: {_fmt(pm['completed_pm'])}",
            f"PM Overdue: {_fmt(pm['overdue_pm'])}", f"PM Backlog: {_fmt(pm['backlog_pm'])}",
            f"PM Compliance: {_fmt(pm['pm_compliance_percent'])}%",
        ]
        out["warnings"] = v["data_quality"]["warnings"]
        if pm["overdue_pm"]:
            out["follow_up"].append(f"Action {_fmt(pm['overdue_pm'])} overdue PM tasks for {period}.")

    elif intent in ("spare_parts_summary", "spare_parts_consumption_query"):
        sp = kpi.get_spare_parts_summary(f)
        out["context"] = {"spare": sp}
        out["key_numbers"] = [
            f"In-stock Spare Parts: {_fmt(sp.get('current_in_stock_items'))}",
            f"In-stock Value: {_fmt(sp.get('current_in_stock_value'))}",
            f"Drawn from Store: {_fmt(sp.get('drawn_from_store_value'))}",
            f"Non-Stock: {_fmt(sp.get('non_stock_value'))}", f"Services: {_fmt(sp.get('services_value'))}",
            f"Top Consumed Part: {_fmt(sp.get('top_consumed_part'))}",
            f"YoY Consumption: {_fmt(sp.get('yoy_consumption_pct'))}%",
        ]
        out["warnings"] = sp.get("data_notes") or []

    elif intent in ("top_asset_query",):
        mr = kpi.get_mr_activity_summary(f)
        out["context"] = {"top_recorded_asset": {"name": mr["top_recorded_asset_name"],
                                                  "count": mr["top_recorded_asset_count"],
                                                  "is_placeholder": mr["top_recorded_asset_is_placeholder"]},
                          "top_actual_machine_asset": {"name": mr["top_actual_machine_asset_name"],
                                                       "count": mr["top_actual_machine_asset_count"]}}
        out["key_numbers"] = [
            f"Top Recorded Asset/Area: {_fmt(mr['top_recorded_asset_name'])} ({_fmt(mr['top_recorded_asset_count'])} MR)"
            + (" — general area/placeholder" if mr["top_recorded_asset_is_placeholder"] else ""),
            f"Top Actual Machine Asset: {_fmt(mr['top_actual_machine_asset_name'])} ({_fmt(mr['top_actual_machine_asset_count'])} MR)",
        ]

    elif intent == "top_functional_location_query":
        mr = kpi.get_mr_activity_summary(f)
        out["context"] = {"top_functional_location": mr["top_functional_location_name"],
                          "count": mr["top_functional_location_count"]}
        out["key_numbers"] = [f"Top Functional Location: {_fmt(mr['top_functional_location_name'])} "
                              f"({_fmt(mr['top_functional_location_count'])} MR)"]

    elif intent == "open_mr_query":
        mr = kpi.get_mr_activity_summary(f)
        out["context"] = {"open": mr["open_count"], "in_progress": mr["in_progress_count"],
                          "new": mr["new_count"], "carry_over": mr["carry_over_open_mr"]}
        out["key_numbers"] = [
            f"Open / In Progress: {_fmt(mr['open_count'])}",
            f"In Progress: {_fmt(mr['in_progress_count'])} · New: {_fmt(mr['new_count'])}",
            f"Carry-over Open MR: {_fmt(mr['carry_over_open_mr'])}",
        ]
        out["follow_up"] = [f"Review {_fmt(mr['open_count'])} open MR and {_fmt(mr['carry_over_open_mr'])} carry-over."]

    elif intent in ("fault_theme_query", "recurring_issue_query", "possible_operation_related_query"):
        theme = get_mr_description_theme_summary(f)
        out["theme"] = theme
        out["context"] = {"theme_analysis": theme}
        if theme["top_theme"]:
            out["key_numbers"] = [
                f"Top Fault Theme: {theme['top_theme']}",
                f"Count: {_fmt(theme['top_theme_count'])} of {_fmt(theme['rows_loaded'])} MR ({_fmt(theme['top_theme_pct'])}%)",
                f"Top Related Asset: {_fmt(theme['top_theme_asset'])}",
                f"Top Related Functional Location: {_fmt(theme['top_theme_functional_location'])}",
            ]
        else:
            out["warnings"] = ["MR description analysis is unavailable for the selected period."]
        out["follow_up"] = ["Engineering review recommended to confirm the actual root cause."]

    elif intent == "follow_up_query":
        mr = kpi.get_mr_activity_summary(f)
        pm = kpi.get_verified_pm_metrics(f)["metrics"]
        out["context"] = {"downtime": mr, "pm": pm}
        out["key_numbers"] = [
            f"Open MR: {_fmt(mr['open_count'])}", f"Carry-over Open: {_fmt(mr['carry_over_open_mr'])}",
            f"PM Overdue: {_fmt(pm['overdue_pm'])}", f"PM Backlog: {_fmt(pm['backlog_pm'])}",
            f"Missing Asset ID: {_fmt(mr['missing_asset_count'])}",
        ]
        out["follow_up"] = _follow_up(mr, pm)

    elif intent == "risk_insight_query":
        from . import risk_service  # lazy: risk_service imports this module
        risk = risk_service.get_asset_risk_insights(f)
        out["context"] = {"risk": risk}
        out["risk"] = risk
        out["key_numbers"] = [
            f"High Attention assets: {risk['high_attention_count']}",
            f"Medium Attention assets: {risk['medium_attention_count']}",
            f"Assets assessed: {risk['assets_assessed']}",
        ]
        for a in risk["top_assets"][:3]:
            out["key_numbers"].append(
                f"{a['asset_name']}: risk {a['risk_score']} ({a['risk_level']}, {a['mr_count']} MR)")
        out["follow_up"] = ["Review high-attention assets with engineering; risk is a follow-up signal, not a failure prediction."]
        out["warnings"] = risk.get("data_notes", [])

    elif intent == "report_wording_query":
        mr = kpi.get_mr_activity_summary(f)
        pm = kpi.get_verified_pm_metrics(f)["metrics"]
        out["context"] = {"downtime": mr, "pm": pm}
        out["key_numbers"] = [
            f"MR Raised: {_fmt(mr['mr_raised'])}", f"Closed: {_fmt(mr['closed_count'])}",
            f"Closure Rate: {_fmt(mr['closure_rate_pct'])}%", f"PM Compliance: {_fmt(pm['pm_compliance_percent'])}%",
        ]

    else:  # general_dashboard_help / fallback
        out["intent"] = "general_dashboard_help"
        out["context"] = {"help": "Ask about downtime/MR, PM schedule, spare parts, top assets, "
                                  "functional locations, open MR, overdue PM, fault themes, or follow-ups."}

    out["view_data_used"] = _view_data_used(intent, f, out["warnings"])
    return out


def _follow_up(mr: dict, pm: dict) -> list[str]:
    items = []
    if mr.get("open_count"):
        items.append(f"Review {_fmt(mr['open_count'])} open/in-progress MR (incl. {_fmt(mr.get('carry_over_open_mr'))} carry-over).")
    if pm.get("overdue_pm"):
        items.append(f"Action {_fmt(pm['overdue_pm'])} overdue PM tasks.")
    if mr.get("missing_asset_count"):
        items.append(f"Correct {_fmt(mr['missing_asset_count'])} MR records missing Asset ID.")
    if mr.get("general_area_asset_count"):
        items.append(f"Reclassify {_fmt(mr['general_area_asset_count'])} MR logged to general area/placeholder assets.")
    return items[:5]


def _view_data_used(intent: str, f: dict, warnings: list) -> dict:
    return {
        "source_tables": ["Downtime MR/WO rows", "PM schedule payload", "Spare parts payload"],
        "filters_applied": [f"Period: {ctx.month_label(f)}", f"Stage: {f.get('stage')}",
                            f"Asset category: {f.get('mainAssetGroup') or 'All'}"],
        "data_warnings": warnings or [],
        "last_refreshed": datetime.now().astimezone().strftime("%d %b %Y, %I:%M %p"),
        "intent": intent,
    }


# ── Answer generation (Ollama or rule-based) ────────────────────────────────────
_CHAT_SYSTEM_PROMPT = (
    "You are MIRA, a read-only Maintenance Intelligence and Reporting Assistant. You answer "
    "questions using only the verified dashboard data and records provided in the context JSON. "
    "Do not invent numbers. Do not estimate missing values. Do not claim a root cause unless the "
    "description data clearly supports it. For fault or cause analysis, use cautious wording such as "
    "'suggests', 'indicates', or 'may be related to'. Use 'Possible Operation-Related Issue' instead "
    "of blaming terms such as misuse. Keep answers concise, professional, and suitable for "
    "engineering management."
)


def _rule_based_answer(intent: str, period: str, ctxd: dict, key_numbers: list, theme: dict | None) -> str:
    risk = ctxd.get("risk") if isinstance(ctxd, dict) else None
    if risk:
        top = risk["top_assets"][0] if risk.get("top_assets") else None
        if top:
            return (f"For {period}, {risk['high_attention_count']} asset(s) are High Attention and "
                    f"{risk['medium_attention_count']} Medium Attention. The highest is {top['asset_name']} "
                    f"(risk score {top['risk_score']}, {top['mr_count']} MR), which may require closer follow-up "
                    "based on work-order frequency, severity, recurrence and overdue PM. This is a risk signal "
                    "for engineering review, not a failure prediction.")
        return f"No assets crossed the risk threshold for {period}."
    if theme and theme.get("top_theme"):
        return (f"The most common issue theme in {period} is {theme['top_theme']}, based on "
                f"{theme['top_theme_count']} of {theme['rows_loaded']} classified MR descriptions "
                f"({theme['top_theme_pct']}%). The highest concentration is from {theme['top_theme_asset']}"
                + (f" at {theme['top_theme_functional_location']}" if theme.get('top_theme_functional_location') else "")
                + ". This suggests a recurring pattern; engineering review is recommended to confirm the actual root cause.")
    if key_numbers:
        return f"For {period}: " + "; ".join(key_numbers[:5]) + "."
    return f"No verified data was available for {period}."


def answer(question: str, base_filters: dict | None) -> dict:
    intent = classify_intent(question)
    f = resolve_filters(question, base_filters)
    built = build_context(intent, f, question)

    period = built["period"]
    rule_text = _rule_based_answer(built["intent"], period, built["context"],
                                   built["key_numbers"], built["theme"])

    provider = OllamaMiraProvider()
    used_llm = False
    answer_text = rule_text
    if config.PROVIDER_MODE in ("auto", "ollama") and provider.resolve_model():
        try:
            import json
            # COMPACT context only — the key_numbers already hold every verified figure.
            # Sending the full nested dicts bloats the prompt and makes inference very slow.
            compact = {
                "question": question, "intent": built["intent"], "period": period,
                "verified_key_numbers": built["key_numbers"],
                "recommended_follow_up": built["follow_up"],
                "data_warnings": built["warnings"],
            }
            if built["theme"] and built["theme"].get("top_theme"):
                t = built["theme"]
                compact["fault_theme"] = {
                    "top_theme": t["top_theme"], "count": t["top_theme_count"], "total": t["rows_loaded"],
                    "pct": t["top_theme_pct"], "top_asset": t["top_theme_asset"],
                    "top_location": t["top_theme_functional_location"], "examples": t["example_descriptions"],
                }
            ctx_json = json.dumps(compact, default=str, ensure_ascii=False)
            user_prompt = (
                f'Answer this question: "{question}"\n\n'
                "Use ONLY the verified figures in the JSON below; never introduce a number not present in it. "
                "If a value is unavailable, say so. Keep it concise (2-4 sentences). For fault themes use "
                "cautious wording (suggests/indicates) and recommend engineering review.\n\n"
                f"VERIFIED_CONTEXT_JSON:\n{ctx_json}\n"
            )
            llm = generate_with_ollama(
                _CHAT_SYSTEM_PROMPT, user_prompt, model=provider.resolve_model(), timeout=60,
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
        "filters": f,
        "answer": answer_text,
        "key_numbers_used": built["key_numbers"],
        "recommended_follow_up": built["follow_up"],
        "view_data_used": built["view_data_used"],
        "provider": "ollama" if used_llm else "rule_based",
        "provider_status": status["status"],
        "llm_active": used_llm,
        "read_only": True,
    }
    if built["theme"]:
        result["theme_analysis"] = built["theme"]
    if built.get("risk"):
        result["risk_insights"] = built["risk"]
    return result
