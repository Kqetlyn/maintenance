# Equipment integration API

The maintenance dashboard remains the sole owner of `data/dashboard.db`. The
production dashboard consumes the read-only endpoints below and must never open,
copy, or mount this SQLite file.

## Endpoints

- `GET /api/v1/maintenance/health`
- `POST /api/v1/maintenance/assets/summary`
- `GET /api/v1/maintenance/assets/<asset_id>/work-orders?from=YYYY-MM-DD&to=YYYY-MM-DD`

All endpoints require `Authorization: Bearer <service token>`. When
`MAINTENANCE_ALLOWED_CALLERS` is configured, the caller must also send the
matching `X-Caller-ID`. The endpoints are read-only and return 401 for missing
credentials, 403 for invalid caller permission, 404 for unknown assets, and 422
for invalid parameters.

The summary endpoint reuses the dashboard's enriched work-order lifecycle,
preventive/corrective classifier, MTTR/MTBF service, and PM schedule service.
Current open work orders are labelled separately from requested-period counts.
Unavailable metrics are returned as `null` with notes.

## Deep links

Authenticated users with Downtime permission can open:

`/downtime?asset_id=ENPD-240023&from=2026-07-01&to=2026-07-31&stage=1`

The page validates and applies the date, stage, and accessible Asset ID. Invalid
or inaccessible values are ignored with a non-blocking notice. Dashboard login
and role checks are not bypassed.

## Local development

1. Run Maintenance on port 5005 and Production on a different port.
2. Set `MAINTENANCE_API_ENABLED=true` and a strong service token here.
3. Set the same value as `MAINTENANCE_API_TOKEN` in Production.
4. Configure `MAINTENANCE_API_BASE_URL=http://127.0.0.1:5005` and
   `MAINTENANCE_DASHBOARD_BASE_URL=http://127.0.0.1:5005` in Production.

Use HTTPS and a private route in deployed environments. A reverse proxy may
route the two applications separately; browser CORS is not required because the
integration is server-to-server. Disable the API with the feature flag for a
safe rollback while the maintenance dashboard continues operating normally.

