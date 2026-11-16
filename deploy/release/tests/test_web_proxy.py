"""Request-size limits of the release web proxy must admit what the API accepts.

The Vite development proxy has no body limit, so a missing nginx location only
fails on staging/production. This test applies nginx's location selection to the
checked-in web.conf and compares the limits with the API's per-route bodyLimit.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
WEB_CONF = ROOT / "deploy" / "release" / "web.conf"
API_APP = ROOT / "apps" / "api" / "src" / "app.ts"
ORG = "0b9e1c2a-4f3d-4a5b-8c6d-7e8f9a0b1c2d"
DRAFT = "1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f"


def size_bytes(value):
    match = re.fullmatch(r"(\d+)([kKmM]?)", value)
    if not match:
        raise ValueError(f"Unsupported nginx size {value!r}")
    return int(match[1]) * {"": 1, "k": 1024, "m": 1024 * 1024}[match[2].lower()]


def api_constant(name):
    """Evaluate a numeric `const name = 5 * 1024 * 1024;` style declaration in app.ts."""
    match = re.search(rf"^const {name} = ([0-9_ *]+);$", API_APP.read_text(encoding="utf-8"), re.M)
    if not match:
        raise AssertionError(f"Review this test: {name} is no longer a plain numeric constant in app.ts")
    product = 1
    for factor in match[1].split("*"):
        product *= int(factor.strip().replace("_", ""))
    return product


def parse_server(text):
    """Return the server default limit and its locations as (modifier, pattern, limit)."""
    locations, outside, position = [], [], 0
    pattern = re.compile(r"location\s+(=|~\*|~|\^~)?\s*(\S+)\s*\{")
    while True:
        match = pattern.search(text, position)
        if not match:
            outside.append(text[position:])
            break
        outside.append(text[position:match.start()])
        depth, index = 1, match.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(text[index], 0)
            index += 1
        body = text[match.end():index - 1]
        limit = re.search(r"client_max_body_size\s+(\S+);", body)
        locations.append((match[1] or "", match[2], size_bytes(limit[1]) if limit else None))
        position = index
    default = re.search(r"client_max_body_size\s+(\S+);", "".join(outside))
    return size_bytes(default[1]), locations


def effective_limit(path):
    """nginx order: exact match, then the first matching regex, then the longest prefix."""
    default, locations = parse_server(WEB_CONF.read_text(encoding="utf-8"))
    selected = next((entry for entry in locations if entry[0] == "=" and entry[1] == path), None)
    if selected is None:
        prefixes = [entry for entry in locations if entry[0] in ("", "^~") and path.startswith(entry[1])]
        longest = max(prefixes, key=lambda entry: len(entry[1]), default=None)
        if longest and longest[0] == "^~":
            selected = longest
        else:
            selected = next((entry for entry in locations if entry[0] in ("~", "~*")
                             and re.search(entry[1], path, re.I if entry[0] == "~*" else 0)), longest)
    return default if selected is None or selected[2] is None else selected[2]


class WebProxyBodyLimitTests(unittest.TestCase):
    def setUp(self):
        max_pdf_bytes = api_constant("maxPdfBytes")
        self.max_pdf_base64 = -(-max_pdf_bytes // 3) * 4
        self.max_body_bytes = api_constant("maxBodyBytes")

    def test_pdf_draft_creation_fits_the_api_limit(self):
        path = f"/api/v1/organizations/{ORG}/knowledge/drafts/pdf"
        self.assertGreaterEqual(effective_limit(path), self.max_pdf_base64 + 4096)

    def test_pdf_replacement_patch_fits_the_api_limit(self):
        path = f"/api/v1/organizations/{ORG}/knowledge/drafts/{DRAFT}"
        self.assertGreaterEqual(effective_limit(path), self.max_pdf_base64 + self.max_body_bytes)

    def test_other_api_routes_keep_the_small_default(self):
        for path in ["/api/v1/me", f"/api/v1/organizations/{ORG}/knowledge/drafts/new",
                     f"/api/v1/organizations/{ORG}/knowledge/drafts/{DRAFT}/submit",
                     f"/api/v1/organizations/{ORG}/knowledge/drafts/{DRAFT}/versions"]:
            with self.subTest(path=path):
                self.assertEqual(effective_limit(path), 128 * 1024)


if __name__ == "__main__":
    unittest.main()
