import base64
import importlib
import json
from pathlib import Path
import sys
import unittest

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import make_ai_archive


def encoded(value):
    raw = json.dumps(value, separators=(",", ":")).encode() if isinstance(value, dict) else value
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class AiIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        self.identity = importlib.import_module("identity")
        self.request = {
            "op": "promote",
            "environment": "production",
            "commit": "a" * 40,
            "ai_tree": "b" * 40,
            "run_id": "12345",
            "attempt": 1,
        }
        self.claims = {
            "iss": "https://token.actions.githubusercontent.com",
            "aud": self.identity.request_audience(self.request),
            "sub": "repo:Arden-Enterprise@329889661/Arden@1372698702:environment:production",
            "iat": 1000,
            "nbf": 1000,
            "exp": 1300,
            "repository": "Arden-Enterprise/Arden",
            "repository_id": "1372698702",
            "repository_owner_id": "329889661",
            "repository_visibility": "public",
            "environment": "production",
            "event_name": "push",
            "ref": "refs/heads/main",
            "ref_type": "branch",
            "sha": "a" * 40,
            "run_id": "12345",
            "run_attempt": "1",
            "runner_environment": "github-hosted",
            "workflow_ref": "Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/main",
            "workflow_sha": "a" * 40,
            "job_workflow_ref": "Arden-Enterprise/Arden/.github/workflows/release-ai.yml@refs/heads/main",
            "job_workflow_sha": "a" * 40,
        }
        numbers = self.key.public_key().public_numbers()
        self.jwks = {"keys": [{
            "kid": "fixture", "kty": "RSA", "use": "sig", "alg": "RS256",
            "n": encoded(numbers.n.to_bytes(256, "big")),
            "e": encoded(numbers.e.to_bytes(3, "big")),
        }]}

    def token(self, claims=None, header=None, key=None):
        message = encoded(header or {"alg": "RS256", "typ": "JWT", "kid": "fixture"}) + "." + encoded(claims or self.claims)
        signature = (key or self.key).sign(message.encode(), padding.PKCS1v15(), hashes.SHA256())
        return message + "." + encoded(signature)

    def verify(self, token=None, request=None, now=1010):
        return self.identity.verify_identity(
            token or self.token(), request or self.request, now=now, load_keys=lambda: self.jwks
        )

    def test_valid_signed_ai_job_binds_distinct_audience_and_job_workflow_ref(self):
        aud = self.identity.request_audience(self.request)
        self.assertTrue(aud.startswith("https://ardenai.tech/releases-ai/production/promote/"))
        result = self.verify()
        self.assertEqual(result["provider"], "github-actions-oidc-ai")
        self.assertEqual(result["job_workflow_ref"],
                         "Arden-Enterprise/Arden/.github/workflows/release-ai.yml@refs/heads/main")
        self.assertTrue(self.identity.trusted_provenance(result, self.request))
        self.assertNotIn("token", result)

    def test_rejects_core_audience_and_wrong_job_workflow_ref(self):
        core_aud = self.identity.request_audience(self.request).replace("/releases-ai/", "/releases/")
        for patch in [
            {"aud": core_aud},
            {"job_workflow_ref": "Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/main"},
            {"job_workflow_ref": "Arden-Enterprise/Arden/.github/workflows/other.yml@refs/heads/main"},
            {"job_workflow_sha": "d" * 40},
            {"event_name": "workflow_dispatch"},
            {"event_name": "pull_request"},
            {"repository_id": "999"},
            {"repository_owner_id": "999"},
            {"repository_visibility": "private"},
            {"runner_environment": "self-hosted"},
            {"ref": "refs/heads/staging"},
        ]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.verify(self.token({**self.claims, **patch}))

    def test_staging_allows_push_and_workflow_dispatch_bound_to_staging_ref(self):
        manifest, _ = make_ai_archive()
        request = {"op": "deploy", "environment": "staging", "manifest": manifest}
        for event in ("push", "workflow_dispatch"):
            claims = {
                **self.claims,
                "aud": self.identity.request_audience(request),
                "sub": "repo:Arden-Enterprise@329889661/Arden@1372698702:environment:staging",
                "environment": "staging",
                "event_name": event,
                "ref": "refs/heads/staging",
                "workflow_ref": "Arden-Enterprise/Arden/.github/workflows/ci.yml@refs/heads/staging",
                "job_workflow_ref": "Arden-Enterprise/Arden/.github/workflows/release-ai.yml@refs/heads/staging",
            }
            proof = self.verify(self.token(claims), request)
            self.assertEqual(proof["event_name"], event)
            self.assertTrue(self.identity.trusted_provenance(proof, request))

    def test_rejects_signature_alg_expiry_and_rebinding(self):
        bad_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        for tok in [
            self.token(key=bad_key),
            self.token(header={"alg": "HS256", "kid": "fixture"}),
            self.token(header={"alg": "RS256", "kid": "missing"}),
            self.token({**self.claims, "exp": 900}),
            self.token({**self.claims, "nbf": 1200}),
        ]:
            with self.assertRaises(ValueError):
                self.verify(tok)
        with self.assertRaises(ValueError):
            self.verify(request={**self.request, "ai_tree": "e" * 40})
        with self.assertRaises(ValueError):
            self.verify(now=2500)


if __name__ == "__main__":
    unittest.main()
