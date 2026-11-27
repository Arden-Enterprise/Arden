"""Internal, bounded writing actions. Core remains responsible for user access."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import ContractModel

WritingAction = Literal["IMPROVE", "REFORMAT", "EXPLAIN"]


class WritingRequest(ContractModel):
    contract_version: Literal[1] = 1
    request_id: UUID
    action: WritingAction
    scope: Literal["SELECTION", "PAGE"]
    text: Annotated[str, Field(min_length=1, max_length=12_000)]

    @model_validator(mode="after")
    def nonblank(self) -> "WritingRequest":
        if not self.text.strip():
            raise ValueError("writing text cannot be blank")
        return self


class WritingResponse(ContractModel):
    contract_version: Literal[1] = 1
    request_id: UUID
    action: WritingAction
    status: Literal["CHANGED", "UNCHANGED", "EXPLAINED"]
    text: Annotated[str, Field(min_length=1, max_length=24_000)]
    source_quote: Annotated[str, Field(max_length=300)] = ""
