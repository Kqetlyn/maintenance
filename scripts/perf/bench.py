"""Controlled cold-path benchmark: min-of-N per builder (route cache cleared,
lru_cache warm = representative running server). Reports min ms to cut noise."""
import os, sys, time, statistics
sys.path.insert(0, os.path.join(os.getcwd(), "backend"))
os.environ["MIRA_ENABLE_CACHE_WARMER"] = "0"
import downtime_service as dt

def clear_route():
    for a in ("_DOWNTIME_CACHE", "_SQL_WO_CACHE", "_WO_LOAD_CACHE"):
        getattr(dt, a).clear()

BUILDERS = {
    "downtime_all":     lambda: dt.build_downtime_payload(),
    "downtime_stage1":  lambda: dt.build_downtime_payload(stage="Stage 1"),
    "downtime_month":   lambda: dt.build_downtime_payload(period="month"),
    "mtbf_all":         lambda: dt.build_mtbf_work_order_history_payload(),
    "inactive_crit":    lambda: dt.build_inactive_critical_machines_payload(),
}

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
# warm lru_cache
clear_route(); dt.build_downtime_payload(); dt.build_mtbf_work_order_history_payload(); dt.build_inactive_critical_machines_payload()

print(f"min/median of {N} cold runs (warm lru_cache):")
print(f"{'builder':18} {'min ms':>9} {'median ms':>10}")
for name, fn in BUILDERS.items():
    ts = []
    for _ in range(N):
        clear_route()
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000)
    print(f"{name:18} {min(ts):9.0f} {statistics.median(ts):10.0f}")
