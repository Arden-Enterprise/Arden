"""Runner-only normalization for the single-image AI archive (USTAR, gzip level 3)."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from protocol import MAX_ARCHIVE, MAX_EXPANDED, MAX_JSON, MAX_MEMBERS, MEMBER, strict_json, validate_archive

ALTERNATE = {"index.json", "oci-layout", "repositories"}


def normalize_archive(source, target):
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve() or source.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Invalid temporary AI archive paths or size")
    entries = None
    total = 0
    with tarfile.open(source, "r|gz") as archive:
        for count, item in enumerate(archive):
            total += item.size
            if count >= MAX_MEMBERS or total > MAX_EXPANDED:
                raise ValueError("Runner AI archive exceeds limits")
            if item.name == "manifest.json":
                if item.size > MAX_JSON or entries is not None:
                    raise ValueError("Invalid Docker manifest")
                entries = strict_json(archive.extractfile(item).read())
    if not isinstance(entries, list) or len(entries) != 1:
        raise ValueError("Expected exactly one AI Docker image")
    entry = entries[0]
    if not isinstance(entry, dict) or not {"Config", "RepoTags", "Layers"}.issubset(entry):
        raise ValueError("Missing Docker manifest fields")
    normalized = [{key: entry[key] for key in ["Config", "RepoTags", "Layers"]}]
    configs = {entry["Config"]}
    content, seen = {}, set()
    with tarfile.open(source, "r|gz") as archive, \
            tarfile.open(target, "w:gz", compresslevel=3, format=tarfile.USTAR_FORMAT) as output:
        for item in archive:
            name = item.name.rstrip("/")
            if name in ALTERNATE or item.isdir():
                continue
            if (not item.isfile() or name in seen or not MEMBER.fullmatch(name)
                    or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts):
                raise ValueError("Unexpected AI Docker export member")
            seen.add(name)
            stream = archive.extractfile(item)
            if name == "manifest.json":
                raw = json.dumps(normalized, separators=(",", ":")).encode()
                stream, size = io.BytesIO(raw), len(raw)
            elif name in configs:
                if item.size > MAX_JSON:
                    raise ValueError("AI image config exceeds limit")
                raw = stream.read()
                content[name] = "sha256:" + hashlib.sha256(raw).hexdigest()
                stream, size = io.BytesIO(raw), len(raw)
            else:
                size = item.size
            header = tarfile.TarInfo(name)
            header.size, header.mode = size, 0o600
            output.addfile(header, stream)
    if not isinstance(entry["RepoTags"], list) or len(entry["RepoTags"]) != 1:
        raise ValueError("Expected one approved tag for AI image")
    tag = entry["RepoTags"][0]
    if not tag.startswith("arden-release-ai:sha-") or entry["Config"] not in content:
        raise ValueError("Invalid AI image tag or config")
    return {"ai": {"tag": tag, "id": content[entry["Config"]]}}


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "roundtrip":
        from management import CoolifyAiManager
        manifest = strict_json(Path(sys.argv[3]).read_bytes())
        with Path(sys.argv[2]).open("rb") as stream:
            proof = validate_archive(stream, manifest)
        config = {
            "environment": "staging",
            "service_uuid": "airoundtrip123",
            "api_url": "http://127.0.0.1:8080/api/v1",
            "state_dir": str(Path(sys.argv[4]) / "staging"),
            "protected_containers": ["chromadb-roundtrip"],
            "baseline": {"commit": manifest["commit"], "ai_tree": manifest["ai_tree"],
                         "images": {"ai": {"id": "sha256:" + "0" * 64}}},
            "template": {"services": {"arden-ai": {
                "user": "1000:1000", "read_only": True, "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"], "pull_policy": "never",
            }}},
        }
        manager = CoolifyAiManager(config)
        manager.load(Path(sys.argv[2]), manifest, proof)
        manager.ensure_images(manifest)
        print(json.dumps({"roundtrip": True, "runtime_images": {"ai": manager.image_id(manifest)}}))
    elif len(sys.argv) == 4 and sys.argv[1] == "verify":
        with Path(sys.argv[2]).open("rb") as stream:
            validate_archive(stream, strict_json(Path(sys.argv[3]).read_bytes()))
        print('{"verified":true}')
    elif len(sys.argv) == 3:
        print(json.dumps(normalize_archive(sys.argv[1], sys.argv[2])))
    else:
        raise ValueError("Expected fixed AI archive normalize, verify, or roundtrip arguments")
