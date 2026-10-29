import copy
import hashlib
import importlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import fixture
from protocol import validate_archive


class ArchiveTests(unittest.TestCase):
    def test_normalization_uses_config_content_identity_and_removes_alternate_views(self):
        try:
            normalize = importlib.import_module("archive").normalize_archive
        except (ModuleNotFoundError, AttributeError):
            self.fail("Portable Docker archive normalization is missing")
        manifest, payload = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, output = root / "raw.gz", root / "final.gz"
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as source, tarfile.open(raw, "w:gz") as archive:
                for item in source:
                    data = source.extractfile(item).read()
                    if item.name == "manifest.json":
                        entries = json.loads(data)
                        for entry in entries:
                            entry["LayerSources"] = {}
                        data = json.dumps(entries).encode()
                        item.size = len(data)
                    archive.addfile(item, io.BytesIO(data))
                for name in ["index.json", "repositories", "oci-layout"]:
                    item = tarfile.TarInfo(name)
                    item.size = 2
                    archive.addfile(item, io.BytesIO(b"{}"))
            images = normalize(raw, output)
            self.assertEqual(images, manifest["images"])
            data = output.read_bytes()
            manifest.update(archive_sha256=hashlib.sha256(data).hexdigest(), archive_size=len(data))
            validate_archive(io.BytesIO(data), manifest)
            with tarfile.open(output, "r:gz") as archive:
                self.assertFalse({"index.json", "oci-layout", "repositories"}.intersection(archive.getnames()))


if __name__ == "__main__":
    unittest.main()
