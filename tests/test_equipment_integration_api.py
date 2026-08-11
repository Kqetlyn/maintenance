import os
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MAINTENANCE_API_ENABLED", "true")
    monkeypatch.setenv("MAINTENANCE_API_SERVICE_TOKEN", "test-service-token")
    monkeypatch.setenv("MAINTENANCE_ALLOWED_CALLERS", "production-equipment-loading")
    app.config.update(TESTING=True)
    return app.test_client()


def headers(token="test-service-token", caller="production-equipment-loading"):
    return {"Authorization": f"Bearer {token}", "X-Caller-ID": caller}


def test_missing_authentication_is_401(client):
    assert client.get("/api/v1/maintenance/health").status_code == 401


def test_invalid_token_or_caller_is_403(client):
    assert client.get("/api/v1/maintenance/health", headers=headers("wrong")).status_code == 403
    assert client.get("/api/v1/maintenance/health", headers=headers(caller="unknown")).status_code == 403


def test_feature_flag_can_disable_api(client, monkeypatch):
    monkeypatch.setenv("MAINTENANCE_API_ENABLED", "false")
    assert client.get("/api/v1/maintenance/health", headers=headers()).status_code == 503


def test_service_auto_enables_with_token_when_flag_is_unset(client, monkeypatch):
    monkeypatch.delenv("MAINTENANCE_API_ENABLED", raising=False)
    assert client.get("/api/v1/maintenance/health", headers=headers()).status_code == 200


def test_service_logs_configuration_without_token(client, monkeypatch, caplog):
    token = "token-value-that-must-not-be-logged"
    monkeypatch.setenv("MAINTENANCE_API_SERVICE_TOKEN", token)
    with caplog.at_level("INFO"):
        response = client.get("/api/v1/maintenance/health", headers=headers(token))
    assert response.status_code == 200
    assert "feature_flag=" in caplog.text
    assert "token_configured=True" in caplog.text
    assert token not in caplog.text


def test_invalid_dates_and_asset_ids_return_422(client):
    bad_date = client.post("/api/v1/maintenance/assets/summary", headers=headers(), json={
        "asset_ids": ["ENPD-240023"], "from": "2026-07-31", "to": "2026-07-01",
    })
    bad_asset = client.post("/api/v1/maintenance/assets/summary", headers=headers(), json={
        "asset_ids": ["../../db"], "from": "2026-07-01", "to": "2026-07-31",
    })
    assert bad_date.status_code == 422
    assert bad_asset.status_code == 422


def test_real_asset_batch_summary_and_mtbf_null_handling(client):
    response = client.post("/api/v1/maintenance/assets/summary", headers=headers(), json={
        "asset_ids": ["ENPD-240023", "DOES-NOT-EXIST"],
        "from": "2026-07-01", "to": "2026-07-31",
    })
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["period"] == {"from": "2026-07-01", "to": "2026-07-31"}
    assert payload["assets"][0]["asset_id"] == "ENPD-240023"
    assert payload["assets"][0]["mtbf_days"] is None
    assert any("insufficient completed failure intervals" in note for note in payload["assets"][0]["metric_notes"])
    assert "DOES-NOT-EXIST" in payload["unmatched_asset_ids"]


def test_asset_summary_validates_facility_stage(client):
    good = client.post("/api/v1/maintenance/assets/summary", headers=headers(), json={
        "asset_ids": ["ENPD-240023"], "asset_stages": {"ENPD-240023": "1"},
        "from": "2026-07-01", "to": "2026-07-31",
    })
    bad = client.post("/api/v1/maintenance/assets/summary", headers=headers(), json={
        "asset_ids": ["ENPD-240023"], "asset_stages": {"ENPD-240023": "2"},
        "from": "2026-07-01", "to": "2026-07-31",
    })
    assert good.status_code == 200
    assert good.get_json()["assets"][0]["stage"] == "Stage 1"
    assert bad.status_code == 422
    assert "does not match" in bad.get_json()["error"]


def test_unknown_asset_work_orders_is_404(client):
    response = client.get(
        "/api/v1/maintenance/assets/DOES-NOT-EXIST/work-orders?from=2026-07-01&to=2026-07-31",
        headers=headers(),
    )
    assert response.status_code == 404


def test_work_order_response_exposes_only_safe_fields(client):
    response = client.get(
        "/api/v1/maintenance/assets/ENPD-240023/work-orders?from=2026-06-01&to=2026-06-30&limit=2",
        headers=headers(),
    )
    assert response.status_code == 200
    rows = response.get_json()["work_orders"]
    assert rows
    assert "description" not in rows[0]
    assert "work_order_id" in rows[0]


def test_deep_link_does_not_bypass_dashboard_login(client):
    response = client.get("/downtime?asset_id=ENPD-240023&from=2026-07-01&to=2026-07-31")
    assert response.status_code == 302
    assert "/login" in response.headers["Location"]


def test_deep_link_script_validates_and_applies_parameters():
    script = (Path(__file__).resolve().parents[1] / "frontend" / "Downtime" / "script.js").read_text(encoding="utf-8")
    assert "readEquipmentLoadingDeepLink" in script
    assert "machineExplorerSelectedAssetId = context.assetId" in script
    assert 'periodSelect.value = "custom"' in script
