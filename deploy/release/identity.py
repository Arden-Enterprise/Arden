"""Authenticate a release operation with short-lived GitHub Actions OIDC proof."""
import base64
import hashlib
import json
import re
import time
from urllib import request as http

from protocol import strict_json, validate_request

ISSUER = "https://token.actions.githubusercontent.com"
JWKS = ISSUER + "/.well-known/jwks"
REPOSITORY = "Arden-Enterprise/Arden"
REPOSITORY_ID = "1372698702"
OWNER_ID = "329889661"
MAX_TOKEN = 12288


def request_digest(request):
    raw = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def request_audience(request):
    return f"https://ardenai.tech/releases/{request['environment']}/{request['op']}/{request_digest(request)}"


def trusted_provenance(provenance, request):
    """Only the root verifier constructs this audit record; caller JSON cannot supply it."""
    source = request.get("manifest", request)
    return (isinstance(provenance, dict) and provenance.get("provider") == "github-actions-oidc"
            and provenance.get("repository_id") == REPOSITORY_ID and provenance.get("owner_id") == OWNER_ID
            and provenance.get("environment") == request["environment"]
            and provenance.get("sha") == source["commit"]
            and provenance.get("request_digest") == request_digest(request))


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_public_keys():
    with http.build_opener(NoRedirect).open(JWKS, timeout=15) as response:
        raw = response.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError("Identity provider key response exceeds limit")
    return strict_json(raw)


def decode(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Malformed identity encoding")
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def verify_identity(token, request, now=None, load_keys=None):
    # Cryptography is supplied by Ubuntu's maintained python3-cryptography package.
    # Never implement RSA verification or accept an algorithm selected by the caller.
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa

    if not isinstance(request, dict):
        raise ValueError("Invalid identity request")
    validate_request(request, request.get("environment"))
    if request["op"] == "status":
        raise ValueError("Job proof is only used for mutating operations")

    if not isinstance(token, str) or len(token) > MAX_TOKEN or token.count(".") != 2:
        raise ValueError("Missing or malformed job identity")
    encoded_header, encoded_claims, encoded_signature = token.split(".")
    header, claims = strict_json(decode(encoded_header)), strict_json(decode(encoded_claims))
    if (not isinstance(header, dict) or not isinstance(claims, dict)
            or header.get("alg") != "RS256" or header.get("typ", "JWT") != "JWT" or "crit" in header
            or not isinstance(header.get("kid"), str) or not 1 <= len(header["kid"]) <= 128):
        raise ValueError("Unsupported job identity header")
    keyset = (load_keys or load_public_keys)()
    keys = keyset.get("keys")
    if not isinstance(keys, list) or len(keys) > 16:
        raise ValueError("Unexpected identity key set")
    matches = [key for key in keys if isinstance(key, dict) and key.get("kid") == header["kid"]]
    if len(matches) != 1:
        raise ValueError("Unknown or ambiguous identity signing key")
    key = matches[0]
    if key.get("kty") != "RSA" or key.get("use", "sig") != "sig" or key.get("alg", "RS256") != "RS256":
        raise ValueError("Unsupported identity signing key")
    n, e = int.from_bytes(decode(key.get("n")), "big"), int.from_bytes(decode(key.get("e")), "big")
    if not 2048 <= n.bit_length() <= 8192 or not 3 <= e <= 2 ** 32 - 1 or e % 2 == 0:
        raise ValueError("Unsupported identity signing key size")
    try:
        rsa.RSAPublicNumbers(e, n).public_key().verify(decode(encoded_signature),
            (encoded_header + "." + encoded_claims).encode(), padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature as error:
        raise ValueError("Invalid job identity signature") from error
    now = time.time() if now is None else now
    if any(type(claims.get(field)) is not int for field in ["iat", "nbf", "exp"]):
        raise ValueError("Invalid identity timestamps")
    if (not now - 600 <= claims["iat"] <= now + 60 or claims["nbf"] > now + 60
            or not now - 60 <= claims["exp"] <= claims["iat"] + 900 or claims["exp"] <= claims["iat"]):
        raise ValueError("Expired or future job identity")
    environment = request["environment"]
    branch = "staging" if environment == "staging" else "main"
    source = request.get("manifest", request)
    expected = {"iss": ISSUER, "aud": request_audience(request), "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID, "repository_owner_id": OWNER_ID, "repository_visibility": "public",
        "environment": environment, "event_name": "push", "ref": "refs/heads/" + branch, "ref_type": "branch",
        "sha": source["commit"], "run_id": source["run_id"], "run_attempt": str(source["attempt"]),
        "runner_environment": "github-hosted", "workflow_sha": source["commit"],
        "workflow_ref": REPOSITORY + "/.github/workflows/ci.yml@refs/heads/" + branch}
    if any(type(claims.get(field)) is not str or claims[field] != value for field, value in expected.items()):
        raise ValueError("Job identity does not authorize this release operation")
    subjects = {f"repo:{REPOSITORY}:environment:{environment}",
                f"repo:Arden-Enterprise@{OWNER_ID}/Arden@{REPOSITORY_ID}:environment:{environment}"}
    if claims.get("sub") not in subjects:
        raise ValueError("Job identity subject is not approved")
    return {"provider": "github-actions-oidc", "repository_id": REPOSITORY_ID, "owner_id": OWNER_ID,
            "environment": environment, "sha": source["commit"], "run_id": source["run_id"],
            "run_attempt": str(source["attempt"]), "request_digest": request_digest(request),
            "workflow_ref": expected["workflow_ref"], "authenticated_at": int(now)}
