import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "schema_recovery", ROOT / "tools" / "verification" / "schema-recovery.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SchemaRecoveryInventoryTests(unittest.TestCase):
    def setUp(self):
        self.paths = sorted((ROOT / "apps" / "api" / "migrations").glob(
            "[0-9][0-9][0-9][0-9]_*.sql"))

    def test_reviewed_catalog_migration_is_included(self):
        migration_names = {path.name for path in self.paths}
        self.assertIn("0030_knowledge_management_catalog.sql", migration_names)
        self.assertIn("0031_deduplicate_reviewer_grants.sql", migration_names)
        self.assertIn("0032_governed_ai_sources_and_conversations.sql", migration_names)
        self.assertIn("0074_system_admin_isolated_lifecycle.sql", migration_names)
        self.assertIn("0077_graph_monitor_projection.sql", migration_names)
        self.assertIn("0078_organization_direct_share_settings.sql", migration_names)
        self.assertIn("0079_direct_share_setting_cutover.sql", migration_names)
        self.assertIn("0080_retire_legacy_qa.sql", migration_names)
        self.assertIn("0081_target_readers_authoring_cutover.sql", migration_names)
        self.assertIn("0082_retire_legacy_categories_and_policies.sql", migration_names)
        self.assertIn("0083_retire_legacy_audience_reads.sql", migration_names)
        self.assertIn("0084_retire_legacy_system_administration.sql", migration_names)
        self.assertIn("0085_consolidate_index_dispatch.sql", migration_names)
        self.assertIn("0086_retire_audience_storage.sql", migration_names)
        self.assertIn("0087_consolidate_maintenance_notifications.sql", migration_names)
        self.assertIn("0088_consolidate_maintenance_reports.sql", migration_names)
        self.assertIn("0089_retire_legacy_collection_links.sql", migration_names)
        self.assertEqual(self.paths[-1].name, "0092_rename_schema_columns.sql")
        module.validate_migration_inventory(self.paths)

    def test_previous_inventory_missing_catalog_is_rejected(self):
        without_catalog = [path for path in self.paths
                           if path.name != "0030_knowledge_management_catalog.sql"]
        with self.assertRaises(ValueError):
            module.validate_migration_inventory(without_catalog)

    def test_unreviewed_future_migration_is_rejected(self):
        with self.assertRaises(ValueError):
            module.validate_migration_inventory(self.paths + [Path("0082_unreviewed.sql")])

    def test_missing_or_duplicate_history_is_rejected(self):
        for paths in (self.paths[:10] + self.paths[11:],
                      self.paths[:10] + [self.paths[9]] + self.paths[11:]):
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                module.validate_migration_inventory(paths)


if __name__ == "__main__":
    unittest.main()
