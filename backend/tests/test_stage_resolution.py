import os
import sys


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import downtime_service as downtime


def test_dotted_st2_marker_resolves_to_stage_2_even_when_joined_to_previous_text():
    assert downtime.detect_stage_from_text({"description": "High Risk allergenST.2"}) == "Stage 2"


def test_dotted_st1_marker_resolves_to_stage_1():
    assert downtime.detect_stage_from_text({"description": "Production side st.1"}) == "Stage 1"


def test_stage_2_wins_for_a_transfer_description_that_names_both_stages():
    description = "Move holder from cooked side st.1 to cooked side st.2"
    assert downtime.detect_stage_from_text({"description": description}) == "Stage 2"


def test_severity_s2_is_not_mistaken_for_stage_2():
    assert downtime.detect_stage_from_text({"description": "S2 severity electrical repair"}) is None


def test_existing_unmapped_st2_record_is_retagged(monkeypatch):
    class FakeRows(list):
        def fetchall(self):
            return self

    class FakeConnection:
        def __init__(self):
            self.updated_ids = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, sql, params=()):
            if "SELECT id" in sql:
                return FakeRows([{
                    "id": 42,
                    "functional_location": "",
                    "description": "High Risk allergenST.2",
                    "asset_name": "WO-ASSET",
                    "machine_group": "",
                    "trade": "",
                }])
            self.updated_ids.extend(params)
            return []

    connection = FakeConnection()
    monkeypatch.setattr(downtime, "get_stage2_functional_locations", lambda: set())
    monkeypatch.setattr(downtime, "clear_work_order_runtime_caches", lambda: None)
    import db
    monkeypatch.setattr(db, "get_connection", lambda: connection)

    result = downtime.retag_stage2_by_functional_location()

    assert result == {"updated": 1}
    assert connection.updated_ids == [42]
