import copy
import hashlib
import json
from importlib.util import module_from_spec, spec_from_file_location
import sys
import tempfile
import types
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap
from test_protocol import fixture


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
        self.migration_inventory = [
            {"id": "0001", "filename": "0001_first.sql", "sha256": "a" * 64, "rollout": "operator"},
            {"id": "0002", "filename": "0002_second.sql", "sha256": "b" * 64, "rollout": "operator"},
        ]
        self.source = {
            "commit": "1" * 40,
            "tree": "2" * 40,
            "api_image": "sha256:" + "3" * 64,
            "migrations": hashlib.sha256(json.dumps(self.migration_inventory, separators=(",", ":"),
                                                     ensure_ascii=False).encode()).hexdigest(),
        }
        self.prepare = getattr(bootstrap, "plan_migration_checksum_baseline", None)

    def test_checksum_baseline_uses_verified_active_release_not_immutable_bootstrap_snapshot(self):
        operator = load_operator()
        manifest, _ = fixture()
        state = {"pending": None, "active": {
            "manifest": manifest,
            "deployment_commit": "f" * 40,
            "eligible_for_promotion": False,
        }}

        selected = operator.active_manifest_for_baseline(state, "production")
        self.assertIs(selected, manifest)
        self.assertNotEqual(state["active"]["deployment_commit"], manifest["commit"])

        for change in [
            lambda value: value.update(pending={"phase": "migrating"}),
            lambda value: value["active"].update(deployment_commit="invalid"),
            lambda value: value["active"].update(manifest={"commit": "0" * 40}),
        ]:
            invalid = copy.deepcopy(state)
            change(invalid)
            with self.subTest(state=invalid), self.assertRaises(ValueError):
                operator.active_manifest_for_baseline(invalid, "production")

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
            "migration_inventory": copy.deepcopy(self.migration_inventory),
        }
        values.update(changes)
        return self.prepare(**values)

    def test_legacy_active_manifest_derives_policy_inventory_from_exact_image_sql(self):
        operator = load_operator()
        future = {"id": "0005", "filename": "0005_later_change.sql",
                  "sha256": "c" * 64, "rollout": "operator"}
        policy = {"schema": 1, "migrations": self.migration_inventory + [future]}
        legacy_fingerprint = bootstrap.verify_migration_inventory(
            self.rows, [row["migration_id"] for row in self.applied])
        manifest = {"commit": self.source["commit"], "tree": self.source["tree"],
                    "migrations": legacy_fingerprint,
                    "images": {"api": {"id": self.source["api_image"]}}}

        inventory, fingerprint = operator.active_migration_inventory(
            manifest, self.rows, self.applied, policy)

        self.assertEqual(inventory, self.migration_inventory)
        self.assertEqual(fingerprint, self.source["migrations"])
        self.assertNotEqual(fingerprint, legacy_fingerprint)
        for invalid_manifest, invalid_rows, invalid_policy in [
            ({**manifest, "migrations": "0" * 64}, self.rows, policy),
            (manifest, [{**self.rows[0], "sha256": "d" * 64}, self.rows[1]], policy),
            (manifest, self.rows, {"schema": 1, "migrations": [future]}),
        ]:
            with self.subTest(manifest=invalid_manifest, rows=invalid_rows, policy=invalid_policy), \
                    self.assertRaises(ValueError):
                operator.active_migration_inventory(
                    invalid_manifest, invalid_rows, self.applied, invalid_policy)

    def test_baseline_source_accepts_verified_portable_to_local_api_image_binding(self):
        operator = load_operator()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline_image = {"id": "sha256:" + "1" * 64, "tag": "arden-baseline-api"}
            portable_image = {"id": "sha256:" + "2" * 64, "tag": "arden-release-api"}
            local_image = "sha256:" + "3" * 64
            manager = object.__new__(operator.CoolifyManager)
            manager.config = {
                "baseline": {"images": {"api": baseline_image}},
                "state_dir": str(root / "staging"),
            }
            operator.write_json(root / "image-bindings.json", {portable_image["id"]: local_image})
            manifest = {"images": {"api": portable_image}}
            api = {
                "Image": local_image,
                "State": {"Running": True, "Health": {"Status": "healthy"}},
                "Config": {"Labels": {
                    "com.docker.compose.project": "abc123def456",
                    "com.docker.compose.service": "arden-api",
                }},
            }

            operator.verify_active_api_container(api, manifest, manager, "abc123def456")

            mismatched = copy.deepcopy(api)
            mismatched["Image"] = "sha256:" + "4" * 64
            with self.assertRaises(ValueError):
                operator.verify_active_api_container(mismatched, manifest, manager, "abc123def456")

    def test_accepts_the_exact_active_image_and_plans_only_checksums_for_applied_rows(self):
        result = self.run_plan()
        self.assertEqual(result["environment"], "staging")
        self.assertEqual(result["source"], self.source)
        self.assertEqual(result["migration_inventory"], self.migration_inventory)
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
        changed_inventory = copy.deepcopy(self.migration_inventory)
        changed_inventory[0]["sha256"] = "e" * 64
        with self.assertRaises(ValueError):
            self.run_plan(migration_inventory=changed_inventory)
        with self.assertRaises(ValueError):
            self.run_plan(image_rows=[{**self.rows[0], "sha256": "e" * 64}, self.rows[1]])

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
        image = "sha256:" + "9" * 64
        with patch.object(operator, "run", side_effect=["999\n", "ok"]) as execute:
            result = operator.run_migration_sql(
                image, "private-net", Path("/private/migration.env"), "SELECT 1;")
        self.assertEqual(result, "ok")
        identity_probe = execute.call_args_list[0].args[0]
        self.assertEqual(identity_probe[identity_probe.index("--user") + 1], "postgres")
        self.assertEqual(identity_probe[-3:], [image, "-c", "id -u"])
        arguments = execute.call_args_list[1].args[0]
        self.assertIn("--interactive", arguments)
        self.assertEqual(arguments[arguments.index("--user") + 1], "postgres")
        self.assertEqual(execute.call_args.kwargs, {"data": "SELECT 1;", "timeout": 90})

    def test_migration_owner_transfer_temporarily_grants_and_revokes_required_create_privileges(self):
        template = (Path(__file__).resolve().parents[1] / "migration-owner-template.sql").read_text(
            encoding="utf-8")
        grant = template.index("GRANT CREATE ON DATABASE")
        transfer = template.index("ALTER SCHEMA arden OWNER TO")
        database_revoke = template.rindex("REVOKE CREATE ON DATABASE")
        public_grant = template.index("GRANT CREATE ON SCHEMA public")
        ledger_transfer = template.index("ALTER TABLE public.arden_schema_migrations OWNER TO")
        public_revoke = template.rindex("REVOKE CREATE ON SCHEMA public")
        commit = template.rindex("COMMIT;")
        self.assertLess(grant, transfer)
        self.assertLess(transfer, database_revoke)
        self.assertLess(database_revoke, commit)
        self.assertLess(public_grant, ledger_transfer)
        self.assertLess(ledger_transfer, public_revoke)
        self.assertLess(public_revoke, commit)
        self.assertIn("current_database()", template)
        self.assertIn("__EXPECTED_DATABASE__", template)
        self.assertIn("objects outside its approved scope", template)
        self.assertIn("rolcanlogin", template)
        self.assertIn("t.typrelid = 'public.arden_schema_migrations'::regclass", template)
        self.assertIn("ledger_type.typarray", template)
        self.assertIn("format('GRANT CREATE ON DATABASE %I TO %I'", template)
        self.assertIn("format('REVOKE CREATE ON DATABASE %I FROM %I'", template)
        self.assertIn("format('GRANT CREATE ON SCHEMA public TO %I'", template)
        self.assertIn("format('REVOKE CREATE ON SCHEMA public FROM %I'", template)
        self.assertIn("format('GRANT USAGE ON SCHEMA public TO %I'", template)
        self.assertIn("format('GRANT CONNECT ON DATABASE %I TO %I'", template)

if __name__ == "__main__":
    unittest.main()
