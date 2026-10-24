import asyncio
from dataclasses import dataclass
from uuid import UUID

from arden_ai.application import (
    GeneratedAnswer,
    PermissionAwareAnswerer,
    RetrievedChunk,
)
from arden_ai.contracts import AnswerRequest

ORGANIZATION_ID = UUID("10000000-0000-4000-8000-000000000001")
GENERATION_ID = UUID("10000000-0000-4000-8000-000000000002")
SNAPSHOT_ID = UUID("10000000-0000-4000-8000-000000000003")


def answer_request() -> AnswerRequest:
    return AnswerRequest.model_validate(
        {
            "requestId": "10000000-0000-4000-8000-000000000004",
            "organizationId": str(ORGANIZATION_ID),
            "query": "How is MFA used?",
            "allowedGenerationIds": [str(GENERATION_ID)],
        }
    )


@dataclass
class FakeRetriever:
    chunks: tuple[RetrievedChunk, ...]

    async def retrieve(
        self, request: AnswerRequest, limit: int
    ) -> tuple[RetrievedChunk, ...]:
        assert request.allowed_generation_ids == [GENERATION_ID]
        assert limit == 8
        return self.chunks


@dataclass
class FakeGenerator:
    result: GeneratedAnswer

    async def generate(
        self, query: str, evidence: tuple[RetrievedChunk, ...]
    ) -> GeneratedAnswer:
        assert query == "How is MFA used?"
        assert evidence
        return self.result


def chunk(generation_id: UUID = GENERATION_ID) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id="b" * 64,
        generation_id=generation_id,
        snapshot_version_id=SNAPSHOT_ID,
        snapshot_content_hash="a" * 64,
        content="All team members must use MFA.",
        source_block_ids=("mfa",),
        parent_section_block_id=None,
    )


def test_answerer_returns_only_retrieved_citations() -> None:
    answerer = PermissionAwareAnswerer(
        FakeRetriever((chunk(),)),
        FakeGenerator(GeneratedAnswer("MFA is required.", ("b" * 64,))),
    )

    response = asyncio.run(answerer.answer(answer_request()))

    assert response.status == "ANSWERED"
    assert response.citations[0].generation_id == GENERATION_ID
    assert response.citations[0].source_block_ids == ["mfa"]


def test_answerer_rejects_evidence_outside_core_allow_list() -> None:
    other = UUID("20000000-0000-4000-8000-000000000002")
    answerer = PermissionAwareAnswerer(
        FakeRetriever((chunk(other),)),
        FakeGenerator(GeneratedAnswer("Unsafe", ("b" * 64,))),
    )

    try:
        asyncio.run(answerer.answer(answer_request()))
    except RuntimeError as error:
        assert "outside the Core allow-list" in str(error)
    else:
        raise AssertionError("out-of-scope evidence was accepted")


def test_answerer_abstains_when_retrieval_is_empty() -> None:
    answerer = PermissionAwareAnswerer(
        FakeRetriever(()),
        FakeGenerator(GeneratedAnswer("unused", ())),
    )

    response = asyncio.run(answerer.answer(answer_request()))

    assert response.status == "INSUFFICIENT_EVIDENCE"
    assert response.citations == []
