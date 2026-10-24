import hashlib
import json
from dataclasses import dataclass

from fastapi.testclient import TestClient

from arden_ai.application import GenerationIndexer, PreparedGeneration
from arden_ai.contracts import IndexGenerationRequest
from arden_ai.domain import ARDEN_DOCUMENT_PREFIX
from arden_ai.infrastructure import Settings
from arden_ai.main import create_app


@dataclass
class FakeStore:
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1_536
    write_count: int = 0

    async def replace_candidate(
        self, request: IndexGenerationRequest, prepared: PreparedGeneration
    ) -> None:
        self.write_count += 1


def request_payload() -> dict[str, object]:
    content = ARDEN_DOCUMENT_PREFIX + json.dumps(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Use MFA.", "styles": {}}],
                    "children": [],
                }
            ],
        },
        separators=(",", ":"),
    )
    return {
        "jobId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "submissionId": "10000000-0000-4000-8000-000000000003",
        "generationId": "10000000-0000-4000-8000-000000000004",
        "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
        "snapshotContentHash": hashlib.sha256(content.encode()).hexdigest(),
        "snapshotContent": content,
    }


def test_index_generation_requires_service_authentication() -> None:
    application = create_app(settings=Settings(service_token="test-token"))
    client = TestClient(application)

    response = client.post("/v1/index-generations", json=request_payload())

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_index_generation_returns_candidate_manifest() -> None:
    store = FakeStore()
    application = create_app(
        settings=Settings(service_token="test-token"),
        indexer=GenerationIndexer(store),
    )
    client = TestClient(application)

    response = client.post(
        "/v1/index-generations",
        json=request_payload(),
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json()["generationId"] == "10000000-0000-4000-8000-000000000004"
    assert len(response.json()["chunks"]) == 1
    assert store.write_count == 1
