import copy
import io
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import json
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import fixture
from identity import request_digest
try:
    from receiver import ReleaseEngine
except ModuleNotFoundError:
    ReleaseEngine = None


class MemoryManager:
    """A resource model with real state transitions and injected external failures."""

    def __init__(self):
        self.original, _ = fixture()
        self.original["commit"] = "f" * 40
        self.original["tree"] = "e" * 40
        for component, digit in [("api", "1"), ("web", "2")]:
            self.original["images"][component] = {
                "tag": f"arden-release-{component}:sha-{'f' * 40}", "id": "sha256:" + digit * 64}
        self.current = copy.deepcopy(self.original)
        self.loaded = {image["id"] for image in self.current["images"].values()}
        self.fail_next_activation = False
        self.fail_all_verification = False
        self.fail_recovery = False
        self.migration_status = "NO_PENDING"
        self.migration_events = []
        self.fail_migration = False

    def baseline(self):
        return copy.deepcopy(self.original)

    def load(self, path, manifest, proof):
        self.loaded.update(image["id"] for image in manifest["images"].values())

    def ensure_images(self, manifest):
        if any(image["id"] not in self.loaded for image in manifest["images"].values()):
            raise ValueError("Image not loaded")

    def preflight(self, manifest):
        if manifest.get("schema") == 1 and manifest["migrations"] != "c" * 64:
            raise ValueError("Unapproved schema")

    def plan_migrations(self, candidate):
        self.migration_events.append("plan")
        ids = [row["filename"][:-4] for row in candidate["migration_inventory"]]
        return {"status": self.migration_status,
                "migration_ids": ids if self.migration_status == "READY" else []}

    def reconcile_migration_execution(self, _candidate):
        self.migration_events.append("reconcile")

    def reconcile_migration_execution(self, _candidate):
        self.migration_events.append("reconcile")

    def apply_migrations(self, manifest):
        self.migration_events.append("migrate")
        if self.fail_migration:
            self.fail_migration = False
            raise RuntimeError("synthetic migration failure")
        self.migration_status = "NO_PENDING"
        return {"status": "APPLIED", "migration_ids": [
            row["filename"][:-4] for row in manifest["migration_inventory"]]}

    def activate(self, manifest):
        if self.fail_next_activation:
            self.fail_next_activation = False
            self.current["images"]["api"] = copy.deepcopy(manifest["images"]["api"])
            if self.fail_recovery:
                self.fail_all_verification = True
            raise RuntimeError("Interrupted after partial replacement")
        self.current = copy.deepcopy(manifest)

    def verify(self, manifest):
        if self.fail_all_verification or self.current["images"] != manifest["images"]:
            raise RuntimeError("Running images do not match")


def verified_proof(op, manifest):
    """Injected root-verifier output for state-machine tests; crypto has its own real RSA tests."""
    request = {"op": op, "environment": "staging", "manifest": manifest}
    return {"provider": "github-actions-oidc", "repository_id": "1372698702", "owner_id": "329889661",
            "environment": "staging", "sha": manifest["commit"], "request_digest": request_digest(request)}


def plan_request(environment, manifest):
    return {"op": "plan-migrations", "environment": environment,
            "commit": manifest["commit"], "tree": manifest["tree"],
            "run_id": manifest["run_id"], "attempt": manifest["attempt"],
            "migrations": manifest["migrations"],
            "migration_inventory": copy.deepcopy(manifest["migration_inventory"])}


def reconcile_request(environment, manifest):
    return {"op": "reconcile-migrations", "environment": environment,
            "commit": manifest["commit"], "run_id": manifest["run_id"], "attempt": manifest["attempt"]}


def verified_plan_proof(request):
    return {"provider": "github-actions-oidc", "repository_id": "1372698702", "owner_id": "329889661",
            "environment": request["environment"], "sha": request["commit"],
            "request_digest": request_digest(request)}


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(ReleaseEngine, "Release receiver is not implemented")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # Hosted Windows runners can expose TEMP through an 8.3 alias. Use the
        # canonical fixture root; production still rejects symlinked state paths.
        self.root = Path(self.temp.name).resolve()
        self.manager = MemoryManager()
        self.engine = ReleaseEngine("staging", self.root / "staging", self.manager)
        self.manifest, self.payload = fixture()

    def upload(self):
        return self.engine.upload(self.manifest, io.BytesIO(self.payload), verified_proof("upload", self.manifest))

    def test_upload_validates_and_loads_without_activating(self):
        self.upload()
        self.assertEqual(self.manager.current["commit"], "f" * 40)
        self.assertIn(self.manifest["images"]["api"]["id"], self.manager.loaded)

    def test_interrupted_load_has_durable_intent_but_no_deploy_receipt(self):
        def interrupted(path, manifest, proof):
            intents = list((self.engine.root / "upload-intents").glob("*.json"))
            self.assertEqual(len(intents), 1)
            intent = json.loads(intents[0].read_text())
            self.assertEqual(intent["manifest"], manifest)
            self.assertEqual(intent["proof"], proof)
            raise RuntimeError("interrupted image import")
        self.manager.load = interrupted
        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            self.upload()
        self.assertFalse(self.engine._receipt(self.manifest).exists())
        with self.assertRaisesRegex(ValueError, "No matching"):
            self.engine.deploy(self.manifest)

    def test_receipt_write_failure_keeps_recoverable_upload_intent(self):
        from state import write_json
        def fail_receipt(path, value):
            if path.parent.name == "uploads":
                raise OSError("receipt disk failure")
            write_json(path, value)
        with patch("receiver.write_json", side_effect=fail_receipt):
            with self.assertRaisesRegex(OSError, "receipt disk failure"):
                self.upload()
        self.assertEqual(len(list((self.engine.root / "upload-intents").glob("*.json"))), 1)
        self.assertFalse(self.engine._receipt(self.manifest).exists())
        self.upload()
        self.assertEqual(list((self.engine.root / "upload-intents").glob("*.json")), [])

    def test_tampered_upload_never_loads_images_or_changes_active_release(self):
        with self.assertRaises(ValueError):
            self.engine.upload(self.manifest, io.BytesIO(b"tampered"))
        self.assertNotIn(self.manifest["images"]["api"]["id"], self.manager.loaded)
        self.assertEqual(self.manager.current["commit"], "f" * 40)

    def test_upload_reserves_expanded_image_space_before_loading(self):
        with patch("receiver.shutil.disk_usage", return_value=SimpleNamespace(free=2 * 1024 ** 3)):
            with self.assertRaises(ValueError):
                self.upload()
        self.assertNotIn(self.manifest["images"]["api"]["id"], self.manager.loaded)

    def test_deploy_requires_verified_uploaded_pair(self):
        with self.assertRaises(ValueError):
            self.engine.deploy(self.manifest)
        self.assertEqual(self.manager.current["commit"], "f" * 40)

    def test_success_is_persisted_and_duplicate_request_does_not_replace_containers(self):
        self.upload()
        self.engine.deploy(self.manifest)
        self.manager.fail_next_activation = True
        result = self.engine.deploy(self.manifest)
        self.assertEqual(result["status"], "already-current")
        self.assertEqual(self.engine.status()["active"]["manifest"]["images"], self.manifest["images"])
        self.assertTrue(self.manager.fail_next_activation)

    def test_successful_same_image_rerun_refreshes_verified_time_and_attempt(self):
        self.upload()
        with patch("receiver.time.time", return_value=100):
            self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        rerun = copy.deepcopy(self.manifest)
        rerun["attempt"] = 2
        self.engine.upload(rerun, io.BytesIO(self.payload), verified_proof("upload", rerun))
        with patch("receiver.time.time", return_value=100000):
            result = self.engine.deploy(rerun, verified_proof("deploy", rerun))
        self.assertEqual(result["status"], "already-current")
        state = self.engine.status()
        self.assertEqual(state["active"]["verified_at"], 100000)
        self.assertEqual(state["active"]["attempt"], 2)
        self.assertEqual(state["active"]["provenance"]["request_digest"],
                         verified_proof("deploy", state["active"]["manifest"])["request_digest"])

    def test_older_run_cannot_activate_after_a_newer_success(self):
        self.upload()
        self.engine.deploy(self.manifest)
        old = copy.deepcopy(self.manifest)
        old["run_id"] = "12344"
        with self.assertRaises(ValueError):
            self.engine.deploy(old)
        self.assertEqual(self.manager.current["images"], self.manifest["images"])

    def test_partial_activation_failure_restores_previous_pair_and_reports_failure(self):
        self.upload()
        self.manager.fail_next_activation = True
        with self.assertRaisesRegex(RuntimeError, "recovered"):
            self.engine.deploy(self.manifest)
        self.assertEqual(self.manager.current["images"], self.manager.original["images"])
        self.assertIsNone(self.engine.status().get("pending"))

    def test_failed_recovery_keeps_pending_state_and_blocks_success(self):
        self.upload()
        self.manager.fail_next_activation = True
        self.manager.fail_recovery = True
        with self.assertRaisesRegex(RuntimeError, "recovery failed"):
            self.engine.deploy(self.manifest)
        self.assertIsNotNone(self.engine.status().get("pending"))

    def test_unapproved_schema_never_replaces_the_app(self):
        self.upload()
        self.manager.preflight = lambda manifest: (_ for _ in ()).throw(ValueError("schema blocked"))
        with self.assertRaises(ValueError):
            self.engine.deploy(self.manifest)
        self.assertEqual(self.manager.current["images"], self.manager.original["images"])

    def test_signed_plan_is_read_only_and_returns_only_safe_status_and_ids(self):
        request = plan_request("staging", self.manifest)
        self.manager.migration_status = "READY"
        before = copy.deepcopy(self.manager.current)
        result = self.engine.plan_migrations(request, verified_plan_proof(request))
        self.assertEqual(result, {"status": "READY", "migration_ids": ["0001_example"]})
        self.assertEqual(self.manager.current, before)
        self.assertFalse((self.root / "staging" / "state.json").exists())
        with self.assertRaises(ValueError):
            self.engine.plan_migrations(request, {**verified_plan_proof(request), "request_digest": "0" * 64})

    def test_existing_schema_one_active_release_remains_readable_after_protocol_upgrade(self):
        self.upload()
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        path = self.root / "staging" / "state.json"
        state = json.loads(path.read_text())
        state["active"]["manifest"]["schema"] = 1
        state["active"]["manifest"].pop("migration_inventory")
        state["active"].pop("migration_receipt")
        path.write_text(json.dumps(state))
        status = self.engine.status()
        self.assertEqual(status["active"]["manifest"]["schema"], 1)

    def test_deploy_recomputes_plan_and_blocks_when_database_changes_after_preflight(self):
        self.upload()
        self.manager.migration_status = "READY"
        original_plan = self.manager.plan_migrations
        calls = []

        def change_after_plan(candidate):
            calls.append(True)
            if len(calls) == 1:
                return original_plan(candidate)
            self.manager.migration_status = "DRIFT"
            return {"status": "DRIFT", "migration_ids": []}

        self.manager.plan_migrations = change_after_plan
        request = plan_request("staging", self.manifest)
        self.engine.plan_migrations(request, verified_plan_proof(request))
        with self.assertRaisesRegex(ValueError, "DRIFT"):
            self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        self.assertEqual(self.manager.current["images"], self.manager.original["images"])
        self.assertNotIn("migrate", self.manager.migration_events)

    def test_safe_migrations_finish_before_candidate_activation_and_produce_receipt(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        state = self.engine.status()
        self.assertEqual(self.manager.migration_events, ["plan", "migrate"])
        receipt = state["active"].get("migration_receipt")
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(receipt["source"]["migrations"], self.manifest["migrations"])
        self.assertEqual(receipt["source"]["api_image"], self.manifest["images"]["api"]["id"])

    def test_migration_failure_keeps_app_unchanged_and_retry_reconciles_partial_progress(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.manager.fail_migration = True
        with self.assertRaisesRegex(RuntimeError, "migration"):
            self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        state = self.engine.status()
        self.assertEqual(self.manager.current["images"], self.manager.original["images"])
        self.assertEqual(state["pending"]["phase"], "migrating")

        retry = copy.deepcopy(self.manifest)
        retry["attempt"] = 2
        request = plan_request("staging", retry)
        self.assertEqual(self.engine.plan_migrations(request, verified_plan_proof(request)),
                         {"status": "RECOVERY_REQUIRED", "migration_ids": []})
        stale_recovery = reconcile_request("staging", self.manifest)
        self.assertEqual(self.engine.reconcile_migrations(stale_recovery, verified_plan_proof(stale_recovery)),
                         {"status": "STALE_RUN"})
        recovery = reconcile_request("staging", retry)
        self.assertEqual(self.engine.reconcile_migrations(recovery, verified_plan_proof(recovery)),
                         {"status": "RECONCILED"})
        self.assertEqual(self.engine.plan_migrations(request, verified_plan_proof(request)),
                         {"status": "READY", "migration_ids": ["0001_example"]})
        self.assertIsNone(self.engine.status().get("pending"))
        self.engine.upload(retry, io.BytesIO(self.payload), verified_proof("upload", retry))
        self.engine.deploy(retry, verified_proof("deploy", retry))
        self.assertEqual(self.manager.current["images"], retry["images"])
        self.assertIsNone(self.engine.status().get("pending"))

    def test_production_requires_verified_staging_migration_receipt(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        stage_state = self.root / "staging" / "state.json"
        state = json.loads(stage_state.read_text())
        state["active"].pop("migration_receipt", None)
        stage_state.write_text(json.dumps(state))
        production_manager = MemoryManager()
        production_manager.loaded.update(self.manager.loaded)
        target = ReleaseEngine("production", self.root / "production", production_manager,
                               staging_dir=self.root / "staging")
        with self.assertRaises(ValueError):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": self.manifest["tree"], "run_id": "12346", "attempt": 1})
        self.assertEqual(production_manager.current["images"], production_manager.original["images"])

    def test_production_plan_resolves_only_the_exact_verified_staging_release(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        production_manager = MemoryManager()
        seen = []
        production_manager.plan_migrations = lambda candidate: (
            seen.append(copy.deepcopy(candidate)) or {"status": "READY", "migration_ids": ["0001_example"]})
        target = ReleaseEngine("production", self.root / "production", production_manager,
                               staging_dir=self.root / "staging")
        request = plan_request("production", self.manifest)
        request["commit"] = "d" * 40  # Main merge commit; the candidate image remains the verified staging image.
        proof = verified_plan_proof(request)
        result = target.plan_migrations(request, proof)
        self.assertEqual(result, {"status": "READY", "migration_ids": ["0001_example"]})
        self.assertEqual(seen[0]["images"], self.manifest["images"])
        self.assertEqual(seen[0]["migration_inventory"], self.manifest["migration_inventory"])
        self.assertFalse((self.root / "production" / "state.json").exists())

    def test_production_rejects_corrupt_staging_state_before_considering_receipts(self):
        stage_path = self.root / "staging" / "state.json"
        self.engine.status()
        stage_path.write_text('{"active":null,"previous":null,"pending":null,"highest":[0,0]}')
        target = ReleaseEngine("production", self.root / "production", MemoryManager(),
                               staging_dir=self.root / "staging")
        with self.assertRaisesRegex(ValueError, "Stored release state"):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": "b" * 40, "run_id": "12346", "attempt": 1})

    def test_production_plan_fails_closed_when_verified_stage_does_not_match_source_inventory(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        production_manager = MemoryManager()
        production_manager.plan_migrations = lambda _candidate: self.fail(
            "An unmatched staging artifact must not reach the database planner")
        target = ReleaseEngine("production", self.root / "production", production_manager,
                               staging_dir=self.root / "staging")
        request = plan_request("production", self.manifest)
        request["commit"] = "d" * 40
        request["migration_inventory"][0]["sha256"] = "e" * 64
        request["migrations"] = hashlib.sha256(json.dumps(request["migration_inventory"],
            separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        result = target.plan_migrations(request, verified_plan_proof(request))
        self.assertEqual(result, {"status": "OUTCOME_UNKNOWN", "migration_ids": []})

    def test_app_activation_failure_after_expand_migration_recovers_previous_app(self):
        self.upload()
        self.manager.migration_status = "READY"
        self.manager.fail_next_activation = True
        with self.assertRaisesRegex(RuntimeError, "recovered"):
            self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        self.assertEqual(self.manager.current["images"], self.manager.original["images"])
        self.assertEqual(self.manager.migration_status, "NO_PENDING")

    def test_production_promotes_same_verified_images_for_a_different_merge_commit(self):
        self.upload()
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        production = MemoryManager()
        production.loaded.update(self.manager.loaded)
        target = ReleaseEngine("production", self.root / "production", production,
                               staging_dir=self.root / "staging")
        target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                        "tree": "b" * 40, "run_id": "12346", "attempt": 1})
        active = target.status()["active"]
        self.assertEqual(active["manifest"]["images"], self.manifest["images"])
        self.assertEqual(active["deployment_commit"], "d" * 40)
        self.assertEqual(active["manifest"]["commit"], "a" * 40)

    def test_legacy_or_forged_eligible_state_without_authenticated_build_cannot_promote(self):
        self.upload()
        self.engine.deploy(self.manifest)
        path = self.root / "staging" / "state.json"
        state = json.loads(path.read_text())
        state["active"]["eligible_for_promotion"] = True
        state["active"].pop("provenance", None)
        path.write_text(json.dumps(state))
        manager = MemoryManager()
        manager.loaded.update(self.manager.loaded)
        target = ReleaseEngine("production", self.root / "production", manager, staging_dir=self.root / "staging")
        with self.assertRaises(ValueError):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": "b" * 40, "run_id": "12346", "attempt": 1})

    def test_wrong_tree_or_unverified_baseline_cannot_be_promoted(self):
        target = ReleaseEngine("production", self.root / "production", MemoryManager(),
                               staging_dir=self.root / "staging")
        self.engine.status()
        with self.assertRaises(ValueError):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": "e" * 40, "run_id": "12346", "attempt": 1})

    def test_older_than_one_day_staging_verification_requires_a_fresh_stage_run(self):
        self.upload()
        self.engine.deploy(self.manifest, verified_proof("deploy", self.manifest))
        path = self.root / "staging" / "state.json"
        state = json.loads(path.read_text())
        state["active"]["verified_at"] = 1
        path.write_text(json.dumps(state))
        manager = MemoryManager()
        manager.loaded.update(self.manager.loaded)
        target = ReleaseEngine("production", self.root / "production", manager,
                               staging_dir=self.root / "staging")
        with self.assertRaises(ValueError):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": "b" * 40, "run_id": "12346", "attempt": 1})
        self.assertEqual(manager.current["images"], manager.original["images"])


if __name__ == "__main__":
    unittest.main()
