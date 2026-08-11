"""Phase 7 — controlled materialisation of WO-derived PROXY downtime into downtime_event.

Verified/partial intervals are authored directly in downtime_event and are NEVER touched
here. This job derives a PROXY interval from each bounded work order (Actual Start +
Actual End), upserts it idempotently (stable key: asset_id + downtime_start + wo_number),
then supersedes any proxy row not seen in this run. Confidence is always ``proxy``; proxy
downtime never blocks the planner. Open WOs (no Actual End) never materialise — an unbounded
interval is not evidence of a machine-down duration.

Run manually or from the maintenance ingestion pipeline:

    python downtime_materialisation.py
"""

from __future__ import annotations

import datetime as dt
import logging

import db
from downtime_service import load_work_order_downtime_sql

try:
    from mira.services.kpi_query_service import _classify_preventive_corrective_row
except Exception:                                    # pragma: no cover - defensive
    _classify_preventive_corrective_row = None

_LOG = logging.getLogger("app.downtime_materialisation")


def _classification(row) -> str:
    if _classify_preventive_corrective_row:
        try:
            return "planned" if _classify_preventive_corrective_row(row)[0] == "preventive" else "unplanned"
        except Exception:
            pass
    return "planned" if "prevent" in str(row.get("job_type") or "").lower() else "unplanned"


def _parse(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def materialise_proxy_downtime(source=None, now=None) -> dict:
    """Materialise WO-derived proxy intervals into downtime_event; supersede stale proxies."""
    run_ts = (now or dt.datetime.utcnow()).isoformat(timespec="seconds") + "Z"
    source = source or load_work_order_downtime_sql()
    records = source.get("records") or []

    rows = []
    for record in records:
        asset_id = str(record.get("asset_id") or "").strip()
        if not asset_id:
            continue
        start = _parse(record.get("actual_start_time") or record.get("start_time"))
        end = _parse(record.get("actual_end_time") or record.get("end_time"))
        if not (start and end and end > start):
            continue                                  # open/invalid interval → never materialise
        work_order_id = str(record.get("work_order_id") or "")
        # Stable source interval key: prefer the WO id, else a deterministic synthetic key
        # so a WO without an id still upserts idempotently (a NULL in the UNIQUE key would
        # otherwise re-insert every run and churn the supersede step).
        wo_key = work_order_id or str(record.get("wo_number") or "") or f"SYN-{end.isoformat()}"
        rows.append({
            "asset_id": asset_id,
            "facility_stage": record.get("stage"),
            "equipment_family": record.get("machine_group"),
            "downtime_start": start.isoformat(),
            "downtime_end": end.isoformat(),
            "capacity_factor": 0.0,
            "wo_number": wo_key,
            "classification": _classification(record),
            "source_work_order_id": work_order_id,
            "source_updated_at": record.get("updated_at") or source.get("last_synced"),
            "last_synced_at": run_ts,
        })

    upserted = db.upsert_downtime_events(rows)
    superseded = db.delete_stale_proxy_downtime(run_ts)
    ends = [t for t in (_parse(r.get("actual_end_time")) for r in records) if t]
    result = {
        "upserted": upserted,
        "superseded": superseded,
        "materialised_intervals": len(rows),
        "synced_at": run_ts,
        "source_through": max(ends).isoformat() if ends else None,
    }
    _LOG.info("downtime_materialisation upserted=%d superseded=%d intervals=%d source_through=%s",
              upserted, superseded, len(rows), result["source_through"])
    return result


if __name__ == "__main__":                            # pragma: no cover
    import json
    logging.basicConfig(level=logging.INFO)
    db.init_db()
    print(json.dumps(materialise_proxy_downtime(), indent=2))
