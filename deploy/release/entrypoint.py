#!/usr/bin/env python3
"""Root-only forced-command endpoint. Invoke with Python isolated mode (-I)."""

import json
import os
from pathlib import Path
import signal
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from management import CoolifyManager, validate_config
from protocol import read_header
from receiver import MigrationBlocked, ReleaseEngine
from state import read_json
from identity import verify_identity


def secure_directory(path, private=False):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("Protected directory must be an absolute path without links")
    for ancestor in [path, *path.parents]:
        info = ancestor.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
                or (ancestor == path and private and info.st_mode & 0o077)):
            raise ValueError("Protected directory has an untrusted owner or permissions")


def secure_file(path):
    path = Path(path)
    info = path.lstat()
    secure_directory(path.parent)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077
            or path.resolve() != path):
        raise ValueError("Release configuration is not protected")


def dispatch_request(engine, request, stream, provenance):
    op = request["op"]
    if op == "upload":
        return engine.upload(request["manifest"], stream, provenance)
    if stream.read(1):
        raise ValueError("Unexpected data after request")
    if op == "status":
        return engine.status()
    if op == "plan-migrations":
        return engine.plan_migrations(request, provenance)
    if op == "reconcile-migrations":
        return engine.reconcile_migrations(request, provenance)
    if op == "deploy":
        return engine.deploy(request["manifest"], provenance)
    if op == "promote":
        return engine.promote(request, provenance)
    raise ValueError("Unknown release operation")


def error_response(error):
    if isinstance(error, MigrationBlocked):
        return {"ok": False, "error": "migration_blocked", "status": error.status,
                "migration_ids": error.migration_ids}
    category = "invalid_request" if isinstance(error, ValueError) else "release_failed"
    return {"ok": False, "error": category}


def main():
    os.umask(0o077)
    if os.name != "posix" or os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError("Receiver requires its approved privileged forced command")
    environment = sys.argv[1]
    if environment not in {"staging", "production"}:
        raise ValueError("Unknown forced-command environment")
    signal.alarm(1200)
    config_path = Path("/etc/arden/releases") / f"{environment}.json"
    secure_file(config_path)
    config = validate_config(read_json(config_path), environment)
    if (config["token_path"] != "/etc/arden/releases/management.token"
            or config["state_dir"] != f"/var/lib/arden/releases/{environment}"
            or config["staging_dir"] != "/var/lib/arden/releases/staging"):
        raise ValueError("Unexpected protected configuration path")
    secure_file(config["token_path"])
    secure_directory(Path(config["state_dir"]).parent, private=True)
    secure_directory(config["state_dir"], private=True)
    secure_directory(config["staging_dir"], private=True)
    migration = config.get("migration")
    protected_migration_files = [Path(config["state_dir"]) / "migration-baseline.json"]
    if migration is not None:
        protected_migration_files.extend([
            Path(migration["env_file"]),
            Path("/etc/arden/releases") / f"{environment}.backup-readiness.json"])
    for target in protected_migration_files:
        if target.exists() or target.is_symlink():
            secure_file(target)
    for target in [Path(config["state_dir"]) / "state.json", Path(config["state_dir"]).parent / "release.lock"]:
        if target.exists() or target.is_symlink():
            secure_file(target)
    request, identity_token = read_header(sys.stdin.buffer, environment)
    provenance = None if request["op"] == "status" else verify_identity(identity_token, request)
    engine = ReleaseEngine(environment, config["state_dir"], CoolifyManager(config), config["staging_dir"])
    result = dispatch_request(engine, request, sys.stdin.buffer, provenance)
    print(json.dumps({"ok": True, "result": result}, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never emit HTTP bodies, command output, config values or chained exceptions.
        print(json.dumps(error_response(error), separators=(",", ":")), flush=True)
        sys.exit(1)
