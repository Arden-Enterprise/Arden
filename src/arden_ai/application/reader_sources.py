"""Pure source preparation: no store, provider credentials or model required."""

import hashlib
import json

from arden_ai.application.indexing import prepare_generation
from arden_ai.contracts.reader import ReaderSourceRequest, ReaderSourceResponse
from arden_ai.domain.chunking import CHUNKING_VERSION


def prepare_reader_source(request: ReaderSourceRequest) -> ReaderSourceResponse:
    prepared = prepare_generation(request.snapshot)
    inventory = [
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
    digest = hashlib.sha256(
        json.dumps(inventory, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    return ReaderSourceResponse.model_validate(
        {
            "contractVersion": 1,
            "purpose": request.purpose,
            "requestId": str(request.request_id),
            "organizationId": str(request.snapshot.organization_id),
            "publishedVersionId": str(request.published_version_id),
            "generationId": str(request.snapshot.generation_id),
            "snapshotVersionId": str(request.snapshot.snapshot_version_id),
            "snapshotContentHash": request.snapshot.snapshot_content_hash,
            "compilerVersion": prepared.compiled.compiler_version,
            "chunkingVersion": CHUNKING_VERSION,
            "markdownContentHash": prepared.compiled.content_hash,
            "chunksDigest": digest,
            "markdown": prepared.compiled.markdown,
            "chunks": [
                {**entry, "content": chunk.text}
                for entry, chunk in zip(inventory, prepared.chunks, strict=True)
            ],
        }
    )
