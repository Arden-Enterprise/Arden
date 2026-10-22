import hashlib
import json
from uuid import UUID

from arden_ai.contracts import IndexGenerationRequest
from arden_ai.contracts.export_schemas import build_schemas
from arden_ai.domain import ARDEN_DOCUMENT_PREFIX


def snapshot() -> str:
    document = {
        "schemaVersion": 1,
        "blocks": [
            {
                "id": "body",
                "type": "paragraph",
                "props": {},
                "content": [{"type": "text", "text": "Policy", "styles": {}}],
                "children": [],
            }
        ],
    }
    return ARDEN_DOCUMENT_PREFIX + json.dumps(document, separators=(",", ":"))


def test_index_request_uses_strict_camel_case_contract() -> None:
    content = snapshot()
    request = IndexGenerationRequest.model_validate(
        {
            "contractVersion": 1,
            "jobId": "10000000-0000-4000-8000-000000000001",
            "organizationId": "10000000-0000-4000-8000-000000000002",
            "submissionId": "10000000-0000-4000-8000-000000000003",
            "generationId": "10000000-0000-4000-8000-000000000004",
            "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
            "snapshotContentHash": hashlib.sha256(content.encode()).hexdigest(),
            "snapshotContent": content,
        }
    )

    assert request.generation_id == UUID("10000000-0000-4000-8000-000000000004")
    assert request.semantic_document().blocks[0].id == "body"


def test_index_request_rejects_unknown_fields() -> None:
    content = snapshot()
    payload = {
        "jobId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "submissionId": "10000000-0000-4000-8000-000000000003",
        "generationId": "10000000-0000-4000-8000-000000000004",
        "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
        "snapshotContentHash": hashlib.sha256(content.encode()).hexdigest(),
        "snapshotContent": content,
        "callbackUrl": "https://attacker.test/ssrf",
    }
    try:
        IndexGenerationRequest.model_validate(payload)
    except ValueError as error:
        assert "callbackUrl" in str(error)
    else:
        raise AssertionError("unknown contract fields must be rejected")


def test_index_request_rejects_future_contract_versions() -> None:
    content = snapshot()
    payload = {
        "contractVersion": 2,
        "jobId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "submissionId": "10000000-0000-4000-8000-000000000003",
        "generationId": "10000000-0000-4000-8000-000000000004",
        "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
        "snapshotContentHash": hashlib.sha256(content.encode()).hexdigest(),
        "snapshotContent": content,
    }
    try:
        IndexGenerationRequest.model_validate(payload)
    except ValueError as error:
        assert "contractVersion" in str(error)
    else:
        raise AssertionError("unsupported contract versions must be rejected")


def test_index_request_rejects_snapshot_hash_mismatch() -> None:
    try:
        IndexGenerationRequest.model_validate(
            {
                "jobId": "10000000-0000-4000-8000-000000000001",
                "organizationId": "10000000-0000-4000-8000-000000000002",
                "submissionId": "10000000-0000-4000-8000-000000000003",
                "generationId": "10000000-0000-4000-8000-000000000004",
                "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
                "snapshotContentHash": "a" * 64,
                "snapshotContent": snapshot(),
            }
        )
    except ValueError as error:
        assert "does not match" in str(error)
    else:
        raise AssertionError("snapshot hash mismatch must be rejected")


def test_exported_indexing_schema_contains_concrete_contracts() -> None:
    schema = build_schemas()["index-generation-v1.schema.json"]
    definitions = schema["$defs"]

    assert "properties" in definitions["IndexGenerationRequest"]
    assert "properties" in definitions["IndexGenerationManifest"]


