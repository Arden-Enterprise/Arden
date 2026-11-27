from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import CONTRACT_VERSION, ContractModel, Sha256


class AnswerRequest(ContractModel):
    contract_version: Literal[1] = Field(default=CONTRACT_VERSION, frozen=True)
    request_id: UUID
    organization_id: UUID
    query: Annotated[str, Field(min_length=1, max_length=4_000)]
    allowed_generation_ids: Annotated[list[UUID], Field(min_length=1, max_length=500)]

    @model_validator(mode="after")
    def validate_generation_ids(self) -> "AnswerRequest":
        if len(set(self.allowed_generation_ids)) != len(self.allowed_generation_ids):
            raise ValueError("allowedGenerationIds must not contain duplicates")
        return self


class AnswerCitation(ContractModel):
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    chunk_id: Sha256
    source_block_ids: Annotated[list[str], Field(min_length=1, max_length=100)]
    parent_section_block_id: str | None
    excerpt: Annotated[str, Field(min_length=1, max_length=1_200)]


class AnswerResponse(ContractModel):
    contract_version: Literal[1] = Field(default=CONTRACT_VERSION, frozen=True)
    request_id: UUID
    status: Literal["ANSWERED", "INSUFFICIENT_EVIDENCE"]
    answer: Annotated[str, Field(min_length=1, max_length=12_000)]
    citations: Annotated[list[AnswerCitation], Field(max_length=12)]

    @model_validator(mode="after")
    def validate_answer(self) -> "AnswerResponse":
        if self.status == "ANSWERED" and not self.citations:
            raise ValueError("an answered response must cite retrieved evidence")
        if self.status == "INSUFFICIENT_EVIDENCE" and self.citations:
            raise ValueError("an insufficient-evidence response cannot contain citations")
        return self
