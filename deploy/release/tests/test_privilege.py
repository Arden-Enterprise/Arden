import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import entrypoint


@unittest.skipUnless(os.name == "posix" and os.geteuid() == 0, "Requires isolated Linux root fixtures")
class PrivilegeTests(unittest.TestCase):
    def test_partial_original_stop_enters_recovery_and_verifies_it(self):
        import bootstrap_operator as operator
        from test_bootstrap import source_components
        from state import read_json
        api, web = source_components()
        api["Id"], web["Id"] = "original-api", "original-web"
        record = {"phase": "prepared", "config": {"service_uuid": "candidate12345"},
                  "original_api": api, "original_web": web, "protected_ids": {}, "disconnected_edges": []}
        actions, verified = [], []
        class Manager:
            def __init__(self, config):
                pass
            def _wait_operation(self, **arguments):
                pass
        def docker(*arguments):
            actions.append(arguments)
            if arguments[:2] == ("stop", "--time") and len(arguments) == 5:
                raise RuntimeError("Injected failure after stopping only the original web")
        def inspect(name):
            return api if name == api["Name"] else web
        with tempfile.TemporaryDirectory(dir="/root") as temporary, \
                patch.object(operator, "STATE", Path(temporary)), \
                patch.object(operator, "candidate_check", lambda _: None), \
                patch.object(operator, "CoolifyManager", Manager), patch.object(operator, "inspect", inspect), \
                patch.object(operator, "docker", docker), \
                patch.object(operator, "verify_original", lambda *args: verified.append(True)):
            with self.assertRaisesRegex(RuntimeError, "recovery verified"):
                operator.cutover("staging", record)
            self.assertTrue(any(action[0] == "start" for action in actions))
            self.assertEqual(verified, [True])
            self.assertEqual(read_json(Path(temporary) / "bootstrap/staging.json")["phase"], "recovered")

    def test_root_rollback_restores_previous_and_keeps_workflow_fence(self):
        import bootstrap_operator as operator
        from receiver import ReleaseEngine
        from state import read_json
        from test_receiver import MemoryManager
        from test_protocol import fixture
        import io, json
        rollback = getattr(operator, "rollback", None)
        self.assertTrue(callable(rollback), "A fixed root-only rollback operation is missing")
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            config_dir = root / "config"
            config_dir.mkdir()
            manager = MemoryManager()
            state_dir = root / "state" / "staging"
            engine = ReleaseEngine("staging", state_dir, manager)
            manifest, archive = fixture()
            engine.upload(manifest, io.BytesIO(archive))
            engine.deploy(manifest)
            original_verify = manager.verify
            def verify(manifest_to_check):
                if manifest_to_check["commit"] == manifest["commit"]:
                    raise RuntimeError("The accepted current release became unhealthy")
                return original_verify(manifest_to_check)
            manager.verify = verify
            config = {"state_dir": str(state_dir), "staging_dir": str(state_dir)}
            (config_dir / "staging.json").write_text(json.dumps(config))
            highest = engine.status()["highest"]
            with patch.object(operator, "CONFIG", config_dir), patch.object(operator, "CoolifyManager", lambda _: manager):
                rollback("staging")
            state = read_json(state_dir / "state.json")
            self.assertEqual(state["active"]["manifest"]["images"], manager.original["images"])
            self.assertEqual(state["highest"], highest)
            self.assertIsNone(state["pending"])
            self.assertIs(state["previous"]["eligible_for_promotion"], False)

    def test_private_state_rejects_links_and_writable_ancestors(self):
        guard = getattr(entrypoint, "secure_directory", None)
        self.assertTrue(callable(guard), "Protected state-directory validation is missing")
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o700)
            guard(state, private=True)
            (root / "linked").symlink_to(state, target_is_directory=True)
            with self.assertRaises(ValueError):
                guard(root / "linked", private=True)
            root.chmod(0o777)
            with self.assertRaises(ValueError):
                guard(state, private=True)
            root.chmod(0o700)
            state.chmod(0o755)
            with self.assertRaises(ValueError):
                guard(state, private=True)

    def test_config_file_rejects_untrusted_ancestor_even_when_parent_is_protected(self):
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            parent = root / "config"
            parent.mkdir(mode=0o700)
            config = parent / "staging.json"
            config.write_text("{}")
            config.chmod(0o600)
            entrypoint.secure_file(config)
            root.chmod(0o777)
            with self.assertRaises(ValueError):
                entrypoint.secure_file(config)
            root.chmod(0o700)

    def test_prepared_resource_resume_finishes_runtime_configuration(self):
        import bootstrap_operator as operator
        from state import write_json, read_json
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            journal = root / "bootstrap" / "staging.json"
            write_json(journal, {"phase": "created", "config": {"service_uuid": "synthetic12345"},
                                 "values": {"SYNTHETIC": "test-only"}})
            calls = []
            class Manager:
                def __init__(self, config):
                    pass
                def request(self, *arguments):
                    calls.append(arguments)
            with patch.object(operator, "STATE", root), patch.object(operator, "CoolifyManager", Manager):
                result = operator.prepare("staging", {}, {})
            self.assertEqual(result["phase"], "prepared")
            self.assertEqual(read_json(journal)["phase"], "prepared")
            self.assertEqual(calls[0][:2], ("PATCH", "/services/synthetic12345/envs/bulk"))

    def test_retirement_removes_only_original_apps_without_starting_infrastructure(self):
        import bootstrap_operator as operator
        from state import read_json
        retire = getattr(operator, "retire_original", None)
        self.assertTrue(callable(retire), "Original app definitions can still restart alongside releases")
        source = {"services": {"arden-staging-api": {"image": "old-api"},
                               "arden-staging-web": {"image": "old-web"},
                               "auth": {"image": "preserved-auth"}}}
        record = {"phase": "cutover_verified", "original_resource": {"uuid": "original12345",
                   "docker_compose_raw": __import__("json").dumps(source)}, "config": {}}
        requests = []
        class Manager:
            def __init__(self, config):
                pass
            def request(self, method, path, body=None):
                requests.append((method, path, body))
                return record["original_resource"]
        with tempfile.TemporaryDirectory(dir="/root") as temporary, \
                patch.object(operator, "STATE", Path(temporary)), patch.object(operator, "CoolifyManager", Manager):
            retire("staging", record)
            import base64
            updated = __import__("json").loads(base64.b64decode(requests[-1][2]["docker_compose_raw"]))
            self.assertEqual(updated, {"services": {"auth": {"image": "preserved-auth"}}})
            self.assertIs(requests[-1][2]["instant_deploy"], False)
            self.assertTrue(read_json(Path(temporary) / "bootstrap/staging.json")["original_retired"])


if __name__ == "__main__":
    unittest.main()
