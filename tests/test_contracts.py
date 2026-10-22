from uuid import UUID

from arden_ai.contracts import IndexGenerationRequest


def test_index_request_uses_strict_camel_case_contract() -> None:
    request = IndexGenerationRequest.model_validate(
        {
            "contractVersion": 1,
            "jobId": "10000000-0000-4000-8000-000000000001",
            "organizationId": "10000000-0000-4000-8000-000000000002",
            "submissionId": "10000000-0000-4000-8000-000000000003",
            "generationId": "10000000-0000-4000-8000-000000000004",
            "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
            "snapshotContentHash": "a" * 64,
            "document": {
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
            },
        }
    )

    assert request.generation_id == UUID("10000000-0000-4000-8000-000000000004")
    assert request.model_dump(by_alias=True, mode="json")["snapshotContentHash"] == "a" * 64


def test_index_request_rejects_unknown_fields() -> None:
    payload = {
        "jobId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "submissionId": "10000000-0000-4000-8000-000000000003",
        "generationId": "10000000-0000-4000-8000-000000000004",
        "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
        "snapshotContentHash": "a" * 64,
        "document": {"schemaVersion": 1, "blocks": []},
        "callbackUrl": "https://attacker.test/ssrf",
    }
    try:
        IndexGenerationRequest.model_validate(payload)
    except ValueError as error:
        assert "callbackUrl" in str(error)
    else:
        raise AssertionError("unknown contract fields must be rejected")


def test_index_request_rejects_future_contract_versions() -> None:
    payload = {
        "contractVersion": 2,
        "jobId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "submissionId": "10000000-0000-4000-8000-000000000003",
        "generationId": "10000000-0000-4000-8000-000000000004",
        "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
        "snapshotContentHash": "a" * 64,
        "document": {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "body",
                    "type": "paragraph",
                    "props": {},
                    "content": [],
                    "children": [],
                }
            ],
        },
    }
    try:
        IndexGenerationRequest.model_validate(payload)
    except ValueError as error:
        assert "contractVersion" in str(error)
    else:
        raise AssertionError("unsupported contract versions must be rejected")


