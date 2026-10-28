import copy
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
    from management import validate_config, CoolifyManager
except ModuleNotFoundError:
    validate_config = CoolifyManager = None


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


if __name__ == "__main__":
    unittest.main()
