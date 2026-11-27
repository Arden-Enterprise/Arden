import io
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from identity import OWNER_ID, REPOSITORY, REPOSITORY_ID, request_digest
from receiver import AiReleaseEngine
from state import read_json, release_lock, write_json
from test_protocol import make_ai_archive


def verified_proof(op, environment, payload):
    request = {"op": op, "environment": environment, "manifest": payload} if op in {"upload", "deploy"} else payload
    source = request.get("manifest", request)
    branch = "staging" if environment == "staging" else "main"
    return {
        "provider": "github-actions-oidc-ai",
        "repository_id": REPOSITORY_ID,
        "owner_id": OWNER_ID,
        "environment": environment,
        "sha": source["commit"],
        "job_workflow_ref": f"{REPOSITORY}/.github/workflows/release-ai.yml@refs/heads/{branch}",
        "request_digest": request_digest(request),
    }


class MemoryAiManager:
    def __init__(self):
        self.original = {
            "commit": "0" * 40,
            "ai_tree": "0" * 40,
            "images": {"ai": {"id": "sha256:" + "0" * 64}},
        }
        self.loaded = {self.original["images"]["ai"]["id"]}
        self.active = self.original
        self.removed = []
        self.incomplete_removed = []
        self.fail_activate = False
        self.fail_verify_commit = None

    def baseline(self):
        return self.original

    def preflight(self, _manifest):
        pass

    def load(self, _path, manifest, _proof):
        self.loaded.add(manifest["images"]["ai"]["id"])

    def ensure_images(self, manifest):
        if manifest["images"]["ai"]["id"] not in self.loaded:
            raise ValueError("AI image missing")

    def activate(self, manifest):
        if self.fail_activate:
            raise RuntimeError("Injected activation failure")
        self.active = manifest

    def verify(self, manifest):
        if self.fail_verify_commit and manifest.get("commit") == self.fail_verify_commit:
            raise RuntimeError("Injected verification failure")
        if self.active["images"]["ai"]["id"] != manifest["images"]["ai"]["id"]:
            raise RuntimeError("Active AI image mismatch")

    def remove_owned_image(self, identifier, commit):
        self.removed.append((identifier, commit))
        self.loaded.discard(identifier)
        return True

    def remove_incomplete_upload(self, manifest, _proof, _retained):
        self.incomplete_removed.append(manifest["commit"])
        return True


class AiReceiverTests(unittest.TestCase):
    def test_staging_upload_deploy_and_production_plan_promote_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lock_path = root / "shared.lock"
            stage_mgr = MemoryAiManager()
            prod_mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", stage_mgr, lock_path=lock_path)
            prod = AiReleaseEngine("production", root / "production", prod_mgr,
                                   staging_dir=root / "staging", lock_path=lock_path)

            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            up = staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            self.assertEqual(up["status"], "uploaded")
            dep = staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            self.assertEqual(dep["status"], "deployed")
            self.assertTrue(staging.status()["active"]["eligible_for_promotion"])

            # Same loaded Docker daemon in production shares loaded image IDs.
            prod_mgr.loaded.add(manifest["images"]["ai"]["id"])

            plan_req = {"op": "plan-promote", "environment": "production", "commit": "3" * 40,
                        "ai_tree": "2" * 40, "run_id": "101", "attempt": 1}
            plan = prod.plan_promote(plan_req, verified_proof("plan-promote", "production", plan_req))
            self.assertEqual(plan, {"status": "READY", "staging_commit": "1" * 40})

            prom_req = {**plan_req, "op": "promote"}
            promoted = prod.promote(prom_req, verified_proof("promote", "production", prom_req))
            self.assertEqual(promoted["status"], "deployed")
            self.assertEqual(promoted["built_commit"], "1" * 40)
            self.assertEqual(promoted["commit"], "3" * 40)

            plan2_req = {**plan_req, "commit": "4" * 40, "run_id": "102"}
            self.assertEqual(prod.plan_promote(plan2_req, verified_proof("plan-promote", "production", plan2_req)),
                             {"status": "ALREADY_CURRENT"})
            prom2_req = {**plan2_req, "op": "promote"}
            self.assertEqual(prod.promote(prom2_req, verified_proof("promote", "production", prom2_req))["status"],
                             "already-current")

    def test_failed_deploy_recovers_previous_and_blocks_same_attempt_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", mgr, lock_path=root / "shared.lock")
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            mgr.fail_verify_commit = "1" * 40
            with self.assertRaisesRegex(RuntimeError, "previous release recovered"):
                staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            state = staging.status()
            self.assertIsNone(state["pending"])
            self.assertEqual(state["active"]["manifest"]["commit"], "0" * 40)
            self.assertEqual(state["highest"], [100, 1])

            mgr.fail_verify_commit = None
            with self.assertRaisesRegex(ValueError, "already failed"):
                staging.deploy(manifest, verified_proof("deploy", "staging", manifest))

    def test_expired_staging_release_blocks_production_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lock_path = root / "shared.lock"
            stage_mgr = MemoryAiManager()
            prod_mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", stage_mgr, lock_path=lock_path)
            prod = AiReleaseEngine("production", root / "production", prod_mgr,
                                   staging_dir=root / "staging", lock_path=lock_path)
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            prod_mgr.loaded.add(manifest["images"]["ai"]["id"])

            state_path = root / "staging" / "state.json"
            state = read_json(state_path)
            state["active"]["verified_at"] = time.time() - 90000
            write_json(state_path, state)

            plan_req = {"op": "plan-promote", "environment": "production", "commit": "3" * 40,
                        "ai_tree": "2" * 40, "run_id": "101", "attempt": 1}
            self.assertEqual(prod.plan_promote(plan_req, verified_proof("plan-promote", "production", plan_req)),
                             {"status": "STAGING_REQUIRED"})
            prom_req = {**plan_req, "op": "promote"}
            with self.assertRaisesRegex(ValueError, "retained staging"):
                prod.promote(prom_req, verified_proof("promote", "production", prom_req))

    def test_operator_rollback_preserves_highest_and_disqualifies_rolled_back_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", mgr, lock_path=root / "shared.lock")
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            result = staging.rollback()
            self.assertEqual(result["status"], "rolled-back")
            state = staging.status()
            self.assertEqual(state["active"]["manifest"]["commit"], "0" * 40)
            self.assertEqual(state["highest"], [100, 1])
            self.assertIs(state["previous"]["eligible_for_promotion"], False)
            self.assertEqual(state["operator_action"]["action"], "rollback")

    def test_shared_host_lock_blocks_concurrent_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock_path = Path(tmp) / "release.lock"
            with release_lock(lock_path, timeout=1):
                with self.assertRaises(TimeoutError):
                    with release_lock(lock_path, timeout=0.05):
                        pass

    def test_plan_promote_is_strictly_read_only_and_rejects_same_failed_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lock_path = root / "shared.lock"
            stage_mgr = MemoryAiManager()
            prod_mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", stage_mgr, lock_path=lock_path)
            prod = AiReleaseEngine("production", root / "production", prod_mgr,
                                   staging_dir=root / "staging", lock_path=lock_path)
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            prod_mgr.loaded.add(manifest["images"]["ai"]["id"])

            plan_req = {"op": "plan-promote", "environment": "production", "commit": "3" * 40,
                        "ai_tree": "2" * 40, "run_id": "101", "attempt": 1}
            plan = prod.plan_promote(plan_req, verified_proof("plan-promote", "production", plan_req))
            self.assertEqual(plan, {"status": "READY", "staging_commit": "1" * 40})
            self.assertFalse((root / "production" / "state.json").exists())

            prod_mgr.fail_verify_commit = "1" * 40
            with self.assertRaisesRegex(RuntimeError, "previous release recovered"):
                prod.promote({**plan_req, "op": "promote"},
                             verified_proof("promote", "production", {**plan_req, "op": "promote"}))
            prod_mgr.fail_verify_commit = None
            self.assertEqual(
                prod.plan_promote(plan_req, verified_proof("plan-promote", "production", plan_req)),
                {"status": "STALE_RUN"},
            )

    def test_rollback_checks_preflight_journals_intent_and_reconciles_after_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mgr = MemoryAiManager()
            preflights = []
            mgr.preflight = lambda m: preflights.append(m["commit"])
            staging = AiReleaseEngine("staging", root / "staging", mgr, lock_path=root / "shared.lock")
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            staging.deploy(manifest, verified_proof("deploy", "staging", manifest))

            mgr.fail_verify_commit = "0" * 40
            with self.assertRaisesRegex(RuntimeError, "pending rollback journal"):
                staging.rollback()
            self.assertEqual(preflights[-1], "0" * 40)
            mid = staging.status()
            self.assertEqual(mid["pending"]["phase"], "rolling-back")
            self.assertIs(mid["active"]["eligible_for_promotion"], False)

            mgr.fail_verify_commit = None
            recovered = staging.rollback()
            self.assertEqual(recovered["status"], "recovered")
            after = staging.status()
            self.assertIsNone(after["pending"])
            self.assertEqual(after["active"]["manifest"]["commit"], "0" * 40)
            self.assertIs(after["previous"]["eligible_for_promotion"], False)

    def test_abandoned_incoming_part_and_stale_intents_cleaned_safely(self):
        from retention import collect_releases
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", mgr, lock_path=root / "shared.lock")
            incoming = staging.root / "incoming"
            incoming.mkdir(parents=True, exist_ok=True)
            abandoned = incoming / "upload-999-deadbeef.part"
            abandoned.write_bytes(b"partial-data")

            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            self.assertFalse(abandoned.exists())

            # Stale upload-intent is unlinked only when remove_incomplete_upload reports True.
            intent = staging.root / "upload-intents" / "stale.json"
            write_json(intent, {"manifest": manifest, "proof": {"ai": {}}, "started_at": time.time() - 7200})
            mgr.remove_incomplete_upload = lambda *_args: False
            collect_releases(staging.root.parent, mgr)
            self.assertTrue(intent.exists())
            mgr.remove_incomplete_upload = lambda *_args: True
            collect_releases(staging.root.parent, mgr)
            self.assertFalse(intent.exists())

    def test_post_commit_retention_error_does_not_fail_committed_deploy(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mgr = MemoryAiManager()
            staging = AiReleaseEngine("staging", root / "staging", mgr, lock_path=root / "shared.lock")
            manifest, archive = make_ai_archive(commit="1" * 40, ai_tree="2" * 40, run_id="100", attempt=1)
            staging.upload(manifest, io.BytesIO(archive), verified_proof("upload", "staging", manifest))
            with patch("receiver.collect_releases", side_effect=RuntimeError("transient cleanup failure")):
                res = staging.deploy(manifest, verified_proof("deploy", "staging", manifest))
            self.assertEqual(res["status"], "deployed")
            self.assertEqual(res["retention_warning"], "cleanup_deferred")
            self.assertEqual(staging.status()["active"]["manifest"]["commit"], "1" * 40)


if __name__ == "__main__":
    unittest.main()
