"""Pure availability interval algebra for the maintenance availability API.

No database or Flask imports live here. The API route loads work-order records,
confirmed ``downtime_event`` rows and PM context (reusing the existing validated
services) and passes them in; this module contributes only the interval algebra:
clip → merge (overlapping OR adjacent) → confidence-precedence overlap handling.

Rules encoded (confirmed 2026-08-06):
  * Merge overlapping or directly adjacent intervals per Asset ID *after* clipping
    to the requested window; retain every contributing WO/event id for traceability.
  * Confidence precedence: verified > partial > proxy > unknown.
  * ``confirmed_downtime_minutes`` counts verified/partial confirmed-unavailable
    minutes only; ``proxy_downtime_minutes`` is returned separately and never blocks.
  * When confirmed and proxy overlap, confirmed wins and the overlap is not
    double-counted (proxy minutes exclude any confirmed span).
  * Only verified/partial confirmed-unavailable intervals are auto-block eligible.
  * Timestamps are treated as factory-local wall-clock: any tzinfo is dropped so
    naive planner windows and naive WO times compare consistently.
"""

from __future__ import annotations

import datetime as dt

_CONFIDENCE_RANK = {"verified": 3, "partial": 2, "proxy": 1, "unknown": 0}


def parse_dt(value):
    """Parse an ISO timestamp to a naive (factory-local) datetime, or None."""
    if value in (None, ""):
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def _naive(value):
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo else value


def clip(start, end, window_start, window_end):
    """Clip [start, end) to [window_start, window_end); None if empty/invalid."""
    if start is None or end is None:
        return None
    clipped_start = max(start, window_start)
    clipped_end = min(end, window_end)
    return (clipped_start, clipped_end) if clipped_end > clipped_start else None


def merge(intervals):
    """Merge overlapping OR directly adjacent (touching) intervals."""
    ordered = sorted((iv for iv in intervals if iv and iv[1] > iv[0]), key=lambda iv: iv[0])
    merged: list = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:          # overlap or touch
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def total_minutes(intervals):
    return round(sum((end - start).total_seconds() for start, end in intervals) / 60.0, 2)


def subtract(base, holes):
    """Return the merged ``base`` intervals with every ``holes`` span removed."""
    if not holes:
        return list(base)
    result: list = []
    for start, end in base:
        segments = [(start, end)]
        for hole_start, hole_end in holes:
            next_segments = []
            for seg_start, seg_end in segments:
                if hole_end <= seg_start or hole_start >= seg_end:
                    next_segments.append((seg_start, seg_end))
                    continue
                if seg_start < hole_start:
                    next_segments.append((seg_start, hole_start))
                if hole_end < seg_end:
                    next_segments.append((hole_end, seg_end))
            segments = next_segments
        result.extend(segments)
    return [iv for iv in result if iv[1] > iv[0]]


def _reason(status, confirmed_minutes, proxy_minutes, confidence, degraded, open_wo):
    if status == "down":
        return f"Confirmed unavailable for {confirmed_minutes:g} min within the window ({confidence})."
    if status == "degraded":
        return "Reduced-capacity operation confirmed for part of the window."
    if status == "pm_scheduled":
        return "Preventive maintenance is scheduled within the window."
    if status == "unknown":
        return "No confirmed or work-order interval was available to assess availability."
    if proxy_minutes > 0:
        return (f"No confirmed downtime; {proxy_minutes:g} min of proxy downtime derived from "
                f"work-order actual times (not confirmed, does not block).")
    if open_wo:
        return f"No confirmed downtime; {open_wo} open work order(s) without a confirmed end."
    return "No maintenance downtime overlapping the window."


def build_asset_availability(
    *, asset_id, facility_stage, window_start, window_end,
    confirmed_events=None, work_orders=None, pm=None, asset_known=True,
):
    """Compute the availability payload for one asset over one window.

    ``confirmed_events`` are ``downtime_event`` rows (verified/partial). ``work_orders``
    are maintenance WO records with ``actual_start_time`` / ``actual_end_time``.
    """
    confirmed_events = confirmed_events or []
    work_orders = work_orders or []
    pm = pm or {}
    window_start = _naive(window_start)
    window_end = _naive(window_end)
    window_minutes = round((window_end - window_start).total_seconds() / 60.0, 2) if window_end > window_start else 0.0

    warnings: list = []
    contributing: list = []

    # 1. Confirmed (verified/partial) intervals from downtime_event.
    down_intervals: list = []
    degraded: list = []
    best_confidence_rank = 0
    for event in confirmed_events:
        confidence = str(
            event.get("availability_confidence")
            or ("verified" if event.get("confirmed_unavailable") else "proxy")
        ).lower()
        if confidence not in ("verified", "partial"):
            continue
        start = parse_dt(event.get("unavailable_start") or event.get("downtime_start"))
        end = parse_dt(event.get("unavailable_end") or event.get("downtime_end"))
        if start is not None and end is None:      # open confirmed event → clip to window end
            end = window_end
        clipped = clip(start, end, window_start, window_end)
        if not clipped:
            continue
        capacity_factor = event.get("capacity_factor")
        capacity_factor = None if capacity_factor is None else float(capacity_factor)
        contributing.append({
            "source": "downtime_event", "confidence": confidence,
            "start": clipped[0].isoformat(), "end": clipped[1].isoformat(),
            "minutes": total_minutes([clipped]),
            "event_id": event.get("id"), "work_order_id": event.get("wo_number"),
            "capacity_factor": capacity_factor,
        })
        best_confidence_rank = max(best_confidence_rank, _CONFIDENCE_RANK[confidence])
        if capacity_factor is None or capacity_factor <= 0:
            down_intervals.append(clipped)
        elif capacity_factor < 1:
            degraded.append((clipped, capacity_factor))

    down_union = merge(down_intervals)
    confirmed_minutes = total_minutes(down_union)

    degraded_lost = 0.0
    degraded_present = False
    for clipped, capacity_factor in degraded:
        remaining = subtract([clipped], down_union)      # do not double-count fully-down time
        remaining_minutes = total_minutes(remaining)
        if remaining_minutes > 0:
            degraded_present = True
            degraded_lost += remaining_minutes * (1.0 - capacity_factor)

    # 2. Proxy intervals from bounded work orders (open WOs never contribute minutes).
    proxy_pairs: list = []
    open_wo = 0
    for work_order in work_orders:
        start = parse_dt(work_order.get("actual_start_time") or work_order.get("start_time"))
        end = parse_dt(work_order.get("actual_end_time") or work_order.get("end_time"))
        if start is not None and end is None:
            open_wo += 1
            continue
        clipped = clip(start, end, window_start, window_end)
        if not clipped:
            continue
        proxy_pairs.append((clipped, work_order.get("work_order_id")))
        contributing.append({
            "source": "work_order", "confidence": "proxy",
            "start": clipped[0].isoformat(), "end": clipped[1].isoformat(),
            "minutes": total_minutes([clipped]),
            "event_id": None, "work_order_id": work_order.get("work_order_id"),
            "capacity_factor": 0.0,
        })

    confirmed_all_union = merge(down_union + [clipped for clipped, _cf in degraded])
    proxy_union = subtract(merge([clipped for clipped, _wid in proxy_pairs]), confirmed_all_union)
    proxy_minutes = total_minutes(proxy_union)

    if open_wo:
        warnings.append(f"{open_wo} open work order(s) without a confirmed end; not counted as downtime.")
    if proxy_minutes > 0:
        warnings.append("Proxy downtime derived from work-order actual times; not confirmed and does not block equipment.")
    if degraded_present:
        warnings.append("Reduced-capacity (degraded) operation confirmed for part of the window.")

    # 3. Capacity, status, confidence.
    capacity_lost = confirmed_minutes + degraded_lost
    capacity_factor = 1.0 if window_minutes <= 0 else max(0.0, min(1.0, 1.0 - capacity_lost / window_minutes))
    has_confirmed = best_confidence_rank > 0

    pm_status = str(pm.get("pm_status") or "").lower()
    pm_due = pm.get("pm_due_date")
    pm_in_window = False
    if pm_due:
        try:
            due_date = dt.date.fromisoformat(str(pm_due)[:10])
            pm_in_window = window_start.date() <= due_date <= window_end.date()
        except ValueError:
            pm_in_window = False

    if confirmed_minutes > 0:
        status = "down"
    elif degraded_present:
        status = "degraded"
    elif pm_status in ("overdue", "due_soon", "scheduled") and pm_in_window:
        status = "pm_scheduled"
    elif has_confirmed or work_orders or asset_known:
        status = "available"
    else:
        status = "unknown"

    if has_confirmed:
        confidence = "verified" if best_confidence_rank == _CONFIDENCE_RANK["verified"] else "partial"
    elif work_orders:
        confidence = "proxy"
    else:
        confidence = "unknown"
    if status == "unknown":
        confidence = "unknown"

    return {
        "asset_id": asset_id,
        "facility_stage": facility_stage,
        "status": status,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "window_minutes": window_minutes,
        "confirmed_downtime_minutes": confirmed_minutes,
        "proxy_downtime_minutes": proxy_minutes,
        "capacity_factor": round(capacity_factor, 4),
        "availability_confidence": confidence,
        "auto_block_eligible": bool(confirmed_minutes > 0 or degraded_present),
        "overlapping_events": sorted(contributing, key=lambda entry: entry["start"]),
        "open_work_orders_in_window": open_wo,
        "next_pm_date": pm.get("pm_due_date"),
        "reason": _reason(status, confirmed_minutes, proxy_minutes, confidence, degraded_present, open_wo),
        "warnings": warnings,
    }


def split_by_day(start, end, from_date, to_date):
    """Yield (date_iso, day_start, day_end) clips of [start, end) per calendar day."""
    start = _naive(start)
    end = _naive(end)
    if start is None or end is None or end <= start:
        return
    day = max(start.date(), from_date)
    last = min((end - dt.timedelta(microseconds=1)).date(), to_date)
    while day <= last:
        day_start = max(start, dt.datetime.combine(day, dt.time.min))
        day_end = min(end, dt.datetime.combine(day, dt.time.max).replace(microsecond=0) + dt.timedelta(seconds=1))
        if day_end > day_start:
            yield day.isoformat(), day_start, day_end
        day += dt.timedelta(days=1)
