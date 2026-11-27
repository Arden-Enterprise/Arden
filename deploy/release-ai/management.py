"""Coolify AI-only adapter; neither source nor secrets come from the SSH caller."""

import base64
import copy
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib import error as http_error, request as http
from urllib.parse import urlsplit

from protocol import IMAGE_ID, strict_json
from state import read_json, write_json

CONTAINER_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\Z")

VERIFY_HTTP_SCRIPT = (
    "import urllib.error, urllib.request\n"
    "def check(method, path, expected):\n"
    "    data = b'{}' if method == 'POST' else None\n"
    "    headers = {'Content-Type': 'application/json'} if method == 'POST' else {}\n"
    "    req = urllib.request.Request('http://127.0.0.1:8080' + path, data=data, headers=headers, method=method)\n"
    "    try:\n"
    "        with urllib.request.urlopen(req, timeout=5) as res:\n"
    "            code = res.status\n"
    "    except urllib.error.HTTPError as err:\n"
    "        code = err.code\n"
    "    assert code == expected, f'{path}: {code} != {expected}'\n"
    "check('GET', '/health/live', 200)\n"
    "check('GET', '/health/ready', 200)\n"
    "check('POST', '/v3/generations', 401)\n"
    "check('POST', '/v2/maintenance-analyses', 401)\n"
    "print('AI_VERIFY_OK')\n"
)


def validate_config(config, environment):
    if type(config) is not dict or config.get("environment") != environment or environment not in {"staging", "production"}:
        raise ValueError("AI configuration belongs to a different environment")
    if not re.fullmatch(r"[a-z0-9]{8,64}", config.get("service_uuid", "")):
        raise ValueError("Invalid configured AI service identity")
    url = urlsplit(config.get("api_url", ""))
    if (url.scheme != "http" or url.hostname not in {"127.0.0.1", "::1"}
            or url.username or url.password or url.query or url.fragment
            or url.path != "/api/v1"):
        raise ValueError("Management API must be an explicit loopback endpoint")
    services = config.get("template", {}).get("services", {})
    if type(services) is not dict or set(services) != {"arden-ai"}:
        raise ValueError("Only the single arden-ai container may belong to an AI release Service")
    forbidden = {"build", "ports", "privileged", "devices", "pid", "ipc", "network_mode", "cap_add"}
    service = services["arden-ai"]
    if (type(service) is not dict or forbidden.intersection(service)
            or service.get("user") != "1000:1000"
            or service.get("read_only") is not True
            or service.get("cap_drop") != ["ALL"]
            or service.get("security_opt") != ["no-new-privileges:true"]
            or service.get("pull_policy") != "never"):
        raise ValueError("Unsafe arden-ai runtime configuration")
    for volume in config.get("template", {}).get("volumes", {}).values():
        if type(volume) is not dict or volume.get("external") is not True or not volume.get("name"):
            raise ValueError("Any configured volume must be explicit and external")
    protected = config.get("protected_containers")
    if (type(protected) is not list or not protected
            or any(type(name) is not str or not CONTAINER_NAME.fullmatch(name) for name in protected)):
        raise ValueError("Protected infrastructure container list is invalid")
    self_container = f"arden-ai-{config['service_uuid']}"
    if self_container in protected:
        raise ValueError("arden-ai cannot be listed in protected_containers")
    docker_timeout = config.get("docker_timeout", 360)
    if type(docker_timeout) is not int or not 60 <= docker_timeout <= 900:
        raise ValueError("Invalid docker_timeout")
    return config


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CoolifyAiManager:
    def __init__(self, config, request=None, command=None, operation=None):
        self.config = validate_config(config, config.get("environment"))
        self.request = request or self._request
        self.command = command or self._command
        self.operation = operation or self._operation
        self.protected = None

    def _operation(self, op):
        message = {
            "op": op,
            "service_uuid": self.config["service_uuid"],
            "token": Path(self.config["token_path"]).read_text().strip(),
        }
        result = subprocess.run(
            ["/usr/bin/docker", "exec", "--user", "0", "-i", "coolify", "php",
             "/var/lib/arden-release-ai-bridge/operation.php"],
            input=json.dumps(message),
            capture_output=True,
            text=True,
            timeout=60 if op == "start" else 20,
        )
        value = strict_json(result.stdout)
        if result.returncode != 0 or value.get("status") == "unavailable":
            raise RuntimeError("Coolify AI deployment activity is unavailable")
        return value

    def _wait_operation(self, allow_failed):
        deadline = time.monotonic() + 300
        while True:
            result = self.operation("status")
            status = result.get("status")
            if status == "finished" or (allow_failed and status in {"none", "error", "killed", "cancelled"}):
                return
            if status not in {"queued", "in_progress"} or time.monotonic() >= deadline:
                raise RuntimeError("Coolify AI operation is failed or uncertain; no duplicate dispatch")
            time.sleep(2)

    def _request(self, method, path, body=None):
        if self.config.get("api_namespace") is True:
            pid = self.command(["inspect", "--format", "{{.State.Pid}}", "coolify"]).strip()
            if not re.fullmatch(r"[1-9][0-9]{0,9}", pid):
                raise ValueError("Coolify network namespace is unavailable")
            message = {"base": self.config["api_url"], "method": method, "path": path, "body": body}
            result = subprocess.run(
                ["/usr/bin/nsenter", "--target", pid, "--net", "/usr/bin/python3", "-I",
                 str(Path(__file__).with_name("local_http.py"))],
                input=json.dumps(message),
                capture_output=True,
                text=True,
                timeout=40,
            )
            reply = strict_json(result.stdout)
            if result.returncode != 0 or reply.get("ok") is not True:
                raise RuntimeError("Local Coolify AI management request failed")
            return reply["result"]
        token = Path(self.config["token_path"]).read_text().strip()
        data = None if body is None else json.dumps(body).encode()
        req = http.Request(
            self.config["api_url"] + path,
            data=data,
            method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        )
        try:
            with http.build_opener(NoRedirect).open(req, timeout=30) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise ValueError("Management response exceeds limit")
                return strict_json(raw)
        except (http_error.URLError, OSError) as error:
            raise RuntimeError("Coolify AI management request failed") from error

    def _command(self, arguments):
        timeout = self.config.get("docker_timeout", 360)
        result = subprocess.run(
            ["/usr/bin/docker", *arguments],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if result.returncode:
            raise RuntimeError("AI release Docker operation failed")
        return result.stdout

    def baseline(self):
        return copy.deepcopy(self.config["baseline"])

    def compose_for(self, manifest):
        result = copy.deepcopy(self.config["template"])
        result["services"]["arden-ai"]["image"] = self.image_id(manifest)
        return result

    def binding_path(self):
        return Path(self.config["state_dir"]).parent / "image-bindings.json"

    def image_id(self, manifest):
        image = manifest["images"]["ai"]
        if image == self.config["baseline"]["images"]["ai"]:
            return image["id"]
        path = self.binding_path()
        bindings = read_json(path) if path.exists() else {}
        value = bindings.get(image["id"])
        if not isinstance(value, str) or not IMAGE_ID.fullmatch(value):
            raise ValueError("Portable AI image content has no verified local binding")
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
            raise RuntimeError("Protected infrastructure was recreated during AI deployment")

    def preflight(self, _manifest):
        if shutil.disk_usage(self.config["state_dir"]).free < 512 * 1024 * 1024:
            raise ValueError("Insufficient AI release disk space")
        if self.config.get("coolify_image_id"):
            actual = self.command(["inspect", "--format", "{{.Image}}", "coolify"]).strip()
            if actual != self.config["coolify_image_id"]:
                raise ValueError("Review the Coolify AI bridge after its image changes")
        self._check_protected()

    @staticmethod
    def _normalized_config(value):
        defaults = {
            "ArgsEscaped": False, "Hostname": "", "Domainname": "", "Image": "",
            "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
            "Tty": False, "OpenStdin": False, "StdinOnce": False,
            "NetworkDisabled": False, "MacAddress": "",
        }
        return {
            key: data
            for key, data in value.items()
            if data is not None and not (key in defaults and type(data) is type(defaults[key]) and data == defaults[key])
        }

    @classmethod
    def _matches_content(cls, actual, expected):
        return (bool(IMAGE_ID.fullmatch(actual.get("Id", "")))
                and actual.get("Architecture") == "amd64"
                and actual.get("Os") == "linux"
                and cls._normalized_config(actual.get("Config", {})) == cls._normalized_config(expected["config"])
                and (actual.get("RootFS", {}).get("Layers") or []) == expected.get("rootfs", {}).get("diff_ids", []))

    def load(self, path, manifest, proof):
        self.command(["image", "load", "--input", str(path)])
        bindings = read_json(self.binding_path()) if self.binding_path().exists() else {}
        image = manifest["images"]["ai"]
        actual = strict_json(self.command(["image", "inspect", "--format", "{{json .}}", image["tag"]]))
        expected = proof["ai"]
        if not self._matches_content(actual, expected):
            expected_config = self._normalized_config(expected["config"])
            actual_config = self._normalized_config(actual.get("Config", {}))
            keys = sorted(key for key in set(expected_config) | set(actual_config)
                          if expected_config.get(key) != actual_config.get(key))
            raise ValueError("Loaded local AI image differs from validated content; config fields: " + ",".join(keys))
        previous = bindings.get(image["id"])
        if previous is not None and previous != actual["Id"]:
            raise ValueError("An existing immutable AI image binding changed")
        bindings[image["id"]] = actual["Id"]
        write_json(self.binding_path(), bindings)

    def ensure_images(self, manifest):
        wanted = self.image_id(manifest)
        actual = self.command(["image", "inspect", "--format", "{{.Id}}", wanted]).strip()
        if actual != wanted:
            raise ValueError("The exact expected AI image is not loaded")

    def remove_owned_image(self, identifier, commit):
        path = self.binding_path()
        bindings = read_json(path) if path.exists() else {}
        local = bindings.get(identifier)
        if local is None:
            return False
        return self._remove_local_image(local, commit)

    def remove_incomplete_upload(self, manifest, proof, retained):
        candidates = self.command([
            "image", "ls", "--all", "--quiet", "--no-trunc",
            "--filter", "label=io.arden.release.ai_managed=1",
            "--filter", "label=org.opencontainers.image.revision=" + manifest["commit"],
        ]).split()
        for identifier in sorted(set(candidates)):
            if not IMAGE_ID.fullmatch(identifier):
                raise ValueError("Unexpected incomplete AI image identity")
            if identifier in retained:
                continue
            actual = strict_json(self.command(["image", "inspect", "--format", "{{json .}}", identifier]))
            if actual.get("Id") != identifier:
                raise ValueError("Incomplete AI image identity changed")
            if self._matches_content(actual, proof["ai"]):
                self._remove_local_image(identifier, manifest["commit"])

    def _remove_local_image(self, identifier, commit):
        template = '{"labels":{{json .Config.Labels}},"tags":{{json .RepoTags}}}'
        result = subprocess.run(
            ["/usr/bin/docker", "image", "inspect", "--format", template, identifier],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            if "no such image" in result.stderr.lower():
                return True
            raise RuntimeError("Cannot verify AI image retention")
        item = strict_json(result.stdout)
        labels = item.get("labels") or {}
        if (labels.get("io.arden.release.ai_managed") != "1"
                or "io.arden.release.managed" in labels
                or labels.get("org.opencontainers.image.revision") != commit):
            return False
        allowed = {f"arden-release-ai:sha-{commit}"}
        if not set(item.get("tags") or []).issubset(allowed):
            return False
        containers = self.command(["ps", "--all", "--quiet"]).split()
        if containers:
            if any(not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in containers):
                raise ValueError("Unexpected Docker container identity")
            used = self.command(["inspect", "--format", "{{.Image}}", *containers]).splitlines()
            if identifier in used:
                return False
        removed = subprocess.run(
            ["/usr/bin/docker", "image", "rm", "--no-prune", identifier],
            capture_output=True, text=True, timeout=60,
        )
        return removed.returncode == 0

    def activate(self, manifest):
        path = "/services/" + self.config["service_uuid"]
        resource = self.request("GET", path)
        raw = resource.get("docker_compose_raw")
        if not isinstance(raw, str):
            raise ValueError("Cannot verify current AI configuration")
        observed = strict_json(raw)
        normalized = copy.deepcopy(observed)
        if "arden-ai" not in normalized.get("services", {}):
            raise ValueError("Configured arden-ai service is missing")
        normalized["services"]["arden-ai"]["image"] = self.config["template"]["services"]["arden-ai"]["image"]
        if normalized != self.config["template"]:
            raise ValueError("AI configuration changed outside the release protocol")
        self._wait_operation(allow_failed=True)
        self._check_protected()
        source = json.dumps(self.compose_for(manifest), sort_keys=True, separators=(",", ":")).encode()
        self.request("PATCH", path, {
            "docker_compose_raw": base64.b64encode(source).decode(),
            "instant_deploy": False,
        })
        self.operation("start")
        self._wait_operation(allow_failed=False)

    def verify(self, manifest):
        deadline = time.monotonic() + self.config.get("rollout_timeout", 180)
        name = f"arden-ai-{self.config['service_uuid']}"
        last_error = None
        while time.monotonic() < deadline:
            try:
                item = self._inspect(name)
                if (item["image"] != self.image_id(manifest)
                        or not item["state"].get("Running")
                        or item["state"].get("Health", {}).get("Status") != "healthy"):
                    raise RuntimeError("AI container image or health does not match the release")
                self._check_protected()
                probe = self.command([
                    "exec", "--user", "1000:1000", name,
                    "/app/.venv/bin/python", "-c", VERIFY_HTTP_SCRIPT,
                ])
                if "AI_VERIFY_OK" not in probe:
                    raise RuntimeError("AI HTTP health and 401 auth probe failed")
                return
            except (RuntimeError, ValueError, OSError) as error:
                last_error = error
                time.sleep(2)
        raise RuntimeError("AI release did not verify before its deadline") from last_error
