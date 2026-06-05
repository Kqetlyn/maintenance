"""
Filter / context resolution for MIRA.

Normalises the public MIRA filter object and maps it onto the parameters the
existing dashboard builders already expect. This is the ONLY place that decides
how a (stage, year, month) filter becomes a downtime "period", a PM month, etc.,
so every MIRA function targets the same window the dashboard would.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime

# Public filter keys MIRA accepts (camelCase, matching the dashboard / spec).
FILTER_KEYS = (
    "stage", "year", "month",
    "assetId", "assetName", "mainAssetGroup", "subAssetGroup",
    "maintenanceType", "status", "mappingStatus",
)

_STAGE_ALIASES = {
    "all": "all", "": "all", "none": "all",
    "stage1": "stage1", "stage 1": "stage1", "s1": "stage1", "1": "stage1",
    "stage2": "stage2", "stage 2": "stage2", "s2": "stage2", "2": "stage2",
}


def _to_int(value):
    try:
        if value in (None, "", "all"):
            return None
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _parse_month(value):
    """Accept 6, '6', '06', 'June', or '2026-06' -> month int 1..12 (or None)."""
    if value in (None, "", "all"):
        return None
    text = str(value).strip()
    if "-" in text:  # 'YYYY-MM'
        parts = text.split("-")
        if len(parts) >= 2:
            return _to_int(parts[1])
    as_int = _to_int(text)
    if as_int and 1 <= as_int <= 12:
        return as_int
    for idx, name in enumerate(calendar.month_name):
        if name and name.lower().startswith(text.lower()[:3]):
            return idx
    return None


def normalize_filters(raw: dict | None) -> dict:
    """Return a clean filter dict with safe defaults. Never raises."""
    raw = raw or {}
    stage = _STAGE_ALIASES.get(str(raw.get("stage", "all")).strip().lower(), "all")
    year = _to_int(raw.get("year"))
    month = _parse_month(raw.get("month"))
    today = datetime.now()
    if year is None:
        year = today.year

    def clean(key):
        val = raw.get(key)
        if val in (None, "", "all"):
            return None
        return str(val).strip()

    return {
        "stage": stage,
        "year": year,
        "month": month,                      # int 1..12 or None
        "assetId": clean("assetId"),
        "assetName": clean("assetName"),
        "mainAssetGroup": clean("mainAssetGroup"),
        "subAssetGroup": clean("subAssetGroup"),
        "maintenanceType": clean("maintenanceType"),
        "status": clean("status"),
        "mappingStatus": clean("mappingStatus"),
    }


def resolved_window(filters: dict) -> dict:
    """Resolved calendar window for presentation and non-downtime summaries."""
    year = int(filters["year"])
    month = filters.get("month")
    today = datetime.now().date()
    if month:
        last_day = calendar.monthrange(year, month)[1]
        return {
            "mode": "month",
            "label": f"{calendar.month_name[month]} {year}",
            "start_date": date(year, month, 1),
            "end_date": date(year, month, last_day),
        }
    if year == today.year:
        return {
            "mode": "ytd",
            "label": f"YTD {year}",
            "start_date": date(year, 1, 1),
            "end_date": today,
        }
    return {
        "mode": "full_year",
        "label": f"Full Year {year}",
        "start_date": date(year, 1, 1),
        "end_date": date(year, 12, calendar.monthrange(year, 12)[1]),
    }


def month_label(filters: dict) -> str:
    """Human label for the resolved window, e.g. 'June 2026' or 'Full Year 2025'."""
    return resolved_window(filters)["label"]


def month_value(filters: dict) -> str | None:
    """'YYYY-MM' string for builders that key on a month, else None."""
    if filters.get("month"):
        return f"{filters['year']}-{filters['month']:02d}"
    return None


def resolve_downtime_period(filters: dict) -> dict:
    """Map MIRA filters onto build_downtime_payload(period, month, start, end)."""
    year = filters["year"]
    today = datetime.now()
    if filters.get("month"):
        return {"period": "this_month", "month": month_value(filters), "start": None, "end": None}
    if year == today.year:
        return {"period": "ytd", "month": None, "start": None, "end": None}
    if year == today.year - 1:
        return {"period": "previous_year", "month": None, "start": None, "end": None}
    # Any other explicit year -> a custom full-year window.
    last_day = calendar.monthrange(year, 12)[1]
    return {
        "period": "custom",
        "month": None,
        "start": f"{year}-01-01",
        "end": f"{year}-12-{last_day:02d}",
    }
