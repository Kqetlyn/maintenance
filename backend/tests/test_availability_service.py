"""Phase 1 — pure availability interval algebra (no DB / no Flask)."""

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import availability_service as A


def _w(h, m=0):
    return dt.datetime(2026, 8, 10, h, m)


def _wo(start, end, wid):
    return {"actual_start_time": start, "actual_end_time": end, "work_order_id": wid}


def test_overlapping_intervals_merge_not_summed():
    # 08:00-10:00 + 09:00-11:00 => 08:00-11:00 = 180 min, not 240.
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[_wo("2026-08-10T08:00:00", "2026-08-10T10:00:00", "WO1"),
                     _wo("2026-08-10T09:00:00", "2026-08-10T11:00:00", "WO2")])
    assert r["proxy_downtime_minutes"] == 180.0
    assert r["confirmed_downtime_minutes"] == 0.0


def test_adjacent_intervals_merge():
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[_wo("2026-08-10T08:00:00", "2026-08-10T10:00:00", "A"),
                     _wo("2026-08-10T10:00:00", "2026-08-10T11:00:00", "B")])
    assert r["proxy_downtime_minutes"] == 180.0


def test_downtime_outside_window_is_clipped():
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[_wo("2026-08-10T05:00:00", "2026-08-10T07:00:00", "C")])
    assert r["proxy_downtime_minutes"] == 60.0


def test_open_wo_never_counts_as_downtime():
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[_wo("2026-08-10T08:00:00", None, "OPEN")])
    assert r["proxy_downtime_minutes"] == 0.0
    assert r["open_work_orders_in_window"] == 1
    assert r["auto_block_eligible"] is False


def test_proxy_never_auto_blocks():
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[_wo("2026-08-10T08:00:00", "2026-08-10T12:00:00", "WO")])
    assert r["status"] == "available"
    assert r["availability_confidence"] == "proxy"
    assert r["auto_block_eligible"] is False


def test_confirmed_blocks_and_precedence_no_double_count():
    # confirmed verified 08:00-10:00 (120) overlaps proxy 09:00-11:00 -> proxy only = 60.
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        confirmed_events=[{"id": 7, "availability_confidence": "verified", "confirmed_unavailable": 1,
                           "unavailable_start": "2026-08-10T08:00:00", "unavailable_end": "2026-08-10T10:00:00",
                           "capacity_factor": 0.0, "wo_number": "WOX"}],
        work_orders=[_wo("2026-08-10T09:00:00", "2026-08-10T11:00:00", "WO2")])
    assert r["confirmed_downtime_minutes"] == 120.0
    assert r["proxy_downtime_minutes"] == 60.0
    assert r["status"] == "down"
    assert r["availability_confidence"] == "verified"
    assert r["auto_block_eligible"] is True


def test_partial_confirms_only_part_of_wo_interval():
    # partial confirmed 08:00-09:00 (60) inside a proxy WO 08:00-11:00 (180).
    # blocked = 60 confirmed; remaining 09:00-11:00 (120) stays proxy warning.
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        confirmed_events=[{"id": 1, "availability_confidence": "partial", "confirmed_unavailable": 1,
                           "unavailable_start": "2026-08-10T08:00:00", "unavailable_end": "2026-08-10T09:00:00",
                           "capacity_factor": 0.0, "wo_number": "W"}],
        work_orders=[_wo("2026-08-10T08:00:00", "2026-08-10T11:00:00", "W")])
    assert r["confirmed_downtime_minutes"] == 60.0
    assert r["proxy_downtime_minutes"] == 120.0
    assert r["availability_confidence"] == "partial"
    assert r["auto_block_eligible"] is True


def test_degraded_reduces_capacity_without_full_block():
    # 50% capacity for 120 min in an 8h window => lost 60 min => capacity_factor 0.875.
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        confirmed_events=[{"id": 2, "availability_confidence": "verified", "confirmed_unavailable": 1,
                           "unavailable_start": "2026-08-10T08:00:00", "unavailable_end": "2026-08-10T10:00:00",
                           "capacity_factor": 0.5, "wo_number": "D"}])
    assert r["status"] == "degraded"
    assert r["confirmed_downtime_minutes"] == 0.0
    assert r["capacity_factor"] == 0.875


def test_no_data_is_unknown():
    r = A.build_asset_availability(
        asset_id="T", facility_stage="Stage 1", window_start=_w(6), window_end=_w(14),
        work_orders=[], asset_known=False)
    assert r["status"] == "unknown"
    assert r["availability_confidence"] == "unknown"
