"""Collect only validated AI uploads labeled io.arden.release.ai_managed=1."""

from pathlib import Path
import time

from protocol import validate_manifest
from state import read_json


def collect_releases(parent, manager, now=None):
    """Caller owns the shared host lock. Never touches Core-managed images."""
    parent = Path(parent)
    now = time.time() if now is None else now
    retained, uploads, intents = set(), [], []

    def protect(manifest):
        if manifest:
            retained.add(manifest["images"]["ai"]["id"])

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
                raise ValueError("Unexpected AI release-receipt directory")
            for receipt in directory.glob("*.json"):
                if receipt.is_symlink() or not receipt.is_file():
                    raise ValueError("Unexpected AI release receipt")
                value = read_json(receipt)
                manifest = validate_manifest(value.get("manifest", value))
                uploads.append((receipt, manifest))
        directory = root / "upload-intents"
        if directory.exists():
            if directory.resolve() != directory or not directory.is_dir():
                raise ValueError("Unexpected AI upload-intent directory")
            for intent in directory.glob("*.json"):
                if intent.is_symlink() or not intent.is_file():
                    raise ValueError("Unexpected AI upload intent")
                value = read_json(intent)
                validate_manifest(value["manifest"])
                intents.append((intent, value))

    if uploads:
        recent = max(uploads, key=lambda item: item[0].stat().st_mtime_ns)
        if recent[0].stat().st_mtime >= now - 3600:
            protect(recent[1])

    binding_path = parent / "image-bindings.json"
    bindings = read_json(binding_path) if binding_path.exists() else {}
    retained_local = retained | {bindings.get(identifier, identifier) for identifier in retained}

    def protected(image):
        return bindings.get(image["id"], image["id"]) in retained_local

    for intent, value in intents:
        if (intent.parent.parent / "uploads" / intent.name).exists():
            intent.unlink()
        elif value["started_at"] <= now - 3600:
            manager.remove_incomplete_upload(value["manifest"], value["proof"], retained_local)

    removed = 0
    for receipt, manifest in uploads:
        image = manifest["images"]["ai"]
        if protected(image):
            continue
        if manager.remove_owned_image(image["id"], manifest["commit"]) and not protected(image):
            receipt.unlink()
            removed += 1
    return {"retired_receipts": removed}
