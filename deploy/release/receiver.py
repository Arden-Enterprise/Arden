#!/usr/bin/env python3
"""Release state machine. Privileged effects live behind the management adapter."""

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
import time

from protocol import (validate_archive, validate_manifest, validate_stored_manifest,
                      validate_request, run_identity, MAX_EXPANDED)
from retention import collect_releases
from state import read_json, write_json, release_lock
from identity import trusted_provenance


class MigrationBlocked(ValueError):
    """Safe migration status for the workflow; never carries database output."""

    def __init__(self, status, migration_ids=None):
        allowed = {"NO_PENDING", "READY", "REQUIRES_OPERATOR", "DRIFT", "BACKUP_NOT_READY",
                   "BASELINE_REQUIRED", "OUTCOME_UNKNOWN", "STALE_RUN", "RECOVERY_REQUIRED"}
        ids = migration_ids if type(migration_ids) is list else []
        invalid_ids = (len(ids) > 1000 or any(type(item) is not str
                       or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", item) for item in ids))
        if (type(status) is not str or status not in allowed or invalid_ids
                or (not invalid_ids and len(ids) != len(set(ids)))):
            status, ids = "OUTCOME_UNKNOWN", []
        self.status = status
        self.migration_ids = ids
        super().__init__("Migration plan is blocked: " + status)


class ReleaseEngine:
    def __init__(self, environment, state_dir, manager, staging_dir=None):
        if environment not in {"staging", "production"}:
            raise ValueError("Unknown deployment environment")
        self.environment = environment
        self.root = Path(state_dir)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / "state.json"
        self.manager = manager
        self.staging_dir = Path(staging_dir) if staging_dir else None

    def _state(self):
        if self.path.exists():
            return self._validate_state(read_json(self.path))
        baseline = self.manager.baseline()
        validate_stored_manifest(baseline)
        value = {"active": {"manifest": baseline, "deployment_commit": baseline["commit"],
                            "eligible_for_promotion": False},
                 "previous": None, "pending": None, "highest": [0, 0]}
        write_json(self.path, value)
        return value

    @staticmethod
    def _validate_state(value):
        if (type(value) is not dict or not {"active", "previous", "pending", "highest"}.issubset(value)
                or set(value) - {"active", "previous", "pending", "highest", "last_failure",
                                 "operator_action"}):
            raise ValueError("Stored release state is malformed")
        if "operator_action" in value:
            action = value["operator_action"]
            verified_at = action.get("verified_at") if type(action) is dict else None
            if (type(action) is not dict or set(action) != {"action", "verified_at"}
                    or action["action"] != "rollback" or type(verified_at) not in {int, float}
                    or not math.isfinite(verified_at) or verified_at <= 0):
                raise ValueError("Stored operator action receipt is malformed")
        if type(value["active"]) is not dict:
            raise ValueError("Stored release state is malformed")
        releases = [value["active"], value["previous"]]
        pending = value["pending"]
        if pending is not None:
            if (type(pending) is not dict or not {"before", "target"}.issubset(pending)
                    or type(pending["before"]) is not dict or type(pending["target"]) is not dict):
                raise ValueError("Stored release state is malformed")
            releases.extend([pending["before"], {"manifest": pending["target"]}])
        for release in releases:
            if release is not None:
                if type(release) is not dict or "manifest" not in release:
                    raise ValueError("Stored release state is malformed")
                validate_stored_manifest(release["manifest"])
        if (type(value["highest"]) is not list or len(value["highest"]) != 2
                or any(type(item) is not int or item < 0 for item in value["highest"])):
            raise ValueError("Stored release sequence is malformed")
        return value

    def status(self):
        with release_lock(self.root.parent):
            return copy.deepcopy(self._state())

    def plan_migrations(self, request, provenance=None):
        validate_request(request, self.environment)
        if request["op"] != "plan-migrations" or not trusted_provenance(provenance, request):
            raise ValueError("Migration plan requires an exact authenticated request")
        with release_lock(self.root.parent):
            state = self._validate_state(read_json(self.path)) if self.path.exists() else None
            if state and state.get("pending"):
                status = "RECOVERY_REQUIRED" if state["pending"].get("phase") == "migrating" else "OUTCOME_UNKNOWN"
                return {"status": status, "migration_ids": []}
            highest = tuple(state.get("highest", [0, 0])) if state else (0, 0)
            if run_identity(request["run_id"], request["attempt"]) < highest:
                return {"status": "STALE_RUN", "migration_ids": []}
            candidate = request
            if self.environment == "production":
                try:
                    chosen = self._staging_candidate(request["tree"], request["migration_inventory"])
                except (OSError, TypeError, ValueError, KeyError):
                    chosen = None
                if chosen is None:
                    return {"status": "OUTCOME_UNKNOWN", "migration_ids": []}
                candidate = chosen["manifest"]
            try:
                result = self.manager.plan_migrations(candidate)
            except Exception:
                return {"status": "OUTCOME_UNKNOWN", "migration_ids": []}
            allowed = {"NO_PENDING", "READY", "REQUIRES_OPERATOR", "DRIFT",
                       "BACKUP_NOT_READY", "BASELINE_REQUIRED", "OUTCOME_UNKNOWN", "STALE_RUN"}
            if (type(result) is not dict or set(result) != {"status", "migration_ids"}
                    or result.get("status") not in allowed or type(result.get("migration_ids")) is not list
                    or any(type(item) is not str or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+", item)
                           for item in result["migration_ids"])):
                return {"status": "OUTCOME_UNKNOWN", "migration_ids": []}
            return {"status": result["status"], "migration_ids": result["migration_ids"]}

    def reconcile_migrations(self, request, provenance=None):
        validate_request(request, self.environment)
        if request["op"] != "reconcile-migrations" or not trusted_provenance(provenance, request):
            raise ValueError("Migration recovery requires an exact authenticated request")
        with release_lock(self.root.parent):
            state = self._validate_state(read_json(self.path)) if self.path.exists() else None
            if not state or not state.get("pending"):
                return {"status": "NO_PENDING"}
            pending = state["pending"]
            if pending.get("phase") != "migrating":
                return {"status": "OUTCOME_UNKNOWN"}
            if run_identity(request["run_id"], request["attempt"]) <= tuple(state["highest"]):
                return {"status": "STALE_RUN"}
            try:
                self._recover(state)
            except Exception:
                return {"status": "OUTCOME_UNKNOWN"}
            if state.get("pending"):
                return {"status": "OUTCOME_UNKNOWN"}
            return {"status": "RECONCILED"}

    def _receipt(self, manifest):
        identity = hashlib.sha256(json.dumps(manifest, sort_keys=True,
                                             separators=(",", ":")).encode()).hexdigest()
        return self.root / "uploads" / f"{identity}.json"

    def upload(self, manifest, stream, provenance=None):
        if self.environment != "staging":
            raise ValueError("Production does not accept image uploads")
        validate_manifest(manifest)
        with release_lock(self.root.parent):
            state = self._state()
            if run_identity(manifest["run_id"], manifest["attempt"]) < tuple(state["highest"]):
                raise ValueError("Obsolete workflow run")
            collect_releases(self.root.parent, self.manager)
            reserve = 4 * 1024 ** 3 + 2 * MAX_EXPANDED + manifest["archive_size"]
            if shutil.disk_usage(self.root).free < reserve:
                raise ValueError("Insufficient temporary release disk space")
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as output:
                    temporary = Path(output.name)
                    remaining = manifest["archive_size"]
                    while remaining:
                        chunk = stream.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError("Truncated image upload")
                        output.write(chunk)
                        remaining -= len(chunk)
                    if stream.read(1):
                        raise ValueError("Upload exceeds declared archive size")
                    output.flush()
                with temporary.open("rb") as archive:
                    proof = validate_archive(archive, manifest)
                # Import can outlive a disconnected receiver. Journal validated
                # content before any Docker effect; this is never a deploy receipt.
                intent = self.root / "upload-intents" / self._receipt(manifest).name
                write_json(intent, {"manifest": manifest, "proof": proof, "started_at": time.time()})
                self.manager.load(temporary, manifest, proof)
                self.manager.ensure_images(manifest)
                write_json(self._receipt(manifest), {"manifest": manifest, "provenance": provenance})
                intent.unlink()
                collect_releases(self.root.parent, self.manager)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
            return {"status": "uploaded", "commit": manifest["commit"]}

    def deploy(self, manifest, provenance=None):
        if self.environment != "staging":
            raise ValueError("Production requires verified staging promotion")
        validate_manifest(manifest)
        with release_lock(self.root.parent):
            receipt = self._receipt(manifest)
            uploaded = read_json(receipt) if receipt.exists() else {}
            if uploaded.get("manifest") != manifest:
                raise ValueError("No matching validated upload")
            upload_request = {"op": "upload", "environment": "staging", "manifest": manifest}
            if not trusted_provenance(uploaded.get("provenance"), upload_request):
                provenance = None
            return self._activate(manifest, manifest["commit"], manifest["run_id"], manifest["attempt"], provenance)

    def promote(self, request, provenance=None):
        validate_request(request, self.environment)
        if request["op"] != "promote" or self.staging_dir is None:
            raise ValueError("Promotion source is not configured")
        with release_lock(self.root.parent):
            chosen = self._staging_candidate(request["tree"])
            if chosen is None:
                raise ValueError("Main does not match a verified retained staging source tree")
            staging_receipt = chosen["migration_receipt"]
            return self._activate(chosen["manifest"], request["commit"],
                                  request["run_id"], request["attempt"], provenance, staging_receipt)

    def _staging_candidate(self, tree, migration_inventory=None):
        if self.staging_dir is None:
            raise ValueError("Promotion source is not configured")
        stage_path = self.staging_dir / "state.json"
        if not stage_path.exists():
            raise ValueError("No verified staging release exists")
        stage = self._validate_state(read_json(stage_path))
        if stage.get("pending"):
            raise ValueError("Staging has an unresolved rollout")
        candidates = [stage.get("active"), stage.get("previous")]
        for item in candidates:
            if type(item) is not dict or type(item.get("manifest")) is not dict:
                continue
            manifest = item["manifest"]
            try:
                validate_manifest(manifest)
            except (TypeError, ValueError):
                continue
            receipt = item.get("migration_receipt")
            if (item.get("eligible_for_promotion") is True
                    and trusted_provenance(item.get("provenance"), {
                        "op": "deploy", "environment": "staging", "manifest": manifest})
                    and manifest["tree"] == tree
                    and (migration_inventory is None or manifest["migration_inventory"] == migration_inventory)
                    and time.time() - 86400 <= item.get("verified_at", 0) <= time.time()
                    and self._verified_migration_receipt(receipt, manifest, "staging")):
                return item
        return None

    @classmethod
    def _new_migration_receipt(cls, environment, manifest, status):
        return {"schema": 1, "environment": environment, "status": status,
                "source": {"commit": manifest["commit"], "tree": manifest["tree"],
                           "api_image": manifest["images"]["api"]["id"], "migrations": manifest["migrations"]},
                "migration_inventory": copy.deepcopy(manifest["migration_inventory"]),
                "verified_at": int(time.time()) if status == "verified" else None}

    @staticmethod
    def _verified_migration_receipt(receipt, manifest, environment):
        try:
            validate_stored_manifest(manifest)
        except (TypeError, ValueError):
            return False
        if type(manifest) is not dict or manifest.get("schema") != 2:
            return False
        expected_source = {"commit": manifest.get("commit"), "tree": manifest.get("tree"),
                           "api_image": manifest.get("images", {}).get("api", {}).get("id"),
                           "migrations": manifest.get("migrations")}
        return (type(receipt) is dict and set(receipt) == {
                    "schema", "environment", "status", "source", "migration_inventory", "verified_at"}
                and receipt.get("schema") == 1 and receipt.get("environment") == environment
                and receipt.get("status") == "verified" and receipt.get("source") == expected_source
                and receipt.get("migration_inventory") == manifest.get("migration_inventory")
                and type(receipt.get("verified_at")) is int
                and 0 < receipt["verified_at"] <= time.time())

    def _recover(self, state):
        pending = state.get("pending")
        if not pending:
            return
        before = pending["before"]
        if pending.get("phase") == "migrating":
            try:
                self.manager.reconcile_migration_execution(pending["target"])
                self.manager.verify(before["manifest"])
                plan = self.manager.plan_migrations(pending["target"])
            except Exception as error:
                raise RuntimeError("Migration recovery is uncertain; operator action required") from error
            if (type(plan) is not dict or plan.get("status") not in {
                    "READY", "NO_PENDING", "REQUIRES_OPERATOR", "BACKUP_NOT_READY"}):
                raise RuntimeError("Migration recovery is uncertain; operator action required")
            state["pending"] = None
            state["last_failure"] = "migration attempt reconciled; candidate must be replanned"
            write_json(self.path, state)
            return
        try:
            self.manager.activate(before["manifest"])
            self.manager.verify(before["manifest"])
        except Exception as error:
            raise RuntimeError("Deployment recovery failed; operator action required") from error
        state["active"] = before
        state["pending"] = None
        state["last_failure"] = "previous release recovered"
        write_json(self.path, state)

    def _activate(self, manifest, deployment_commit, run_id, attempt, provenance=None,
                  staging_migration_receipt=None):
        state = self._state()
        if state.get("pending"):
            self._recover(state)
        key = run_identity(run_id, attempt)
        highest = tuple(state["highest"])
        if key < highest:
            raise ValueError("Obsolete workflow run")
        active = state["active"]
        promotable = self.environment == "staging" and trusted_provenance(provenance,
            {"op": "deploy", "environment": "staging", "manifest": manifest})
        same = (active["manifest"]["images"] == manifest["images"]
                and active["manifest"]["tree"] == manifest["tree"]
                and active["deployment_commit"] == deployment_commit)
        if not same and key == highest:
            raise ValueError("This workflow attempt already failed; rerun with a new attempt")
        self.manager.preflight(manifest)
        self.manager.ensure_images(manifest)
        self.manager.verify(active["manifest"])
        migration_plan = None
        if manifest.get("schema") == 2:
            migration_plan = self.manager.plan_migrations(manifest)
            if type(migration_plan) is not dict or migration_plan.get("status") not in {"READY", "NO_PENDING"}:
                status = migration_plan.get("status", "OUTCOME_UNKNOWN") if isinstance(migration_plan, dict) else "OUTCOME_UNKNOWN"
                ids = migration_plan.get("migration_ids", []) if isinstance(migration_plan, dict) else []
                raise MigrationBlocked(status, ids)
        elif manifest.get("schema") not in {None, 1}:
            raise ValueError("Unsupported migration release schema")

        migration_receipt = None
        if migration_plan is not None:
            migration_receipt = self._new_migration_receipt(self.environment, manifest, "applied")
            if migration_plan["status"] == "READY":
                state["highest"] = list(key)
                state["pending"] = {"phase": "migrating", "before": copy.deepcopy(active),
                                    "target": copy.deepcopy(manifest), "deployment_commit": deployment_commit,
                                    "run_id": run_id, "attempt": attempt}
                write_json(self.path, state)
                try:
                    applied = self.manager.apply_migrations(manifest)
                except Exception as error:
                    state["last_failure"] = "database migration failed; candidate was not activated"
                    write_json(self.path, state)
                    try:
                        reconciled = self.manager.plan_migrations(manifest)
                    except Exception:
                        reconciled = {"status": "OUTCOME_UNKNOWN", "migration_ids": []}
                    if (isinstance(reconciled, dict) and reconciled.get("status") not in {"READY", "NO_PENDING"}):
                        raise MigrationBlocked(reconciled.get("status"), reconciled.get("migration_ids")) from error
                    raise RuntimeError("Database migration failed; candidate app was not activated") from error
                if type(applied) is not dict or applied.get("status") not in {"APPLIED", "NO_PENDING"}:
                    state["last_failure"] = "database migration result was not verified; candidate was not activated"
                    write_json(self.path, state)
                    raise RuntimeError("Database migration result was not verified; candidate app was not activated")
        if same:
            self.manager.verify(manifest)
            verified_receipt = self._new_migration_receipt(self.environment, manifest, "verified") \
                if migration_receipt is not None else None
            active.update(verified_at=time.time(), run_id=run_id, attempt=attempt,
                          manifest=copy.deepcopy(manifest), provenance=provenance,
                          eligible_for_promotion=promotable)
            if verified_receipt is not None:
                active["migration_receipt"] = verified_receipt
            if staging_migration_receipt is not None:
                active["staging_migration_receipt"] = copy.deepcopy(staging_migration_receipt)
            state["highest"] = list(max(key, highest))
            state["pending"] = None
            write_json(self.path, state)
            collect_releases(self.root.parent, self.manager)
            return {"status": "already-current", "commit": deployment_commit}

        state["highest"] = list(key)
        state["pending"] = {"phase": "activating", "before": copy.deepcopy(active), "target": copy.deepcopy(manifest),
                            "deployment_commit": deployment_commit, "run_id": run_id,
                            "attempt": attempt,
                            **({"migration_receipt": migration_receipt} if migration_receipt else {})}
        write_json(self.path, state)
        try:
            self.manager.activate(manifest)
            self.manager.verify(manifest)
        except Exception as error:
            self._recover(state)
            raise RuntimeError("Deployment failed; previous release recovered") from error
        state["previous"] = active
        active_release = {"manifest": copy.deepcopy(manifest), "deployment_commit": deployment_commit,
                           "run_id": run_id, "attempt": attempt, "eligible_for_promotion": promotable,
                           "provenance": copy.deepcopy(provenance),
                           "verified_at": time.time()}
        if migration_receipt is not None:
            active_release["migration_receipt"] = self._new_migration_receipt(
                self.environment, manifest, "verified")
        if staging_migration_receipt is not None:
            active_release["staging_migration_receipt"] = copy.deepcopy(staging_migration_receipt)
        state["active"] = active_release
        state["pending"] = None
        state.pop("last_failure", None)
        write_json(self.path, state)
        collect_releases(self.root.parent, self.manager)
        return {"status": "deployed", "commit": deployment_commit,
                "built_commit": manifest["commit"], "tree": manifest["tree"]}
