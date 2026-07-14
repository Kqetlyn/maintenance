import os
import sys
import unittest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from mixer_alias_mapping import (  # noqa: E402
    GENERAL_LOW_RISK_ASSET_ID,
    GOLD_UNRESOLVED_ASSET_ID,
    apply_mixer_alias_mapping,
)


class MixerAliasMappingTests(unittest.TestCase):
    def map_row(self, asset_id, asset_name="", description="", machine_group=""):
        return apply_mixer_alias_mapping({
            "asset_id": asset_id,
            "asset_name": asset_name,
            "description": description,
            "machine_group": machine_group,
        })

    def test_generic_low_risk_thai_silver_maps_to_food_mixer_2(self):
        result = self.map_row(
            GENERAL_LOW_RISK_ASSET_ID,
            "Production Low Risk",
            "เครื่องMix (น้องเงิน) เสียงดัง",
        )

        self.assertTrue(result["mixer_related"])
        self.assertEqual(result["mixer_alias"], "Silver")
        self.assertEqual(result["canonical_asset_id"], "ENPD-240052")
        self.assertEqual(result["canonical_asset_name"], "Food Mixer 2 (Silver)")
        self.assertEqual(result["alias_mapping_status"], "Alias inferred")
        self.assertEqual(result["mapping_confidence"], "High")
        self.assertTrue(result["alias_mtbf_include"])

    def test_generic_low_risk_thai_gold_remains_unresolved(self):
        result = self.map_row(
            GENERAL_LOW_RISK_ASSET_ID,
            "Production Low Risk",
            "เครื่อง Mixer (น้องทอง) ชำรุด 2 เครื่อง",
        )

        self.assertTrue(result["mixer_related"])
        self.assertEqual(result["mixer_alias"], "Gold")
        self.assertEqual(result["canonical_asset_id"], GOLD_UNRESOLVED_ASSET_ID)
        self.assertEqual(result["canonical_asset_name"], "Gold Mixer - Asset Unresolved")
        self.assertEqual(result["alias_mapping_status"], "Requires verification")
        self.assertEqual(result["mapping_confidence"], "Low")
        self.assertFalse(result["alias_mtbf_include"])
        self.assertTrue(result["mixer_multiple_machines"])

    def test_specific_asset_id_wins_even_when_alias_conflicts(self):
        result = self.map_row(
            "ENPD-240052",
            "Food Mixer No.2",
            "Food Mixer 2 Gold leaking",
        )

        self.assertTrue(result["mixer_related"])
        self.assertEqual(result["canonical_asset_id"], "ENPD-240052")
        self.assertEqual(result["canonical_asset_name"], "Food Mixer 2")
        self.assertEqual(result["alias_mapping_status"], "Alias conflict")
        self.assertEqual(result["alias_mapping_review_status"], "Conflict")
        self.assertTrue(result["alias_mapping_review_required"])
        self.assertTrue(result["alias_mtbf_include"])

    def test_specific_food_mixer_1_gold_is_confirmed_by_asset_id(self):
        result = self.map_row(
            "ENPD-240051",
            "Food Mixer No.1",
            "ซ่อมเครื่อง Mixer (น้องทอง) ทั้งสองเครื่อง",
        )

        self.assertTrue(result["mixer_related"])
        self.assertEqual(result["canonical_asset_id"], "ENPD-240051")
        self.assertEqual(result["canonical_asset_name"], "Food Mixer 1 (Gold)")
        self.assertEqual(result["alias_mapping_status"], "Confirmed by asset ID")
        self.assertEqual(result["alias_mapping_review_status"], "Confirmed")
        self.assertTrue(result["mixer_multiple_machines"])

    def test_english_alias_matching(self):
        silver = self.map_row(GENERAL_LOW_RISK_ASSET_ID, "Production Low Risk", "Silver mixer noisy")
        gold = self.map_row(GENERAL_LOW_RISK_ASSET_ID, "Production Low Risk", "Golden mixer fault")

        self.assertEqual(silver["canonical_asset_id"], "ENPD-240052")
        self.assertEqual(silver["mixer_alias"], "Silver")
        self.assertEqual(gold["canonical_asset_id"], GOLD_UNRESOLVED_ASSET_ID)
        self.assertEqual(gold["mixer_alias"], "Gold")


if __name__ == "__main__":
    unittest.main()
