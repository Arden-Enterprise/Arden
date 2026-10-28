"""Coolify app-only adapter; neither source nor secrets come from the SSH caller."""

import base64
import copy
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib import request as http, error as http_error
from urllib.parse import urlsplit

from protocol import strict_json, DIGEST, IMAGE_ID
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
    return config


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CoolifyManager:
    def __init__(self, config, request=None, command=None, operation=None):
        self.config = validate_config(config, config.get("environment"))
        self.request = request or self._request
        self.command = command or self._command
        self.operation = operation or self._operation
        self.protected = None

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
        if manifest["migrations"] != self.config["migrations"]:
            raise ValueError("Schema approval is required before this release")
        if shutil.disk_usage(self.config["state_dir"]).free < 256 * 1024 * 1024:
            raise ValueError("Insufficient release disk space")
        if self.config.get("coolify_image_id"):
            actual = self.command(["inspect", "--format", "{{.Image}}", "coolify"]).strip()
            if actual != self.config["coolify_image_id"]:
                raise ValueError("Review the Coolify adapter after its image changes")
        self._check_protected()

    def load(self, path, manifest, proof):
        self.command(["image", "load", "--input", str(path)])
        bindings = read_json(self.binding_path()) if self.binding_path().exists() else {}
        for component in ["api", "web"]:
            image = manifest["images"][component]
            actual = strict_json(self.command(["image", "inspect", "--format", "{{json .}}", image["tag"]]))
            expected = proof[component]
            def normalize(value):
                # Docker's container.Config API adds inert defaults omitted from OCI
                # image config JSON. Non-default values and all image settings remain strict.
                defaults = {"ArgsEscaped": False, "Hostname": "", "Domainname": "", "Image": "",
                            "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
                            "Tty": False, "OpenStdin": False, "StdinOnce": False,
                            "NetworkDisabled": False, "MacAddress": ""}
                return {key: data for key, data in value.items()
                        if data is not None and not (key in defaults and type(data) is type(defaults[key]) and data == defaults[key])}
            if (not IMAGE_ID.fullmatch(actual.get("Id", "")) or actual.get("Architecture") != "amd64"
                    or actual.get("Os") != "linux"
                    or normalize(actual.get("Config", {})) != normalize(expected["config"])
                    or (actual.get("RootFS", {}).get("Layers") or []) != expected.get("rootfs", {}).get("diff_ids", [])):
                expected_config, actual_config = normalize(expected["config"]), normalize(actual.get("Config", {}))
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
        identifier = local
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
