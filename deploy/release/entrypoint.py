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
from receiver import ReleaseEngine
from state import read_json


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
    for target in [Path(config["state_dir"]) / "state.json", Path(config["state_dir"]).parent / "release.lock"]:
        if target.exists() or target.is_symlink():
            secure_file(target)
    request = read_header(sys.stdin.buffer, environment)
    engine = ReleaseEngine(environment, config["state_dir"], CoolifyManager(config), config["staging_dir"])
    op = request["op"]
    if op == "upload":
        result = engine.upload(request["manifest"], sys.stdin.buffer)
    else:
        if sys.stdin.buffer.read(1):
            raise ValueError("Unexpected data after request")
        if op == "status":
            result = engine.status()
        elif op == "deploy":
            result = engine.deploy(request["manifest"])
        else:
            result = engine.promote(request)
    print(json.dumps({"ok": True, "result": result}, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never emit HTTP bodies, command output, config values or chained exceptions.
        category = "invalid_request" if isinstance(error, ValueError) else "release_failed"
        print(json.dumps({"ok": False, "error": category}, separators=(",", ":")), flush=True)
        sys.exit(1)
