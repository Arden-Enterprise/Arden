#!/usr/bin/env python3
"""Root-only, journaled bootstrap. This program is not a CI capability."""

import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit, unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap import build_app_template, deployment_key_line, verify_migration_inventory
from entrypoint import secure_file, secure_directory
from management import CoolifyManager
from receiver import ReleaseEngine
from state import read_json, write_json, release_lock

CONFIG = Path("/etc/arden/releases")
STATE = Path("/var/lib/arden/releases")
BRIDGE = "/var/lib/arden-release-bridge"


def run(arguments, data=None, timeout=90):
    result = subprocess.run(arguments, input=data, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Operator command failed; private before-state is retained")
    return result.stdout


def docker(*arguments, data=None, timeout=90):
    return run(["/usr/bin/docker", *arguments], data, timeout)


def inspect(name):
    return json.loads(docker("inspect", name))[0]


def profile():
    secure_file(CONFIG / "operator.json")
    value = read_json(CONFIG / "operator.json")
    if not re.fullmatch(r"[a-f0-9]{32}", value.get("nonce", "")):
        raise ValueError("Invalid operator nonce")
    if set(value.get("sources", {})) != {"staging", "production"}:
        raise ValueError("Both approved source environments are required")
    for environment in ["staging", "production"]:
        if not re.fullmatch(r"[a-z0-9]{8,64}", value["sources"][environment]):
            raise ValueError("Invalid source resource")
        origin = urlsplit(value["origins"][environment])
        if origin.scheme != "https" or not origin.hostname or origin.username or origin.password:
            raise ValueError("Invalid public origin")
    if not re.fullmatch(r"[a-f0-9]{40}", value.get("baseline_commit", "")):
        raise ValueError("Record the approved manual snapshot source first")
    if not re.fullmatch(r"[a-f0-9]{40}", value.get("baseline_tree", "")):
        raise ValueError("Record the approved manual snapshot tree first")
    return value


def install_bridge():
    docker("exec", "--user", "0", "coolify", "mkdir", "-p", BRIDGE)
    docker("exec", "--user", "0", "coolify", "chmod", "0700", BRIDGE)
    for name in ["enable-local-api.php", "coolify-operation.php"]:
        target = "operation.php" if name == "coolify-operation.php" else name
        docker("cp", str(Path(__file__).with_name(name)), f"coolify:{BRIDGE}/{target}")
        docker("exec", "--user", "0", "coolify", "chown", "0:0", f"{BRIDGE}/{target}")
        docker("exec", "--user", "0", "coolify", "chmod", "0600", f"{BRIDGE}/{target}")


def enable_management(settings):
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    install_bridge()
    receipt = CONFIG / "bootstrap.json"
    if receipt.exists():
        secure_file(CONFIG / "management.token")
        return read_json(receipt)
    container_result = f"/tmp/arden-release-{settings['nonce']}.json"
    exists = subprocess.run(["/usr/bin/docker", "exec", "--user", "0", "coolify", "test", "-f", container_result],
                            capture_output=True).returncode == 0
    if not exists:
        docker("exec", "--user", "0", "-i", "coolify", "php", f"{BRIDGE}/enable-local-api.php",
               data=json.dumps({"sources": settings["sources"], "nonce": settings["nonce"]}))
    result = json.loads(docker("exec", "--user", "0", "coolify", "cat", container_result))
    token = result.pop("token")
    temporary = CONFIG / "management.token.tmp"
    with temporary.open("x", encoding="utf-8") as output:
        os.chmod(temporary, 0o600)
        output.write(token + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, CONFIG / "management.token")
    # A protected result can survive a failed database commit. Prove the token is live locally
    # before writing the completed bootstrap receipt or deleting its recovery material.
    pid = docker("inspect", "--format", "{{.State.Pid}}", "coolify").strip()
    if not re.fullmatch(r"[1-9][0-9]{0,9}", pid):
        raise ValueError("Local management namespace is unavailable")
    probe = json.loads(run(["/usr/bin/nsenter", "--target", pid, "--net", "/usr/bin/python3", "-I",
                            str(Path(__file__).with_name("local_http.py"))],
                           json.dumps({"base": "http://127.0.0.1:8080/api/v1", "method": "GET",
                                       "path": "/services/" + settings["sources"]["staging"]})))
    if probe.get("ok") is not True:
        raise ValueError("Reconcile the protected API bootstrap before retrying")
    write_json(receipt, result)
    docker("exec", "--user", "0", "coolify", "rm", "--", container_result)
    return result


def migration_fingerprint(container, database_container, database_url):
    code = """const fs=require('node:fs'),c=require('node:crypto');
const root='/app/migrations';const files=fs.readdirSync(root).filter(x=>/^\\d{4}_[a-z0-9_]+\\.sql$/.test(x)).sort();
if(!files.length)process.exit(1);
const rows=files.map(name=>({name,sha256:c.createHash('sha256').update(fs.readFileSync(root+'/'+name)).digest('hex')}));
process.stdout.write(JSON.stringify(rows));"""
    rows = json.loads(docker("exec", "--user", "1000:1000", container, "node", "-e", code))
    database = unquote(urlsplit(database_url).path.lstrip("/"))
    if not re.fullmatch(r"[a-zA-Z0-9_]{1,63}", database):
        raise ValueError("Review the selected database name before reading its migration ledger")
    shell = ('exec psql --username="$POSTGRES_USER" --dbname="$1" --no-psqlrc '
             '--set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align --command="$2"')
    applied = docker("exec", "--env", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000",
                     database_container, "sh", "-c", shell, "_", database,
                     "SELECT migration_id FROM public.arden_schema_migrations ORDER BY migration_id").splitlines()
    return verify_migration_inventory(rows, applied)


def database_peer(api, values):
    hostname = urlsplit(values["DATABASE_URL"]).hostname
    matches = set()
    for network in api["NetworkSettings"]["Networks"]:
        item = json.loads(docker("network", "inspect", network))[0]
        for identifier in item.get("Containers", {}):
            template = '{"name":{{json .Name}},"networks":{{json .NetworkSettings.Networks}}}'
            peer = json.loads(docker("inspect", "--format", template, identifier))
            aliases = {peer["name"].lstrip("/")}
            for endpoint in peer["networks"].values():
                aliases.update(endpoint.get("Aliases") or [])
            if hostname in aliases:
                matches.add(peer["name"].lstrip("/"))
    if len(matches) != 1:
        raise ValueError("Database network identity is ambiguous; no cutover performed")
    return next(iter(matches))


def prepare(environment, settings, management):
    directory = STATE / "bootstrap"
    directory.mkdir(mode=0o700, exist_ok=True)
    journal_path = directory / f"{environment}.json"
    if journal_path.exists():
        result = read_json(journal_path)
        if result["phase"] == "creating":
            raise RuntimeError("Reconcile the uncertain Coolify create before retrying")
        if result["phase"] == "created":
            return finish_prepare(result, journal_path)
        return result
    source = settings["sources"][environment]
    names = docker("ps", "--filter", "label=com.docker.compose.project=" + source,
                   "--format", "{{.Names}}").splitlines()
    old_api, old_web = f"arden-{environment}-api-{source}", f"arden-{environment}-web-{source}"
    if old_api not in names or old_web not in names:
        raise ValueError("Both original app containers must be running before capture")
    api, web = inspect(old_api), inspect(old_web)
    prepared = build_app_template(environment, source, api, web)
    values, final = prepared["values"], prepared["compose"]
    if values.get("ARDEN_PUBLIC_WEB_ORIGIN", "").rstrip("/") != settings["origins"][environment].rstrip("/"):
        raise ValueError("Runtime origin does not match the approved target")
    database = database_peer(api, values)
    protected = sorted(set([name for name in names if name not in {old_api, old_web}] + [database]))
    protected_ids = {name: inspect(name)["Id"] for name in protected}
    migrations = migration_fingerprint(old_api, database, values["DATABASE_URL"])
    baseline = {"commit": settings["baseline_commit"], "tree": settings["baseline_tree"],
                "migrations": migrations, "images": {"api": {"id": api["Image"]}, "web": {"id": web["Image"]}}}
    candidate = copy.deepcopy(final)
    for name, network in candidate["services"]["arden-web"]["networks"].items():
        if name != "default":
            network["aliases"] = []
    config = {"environment": environment, "service_uuid": source,
              "api_url": "http://127.0.0.1:8080/api/v1", "api_namespace": True,
              "token_path": str(CONFIG / "management.token"), "origin": settings["origins"][environment],
              "state_dir": str(STATE / environment), "staging_dir": str(STATE / "staging"),
              "migrations": migrations, "baseline": baseline, "protected_containers": protected,
              "coolify_image_id": inspect("coolify")["Image"], "template": candidate}
    Path(config["state_dir"]).mkdir(mode=0o700, exist_ok=True)
    adapter = CoolifyManager(config)
    old_resource = adapter.request("GET", "/services/" + source)
    result = {"phase": "creating", "original_api": api, "original_web": web,
              "original_resource": old_resource, "protected_ids": protected_ids,
              "config": config, "final_template": final, "values": values, "disconnected_edges": []}
    write_json(journal_path, result)
    identity = management["sources"][environment]
    payload = {key: identity[key] for key in ["project_uuid", "environment_uuid", "server_uuid", "destination_uuid"]}
    payload.update(name=f"arden-{environment}-application-{settings['nonce'][:8]}",
                   description="App-only release target; runtime data and Auth remain independent.",
                   docker_compose_raw=base64.b64encode(json.dumps(candidate).encode()).decode(),
                   connect_to_docker_network=False, instant_deploy=False, redact_all_env_values_in_logs=True)
    created = adapter.request("POST", "/services", payload)
    uuid = created.get("uuid")
    if not isinstance(uuid, str) or not re.fullmatch(r"[a-z0-9]{8,64}", uuid):
        raise RuntimeError("Reconcile the created resource before retrying")
    result["config"]["service_uuid"] = uuid
    result["phase"] = "created"
    write_json(journal_path, result)
    return finish_prepare(result, journal_path)


def finish_prepare(result, journal_path):
    uuid = result["config"]["service_uuid"]
    adapter = CoolifyManager(result["config"])
    adapter.request("PATCH", f"/services/{uuid}/envs/bulk", {"data": [
        {"key": key, "value": value, "is_literal": True, "is_multiline": "\n" in value,
         "is_shown_once": True} for key, value in result["values"].items()]})
    result["phase"] = "prepared"
    write_json(journal_path, result)
    return result


def candidate_check(record):
    adapter = CoolifyManager(record["config"])
    adapter.preflight(record["config"]["baseline"])
    adapter.activate(record["config"]["baseline"])
    adapter.verify(record["config"]["baseline"])
    api = inspect("arden-api-" + record["config"]["service_uuid"])
    actual_values = dict(item.split("=", 1) for item in api["Config"]["Env"])
    if any(actual_values.get(key) != value for key, value in record["values"].items()):
        raise ValueError("Candidate runtime configuration differs from the captured original")
    old = next(item["Name"] for item in record["original_api"]["Mounts"]
               if item["Destination"] == "/var/lib/arden/private")
    current = [item for item in api["Mounts"] if item["Destination"] == "/var/lib/arden/private"]
    if len(current) != 1 or current[0].get("Name") != old:
        raise ValueError("Candidate private-volume identity differs")
    return adapter


def verify_original(record, adapter):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            for original in [record["original_api"], record["original_web"]]:
                actual = inspect(original["Name"])
                if (actual["Id"] != original["Id"] or actual["Image"] != original["Image"]
                        or not actual["State"].get("Running")
                        or actual["State"].get("Health", {}).get("Status") != "healthy"):
                    raise RuntimeError("Original app has not recovered")
            adapter._check_protected()
            if json.loads(adapter._public("/api/health/ready")).get("status") != "ok":
                raise RuntimeError("Original API is unavailable")
            adapter._public("/api/v1/me", expected_status=401)
            if b"<!doctype html" not in adapter._public("/").lower():
                raise RuntimeError("Original public web is unavailable")
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError("Original app recovery did not verify; operator reconciliation is required")


def cutover(environment, record):
    journal_path = STATE / "bootstrap" / f"{environment}.json"
    if record["phase"] == "cutover_verified":
        config = read_json(CONFIG / f"{environment}.json")
        engine = ReleaseEngine(environment, config["state_dir"], CoolifyManager(config), config["staging_dir"])
        # The operator already owns the host lock; status() would acquire it again.
        engine.manager.verify(engine._state()["active"]["manifest"])
        retire_original(environment, record)
        return
    if record["phase"] not in {"prepared", "candidate_verified"}:
        raise ValueError("Reconcile the partial bootstrap phase before cutover")
    candidate_check(record)
    for name, identifier in record["protected_ids"].items():
        if inspect(name)["Id"] != identifier:
            raise ValueError("Infrastructure changed after capture; review before cutover")
    record["phase"] = "cutover_started"
    write_json(journal_path, record)
    old_api, old_web = record["original_api"]["Name"].lstrip("/"), record["original_web"]["Name"].lstrip("/")
    for item in [record["original_api"], record["original_web"]]:
        if inspect(item["Name"])["Id"] != item["Id"]:
            raise ValueError("Original app changed after capture")
    source = record["original_api"]["Config"]["Labels"]["com.docker.compose.project"]
    adapter = CoolifyManager(record["config"])
    try:
        docker("stop", "--time", "30", old_web, old_api)
        for network in record["original_web"]["NetworkSettings"]["Networks"]:
            if network != source:
                docker("network", "disconnect", network, old_web)
                record["disconnected_edges"].append(network)
                write_json(journal_path, record)
        final = copy.deepcopy(record["config"])
        final["template"] = record["final_template"]
        adapter.request("PATCH", "/services/" + final["service_uuid"], {
            "docker_compose_raw": base64.b64encode(json.dumps(final["template"]).encode()).decode(), "instant_deploy": False})
        adapter = CoolifyManager(final)
        adapter.activate(final["baseline"])
        adapter.verify(final["baseline"])
        for name, identifier in record["protected_ids"].items():
            if inspect(name)["Id"] != identifier:
                raise RuntimeError("Infrastructure was recreated during app cutover")
        write_json(CONFIG / f"{environment}.json", final)
        ReleaseEngine(environment, final["state_dir"], adapter, final["staging_dir"])._state()
        record["config"] = final
        record["phase"] = "cutover_verified"
        write_json(journal_path, record)
    except Exception:
        # Do not claim recovery if an uncertain queued operation can still change routing.
        adapter._wait_operation(allow_failed=True)
        for kind in ["web", "api"]:
            name = f"arden-{kind}-{record['config']['service_uuid']}"
            docker("stop", "--time", "30", name)
        for network in record["disconnected_edges"]:
            details = record["original_web"]["NetworkSettings"]["Networks"][network]
            arguments = ["network", "connect"]
            for alias in details.get("Aliases") or []:
                arguments += ["--alias", alias]
            docker(*arguments, network, old_web)
        docker("start", old_api, old_web)
        record["phase"] = "recovery_started"
        write_json(journal_path, record)
        verify_original(record, adapter)
        record["phase"] = "recovered"
        write_json(journal_path, record)
        raise RuntimeError("Cutover failed; original app recovery verified; reconcile before another cutover")
    retire_original(environment, record)


def rollback(environment):
    """Root operator only; caller holds the same shared host lock as normal releases."""
    config = read_json(CONFIG / f"{environment}.json")
    engine = ReleaseEngine(environment, config["state_dir"], CoolifyManager(config), config["staging_dir"])
    state = engine._state()
    if state.get("pending"):
        engine._recover(state)
        return
    previous = state.get("previous")
    if not previous:
        raise ValueError("No previous verified app pair exists")
    engine.manager.preflight(previous["manifest"])
    engine.manager.ensure_images(previous["manifest"])
    before = copy.deepcopy(state["active"])
    # An operator-retired release is no longer evidence for automatic main promotion.
    # A deliberate staging verification/deployment may establish fresh evidence later.
    before["eligible_for_promotion"] = False
    state["pending"] = {"before": before, "target": previous["manifest"], "operator": "rollback"}
    write_json(engine.path, state)
    try:
        engine.manager.activate(previous["manifest"])
        engine.manager.verify(previous["manifest"])
    except Exception:
        engine._recover(state)
        raise RuntimeError("Operator rollback failed; prior active release recovered")
    state["active"] = previous
    state["previous"] = before
    state["pending"] = None
    state["operator_action"] = {"action": "rollback", "verified_at": time.time()}
    write_json(engine.path, state)


def retire_original(environment, record):
    """Prevent an infrastructure redeploy from starting the old app pair a second time."""
    if record.get("original_retired"):
        return
    adapter = CoolifyManager(record["config"])
    original = record["original_resource"]
    path = "/services/" + original["uuid"]
    current = adapter.request("GET", path)
    raw = original["docker_compose_raw"]
    try:
        source = json.loads(raw)
    except json.JSONDecodeError:
        code = ("require '/var/www/html/vendor/autoload.php'; "
                "echo json_encode(Symfony\\Component\\Yaml\\Yaml::parse(stream_get_contents(STDIN)), JSON_THROW_ON_ERROR);")
        source = json.loads(docker("exec", "--user", "0", "-i", "coolify", "php", "-r", code, data=raw))
    for component in ["api", "web"]:
        if not source.get("services", {}).pop(f"arden-{environment}-{component}", None):
            raise ValueError("Original resource no longer contains the captured app pair")
    encoded = json.dumps(source, sort_keys=True, separators=(",", ":"))
    if current["docker_compose_raw"] != raw and current["docker_compose_raw"] != encoded:
        raise ValueError("Original infrastructure changed; reconcile retirement before updating it")
    if current["docker_compose_raw"] == raw:
        adapter.request("PATCH", path, {"docker_compose_raw": base64.b64encode(encoded.encode()).decode(),
                                       "instant_deploy": False})
    record["original_retired"] = True
    write_json(STATE / "bootstrap" / f"{environment}.json", record)


def install_account(environment, settings):
    config_path = CONFIG / f"{environment}.json"
    secure_file(config_path)
    line = deployment_key_line(environment, settings["public_keys"][environment])
    username = f"arden-ci-{environment}"
    home = Path("/var/lib/arden-ci") / environment
    for directory in [home.parent, home, home / ".ssh"]:
        if directory.exists() or directory.is_symlink():
            secure_directory(directory)
        else:
            secure_directory(directory.parent)
            directory.mkdir(mode=0o755)
    try:
        account = pwd.getpwnam(username)
        if account.pw_gecos != "Arden release capability" or account.pw_dir != str(home) or account.pw_uid < 1000:
            raise ValueError("Preserve the existing unrelated account")
    except KeyError:
        run(["/usr/sbin/useradd", "--user-group", "--no-create-home", "--home-dir", str(home),
             "--shell", "/bin/sh", "--comment", "Arden release capability", username])
    ssh = home / ".ssh"
    authorized = ssh / "authorized_keys"
    if authorized.is_symlink():
        raise ValueError("Preserve the unexpected authorized-keys link")
    if authorized.exists() and authorized.read_text() != line:
        raise ValueError("Preserve the existing deployment key; rotate explicitly")
    authorized.write_text(line)
    os.chown(authorized, 0, 0)
    os.chmod(authorized, 0o644)
    sudoers = Path("/etc/sudoers.d") / f"91-{username}"
    if sudoers.is_symlink():
        raise ValueError("Preserve the unexpected sudo-policy link")
    content = f"{username} ALL=(root) NOPASSWD: /usr/local/libexec/arden-release {environment}\n"
    if sudoers.exists() and sudoers.read_text() != content:
        raise ValueError("Preserve the existing sudo policy")
    temporary = CONFIG / f"{environment}.sudoers"
    temporary.write_text(content)
    os.chmod(temporary, 0o440)
    run(["/usr/sbin/visudo", "-cf", str(temporary)])
    shutil.copyfile(temporary, sudoers)
    os.chown(sudoers, 0, 0)
    os.chmod(sudoers, 0o440)
    run(["/usr/sbin/visudo", "-c"])


def main():
    if os.geteuid() != 0 or Path(__file__).resolve().parent != Path("/opt/arden-release"):
        raise ValueError("Install and review the root-owned operator package first")
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["enable-management", "prepare", "cutover", "install-account", "rollback"])
    parser.add_argument("environment", choices=["staging", "production"], nargs="?")
    arguments = parser.parse_args()
    settings = profile()
    secure_directory(CONFIG, private=True)
    secure_directory(STATE, private=True)
    with release_lock(STATE):
        management = enable_management(settings)
        if arguments.phase != "enable-management":
            if not arguments.environment:
                raise ValueError("Select the exact environment")
            if arguments.phase == "rollback":
                secure_file(CONFIG / f"{arguments.environment}.json")
                rollback(arguments.environment)
                print(json.dumps({"ok": True, "phase": "rollback", "environment": arguments.environment}))
                return
            record = prepare(arguments.environment, settings, management)
            if arguments.phase == "cutover":
                if arguments.environment == "production":
                    stage = read_json(STATE / "staging" / "state.json")
                    if not stage.get("active", {}).get("eligible_for_promotion"):
                        raise ValueError("Verify a GitHub-built staging release before production")
                cutover(arguments.environment, record)
            elif arguments.phase == "install-account":
                install_account(arguments.environment, settings)
    print(json.dumps({"ok": True, "phase": arguments.phase, "environment": arguments.environment}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"ok":false,"error":"operator_action_failed; inspect protected journal before retrying"}')
        sys.exit(1)
