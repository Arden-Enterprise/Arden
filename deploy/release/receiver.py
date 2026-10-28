#!/usr/bin/env python3
"""Release state machine. Privileged effects live behind the management adapter."""

import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time

from protocol import validate_archive, validate_manifest, validate_request, run_identity, MAX_EXPANDED
from retention import collect_releases
from state import read_json, write_json, release_lock
from identity import trusted_provenance


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
            return read_json(self.path)
        baseline = self.manager.baseline()
        value = {"active": {"manifest": baseline, "deployment_commit": baseline["commit"],
                            "eligible_for_promotion": False},
                 "previous": None, "pending": None, "highest": [0, 0]}
        write_json(self.path, value)
        return value

    def status(self):
        with release_lock(self.root.parent):
            return copy.deepcopy(self._state())

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
            stage_path = self.staging_dir / "state.json"
            if not stage_path.exists():
                raise ValueError("No verified staging release exists")
            stage = read_json(stage_path)
            if stage.get("pending"):
                raise ValueError("Staging has an unresolved rollout")
            candidates = [stage.get("active"), stage.get("previous")]
            chosen = next((item for item in candidates if item and item.get("eligible_for_promotion")
                           and trusted_provenance(item.get("provenance"), {"op": "deploy", "environment": "staging", "manifest": item["manifest"]})
                           and item["manifest"]["tree"] == request["tree"]
                           and time.time() - 86400 <= item.get("verified_at", 0) <= time.time()), None)
            if chosen is None:
                raise ValueError("Main does not match a verified retained staging source tree")
            return self._activate(chosen["manifest"], request["commit"],
                                  request["run_id"], request["attempt"], provenance)

    def _recover(self, state):
        pending = state.get("pending")
        if not pending:
            return
        before = pending["before"]
        try:
            self.manager.activate(before["manifest"])
            self.manager.verify(before["manifest"])
        except Exception as error:
            raise RuntimeError("Deployment recovery failed; operator action required") from error
        state["active"] = before
        state["pending"] = None
        state["last_failure"] = "previous release recovered"
        write_json(self.path, state)

    def _activate(self, manifest, deployment_commit, run_id, attempt, provenance=None):
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
        if same:
            self.manager.ensure_images(manifest)
            self.manager.verify(manifest)
            active.update(verified_at=time.time(), run_id=run_id, attempt=attempt,
                          manifest=copy.deepcopy(manifest), provenance=provenance, eligible_for_promotion=promotable)
            state["highest"] = list(max(key, highest))
            write_json(self.path, state)
            collect_releases(self.root.parent, self.manager)
            return {"status": "already-current", "commit": deployment_commit}
        if key == highest:
            raise ValueError("This workflow attempt already failed; rerun with a new attempt")
        self.manager.preflight(manifest)
        self.manager.ensure_images(manifest)
        self.manager.verify(active["manifest"])
        state["highest"] = list(key)
        state["pending"] = {"before": copy.deepcopy(active), "target": copy.deepcopy(manifest),
                            "deployment_commit": deployment_commit, "run_id": run_id,
                            "attempt": attempt}
        write_json(self.path, state)
        try:
            self.manager.activate(manifest)
            self.manager.verify(manifest)
        except Exception as error:
            self._recover(state)
            raise RuntimeError("Deployment failed; previous release recovered") from error
        state["previous"] = active
        state["active"] = {"manifest": copy.deepcopy(manifest), "deployment_commit": deployment_commit,
                           "run_id": run_id, "attempt": attempt, "eligible_for_promotion": promotable,
                           "provenance": copy.deepcopy(provenance),
                           "verified_at": time.time()}
        state["pending"] = None
        state.pop("last_failure", None)
        write_json(self.path, state)
        collect_releases(self.root.parent, self.manager)
        return {"status": "deployed", "commit": deployment_commit,
                "built_commit": manifest["commit"], "tree": manifest["tree"]}
