import hashlib
import json

from arden_ai.contracts import (
    IndexGenerationManifest,
    IndexGenerationRequest,
)
from arden_ai.domain.compiler import COMPILER_VERSION
from arden_ai.pipeline.chunking import CHUNKING_VERSION
from arden_ai.pipeline.ports import CandidateGenerationStore
from arden_ai.pipeline.preparation import prepare_generation


class GenerationIndexer:
    def __init__(self, store: CandidateGenerationStore) -> None:
        self._store = store

    async def index(self, request: IndexGenerationRequest) -> IndexGenerationManifest:
        prepared = prepare_generation(request)
        await self._store.replace_candidate(request, prepared)

        chunks_payload = [
            {
                "chunkId": chunk.chunk_id,
                "ordinal": chunk.ordinal,
                "contentHash": chunk.content_hash,
                "startOffset": chunk.start_offset,
                "endOffset": chunk.end_offset,
                "sourceBlockIds": list(chunk.source_block_ids),
                "parentSectionBlockId": chunk.parent_section_block_id,
            }
            for chunk in prepared.chunks
        ]
        chunks_digest = hashlib.sha256(
            json.dumps(chunks_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()

        return IndexGenerationManifest.model_validate(
            {
                "contractVersion": 1,
                "jobId": str(request.job_id),
                "generationId": str(request.generation_id),
                "snapshotVersionId": str(request.snapshot_version_id),
                "snapshotContentHash": request.snapshot_content_hash,
                "compilerVersion": COMPILER_VERSION,
                "chunkingVersion": CHUNKING_VERSION,
                "embeddingModel": self._store.embedding_model,
                "embeddingDimensions": self._store.embedding_dimensions,
                "markdownContentHash": prepared.compiled.content_hash,
                "chunksDigest": chunks_digest,
                "chunks": chunks_payload,
            }
        )

