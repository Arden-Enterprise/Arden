"""Verifiable raw-quote recovery; no provider or shared index in these tests."""

import asyncio
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from test_governed import Search, document, generation, request

from arden_ai.application.governed import GovernedAnswerer
from arden_ai.contracts.governed import DialogueTurn, GenerationRequest, GenerationResponse
from arden_ai.domain.quotations import recover_source_quote
from arden_ai.infrastructure.hybrid import HybridRetriever, source_evidence
from arden_ai.presentation.api import create_api


@dataclass
class QuotedGenerator:
    quote: str
    calls: list[GenerationRequest] = field(default_factory=list)
    responses: list[GenerationResponse] = field(default_factory=list)
    changes: dict[str, object] = field(default_factory=dict)

    async def contextualize(self, query: str, history: list[DialogueTurn]) -> str:
        return query

    async def generate_grounded(self, value: GenerationRequest) -> GenerationResponse:
        self.calls.append(value)
        response = GenerationResponse.model_validate(
            {
                "requestId": str(value.request_id),
                "status": "ANSWERED",
                "answer": "Supported answer.",
                "citations": [{"chunkId": value.evidence[0].chunk_id, "quote": self.quote}],
                "usedEvidence": [chunk.chunk_id for chunk in value.evidence],
                **self.changes,
            }
        )
        self.responses.append(response)
        return response


def with_source(text: str) -> GenerationRequest:
    return GenerationRequest.model_validate(
        {
            **generation().model_dump(by_alias=True),
            "evidence": [source_evidence(document(text), request()).model_dump(by_alias=True)],
        }
    )


def test_pdf_wrap_is_restored_to_original_source_before_delivery() -> None:
    raw = "🔐 Quyền đọc:\n Chỉ\u00a0người được\n   duyệt mới xem được."
    value = with_source(raw)
    quote = "Chỉ người được duyệt mới xem được."
    generator = QuotedGenerator(quote)
    result = asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert result.citations[0].quote == "Chỉ\u00a0người được\n   duyệt mới xem được."
    assert result.citations[0].quote in value.evidence[0].content
    assert result.used_evidence == [value.evidence[0].chunk_id]
    assert generator.calls == [value]
    assert generator.responses[0].citations[0].quote == quote
    assert value.evidence[0].content == raw


@pytest.mark.parametrize(
    "source,quote,expected",
    [
        ("Before. MFA is required. After.", "MFA is required.", "MFA is required."),
        (
            "Readers\r\n  must\tbe approved.",
            "Readers must be approved.",
            "Readers\r\n  must\tbe approved.",
        ),
        (
            "🔐 Chỉ\u00a0người\n được duyệt.",
            "Chỉ người được duyệt.",
            "Chỉ\u00a0người\n được duyệt.",
        ),
        ("First A B. Second A\nB.", "A B.", "A B."),
        ("Keep prefix and suffix.", "  prefix\n and  ", "prefix and"),
    ],
)
def test_recovery_preserves_original_characters(source: str, quote: str, expected: str) -> None:
    result = recover_source_quote(quote, source)
    assert result == expected and result in source


@pytest.mark.parametrize(
    "source,quote",
    [
        ("MFA is required.", ""),
        ("MFA is required.", "  \n\t"),
        ("", "MFA"),
        ("Access is not permitted.", "Access is permitted."),
        ("MFA is required.", "mfa is required."),
        ("MFA is required.", "MFA is required!"),
        ("First rule. Omitted condition. Last rule.", "First rule. Last rule."),
        ("A B; A\nB", "A\tB"),
        ("MFA. MFA.", "MFA."),
        ("aaaa", "aaa"),
        ("Co-operate.", "Cooperate."),
        ("Re\u200bquired.", "Required."),
        ("Quyền đọc.", "Quye\u0302\u0300n đọc."),
    ],
)
def test_recovery_rejects_fuzzy_disjoint_and_ambiguous_quotes(source: str, quote: str) -> None:
    with pytest.raises(ValueError, match="exact source"):
        recover_source_quote(quote, source)


def test_http_returns_raw_span_and_original_identity_for_core_validation() -> None:
    raw = "🔐 Readers\n   must be approved."
    value = with_source(raw)
    generator = QuotedGenerator("Readers must be approved.")
    app = create_api(
        service_token=SecretStr("test-only"),
        governed=GovernedAnswerer(HybridRetriever(Search()), generator),
    )
    with TestClient(app) as client:
        result = client.post(
            "/v2/generations",
            headers={"Authorization": "Bearer test-only"},
            json=value.model_dump(mode="json", by_alias=True),
        )
    assert result.status_code == 200
    output = result.json()
    assert output["requestId"] == str(value.request_id)
    assert output["usedEvidence"] == [value.evidence[0].chunk_id]
    assert output["citations"][0] == {
        "chunkId": value.evidence[0].chunk_id,
        "quote": "Readers\n   must be approved.",
    }
    start = raw.index(output["citations"][0]["quote"])
    assert start == len("🔐 ")  # codepoints, not UTF-16 offsets


@pytest.mark.parametrize(
    "raw,quote",
    [
        ("Approved only. Not approved.", "Approved. Not approved."),
        ("A B. A\nB.", "A\tB."),
        ("Start" + " " * 1200 + "end", "Start end"),
    ],
)
def test_failed_or_oversize_recovery_preserves_the_bounded_retry(raw: str, quote: str) -> None:
    value = with_source(raw)
    generator = QuotedGenerator(quote)
    with pytest.raises(ValueError):
        asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert generator.calls == [value, value]


@pytest.mark.parametrize(
    "changes",
    [
        {"requestId": "10000000-0000-4000-8000-000000000005"},
        {
            "usedEvidence": ["b" * 64],
            "citations": [{"chunkId": "b" * 64, "quote": "Readers approved."}],
        },
    ],
)
def test_alignment_never_repairs_response_identity_or_used_scope(
    changes: dict[str, object],
) -> None:
    value = with_source("Readers\n approved.")
    generator = QuotedGenerator("Readers approved.", changes=changes)
    with pytest.raises(ValueError, match="input identity"):
        asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert generator.calls == [value, value]


def test_quote_is_never_rescued_from_a_different_chunk() -> None:
    value = with_source("First source requires review.")
    other = source_evidence(document("Second source allows reading.", "c" * 64), request())
    value = GenerationRequest.model_validate(
        {
            **value.model_dump(by_alias=True),
            "evidence": [
                value.evidence[0].model_dump(by_alias=True),
                other.model_dump(by_alias=True),
            ],
        }
    )
    generator = QuotedGenerator("Second source allows reading.")
    with pytest.raises(ValueError, match="exact source"):
        asyncio.run(GovernedAnswerer(HybridRetriever(Search()), generator).generate(value))
    assert generator.calls == [value, value]
