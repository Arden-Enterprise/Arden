import copy
import io
from pathlib import Path
import sys
import tempfile
import unittest
import json
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import fixture
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

    def baseline(self):
        return copy.deepcopy(self.original)

    def load(self, path, manifest, proof):
        self.loaded.update(image["id"] for image in manifest["images"].values())

    def ensure_images(self, manifest):
        if any(image["id"] not in self.loaded for image in manifest["images"].values()):
            raise ValueError("Image not loaded")

    def preflight(self, manifest):
        if manifest["migrations"] != "c" * 64:
            raise ValueError("Unapproved schema")

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


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(ReleaseEngine, "Release receiver is not implemented")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manager = MemoryManager()
        self.engine = ReleaseEngine("staging", self.root / "staging", self.manager)
        self.manifest, self.payload = fixture()

    def upload(self):
        return self.engine.upload(self.manifest, io.BytesIO(self.payload))

    def test_upload_validates_and_loads_without_activating(self):
        self.upload()
        self.assertEqual(self.manager.current["commit"], "f" * 40)
        self.assertIn(self.manifest["images"]["api"]["id"], self.manager.loaded)

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
            self.engine.deploy(self.manifest)
        rerun = copy.deepcopy(self.manifest)
        rerun["attempt"] = 2
        self.engine.upload(rerun, io.BytesIO(self.payload))
        with patch("receiver.time.time", return_value=100000):
            result = self.engine.deploy(rerun)
        self.assertEqual(result["status"], "already-current")
        state = self.engine.status()
        self.assertEqual(state["active"]["verified_at"], 100000)
        self.assertEqual(state["active"]["attempt"], 2)

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

    def test_production_promotes_same_verified_images_for_a_different_merge_commit(self):
        self.upload()
        self.engine.deploy(self.manifest)
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

    def test_wrong_tree_or_unverified_baseline_cannot_be_promoted(self):
        target = ReleaseEngine("production", self.root / "production", MemoryManager(),
                               staging_dir=self.root / "staging")
        self.engine.status()
        with self.assertRaises(ValueError):
            target.promote({"op": "promote", "environment": "production", "commit": "d" * 40,
                            "tree": "e" * 40, "run_id": "12346", "attempt": 1})

    def test_older_than_one_day_staging_verification_requires_a_fresh_stage_run(self):
        self.upload()
        self.engine.deploy(self.manifest)
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
