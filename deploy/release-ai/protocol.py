"""Strict, environment-bound AI release protocol; never executes archive contents."""

import gzip
import hashlib
import json
from pathlib import PurePosixPath
import re
import tarfile

MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_EXPANDED = 2560 * 1024 * 1024
MAX_MEMBERS = 512
MAX_JSON = 1024 * 1024
MAX_HEADER = 16384
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
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
        raise ValueError("Invalid AI release identity")


def run_identity(run_id, attempt):
    if type(run_id) is not str or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
        raise ValueError("Invalid workflow run")
    if type(attempt) is not int or not 1 <= attempt <= 1000:
        raise ValueError("Invalid workflow attempt")
    return int(run_id), attempt


def validate_manifest(value):
    if type(value) is not dict or value.get("schema") != 1:
        raise ValueError("Unsupported AI release schema")
    exact(value, {"schema", "commit", "ai_tree", "run_id", "attempt",
                  "images", "archive_sha256", "archive_size"})
    identity(value["commit"], SHA)
    identity(value["ai_tree"], SHA)
    identity(value["archive_sha256"], DIGEST)
    run_identity(value["run_id"], value["attempt"])
    if type(value["archive_size"]) is not int or not 0 < value["archive_size"] <= MAX_ARCHIVE:
        raise ValueError("AI archive is outside the size limit")
    exact(value["images"], {"ai"})
    image = value["images"]["ai"]
    exact(image, {"tag", "id"})
    if image["tag"] != f"arden-release-ai:sha-{value['commit']}":
        raise ValueError("AI image tag is not bound to source commit")
    identity(image["id"], IMAGE_ID)
    return value


def validate_stored_manifest(value):
    """Allow an operator manual baseline without accepting it from new SSH requests."""
    if type(value) is dict and "schema" not in value:
        exact(value, {"commit", "ai_tree", "images"})
        identity(value["commit"], SHA)
        identity(value["ai_tree"], SHA)
        exact(value["images"], {"ai"})
        exact(value["images"]["ai"], {"id"})
        identity(value["images"]["ai"]["id"], IMAGE_ID)
        return value
    return validate_manifest(value)


def validate_request(value, forced_environment):
    if forced_environment not in {"staging", "production"} or type(value) is not dict:
        raise ValueError("Unknown AI deployment environment")
    if value.get("environment") != forced_environment:
        raise ValueError("AI deployment capability is bound to another environment")
    op = value.get("op")
    if op == "status":
        exact(value, {"op", "environment"})
    elif op in {"upload", "deploy"}:
        exact(value, {"op", "environment", "manifest"})
        if forced_environment != "staging":
            raise ValueError("Production only promotes verified staging AI images")
        validate_manifest(value["manifest"])
    elif op in {"plan-promote", "promote"}:
        exact(value, {"op", "environment", "commit", "ai_tree", "run_id", "attempt"})
        if forced_environment != "production":
            raise ValueError("Only production accepts AI promotion")
        identity(value["commit"], SHA)
        identity(value["ai_tree"], SHA)
        run_identity(value["run_id"], value["attempt"])
    else:
        raise ValueError("Unknown AI release operation")
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
    if (request["op"] == "status" or not isinstance(value["identity_token"], str)
            or not 1 <= len(value["identity_token"]) <= 12288):
        raise ValueError("Missing mutating-operation identity proof")
    return request, value["identity_token"]


def validate_image_config(raw, manifest):
    config = strict_json(raw)
    if type(config) is not dict or config.get("architecture") != "amd64" or config.get("os") != "linux":
        raise ValueError("Wrong AI image platform")
    runtime = config.get("config")
    if type(runtime) is not dict or type(runtime.get("Labels")) is not dict:
        raise ValueError("Malformed AI image runtime configuration")
    labels = runtime["Labels"]
    if (runtime.get("User") != "1000:1000"
            or labels.get("org.opencontainers.image.revision") != manifest["commit"]
            or labels.get("io.arden.release.ai_tree") != manifest["ai_tree"]
            or labels.get("io.arden.release.ai_managed") != "1"
            or "io.arden.release.managed" in labels):
        raise ValueError("AI image build identity, label boundary, or runtime user mismatch")


def validate_archive(stream, manifest):
    """Verify a single-image Docker-save gzip archive without extracting it to the host."""
    validate_manifest(manifest)
    digest, size = hashlib.sha256(), 0
    stream.seek(0)
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        if size > manifest["archive_size"]:
            raise ValueError("AI archive exceeds its declared size")
        digest.update(chunk)
    if size != manifest["archive_size"] or digest.hexdigest() != manifest["archive_sha256"]:
        raise ValueError("AI archive integrity check failed")
    stream.seek(0)
    metadata, names, files, total = {}, set(), set(), 0
    layer_member = re.compile(r"(?:blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}/layer\.tar)\Z")
    ai_id = manifest["images"]["ai"]["id"][7:]
    config_names = {"blobs/sha256/" + ai_id, ai_id + ".json"}
    try:
        # Parse fixed 512-byte USTAR headers before any GNU/PAX interpretation.
        with gzip.GzipFile(fileobj=stream, mode="rb") as expanded:
            def read_exact(amount):
                nonlocal total
                if total + amount > MAX_EXPANDED:
                    raise ValueError("Expanded AI archive exceeds limit")
                raw = expanded.read(amount)
                total += len(raw)
                if len(raw) != amount:
                    raise ValueError("Truncated AI image archive")
                return raw

            while True:
                header = read_exact(512)
                if header == b"\0" * 512:
                    if read_exact(512) != b"\0" * 512:
                        raise ValueError("Invalid AI archive terminator")
                    while padding := expanded.read(65536):
                        total += len(padding)
                        if total > MAX_EXPANDED or padding.strip(b"\0"):
                            raise ValueError("Unexpected data after AI archive terminator")
                    break
                item = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
                name = item.name.rstrip("/")
                path = PurePosixPath(name)
                if (not name or name in names or len(names) >= MAX_MEMBERS
                        or path.is_absolute() or ".." in path.parts or "\\" in name
                        or len(name) > 200 or not name.isascii()
                        or item.type not in {tarfile.DIRTYPE, tarfile.REGTYPE, tarfile.AREGTYPE}
                        or item.size < 0):
                    raise ValueError("Unsafe AI archive member")
                names.add(name)
                if item.isdir():
                    if item.size != 0 or (name not in {"blobs", "blobs/sha256"} and not DIGEST.fullmatch(name)):
                        raise ValueError("Unexpected AI archive directory")
                    continue
                if not MEMBER.fullmatch(name):
                    raise ValueError("Unexpected AI archive file")
                files.add(name)
                if total + item.size + (-item.size % 512) > MAX_EXPANDED:
                    raise ValueError("Expanded AI archive exceeds limit")
                if name == "manifest.json" or name in config_names:
                    if item.size > MAX_JSON:
                        raise ValueError("AI archive metadata exceeds limit")
                    metadata[name] = read_exact(item.size)
                else:
                    remaining = item.size
                    while remaining:
                        amount = min(65536, remaining)
                        read_exact(amount)
                        remaining -= amount
                if read_exact(-item.size % 512).strip(b"\0"):
                    raise ValueError("Invalid AI archive member padding")
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ValueError("Invalid compressed AI image archive") from error
    entries = strict_json(metadata.get("manifest.json", b"null"))
    if type(entries) is not list or len(entries) != 1:
        raise ValueError("AI archive must contain exactly the single AI image")
    entry = entries[0]
    exact(entry, {"Config", "RepoTags", "Layers"})
    if entry["RepoTags"] != [manifest["images"]["ai"]["tag"]]:
        raise ValueError("Unexpected archived AI image tag")
    if (type(entry["Config"]) is not str or entry["Config"] not in metadata
            or type(entry["Layers"]) is not list or not entry["Layers"]
            or any(type(layer) is not str or layer not in files or not layer_member.fullmatch(layer)
                   for layer in entry["Layers"])):
        raise ValueError("Missing AI image content")
    raw = metadata[entry["Config"]]
    if "sha256:" + hashlib.sha256(raw).hexdigest() != manifest["images"]["ai"]["id"]:
        raise ValueError("AI image configuration digest mismatch")
    validate_image_config(raw, manifest)
    return {"ai": strict_json(raw)}
