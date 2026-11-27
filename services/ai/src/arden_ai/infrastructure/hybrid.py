import asyncio
import json
import logging
import time
from typing import Protocol
from uuid import UUID

from langchain_core.documents import Document

from arden_ai.contracts import AnswerRequest
from arden_ai.contracts.governed import Evidence, RetrievalRequest
from arden_ai.domain.hybrid import bm25_rank, reciprocal_rank_fusion

logger = logging.getLogger(__name__)
MAX_LEXICAL_CHUNKS = 10_000
MAX_LEXICAL_CHARACTERS = 8_000_000


def bounded_context(ranking: list[str], by_id: dict[str, Evidence]) -> list[Evidence]:
    """Reserve at most two slots for nearby text from the exact same source section."""
    selected: list[Evidence] = []
    identities: set[str] = set()
    characters = 0

    def append(chunk: Evidence) -> bool:
        nonlocal characters
        if chunk.chunk_id in identities or characters + len(chunk.content) > 64_000:
            return False
        identities.add(chunk.chunk_id)
        selected.append(chunk)
        characters += len(chunk.content)
        return True

    for identity in ranking[:6]:
        append(by_id[identity])
    expansions = 0
    for seed in list(selected):
        if len(selected) >= 8 or expansions >= 2 or not seed.parent_section_block_id:
            continue
        neighbors = [
            chunk
            for chunk in by_id.values()
            if chunk.chunk_id not in identities
            and chunk.generation_id == seed.generation_id
            and chunk.snapshot_version_id == seed.snapshot_version_id
            and chunk.snapshot_content_hash == seed.snapshot_content_hash
            and chunk.parent_section_block_id == seed.parent_section_block_id
            and min(
                abs(chunk.start_offset - seed.end_offset), abs(seed.start_offset - chunk.end_offset)
            )
            <= 512
        ]
        neighbors.sort(
            key=lambda chunk: (
                min(
                    abs(chunk.start_offset - seed.end_offset),
                    abs(seed.start_offset - chunk.end_offset),
                ),
                chunk.chunk_id,
            )
        )
        if neighbors and append(neighbors[0]):
            expansions += 1
    for identity in ranking:
        if len(selected) >= 8:
            break
        append(by_id[identity])
    return selected


class DocumentSearch(Protocol):
    async def search_documents(self, request: AnswerRequest, limit: int) -> list[Document]: ...
    async def permitted_documents(self, request: AnswerRequest, limit: int) -> list[Document]: ...


def source_evidence(document: Document, request: RetrievalRequest) -> Evidence:
    fields = document.metadata
    if UUID(str(fields.get("organization_id"))) != request.organization_id:
        raise ValueError("retrieval crossed the organization boundary")
    generation_id = UUID(str(fields.get("generation_id")))
    if generation_id not in request.allowed_generation_ids:
        raise ValueError("retrieval crossed the Core generation boundary")
    headings = json.loads(str(fields.get("heading_path_json", "[]")))
    if not isinstance(headings, list) or any(not isinstance(value, str) for value in headings):
        raise ValueError("invalid heading metadata")
    content = document.page_content
    prefix = "Section: " + " > ".join(headings) + "\n\n" if headings else ""
    if prefix:
        if not content.startswith(prefix):
            raise ValueError("indexed breadcrumb does not match its source")
        content = content[len(prefix) :]
    label = next(
        (hint.label for hint in request.source_hints if hint.generation_id == generation_id), ""
    )
    return Evidence.model_validate(
        {
            "generationId": str(generation_id),
            "snapshotVersionId": fields.get("snapshot_version_id"),
            "snapshotContentHash": fields.get("snapshot_content_hash"),
            "chunkId": document.id,
            "contentHash": fields.get("chunk_content_hash"),
            "content": content,
            "startOffset": fields.get("start_offset"),
            "endOffset": fields.get("end_offset"),
            "sourceBlockIds": json.loads(str(fields.get("source_block_ids_json"))),
            "parentSectionBlockId": fields.get("parent_section_block_id") or None,
            "label": label,
        }
    )


class HybridRetriever:
    def __init__(self, search: DocumentSearch) -> None:
        self._search = search

    async def retrieve(self, request: RetrievalRequest, query: str) -> tuple[list[Evidence], str]:
        started = time.monotonic()
        search_request = AnswerRequest.model_validate(
            {
                "requestId": str(request.request_id),
                "organizationId": str(request.organization_id),
                "query": query,
                "allowedGenerationIds": [str(value) for value in request.allowed_generation_ids],
            }
        )
        dense, lexical = await asyncio.gather(
            self._search.search_documents(search_request, 24),
            self._search.permitted_documents(search_request, MAX_LEXICAL_CHUNKS + 1),
            return_exceptions=True,
        )
        # Boundary/validation errors never become a seemingly successful degraded search.
        for result in (dense, lexical):
            if isinstance(result, (ValueError, TypeError, KeyError)):
                raise result
        if isinstance(dense, BaseException) and isinstance(lexical, BaseException):
            raise RuntimeError("both authorized retrieval branches failed")
        lexical_documents = [] if isinstance(lexical, BaseException) else lexical
        if (
            len(lexical_documents) > MAX_LEXICAL_CHUNKS
            or sum(len(document.page_content) for document in lexical_documents)
            > MAX_LEXICAL_CHARACTERS
        ):
            raise ValueError("authorized lexical corpus exceeds its bounded search budget")
        dense_evidence = (
            []
            if isinstance(dense, BaseException)
            else [source_evidence(document, request) for document in dense]
        )
        lexical_evidence = [source_evidence(document, request) for document in lexical_documents]
        by_id: dict[str, Evidence] = {}
        for chunk in [*lexical_evidence, *dense_evidence]:
            previous = by_id.get(chunk.chunk_id)
            if previous is not None and previous != chunk:
                raise ValueError("conflicting retrieved chunk identity")
            by_id[chunk.chunk_id] = chunk
        if len({chunk.chunk_id for chunk in lexical_evidence}) != len(lexical_evidence):
            raise ValueError("duplicate lexical chunk identity")
        lexical_ranking = await asyncio.to_thread(
            bm25_rank,
            query,
            [(chunk.chunk_id, chunk.label + "\n" + chunk.content) for chunk in lexical_evidence],
            24,
        )
        ranking = reciprocal_rank_fusion(
            [[chunk.chunk_id for chunk in dense_evidence], lexical_ranking], 48
        )
        selected = bounded_context(ranking, by_id)
        mode = (
            "LEXICAL"
            if isinstance(dense, BaseException)
            else ("SEMANTIC" if isinstance(lexical, BaseException) else "HYBRID")
        )
        logger.info(
            "Authorized retrieval completed",
            extra={
                "request_id": str(request.request_id),
                "mode": mode,
                "evidence_count": len(selected),
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
        return selected, mode
