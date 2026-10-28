import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import protocol
except ModuleNotFoundError:
    protocol = None


def fixture(managed=True):
    configs = {}
    images = {}
    for component, user in [("api", "1000:1000"), ("web", "101:101")]:
        raw = json.dumps({"architecture": "amd64", "os": "linux", "config": {
            "User": user, "Labels": {"org.opencontainers.image.revision": "a" * 40,
                                     "io.arden.release.tree": "b" * 40,
                                     "io.arden.release.migrations": "c" * 64,
                                     "io.arden.release.managed": "1" if managed else "0"}}}).encode()
        digest = hashlib.sha256(raw).hexdigest()
        name = f"blobs/sha256/{digest}"
        configs[name] = raw
        images[component] = {"tag": f"arden-release-{component}:sha-{'a' * 40}",
                             "id": f"sha256:{digest}"}
    entries = [{"Config": name, "RepoTags": [images[component]["tag"]], "Layers": []}
               for component, name in zip(["api", "web"], configs)]
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as archive:
        for name, raw in {"manifest.json": json.dumps(entries).encode(), **configs}.items():
            item = tarfile.TarInfo(name)
            item.size = len(raw)
            archive.addfile(item, io.BytesIO(raw))
    payload = data.getvalue()
    manifest = {"schema": 1, "commit": "a" * 40, "tree": "b" * 40,
                "run_id": "12345", "attempt": 1, "migrations": "c" * 64,
                "images": images, "archive_sha256": hashlib.sha256(payload).hexdigest(),
                "archive_size": len(payload)}
    return manifest, payload


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(protocol, "Release protocol is not implemented")
        self.manifest, self.payload = fixture()

    def test_valid_release_is_accepted_without_changing_manifest(self):
        original = copy.deepcopy(self.manifest)
        self.assertEqual(protocol.validate_manifest(self.manifest), original)
        self.assertEqual(self.manifest, original)

    def test_unknown_fields_or_image_components_are_rejected(self):
        for mutate in [lambda m: m.update(command="sh"),
                       lambda m: m["images"].update(database=m["images"]["api"])]:
            data = copy.deepcopy(self.manifest)
            mutate(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                protocol.validate_manifest(data)

    def test_identity_and_numeric_fields_are_strict(self):
        for field, value in [("commit", "$(whoami)"), ("tree", "A" * 40),
                             ("run_id", "0"), ("run_id", 12345),
                             ("attempt", True), ("attempt", 0),
                             ("archive_size", 0), ("archive_size", 536870913),
                             ("archive_sha256", "x" * 64)]:
            data = copy.deepcopy(self.manifest)
            data[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                protocol.validate_manifest(data)

    def test_image_tags_must_bind_component_to_commit(self):
        for tag in ["coollabsio/coolify:latest", "arden-release-api:sha-" + "d" * 40,
                    "arden-release-web:sha-" + "a" * 40]:
            data = copy.deepcopy(self.manifest)
            data["images"]["api"]["tag"] = tag
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                protocol.validate_manifest(data)

    def test_duplicate_json_keys_and_nonfinite_numbers_are_rejected(self):
        for raw in [b'{"op":"status","op":"deploy"}', b'{"x":NaN}']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                protocol.strict_json(raw)

    def test_environment_is_bound_to_forced_command(self):
        request = {"op": "upload", "environment": "production", "manifest": self.manifest}
        with self.assertRaises(ValueError):
            protocol.validate_request(request, "staging")
        with self.assertRaises(ValueError):
            protocol.validate_request(request, "production")
        self.assertEqual(protocol.validate_request({"op": "status", "environment": "staging"},
                                                  "staging")["op"], "status")

    def test_valid_saved_image_archive_is_accepted(self):
        protocol.validate_archive(io.BytesIO(self.payload), self.manifest)

    def test_alternate_loader_metadata_is_rejected(self):
        for name in ["index.json", "oci-layout", "repositories"]:
            target = io.BytesIO()
            with tarfile.open(fileobj=io.BytesIO(self.payload), mode="r:gz") as source, \
                    tarfile.open(fileobj=target, mode="w:gz") as archive:
                for item in source:
                    archive.addfile(item, source.extractfile(item))
                raw = b'{"manifests":[{"annotations":{"io.containerd.image.name":"postgres:latest"}}]}'
                item = tarfile.TarInfo(name)
                item.size = len(raw)
                archive.addfile(item, io.BytesIO(raw))
            payload = target.getvalue()
            manifest = copy.deepcopy(self.manifest)
            manifest.update(archive_size=len(payload), archive_sha256=hashlib.sha256(payload).hexdigest())
            with self.subTest(name=name), self.assertRaises(ValueError):
                protocol.validate_archive(io.BytesIO(payload), manifest)

    def test_archive_requires_ownership_marker_for_safe_future_retention(self):
        manifest, payload = fixture(managed=False)
        with self.assertRaises(ValueError):
            protocol.validate_archive(io.BytesIO(payload), manifest)

    def test_header_is_bounded_and_does_not_consume_upload_bytes(self):
        self.assertTrue(hasattr(protocol, "read_header"), "Bounded request reader is not implemented")
        header = json.dumps({"op": "upload", "environment": "staging", "manifest": self.manifest}).encode() + b"\n"
        stream = io.BytesIO(header + self.payload)
        self.assertEqual(protocol.read_header(stream, "staging")["op"], "upload")
        self.assertEqual(stream.read(), self.payload)
        for raw in [b"x" * 8193 + b"\n", b'{"op":"status","environment":"staging"}']:
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                protocol.read_header(io.BytesIO(raw), "staging")

    def test_malformed_nested_image_configuration_is_a_validation_failure(self):
        self.assertTrue(hasattr(protocol, "validate_image_config"), "Image config validator is not implemented")
        for raw in [b'[]', b'{"architecture":"amd64","os":"linux","config":[]}',
                    b'{"architecture":"amd64","os":"linux","config":{"Labels":[]}}']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                protocol.validate_image_config(raw, "api", self.manifest)

    def test_tampered_archive_is_rejected(self):
        broken = bytearray(self.payload)
        broken[len(broken) // 2] ^= 1
        with self.assertRaises(ValueError):
            protocol.validate_archive(io.BytesIO(broken), self.manifest)

    def test_archive_rejects_traversal_and_links_even_with_matching_checksum(self):
        for name, kind in [("../../etc/passwd", tarfile.REGTYPE),
                           ("shortcut", tarfile.SYMTYPE),
                           ("/absolute", tarfile.REGTYPE)]:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w:gz") as archive:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else ""
                archive.addfile(item, io.BytesIO())
            payload = data.getvalue()
            manifest = copy.deepcopy(self.manifest)
            manifest.update(archive_size=len(payload), archive_sha256=hashlib.sha256(payload).hexdigest())
            with self.subTest(name=name), self.assertRaises(ValueError):
                protocol.validate_archive(io.BytesIO(payload), manifest)

    def test_docker_config_must_match_expected_image_identity(self):
        data = copy.deepcopy(self.manifest)
        data["images"]["api"]["id"] = "sha256:" + "d" * 64
        with self.assertRaises(ValueError):
            protocol.validate_archive(io.BytesIO(self.payload), data)

    def test_hidden_gnu_longname_metadata_cannot_bypass_outer_archive_policy(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=io.BytesIO(self.payload), mode="r:gz") as original:
            content = {item.name: original.extractfile(item).read() for item in original}
        with tarfile.open(fileobj=data, mode="w:gz", format=tarfile.GNU_FORMAT) as archive:
            longname = tarfile.TarInfo("././@LongLink")
            longname.type = tarfile.GNUTYPE_LONGNAME
            raw = b"manifest.json\0"
            longname.size = len(raw)
            archive.addfile(longname, io.BytesIO(raw))
            for name, raw in content.items():
                item = tarfile.TarInfo("placeholder" if name == "manifest.json" else name)
                item.size = len(raw)
                archive.addfile(item, io.BytesIO(raw))
        payload = data.getvalue()
        manifest = copy.deepcopy(self.manifest)
        manifest.update(archive_size=len(payload), archive_sha256=hashlib.sha256(payload).hexdigest())
        with self.assertRaises(ValueError):
            protocol.validate_archive(io.BytesIO(payload), manifest)


if __name__ == "__main__":
    unittest.main()
