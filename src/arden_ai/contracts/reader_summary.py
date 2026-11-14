"""Additive exact-version Summary result; source remains the RA-02 contract."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from arden_ai.contracts.indexing import ContractModel, Sha256

PointKind = Literal["KEY_POINT", "STEP", "CONDITION", "EXCEPTION"]


class SummaryCitation(ContractModel):
    chunk_id: Annotated[str, Field(min_length=1, max_length=200)]
    quote: Annotated[str, Field(min_length=1, max_length=1_200)]


class SummaryPoint(ContractModel):
    kind: PointKind
    text: Annotated[str, Field(min_length=1, max_length=350)]
    citations: Annotated[list[SummaryCitation], Field(min_length=1, max_length=2)]


class SummaryRange(ContractModel):
    start_offset: int = Field(ge=0, strict=True)
    end_offset: int = Field(gt=0, strict=True)


class ReaderSummaryResponse(ContractModel):
    contract_version: Literal[1] = 1
    purpose: Literal["READER_SUMMARY"]
    request_id: UUID
    organization_id: UUID
    published_version_id: UUID
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    markdown_content_hash: Sha256
    chunks_digest: Sha256
    status: Literal["COMPLETED"]
    coverage: Annotated[list[SummaryRange], Field(min_length=1, max_length=8)]
    used_chunk_ids: Annotated[list[str], Field(min_length=1, max_length=256)]
    points: Annotated[list[SummaryPoint], Field(min_length=1, max_length=24)]
