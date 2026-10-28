import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_protocol import fixture
try:
    from retention import collect_releases
except ModuleNotFoundError:
    collect_releases = None


class ImageStore:
    def __init__(self, images):
        self.available = set(images)

    def remove_owned_image(self, identifier, commit):
        self.available.discard(identifier)
        return True


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(collect_releases, "Scoped release retention is not implemented")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / "staging" / "uploads").mkdir(parents=True)
        (self.root / "production").mkdir()

    def manifest(self, digit):
        value, _ = fixture()
        value["commit"] = digit * 40
        for component, suffix in [("api", "1"), ("web", "2")]:
            value["images"][component] = {"id": "sha256:" + digit * 63 + suffix,
                                           "tag": f"arden-release-{component}:sha-{digit * 40}"}
        return value

    def test_other_environments_previous_and_pending_images_are_not_collected(self):
        values = [self.manifest(digit) for digit in ["a", "b", "c", "d"]]
        for index, value in enumerate(values):
            (self.root / "staging" / "uploads" / f"{index}.json").write_text(json.dumps(value))
        stage = {"active": {"manifest": values[0]}, "previous": None,
                 "pending": {"before": {"manifest": values[0]}, "target": values[2]}}
        production = {"active": {"manifest": values[0]}, "previous": {"manifest": values[1]}, "pending": None}
        (self.root / "staging" / "state.json").write_text(json.dumps(stage))
        (self.root / "production" / "state.json").write_text(json.dumps(production))
        images = [image["id"] for value in values for image in value["images"].values()]
        store = ImageStore(images)
        collect_releases(self.root, store, now=time.time() + 7200)
        wanted = {image["id"] for value in values[:3] for image in value["images"].values()}
        self.assertEqual(store.available, wanted)
        self.assertFalse((self.root / "staging" / "uploads" / "3.json").exists())

    def test_only_the_newest_recent_upload_is_retained_before_activation(self):
        values = [self.manifest(digit) for digit in ["a", "b"]]
        for index, value in enumerate(values):
            path = self.root / "staging" / "uploads" / f"{index}.json"
            path.write_text(json.dumps(value))
            import os
            os.utime(path, (100 + index, 100 + index))
        images = [image["id"] for value in values for image in value["images"].values()]
        store = ImageStore(images)
        collect_releases(self.root, store, now=150)
        self.assertEqual(store.available, {image["id"] for image in values[1]["images"].values()})

    def test_in_use_image_refusal_retains_receipt_for_operator_reconciliation(self):
        value = self.manifest("a")
        path = self.root / "staging" / "uploads" / "0.json"
        path.write_text(json.dumps(value))
        store = ImageStore(image["id"] for image in value["images"].values())
        store.remove_owned_image = lambda identifier, commit: False
        collect_releases(self.root, store, now=time.time() + 7200)
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
