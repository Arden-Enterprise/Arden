"""Coolify app-only adapter; neither source nor secrets come from the SSH caller."""

import base64
import copy
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
from urllib import request as http, error as http_error
from urllib.parse import unquote, urlsplit

from protocol import (strict_json, DIGEST, IMAGE_ID, compare_migration_ledger,
                      validate_migration_inventory)
from state import read_json, write_json


def validate_config(config, environment):
    if config.get("environment") != environment or environment not in {"staging", "production"}:
        raise ValueError("Configuration belongs to a different environment")
    if not re.fullmatch(r"[a-z0-9]{8,64}", config.get("service_uuid", "")):
        raise ValueError("Invalid configured service identity")
    url = urlsplit(config.get("api_url", ""))
    if (url.scheme != "http" or url.hostname not in {"127.0.0.1", "::1"}
            or url.username or url.password or url.query or url.fragment
            or url.path != "/api/v1"):
        raise ValueError("Management API must be an explicit loopback endpoint")
    origin = urlsplit(config.get("origin", ""))
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.path not in {"", "/"} or origin.query or origin.fragment):
        raise ValueError("Invalid configured HTTPS origin")
    services = config.get("template", {}).get("services", {})
    if set(services) != {"arden-api", "arden-web"}:
        raise ValueError("Only app containers may belong to a release Service")
    forbidden = {"build", "ports", "privileged", "devices", "pid", "ipc", "network_mode", "cap_add"}
    for name, user in [("arden-api", "1000:1000"), ("arden-web", "101:101")]:
        service = services[name]
        if (forbidden.intersection(service) or service.get("user") != user
                or service.get("read_only") is not True or service.get("cap_drop") != ["ALL"]
                or service.get("security_opt") != ["no-new-privileges:true"]
                or service.get("pull_policy") != "never"):
            raise ValueError("Unsafe app runtime configuration")
    for volume in config.get("template", {}).get("volumes", {}).values():
        if volume.get("external") is not True or not volume.get("name"):
            raise ValueError("Existing private storage must be explicit and external")
    if not DIGEST.fullmatch(config.get("migrations", "")):
        raise ValueError("Missing approved migration fingerprint")
    migration = config.get("migration")
    if migration is not None:
        if (type(migration) is not dict or set(migration) != {
                "network", "database_image", "database_host", "database_name",
                "runtime_database_user", "env_file"}
                or any(type(migration.get(field)) is not str for field in {
                    "network", "database_image", "database_host", "database_name",
                    "runtime_database_user", "env_file"})):
            raise ValueError("Invalid protected migration configuration")
        if (not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", migration["network"])
                or migration["network"].lower() in {"bridge", "host", "none"}
                or not IMAGE_ID.fullmatch(migration["database_image"])
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", migration["database_host"])
                or not re.fullmatch(r"[a-zA-Z0-9_]{1,63}", migration["database_name"])
                or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_-]{0,62}", migration["runtime_database_user"])
                or migration["env_file"] != f"/etc/arden/releases/{environment}.migration.env"):
            raise ValueError("Invalid protected migration target")
        attached = services["arden-api"].get("networks", {})
        declared = config.get("template", {}).get("networks", {})
        valid_networks = {network.get("name") for alias, network in declared.items()
                          if alias in attached and alias != "default"
                          and type(network) is dict and network.get("external") is True
                          and isinstance(network.get("name"), str)}
        if migration["network"] not in valid_networks:
            raise ValueError("Migration network is not an attached private API network")
    return config


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CoolifyManager:
    def __init__(self, config, request=None, command=None, operation=None, migration_command=None):
        self.config = validate_config(config, config.get("environment"))
        self.request = request or self._request
        self.command = command or self._command
        self.operation = operation or self._operation
        self.migration_command = migration_command or self._migration_command
        self.protected = None

    @staticmethod
    def _migration_command(arguments, timeout=900):
        try:
            result = subprocess.run(arguments, capture_output=True, text=True,
                                    timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError("Migration command outcome requires reconciliation") from error
        if result.returncode:
            raise RuntimeError("Migration command failed; database state requires reconciliation")
        if len(result.stdout) > 64 * 1024:
            raise RuntimeError("Migration command response exceeds its limit")
        return result.stdout

    def _operation(self, op):
        message = {"op": op, "service_uuid": self.config["service_uuid"],
                   "token": Path(self.config["token_path"]).read_text().strip()}
        result = subprocess.run(["/usr/bin/docker", "exec", "--user", "0", "-i", "coolify", "php",
                                 "/var/lib/arden-release-bridge/operation.php"],
                                input=json.dumps(message), capture_output=True, text=True,
                                timeout=60 if op == "start" else 20)
        value = strict_json(result.stdout)
        if result.returncode != 0 or value.get("status") == "unavailable":
            raise RuntimeError("Coolify deployment activity is unavailable")
        return value

    def _wait_operation(self, allow_failed):
        deadline = time.monotonic() + 300
        while True:
            result = self.operation("status")
            status = result.get("status")
            if status == "finished" or (allow_failed and status in {"none", "error", "killed", "cancelled"}):
                return
            if status not in {"queued", "in_progress"} or time.monotonic() >= deadline:
                raise RuntimeError("Coolify operation is failed or uncertain; no duplicate dispatch")
            time.sleep(2)

    def _request(self, method, path, body=None):
        if self.config.get("api_namespace") is True:
            pid = self.command(["inspect", "--format", "{{.State.Pid}}", "coolify"]).strip()
            if not re.fullmatch(r"[1-9][0-9]{0,9}", pid):
                raise ValueError("Coolify network namespace is unavailable")
            message = {"base": self.config["api_url"], "method": method, "path": path, "body": body}
            result = subprocess.run(["/usr/bin/nsenter", "--target", pid, "--net", "/usr/bin/python3", "-I",
                                     str(Path(__file__).with_name("local_http.py"))],
                                    input=json.dumps(message), capture_output=True, text=True, timeout=40)
            reply = strict_json(result.stdout)
            if result.returncode != 0 or reply.get("ok") is not True:
                raise RuntimeError("Local Coolify management request failed")
            return reply["result"]
        token = Path(self.config["token_path"]).read_text().strip()
        data = None if body is None else json.dumps(body).encode()
        req = http.Request(self.config["api_url"] + path, data=data, method=method,
                           headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with http.build_opener(NoRedirect).open(req, timeout=30) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise ValueError("Management response exceeds limit")
                return strict_json(raw)
        except (http_error.URLError, OSError) as error:
            raise RuntimeError("Coolify management request failed") from error

    @staticmethod
    def _command(arguments):
        result = subprocess.run(["/usr/bin/docker", *arguments], capture_output=True,
                                text=True, timeout=180, check=False)
        if result.returncode:
            raise RuntimeError("Release Docker operation failed")
        return result.stdout

    def baseline(self):
        return copy.deepcopy(self.config["baseline"])

    def compose_for(self, manifest):
        result = copy.deepcopy(self.config["template"])
        for component in ["api", "web"]:
            result["services"][f"arden-{component}"]["image"] = self.image_id(manifest, component)
        return result

    def binding_path(self):
        return Path(self.config["state_dir"]).parent / "image-bindings.json"

    def image_id(self, manifest, component):
        image = manifest["images"][component]
        if image == self.config["baseline"]["images"][component]:
            return image["id"]
        path = self.binding_path()
        bindings = read_json(path) if path.exists() else {}
        value = bindings.get(image["id"])
        if not isinstance(value, str) or not IMAGE_ID.fullmatch(value):
            raise ValueError("Portable image content has no verified local binding")
        return value

    def _inspect(self, name):
        template = '{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}}}'
        return strict_json(self.command(["inspect", "--format", template, name]))

    def _check_protected(self):
        current = {}
        for name in self.config["protected_containers"]:
            item = self._inspect(name)
            if not item["state"].get("Running"):
                raise RuntimeError("Protected infrastructure is not running")
            current[name] = item["id"]
        if self.protected is None:
            self.protected = current
        elif current != self.protected:
            raise RuntimeError("Protected infrastructure was recreated during deployment")

    def preflight(self, manifest):
        if manifest.get("schema") in {None, 1}:
            if manifest["migrations"] != self.config["migrations"]:
                raise ValueError("Schema approval is required before this release")
        elif manifest.get("schema") == 2:
            if not self._baseline_receipt_ready():
                raise ValueError("Migration checksum baseline is required before this release")
        else:
            raise ValueError("Unsupported migration release schema")
        if shutil.disk_usage(self.config["state_dir"]).free < 256 * 1024 * 1024:
            raise ValueError("Insufficient release disk space")
        if self.config.get("coolify_image_id"):
            actual = self.command(["inspect", "--format", "{{.Image}}", "coolify"]).strip()
            if actual != self.config["coolify_image_id"]:
                raise ValueError("Review the Coolify adapter after its image changes")
        self._check_protected()

    def _migration_settings(self):
        settings = self.config.get("migration")
        if not isinstance(settings, dict):
            return None
        path = Path(settings["env_file"])
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077
                    or path.is_symlink() or path.resolve() != path):
                return None
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return None
        lines = raw.splitlines()
        prefix = "ARDEN_MIGRATION_DATABASE_URL="
        if len(lines) != 1 or "\r" in raw or not lines[0].startswith(prefix):
            return None
        value = lines[0][len(prefix):]
        try:
            url = urlsplit(value)
            database = unquote(url.path.lstrip("/"))
            username = unquote(url.username or "")
            password = url.password
            port = url.port
        except ValueError:
            return None
        if (url.scheme not in {"postgres", "postgresql"} or not url.hostname
                or url.hostname != settings["database_host"] or database != settings["database_name"]
                or username in {"", settings["runtime_database_user"]} or not password
                or url.query or url.fragment or (port is not None and port != 5432)):
            return None
        return {**settings, "migration_database_user": username}

    def _baseline_receipt_ready(self):
        path = Path(self.config["state_dir"]) / "migration-baseline.json"
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077
                    or path.is_symlink() or path.resolve() != path):
                return False
            receipt = read_json(path)
        except (OSError, ValueError):
            return False
        baseline = self.config["baseline"]
        expected = {"commit": baseline.get("commit"), "tree": baseline.get("tree"),
                    "api_image": baseline.get("images", {}).get("api", {}).get("id"),
                    "migrations": baseline.get("migrations")}
        if (type(receipt) is not dict or set(receipt) != {"schema", "environment", "source", "checksums", "verified_at"}
                or receipt.get("schema") != 1 or receipt.get("environment") != self.config["environment"]
                or receipt.get("source") != expected or type(receipt.get("verified_at")) is not int
                or not 0 < receipt["verified_at"] <= int(time.time()) + 60
                or type(receipt.get("checksums")) is not list or not receipt["checksums"]):
            return False
        ids = []
        for row in receipt["checksums"]:
            if (type(row) is not dict or set(row) != {"migration_id", "checksum"}
                    or type(row.get("migration_id")) is not str
                    or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", row["migration_id"])
                    or type(row.get("checksum")) is not str or not DIGEST.fullmatch(row["checksum"])):
                return False
            ids.append(row["migration_id"])
        return ids == sorted(set(ids))

    def _backup_ready(self, settings):
        path = Path(f"/etc/arden/releases/{self.config['environment']}.backup-readiness.json")
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077
                    or path.is_symlink() or path.resolve() != path):
                return False
            receipt = read_json(path)
        except (OSError, ValueError):
            return False
        fields = {"schema", "environment", "network", "database_host", "database_name",
                  "backup_reference", "backup_created_at", "restore_tested_at", "verified_at"}
        now = int(time.time())
        return (type(receipt) is dict and set(receipt) == fields
                and receipt.get("schema") == 1 and receipt.get("environment") == self.config["environment"]
                and receipt.get("network") == settings["network"]
                and receipt.get("database_host") == settings["database_host"]
                and receipt.get("database_name") == settings["database_name"]
                and type(receipt.get("backup_reference")) is str
                and re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", receipt["backup_reference"]) is not None
                and all(type(receipt.get(key)) is int and 0 < receipt[key] <= now
                        for key in ["backup_created_at", "restore_tested_at", "verified_at"])
                and now - receipt["backup_created_at"] <= 24 * 60 * 60
                and now - receipt["restore_tested_at"] <= 90 * 24 * 60 * 60
                and now - receipt["verified_at"] <= 15 * 60)

    def _read_migration_ledger(self, settings):
        image = settings["database_image"]
        actual = self.command(["image", "inspect", "--format", "{{.Id}}", image]).strip()
        user = self.command(["image", "inspect", "--format", "{{.Config.User}}", image]).strip()
        if actual != image or not user or user.lower() in {"root", "0", "0:0", "root:root"}:
            raise RuntimeError("Protected database client image is unavailable")
        script = ("set -eu; "
                  "status=$(psql --dbname=\"$ARDEN_MIGRATION_DATABASE_URL\" --no-psqlrc "
                  "--set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "
                  "--command=\"SELECT CASE WHEN to_regclass('public.arden_schema_migrations') IS NULL "
                  "THEN 'MISSING_TABLE' WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns "
                  "WHERE table_schema='public' AND table_name='arden_schema_migrations' "
                  "AND column_name='checksum' AND data_type='text') THEN 'MISSING_CHECKSUM' ELSE 'READY' END\"); "
                  "printf '%s\\n' \"$status\"; "
                  "if [ \"$status\" = READY ]; then "
                  "role=$(psql --dbname=\"$ARDEN_MIGRATION_DATABASE_URL\" --no-psqlrc "
                  "--set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "
                  "--command=\"SELECT current_database() || '|' || current_user || '|' || "
                  "r.rolsuper::text || '|' || r.rolbypassrls::text || '|' || r.rolcreatedb::text || '|' || "
                  "r.rolcreaterole::text || '|' || r.rolreplication::text || '|' || "
                  "has_schema_privilege(current_user, 'arden', 'CREATE')::text || '|' || "
                  "(SELECT pg_get_userbyid(relowner)=current_user FROM pg_class "
                  "WHERE oid='public.arden_schema_migrations'::regclass)::text "
                  "FROM pg_roles r WHERE r.rolname=current_user\"); "
                  "printf 'ROLE|%s\\n' \"$role\"; "
                  "psql --dbname=\"$ARDEN_MIGRATION_DATABASE_URL\" --no-psqlrc "
                  "--set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align "
                  "--field-separator='|' --command=\"SELECT migration_id || '|' || COALESCE(checksum, '') "
                  "FROM public.arden_schema_migrations ORDER BY migration_id\"; fi")
        arguments = ["/usr/bin/docker", "run", "--rm", "--pull=never", "--network", settings["network"],
                     "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
                     "--memory", "128m", "--cpus", "0.50", "--pids-limit", "32",
                     "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                     "--log-driver", "none", "--env-file", settings["env_file"],
                     "--env", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000",
                     "--entrypoint", "/bin/sh", image, "-c", script]
        output = self.migration_command(arguments, timeout=60)
        lines = output.splitlines()
        if not lines or lines[0] in {"MISSING_TABLE", "MISSING_CHECKSUM"}:
            return None
        if lines[0] != "READY":
            raise RuntimeError("Protected migration ledger response is invalid")
        if len(lines) < 2 or not lines[1].startswith("ROLE|"):
            raise RuntimeError("Protected migration role could not be verified")
        role = lines[1][len("ROLE|"):].split("|")
        if (len(role) != 9 or role[0] != settings["database_name"]
                or role[1] != settings["migration_database_user"] or role[1] in {"", "postgres"}
                or role[2:7] != ["false"] * 5 or role[7:] != ["true", "true"]):
            raise RuntimeError("Protected migration role is not the approved least-privilege owner")
        rows = []
        for line in lines[2:]:
            pieces = line.split("|")
            if len(pieces) != 2:
                raise RuntimeError("Protected migration ledger response is invalid")
            rows.append({"migration_id": pieces[0], "checksum": pieces[1] or None})
        return rows

    def plan_migrations(self, candidate):
        inventory = candidate.get("migration_inventory") if isinstance(candidate, dict) else None
        fingerprint = candidate.get("migrations") if isinstance(candidate, dict) else None
        try:
            validate_migration_inventory(inventory, fingerprint)
        except ValueError:
            return {"status": "DRIFT", "migration_ids": []}
        settings = self._migration_settings()
        if settings is None or not self._baseline_receipt_ready():
            return {"status": "BASELINE_REQUIRED", "migration_ids": []}
        try:
            ledger = self._read_migration_ledger(settings)
        except Exception as error:
            return {"status": "OUTCOME_UNKNOWN", "migration_ids": []}
        plan = compare_migration_ledger(inventory, ledger)
        if plan["status"] == "READY" and not self._backup_ready(settings):
            return {"status": "BACKUP_NOT_READY", "migration_ids": plan["migration_ids"]}
        return plan

    @staticmethod
    def _migration_cli_result(raw, inventory):
        try:
            value = strict_json(raw)
        except ValueError as error:
            raise RuntimeError("Migration runner returned an invalid response") from error
        if type(value) is not dict or set(value) - {"status", "migration_ids", "reason"}:
            raise RuntimeError("Migration runner returned an invalid response")
        if (value.get("status") not in {"APPLIED", "NO_PENDING", "LOCKED", "BASELINE_REQUIRED", "DRIFT", "REQUIRES_OPERATOR"}
                or type(value.get("migration_ids")) is not list
                or any(type(item) is not str or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", item)
                       for item in value["migration_ids"])
                or len(value["migration_ids"]) != len(set(value["migration_ids"]))):
            raise RuntimeError("Migration runner returned an invalid response")
        known = {item["filename"][:-4] for item in inventory}
        if any(item not in known for item in value["migration_ids"]):
            raise RuntimeError("Migration runner returned an invalid response")
        return value

    def apply_migrations(self, manifest):
        plan = self.plan_migrations(manifest)
        if plan["status"] == "NO_PENDING":
            return plan
        if plan["status"] != "READY":
            raise ValueError("Migration plan is blocked: " + plan["status"])
        settings = self._migration_settings()
        if settings is None:
            raise ValueError("Migration configuration is unavailable")
        self.ensure_images(manifest)
        image = self.image_id(manifest, "api")
        arguments = ["/usr/bin/docker", "run", "--rm", "--pull=never", "--network", settings["network"],
                     "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
                     "--memory", "512m", "--cpus", "0.75", "--pids-limit", "64",
                     "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                     "--log-driver", "none", "--env-file", settings["env_file"],
                     "--entrypoint", "node", image, "dist/db/migrate.js", "--apply-safe"]
        failed = False
        try:
            raw = self.migration_command(arguments, timeout=900)
            result = self._migration_cli_result(raw, manifest["migration_inventory"])
            failed = result["status"] not in {"APPLIED", "NO_PENDING"}
        except Exception:
            failed = True
        reconciled = self.plan_migrations(manifest)
        if reconciled["status"] == "NO_PENDING":
            return {"status": "APPLIED" if plan["status"] == "READY" else "NO_PENDING",
                    "migration_ids": plan["migration_ids"], "reconciled": failed}
        if failed:
            raise RuntimeError("Migration failed; the database ledger was reconciled and the app was not activated")
        if reconciled["status"] != "NO_PENDING":
            raise RuntimeError("Migration did not reach the candidate ledger; the app was not activated")
        return {"status": "APPLIED", "migration_ids": plan["migration_ids"]}

    @staticmethod
    def _normalized_config(value):
        # Docker adds inert defaults omitted from OCI image configs.
        defaults = {"ArgsEscaped": False, "Hostname": "", "Domainname": "", "Image": "",
                    "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
                    "Tty": False, "OpenStdin": False, "StdinOnce": False,
                    "NetworkDisabled": False, "MacAddress": ""}
        return {key: data for key, data in value.items()
                if data is not None and not (key in defaults and type(data) is type(defaults[key]) and data == defaults[key])}

    @classmethod
    def _matches_content(cls, actual, expected):
        return (bool(IMAGE_ID.fullmatch(actual.get("Id", "")))
                and actual.get("Architecture") == "amd64" and actual.get("Os") == "linux"
                and cls._normalized_config(actual.get("Config", {})) == cls._normalized_config(expected["config"])
                and (actual.get("RootFS", {}).get("Layers") or []) == expected.get("rootfs", {}).get("diff_ids", []))

    def load(self, path, manifest, proof):
        self.command(["image", "load", "--input", str(path)])
        bindings = read_json(self.binding_path()) if self.binding_path().exists() else {}
        for component in ["api", "web"]:
            image = manifest["images"][component]
            actual = strict_json(self.command(["image", "inspect", "--format", "{{json .}}", image["tag"]]))
            expected = proof[component]
            if not self._matches_content(actual, expected):
                expected_config = self._normalized_config(expected["config"])
                actual_config = self._normalized_config(actual.get("Config", {}))
                keys = sorted(key for key in set(expected_config) | set(actual_config)
                              if expected_config.get(key) != actual_config.get(key))
                raise ValueError("Loaded local image differs from validated content; config fields: " + ",".join(keys))
            previous = bindings.get(image["id"])
            if previous is not None and previous != actual["Id"]:
                raise ValueError("An existing immutable content binding changed")
            bindings[image["id"]] = actual["Id"]
        write_json(self.binding_path(), bindings)

    def ensure_images(self, manifest):
        for component in ["api", "web"]:
            wanted = self.image_id(manifest, component)
            actual = self.command(["image", "inspect", "--format", "{{.Id}}", wanted]).strip()
            if actual != wanted:
                raise ValueError("The exact expected image is not loaded")

    def remove_owned_image(self, identifier, commit):
        path = self.binding_path()
        bindings = read_json(path) if path.exists() else {}
        local = bindings.get(identifier)
        if local is None:
            return False
        return self._remove_local_image(local, commit)

    def remove_incomplete_upload(self, manifest, proof, retained):
        # Include dangling images: a later retry can move the original tag.
        candidates = self.command(["image", "ls", "--all", "--quiet", "--no-trunc",
                                   "--filter", "label=io.arden.release.managed=1",
                                   "--filter", "label=org.opencontainers.image.revision=" + manifest["commit"]]).split()
        for identifier in sorted(set(candidates)):
            if not IMAGE_ID.fullmatch(identifier):
                raise ValueError("Unexpected incomplete image identity")
            if identifier in retained:
                continue
            actual = strict_json(self.command(["image", "inspect", "--format", "{{json .}}", identifier]))
            if actual.get("Id") != identifier:
                raise ValueError("Incomplete image identity changed")
            if any(self._matches_content(actual, proof[kind]) for kind in ["api", "web"]):
                self._remove_local_image(identifier, manifest["commit"])

    def _remove_local_image(self, identifier, commit):
        template = '{"labels":{{json .Config.Labels}},"tags":{{json .RepoTags}}}'
        result = subprocess.run(["/usr/bin/docker", "image", "inspect", "--format", template, identifier],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            if "no such image" in result.stderr.lower():
                return True
            raise RuntimeError("Cannot verify app image retention")
        item = strict_json(result.stdout)
        labels = item.get("labels") or {}
        if labels.get("io.arden.release.managed") != "1" or labels.get("org.opencontainers.image.revision") != commit:
            return False
        allowed = {f"arden-release-{component}:sha-{commit}" for component in ["api", "web"]}
        if not set(item.get("tags") or []).issubset(allowed):
            return False
        containers = self.command(["ps", "--all", "--quiet"]).split()
        if containers:
            if any(not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in containers):
                raise ValueError("Unexpected Docker container identity")
            used = self.command(["inspect", "--format", "{{.Image}}", *containers]).splitlines()
            if identifier in used:
                return False
        removed = subprocess.run(["/usr/bin/docker", "image", "rm", "--no-prune", identifier],
                                 capture_output=True, text=True, timeout=60)
        return removed.returncode == 0

    def activate(self, manifest):
        path = "/services/" + self.config["service_uuid"]
        resource = self.request("GET", path)
        raw = resource.get("docker_compose_raw")
        if not isinstance(raw, str):
            raise ValueError("Cannot verify current app configuration")
        observed = strict_json(raw)
        normalized = copy.deepcopy(observed)
        for name in ["arden-api", "arden-web"]:
            if name not in normalized.get("services", {}):
                raise ValueError("Configured app component is missing")
            normalized["services"][name]["image"] = self.config["template"]["services"][name]["image"]
        if normalized != self.config["template"]:
            raise ValueError("App configuration changed outside the release protocol")
        self._wait_operation(allow_failed=True)
        self._check_protected()
        source = json.dumps(self.compose_for(manifest), sort_keys=True, separators=(",", ":")).encode()
        self.request("PATCH", path, {"docker_compose_raw": base64.b64encode(source).decode(),
                                     "instant_deploy": False})
        self.operation("start")
        self._wait_operation(allow_failed=False)

    def _public(self, path, expected_status=200):
        req = http.Request(self.config["origin"].rstrip("/") + path,
                           headers={"Cache-Control": "no-cache", "User-Agent": "Arden-release-check"})
        try:
            with http.build_opener(NoRedirect).open(req, timeout=10) as response:
                if response.status != expected_status:
                    raise RuntimeError("Unexpected public release response")
                return response.read(1024 * 1024)
        except http_error.HTTPError as error:
            if error.code == expected_status:
                return b""
            raise RuntimeError("Public release verification failed") from error

    def verify(self, manifest):
        deadline = time.monotonic() + self.config.get("rollout_timeout", 180)
        last_error = None
        while time.monotonic() < deadline:
            try:
                for component in ["api", "web"]:
                    name = f"arden-{component}-{self.config['service_uuid']}"
                    item = self._inspect(name)
                    if (item["image"] != self.image_id(manifest, component)
                            or not item["state"].get("Running")
                            or item["state"].get("Health", {}).get("Status") != "healthy"):
                        raise RuntimeError("App image or health does not match the release")
                self._check_protected()
                ready = strict_json(self._public("/api/health/ready"))
                if ready.get("status") != "ok":
                    raise RuntimeError("Public API is not ready")
                self._public("/api/v1/me", expected_status=401)
                baseline = self.config["baseline"]
                if manifest["images"] != baseline["images"]:
                    version = strict_json(self._public("/release.json?tree=" + manifest["tree"]))
                    if version.get("commit") != manifest["commit"] or version.get("tree") != manifest["tree"]:
                        raise RuntimeError("Public frontend version does not match")
                else:
                    if b"<!doctype html" not in self._public("/").lower():
                        raise RuntimeError("Baseline frontend is unavailable")
                return
            except (RuntimeError, ValueError, http_error.URLError, OSError) as error:
                last_error = error
                time.sleep(2)
        raise RuntimeError("Release did not verify before its deadline") from last_error
