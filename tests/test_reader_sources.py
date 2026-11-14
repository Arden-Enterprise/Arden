"""Whole-source compilation/contract tests. No models, database or index writes."""

import copy
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from arden_ai.application.reader_sources import prepare_reader_source
from arden_ai.contracts.export_schemas import build_schemas
from arden_ai.contracts.reader import ReaderSourceRequest, ReaderSourceResponse
from arden_ai.presentation.api import create_api

FIXTURE = Path(__file__).parent / "fixtures" / "reader-source-v1.json"


def fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_paired_golden_source_preserves_headings_unicode_and_entire_inventory() -> None:
    data = fixture()
    output = prepare_reader_source(ReaderSourceRequest.model_validate(data["request"]))
    assert output.model_dump(mode="json", by_alias=True) == data["response"]
    assert "🔐 Quyền đọc" in output.markdown
    assert "Do not reuse a cached summary after access is revoked" in output.markdown
    assert len(output.chunks) == len(data["manifest"]["chunks"]) == 3
    assert "# Exceptions" in output.markdown
    assert all("# Exceptions" not in c.content for c in output.chunks)


@pytest.mark.parametrize("field", ["purpose", "contractVersion", "snapshotContentHash"])
def test_request_rejects_wrong_purpose_version_or_snapshot_hash(field: str) -> None:
    payload = fixture()["request"]
    if field == "snapshotContentHash":
        payload["snapshot"][field] = "0" * 64
    else:
        payload[field] = "PUBLISHED_CHAT" if field == "purpose" else 2
    with pytest.raises(ValueError):
        ReaderSourceRequest.model_validate(payload)


@pytest.mark.parametrize(
    "mutation", ["omit", "reorder", "duplicate", "change", "ordinal", "heading"]
)
def test_response_rejects_inconsistent_inventory_or_canonical_text(mutation: str) -> None:
    payload = fixture()["response"]
    if mutation == "omit":
        payload["chunks"].pop()
    elif mutation == "reorder":
        payload["chunks"].reverse()
    elif mutation == "duplicate":
        payload["chunks"][1] = copy.deepcopy(payload["chunks"][0])
    elif mutation == "change":
        payload["chunks"][0]["content"] = "Changed quote."
    elif mutation == "ordinal":
        payload["chunks"][0]["ordinal"] = True
    else:
        payload["markdown"] = payload["markdown"].replace("Exceptions", "No exceptions")
    with pytest.raises(ValueError):
        ReaderSourceResponse.model_validate(payload)


def test_ordered_overlapping_chunks_are_valid() -> None:
    payload = fixture()["response"]
    payload["markdown"] = "abcdef\n"
    payload["markdownContentHash"] = hashlib.sha256(payload["markdown"].encode()).hexdigest()
    chunks = []
    for i, (start, end) in enumerate([(0, 4), (2, 7)]):
        content = payload["markdown"][start:end]
        chunks.append(
            {
                **payload["chunks"][0],
                "chunkId": str(i) * 64,
                "ordinal": i,
                "startOffset": start,
                "endOffset": end,
                "content": content,
                "contentHash": hashlib.sha256(content.encode()).hexdigest(),
            }
        )
    payload["chunks"] = chunks
    inventory = [{k: v for k, v in c.items() if k != "content"} for c in chunks]
    payload["chunksDigest"] = hashlib.sha256(
        json.dumps(inventory, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    assert len(ReaderSourceResponse.model_validate(payload).chunks) == 2


@pytest.mark.parametrize("mode", ["markdown", "chunk", "inventory"])
def test_preparation_size_limits_are_explicit(mode: str) -> None:
    payload = fixture()["response"]
    if mode == "markdown":
        payload["markdown"] = "a" * 200_001
    elif mode == "chunk":
        payload["chunks"][0]["content"] = "a" * 16_001
    else:
        payload["chunks"] = payload["chunks"] * 86
    with pytest.raises(ValueError):
        ReaderSourceResponse.model_validate(payload)


def test_source_preparation_does_not_truncate_to_chat_top_eight() -> None:
    data = fixture()["request"]
    snapshot = data["snapshot"]
    prefix, body = snapshot["snapshotContent"].split("\n", 1)
    document = json.loads(body)
    original = copy.deepcopy(document["blocks"])
    document["blocks"] = []
    for i in range(12):
        for block in copy.deepcopy(original[:2]):
            block["id"] = f"copy{i}{block['id']}"
            document["blocks"].append(block)
    snapshot["snapshotContent"] = prefix + "\n" + json.dumps(document, ensure_ascii=False)
    snapshot["snapshotContentHash"] = hashlib.sha256(
        snapshot["snapshotContent"].encode()
    ).hexdigest()
    output = prepare_reader_source(ReaderSourceRequest.model_validate(data))
    assert len(output.chunks) == 12
    assert output.markdown.count("Only approved readers") == 12


def test_internal_http_requires_service_auth_and_no_provider_runtime() -> None:
    def forbidden():
        raise AssertionError("No model or indexing factory may run")

    app = create_api(
        service_token=SecretStr("test-only"),
        indexer_factory=forbidden,
        answerer_factory=forbidden,
        governed_factory=forbidden,
    )
    with TestClient(app) as client:
        assert client.post("/v1/reader-sources", json=fixture()["request"]).status_code == 401
        response = client.post(
            "/v1/reader-sources",
            json=fixture()["request"],
            headers={"Authorization": "Bearer test-only"},
        )
    assert response.status_code == 200
    assert response.json() == fixture()["response"]


def test_additive_schema_is_exported() -> None:
    from jsonschema import Draft202012Validator

    schema = build_schemas()["reader-source-v1.schema.json"]
    stored = Path(__file__).parents[1] / "schemas" / "reader-source-v1.schema.json"
    assert json.loads(stored.read_text(encoding="utf-8")) == schema
    for name, value in [
        ("ReaderSourceRequest", fixture()["request"]),
        ("ReaderSourceResponse", fixture()["response"]),
    ]:
        Draft202012Validator({**schema, "$ref": f"#/$defs/{name}"}).validate(value)


def test_http_blank_pdf_returns_unavailable_without_ocr_or_provider() -> None:
    import base64
    import io

    from pypdf import PdfWriter

    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.write(output)
    content = output.getvalue()
    request = fixture()["request"]
    request["snapshot"].pop("snapshotContent")
    request["snapshot"].update(
        {
            "snapshotMimeType": "application/pdf",
            "snapshotContentBase64": base64.b64encode(content).decode(),
            "snapshotContentHash": hashlib.sha256(content).hexdigest(),
        }
    )
    with TestClient(create_api(service_token=SecretStr("test-only"))) as client:
        response = client.post(
            "/v1/reader-sources", json=request, headers={"Authorization": "Bearer test-only"}
        )
    assert response.status_code == 422
    assert response.json() == {"detail": "Reader source unavailable"}
