import datetime as dt
import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import downtime_service as downtime
import db
import powerbi_adapter


def _quality_flags(*, start=None, end=None, end_raw="", end_invalid=False):
    return downtime.build_work_order_quality_flags(
        status="Finished",
        request_created_raw="",
        request_created_time=None,
        request_created_invalid=False,
        actual_start_raw="" if start is None else start.isoformat(),
        actual_start_time=start,
        actual_start_invalid=False,
        actual_end_raw=end_raw or ("" if end is None else end.isoformat()),
        actual_end_time=end,
        actual_end_invalid=end_invalid,
        has_real_created_date=False,
    )


def test_finished_record_without_end_is_open_not_invalid():
    assert _quality_flags(start=dt.datetime(2026, 8, 1, 8)) == ["Valid"]
    assert downtime._pbi_derive_quality_flags(True, False, dt.datetime(2026, 8, 1, 8), None) == ["Valid"]


def test_d365_placeholder_end_is_open_not_invalid():
    placeholder = dt.datetime(1900, 1, 1)
    assert _quality_flags(start=dt.datetime(2026, 8, 1, 8), end=placeholder) == ["Valid"]
    assert downtime._pbi_derive_quality_flags(True, False, dt.datetime(2026, 8, 1, 8), placeholder) == ["Valid"]


def test_real_inverted_end_date_remains_a_reliability_issue():
    flags = _quality_flags(
        start=dt.datetime(2026, 8, 2, 8),
        end=dt.datetime(2026, 8, 1, 8),
    )
    assert "Finished date before start date" in flags


def test_powerbi_blank_end_is_open_and_not_a_quality_flag():
    assert powerbi_adapter.build_data_quality_flags(
        asset_id="ASSET-1",
        wo_id="WO-1",
        actual_start="2026-08-01T08:00:00",
        actual_end="",
        ttr_flag="Missing ActualEnd",
        status="Finished",
    ) == ["OK"]


def test_powerbi_real_end_without_start_is_still_flagged():
    flags = powerbi_adapter.build_data_quality_flags(
        asset_id="ASSET-1",
        wo_id="WO-1",
        actual_start="",
        actual_end="2026-08-01T10:00:00",
        ttr_flag="Missing ActualStart",
        status="Finished",
    )
    assert flags == ["Missing ActualStart"]


def test_repair_import_flags_reclassifies_missing_end_as_open(monkeypatch):
    class Rows(list):
        def fetchall(self):
            return self

    class Connection:
        def __init__(self):
            self.updated = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, sql, params=()):
            if "SELECT rowid" in sql:
                return Rows([{
                    "rowid": 7,
                    "status": "Finished",
                    "actual_start": "2026-08-01T08:00:00",
                    "actual_end": "",
                }])
            self.updated.append(params[0])
            return Rows()

    connection = Connection()
    monkeypatch.setattr(db, "get_connection", lambda: connection)

    assert db.repair_powerbi_quality_flags() == {"repaired": 1, "skipped": 0}
    assert connection.updated == [7]
