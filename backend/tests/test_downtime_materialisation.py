"""Phase 7 — WO-derived proxy downtime materialisation (idempotent, safe supersede)."""

import datetime as dt
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
import downtime_materialisation as dm


def _fresh_db(tmp_path):
    db.DB_PATH = pathlib.Path(str(tmp_path / "t.db"))
    with db.get_connection() as conn:
        conn.executescript(db._SCHEMA_SQL)
        for col in ("source_work_order_id", "last_synced_at"):
            try:
                conn.execute(f"ALTER TABLE downtime_event ADD COLUMN {col} TEXT")
            except Exception:
                pass
    return db.DB_PATH


def _wo(asset, start, end, wid, job="CORRECTIVE"):
    return {"asset_id": asset, "stage": "Stage 2", "actual_start_time": start,
            "actual_end_time": end, "work_order_id": wid, "job_type": job,
            "updated_at": "2026-07-30T00:00:00"}


def _src(records):
    return {"records": records, "last_synced": "2026-07-31T00:00:00"}


def test_bounded_intervals_materialise_open_ones_skip(tmp_path):
    _fresh_db(tmp_path)
    src = _src([_wo("A-1", "2026-07-10T08:00:00", "2026-07-10T10:00:00", "W1"),
                _wo("A-1", "2026-07-11T11:00:00", None, "W2")])          # open → skipped
    res = dm.materialise_proxy_downtime(source=src, now=dt.datetime(2026, 8, 1))
    assert res["materialised_intervals"] == 1 and res["upserted"] == 1
    rows = db.query_downtime_events()
    assert len(rows) == 1
    row = rows[0]
    assert row["confirmed_unavailable"] == 0
    assert row["availability_confidence"] == "proxy"
    assert row["confirmation_source"] == "work_order"
    assert row["source_work_order_id"] == "W1"
    assert row["classification"] == "unplanned"


def test_materialisation_is_idempotent(tmp_path):
    _fresh_db(tmp_path)
    src = _src([_wo("A-1", "2026-07-10T08:00:00", "2026-07-10T10:00:00", "W1")])
    dm.materialise_proxy_downtime(source=src, now=dt.datetime(2026, 8, 1))
    dm.materialise_proxy_downtime(source=src, now=dt.datetime(2026, 8, 2))
    assert len(db.query_downtime_events()) == 1        # no duplicate on the stable key


def test_stale_proxy_is_superseded(tmp_path):
    _fresh_db(tmp_path)
    dm.materialise_proxy_downtime(
        source=_src([_wo("A-1", "2026-07-10T08:00:00", "2026-07-10T10:00:00", "W1")]),
        now=dt.datetime(2026, 8, 1))
    # next run no longer contains W1 → its proxy row must be superseded.
    res = dm.materialise_proxy_downtime(source=_src([]), now=dt.datetime(2026, 8, 2))
    assert res["superseded"] == 1
    assert db.query_downtime_events() == []


def test_verified_event_is_never_overwritten_or_superseded(tmp_path):
    _fresh_db(tmp_path)
    # A manually verified event sharing the WO-derived key.
    with db.get_connection() as conn:
        conn.execute(
            "INSERT INTO downtime_event (asset_id, downtime_start, wo_number, "
            "confirmed_unavailable, availability_confidence, confirmation_source) "
            "VALUES ('A-1', '2026-07-10T08:00:00', 'W1', 1, 'verified', 'manual')")
    dm.materialise_proxy_downtime(
        source=_src([_wo("A-1", "2026-07-10T08:00:00", "2026-07-10T10:00:00", "W1")]),
        now=dt.datetime(2026, 8, 1))
    rows = db.query_downtime_events()
    assert len(rows) == 1
    assert rows[0]["confirmation_source"] == "manual"       # not overwritten by proxy
    assert rows[0]["confirmed_unavailable"] == 1
    # a later run with the WO gone must not delete the verified row either
    dm.materialise_proxy_downtime(source=_src([]), now=dt.datetime(2026, 8, 3))
    assert len(db.query_downtime_events()) == 1
