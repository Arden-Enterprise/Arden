"""Collect only validated app uploads not needed by either environment."""

from pathlib import Path
import time

from protocol import validate_manifest
from state import read_json


def collect_releases(parent, manager, now=None):
    """Caller owns the host release lock. Never traverses arbitrary directories."""
    parent = Path(parent)
    now = time.time() if now is None else now
    retained, uploads, intents = set(), [], []

    def protect(manifest):
        if manifest:
            retained.update(image["id"] for image in manifest["images"].values())

    for environment in ["staging", "production"]:
        root = parent / environment
        path = root / "state.json"
        if path.exists():
            state = read_json(path)
            for key in ["active", "previous"]:
                if state.get(key):
                    protect(state[key]["manifest"])
            if state.get("pending"):
                protect(state["pending"]["before"]["manifest"])
                protect(state["pending"]["target"])
        directory = root / "uploads"
        if directory.exists():
            if directory.resolve() != directory or not directory.is_dir():
                raise ValueError("Unexpected release-receipt directory")
            for receipt in directory.glob("*.json"):
                if receipt.is_symlink() or not receipt.is_file():
                    raise ValueError("Unexpected release receipt")
                value = read_json(receipt)
                manifest = validate_manifest(value.get("manifest", value))
                uploads.append((receipt, manifest))
        directory = root / "upload-intents"
        if directory.exists():
            if directory.resolve() != directory or not directory.is_dir():
                raise ValueError("Unexpected upload-intent directory")
            for intent in directory.glob("*.json"):
                if intent.is_symlink() or not intent.is_file():
                    raise ValueError("Unexpected upload intent")
                value = read_json(intent)
                validate_manifest(value["manifest"])
                intents.append((intent, value))
    if uploads:
        recent = max(uploads, key=lambda item: item[0].stat().st_mtime_ns)
        if recent[0].stat().st_mtime >= now - 3600:
            protect(recent[1])
    binding_path = parent / "image-bindings.json"
    bindings = read_json(binding_path) if binding_path.exists() else {}
    # Distinct portable configs can refer to the same store-local image. Protect
    # that local identity even when it is not currently used by a container.
    retained_local = retained | {bindings.get(identifier, identifier) for identifier in retained}
    def protected(image):
        return bindings.get(image["id"], image["id"]) in retained_local

    for intent, value in intents:
        if (intent.parent.parent / "uploads" / intent.name).exists():
            intent.unlink()  # A durable completed receipt now owns retention.
        elif value["started_at"] <= now - 3600:
            manager.remove_incomplete_upload(value["manifest"], value["proof"], retained_local)
            # Keep the small journal: Docker may finish an interrupted import
            # after this scan, or an in-use/unknown image may need a later pass.
    removed = 0
    for receipt, manifest in uploads:
        images = list(manifest["images"].values())
        if all(protected(image) for image in images):
            continue
        outcomes = [protected(image) or manager.remove_owned_image(image["id"], manifest["commit"])
                    for image in images]
        if all(outcomes) and not any(protected(image) for image in images):
            receipt.unlink()
            removed += 1
    return {"retired_receipts": removed}
