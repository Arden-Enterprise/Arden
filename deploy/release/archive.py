"""Runner-only normalization: one Docker manifest view, portable config digests."""
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
        raise ValueError("Invalid temporary archive paths or size")
    entries = None
    total = 0
    with tarfile.open(source, "r|gz") as archive:
        for count, item in enumerate(archive):
            total += item.size
            if count >= MAX_MEMBERS or total > MAX_EXPANDED:
                raise ValueError("Runner archive exceeds limits")
            if item.name == "manifest.json":
                if item.size > MAX_JSON or entries is not None:
                    raise ValueError("Invalid Docker manifest")
                entries = strict_json(archive.extractfile(item).read())
    if not isinstance(entries, list) or len(entries) != 2:
        raise ValueError("Expected exactly two Docker images")
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict) or not {"Config", "RepoTags", "Layers"}.issubset(entry):
            raise ValueError("Missing Docker manifest fields")
        normalized.append({key: entry[key] for key in ["Config", "RepoTags", "Layers"]})
    configs = {entry["Config"] for entry in normalized}
    content, seen = {}, set()
    with tarfile.open(source, "r|gz") as archive, tarfile.open(target, "w:gz", format=tarfile.USTAR_FORMAT) as output:
        for item in archive:
            name = item.name.rstrip("/")
            if name in ALTERNATE or item.isdir():
                continue
            if (not item.isfile() or name in seen or not MEMBER.fullmatch(name)
                    or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts):
                raise ValueError("Unexpected Docker export member")
            seen.add(name)
            stream = archive.extractfile(item)
            if name == "manifest.json":
                raw = json.dumps(normalized, separators=(",", ":")).encode()
                stream, size = io.BytesIO(raw), len(raw)
            elif name in configs:
                if item.size > MAX_JSON:
                    raise ValueError("Image config exceeds limit")
                raw = stream.read()
                content[name] = "sha256:" + hashlib.sha256(raw).hexdigest()
                stream, size = io.BytesIO(raw), len(raw)
            else:
                size = item.size
            header = tarfile.TarInfo(name)
            header.size, header.mode = size, 0o600
            output.addfile(header, stream)
    images = {}
    for entry in normalized:
        if not isinstance(entry["RepoTags"], list) or len(entry["RepoTags"]) != 1:
            raise ValueError("Expected one approved tag per image")
        tag = entry["RepoTags"][0]
        component = next((kind for kind in ["api", "web"] if tag.startswith(f"arden-release-{kind}:sha-")), None)
        if not component or component in images or entry["Config"] not in content:
            raise ValueError("Invalid app pair")
        images[component] = {"tag": tag, "id": content[entry["Config"]]}
    return images


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "roundtrip":
        from management import CoolifyManager
        manifest = strict_json(Path(sys.argv[3]).read_bytes())
        with Path(sys.argv[2]).open("rb") as stream:
            proof = validate_archive(stream, manifest)
        config = {"environment": "staging", "service_uuid": "roundtrip12345", "api_url": "http://127.0.0.1:8080/api/v1",
                  "origin": "https://example.test", "migrations": manifest["migrations"],
                  "state_dir": str(Path(sys.argv[4]) / "staging"),
                  "baseline": {"images": {kind: {"id": "sha256:" + "0" * 64} for kind in ["api", "web"]}},
                  "template": {"services": {"arden-" + kind: {
                      "user": uid, "read_only": True, "cap_drop": ["ALL"],
                      "security_opt": ["no-new-privileges:true"], "pull_policy": "never"}
                      for kind, uid in [("api", "1000:1000"), ("web", "101:101")]}}}
        manager = CoolifyManager(config)
        manager.load(Path(sys.argv[2]), manifest, proof)
        manager.ensure_images(manifest)
        print(json.dumps({"roundtrip": True, "runtime_images": {kind: manager.image_id(manifest, kind) for kind in ["api", "web"]}}))
    elif len(sys.argv) == 4 and sys.argv[1] == "verify":
        with Path(sys.argv[2]).open("rb") as stream:
            validate_archive(stream, strict_json(Path(sys.argv[3]).read_bytes()))
        print('{"verified":true}')
    elif len(sys.argv) == 3:
        print(json.dumps(normalize_archive(sys.argv[1], sys.argv[2])))
    else:
        raise ValueError("Expected fixed normalize or verify arguments")
