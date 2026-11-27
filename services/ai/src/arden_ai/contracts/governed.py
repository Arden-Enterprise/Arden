import hashlib
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import ContractModel, Sha256


class DialogueTurn(ContractModel):
    question: Annotated[str, Field(min_length=1, max_length=4_000)]
    answer: Annotated[str, Field(min_length=1, max_length=12_000)]


class SourceHint(ContractModel):
    generation_id: UUID
    label: Annotated[str, Field(max_length=800)]


class RetrievalRequest(ContractModel):
    contract_version: Literal[2] = 2
    purpose: Literal["PUBLISHED_CHAT", "READER_QUESTION"] = "PUBLISHED_CHAT"
    request_id: UUID
    organization_id: UUID
    query: Annotated[str, Field(min_length=1, max_length=4_000)]
    allowed_generation_ids: Annotated[list[UUID], Field(min_length=1, max_length=500)]
    history: Annotated[list[DialogueTurn], Field(max_length=4)] = Field(default_factory=list)
    source_hints: Annotated[list[SourceHint], Field(max_length=500)] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_scope(self) -> "RetrievalRequest":
        allowed = set(self.allowed_generation_ids)
        hints = [hint.generation_id for hint in self.source_hints]
        if len(allowed) != len(self.allowed_generation_ids) or len(set(hints)) != len(hints):
            raise ValueError("duplicate source identities")
        if not set(hints).issubset(allowed):
            raise ValueError("source hints exceed the Core allow-list")
        if sum(len(turn.question) + len(turn.answer) for turn in self.history) > 24_000:
            raise ValueError("conversation context exceeds its budget")
        if self.purpose == "READER_QUESTION" and (
            len(allowed) != 1 or self.history or not self.query.strip()
        ):
            raise ValueError("reader questions require one exact source and no history")
        return self


class Evidence(ContractModel):
    generation_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    chunk_id: Sha256
    content_hash: Sha256
    content: Annotated[str, Field(min_length=1, max_length=16_000)]
    start_offset: int = Field(ge=0, strict=True)
    end_offset: int = Field(gt=0, strict=True)
    source_block_ids: Annotated[list[str], Field(min_length=1, max_length=100)]
    parent_section_block_id: str | None
    label: Annotated[str, Field(max_length=800)] = ""

    @model_validator(mode="after")
    def validate_text(self) -> "Evidence":
        if self.parent_section_block_id is not None and (
            not self.parent_section_block_id or len(self.parent_section_block_id) > 200
        ):
            raise ValueError("invalid parent section identity")
        if self.end_offset - self.start_offset != len(self.content):
            raise ValueError("evidence offsets do not match source text")
        if hashlib.sha256(self.content.encode("utf-8")).hexdigest() != self.content_hash:
            raise ValueError("evidence content hash mismatch")
        if any(not block or len(block) > 200 for block in self.source_block_ids):
            raise ValueError("invalid source block identity")
        return self


class RetrievalResponse(ContractModel):
    contract_version: Literal[2] = 2
    request_id: UUID
    standalone_query: Annotated[str, Field(min_length=1, max_length=4_000)]
    retrieval_mode: Literal["HYBRID", "SEMANTIC", "LEXICAL"]
    evidence: Annotated[list[Evidence], Field(max_length=8)]


class GenerationRequest(ContractModel):
    contract_version: Literal[2] = 2
    purpose: Literal["PUBLISHED_CHAT", "READER_QUESTION"] = "PUBLISHED_CHAT"
    request_id: UUID
    organization_id: UUID
    query: Annotated[str, Field(min_length=1, max_length=4_000)]
    history: Annotated[list[DialogueTurn], Field(max_length=4)] = Field(default_factory=list)
    evidence: Annotated[list[Evidence], Field(min_length=1, max_length=8)]

    @model_validator(mode="after")
    def validate_budget(self) -> "GenerationRequest":
        if len({chunk.chunk_id for chunk in self.evidence}) != len(self.evidence):
            raise ValueError("duplicate generation evidence")
        if sum(len(chunk.content) for chunk in self.evidence) > 64_000:
            raise ValueError("evidence exceeds generation budget")
        if sum(len(turn.question) + len(turn.answer) for turn in self.history) > 24_000:
            raise ValueError("history exceeds generation budget")
        if self.purpose == "READER_QUESTION" and (
            self.history or not self.query.strip()
            or len({(chunk.generation_id, chunk.snapshot_version_id, chunk.snapshot_content_hash)
                    for chunk in self.evidence}) != 1
        ):
            raise ValueError("reader generation requires one exact immutable source and no history")
        return self


class EvidenceCitation(ContractModel):
    chunk_id: Sha256
    quote: Annotated[str, Field(min_length=1, max_length=1_200)]


class GenerationResponse(ContractModel):
    contract_version: Literal[2] = 2
    request_id: UUID
    status: Literal["ANSWERED", "INSUFFICIENT_EVIDENCE"]
    answer: Annotated[str, Field(min_length=1, max_length=12_000)]
    citations: Annotated[list[EvidenceCitation], Field(max_length=12)]
    used_evidence: Annotated[list[Sha256], Field(min_length=1, max_length=8)]

    @model_validator(mode="after")
    def validate_status(self) -> "GenerationResponse":
        if (self.status == "ANSWERED") != bool(self.citations):
            raise ValueError("answer status and citations disagree")
        if len(set(self.used_evidence)) != len(self.used_evidence):
            raise ValueError("duplicate used evidence")
        if any(citation.chunk_id not in self.used_evidence for citation in self.citations):
            raise ValueError("citation exceeds the generation input set")
        return self
