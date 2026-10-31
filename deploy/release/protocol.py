"""Strict, environment-bound release protocol; never executes archive contents."""

import hashlib
import gzip
import json
from pathlib import PurePosixPath
import re
import tarfile

MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1536 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_JSON = 1024 * 1024
MAX_HEADER = 16384
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
MIGRATION_ID = re.compile(r"[0-9]{4}\Z")
MIGRATION_FILENAME = re.compile(r"[0-9]{4}_[a-z0-9_]+\.sql\Z")
MEMBER = re.compile(r"(?:manifest\.json|"
                    r"blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}\.json|"
                    r"[0-9a-f]{64}/(?:layer\.tar|json|VERSION))\Z")


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    def invalid(_value):
        raise ValueError("Non-finite JSON number")

    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Malformed JSON") from error


def exact(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        raise ValueError("Unexpected object fields")


def identity(value, expression):
    if type(value) is not str or not expression.fullmatch(value):
        raise ValueError("Invalid release identity")


def run_identity(run_id, attempt):
    if type(run_id) is not str or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
        raise ValueError("Invalid workflow run")
    if type(attempt) is not int or not 1 <= attempt <= 1000:
        raise ValueError("Invalid workflow attempt")
    return int(run_id), attempt


def validate_migration_inventory(rows, fingerprint):
    """Validate and fingerprint the exact canonical release migration inventory."""
    identity(fingerprint, DIGEST)
    if type(rows) is not list or not 1 <= len(rows) <= 1000:
        raise ValueError("Invalid release migration inventory")
    normalized = []
    ids, filenames = set(), set()
    for row in rows:
        exact(row, {"id", "filename", "sha256", "rollout"})
        migration_id, filename = row["id"], row["filename"]
        identity(migration_id, MIGRATION_ID)
        identity(filename, MIGRATION_FILENAME)
        identity(row["sha256"], DIGEST)
        if (filename[:4] != migration_id or type(row["rollout"]) is not str
                or row["rollout"] not in {"expand", "operator"}):
            raise ValueError("Invalid release migration entry")
        if migration_id in ids or filename in filenames:
            raise ValueError("Duplicate release migration entry")
        ids.add(migration_id)
        filenames.add(filename)
        normalized.append({"id": migration_id, "filename": filename,
                           "sha256": row["sha256"], "rollout": row["rollout"]})
    if [row["id"] for row in normalized] != sorted(ids):
        raise ValueError("Release migration inventory is not ordered")
    digest = hashlib.sha256(json.dumps(normalized, separators=(",", ":"),
                             ensure_ascii=False).encode()).hexdigest()
    if digest != fingerprint:
        raise ValueError("Release migration inventory fingerprint mismatch")
    return rows


def validate_manifest(value, allow_legacy=False):
    if type(value) is not dict or type(value.get("schema")) is not int:
        raise ValueError("Unsupported release schema")
    if value["schema"] == 1 and allow_legacy:
        exact(value, {"schema", "commit", "tree", "run_id", "attempt", "migrations",
                      "images", "archive_sha256", "archive_size"})
    elif value["schema"] == 2:
        exact(value, {"schema", "commit", "tree", "run_id", "attempt", "migrations",
                      "migration_inventory", "images", "archive_sha256", "archive_size"})
        validate_migration_inventory(value["migration_inventory"], value["migrations"])
    else:
        raise ValueError("Unsupported release schema")
    identity(value["commit"], SHA)
    identity(value["tree"], SHA)
    identity(value["migrations"], DIGEST)
    identity(value["archive_sha256"], DIGEST)
    run_identity(value["run_id"], value["attempt"])
    if type(value["archive_size"]) is not int or not 0 < value["archive_size"] <= MAX_ARCHIVE:
        raise ValueError("Archive is outside the size limit")
    exact(value["images"], {"api", "web"})
    for component in ["api", "web"]:
        image = value["images"][component]
        exact(image, {"tag", "id"})
        if image["tag"] != f"arden-release-{component}:sha-{value['commit']}":
            raise ValueError("Image tag is not bound to component and source")
        identity(image["id"], IMAGE_ID)
    if value["images"]["api"]["id"] == value["images"]["web"]["id"]:
        raise ValueError("App components require distinct images")
    return value


def validate_stored_manifest(value):
    """Allow old schema-1 active/baseline state without accepting it from new requests."""
    if type(value) is dict and "schema" not in value:
        exact(value, {"commit", "tree", "migrations", "images"})
        identity(value["commit"], SHA)
        identity(value["tree"], SHA)
        identity(value["migrations"], DIGEST)
        exact(value["images"], {"api", "web"})
        for image in value["images"].values():
            exact(image, {"id"})
            identity(image["id"], IMAGE_ID)
        return value
    return validate_manifest(value, allow_legacy=True)


def compare_migration_ledger(inventory, ledger_rows):
    """Compare a database ledger with a validated candidate inventory without applying SQL."""
    if type(inventory) is not list:
        raise ValueError("Invalid migration inventory")
    if ledger_rows is None:
        return {"status": "BASELINE_REQUIRED", "migration_ids": []}
    if type(ledger_rows) is not list:
        return {"status": "DRIFT", "migration_ids": []}
    applied = []
    checksums = {}
    for row in ledger_rows:
        if (type(row) is not dict or set(row) != {"migration_id", "checksum"}
                or type(row.get("migration_id")) is not str
                or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", row["migration_id"])):
            return {"status": "DRIFT", "migration_ids": []}
        migration_id, checksum = row["migration_id"], row["checksum"]
        if migration_id in checksums or (checksum is not None
                and (type(checksum) is not str or not DIGEST.fullmatch(checksum))):
            return {"status": "DRIFT", "migration_ids": []}
        applied.append(migration_id)
        checksums[migration_id] = checksum
    if applied != sorted(applied):
        return {"status": "DRIFT", "migration_ids": []}
    by_id = {row["filename"][:-4]: row for row in inventory}
    if any(migration_id not in by_id for migration_id in applied):
        return {"status": "DRIFT", "migration_ids": []}
    for migration_id in applied:
        if checksums[migration_id] is None:
            return {"status": "BASELINE_REQUIRED", "migration_ids": []}
        if checksums[migration_id] != by_id[migration_id]["sha256"]:
            return {"status": "DRIFT", "migration_ids": []}
    if [row["filename"][:-4] for row in inventory[:len(applied)]] != applied:
        return {"status": "DRIFT", "migration_ids": []}
    pending = inventory[len(applied):]
    migration_ids = [row["filename"][:-4] for row in pending]
    if not pending:
        return {"status": "NO_PENDING", "migration_ids": []}
    if any(row["rollout"] != "expand" for row in pending):
        return {"status": "REQUIRES_OPERATOR", "migration_ids": migration_ids}
    return {"status": "READY", "migration_ids": migration_ids}


def validate_request(value, forced_environment):
    if forced_environment not in {"staging", "production"} or type(value) is not dict:
        raise ValueError("Unknown deployment environment")
    if value.get("environment") != forced_environment:
        raise ValueError("Deployment capability is bound to another environment")
    op = value.get("op")
    if op == "status":
        exact(value, {"op", "environment"})
    elif op in {"upload", "deploy"}:
        exact(value, {"op", "environment", "manifest"})
        if forced_environment != "staging":
            raise ValueError("Production only promotes verified staging images")
        validate_manifest(value["manifest"])
    elif op == "promote":
        exact(value, {"op", "environment", "commit", "tree", "run_id", "attempt"})
        if forced_environment != "production":
            raise ValueError("Only production accepts promotion")
        identity(value["commit"], SHA)
        identity(value["tree"], SHA)
        run_identity(value["run_id"], value["attempt"])
    elif op == "plan-migrations":
        exact(value, {"op", "environment", "commit", "tree", "run_id", "attempt",
                      "migrations", "migration_inventory"})
        identity(value["commit"], SHA)
        identity(value["tree"], SHA)
        run_identity(value["run_id"], value["attempt"])
        validate_migration_inventory(value["migration_inventory"], value["migrations"])
    elif op == "reconcile-migrations":
        exact(value, {"op", "environment", "commit", "run_id", "attempt"})
        identity(value["commit"], SHA)
        run_identity(value["run_id"], value["attempt"])
    else:
        raise ValueError("Unknown release operation")
    return value


def read_header(stream, environment):
    raw = stream.readline(MAX_HEADER + 1)
    if len(raw) > MAX_HEADER or not raw.endswith(b"\n"):
        raise ValueError("Missing or oversized request header")
    value = strict_json(raw)
    if isinstance(value, dict) and value.get("op") == "status":
        return validate_request(value, environment), None
    exact(value, {"request", "identity_token"})
    request = validate_request(value["request"], environment)
    if request["op"] == "status" or not isinstance(value["identity_token"], str) or not 1 <= len(value["identity_token"]) <= 12288:
        raise ValueError("Missing mutating-operation identity proof")
    return request, value["identity_token"]


def validate_image_config(raw, component, manifest):
    config = strict_json(raw)
    if type(config) is not dict or config.get("architecture") != "amd64" or config.get("os") != "linux":
        raise ValueError("Wrong image platform")
    runtime = config.get("config")
    if type(runtime) is not dict or type(runtime.get("Labels")) is not dict:
        raise ValueError("Malformed image runtime configuration")
    labels = runtime["Labels"]
    expected_user = "1000:1000" if component == "api" else "101:101"
    if (runtime.get("User") != expected_user
            or labels.get("org.opencontainers.image.revision") != manifest["commit"]
            or labels.get("io.arden.release.tree") != manifest["tree"]
            or labels.get("io.arden.release.migrations") != manifest["migrations"]
            or labels.get("io.arden.release.managed") != "1"):
        raise ValueError("Image build identity or runtime user mismatch")


def validate_archive(stream, manifest):
    """Verify a Docker-save gzip archive without extracting it to the host."""
    validate_manifest(manifest)
    digest, size = hashlib.sha256(), 0
    stream.seek(0)
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        if size > manifest["archive_size"]:
            raise ValueError("Archive exceeds its declared size")
        digest.update(chunk)
    if size != manifest["archive_size"] or digest.hexdigest() != manifest["archive_sha256"]:
        raise ValueError("Archive integrity check failed")
    stream.seek(0)
    metadata, names, total = {}, set(), 0
    config_names = {name for image in manifest["images"].values()
                    for name in ["blobs/sha256/" + image["id"][7:], image["id"][7:] + ".json"]}
    try:
        # Parse fixed tar headers before any GNU/PAX interpretation. Only the two
        # expected config digests and manifest are buffered; opaque layers stream.
        with gzip.GzipFile(fileobj=stream, mode="rb") as expanded:
            def read_exact(amount):
                nonlocal total
                if total + amount > MAX_EXPANDED:
                    raise ValueError("Expanded archive exceeds limit")
                raw = expanded.read(amount)
                total += len(raw)
                if len(raw) != amount:
                    raise ValueError("Truncated outer image archive")
                return raw

            while True:
                header = read_exact(512)
                if header == b"\0" * 512:
                    if read_exact(512) != b"\0" * 512:
                        raise ValueError("Invalid archive terminator")
                    while padding := expanded.read(65536):
                        total += len(padding)
                        if total > MAX_EXPANDED or padding.strip(b"\0"):
                            raise ValueError("Unexpected data after archive terminator")
                    break
                item = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
                name = item.name.rstrip("/")
                path = PurePosixPath(name)
                if (not name or name in names or len(names) >= MAX_MEMBERS
                        or path.is_absolute() or ".." in path.parts or "\\" in name
                        or len(name) > 200 or not name.isascii()
                        or item.type not in {tarfile.DIRTYPE, tarfile.REGTYPE, tarfile.AREGTYPE}
                        or item.size < 0):
                    raise ValueError("Unsafe archive member")
                names.add(name)
                if item.isdir():
                    if item.size != 0 or (name not in {"blobs", "blobs/sha256"} and not DIGEST.fullmatch(name)):
                        raise ValueError("Unexpected archive directory")
                    continue
                if not MEMBER.fullmatch(name):
                    raise ValueError("Unexpected archive file")
                if total + item.size + (-item.size % 512) > MAX_EXPANDED:
                    raise ValueError("Expanded archive exceeds limit")
                if name == "manifest.json" or name in config_names:
                    if item.size > MAX_JSON:
                        raise ValueError("Archive metadata exceeds limit")
                    metadata[name] = read_exact(item.size)
                else:
                    remaining = item.size
                    while remaining:
                        amount = min(65536, remaining)
                        read_exact(amount)
                        remaining -= amount
                if read_exact(-item.size % 512).strip(b"\0"):
                    raise ValueError("Invalid archive member padding")
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ValueError("Invalid compressed image archive") from error
    entries = strict_json(metadata.get("manifest.json", b"null"))
    if type(entries) is not list or len(entries) != 2:
        raise ValueError("Archive must contain exactly the app image pair")
    seen = set()
    proven = {}
    for entry in entries:
        exact(entry, {"Config", "RepoTags", "Layers"})
        candidates = [component for component in ["api", "web"]
                      if entry["RepoTags"] == [manifest["images"][component]["tag"]]]
        if len(candidates) != 1 or candidates[0] in seen:
            raise ValueError("Unexpected or duplicate archived image tag")
        component = candidates[0]
        seen.add(component)
        if (type(entry["Config"]) is not str or entry["Config"] not in metadata
                or type(entry["Layers"]) is not list
                or any(type(layer) is not str or layer not in names for layer in entry["Layers"])):
            raise ValueError("Missing image content")
        raw = metadata[entry["Config"]]
        if "sha256:" + hashlib.sha256(raw).hexdigest() != manifest["images"][component]["id"]:
            raise ValueError("Image configuration digest mismatch")
        validate_image_config(raw, component, manifest)
        proven[component] = strict_json(raw)
    return proven
