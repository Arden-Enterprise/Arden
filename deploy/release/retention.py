"""Collect only validated app uploads not needed by either environment."""

from pathlib import Path
import time

from protocol import validate_manifest
from state import read_json


def collect_releases(parent, manager, now=None):
    """Caller owns the host release lock. Never traverses arbitrary directories."""
    parent = Path(parent)
    now = time.time() if now is None else now
    retained, uploads = set(), []

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
                manifest = validate_manifest(read_json(receipt))
                uploads.append((receipt, manifest))
    if uploads:
        recent = max(uploads, key=lambda item: item[0].stat().st_mtime_ns)
        if recent[0].stat().st_mtime >= now - 3600:
            protect(recent[1])
    removed = 0
    for receipt, manifest in uploads:
        images = list(manifest["images"].values())
        if all(image["id"] in retained for image in images):
            continue
        outcomes = [image["id"] in retained or manager.remove_owned_image(image["id"], manifest["commit"])
                    for image in images]
        if all(outcomes) and not any(image["id"] in retained for image in images):
            receipt.unlink()
            removed += 1
    return {"retired_receipts": removed}
