import copy
from importlib.util import module_from_spec, spec_from_file_location
import sys
import tempfile
import types
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap


def load_operator():
    source = Path(__file__).resolve().parents[1] / "bootstrap_operator.py"
    spec = spec_from_file_location("test_bootstrap_operator", source)
    module = module_from_spec(spec)
    with patch.dict(sys.modules, {"pwd": types.ModuleType("pwd")}):
        spec.loader.exec_module(module)
    return module


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

    def test_prepare_repairs_legacy_journal_and_existing_config_before_cutover(self):
        operator = load_operator()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            config_dir = root / "config"
            journal_path = state / "bootstrap" / "staging.json"
            config_path = config_dir / "staging.json"
            legacy = {
                "phase": "prepared",
                "original_api": {"NetworkSettings": {"Networks": {"private-db": {}}}},
                "values": {"DATABASE_URL": "postgresql://arden_runtime:synthetic-password@database/arden"},
                "protected_ids": {"database": "container-id"},
                "config": {"environment": "staging", "service_uuid": "abcdefgh",
                           "protected_containers": ["database"]},
            }
            current_config = {"environment": "staging", "service_uuid": "abcdefgh", "state_dir": str(state)}
            operator.write_json(journal_path, legacy)
            operator.write_json(config_path, current_config)
            database = {"Id": "container-id", "Image": "sha256:" + "9" * 64,
                        "NetworkSettings": {"Networks": {"private-db": {}}}}

            with patch.object(operator, "STATE", state), patch.object(operator, "CONFIG", config_dir), \
                    patch.object(operator, "database_peer", return_value="database"), \
                    patch.object(operator, "inspect", return_value=database), \
                    patch.object(operator, "secure_file"):
                result = operator.prepare("staging", {}, {})

            repaired_journal = operator.read_json(journal_path)
            repaired_config = operator.read_json(config_path)
            expected = {
                "network": "private-db", "database_image": "sha256:" + "9" * 64,
                "database_host": "database", "database_name": "arden",
                "runtime_database_user": "arden_runtime",
                "env_file": "/etc/arden/releases/staging.migration.env",
            }
            self.assertEqual(result["config"]["migration"], expected)
            self.assertEqual(repaired_journal["config"]["migration"], expected)
            self.assertEqual(repaired_config["migration"], expected)
            self.assertNotIn("synthetic-password", str(repaired_journal["config"]["migration"]))
            self.assertNotIn("synthetic-password", config_path.read_text(encoding="utf-8"))

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
        self.assertEqual(statements[1],
                         "DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('arden:migrations')); END $$;")
        self.assertTrue(statements[2].startswith("ALTER TABLE public.arden_schema_migrations"))
        self.assertTrue(statements[3].startswith("DO $$"))
        self.assertIn("UPDATE public.arden_schema_migrations SET checksum", statements[4])
        self.assertIn("UPDATE public.arden_schema_migrations SET checksum", statements[5])
        self.assertEqual(statements[6], "COMMIT;")
        self.assertIn("SELECT migration_id", statements[7])
        self.assertTrue(all("INSERT INTO" not in statement and "DROP " not in statement for statement in statements))

    def test_operator_migration_client_forwards_sql_stdin_to_docker(self):
        operator = load_operator()
        with patch.object(operator, "run", return_value="ok") as execute:
            result = operator.run_migration_sql(
                "db-image", "private-net", Path("/private/migration.env"), "SELECT 1;")
        self.assertEqual(result, "ok")
        arguments = execute.call_args.args[0]
        self.assertIn("--interactive", arguments)
        self.assertEqual(execute.call_args.kwargs, {"data": "SELECT 1;", "timeout": 90})

if __name__ == "__main__":
    unittest.main()
