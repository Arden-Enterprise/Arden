import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from management import CoolifyAiManager, validate_config
from state import write_json
from test_protocol import make_ai_archive


def valid_config(state_dir):
    return {
        "environment": "staging",
        "service_uuid": "aistaging12345",
        "api_url": "http://127.0.0.1:8080/api/v1",
        "token_path": "/etc/arden/releases-ai/management.token",
        "state_dir": str(state_dir),
        "staging_dir": str(state_dir),
        "protected_containers": ["chromadb-staging"],
        "coolify_image_id": "sha256:" + "c" * 64,
        "docker_timeout": 360,
        "rollout_timeout": 10,
        "baseline": {
            "commit": "0" * 40,
            "ai_tree": "0" * 40,
            "images": {"ai": {"id": "sha256:" + "0" * 64}},
        },
        "template": {
            "services": {
                "arden-ai": {
                    "image": "sha256:" + "0" * 64,
                    "user": "1000:1000",
                    "read_only": True,
                    "cap_drop": ["ALL"],
                    "security_opt": ["no-new-privileges:true"],
                    "pull_policy": "never",
                }
            }
        },
    }


class AiManagementTests(unittest.TestCase):
    def test_validate_config_enforces_single_hardened_ai_service_and_protected_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = valid_config(Path(tmp) / "staging")
            validate_config(cfg, "staging")

            bad_cases = [
                {**cfg, "environment": "production"},
                {**cfg, "api_url": "http://10.0.0.5:8080/api/v1"},
                {**cfg, "api_namespace": True, "api_url": "http://[::1]:8080/api/v1"},
                {**cfg, "protected_containers": ["arden-ai-aistaging12345"]},
                {**cfg, "protected_containers": []},
                {**cfg, "docker_timeout": 10},
                {**cfg, "template": {"services": {"arden-api": cfg["template"]["services"]["arden-ai"]}}},
            ]
            for bad in bad_cases:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    validate_config(bad, "staging")

            for mutate in [
                lambda s: s.update({"user": "0:0"}),
                lambda s: s.update({"read_only": False}),
                lambda s: s.update({"ports": ["8080:8080"]}),
                lambda s: s.update({"privileged": True}),
                lambda s: s.update({"pull_policy": "always"}),
            ]:
                copy_cfg = copy.deepcopy(cfg)
                mutate(copy_cfg["template"]["services"]["arden-ai"])
                with self.assertRaises(ValueError):
                    validate_config(copy_cfg, "staging")

    def test_activate_and_verify_check_drift_protected_containers_and_http_401_probe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "staging"
            state_dir.mkdir()
            cfg = valid_config(state_dir)
            manifest, _ = make_ai_archive(commit="1" * 40, ai_tree="2" * 40)
            local_image = "sha256:" + "9" * 64
            write_json(root / "image-bindings.json", {manifest["images"]["ai"]["id"]: local_image})

            requests, ops, execs = [], [], []

            def req(method, path, body=None):
                requests.append((method, path, body))
                if method == "GET":
                    return {"docker_compose_raw": json.dumps(cfg["template"])}
                return {"ok": True}

            def op(kind):
                ops.append(kind)
                return {"status": "finished", "activity_id": 7}

            def cmd(args):
                execs.append(args)
                if args[:3] == ["inspect", "--format", "{{.Image}}"]:
                    return cfg["coolify_image_id"] + "\n"
                if args[0] == "inspect" and args[-1] == "chromadb-staging":
                    return json.dumps({"id": "chroma-id-1", "image": "chroma", "state": {"Running": True}})
                if args[0] == "inspect" and args[-1] == "arden-ai-aistaging12345":
                    return json.dumps({"id": "abcdef123456", "image": local_image,
                                       "state": {"Running": True, "Health": {"Status": "healthy"}}})
                if args[0] == "exec":
                    return "AI_VERIFY_OK\n"
                raise AssertionError(f"Unexpected docker command: {args}")

            manager = CoolifyAiManager(cfg, request=req, command=cmd, operation=op)
            manager.preflight(manifest)
            manager.activate(manifest)
            manager.verify(manifest)

            self.assertEqual(ops, ["status", "start", "status"])
            patch_body = requests[1][2]
            patched_compose = json.loads(base64.b64decode(patch_body["docker_compose_raw"]))
            self.assertEqual(patched_compose["services"]["arden-ai"]["image"], local_image)
            self.assertIs(patch_body["instant_deploy"], False)
            self.assertTrue(any(args[0] == "exec" and "abcdef123456" in args and "1000:1000" in args for args in execs))

    def test_verify_retries_timeout_and_rejects_mid_probe_container_swap(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "staging"
            state_dir.mkdir()
            cfg = valid_config(state_dir)
            cfg["rollout_timeout"] = 3
            manifest, _ = make_ai_archive(commit="1" * 40, ai_tree="2" * 40)
            local_image = "sha256:" + "9" * 64
            write_json(root / "image-bindings.json", {manifest["images"]["ai"]["id"]: local_image})

            inspect_calls = {"count": 0}

            def cmd_retry(args):
                if args[-1] == "chromadb-staging":
                    return json.dumps({"id": "chroma-id-1", "image": "chroma", "state": {"Running": True}})
                if args[0] == "inspect":
                    inspect_calls["count"] += 1
                    if inspect_calls["count"] == 1:
                        raise subprocess.TimeoutExpired(args, 5)
                    return json.dumps({"id": "abcdef123456", "image": local_image,
                                       "state": {"Running": True, "Health": {"Status": "healthy"}}})
                if args[0] == "exec":
                    return "AI_VERIFY_OK\n"
                raise AssertionError(args)

            manager = CoolifyAiManager(cfg, request=lambda *_: {}, command=cmd_retry, operation=lambda _: {})
            manager.verify(manifest)
            self.assertGreaterEqual(inspect_calls["count"], 3)

            swap_calls = {"count": 0}

            def cmd_swap(args):
                if args[-1] == "chromadb-staging":
                    return json.dumps({"id": "chroma-id-1", "image": "chroma", "state": {"Running": True}})
                if args[0] == "inspect":
                    swap_calls["count"] += 1
                    cid = "abcdef123456" if swap_calls["count"] % 2 == 1 else "fedcba654321"
                    return json.dumps({"id": cid, "image": local_image,
                                       "state": {"Running": True, "Health": {"Status": "healthy"}}})
                if args[0] == "exec":
                    return "AI_VERIFY_OK\n"
                raise AssertionError(args)

            cfg["rollout_timeout"] = 0.2
            swap_mgr = CoolifyAiManager(cfg, request=lambda *_: {}, command=cmd_swap, operation=lambda _: {})
            with self.assertRaisesRegex(RuntimeError, "did not verify"):
                swap_mgr.verify(manifest)

    def test_activate_rejects_untracked_compose_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "staging"
            state_dir.mkdir()
            cfg = valid_config(state_dir)
            manifest, _ = make_ai_archive()
            drifted = copy.deepcopy(cfg["template"])
            drifted["services"]["arden-ai"]["environment"] = {"UNTRACKED": "1"}
            manager = CoolifyAiManager(
                cfg,
                request=lambda *_args: {"docker_compose_raw": json.dumps(drifted)},
                command=lambda _args: "",
                operation=lambda _op: {"status": "finished"},
            )
            with self.assertRaisesRegex(ValueError, "changed outside"):
                manager.activate(manifest)

    def test_remove_local_image_refuses_core_managed_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "staging"
            state_dir.mkdir()
            cfg = valid_config(state_dir)
            manager = CoolifyAiManager(cfg, request=lambda *_: {}, command=lambda _: "", operation=lambda _: {})
            fake_out = json.dumps({
                "labels": {"io.arden.release.managed": "1", "org.opencontainers.image.revision": "a" * 40},
                "tags": ["arden-release-api:sha-" + "a" * 40],
            })
            class Completed:
                returncode = 0
                stdout = fake_out
                stderr = ""
            with patch("management.subprocess.run", return_value=Completed()):
                self.assertFalse(manager._remove_local_image("sha256:" + "5" * 64, "a" * 40))

    def test_php_bridges_and_wrapper_enforce_isolated_boundaries(self):
        base = Path(__file__).resolve().parents[1]
        bridge = (base / "coolify-ai-operation.php").read_text(encoding="utf-8")
        self.assertIn("arden-release-ai-local-", bridge)
        self.assertIn("['arden-ai']", bridge)
        self.assertIn("/var/lib/arden-release-ai-bridge", bridge)
        self.assertNotIn("arden-api", bridge)

        mint = (base / "mint-ai-token.php").read_text(encoding="utf-8")
        self.assertIn("127.0.0.1,::1", mint)
        self.assertIn("arden-release-ai-local-", mint)
        self.assertIn("['arden-ai']", mint)

        local_http = (base / "local_http.py").read_text(encoding="utf-8")
        self.assertIn("/etc/arden/releases-ai/management.token", local_http)
        self.assertIn("ProxyHandler({})", local_http)

        mgmt_src = (base / "management.py").read_text(encoding="utf-8")
        self.assertIn("ProxyHandler({})", mgmt_src)

        wrapper = (base / "arden-release-ai").read_text(encoding="utf-8")
        self.assertIn("/usr/bin/python3 -I /opt/arden-release-ai/entrypoint.py", wrapper)


if __name__ == "__main__":
    unittest.main()
