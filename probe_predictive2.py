import sys, http.client, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

conn = http.client.HTTPConnection("localhost", 5005, timeout=60)
conn.request("GET", "/api/mira/predictive?stage=all&year=2026&month=all&period_mode=ytd")
resp = conn.getresponse()
data = json.loads(resp.read()).get("data", {})
conn.close()

for cat in data.get("categories", []):
    print(f"\n{'='*60}")
    print(f"  {cat['name']} — {cat['total_mrs']} MRs")
    print(f"{'='*60}")
    for m in cat.get("top_machines", []):
        print(f"\n  #{m['rank']} {m['machine_type']}")
        print(f"    dominant_count          : {m.get('dominant_count')}")
        print(f"    recurrence_interval_days: {m.get('recurrence_interval_days')} (median)")
        print(f"    recurrence_interval_avg : {m.get('recurrence_interval_avg_days')}")
        print(f"    recurrence_interval_n   : {m.get('recurrence_interval_n')}")
        print(f"    likely_recurrence_label : {m.get('likely_recurrence_label')}")
        print(f"    likely_recurrence_date  : {m.get('likely_recurrence_date')}")
        print(f"    last_occurrence         : {m.get('last_occurrence')}")
        print(f"    mtbf_days (all-rows)    : {m.get('mtbf_days')}")
