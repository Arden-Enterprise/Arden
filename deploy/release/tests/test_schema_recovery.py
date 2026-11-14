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
        self.assertEqual(self.paths[-1].name, "0034_apply_publication_change_requests.sql")
        module.validate_migration_inventory(self.paths)

    def test_previous_inventory_missing_catalog_is_rejected(self):
        without_catalog = [path for path in self.paths
                           if path.name != "0030_knowledge_management_catalog.sql"]
        with self.assertRaises(ValueError):
            module.validate_migration_inventory(without_catalog)

    def test_unreviewed_future_migration_is_rejected(self):
        with self.assertRaises(ValueError):
            module.validate_migration_inventory(self.paths + [Path("0035_unreviewed.sql")])

    def test_missing_or_duplicate_history_is_rejected(self):
        for paths in (self.paths[:10] + self.paths[11:],
                      self.paths[:10] + [self.paths[9]] + self.paths[11:]):
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                module.validate_migration_inventory(paths)


if __name__ == "__main__":
    unittest.main()
