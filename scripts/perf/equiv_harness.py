"""
Equivalence + timing harness (Phase 8 tool, built up front).

Usage:
    python equiv_harness.py baseline    # snapshot current numbers -> baseline.json.gz
    python equiv_harness.py compare     # rebuild, diff numbers vs baseline, report timing

Guarantees historical figures are unchanged: it deep-diffs the FULL payload of
every dashboard builder across the Phase 8 test matrix, after normalizing away
floating-point noise and known wall-clock volatile fields. Any numeric change
in MTTR / MTBF / counts / trends / breakdowns / backlog fails the compare.
"""
import gzip
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BACKEND = os.path.join(os.getcwd(), "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)
os.environ.setdefault("MIRA_ENABLE_CACHE_WARMER", "0")

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.path.join(HERE, "baseline_payloads.json.gz")

import downtime_service as dt  # noqa: E402

# Fields whose value is wall-clock "now" or otherwise legitimately volatile and
# must NOT count as a figure change. Keep this list minimal — data is unchanged,
# so nearly everything should match exactly.
VOLATILE_KEYS = {
    "generated_at", "generatedAt", "timestamp", "as_of", "asOf",
    "elapsed_ms", "build_ms", "_debug", "server_time", "now",
    # "current age" of an open work order = (now - actual_start). Live
    # availability data, not a historical figure; drifts with wall-clock time.
    "open_age_days", "open_age_label",
}


def clear_caches():
    for attr in ("_DOWNTIME_CACHE", "_SQL_WO_CACHE", "_WO_LOAD_CACHE"):
        o = getattr(dt, attr, None)
        if isinstance(o, dict):
            o.clear()


# Builders whose top-level row ordering is a live-presentation detail (e.g. the
# inactive-critical snapshot is sorted by open-age, which ticks over in real time
# and reshuffles ties). Their SET of rows and non-time fields must still match, so
# we compare them order-independently rather than ignoring them.
ORDER_INSENSITIVE_BUILDERS = {"inactive_critical"}


def normalize(obj):
    """Recursively round floats and drop volatile keys for stable comparison."""
    if isinstance(obj, dict):
        return {k: normalize(v) for k, v in obj.items() if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [normalize(v) for v in obj]
    if isinstance(obj, float):
        return round(obj, 6)
    return obj


def sort_lists_of_dicts(obj):
    """Recursively sort any list whose elements are all dicts, by canonical JSON,
    so order-insensitive builders compare on content not presentation order."""
    if isinstance(obj, dict):
        return {k: sort_lists_of_dicts(v) for k, v in obj.items()}
    if isinstance(obj, list):
        items = [sort_lists_of_dicts(v) for v in obj]
        if items and all(isinstance(v, dict) for v in items):
            items = sorted(items, key=lambda d: json.dumps(d, sort_keys=True, default=str))
        return items
    return obj


# ── Phase 8 test matrix ───────────────────────────────────────────────────────
BUILDERS = {
    "downtime__all_stages_all_time": lambda: dt.build_downtime_payload(),
    "downtime__stage1":              lambda: dt.build_downtime_payload(stage="Stage 1"),
    "downtime__stage2":              lambda: dt.build_downtime_payload(stage="Stage 2"),
    "downtime__current_month":       lambda: dt.build_downtime_payload(period="month"),
    "downtime__year":                lambda: dt.build_downtime_payload(period="year"),
    "mtbf_history__all":             lambda: dt.build_mtbf_work_order_history_payload(),
    "mtbf_history__stage1":          lambda: dt.build_mtbf_work_order_history_payload(stage="Stage 1"),
    "inactive_critical":             lambda: dt.build_inactive_critical_machines_payload(),
}


def run_all():
    out = {}
    timings = {}
    for name, fn in BUILDERS.items():
        clear_caches()
        t0 = time.perf_counter()
        payload = fn()
        timings[name] = (time.perf_counter() - t0) * 1000
        norm = normalize(payload)
        if name in ORDER_INSENSITIVE_BUILDERS:
            norm = sort_lists_of_dicts(norm)
        out[name] = norm
    return out, timings


def diff(a, b, path=""):
    """Yield (path, before, after) for every leaf difference."""
    if type(a) != type(b):
        yield (path, a, b); return
    if isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a:
                yield (f"{path}.{k}", "<missing>", b[k])
            elif k not in b:
                yield (f"{path}.{k}", a[k], "<missing>")
            else:
                yield from diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        if len(a) != len(b):
            yield (f"{path}[len]", len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff(x, y, f"{path}[{i}]")
    else:
        if a != b:
            yield (path, a, b)


def save_baseline():
    payloads, timings = run_all()
    with gzip.open(BASELINE, "wt", encoding="utf-8") as f:
        json.dump(payloads, f, default=str)
    print(f"Baseline saved: {BASELINE}")
    print(f"{'builder':36} {'ms':>9}")
    for name, ms in timings.items():
        print(f"{name:36} {ms:9.1f}")


def compare():
    if not os.path.exists(BASELINE):
        print("No baseline. Run: python equiv_harness.py baseline"); return 2
    with gzip.open(BASELINE, "rt", encoding="utf-8") as f:
        base = json.load(f)
    # normalize baseline again through json round-trip via default=str already applied
    now, timings = run_all()
    # round-trip now through json to match baseline's str-coercion of odd types
    now = json.loads(json.dumps(now, default=str))

    print(f"{'builder':36} {'baseline?':>10} {'ms(now)':>9}  result")
    total_diffs = 0
    for name in BUILDERS:
        b = base.get(name)
        n = now.get(name)
        if b is None:
            print(f"{name:36} {'NEW':>10} {timings[name]:9.1f}  (no baseline entry)")
            continue
        diffs = list(diff(b, n, name))
        total_diffs += len(diffs)
        status = "OK" if not diffs else f"*** {len(diffs)} FIGURE DIFFS ***"
        print(f"{name:36} {'yes':>10} {timings[name]:9.1f}  {status}")
        for p, x, y in diffs[:25]:
            print(f"      {p}\n        before={x!r}\n        after ={y!r}")
    print("\n" + ("ALL FIGURES IDENTICAL [PASS]" if total_diffs == 0
                   else f"!!! {total_diffs} figure differences - investigate before shipping"))
    return 0 if total_diffs == 0 else 1


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "compare"
    if mode == "baseline":
        save_baseline()
    else:
        sys.exit(compare())
