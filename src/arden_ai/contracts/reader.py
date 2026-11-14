"""Additive, provider-free exact-version source preparation contract."""

import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import (
    ChunkManifestEntry,
    ContractModel,
    IndexGenerationRequest,
    Sha256,
)
from arden_ai.domain.semantic_document import BlockId

MAX_READER_MARKDOWN = 200_000
MAX_READER_CHUNKS = 256
MAX_READER_CHUNK_CHARACTERS = 400_000


class ReaderSourceRequest(ContractModel):
    contract_version: Literal[1] = 1
    purpose: Literal["READER_SUMMARY"]
    request_id: UUID
    published_version_id: UUID
    snapshot: IndexGenerationRequest


class ReaderChunk(ChunkManifestEntry):
    ordinal: int = Field(ge=0, strict=True)
    start_offset: int = Field(ge=0, strict=True)
    end_offset: int = Field(gt=0, strict=True)
    content: Annotated[str, Field(min_length=1, max_length=16_000)]
    source_block_ids: Annotated[list[BlockId], Field(min_length=1, max_length=100)]
    parent_section_block_id: BlockId | None

    @model_validator(mode="after")
    def validate_content(self) -> "ReaderChunk":
        if self.end_offset - self.start_offset != len(self.content):
            raise ValueError("reader chunk offsets do not match content")
        if hashlib.sha256(self.content.encode()).hexdigest() != self.content_hash:
            raise ValueError("reader chunk hash mismatch")
        return self


class ReaderSourceResponse(ContractModel):
    contract_version: Literal[1] = 1
    purpose: Literal["READER_SUMMARY"]
    request_id: UUID
    organization_id: UUID
    published_version_id: UUID
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    compiler_version: Annotated[str, Field(min_length=1, max_length=200)]
    chunking_version: Annotated[str, Field(min_length=1, max_length=200)]
    markdown_content_hash: Sha256
    chunks_digest: Sha256
    markdown: Annotated[str, Field(min_length=1, max_length=MAX_READER_MARKDOWN)]
    chunks: Annotated[list[ReaderChunk], Field(min_length=1, max_length=MAX_READER_CHUNKS)]

    @model_validator(mode="after")
    def validate_source(self) -> "ReaderSourceResponse":
        if hashlib.sha256(self.markdown.encode()).hexdigest() != self.markdown_content_hash:
            raise ValueError("reader canonical text hash mismatch")
        if sum(len(chunk.content) for chunk in self.chunks) > MAX_READER_CHUNK_CHARACTERS:
            raise ValueError("reader source exceeds its overlap budget")
        if len({chunk.chunk_id for chunk in self.chunks}) != len(self.chunks):
            raise ValueError("duplicate reader chunk")
        for ordinal, chunk in enumerate(self.chunks):
            if (
                chunk.ordinal != ordinal
                or self.markdown[chunk.start_offset : chunk.end_offset] != chunk.content
            ):
                raise ValueError("reader chunks do not match ordered canonical spans")
        inventory = [chunk.model_dump(by_alias=True, exclude={"content"}) for chunk in self.chunks]
        digest = hashlib.sha256(
            json.dumps(inventory, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        if digest != self.chunks_digest:
            raise ValueError("reader chunk inventory digest mismatch")
        return self
