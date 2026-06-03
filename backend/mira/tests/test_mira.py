"""
MIRA prototype smoke tests.

Run directly (no pytest required):
    cd backend
    python -m mira.tests.test_mira

Or with pytest:
    cd backend
    pytest mira/tests/test_mira.py

These exercise KPI Summary Mode end-to-end, asserting that MIRA reuses the
dashboard builders and that the privacy guard scrubs / caps correctly. They do
not assert exact KPI values (those come from live data) — only structure and the
no-leak guarantees.
"""

from __future__ import annotations

import os
import sys

# Ensure the backend dir (top-level dashboard modules + the mira package) is importable.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from mira import config
from mira.privacy import privacy_guard_service as guard
from mira.providers import get_provider
from mira.services import kpi_query_service as kpi
from mira.modules.maintenance import assistant_service
from mira.reports import report_draft_service

FILTERS = {"stage": "all", "year": 2026, "month": 6}


def _check(name, cond):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}")
    if not cond:
        raise AssertionError(name)


def test_mttr_query():
    d = kpi.get_mttr(FILTERS)
    _check("MTTR has overall_mttr_hours key", "overall_mttr_hours" in d)
    _check("MTTR unit is hours", d.get("unit") == "hours")


def test_mtbf_query():
    d = kpi.get_mtbf(FILTERS)
    _check("MTBF has overall_average_mtbf_hours key", "overall_average_mtbf_hours" in d)


def test_open_work_orders_query():
    d = kpi.get_open_work_orders(FILTERS)
    _check("open + closed <= total (consistent)",
           (d["open_work_orders"] or 0) + (d["closed_work_orders"] or 0) <= (d["total_work_orders"] or 0) + 0)
    _check("has closed_work_orders", "closed_work_orders" in d)


def test_data_reliability_query():
    d = kpi.get_data_reliability_issues(FILTERS)
    _check("reliability has requires_attention_count", "requires_attention_count" in d)


def test_pm_schedule_query():
    d = kpi.get_pm_schedule_status(FILTERS)
    _check("PM status has total_scheduled", "total_scheduled" in d)
    _check("PM status has compliance_pct", "compliance_pct" in d)


def test_preventive_corrective_query():
    d = kpi.get_preventive_corrective_summary(FILTERS)
    _check("mix has preventive_count", "preventive_count" in d)
    _check("mix has corrective_count", "corrective_count" in d)


def test_monthly_summary_query():
    d = kpi.get_dashboard_kpi_summary(FILTERS)
    for key in ("work_orders", "mttr_hours", "mtbf_hours", "pm_schedule"):
        _check(f"summary has {key}", key in d)


def test_privacy_guard_caps_and_scrubs():
    fake_rows = [{
        "work_order_id": f"WO-{i}",
        "asset_id": "ENPD-X",
        "started_by": "Jane Staff",          # sensitive -> must be dropped
        "description": "vendor ACME leaked secret api_key=sk-ABCDEF1234567890",
        "is_open": True,
    } for i in range(80)]
    result = guard.guard_work_orders({"rows": fake_rows, "total_matched": 80}, requested_limit=999)
    _check("rows capped at ROW_CAP_MAX", len(result["rows"]) <= config.ROW_CAP_MAX)
    _check("truncated flagged", result["truncated"] is True)
    sample = result["rows"][0]
    _check("staff name dropped", "started_by" not in sample)
    _check("free-text description dropped", "description" not in sample)


def test_privacy_block_full_dataset():
    try:
        guard.block_full_dataset(list(range(1000)))
        _check("block_full_dataset raised", False)
    except PermissionError:
        _check("block_full_dataset raised", True)


def test_provider_is_local_mock():
    p = get_provider()
    _check("default provider is mock", p.name == "mock")
    _check("provider is local-only", p.is_local_only is True)


def test_assistant_six_questions():
    questions = [
        "Summarise this month's maintenance performance.",
        "What is the MTTR this month?",
        "What is the MTBF this month?",
        "Compare Stage 1 and Stage 2 maintenance performance.",
        "What are the main data reliability issues?",
        "Summarise PM schedule status.",
    ]
    for q in questions:
        res = assistant_service.ask(q, FILTERS)
        _check(f"answer present: {q[:32]}...", bool(res.get("answer")))
        _check("answer carries draft label", config.DRAFT_LABEL in res["answer"])
        _check("mode is kpi_summary", res["mode"] == "kpi_summary")
        print(f"      Q: {q}\n      A: {res['answer'].splitlines()[0]}\n")


def test_report_draft():
    rep = report_draft_service.generate_monthly_maintenance_summary(FILTERS)
    _check("report has markdown", bool(rep.get("markdown")))
    _check("report marked draft", config.DRAFT_LABEL in rep["narrative"])


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    print(f"Running {len(tests)} MIRA smoke tests (provider={get_provider().name})\n")
    failed = 0
    for t in tests:
        print(f"• {t.__name__}")
        try:
            t()
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  -> ERROR: {exc}")
    print(f"\n{'ALL PASSED' if not failed else str(failed) + ' TEST(S) FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
