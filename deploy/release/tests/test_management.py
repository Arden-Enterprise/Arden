import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
import tempfile
import io
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import fixture
try:
    from management import (validate_config, CoolifyManager, migration_role_name,
                            migration_role_probe_sql, valid_migration_role_probe,
                            valid_migration_baseline_receipt)
except ModuleNotFoundError:
    validate_config = CoolifyManager = migration_role_name = migration_role_probe_sql = None
    valid_migration_role_probe = valid_migration_baseline_receipt = None


def configuration():
    manifest, _ = fixture()
    return {"environment": "staging", "service_uuid": "abc123def456", "api_url": "http://127.0.0.1:8000/api/v1",
            "token_path": "/etc/arden/releases/management.token", "origin": "https://staging.example.test",
            "state_dir": "/var/lib/arden/releases/staging", "staging_dir": "/var/lib/arden/releases/staging",
            "migrations": "c" * 64, "baseline": manifest, "protected_containers": ["auth-example"],
            "template": {"services": {component: {"image": manifest["images"][kind]["id"],
                         "pull_policy": "never", "user": uid, "read_only": True,
                         "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"]}
                         for component, kind, uid in [("arden-api", "api", "1000:1000"),
                                                       ("arden-web", "web", "101:101")]}}}


def migration_configuration():
    config = configuration()
    config["migrations"] = config["baseline"]["migrations"]
    config["migration"] = {
        "network": "arden-database-private",
        "database_image": "sha256:" + "9" * 64,
        "database_host": "database",
        "database_name": "postgres",
        "runtime_database_user": "arden_runtime",
        "env_file": "/etc/arden/releases/staging.migration.env",
    }
    config["template"]["networks"] = {
        "default": {}, "database": {"external": True, "name": "arden-database-private"}}
    config["template"]["services"]["arden-api"]["networks"] = {"database": {}}
    return config


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(validate_config, "Management adapter is not implemented")
        self.config = configuration()

    def test_configuration_accepts_only_app_services_and_loopback_management(self):
        self.assertEqual(validate_config(self.config, "staging")["service_uuid"], "abc123def456")
        changes = [lambda c: c.update(environment="production"),
                   lambda c: c.update(api_url="https://attacker.example/api/v1"),
                   lambda c: c.update(api_url="http://user:password@127.0.0.1:8000/api/v1"),
                   lambda c: c["template"]["services"].update(database={}),
                   lambda c: c["template"]["services"]["arden-api"].update(build="."),
                   lambda c: c["template"]["services"]["arden-api"].update(privileged=True),
                   lambda c: c["template"]["services"]["arden-api"].update(user="0:0"),
                   lambda c: c["template"]["services"]["arden-api"].update(ports=["3001:3001"])]
        for change in changes:
            c = copy.deepcopy(self.config)
            change(c)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_config(c, "staging")

    def test_migration_login_is_a_noninheriting_owner_only_for_arden_and_its_ledger(self):
        self.assertEqual(migration_role_name("staging"), "arden_release_migration_staging")
        with self.assertRaises(ValueError):
            migration_role_name("unknown")

        good = ["postgres", "arden_release_migration_staging"] + ["false"] * 6 + ["true"] * 13
        self.assertTrue(valid_migration_role_probe("|".join(good), "postgres", good[1]))
        for index in range(2, len(good)):
            invalid = good.copy()
            invalid[index] = "false" if good[index] == "true" else "true"
            with self.subTest(index=index):
                self.assertFalse(valid_migration_role_probe("|".join(invalid), "postgres", good[1]))
        self.assertFalse(valid_migration_role_probe("|".join(good), "arden", good[1]))

        query = migration_role_probe_sql()
        self.assertEqual(query.count("|| '|' ||") + 1, len(good))
        self.assertIn("n.nspname = 'arden'", query)
        self.assertIn("public.arden_schema_migrations", query)
        self.assertIn("pg_auth_members", query)
        self.assertIn("'public', 'CREATE'", query)
        self.assertIn("'public', 'USAGE'", query)
        self.assertIn("has_database_privilege(current_user, current_database(), 'CREATE')", query)
        self.assertIn("t.typrelid = 'public.arden_schema_migrations'::regclass", query)
        self.assertIn("ledger_type.typarray", query)
        self.assertNotIn("REASSIGN OWNED", query)

    def test_checksum_baseline_receipt_tracks_verified_active_image_not_bootstrap_snapshot(self):
        active, _ = fixture()
        config = configuration()
        config["baseline"] = copy.deepcopy(active)
        config["baseline"]["commit"] = "f" * 40
        self.assertNotEqual(config["baseline"]["commit"], active["commit"])
        checksums = [{"migration_id": row["filename"][:-4], "checksum": row["sha256"]}
                     for row in active["migration_inventory"]]
        receipt = {
            "schema": 2,
            "environment": "staging",
            "source": {"commit": active["commit"], "tree": active["tree"],
                       "api_image": active["images"]["api"]["id"],
                       "migrations": active["migrations"]},
            "migration_inventory": active["migration_inventory"],
            "checksums": checksums,
            "verified_at": 1,
        }
        self.assertTrue(valid_migration_baseline_receipt(receipt, "staging"))
        for change in [
            lambda value: value.update(environment="production"),
            lambda value: value["source"].update(migrations="0" * 64),
            lambda value: value["checksums"].pop(),
            lambda value: value["migration_inventory"][0].update(rollout="unknown"),
        ]:
            invalid = copy.deepcopy(receipt)
            change(invalid)
            with self.subTest(receipt=invalid):
                self.assertFalse(valid_migration_baseline_receipt(invalid, "staging"))

    def test_image_update_preserves_all_runtime_and_storage_configuration(self):
        self.config["template"]["services"]["arden-api"].update(
            environment={"DATABASE_URL": "${DATABASE_URL}"}, volumes=["private:/var/lib/arden/private"])
        self.config["template"]["volumes"] = {"private": {"external": True, "name": "preserved-private"}}
        manager = CoolifyManager(self.config, request=lambda *args: None, command=lambda *args: None)
        manifest, _ = fixture()
        manifest["images"]["api"]["id"] = "sha256:" + "d" * 64
        with patch.object(manager, "image_id", lambda release, component: release["images"][component]["id"]):
            source = manager.compose_for(manifest)
        api = source["services"]["arden-api"]
        self.assertEqual(api["environment"], {"DATABASE_URL": "${DATABASE_URL}"})
        self.assertEqual(api["volumes"], ["private:/var/lib/arden/private"])
        self.assertEqual(api["image"], "sha256:" + "d" * 64)
        self.assertNotEqual(self.config["template"]["services"]["arden-api"]["image"], api["image"])

    def test_unrelated_live_configuration_drift_blocks_activation(self):
        remote = copy.deepcopy(self.config["template"])
        remote["services"]["arden-api"]["environment"] = {"UNEXPECTED": "value"}
        calls = []

        def request(method, path, body=None):
            calls.append(method)
            return {"docker_compose_raw": json.dumps(remote)}

        manager = CoolifyManager(self.config, request=request, command=lambda *args: None)
        manifest, _ = fixture()
        with self.assertRaises(ValueError):
            manager.activate(manifest)
        self.assertEqual(calls, ["GET"])

    def test_prior_async_operation_must_finish_before_configuration_is_replaced(self):
        events = []
        statuses = iter(["queued", "finished", "finished"])

        def request(method, path, body=None):
            events.append(method)
            return {"docker_compose_raw": json.dumps(self.config["template"])}

        def operation(action):
            status = next(statuses) if action == "status" else "queued"
            events.append(status)
            return {"status": status, "activity_id": 1}

        def command(args):
            return '{"id":"protected-id","image":"unused","state":{"Running":true}}'

        try:
            manager = CoolifyManager(self.config, request=request, command=command, operation=operation)
        except TypeError:
            self.fail("Correlated Coolify operation handling is not implemented")
        manifest, _ = fixture()
        manager.activate(manifest)
        self.assertLess(events.index("finished"), events.index("PATCH"))
        self.assertEqual(events[-1], "finished")

    def test_uncertain_prior_operation_blocks_another_mutation(self):
        events = []

        def request(method, path, body=None):
            events.append(method)
            return {"docker_compose_raw": json.dumps(self.config["template"])}

        try:
            manager = CoolifyManager(self.config, request=request, command=lambda *args: None,
                                     operation=lambda action: {"status": "uncertain"})
        except TypeError:
            self.fail("Correlated Coolify operation handling is not implemented")
        manifest, _ = fixture()
        with self.assertRaises(RuntimeError):
            manager.activate(manifest)
        self.assertEqual(events, ["GET"])

    def test_portable_config_identity_is_bound_to_verified_store_local_image(self):
        from protocol import validate_archive
        manifest, payload = fixture()
        proof = validate_archive(io.BytesIO(payload), manifest)
        local = {"api": "sha256:" + "8" * 64, "web": "sha256:" + "9" * 64}
        with tempfile.TemporaryDirectory() as temporary:
            config = copy.deepcopy(self.config)
            config["state_dir"] = str(Path(temporary) / "staging")
            config["baseline"]["images"] = {kind: {"id": "sha256:" + digit * 64}
                                            for kind, digit in [("api", "1"), ("web", "2")]}
            mutations = {}
            def command(arguments):
                if arguments[:2] == ["image", "load"]:
                    return ""
                target = arguments[-1]
                kind = next(kind for kind in local if target in {manifest["images"][kind]["tag"], local[kind]})
                if arguments[3] == "{{.Id}}":
                    return local[kind]
                inspect_config = {**proof[kind]["config"], "ArgsEscaped": False,
                                  "Hostname": "", "AttachStdin": False}
                inspect_config.update(mutations)
                return json.dumps({"Id": local[kind], "Architecture": "amd64", "Os": "linux",
                                   "Config": inspect_config, "RootFS": {"Layers": []}})
            manager = CoolifyManager(config, command=command)
            manager.load(Path(temporary) / "synthetic.tar.gz", manifest, proof)
            manager.ensure_images(manifest)
            self.assertEqual(manager.compose_for(manifest)["services"]["arden-api"]["image"], local["api"])
            self.assertNotEqual(local["api"], manifest["images"]["api"]["id"])
            mutations["User"] = "0:0"
            with self.assertRaises(ValueError):
                manager.load(Path(temporary) / "synthetic.tar.gz", manifest, proof)

    def test_incomplete_import_cleanup_checks_content_and_preserves_retained_local_ids(self):
        from protocol import validate_archive
        manifest, payload = fixture()
        proof = validate_archive(io.BytesIO(payload), manifest)
        ids = ["sha256:" + digit * 64 for digit in ["7", "8", "9"]]
        removed = []
        def command(args):
            if args[:2] == ["image", "ls"]:
                self.assertIn("label=io.arden.release.managed=1", args)
                self.assertIn("label=org.opencontainers.image.revision=" + manifest["commit"], args)
                return "\n".join(ids)
            candidate = args[-1]
            config = copy.deepcopy(proof["api"]["config"])
            if candidate == ids[2]:
                config["User"] = "0:0"
            return json.dumps({"Id": candidate, "Os": "linux", "Architecture": "amd64",
                               "Config": config, "RootFS": {"Layers": []}})
        manager = CoolifyManager(self.config, command=command)
        with patch.object(manager, "_remove_local_image", side_effect=lambda *args: removed.append(args)):
            manager.remove_incomplete_upload(manifest, proof, {ids[0]})
        self.assertEqual(removed, [(ids[1], manifest["commit"])])

    def test_migration_configuration_is_exact_and_uses_only_an_api_private_network(self):
        config = migration_configuration()
        self.assertEqual(validate_config(config, "staging")["migration"]["network"], "arden-database-private")
        mutations = [lambda c: c["migration"].update(network="bridge"),
                     lambda c: c["migration"].update(database_image="latest"),
                     lambda c: c["migration"].update(env_file="/tmp/attacker.env"),
                     lambda c: c["migration"].update(command=["sh", "-c", "id"]),
                     lambda c: c["template"]["services"]["arden-api"].update(networks={}),
                     lambda c: c["template"]["networks"]["database"].update(external=False)]
        for mutate in mutations:
            bad = copy.deepcopy(config)
            mutate(bad)
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_config(bad, "staging")

    def test_migration_runner_uses_fixed_candidate_api_image_private_network_and_limits(self):
        config = migration_configuration()
        calls = []

        def run(arguments, timeout=0):
            calls.append((arguments, timeout))
            if "--entrypoint" in arguments and arguments[arguments.index("--entrypoint") + 1] == "node":
                return '{"status":"APPLIED","migration_ids":["0001_example"]}\n'
            self.fail("The manager attempted an unexpected migration command")

        manager = CoolifyManager(config, command=lambda _args: "", migration_command=run)
        manifest, _ = fixture()
        with patch.object(manager, "image_id", side_effect=lambda release, component: release["images"][component]["id"]), \
             patch.object(manager, "ensure_images"), \
             patch.object(manager, "plan_migrations", side_effect=[
                 {"status": "READY", "migration_ids": ["0001_example"]},
                 {"status": "NO_PENDING", "migration_ids": []}]), \
             patch.object(manager, "_migration_settings", return_value=config["migration"]), \
             patch.object(manager, "_assert_migration_lock_free"):
            result = manager.apply_migrations(manifest)
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual(len(calls), 1)
        arguments, timeout = calls[0]
        self.assertEqual(timeout, 900)
        self.assertIn("--network", arguments)
        self.assertEqual(arguments[arguments.index("--network") + 1], "arden-database-private")
        self.assertEqual(arguments[arguments.index("--env-file") + 1], config["migration"]["env_file"])
        self.assertTrue(all(option in arguments for option in ["--rm", "--pull=never", "--read-only",
                         "--memory", "512m", "--cpus", "0.75", "--pids-limit", "64",
                         "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true"]))
        name_index = arguments.index("--name")
        self.assertEqual(arguments[name_index + 1], "arden-release-migration-staging-12345-1")
        entrypoint = arguments.index("--entrypoint")
        self.assertEqual(arguments[entrypoint + 1:], ["node", manifest["images"]["api"]["id"],
                                                       "dist/db/migrate.js", "--apply-safe"])
        self.assertNotIn("--privileged", arguments)
        self.assertNotIn("--network", arguments[arguments.index("--entrypoint") + 2:])

    def test_timed_out_migration_stops_and_verifies_its_named_container(self):
        import management
        config = migration_configuration()
        name = "arden-release-migration-staging-12345-1"
        calls = []
        states = iter(["true\n", "false\n"])

        def docker(arguments):
            calls.append(arguments)
            if arguments[0] == "inspect":
                return next(states)
            if arguments[0] == "stop":
                return name + "\n"
            if arguments[0] == "ps":
                return ""
            self.fail("Unexpected Docker recovery command")

        manager = CoolifyManager(config, command=docker)
        with patch.object(management.subprocess, "run", side_effect=management.subprocess.TimeoutExpired(
                ["/usr/bin/docker", "run"], timeout=900)):
            with self.assertRaisesRegex(RuntimeError, "requires reconciliation"):
                manager.migration_command(["/usr/bin/docker", "run", "--name", name], timeout=900)
        self.assertEqual([call[0] for call in calls], ["inspect", "stop", "inspect"])

    def test_migration_reconciliation_proves_the_database_lock_is_free_after_stop(self):
        config = migration_configuration()
        manifest, _ = fixture()
        name = "arden-release-migration-staging-12345-1"
        image = config["migration"]["database_image"]
        events = []
        states = iter(["true\n", "false\n"])

        def docker(arguments):
            if arguments[0] == "inspect" and "{{.State.Running}}" in arguments:
                events.append("container-state")
                return next(states)
            if arguments[0] == "stop":
                events.append("container-stop")
                return name + "\n"
            if arguments[0] == "image" and "{{.Id}}" in arguments:
                return image
            if arguments[0] == "image" and "{{.Config.User}}" in arguments:
                return "1000:1000"
            self.fail("Unexpected Docker reconciliation command")

        def migration_command(arguments, timeout):
            events.append("lock-probe")
            self.assertEqual(timeout, 30)
            self.assertIn(config["migration"]["env_file"], arguments)
            self.assertIn("arden:migrations", arguments[-1])
            self.assertIn("pg_try_advisory_lock", arguments[-1])
            self.assertIn("pg_advisory_unlock", arguments[-1])
            return "t\n"

        manager = CoolifyManager(config, command=docker, migration_command=migration_command)
        settings = {**config["migration"], "migration_database_user": "arden_release_migration_staging"}
        with patch.object(manager, "_migration_settings", return_value=settings):
            manager.reconcile_migration_execution(manifest)
        self.assertLess(events.index("container-stop"), events.index("lock-probe"))

    def test_migration_apply_checks_the_database_lock_before_replanning(self):
        config = migration_configuration()
        manifest, _ = fixture()
        events = []
        migration_result = json.dumps({"status": "APPLIED", "migration_ids": ["0001_example"]})

        def plan(_manifest):
            events.append("plan")
            return {"status": "READY", "migration_ids": ["0001_example"]} if events.count("plan") == 1 else {
                "status": "NO_PENDING", "migration_ids": []}

        def migration_command(arguments, timeout):
            events.append("runner" if "dist/db/migrate.js" in arguments else "lock-probe")
            return migration_result if "dist/db/migrate.js" in arguments else "t\n"

        manager = CoolifyManager(config, migration_command=migration_command)
        settings = {**config["migration"], "migration_database_user": "arden_release_migration_staging"}
        with patch.object(manager, "plan_migrations", side_effect=plan), \
             patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "ensure_images"), \
             patch.object(manager, "image_id", side_effect=lambda release, component: release["images"][component]["id"]), \
             patch.object(manager, "_assert_migration_lock_free", side_effect=lambda _settings: events.append("lock-check")):
            result = manager.apply_migrations(manifest)

        self.assertEqual(result["status"], "APPLIED")
        self.assertLess(events.index("runner"), events.index("lock-check"))
        self.assertLess(events.index("lock-check"), events.index("plan", 1))

    def test_migration_reconciliation_refuses_to_clear_pending_while_database_lock_is_held(self):
        config = migration_configuration()
        manifest, _ = fixture()
        image = config["migration"]["database_image"]

        def docker(arguments):
            if arguments[0] == "inspect" and "{{.State.Running}}" in arguments:
                return "false\n"
            if arguments[0] == "image" and "{{.Id}}" in arguments:
                return image
            if arguments[0] == "image" and "{{.Config.User}}" in arguments:
                return "1000:1000"
            self.fail("Unexpected Docker reconciliation command")

        manager = CoolifyManager(config, command=docker, migration_command=lambda *args, **kwargs: "f\n")
        settings = {**config["migration"], "migration_database_user": "arden_release_migration_staging"}
        with patch.object(manager, "_migration_settings", return_value=settings), \
                self.assertRaisesRegex(RuntimeError, "advisory lock"):
            manager.reconcile_migration_execution(manifest)

    def test_migration_runner_failure_reconciles_without_leaking_command_output(self):
        config = migration_configuration()
        manager = CoolifyManager(config, migration_command=lambda *args, **kwargs:
                                 (_ for _ in ()).throw(RuntimeError("synthetic database password")))
        manifest, _ = fixture()
        with patch.object(manager, "ensure_images"), \
             patch.object(manager, "image_id", side_effect=lambda release, component: release["images"][component]["id"]), \
             patch.object(manager, "plan_migrations", side_effect=[
                 {"status": "READY", "migration_ids": ["0001_example"]},
                 {"status": "READY", "migration_ids": ["0001_example"]}]), \
             patch.object(manager, "_migration_settings", return_value=config["migration"]), \
             patch.object(manager, "_assert_migration_lock_free"):
            with self.assertRaises(RuntimeError) as caught:
                manager.apply_migrations(manifest)
        self.assertNotIn("synthetic database password", str(caught.exception))

    def test_migration_plan_distinguishes_ready_operator_drift_baseline_and_backup(self):
        config = migration_configuration()
        manager = CoolifyManager(config, command=lambda _args: "")
        manifest, _ = fixture()
        settings = config["migration"]
        with patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "_baseline_receipt_ready", return_value=True), \
             patch.object(manager, "_read_migration_ledger", return_value=[]), \
             patch.object(manager, "_backup_ready", return_value=True):
            self.assertEqual(manager.plan_migrations(manifest),
                             {"status": "READY", "migration_ids": ["0001_example"]})
        with patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "_baseline_receipt_ready", return_value=True), \
             patch.object(manager, "_read_migration_ledger", return_value=[]), \
             patch.object(manager, "_backup_ready", return_value=False):
            self.assertEqual(manager.plan_migrations(manifest),
                             {"status": "BACKUP_NOT_READY", "migration_ids": ["0001_example"]})
        with patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "_baseline_receipt_ready", return_value=False):
            self.assertEqual(manager.plan_migrations(manifest),
                             {"status": "BASELINE_REQUIRED", "migration_ids": []})
        for ledger, expected in [
            ([{"migration_id": "0009_unknown", "checksum": "f" * 64}], "DRIFT"),
            ([{"migration_id": "0001_example", "checksum": "d" * 64}], "NO_PENDING"),
        ]:
            with patch.object(manager, "_migration_settings", return_value=settings), \
                 patch.object(manager, "_baseline_receipt_ready", return_value=True), \
                 patch.object(manager, "_read_migration_ledger", return_value=ledger), \
                 patch.object(manager, "_backup_ready", return_value=False):
                self.assertEqual(manager.plan_migrations(manifest), {"status": expected, "migration_ids": []})
        operator = copy.deepcopy(manifest)
        operator["migration_inventory"][0]["rollout"] = "operator"
        operator["migrations"] = hashlib.sha256(json.dumps(operator["migration_inventory"],
            separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        with patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "_baseline_receipt_ready", return_value=True), \
             patch.object(manager, "_read_migration_ledger", return_value=[]), \
             patch.object(manager, "_backup_ready", side_effect=AssertionError("operator migration must not check backups")):
            self.assertEqual(manager.plan_migrations(operator),
                             {"status": "REQUIRES_OPERATOR", "migration_ids": ["0001_example"]})

    def test_read_only_ledger_probe_uses_pinned_database_image_and_fixed_private_query(self):
        config = migration_configuration()
        image = config["migration"]["database_image"]
        settings = {**config["migration"], "migration_database_user": "arden_release_migration_staging"}
        commands = []

        def docker(arguments):
            if "{{.Id}}" in arguments:
                return image
            if "{{.Config.User}}" in arguments:
                return "postgres"
            self.fail("Unexpected Docker image inspection")

        def migration_command(arguments, timeout):
            commands.append((arguments, timeout))
            role = "|".join(["postgres", "arden_release_migration_staging"]
                            + ["false"] * 6 + ["true"] * 13)
            return (f"READY\nROLE|{role}\n"
                    "0001_example|" + "d" * 64 + "\n")

        manager = CoolifyManager(config, command=docker, migration_command=migration_command)
        manifest, _ = fixture()
        with patch.object(manager, "_migration_settings", return_value=settings), \
             patch.object(manager, "_baseline_receipt_ready", return_value=True):
            result = manager.plan_migrations(manifest)
        self.assertEqual(result, {"status": "NO_PENDING", "migration_ids": []})
        arguments, timeout = commands[0]
        self.assertEqual(timeout, 60)
        self.assertEqual(arguments[arguments.index("--network") + 1], "arden-database-private")
        self.assertEqual(arguments[arguments.index("--env-file") + 1], settings["env_file"])
        self.assertEqual(arguments[arguments.index("--env") + 1],
                         "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000")
        self.assertEqual(arguments[-4:-1], ["/bin/sh", image, "-c"])
        self.assertIn("MISSING_CHECKSUM", arguments[-1])
        self.assertIn("ORDER BY migration_id", arguments[-1])
        self.assertNotIn("SELECT ", " ".join(arguments[:arguments.index("-c")]))


if __name__ == "__main__":
    unittest.main()
