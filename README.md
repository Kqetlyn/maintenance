# Maintenance Dashboard

Editable downtime settings live in `data/master/Asset_Master.xlsx`.

- `Asset_Master`: asset IDs, names, Stage 1/Stage 2, main/sub asset groups, location, and system/area mapping.
- `Keyword Rules`: fallback mapping when an imported work order has no usable AssetID.
- `SLA_Targets`: response and completion targets for Work Order Response by Severity. Edit target hours directly; leave a target cell blank when that severity has no target. Set `Active` to `FALSE` to keep the severity grouping but remove both SLA targets.
