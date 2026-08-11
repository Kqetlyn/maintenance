"""
Phase 1 performance audit harness (read-only).

Instruments the real maintenance-dashboard hot paths:
  - total builder duration
  - SQL duration + SQL query count (via connection trace callback)
  - Python transformation duration (total - sql)
  - serialization duration (json.dumps)
  - result row count
  - response size (serialized bytes)

Measures the COLD path by clearing all in-process caches before each build.
Does NOT modify the database or any application code.
"""
import gzip
import io
import json
import os
import sqlite3
import sys
import time
from collections import Counter
from contextlib import contextmanager

BACKEND = os.path.join(os.getcwd(), "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

os.environ.setdefault("MIRA_ENABLE_CACHE_WARMER", "0")

import db as _db  # noqa: E402
import downtime_service as dt  # noqa: E402

# ---- SQL tracing -------------------------------------------------------------
# We wrap db.get_connection so every statement executed during a build is
# timed and counted. sqlite3's set_trace_callback fires per-statement but gives
# no timing, so we monkeypatch Connection.execute instead.

_STATS = {"queries": [], "sql_seconds": 0.0}


class _TracingConn(sqlite3.Connection):
    def execute(self, sql, params=()):
        t0 = time.perf_counter()
        cur = super().execute(sql, params)
        dt_s = time.perf_counter() - t0
        _STATS["queries"].append((dt_s, " ".join(sql.split())[:200]))
        _STATS["sql_seconds"] += dt_s
        return cur


_orig_connect = sqlite3.connect


def _traced_connect(*args, **kwargs):
    kwargs.setdefault("factory", _TracingConn)
    return _orig_connect(*args, **kwargs)


def reset_sql_stats():
    _STATS["queries"] = []
    _STATS["sql_seconds"] = 0.0


def clear_all_caches():
    """Force the cold path: clear every in-process cache we know about."""
    for attr in ("_DOWNTIME_CACHE", "_SQL_WO_CACHE", "_WO_LOAD_CACHE"):
        obj = getattr(dt, attr, None)
        if isinstance(obj, dict):
            obj.clear()


@contextmanager
def patched_sqlite():
    sqlite3.connect = _traced_connect
    try:
        yield
    finally:
        sqlite3.connect = _orig_connect


def payload_bytes(payload):
    raw = json.dumps(payload, default=str).encode("utf-8")
    gz = gzip.compress(raw)
    return len(raw), len(gz)


def count_rows(payload):
    """Rough count of the largest row-bearing arrays in the payload."""
    interesting = {}
    def walk(obj, path):
        if isinstance(obj, list):
            interesting[path] = len(obj)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{path}.{k}" if path else k)
    walk(payload, "")
    top = sorted(interesting.items(), key=lambda kv: kv[1], reverse=True)[:8]
    return top


def bench(name, builder):
    clear_all_caches()
    reset_sql_stats()
    t0 = time.perf_counter()
    with patched_sqlite():
        payload = builder()
    total = time.perf_counter() - t0

    sql_s = _STATS["sql_seconds"]
    nq = len(_STATS["queries"])

    t1 = time.perf_counter()
    raw_len, gz_len = payload_bytes(payload)
    ser_s = time.perf_counter() - t1

    py_s = total - sql_s - ser_s
    rows = count_rows(payload)

    # Duplicate-query detection (same normalized SQL text run >1x)
    norm = Counter(q[1] for q in _STATS["queries"])
    dups = [(sql, c) for sql, c in norm.items() if c > 1]

    print(f"\n{'='*78}\n{name}\n{'='*78}")
    print(f"  total builder      : {total*1000:8.1f} ms")
    print(f"  sql time           : {sql_s*1000:8.1f} ms  ({sql_s/total*100:4.1f}%)  across {nq} queries")
    print(f"  python transform   : {py_s*1000:8.1f} ms  ({py_s/total*100:4.1f}%)")
    print(f"  serialization      : {ser_s*1000:8.1f} ms  ({ser_s/total*100:4.1f}%)")
    print(f"  payload raw / gzip : {raw_len/1024:8.1f} KB / {gz_len/1024:.1f} KB")
    print(f"  top row arrays     : " + ", ".join(f"{p}={n}" for p, n in rows[:6]))
    if dups:
        print(f"  DUPLICATE queries  :")
        for sql, c in sorted(dups, key=lambda x: -x[1])[:6]:
            print(f"      x{c}  {sql[:110]}")
    # slowest single statements this build
    slow = sorted(_STATS["queries"], key=lambda x: -x[0])[:3]
    print(f"  slowest statements :")
    for s, sql in slow:
        print(f"      {s*1000:7.1f} ms  {sql[:110]}")
    return {
        "name": name, "total_ms": total*1000, "sql_ms": sql_s*1000,
        "py_ms": py_s*1000, "ser_ms": ser_s*1000, "nq": nq,
        "raw_kb": raw_len/1024, "gz_kb": gz_len/1024, "rows": rows,
    }


if __name__ == "__main__":
    results = []
    # The real hot path: /api/downtime -> build_downtime_payload
    results.append(bench("build_downtime_payload  (all stages, all time)",
                         lambda: dt.build_downtime_payload()))
    results.append(bench("build_downtime_payload  (Stage 1, all time)",
                         lambda: dt.build_downtime_payload(stage="Stage 1")))
    results.append(bench("build_downtime_payload  (Stage 2, all time)",
                         lambda: dt.build_downtime_payload(stage="Stage 2")))
    results.append(bench("build_downtime_payload  (current month)",
                         lambda: dt.build_downtime_payload(period="month")))
    results.append(bench("build_mtbf_work_order_history_payload (all stages)",
                         lambda: dt.build_mtbf_work_order_history_payload()))
    results.append(bench("build_inactive_critical_machines_payload",
                         lambda: dt.build_inactive_critical_machines_payload()))

    # WARM path (second call, caches populated) for the main route
    clear_all_caches()
    dt.build_downtime_payload()  # prime
    reset_sql_stats()
    t0 = time.perf_counter()
    with patched_sqlite():
        dt.build_downtime_payload()
    warm = (time.perf_counter() - t0) * 1000
    print(f"\n{'='*78}\nWARM build_downtime_payload (cache hit): {warm:.2f} ms, {len(_STATS['queries'])} queries\n{'='*78}")

    print("\n\n#### SUMMARY TABLE ####")
    print(f"{'route':52} {'total':>8} {'sql':>8} {'py':>8} {'ser':>7} {'nq':>4} {'raw KB':>8} {'gz KB':>7}")
    for r in results:
        print(f"{r['name']:52} {r['total_ms']:8.0f} {r['sql_ms']:8.0f} {r['py_ms']:8.0f} {r['ser_ms']:7.0f} {r['nq']:4d} {r['raw_kb']:8.0f} {r['gz_kb']:7.0f}")
