"""Provider-free v2 boundary, ranking and staged generation regressions."""

import asyncio
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from langchain_core.documents import Document
from pydantic import SecretStr

from arden_ai.application.governed import GovernedAnswerer
from arden_ai.contracts import AnswerRequest
from arden_ai.contracts.governed import (
    DialogueTurn,
    Evidence,
    GenerationRequest,
    GenerationResponse,
    RetrievalRequest,
    RetrievalResponse,
)
from arden_ai.domain.hybrid import bm25_rank, lexical_tokens, reciprocal_rank_fusion
from arden_ai.infrastructure.hybrid import HybridRetriever, source_evidence
from arden_ai.presentation.api import create_api

ORG = UUID("10000000-0000-4000-8000-000000000001")
GEN = UUID("10000000-0000-4000-8000-000000000002")
SNAPSHOT = UUID("10000000-0000-4000-8000-000000000003")
REQUEST = UUID("10000000-0000-4000-8000-000000000004")


def request(**changes: object) -> RetrievalRequest:
    return RetrievalRequest.model_validate(
        {
            "requestId": str(REQUEST),
            "organizationId": str(ORG),
            "query": "NS-IT-001 MFA",
            "allowedGenerationIds": [str(GEN)],
            "sourceHints": [{"generationId": str(GEN), "label": "NS-IT-001 · MFA · Version 1.0"}],
            **changes,
        }
    )


def document(text: str = "MFA is required.", identity: str = "a" * 64) -> Document:
    return Document(
        id=identity,
        page_content="Section: Security\n\n" + text,
        metadata={
            "organization_id": str(ORG),
            "generation_id": str(GEN),
            "snapshot_version_id": str(SNAPSHOT),
            "snapshot_content_hash": "b" * 64,
            "chunk_content_hash": hashlib.sha256(text.encode()).hexdigest(),
            "heading_path_json": '["Security"]',
            "source_block_ids_json": '["pdf-page-2"]',
            "parent_section_block_id": "security",
            "start_offset": 10,
            "end_offset": 10 + len(text),
        },
    )


@dataclass
class Search:
    dense: list[Document] | Exception = field(default_factory=lambda: [document()])
    lexical: list[Document] | Exception = field(default_factory=lambda: [document()])
    calls: list[tuple[str, AnswerRequest, int]] = field(default_factory=list)

    async def search_documents(self, value: AnswerRequest, limit: int) -> list[Document]:
        self.calls.append(("dense", value, limit))
        if isinstance(self.dense, Exception):
            raise self.dense
        return self.dense

    async def permitted_documents(self, value: AnswerRequest, limit: int) -> list[Document]:
        self.calls.append(("lexical", value, limit))
        if isinstance(self.lexical, Exception):
            raise self.lexical
        return self.lexical


@dataclass
class Generator:
    calls: list[GenerationRequest] = field(default_factory=list)
    rewrites: list[tuple[str, list[DialogueTurn]]] = field(default_factory=list)
    failures: int = 0
    network_error: bool = False
    insufficient: bool = False

    async def contextualize(self, query: str, history: list[DialogueTurn]) -> str:
        self.rewrites.append((query, history))
        return "NS-IT-001 MFA exceptions"

    async def generate_grounded(self, value: GenerationRequest) -> GenerationResponse:
        self.calls.append(value)
        if self.network_error:
            raise ConnectionError("unavailable")
        quote = "not in evidence" if len(self.calls) <= self.failures else "MFA is required."
        return GenerationResponse.model_validate(
            {
                "requestId": str(value.request_id),
                "status": "INSUFFICIENT_EVIDENCE" if self.insufficient else "ANSWERED",
                "answer": "Not enough evidence." if self.insufficient else "MFA is required.",
                "citations": []
                if self.insufficient
                else [{"chunkId": value.evidence[0].chunk_id, "quote": quote}],
                "usedEvidence": [chunk.chunk_id for chunk in value.evidence],
            }
        )


def generation() -> GenerationRequest:
    return GenerationRequest.model_validate(
        {
            "requestId": str(REQUEST),
            "organizationId": str(ORG),
            "query": "MFA?",
            "evidence": [source_evidence(document(), request()).model_dump(by_alias=True)],
        }
    )


def test_lexical_codes_unicode_and_deterministic_fusion() -> None:
    assert "ns-it-001" in lexical_tokens("\uff2e\uff33-IT-001")
    assert lexical_tokens("QUYỀN truy cập") == ["quyền", "truy", "cập"]
    assert bm25_rank("NS-IT-001", [("b", "NS-IT-002"), ("a", "NS-IT-001")], 2)[0] == "a"
    assert bm25_rank("unknown", [("a", "MFA")], 8) == []
    assert bm25_rank("MFA", [("b", "MFA"), ("a", "MFA")], 2) == ["a", "b"]
    assert reciprocal_rank_fusion([["a", "b"], ["b", "a"]], 8) == ["a", "b"]
    assert reciprocal_rank_fusion([["a", "a"], ["b"]], 8) == ["a", "b"]
    assert reciprocal_rank_fusion([["a", "a", "b"]], 8) == reciprocal_rank_fusion([["a", "b"]], 8)


def test_shared_core_python_v2_golden_contract() -> None:
    fixture = json.loads((Path(__file__).parent / "fixtures/governed-v2.json").read_text())
    for key, schema in [
        ("retrievalRequest", RetrievalRequest),
        ("retrievalResponse", RetrievalResponse),
        ("generationRequest", GenerationRequest),
        ("generationResponse", GenerationResponse),
    ]:
        assert (
            schema.model_validate(fixture[key]).model_dump(mode="json", by_alias=True)
            == fixture[key]
        )


def test_both_branches_receive_the_same_core_scope_and_raw_text_is_recovered() -> None:
    search = Search()
    found, mode = asyncio.run(HybridRetriever(search).retrieve(request(), "MFA"))
    assert mode == "HYBRID"
    assert len(found) == 1 and found[0].content == "MFA is required."
    assert found[0].label.startswith("NS-IT-001")
    assert [call[2] for call in search.calls] == [24, 10_001]
    for _, value, _ in search.calls:
        assert value.organization_id == ORG and value.allowed_generation_ids == [GEN]
        assert value.query == "MFA"


@pytest.mark.parametrize("branch,mode", [("dense", "LEXICAL"), ("lexical", "SEMANTIC")])
def test_single_network_failure_reports_honest_filtered_degradation(branch: str, mode: str) -> None:
    search = Search()
    setattr(search, branch, ConnectionError("unavailable"))
    found, actual = asyncio.run(HybridRetriever(search).retrieve(request(), "MFA"))
    assert actual == mode and len(found) == 1


def test_both_network_failures_do_not_become_empty_success() -> None:
    with pytest.raises(RuntimeError, match="both authorized"):
        asyncio.run(
            HybridRetriever(Search(ConnectionError(), ConnectionError())).retrieve(request(), "MFA")
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("organization_id", "20000000-0000-4000-8000-000000000001"),
        ("generation_id", "20000000-0000-4000-8000-000000000002"),
        ("chunk_content_hash", "0" * 64),
        ("end_offset", 999),
        ("source_block_ids_json", "[]"),
        ("heading_path_json", '["Fake"]'),
    ],
)
def test_malformed_or_cross_scope_evidence_fails_closed(field: str, value: object) -> None:
    bad = document()
    bad.metadata[field] = value
    with pytest.raises(ValueError):
        asyncio.run(HybridRetriever(Search(lexical=[bad])).retrieve(request(), "MFA"))


def test_validation_errors_cannot_fall_back_to_a_healthy_branch() -> None:
    with pytest.raises(ValueError, match="unsafe"):
        asyncio.run(
            HybridRetriever(Search(lexical=ValueError("unsafe"))).retrieve(request(), "MFA")
        )


def test_conflicting_or_duplicate_chunk_identities_are_rejected() -> None:
    with pytest.raises(ValueError, match="conflicting"):
        asyncio.run(
            HybridRetriever(Search(lexical=[document("Other content.")])).retrieve(request(), "MFA")
        )
    with pytest.raises(ValueError, match="duplicate lexical"):
        asyncio.run(
            HybridRetriever(Search(lexical=[document(), document()])).retrieve(request(), "MFA")
        )


def test_corpus_budget_never_silently_truncates_lexical_search() -> None:
    with pytest.raises(ValueError, match="budget"):
        asyncio.run(
            HybridRetriever(Search(lexical=[document()] * 10_001)).retrieve(request(), "MFA")
        )


def test_retrieval_is_separate_from_generation_and_followups_are_contextualized() -> None:
    generator = Generator()
    service = GovernedAnswerer(HybridRetriever(Search()), generator)
    value = request(history=[{"question": "MFA?", "answer": "Required."}], query="Exceptions?")
    result = asyncio.run(service.retrieve(value))
    assert result.standalone_query == "NS-IT-001 MFA exceptions"
    assert len(generator.rewrites) == 1 and generator.calls == []
    asyncio.run(service.retrieve(request()))
    assert len(generator.rewrites) == 1


def test_generation_repairs_once_using_exactly_the_same_evidence() -> None:
    generator = Generator(failures=1)
    value = generation()
    result = asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert result.citations[0].quote == "MFA is required."
    assert generator.calls == [value, value]


def test_generation_rejects_a_second_invalid_quote_without_more_attempts() -> None:
    generator = Generator(failures=2)
    with pytest.raises(ValueError, match="exact source"):
        asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(generation()))
    assert len(generator.calls) == 2


def test_network_failure_is_not_an_invalid_output_repair() -> None:
    generator = Generator(network_error=True)
    with pytest.raises(ConnectionError):
        asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(generation()))
    assert len(generator.calls) == 1


def test_insufficient_output_still_records_all_used_inputs() -> None:
    value = generation()
    generator = Generator(insufficient=True)
    result = asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert result.citations == [] and result.used_evidence == [value.evidence[0].chunk_id]


@pytest.mark.parametrize(
    "changes",
    [
        {"allowedGenerationIds": [str(GEN), str(GEN)]},
        {"sourceHints": [{"generationId": str(SNAPSHOT), "label": "forged"}]},
        {"history": [{"question": "q" * 4000, "answer": "a" * 12000}] * 2},
        {"purpose": "MAINTENANCE"},
        {"contractVersion": 1},
        {"unknown": "field"},
    ],
)
def test_contract_rejects_invalid_scope_budget_and_unknown_fields(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        request(**changes)


def test_unicode_evidence_offsets_are_codepoints_and_not_utf16() -> None:
    evidence = source_evidence(document("🔐 Quyền đọc"), request())
    assert evidence.end_offset - evidence.start_offset == len("🔐 Quyền đọc")
    with pytest.raises(ValueError):
        Evidence.model_validate({**evidence.model_dump(), "parent_section_block_id": "x" * 201})


def test_v2_http_auth_contract_and_staged_handoff() -> None:
    generator = Generator()
    application = create_api(
        service_token=SecretStr("test-only"),
        governed=GovernedAnswerer(HybridRetriever(Search()), generator),
    )
    client = TestClient(application)
    headers = {"Authorization": "Bearer test-only"}
    assert (
        client.post(
            "/v2/retrievals", json=request().model_dump(mode="json", by_alias=True)
        ).status_code
        == 401
    )
    retrieved = client.post(
        "/v2/retrievals", headers=headers, json=request().model_dump(mode="json", by_alias=True)
    )
    assert retrieved.status_code == 200 and generator.calls == []
    assert retrieved.json()["contractVersion"] == 2
    generated = client.post(
        "/v2/generations", headers=headers, json=generation().model_dump(mode="json", by_alias=True)
    )
    assert generated.status_code == 200 and len(generator.calls) == 1
    assert generated.json()["usedEvidence"] == ["a" * 64]
    assert (
        client.post("/v2/generations", headers=headers, json={"contractVersion": 1}).status_code
        == 422
    )


def test_service_failure_does_not_return_private_exception_contents(
    caplog: pytest.LogCaptureFixture,
) -> None:
    private = "PRIVATE_DOCUMENT_CONTENT"
    client = TestClient(
        create_api(
            service_token=SecretStr("test-only"),
            governed=GovernedAnswerer(
                HybridRetriever(Search(dense=ValueError(private))), Generator()
            ),
        )
    )
    result = client.post(
        "/v2/retrievals",
        headers={"Authorization": "Bearer test-only"},
        json=request().model_dump(mode="json", by_alias=True),
    )
    assert result.status_code == 502
    assert private not in result.text and private not in caplog.text
    assert "evidence" not in json.dumps(result.json()).lower()
