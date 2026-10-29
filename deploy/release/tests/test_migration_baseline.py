import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap


class MigrationBaselineTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"name": "0001_first.sql", "sha256": "a" * 64},
            {"name": "0002_second.sql", "sha256": "b" * 64},
        ]
        self.applied = [
            {"migration_id": "0001_first", "checksum": None},
            {"migration_id": "0002_second", "checksum": None},
        ]
        self.source = {
            "commit": "1" * 40,
            "tree": "2" * 40,
            "api_image": "sha256:" + "3" * 64,
            "migrations": bootstrap.verify_migration_inventory(
                self.rows, [row["migration_id"] for row in self.applied]),
        }
        self.prepare = getattr(bootstrap, "plan_migration_checksum_baseline", None)

    def run_plan(self, **changes):
        self.assertTrue(callable(self.prepare), "Migration checksum baseline validation is missing")
        values = {
            "environment": "staging",
            "expected_environment": "staging",
            "expected_source": copy.deepcopy(self.source),
            "active_source": copy.deepcopy(self.source),
            "image_rows": copy.deepcopy(self.rows),
            "ledger_rows": copy.deepcopy(self.applied),
        }
        values.update(changes)
        return self.prepare(**values)

    def test_accepts_the_exact_active_image_and_plans_only_checksums_for_applied_rows(self):
        result = self.run_plan()
        self.assertEqual(result["environment"], "staging")
        self.assertEqual(result["source"], self.source)
        self.assertEqual(result["updates"], [
            {"migration_id": "0001_first", "checksum": "a" * 64},
            {"migration_id": "0002_second", "checksum": "b" * 64},
        ])
        self.assertNotIn("pending", result)

    def test_repeat_is_idempotent_when_the_existing_checksums_match(self):
        applied = copy.deepcopy(self.applied)
        applied[0]["checksum"] = "a" * 64
        applied[1]["checksum"] = "b" * 64
        self.assertEqual(self.run_plan(ledger_rows=applied)["updates"], [])

    def test_refuses_wrong_environment_source_image_or_inventory_fingerprint(self):
        with self.assertRaises(ValueError):
            self.run_plan(environment="production")
        changed = copy.deepcopy(self.source)
        changed["api_image"] = "sha256:" + "4" * 64
        with self.assertRaises(ValueError):
            self.run_plan(active_source=changed)
        changed = copy.deepcopy(self.source)
        changed["migrations"] = "f" * 64
        with self.assertRaises(ValueError):
            self.run_plan(active_source=changed)

    def test_refuses_unknown_duplicate_or_checksum_conflicting_ledger_rows(self):
        unknown = copy.deepcopy(self.applied)
        unknown[1]["migration_id"] = "0099_unknown"
        with self.assertRaises(ValueError):
            self.run_plan(ledger_rows=unknown)
        with self.assertRaises(ValueError):
            self.run_plan(ledger_rows=self.applied + [copy.deepcopy(self.applied[0])])
        changed = copy.deepcopy(self.applied)
        changed[0]["checksum"] = "f" * 64
        with self.assertRaises(ValueError):
            self.run_plan(ledger_rows=changed)

    def test_refuses_to_baseline_an_incomplete_or_out_of_order_applied_inventory(self):
        with self.assertRaises(ValueError):
            self.run_plan(ledger_rows=self.applied[:1])
        with self.assertRaises(ValueError):
            self.run_plan(ledger_rows=list(reversed(self.applied)))

    def test_baseline_sql_is_limited_to_the_ledger_ddl_and_updates_for_existing_rows(self):
        plan = self.run_plan()
        render = getattr(bootstrap, "migration_baseline_statements", None)
        self.assertTrue(callable(render), "Migration baseline SQL boundary is missing")
        statements = render(plan, "ALTER TABLE public.arden_schema_migrations ADD COLUMN IF NOT EXISTS checksum text;")
        self.assertEqual(len(statements), 8)
        self.assertEqual(statements[0], "BEGIN;")
        self.assertIn("pg_advisory_xact_lock", statements[1])
        self.assertTrue(statements[2].startswith("ALTER TABLE public.arden_schema_migrations"))
        self.assertTrue(statements[3].startswith("DO $$"))
        self.assertIn("UPDATE public.arden_schema_migrations SET checksum", statements[4])
        self.assertIn("UPDATE public.arden_schema_migrations SET checksum", statements[5])
        self.assertEqual(statements[6], "COMMIT;")
        self.assertIn("SELECT migration_id", statements[7])
        self.assertTrue(all("INSERT INTO" not in statement and "DROP " not in statement for statement in statements))


if __name__ == "__main__":
    unittest.main()
