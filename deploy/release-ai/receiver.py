#!/usr/bin/env python3
"""AI release state machine. Shares the single VPS activation lock with Core."""

import copy
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile
import time

from identity import trusted_provenance
from protocol import (MAX_EXPANDED, run_identity, validate_archive, validate_manifest,
                      validate_request, validate_stored_manifest)
from retention import collect_releases
from state import read_json, release_lock, write_json

VALID_OPERATOR_ACTIONS = {"rollback", "baseline-cutover"}


class AiReleaseEngine:
    def __init__(self, environment, state_dir, manager, staging_dir=None, lock_path=None):
        if environment not in {"staging", "production"}:
            raise ValueError("Unknown AI deployment environment")
        self.environment = environment
        self.root = Path(state_dir)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / "state.json"
        self.manager = manager
        self.staging_dir = Path(staging_dir) if staging_dir else None
        self.lock_path = Path(lock_path) if lock_path else (self.root.parent / "release.lock")

    def _state(self):
        if self.path.exists():
            return self._validate_state(read_json(self.path))
        baseline = self.manager.baseline()
        validate_stored_manifest(baseline)
        value = {
            "active": {
                "manifest": baseline,
                "deployment_commit": baseline["commit"],
                "eligible_for_promotion": False,
            },
            "previous": None,
            "pending": None,
            "highest": [0, 0],
        }
        write_json(self.path, value)
        return value

    @staticmethod
    def _validate_state(value):
        if (type(value) is not dict
                or not {"active", "previous", "pending", "highest"}.issubset(value)
                or set(value) - {"active", "previous", "pending", "highest", "last_failure", "operator_action"}):
            raise ValueError("Stored AI release state is malformed")
        if "operator_action" in value:
            action = value["operator_action"]
            if (type(action) is not dict or set(action) != {"action", "verified_at"}
                    or type(action["action"]) is not str
                    or action["action"] not in VALID_OPERATOR_ACTIONS):
                raise ValueError("Stored AI operator action receipt is malformed")
            verified_at = action["verified_at"]
            if type(verified_at) not in {int, float} or not math.isfinite(verified_at) or verified_at <= 0:
                raise ValueError("Stored AI operator action receipt is malformed")
        if type(value["active"]) is not dict:
            raise ValueError("Stored AI release state is malformed")
        releases = [value["active"], value["previous"]]
        pending = value["pending"]
        if pending is not None:
            if (type(pending) is not dict or not {"before", "target"}.issubset(pending)
                    or type(pending["before"]) is not dict or type(pending["target"]) is not dict):
                raise ValueError("Stored AI release state is malformed")
            releases.extend([pending["before"], {"manifest": pending["target"]}])
        for release in releases:
            if release is not None:
                if type(release) is not dict or "manifest" not in release:
                    raise ValueError("Stored AI release state is malformed")
                validate_stored_manifest(release["manifest"])
        if (type(value["highest"]) is not list or len(value["highest"]) != 2
                or any(type(item) is not int or item < 0 for item in value["highest"])):
            raise ValueError("Stored AI release sequence is malformed")
        return value

    def status(self):
        with release_lock(self.lock_path):
            return copy.deepcopy(self._state())

    def _receipt(self, manifest):
        digest = hashlib.sha256(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return self.root / "uploads" / f"{digest}.json"

    def upload(self, manifest, stream, provenance=None):
        if self.environment != "staging":
            raise ValueError("Production does not accept AI image uploads")
        validate_manifest(manifest)
        with release_lock(self.lock_path):
            state = self._state()
            if run_identity(manifest["run_id"], manifest["attempt"]) < tuple(state["highest"]):
                raise ValueError("Obsolete workflow run")
            collect_releases(self.root.parent, self.manager)
            reserve = 4 * 1024 ** 3 + 2 * MAX_EXPANDED + manifest["archive_size"]
            if shutil.disk_usage(self.root).free < reserve:
                raise ValueError("Insufficient temporary AI release disk space")
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as output:
                    temporary = Path(output.name)
                    remaining = manifest["archive_size"]
                    while remaining:
                        chunk = stream.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError("Truncated AI image upload")
                        output.write(chunk)
                        remaining -= len(chunk)
                    if stream.read(1):
                        raise ValueError("AI upload exceeds declared archive size")
                    output.flush()
                with temporary.open("rb") as archive:
                    proof = validate_archive(archive, manifest)
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
            return {"status": "uploaded", "commit": manifest["commit"], "ai_tree": manifest["ai_tree"]}

    def deploy(self, manifest, provenance=None):
        if self.environment != "staging":
            raise ValueError("Production requires verified staging AI promotion")
        validate_manifest(manifest)
        with release_lock(self.lock_path):
            receipt = self._receipt(manifest)
            uploaded = read_json(receipt) if receipt.exists() else {}
            if uploaded.get("manifest") != manifest:
                raise ValueError("No matching validated AI upload")
            upload_request = {"op": "upload", "environment": "staging", "manifest": manifest}
            if not trusted_provenance(uploaded.get("provenance"), upload_request):
                provenance = None
            return self._activate(
                manifest, manifest["commit"], manifest["run_id"], manifest["attempt"], provenance
            )

    def plan_promote(self, request, provenance=None):
        """Read-only production promotion readiness check for dual preflight."""
        validate_request(request, self.environment)
        if request["op"] != "plan-promote" or not trusted_provenance(provenance, request):
            raise ValueError("AI promotion plan requires an exact authenticated request")
        with release_lock(self.lock_path):
            state = self._state()
            if state.get("pending"):
                return {"status": "RECOVERY_REQUIRED"}
            if run_identity(request["run_id"], request["attempt"]) < tuple(state["highest"]):
                return {"status": "STALE_RUN"}
            active_manifest = state["active"]["manifest"]
            if active_manifest.get("ai_tree") == request["ai_tree"]:
                try:
                    self.manager.ensure_images(active_manifest)
                    self.manager.verify(active_manifest)
                    return {"status": "ALREADY_CURRENT"}
                except Exception:
                    return {"status": "RECOVERY_REQUIRED"}
            try:
                chosen = self._staging_candidate(request["ai_tree"])
            except (OSError, TypeError, ValueError, KeyError):
                return {"status": "STAGING_REQUIRED"}
            if chosen is None:
                return {"status": "STAGING_REQUIRED"}
            try:
                self.manager.ensure_images(chosen["manifest"])
            except Exception:
                return {"status": "STAGING_REQUIRED"}
            return {"status": "READY", "staging_commit": chosen["manifest"]["commit"]}

    def promote(self, request, provenance=None):
        validate_request(request, self.environment)
        if request["op"] != "promote" or self.staging_dir is None:
            raise ValueError("AI promotion source is not configured")
        with release_lock(self.lock_path):
            state = self._state()
            active_manifest = state["active"]["manifest"]
            if (not state.get("pending")
                    and active_manifest.get("ai_tree") == request["ai_tree"]
                    and run_identity(request["run_id"], request["attempt"]) >= tuple(state["highest"])):
                self.manager.preflight(active_manifest)
                self.manager.ensure_images(active_manifest)
                self.manager.verify(active_manifest)
                state["highest"] = list(max(run_identity(request["run_id"], request["attempt"]), tuple(state["highest"])))
                write_json(self.path, state)
                return {"status": "already-current", "commit": request["commit"], "ai_tree": request["ai_tree"]}
            chosen = self._staging_candidate(request["ai_tree"])
            if chosen is None:
                raise ValueError("Main does not match a verified retained staging AI tree")
            return self._activate(
                chosen["manifest"], request["commit"], request["run_id"], request["attempt"], provenance
            )

    def _staging_candidate(self, ai_tree):
        if self.staging_dir is None:
            raise ValueError("AI promotion source is not configured")
        stage_path = self.staging_dir / "state.json"
        if not stage_path.exists():
            raise ValueError("No verified staging AI release exists")
        stage = self._validate_state(read_json(stage_path))
        if stage.get("pending"):
            raise ValueError("Staging AI has an unresolved rollout")
        for item in [stage.get("active"), stage.get("previous")]:
            if type(item) is not dict or type(item.get("manifest")) is not dict:
                continue
            manifest = item["manifest"]
            try:
                validate_manifest(manifest)
            except (TypeError, ValueError):
                continue
            if (item.get("eligible_for_promotion") is True
                    and trusted_provenance(item.get("provenance"), {
                        "op": "deploy", "environment": "staging", "manifest": manifest})
                    and manifest["ai_tree"] == ai_tree
                    and time.time() - 86400 <= item.get("verified_at", 0) <= time.time()):
                return item
        return None

    def _recover(self, state):
        pending = state.get("pending")
        if not pending:
            return
        before = pending["before"]
        try:
            self.manager.activate(before["manifest"])
            self.manager.verify(before["manifest"])
        except Exception as error:
            raise RuntimeError("AI deployment recovery failed; operator action required") from error
        state["active"] = before
        state["pending"] = None
        state["last_failure"] = "previous AI release recovered"
        write_json(self.path, state)

    def rollback(self):
        """Root-only operator rollback preserving monotonic highest run fence."""
        with release_lock(self.lock_path):
            state = self._state()
            if state.get("pending"):
                self._recover(state)
                return {"status": "recovered", "commit": state["active"]["manifest"]["commit"]}
            previous = state.get("previous")
            if not previous:
                raise ValueError("No previous AI release is recorded for rollback")
            failed_active = copy.deepcopy(state["active"])
            failed_active["eligible_for_promotion"] = False
            self.manager.ensure_images(previous["manifest"])
            self.manager.activate(previous["manifest"])
            self.manager.verify(previous["manifest"])
            state["active"] = copy.deepcopy(previous)
            state["previous"] = failed_active
            state["pending"] = None
            state["operator_action"] = {"action": "rollback", "verified_at": int(time.time())}
            write_json(self.path, state)
            collect_releases(self.root.parent, self.manager)
            return {"status": "rolled-back", "commit": state["active"]["manifest"]["commit"]}

    def _activate(self, manifest, deployment_commit, run_id, attempt, provenance=None):
        state = self._state()
        if state.get("pending"):
            self._recover(state)
        key = run_identity(run_id, attempt)
        highest = tuple(state["highest"])
        if key < highest:
            raise ValueError("Obsolete workflow run")
        active = state["active"]
        promotable = self.environment == "staging" and trusted_provenance(
            provenance, {"op": "deploy", "environment": "staging", "manifest": manifest}
        )
        same = (active["manifest"]["images"] == manifest["images"]
                and active["manifest"]["ai_tree"] == manifest["ai_tree"]
                and active["deployment_commit"] == deployment_commit)
        if not same and key == highest:
            raise ValueError("This workflow attempt already failed; rerun with a new attempt")
        self.manager.preflight(manifest)
        self.manager.ensure_images(manifest)
        self.manager.verify(active["manifest"])

        if same:
            self.manager.verify(manifest)
            active.update(
                verified_at=time.time(),
                run_id=run_id,
                attempt=attempt,
                manifest=copy.deepcopy(manifest),
                provenance=provenance,
                eligible_for_promotion=promotable,
            )
            state["highest"] = list(max(key, highest))
            state["pending"] = None
            write_json(self.path, state)
            collect_releases(self.root.parent, self.manager)
            return {"status": "already-current", "commit": deployment_commit, "ai_tree": manifest["ai_tree"]}

        state["highest"] = list(key)
        state["pending"] = {
            "phase": "activating",
            "before": copy.deepcopy(active),
            "target": copy.deepcopy(manifest),
            "deployment_commit": deployment_commit,
            "run_id": run_id,
            "attempt": attempt,
        }
        write_json(self.path, state)
        try:
            self.manager.activate(manifest)
            self.manager.verify(manifest)
        except Exception as error:
            self._recover(state)
            raise RuntimeError("AI deployment failed; previous release recovered") from error

        state["previous"] = active
        state["active"] = {
            "manifest": copy.deepcopy(manifest),
            "deployment_commit": deployment_commit,
            "run_id": run_id,
            "attempt": attempt,
            "eligible_for_promotion": promotable,
            "provenance": copy.deepcopy(provenance),
            "verified_at": time.time(),
        }
        state["pending"] = None
        state.pop("last_failure", None)
        write_json(self.path, state)
        collect_releases(self.root.parent, self.manager)
        return {
            "status": "deployed",
            "commit": deployment_commit,
            "built_commit": manifest["commit"],
            "ai_tree": manifest["ai_tree"],
        }
