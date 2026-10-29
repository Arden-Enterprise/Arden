import copy
import json
from pathlib import Path
import sys
import unittest
import base64
import struct

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    from bootstrap import build_app_template
    import bootstrap
    deployment_key_line = getattr(bootstrap, "deployment_key_line", None)
except ModuleNotFoundError:
    build_app_template = None


def source_components():
    common = {"com.docker.compose.project": "source123456", "com.docker.compose.service": "arden-staging-api"}
    api = {"Name": "/arden-staging-api-source123456", "Image": "sha256:" + "1" * 64,
           "Config": {"Labels": common, "Env": ["NODE_ENV=production", "DATABASE_URL=postgresql://synthetic",
                        "SUPABASE_URL=http://auth-gateway:8080", "SMTP_PASS=synthetic-test-value"]},
           "Mounts": [{"Type": "volume", "Name": "preserved-staging-private", "Destination": "/var/lib/arden/private", "RW": True},
                      {"Type": "bind", "Source": "/private/staging-ca.pem", "Destination": "/etc/arden/ca.pem", "RW": False}],
           "NetworkSettings": {"Networks": {"source123456": {"Aliases": ["arden-staging-api"]},
                                            "database-network": {"Aliases": ["arden-staging-api"]}}}}
    web = {"Name": "/arden-staging-web-source123456", "Image": "sha256:" + "2" * 64,
           "Config": {"Labels": {**common, "com.docker.compose.service": "arden-staging-web"}},
           "NetworkSettings": {"Networks": {"source123456": {"Aliases": ["arden-staging-web"]},
                                            "edge-network": {"Aliases": ["arden-staging-web", "arden-staging-web-source123456"]}}}}
    return api, web


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(build_app_template, "App-only bootstrap is not implemented")
        self.api, self.web = source_components()

    def test_exact_private_volume_is_external_and_secrets_remain_runtime_values(self):
        result = build_app_template("staging", "source123456", self.api, self.web)
        compose = result["compose"]
        self.assertEqual(set(compose["services"]), {"arden-api", "arden-web"})
        self.assertEqual(compose["volumes"]["private"], {"external": True, "name": "preserved-staging-private"})
        self.assertEqual(compose["services"]["arden-api"]["environment"]["SMTP_PASS"], "${SMTP_PASS}")
        self.assertEqual(result["values"]["SMTP_PASS"], "synthetic-test-value")
        self.assertNotIn("synthetic-test-value", json.dumps(compose))
        self.assertNotIn("ports", compose["services"]["arden-api"])
        self.assertEqual(compose["services"]["arden-api"]["user"], "1000:1000")
        self.assertEqual(compose["services"]["arden-web"]["user"], "101:101")

    def test_provider_metadata_and_infrastructure_only_secrets_are_not_copied_into_the_app(self):
        self.api["Config"]["Env"] += ["COOLIFY_RESOURCE_UUID=source123456",
            "SERVICE_NAME_ARDEN_STAGING_AUTH=auth", "ARDEN_STAGING_JWT_SECRET=synthetic-auth-only-secret"]
        result = build_app_template("staging", "source123456", self.api, self.web)
        self.assertNotIn("COOLIFY_RESOURCE_UUID", result["values"])
        self.assertNotIn("SERVICE_NAME_ARDEN_STAGING_AUTH", result["values"])
        self.assertNotIn("ARDEN_STAGING_JWT_SECRET", result["values"])
        self.assertIn("DATABASE_URL", result["values"])

    def test_routing_aliases_and_auth_database_networks_are_preserved_without_sharing_web(self):
        compose = build_app_template("staging", "source123456", self.api, self.web)["compose"]
        networks = compose["networks"]
        api_networks = compose["services"]["arden-api"]["networks"]
        web_networks = compose["services"]["arden-web"]["networks"]
        self.assertEqual({networks[name]["name"] for name in api_networks if name != "default"},
                         {"source123456", "database-network"})
        self.assertEqual({networks[name]["name"] for name in web_networks if name != "default"}, {"edge-network"})
        alias_lists = [value.get("aliases", []) for value in web_networks.values()]
        self.assertTrue(any("arden-staging-web-source123456" in aliases for aliases in alias_lists))
        self.assertIn("arden-staging-api", api_networks["default"]["aliases"])

    def test_wrong_source_or_missing_storage_fails_before_any_cutover(self):
        for change in [lambda a: a["Config"]["Labels"].update({"com.docker.compose.project": "other"}),
                       lambda a: a.update(Mounts=[]),
                       lambda a: a["Mounts"][1].update(RW=True)]:
            api = copy.deepcopy(self.api)
            change(api)
            with self.subTest(change=change), self.assertRaises(ValueError):
                build_app_template("staging", "source123456", api, self.web)
        with self.assertRaises(ValueError):
            build_app_template("production", "source123456", self.api, self.web)

    def test_original_inventory_is_not_modified(self):
        before = copy.deepcopy((self.api, self.web))
        build_app_template("staging", "source123456", self.api, self.web)
        self.assertEqual((self.api, self.web), before)

    def test_candidate_omits_empty_public_alias_fields_for_coolify_serialization(self):
        prepare = getattr(bootstrap, "candidate_template", None)
        self.assertTrue(callable(prepare), "Candidate network preparation is missing")
        final = build_app_template("staging", "source123456", self.api, self.web)["compose"]
        before = copy.deepcopy(final)
        candidate = prepare(final)
        for name, network in candidate["services"]["arden-web"]["networks"].items():
            if name != "default":
                self.assertNotIn("aliases", network)
        self.assertEqual(final, before)

    def test_schema_approval_requires_the_exact_applied_migration_inventory(self):
        verify = getattr(bootstrap, "verify_migration_inventory", None)
        self.assertTrue(callable(verify), "Database ledger verification is missing")
        rows = [{"name": "0001_example.sql", "sha256": "a" * 64},
                {"name": "0002_example.sql", "sha256": "b" * 64}]
        self.assertRegex(verify(rows, ["0001_example", "0002_example"]), r"^[a-f0-9]{64}$")
        for applied in [["0001_example"], ["0001_example", "0002_example", "0003_unknown"],
                        ["0001_example", "0001_example"]]:
            with self.subTest(applied=applied), self.assertRaises(ValueError):
                verify(rows, applied)

    def test_deployment_key_cannot_add_another_key_or_arbitrary_forced_command(self):
        try:
            formatter = deployment_key_line
        except NameError:
            self.fail("Restricted deployment-key validation is not implemented")
        self.assertTrue(callable(formatter), "Restricted deployment-key validation is not implemented")
        raw = struct.pack(">I", 11) + b"ssh-ed25519" + struct.pack(">I", 32) + b"a" * 32
        key = "ssh-ed25519 " + base64.b64encode(raw).decode() + " synthetic-ci"
        line = formatter("staging", key)
        self.assertTrue(line.startswith('restrict,command="sudo -n -- /usr/local/libexec/arden-release staging" '))
        for environment, value in [("other", key), ("staging", key + "\n" + key),
                                    ("staging", "command=evil " + key), ("staging", "ssh-ed25519 invalid")]:
            with self.subTest(environment=environment, key=value), self.assertRaises(ValueError):
                formatter(environment, value)


if __name__ == "__main__":
    unittest.main()
