"""Operator-only app separation helpers; no caller-controlled deployment targets."""

import copy
import base64
from pathlib import PurePosixPath
import re
import struct
import hashlib
import json


def verify_migration_inventory(rows, applied):
    if (not rows or any(set(row) != {"name", "sha256"}
                        or not re.fullmatch(r"\d{4}_[a-z0-9_]+\.sql", row["name"])
                        or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) for row in rows)
            or len({row["name"] for row in rows}) != len(rows)
            or sorted(applied) != sorted(row["name"][:-4] for row in rows)):
        raise ValueError("Applied database ledger differs from the captured image inventory")
    ordered = sorted(rows, key=lambda row: row["name"])
    return hashlib.sha256(json.dumps(ordered, separators=(",", ":")).encode()).hexdigest()


def candidate_template(final):
    candidate = copy.deepcopy(final)
    for name, network in candidate["services"]["arden-web"]["networks"].items():
        if name != "default":
            # Coolify's Compose serializer does not preserve an empty aliases array.
            network.pop("aliases", None)
    return candidate


def deployment_key_line(environment, public_key):
    if environment not in {"staging", "production"} or not isinstance(public_key, str):
        raise ValueError("Invalid deployment-key environment")
    value = public_key.strip()
    if "\n" in value or "\r" in value:
        raise ValueError("A deployment key must contain exactly one public key")
    parts = value.split()
    if len(parts) not in {2, 3} or parts[0] != "ssh-ed25519":
        raise ValueError("Only an ordinary Ed25519 public key is accepted")
    try:
        raw = base64.b64decode(parts[1], validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise ValueError("Malformed deployment public key") from error
    if (len(raw) != 51 or raw[:4] != struct.pack(">I", 11) or raw[4:15] != b"ssh-ed25519"
            or raw[15:19] != struct.pack(">I", 32)):
        raise ValueError("Malformed Ed25519 public key")
    return (f'restrict,command="sudo -n -- /usr/local/libexec/arden-release {environment}" '
            f'ssh-ed25519 {parts[1]} arden-ci-{environment}\n')


def build_app_template(environment, source_uuid, api, web):
    if environment not in {"staging", "production"} or not re.fullmatch(r"[a-z0-9]{8,64}", source_uuid):
        raise ValueError("Invalid approved bootstrap target")
    for kind, item in [("api", api), ("web", web)]:
        labels = item.get("Config", {}).get("Labels", {})
        if (labels.get("com.docker.compose.project") != source_uuid
                or labels.get("com.docker.compose.service") != f"arden-{environment}-{kind}"
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", item.get("Image", ""))):
            raise ValueError("Existing app identity does not match the approved resource")
    mounts = api.get("Mounts", [])
    private = [mount for mount in mounts if mount.get("Destination") == "/var/lib/arden/private"]
    if (len(private) != 1 or private[0].get("Type") != "volume" or private[0].get("RW") is not True
            or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", private[0].get("Name", ""))):
        raise ValueError("The exact existing private volume must be preserved")
    volumes = [{"type": "volume", "source": "private", "target": "/var/lib/arden/private"}]
    for mount in mounts:
        if mount is private[0]:
            continue
        if (mount.get("Type") != "bind" or mount.get("RW") is not False
                or not PurePosixPath(mount.get("Source", "")).is_absolute()
                or not PurePosixPath(mount.get("Destination", "")).is_absolute()):
            raise ValueError("Unexpected or writable extra application mount")
        volumes.append({"type": "bind", "source": mount["Source"],
                        "target": mount["Destination"], "read_only": True})
    values = {}
    base_keys = {"PATH", "NODE_VERSION", "YARN_VERSION", "COOLIFY_RESOURCE_UUID", "COOLIFY_PROJECT_NAME",
                 "COOLIFY_APP_NAME", "COOLIFY_ENVIRONMENT_NAME", "COOLIFY_SERVER_IP", "COOLIFY_CONTAINER_NAME"}
    app_keys = {"NODE_ENV", "DATABASE_URL", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "TZ"}
    for entry in api.get("Config", {}).get("Env", []):
        key, separator, value = entry.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or key in values:
            raise ValueError("Invalid or duplicate runtime setting")
        # Coolify's old combined Service injects deployment-substitution/Auth-only
        # inputs into every container. They are not application runtime settings.
        if key in base_keys or key.startswith(("SERVICE_NAME_ARDEN_", "ARDEN_STAGING_", "ARDEN_PRODUCTION_")):
            continue
        if key not in app_keys and not key.startswith(("ARDEN_", "SUPABASE_", "SMTP_")):
            raise ValueError("Review the additional runtime setting before cutover")
        values[key] = value
    if not values.get("DATABASE_URL") or not values.get("SUPABASE_URL"):
        raise ValueError("Existing database and Auth configuration are required")
    external = {}

    def network(name):
        if name not in external:
            external[name] = f"external_{len(external)}"
        return external[name]

    api_networks = {"default": {"aliases": [f"arden-{environment}-api"]}}
    for name in api.get("NetworkSettings", {}).get("Networks", {}):
        api_networks[network(name)] = {}
    if source_uuid not in external:
        raise ValueError("Existing Auth network is missing")
    web_networks = {"default": {}}
    for name, details in web.get("NetworkSettings", {}).get("Networks", {}).items():
        if name == source_uuid:
            continue
        aliases = [alias for alias in details.get("Aliases", []) or []
                   if isinstance(alias, str) and not re.fullmatch(r"[0-9a-f]{12,64}", alias)]
        web_networks[network(name)] = {"aliases": aliases}
    if len(web_networks) < 2:
        raise ValueError("Existing public edge network is missing")
    hardening = {"pull_policy": "never", "restart": "unless-stopped", "read_only": True,
                 "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"]}
    compose = {
        "services": {
            "arden-api": {**copy.deepcopy(hardening), "image": api["Image"], "user": "1000:1000",
                          "environment": {key: "${" + key + "}" for key in values},
                          "volumes": volumes, "networks": api_networks,
                          "tmpfs": ["/tmp:rw,nosuid,nodev,size=64m"], "mem_limit": "512m", "pids_limit": 128,
                          "logging": {"driver": "none"}},
            "arden-web": {**copy.deepcopy(hardening), "image": web["Image"], "user": "101:101",
                          "depends_on": {"arden-api": {"condition": "service_healthy"}},
                          "networks": web_networks, "expose": ["8080"],
                          "tmpfs": ["/tmp:rw,nosuid,nodev,size=32m"], "mem_limit": "128m", "pids_limit": 64,
                          "logging": {"driver": "json-file", "options": {"max-size": "1m", "max-file": "2"}}},
        },
        "volumes": {"private": {"external": True, "name": private[0]["Name"]}},
        "networks": {"default": {}, **{alias: {"external": True, "name": name} for name, alias in external.items()}},
    }
    return {"compose": compose, "values": values}
