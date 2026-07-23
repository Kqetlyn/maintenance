from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch


BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from mira import config
from mira.services import predictive_service


class _NoAssetIndexScan(dict):
    def get(self, key, default=None):
        if key in {"allowed_machines", "id_to_specific"}:
            raise AssertionError("disabled unit inference must not scan Asset Master")
        return super().get(key, default)


class PredictiveResolutionTests(unittest.TestCase):
    def test_disabled_unit_inference_skips_asset_master_scan(self):
        description = "Bratt pan No.4 temperature issue"
        cache_key = "unit2:" + predictive_service._desc_hash(description)
        predictive_service._mg_inference_cache.pop(cache_key, None)

        with patch.object(config, "LOCAL_LLM_ENABLED", False):
            result = predictive_service._qwen_extract_unit(
                description,
                _NoAssetIndexScan(),
            )

        self.assertIsNone(result)
        self.assertEqual(
            predictive_service._mg_inference_cache.get(cache_key),
            {"unit_name": None},
        )

    def test_group_index_precomputes_unit_inference_allow_list(self):
        mapping = {
            "asset_map": {
                "asset-1": {
                    "asset_id": "A-1",
                    "asset_machine_group": "Bratt Pan",
                    "machine_group": "Production Equipment",
                    "display_name": "Bratt Pan No.1",
                    "mapped_asset_name": "Bratt Pan No.1",
                },
                "asset-2": {
                    "asset_id": "A-2",
                    "asset_machine_group": "Bratt Pan",
                    "machine_group": "Production Equipment",
                    "display_name": "Bratt Pan No.2",
                    "mapped_asset_name": "Bratt Pan No.2",
                },
            }
        }

        index = predictive_service._compute_group_index(mapping)

        self.assertEqual(
            index["allowed_machines"],
            ["Bratt Pan No.1", "Bratt Pan No.2"],
        )


if __name__ == "__main__":
    unittest.main()
