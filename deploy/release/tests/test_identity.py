import base64
import copy
import importlib
import json
from pathlib import Path
import sys
import unittest

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def encoded(value):
    raw = json.dumps(value, separators=(",", ":")).encode() if isinstance(value, dict) else value
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class IdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        try:
            self.identity = importlib.import_module("identity")
        except ModuleNotFoundError:
            self.fail("GitHub job identity verification is missing")
        self.request = {"op": "promote", "environment": "production", "commit": "a" * 40,
                        "tree": "b" * 40, "run_id": "12345", "attempt": 1}
        self.claims = {"iss": "https://token.actions.githubusercontent.com",
            "aud": self.identity.request_audience(self.request),
            "sub": "repo:Arden-Enterprise@329889661/Arden@1372698702:environment:production",
            "iat": 1000, "nbf": 1000, "exp": 1300, "repository": "Arden-Enterprise/Arden",
            "repository_id": "1372698702", "repository_owner_id": "329889661", "repository_visibility": "public",
            "environment": "production", "event_name": "push", "ref": "refs/heads/main", "ref_type": "branch",
            "sha": "a" * 40, "run_id": "12345", "run_attempt": "1", "runner_environment": "github-hosted",
            "workflow_ref": "Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/main", "workflow_sha": "a" * 40}
        numbers = self.key.public_key().public_numbers()
        self.jwks = {"keys": [{"kid": "fixture", "kty": "RSA", "use": "sig", "alg": "RS256",
            "n": encoded(numbers.n.to_bytes(256, "big")), "e": encoded(numbers.e.to_bytes(3, "big"))}]}

    def token(self, claims=None, header=None, key=None):
        message = encoded(header or {"alg": "RS256", "typ": "JWT", "kid": "fixture"}) + "." + encoded(claims or self.claims)
        signature = (key or self.key).sign(message.encode(), padding.PKCS1v15(), hashes.SHA256())
        return message + "." + encoded(signature)

    def verify(self, token=None, request=None, now=1010):
        return self.identity.verify_identity(token or self.token(), request or self.request,
                                             now=now, load_keys=lambda: self.jwks)

    def test_valid_signed_job_returns_only_bound_audit_metadata(self):
        self.assertEqual(self.identity.request_audience(self.request),
            "https://ardenai.tech/releases/production/promote/36997fe2d6e1b447f721278bb2b8f979b315194ae97dc8f65c926bc18b1036c4")
        result = self.verify()
        self.assertEqual(result["provider"], "github-actions-oidc")
        self.assertEqual(result["request_digest"], self.identity.request_digest(self.request))
        self.assertNotIn("token", result)

    def test_wrong_repo_branch_workflow_environment_run_and_source_are_rejected(self):
        for field, value in {"repository_id": "999", "repository_owner_id": "999", "repository": "fork/Arden",
            "repository_visibility": "private", "event_name": "pull_request", "ref": "refs/heads/staging",
            "environment": "staging", "sha": "d" * 40, "run_id": "999", "run_attempt": "2",
            "runner_environment": "self-hosted", "workflow_sha": "d" * 40,
            "workflow_ref": "Arden-Enterprise/Arden/.github/workflows/other.yml@refs/heads/main"}.items():
            claims = {**self.claims, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(self.token(claims))

    def test_signature_algorithm_key_expiry_and_request_rebinding_are_rejected(self):
        bad_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for token in [self.token(key=bad_key), self.token(header={"alg": "HS256", "kid": "fixture"}),
                      self.token(header={"alg": "RS256", "kid": "unknown"}),
                      self.token({**self.claims, "exp": 900}), self.token({**self.claims, "nbf": 1200}),
                      self.token({**self.claims, "iat": True})]:
            with self.subTest(token_case=len(token)), self.assertRaises(ValueError):
                self.verify(token)
        with self.assertRaises(ValueError):
            self.verify(request={**self.request, "tree": "d" * 40})
        with self.assertRaises(ValueError):
            self.verify(now=2000)

    def test_legacy_subject_is_safe_only_with_the_same_immutable_id_checks(self):
        claims = {**self.claims, "sub": "repo:Arden-Enterprise/Arden:environment:production"}
        self.verify(self.token(claims))
        with self.assertRaises(ValueError):
            self.verify(self.token({**claims, "repository_id": "999"}))

    def test_migration_plan_identity_is_signed_for_exact_candidate_and_each_environment(self):
        import hashlib
        inventory = [{"id": "0001", "filename": "0001_example.sql",
                      "sha256": "d" * 64, "rollout": "expand"}]
        migrations = hashlib.sha256(json.dumps(inventory, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()
        for environment, branch in [("staging", "staging"), ("production", "main")]:
            request = {"op": "plan-migrations", "environment": environment,
                       "commit": "a" * 40, "tree": "b" * 40, "run_id": "12345", "attempt": 1,
                       "migrations": migrations, "migration_inventory": inventory}
            claims = {**self.claims,
                "aud": self.identity.request_audience(request),
                "sub": f"repo:Arden-Enterprise@329889661/Arden@1372698702:environment:{environment}",
                "environment": environment, "ref": f"refs/heads/{branch}",
                "sha": "a" * 40, "run_id": "12345", "run_attempt": "1",
                "workflow_ref": f"Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/{branch}",
                "workflow_sha": "a" * 40}
            self.assertEqual(self.verify(self.token(claims), request),
                             self.identity.verify_identity(self.token(claims), request,
                                 now=1010, load_keys=lambda: self.jwks))
            for changed in [{**request, "tree": "c" * 40}, {**request, "run_id": "12344"},
                            {**request, "environment": "production" if environment == "staging" else "staging"}]:
                with self.subTest(environment=environment, changed=changed), self.assertRaises(ValueError):
                    self.verify(self.token(claims), changed)
            stale = {**claims, "run_id": "12344"}
            with self.subTest(environment=environment, stale_run=True), self.assertRaises(ValueError):
                self.verify(self.token(stale), request)

    def test_migration_reconciliation_requires_a_new_signed_push_attempt_per_environment(self):
        for environment, branch in [("staging", "staging"), ("production", "main")]:
            request = {"op": "reconcile-migrations", "environment": environment,
                       "commit": "a" * 40, "run_id": "12346", "attempt": 2}
            claims = {**self.claims,
                "aud": self.identity.request_audience(request),
                "sub": f"repo:Arden-Enterprise@329889661/Arden@1372698702:environment:{environment}",
                "environment": environment, "ref": f"refs/heads/{branch}",
                "sha": "a" * 40, "run_id": "12346", "run_attempt": "2",
                "workflow_ref": f"Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/{branch}",
                "workflow_sha": "a" * 40}
            self.assertEqual(self.verify(self.token(claims), request),
                             self.identity.verify_identity(self.token(claims), request,
                                 now=1010, load_keys=lambda: self.jwks))
            for changed in [{**request, "commit": "c" * 40}, {**request, "attempt": 1},
                            {**request, "environment": "production" if environment == "staging" else "staging"}]:
                with self.subTest(environment=environment, changed=changed), self.assertRaises(ValueError):
                    self.verify(self.token(claims), changed)

    def test_migration_plan_requires_candidate_inventory_and_oidc_proof(self):
        import hashlib
        inventory = [{"id": "0001", "filename": "0001_example.sql",
                      "sha256": "d" * 64, "rollout": "expand"}]
        migrations = hashlib.sha256(json.dumps(inventory, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()
        request = {"op": "plan-migrations", "environment": "staging", "commit": "a" * 40,
                   "tree": "b" * 40, "run_id": "12345", "attempt": 1,
                   "migrations": migrations, "migration_inventory": inventory}
        from protocol import read_header
        with self.assertRaises(ValueError):
            read_header(__import__("io").BytesIO(json.dumps(request).encode() + b"\n"), "staging")
        malformed = {**request, "migration_inventory": [{**inventory[0], "rollout": "safe"}]}
        with self.assertRaises(ValueError):
            self.verify(self.token(self.claims), malformed)


if __name__ == "__main__":
    unittest.main()
