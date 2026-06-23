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
        print(f"    main_observed_issue : {m.get('main_observed_issue') or '—'}")
        print(f"    evidence_summary    : {m.get('evidence_summary') or '—'}")
        print(f"    likely_cause        : {m.get('likely_cause_candidate') or '—'}")
        print(f"    suggested_spare     : {m.get('suggested_spare') or '—'}")
        spare_parts = m.get('spare_parts') or []
        for p in spare_parts[:3]:
            label = p.get('label') or p.get('item_code') or '?'
            cls = p.get('classification') or ''
            stock = p.get('stock_status') or '?'
            print(f"    spare_part          : {label[:50]} [{cls}] {stock}")
        print(f"    confidence          : {m.get('confidence') or '—'} — {m.get('confidence_reason') or ''}")
        print(f"    stock_status        : {m.get('stock_status') or '—'}")
