import hashlib
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from arden_ai.domain.semantic_document import SemanticDocument, parse_semantic_document

CONTRACT_VERSION: Literal[1] = 1
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        validate_by_alias=True,
        validate_by_name=False,
        extra="forbid",
    )


class IndexGenerationRequest(ContractModel):
    contract_version: Literal[1] = Field(default=CONTRACT_VERSION, frozen=True)
    job_id: UUID
    organization_id: UUID
    submission_id: UUID
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    snapshot_content: Annotated[str, Field(min_length=1, max_length=1_500_000)]

    @model_validator(mode="after")
    def validate_snapshot(self) -> "IndexGenerationRequest":
        digest = hashlib.sha256(self.snapshot_content.encode("utf-8")).hexdigest()
        if digest != self.snapshot_content_hash:
            raise ValueError("snapshotContentHash does not match snapshotContent")
        parse_semantic_document(self.snapshot_content)
        return self

    def semantic_document(self) -> SemanticDocument:
        return parse_semantic_document(self.snapshot_content)


class ChunkManifestEntry(ContractModel):
    chunk_id: Sha256
    ordinal: int = Field(ge=0)
    content_hash: Sha256
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    source_block_ids: Annotated[list[str], Field(min_length=1)]
    parent_section_block_id: str | None

    @model_validator(mode="after")
    def validate_offsets(self) -> "ChunkManifestEntry":
        if self.end_offset <= self.start_offset:
            raise ValueError("endOffset must be greater than startOffset")
        return self


class IndexGenerationManifest(ContractModel):
    contract_version: Literal[1] = Field(default=CONTRACT_VERSION, frozen=True)
    job_id: UUID
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    compiler_version: str
    chunking_version: str
    embedding_model: str
    embedding_dimensions: int = Field(gt=0)
    markdown_content_hash: Sha256
    chunks_digest: Sha256
    chunks: Annotated[list[ChunkManifestEntry], Field(min_length=1)]

