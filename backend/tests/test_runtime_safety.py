"""Deployment startup, role-routing, and transactional import smoke tests."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = PROJECT_ROOT / "backend"


def _run_isolated(script: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="maintenance-dashboard-test-") as data_dir:
        env = os.environ.copy()
        env.update(
            {
                "DATA_DIR": data_dir,
                "DASHBOARD_MANAGEMENT_PASSWORD": "restricted-test-password",
                "DASHBOARD_STAFF_PASSWORD": "public-test-password",
                "MIRA_CLEAR_CACHE_ON_STARTUP": "0",
            }
        )
        result = subprocess.run(
            [sys.executable, "-c", textwrap.dedent(script)],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if result.returncode:
            raise AssertionError(
                f"Isolated smoke process failed ({result.returncode}).\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        result_line = next(
            (line for line in reversed(result.stdout.splitlines()) if line.startswith("RESULT=")),
            None,
        )
        if not result_line:
            raise AssertionError(f"No RESULT line.\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}")
        return json.loads(result_line.removeprefix("RESULT="))


class RuntimeSafetyTests(unittest.TestCase):
    def test_wsgi_startup_health_and_role_routes(self):
        outcome = _run_isolated(
            """
            import json
            import app
            import auth

            client = app.app.test_client()
            anonymous = {
                "health": client.get("/api/health").status_code,
                "private_api": client.get("/api/db/status").status_code,
            }
            users = {user["role"]: user for user in auth.list_users()}

            def statuses(role, paths):
                with client.session_transaction() as session:
                    session.clear()
                    session["user_id"] = users[role]["id"]
                return {path: client.get(path).status_code for path in paths}

            public = statuses("public", [
                "/?view=pm_schedule", "/?view=downtime",
                "/?view=mira_overview", "/?view=spare_parts", "/management/users",
            ])
            restricted = statuses("restricted", [
                "/?view=pm_schedule", "/?view=downtime",
                "/?view=mira_overview", "/?view=spare_parts", "/management/users",
            ])
            assets = statuses("restricted", [
                "/Maintenance/script.js",
                "/Maintenance/spare-parts-mgmt.js",
                "/Maintenance/pm-schedule.js",
                "/shared/mira/mira-overview.js",
                "/Downtime/script.js",
                "/Downtime/style.css",
            ])
            route_signatures = [
                (rule.rule, tuple(sorted(rule.methods - {"HEAD", "OPTIONS"})))
                for rule in app.app.url_map.iter_rules()
            ]
            result = {
                "anonymous": anonymous,
                "public": public,
                "restricted": restricted,
                "assets": assets,
                "db_ok": app._db.get_db_status()["ok"],
                "duplicate_routes": sorted({
                    str(signature) for signature in route_signatures
                    if route_signatures.count(signature) > 1
                }),
            }
            print("RESULT=" + json.dumps(result))
            """
        )
        self.assertEqual(outcome["anonymous"], {"health": 200, "private_api": 401})
        self.assertTrue(outcome["db_ok"])
        self.assertEqual(outcome["duplicate_routes"], [])
        self.assertEqual(outcome["public"]["/?view=pm_schedule"], 200)
        self.assertEqual(outcome["public"]["/?view=downtime"], 200)
        self.assertEqual(outcome["public"]["/?view=mira_overview"], 302)
        self.assertEqual(outcome["public"]["/?view=spare_parts"], 302)
        self.assertEqual(outcome["public"]["/management/users"], 302)
        self.assertTrue(all(status == 200 for status in outcome["restricted"].values()))
        self.assertTrue(all(status == 200 for status in outcome["assets"].values()))

    def test_failed_replacements_preserve_last_valid_data(self):
        outcome = _run_isolated(
            """
            import json
            import db

            db.init_db()
            db.upsert_work_orders([{
                "maintenance_order_id": "MR-OLD",
                "work_order_id": "WO-OLD",
                "data_quality_flag": "Valid",
            }])
            work_order_rolled_back = False
            try:
                with db.get_connection() as connection:
                    db.clear_work_orders(connection=connection)
                    db.upsert_work_orders([{
                        "maintenance_order_id": "MR-NEW",
                        "work_order_id": "WO-NEW",
                        "data_quality_flag": "Valid",
                        "maintenance_start_time": object(),
                    }], connection=connection)
            except Exception:
                work_order_rolled_back = True

            db.replace_powerbi_full_batch(
                batch_id="old-batch",
                source_type="POWERBI_FULL_MR_WO_EXPORT",
                source_file="old.xlsx",
                imported_at="2026-01-01T00:00:00Z",
                records=[],
            )
            pbi_rolled_back = False
            try:
                db.replace_powerbi_full_batch(
                    batch_id="old-batch",
                    source_type="POWERBI_FULL_MR_WO_EXPORT",
                    source_file="bad.xlsx",
                    imported_at="2026-01-02T00:00:00Z",
                    records=[],
                )
            except Exception:
                pbi_rolled_back = True

            with db.get_connection() as connection:
                work_orders = [dict(row) for row in connection.execute(
                    "SELECT mr_number, wo_number FROM work_orders"
                )]
                active_batches = [dict(row) for row in connection.execute(
                    "SELECT batch_id, is_active FROM import_batches WHERE is_active = 1"
                )]
            print("RESULT=" + json.dumps({
                "work_order_rolled_back": work_order_rolled_back,
                "work_orders": work_orders,
                "pbi_rolled_back": pbi_rolled_back,
                "active_batches": active_batches,
            }))
            """
        )
        self.assertTrue(outcome["work_order_rolled_back"])
        self.assertEqual(outcome["work_orders"], [{"mr_number": "MR-OLD", "wo_number": "WO-OLD"}])
        self.assertTrue(outcome["pbi_rolled_back"])
        self.assertEqual(outcome["active_batches"], [{"batch_id": "old-batch", "is_active": 1}])


if __name__ == "__main__":
    unittest.main()
