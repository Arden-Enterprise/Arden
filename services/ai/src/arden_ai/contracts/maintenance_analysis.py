"""Versioned contracts for bounded maintenance analysis."""

from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from arden_ai.contracts.indexing import ContractModel


class MaintenanceAnalysisRequest(ContractModel):
    contract_version: Literal[1] = 1
    case_id: UUID
    version_ids: Annotated[list[UUID], Field(min_length=1, max_length=4)]


class MaintenanceAnalysisFinding(ContractModel):
    version_id: UUID
    summary: Annotated[str, Field(min_length=1, max_length=350)]


class MaintenanceAnalysisResponse(ContractModel):
    contract_version: Literal[1] = 1
    state: Literal["succeeded"]
    findings: Annotated[list[MaintenanceAnalysisFinding], Field(min_length=1, max_length=4)]


def controlled_maintenance_analysis(
    request: MaintenanceAnalysisRequest,
) -> MaintenanceAnalysisResponse:
    """Return one citation per selected version. This does not call a model provider."""
    return MaintenanceAnalysisResponse(
        state="succeeded",
        findings=[
            MaintenanceAnalysisFinding.model_validate({
                "versionId": version_id,
                "summary": "The selected version was compared through the analysis service.",
            })
            for version_id in request.version_ids
        ],
    )


class MaintenanceEvidence(ContractModel):
    version_id: UUID
    text_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    text: Annotated[str, Field(min_length=1, max_length=8_000)]


class MaintenanceProviderRequest(ContractModel):
    contract_version: Literal[2]
    request_id: UUID | None = None
    case_id: UUID
    sources: Annotated[list[MaintenanceEvidence], Field(min_length=1, max_length=4)]

    @model_validator(mode="after")
    def validate_sources(self) -> "MaintenanceProviderRequest":
        if len({source.version_id for source in self.sources}) != len(self.sources):
            raise ValueError("Evidence versions must be distinct")
        for source in self.sources:
            source_hash = sha256(source.text.encode()).hexdigest()
            if not source.text.strip() or source_hash != source.text_hash:
                raise ValueError("Evidence text does not match its hash")
        return self


class MaintenanceProviderFinding(MaintenanceAnalysisFinding):
    quote: Annotated[str, Field(min_length=1, max_length=240)]


class MaintenanceProviderFindings(ContractModel):
    findings: Annotated[list[MaintenanceProviderFinding], Field(min_length=1, max_length=4)]


class MaintenanceVerifiedFinding(MaintenanceProviderFinding):
    text_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class MaintenanceProviderResponse(ContractModel):
    contract_version: Literal[2]
    state: Literal["succeeded"]
    findings: Annotated[list[MaintenanceVerifiedFinding], Field(min_length=1, max_length=4)]
