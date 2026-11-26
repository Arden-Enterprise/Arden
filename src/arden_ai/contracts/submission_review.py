"""Internal review of one exact, pending submission snapshot."""

import base64
import binascii
import hashlib
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import ContractModel, Sha256

CheckCategory = Literal["CLARITY", "CONSISTENCY", "MISSING_CONTEXT", "SENSITIVE_CONTENT"]


class SubmissionReviewRequest(ContractModel):
    contract_version: Literal[1] = 1
    request_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    mime_type: Literal["text/plain", "application/pdf"]
    content: Annotated[str, Field(min_length=1, max_length=1_500_000)] | None = None
    pdf_base64: Annotated[str, Field(min_length=1, max_length=16_000_000)] | None = None

    def source_bytes(self) -> bytes:
        if self.mime_type == "text/plain" and self.content is not None and self.pdf_base64 is None:
            return self.content.encode("utf-8")
        if (
            self.mime_type != "application/pdf"
            or self.content is not None
            or self.pdf_base64 is None
        ):
            raise ValueError("incompatible review source")
        try:
            data = base64.b64decode(self.pdf_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("invalid PDF encoding") from error
        if not data.startswith(b"%PDF-") or len(data) > 12_000_000:
            raise ValueError("invalid PDF snapshot")
        return data

    @model_validator(mode="after")
    def verify_snapshot(self) -> "SubmissionReviewRequest":
        if hashlib.sha256(self.source_bytes()).hexdigest() != self.snapshot_content_hash:
            raise ValueError("snapshot hash mismatch")
        return self


class ReviewCitation(ContractModel):
    excerpt: Annotated[str, Field(min_length=1, max_length=360)]
    page: Annotated[int, Field(ge=1, le=500, strict=True)] | None


class ReviewPoint(ContractModel):
    text: Annotated[str, Field(min_length=1, max_length=240)]
    citation: ReviewCitation


class ReviewCheck(ReviewPoint):
    category: CheckCategory


class SubmissionReviewResponse(ContractModel):
    contract_version: Literal[1] = 1
    request_id: UUID
    snapshot_version_id: UUID
    snapshot_content_hash: Sha256
    summary: Annotated[list[ReviewPoint], Field(min_length=1, max_length=3)]
    checks: Annotated[list[ReviewCheck], Field(max_length=3)]
