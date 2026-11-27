import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from archive import normalize_archive
from protocol import (MAX_ARCHIVE, read_header, strict_json, validate_archive,
                      validate_manifest, validate_request, validate_stored_manifest)


def make_ai_archive(
    commit="a" * 40,
    ai_tree="b" * 40,
    run_id="12345",
    attempt=1,
    user="1000:1000",
    labels=None,
    extra_entries=None,
    extra_files=None,
):
    if labels is None:
        labels = {
            "org.opencontainers.image.revision": commit,
            "io.arden.release.ai_tree": ai_tree,
            "io.arden.release.ai_managed": "1",
        }
    layer_bytes = b"synthetic-ai-layer-bytes"
    layer_digest = hashlib.sha256(layer_bytes).hexdigest()
    config = {
        "architecture": "amd64",
        "os": "linux",
        "config": {"User": user, "Labels": labels},
        "rootfs": {"type": "layers", "diff_ids": ["sha256:" + layer_digest]},
    }
    config_bytes = json.dumps(config, separators=(",", ":")).encode()
    config_digest = hashlib.sha256(config_bytes).hexdigest()
    config_name = f"blobs/sha256/{config_digest}"
    layer_name = f"blobs/sha256/{layer_digest}"
    tag = f"arden-release-ai:sha-{commit}"
    manifest_entries = [{"Config": config_name, "RepoTags": [tag], "Layers": [layer_name]}]
    if extra_entries:
        manifest_entries.extend(extra_entries)
    manifest_bytes = json.dumps(manifest_entries, separators=(",", ":")).encode()

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=3, format=tarfile.USTAR_FORMAT) as tar:
        files = [
            (config_name, config_bytes),
            (layer_name, layer_bytes),
            ("manifest.json", manifest_bytes),
        ]
        if extra_files:
            files.extend(extra_files)
        for name, data in files:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(data))
    archive = buf.getvalue()
    manifest = {
        "schema": 1,
        "commit": commit,
        "ai_tree": ai_tree,
        "run_id": run_id,
        "attempt": attempt,
        "images": {"ai": {"tag": tag, "id": "sha256:" + config_digest}},
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        "archive_size": len(archive),
    }
    return manifest, archive


class AiProtocolTests(unittest.TestCase):
    def test_valid_single_image_ai_archive_passes(self):
        manifest, archive = make_ai_archive()
        proof = validate_archive(io.BytesIO(archive), manifest)
        self.assertEqual(proof["ai"]["config"]["User"], "1000:1000")
        self.assertEqual(proof["ai"]["config"]["Labels"]["io.arden.release.ai_managed"], "1")

    def test_rejects_core_label_leak_wrong_user_and_wrong_tree(self):
        cases = [
            {"user": "0:0"},
            {"labels": {"org.opencontainers.image.revision": "a" * 40,
                        "io.arden.release.ai_tree": "b" * 40,
                        "io.arden.release.ai_managed": "1",
                        "io.arden.release.managed": "1"}},
            {"labels": {"org.opencontainers.image.revision": "a" * 40,
                        "io.arden.release.ai_tree": "c" * 40,
                        "io.arden.release.ai_managed": "1"}},
            {"labels": {"org.opencontainers.image.revision": "a" * 40,
                        "io.arden.release.ai_tree": "b" * 40}},
        ]
        for kwargs in cases:
            manifest, archive = make_ai_archive(**kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                validate_archive(io.BytesIO(archive), manifest)

    def test_rejects_multi_image_archive_traversal_and_unexpected_files(self):
        manifest, archive = make_ai_archive(extra_entries=[{"Config": "x", "RepoTags": ["other:1"], "Layers": []}])
        with self.assertRaises(ValueError):
            validate_archive(io.BytesIO(archive), manifest)

        for bad_name in ["../escape.json", "repositories", "evil.sh", "/abs/path"]:
            manifest, archive = make_ai_archive(extra_files=[(bad_name, b"{}")])
            with self.subTest(bad_name=bad_name), self.assertRaises(ValueError):
                validate_archive(io.BytesIO(archive), manifest)

    def test_rejects_oversized_manifest_and_duplicate_json_keys(self):
        manifest, _ = make_ai_archive()
        manifest["archive_size"] = MAX_ARCHIVE + 1
        with self.assertRaises(ValueError):
            validate_manifest(manifest)
        with self.assertRaises(ValueError):
            strict_json('{"a":1,"a":2}')
        with self.assertRaises(ValueError):
            strict_json('{"a":NaN}')

    def test_normalize_archive_strips_oci_metadata_and_verifies_cleanly(self):
        manifest, raw_archive = make_ai_archive(extra_files=[("index.json", b"{}"), ("oci-layout", b"{}")])
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "raw.tar.gz"
            dst = Path(tmp) / "normalized.tar.gz"
            src.write_bytes(raw_archive)
            images = normalize_archive(src, dst)
            self.assertEqual(images["ai"]["tag"], manifest["images"]["ai"]["tag"])
            self.assertEqual(images["ai"]["id"], manifest["images"]["ai"]["id"])
            normalized_bytes = dst.read_bytes()
            clean_manifest = {
                **manifest,
                "archive_sha256": hashlib.sha256(normalized_bytes).hexdigest(),
                "archive_size": len(normalized_bytes),
            }
            proof = validate_archive(io.BytesIO(normalized_bytes), clean_manifest)
            self.assertEqual(proof["ai"]["architecture"], "amd64")

    def test_stored_baseline_accepted_only_as_stored_manifest(self):
        baseline = {"commit": "a" * 40, "ai_tree": "b" * 40, "images": {"ai": {"id": "sha256:" + "1" * 64}}}
        validate_stored_manifest(baseline)
        with self.assertRaises(ValueError):
            validate_manifest(baseline)

    def test_request_environment_and_header_auth_boundaries(self):
        manifest, _ = make_ai_archive()
        validate_request({"op": "status", "environment": "staging"}, "staging")
        validate_request({"op": "upload", "environment": "staging", "manifest": manifest}, "staging")
        validate_request({"op": "deploy", "environment": "staging", "manifest": manifest}, "staging")
        promote = {"op": "promote", "environment": "production", "commit": "a" * 40,
                   "ai_tree": "b" * 40, "run_id": "12", "attempt": 1}
        validate_request(promote, "production")
        validate_request({**promote, "op": "plan-promote"}, "production")

        with self.assertRaises(ValueError):
            validate_request({"op": "upload", "environment": "production", "manifest": manifest}, "production")
        with self.assertRaises(ValueError):
            validate_request({**promote, "environment": "staging"}, "staging")
        with self.assertRaises(ValueError):
            read_header(io.BytesIO(json.dumps(promote).encode() + b"\n"), "production")
        req, tok = read_header(io.BytesIO(json.dumps({"op": "status", "environment": "staging"}).encode() + b"\n"), "staging")
        self.assertEqual(req["op"], "status")
        self.assertIsNone(tok)


if __name__ == "__main__":
    unittest.main()
