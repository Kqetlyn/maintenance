import sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
import pm_schedule_service, downtime_service
from mira.services import kpi_query_service as kpi
from mira.core import context as ctx
pm_schedule_service._PM_PAGE_PAYLOAD_CACHE.clear()
downtime_service._DOWNTIME_CACHE.clear()
f = ctx.normalize_filters({})
def t(label, fn):
    s=time.time()
    try:
        r=fn(); print(f"{label:34}{time.time()-s:7.1f}s  OK", flush=True); return r
    except Exception as e:
        print(f"{label:34}{time.time()-s:7.1f}s  ERR {e!r}", flush=True); return None
t("get_mr_activity_summary", lambda: kpi.get_mr_activity_summary(f))
t("get_mttr", lambda: kpi.get_mttr(f))
t("get_mtbf", lambda: kpi.get_mtbf(f))
t("get_data_reliability_issues", lambda: kpi.get_data_reliability_issues(f))
t("get_pm_schedule_status", lambda: kpi.get_pm_schedule_status(f))
t("get_spare_parts_summary", lambda: kpi.get_spare_parts_summary(f))
print("DONE", flush=True)
