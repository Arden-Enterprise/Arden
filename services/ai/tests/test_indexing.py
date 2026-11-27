import asyncio
import hashlib
import json
from dataclasses import dataclass
from uuid import UUID

from arden_ai.application import GenerationIndexer, PreparedGeneration
from arden_ai.contracts import IndexGenerationRequest
from arden_ai.domain import ARDEN_DOCUMENT_PREFIX


def request() -> IndexGenerationRequest:
    body = ARDEN_DOCUMENT_PREFIX + json.dumps(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "heading",
                    "type": "heading",
                    "props": {"level": 1},
                    "content": [{"type": "text", "text": "Security", "styles": {}}],
                    "children": [],
                },
                {
                    "id": "body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Use MFA.", "styles": {}}],
                    "children": [],
                },
            ],
        },
        separators=(",", ":"),
    )
    return IndexGenerationRequest.model_validate(
        {
            "jobId": "10000000-0000-4000-8000-000000000001",
            "organizationId": "10000000-0000-4000-8000-000000000002",
            "submissionId": "10000000-0000-4000-8000-000000000003",
            "generationId": "10000000-0000-4000-8000-000000000004",
            "snapshotVersionId": "10000000-0000-4000-8000-000000000005",
            "snapshotContentHash": hashlib.sha256(body.encode()).hexdigest(),
            "snapshotMimeType": "text/plain",
            "snapshotContent": body,
        }
    )


@dataclass
class FakeStore:
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1_536
    received: PreparedGeneration | None = None

    async def replace_candidate(
        self, request: IndexGenerationRequest, prepared: PreparedGeneration
    ) -> None:
        assert request.generation_id == UUID("10000000-0000-4000-8000-000000000004")
        self.received = prepared


def test_indexer_writes_candidate_before_returning_manifest() -> None:
    store = FakeStore()
    indexing_request = request()
    manifest = asyncio.run(GenerationIndexer(store).index(indexing_request))

    assert store.received is not None
    assert manifest.generation_id == indexing_request.generation_id
    assert manifest.embedding_model == "text-embedding-3-small"
    assert manifest.embedding_dimensions == 1_536
    assert manifest.compiler_version == "semantic-markdown-v1"
    assert manifest.chunking_version == "langchain-section-token-v1"
    assert len(manifest.chunks) == 1
    assert manifest.chunks[0].source_block_ids == ["body"]
    assert len(manifest.chunks_digest) == 64

