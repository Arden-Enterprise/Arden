import io
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import entrypoint


class AiEntrypointDispatchTests(unittest.TestCase):
    def test_dispatches_plan_promote_and_rejects_appended_body(self):
        calls = []

        class Engine:
            def plan_promote(self, request, provenance=None):
                calls.append(("plan-promote", request, provenance))
                return {"status": "READY", "staging_commit": "1" * 40}

        request = {"op": "plan-promote", "environment": "production"}
        proof = {"provider": "github-actions-oidc-ai"}
        result = entrypoint.dispatch_request(Engine(), request, io.BytesIO(), proof)
        self.assertEqual(result, {"status": "READY", "staging_commit": "1" * 40})
        self.assertEqual(calls, [("plan-promote", request, proof)])

        with self.assertRaisesRegex(ValueError, "Unexpected data"):
            entrypoint.dispatch_request(Engine(), request, io.BytesIO(b"extra"), proof)

    def test_error_response_never_leaks_internal_exception_messages(self):
        self.assertEqual(entrypoint.error_response(ValueError("secret token details")),
                         {"ok": False, "error": "invalid_request"})
        self.assertEqual(entrypoint.error_response(RuntimeError("http://127.0.0.1 secret body")),
                         {"ok": False, "error": "release_failed"})


@unittest.skipUnless(os.name == "posix" and os.geteuid() == 0, "Requires isolated Linux root fixtures")
class AiPrivilegeTests(unittest.TestCase):
    def test_private_state_and_shared_lock_reject_links_and_writable_ancestors(self):
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o700)
            entrypoint.secure_directory(state, private=True)
            (root / "linked").symlink_to(state, target_is_directory=True)
            with self.assertRaises(ValueError):
                entrypoint.secure_directory(root / "linked", private=True)
            root.chmod(0o777)
            with self.assertRaises(ValueError):
                entrypoint.secure_directory(state, private=True)
            root.chmod(0o700)
            state.chmod(0o755)
            with self.assertRaises(ValueError):
                entrypoint.secure_directory(state, private=True)

    def test_config_and_lock_files_reject_untrusted_permissions_or_ancestors(self):
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            root = Path(temporary)
            parent = root / "config"
            parent.mkdir(mode=0o700)
            config = parent / "staging.json"
            config.write_text("{}")
            config.chmod(0o600)
            entrypoint.secure_file(config)
            config.chmod(0o644)
            with self.assertRaises(ValueError):
                entrypoint.secure_file(config)
            config.chmod(0o600)
            root.chmod(0o777)
            with self.assertRaises(ValueError):
                entrypoint.secure_file(config)
            root.chmod(0o700)


if __name__ == "__main__":
    unittest.main()
