import json
from contextlib import suppress
from urllib.parse import urlsplit

from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

from arden_ai.application import PreparedGeneration
from arden_ai.contracts import IndexGenerationRequest
from arden_ai.domain.chunking import CHUNKING_VERSION, PreparedChunk
from arden_ai.domain.compiler import COMPILER_VERSION
from arden_ai.infrastructure.settings import Settings


def _chroma_endpoint(url: str) -> tuple[str, int, bool]:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("ARDEN_AI_CHROMA_URL must be an http(s) server URL")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username:
        raise ValueError(
            "ARDEN_AI_CHROMA_URL must not include credentials, path, query, or fragment"
        )
    return (
        parsed.hostname,
        parsed.port or (443 if parsed.scheme == "https" else 80),
        parsed.scheme == "https",
    )


def _chunk_metadata(
    request: IndexGenerationRequest, chunk: PreparedChunk
) -> dict[str, str | int]:
    return {
        "organization_id": str(request.organization_id),
        "submission_id": str(request.submission_id),
        "generation_id": str(request.generation_id),
        "snapshot_version_id": str(request.snapshot_version_id),
        "snapshot_content_hash": request.snapshot_content_hash,
        "chunk_ordinal": chunk.ordinal,
        "chunk_content_hash": chunk.content_hash,
        "token_count": chunk.token_count,
        "start_offset": chunk.start_offset,
        "end_offset": chunk.end_offset,
        "source_block_ids_json": json.dumps(chunk.source_block_ids, separators=(",", ":")),
        "parent_section_block_id": chunk.parent_section_block_id or "",
        "heading_path_json": json.dumps(
            chunk.heading_path, ensure_ascii=False, separators=(",", ":")
        ),
        "compiler_version": COMPILER_VERSION,
        "chunking_version": CHUNKING_VERSION,
    }


class ChromaCandidateGenerationStore:
    def __init__(self, settings: Settings) -> None:
        if settings.openai_api_key is None:
            raise ValueError("ARDEN_AI_OPENAI_API_KEY is required for indexing")
        host, port, ssl = _chroma_endpoint(settings.chroma_url)
        embeddings = OpenAIEmbeddings(
            model=settings.openai_embedding_model,
            dimensions=settings.openai_embedding_dimensions,
            api_key=settings.openai_api_key,
            max_retries=4,
            timeout=45,
        )
        self._embedding_model = settings.openai_embedding_model
        self._embedding_dimensions = settings.openai_embedding_dimensions
        self._store = Chroma(
            collection_name=settings.chroma_collection,
            embedding_function=embeddings,
            host=host,
            port=port,
            ssl=ssl,
        )

    @property
    def embedding_model(self) -> str:
        return self._embedding_model

    @property
    def embedding_dimensions(self) -> int:
        return self._embedding_dimensions

    async def replace_candidate(
        self, request: IndexGenerationRequest, prepared: PreparedGeneration
    ) -> None:
        generation_filter = {"generation_id": str(request.generation_id)}
        await self._store.adelete(where=generation_filter)
        try:
            ids = [chunk.chunk_id for chunk in prepared.chunks]
            written = await self._store.aadd_texts(
                texts=[chunk.embedding_text for chunk in prepared.chunks],
                metadatas=[_chunk_metadata(request, chunk) for chunk in prepared.chunks],
                ids=ids,
            )
            if written != ids:
                raise RuntimeError("Chroma did not acknowledge the complete candidate generation")
        except Exception:
            # Arden core never activates a generation without a complete manifest.
            with suppress(Exception):
                await self._store.adelete(where=generation_filter)
            raise
