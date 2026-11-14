import asyncio
import json
from uuid import uuid4

import chromadb
import pytest
from chromadb.config import Settings as ChromaSettings
from langchain_chroma import Chroma
from langchain_core.embeddings import DeterministicFakeEmbedding
from pydantic import SecretStr
from test_governed import GEN, ORG, document, generation, request

from arden_ai.infrastructure import answering
from arden_ai.infrastructure.hybrid import HybridRetriever, bounded_context, source_evidence
from arden_ai.infrastructure.settings import Settings


@pytest.mark.parametrize("purpose", ["PUBLISHED_CHAT", "READER_QUESTION"])
def test_actual_chroma_filters_dense_and_lexical_before_ranking(monkeypatch, purpose):  # type: ignore[no-untyped-def]
    """Disposable in-process Chroma, deterministic fake embeddings; not a relevance benchmark."""
    client = chromadb.EphemeralClient(settings=ChromaSettings(anonymized_telemetry=False))
    name = "qa-governed-" + uuid4().hex
    embedding = DeterministicFakeEmbedding(size=16)
    store = Chroma(collection_name=name, client=client, embedding_function=embedding)
    try:
        allowed = document()
        denied_generation = document("MFA secret text.", "c" * 64)
        denied_generation.metadata["generation_id"] = str(uuid4())
        denied_tenant = document("MFA private tenant text.", "d" * 64)
        denied_tenant.metadata["organization_id"] = str(uuid4())
        store.add_documents([allowed, denied_generation, denied_tenant])
        monkeypatch.setattr(answering, "Chroma", lambda **_kwargs: store)
        monkeypatch.setattr(answering, "OpenAIEmbeddings", lambda **_kwargs: embedding)
        adapter = answering.ChromaPermissionAwareRetriever(
            Settings(openai_api_key=SecretStr("test-only"))
        )
        found, mode = asyncio.run(
            HybridRetriever(adapter).retrieve(request(purpose=purpose), "MFA")
        )
        assert mode == "HYBRID" and [chunk.chunk_id for chunk in found] == ["a" * 64]
        assert found[0].generation_id == GEN
        # Both API methods execute actual vendor filters, including lexical get().
        dense_request = answering.AnswerRequest.model_validate(
            {
                "requestId": str(uuid4()),
                "organizationId": str(ORG),
                "query": "MFA",
                "allowedGenerationIds": [str(GEN)],
            }
        )
        assert len(asyncio.run(adapter.permitted_documents(dense_request, 100))) == 1
        assert len(asyncio.run(adapter.search_documents(dense_request, 24))) == 1
    finally:
        client.delete_collection(name)


def test_provider_disables_hosted_state_and_resolves_temporary_citation_ids(monkeypatch):  # type: ignore[no-untyped-def]
    options: dict[str, object] = {}
    captured: list[object] = []

    class Model:
        def __init__(self, **kwargs):  # type: ignore[no-untyped-def]
            options.update(kwargs)

        def with_structured_output(self, schema, **kwargs):  # type: ignore[no-untyped-def]
            assert kwargs == {"method": "json_schema", "strict": True}

            class Runnable:
                async def ainvoke(self, messages):  # type: ignore[no-untyped-def]
                    captured.extend(messages)
                    return schema.model_validate(
                        {
                            "status": "ANSWERED",
                            "answer": "MFA is required.",
                            "citations": [{"evidence_id": "E1", "quote": "MFA is required."}],
                        }
                    )

            return Runnable()

    monkeypatch.setattr(answering, "ChatOpenAI", Model)
    provider = answering.OpenAIGroundedAnswerGenerator(
        Settings(
            openai_api_key=SecretStr("test-only"),
            openai_chat_model="gpt-6-luna",
            openai_reasoning_effort="high",
        )
    )
    response = asyncio.run(provider.generate_grounded(generation()))
    assert options["store"] is False and options["use_responses_api"] is True
    assert options["model"] == "gpt-6-luna" and options["reasoning"] == {"effort": "high"}
    assert response.citations[0].chunk_id == "a" * 64
    payload = json.loads(captured[1].content)
    assert payload["evidence"][0]["id"] == "E1"
    assert "chunkId" not in payload["evidence"][0]
    assert "untrusted" in captured[0].content


def test_neighbor_expansion_stays_in_exact_source_section_and_budget() -> None:
    seed = source_evidence(document(), request())
    neighbor = seed.model_copy(
        update={
            "chunk_id": "e" * 64,
            "start_offset": seed.end_offset,
            "end_offset": seed.end_offset + len(seed.content),
        }
    )
    wrong_source = neighbor.model_copy(update={"chunk_id": "f" * 64, "generation_id": uuid4()})
    wrong_section = neighbor.model_copy(
        update={"chunk_id": "1" * 64, "parent_section_block_id": "other"}
    )
    found = bounded_context(
        [seed.chunk_id],
        {chunk.chunk_id: chunk for chunk in [seed, neighbor, wrong_source, wrong_section]},
    )
    assert [chunk.chunk_id for chunk in found] == [seed.chunk_id, neighbor.chunk_id]
    oversized = [
        seed.model_copy(update={"chunk_id": str(index) * 64, "content": "x" * 16000})
        for index in range(8)
    ]
    found = bounded_context(
        [chunk.chunk_id for chunk in oversized], {chunk.chunk_id: chunk for chunk in oversized}
    )
    assert len(found) <= 8 and sum(len(chunk.content) for chunk in found) <= 64000
