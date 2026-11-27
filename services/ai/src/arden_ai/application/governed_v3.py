"""Application orchestration for additive v3 grounded generation with UiSurface drafts."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from pydantic import ValidationError

from arden_ai.contracts.governed_v3 import (
    AiSurfaceDraft,
    GenerationV3Request,
    GenerationV3Response,
    UiSurfaceStatus,
)
from arden_ai.domain.quotations import recover_source_quote
from arden_ai.domain.ui_surface import SurfaceValidationError, validate_ai_surface_draft

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RawGenerationV3Result:
    request_id: UUID
    status: Literal["ANSWERED", "INSUFFICIENT_EVIDENCE"]
    answer: str
    citations: list[dict[str, str]]
    used_evidence: list[str]
    raw_ui_surface: object | None = None
    surface_parse_failed: bool = False


class GovernedV3Generator(Protocol):
    async def generate_grounded_v3(
        self, request: GenerationV3Request
    ) -> RawGenerationV3Result: ...


class GovernedV3Answerer:
    """Grounded v3 generator with non-failing UiSurface validation and stripping."""

    def __init__(self, generator: GovernedV3Generator) -> None:
        self._generator = generator

    async def generate_v3(self, request: GenerationV3Request) -> GenerationV3Response:
        expected = {chunk.chunk_id for chunk in request.evidence}
        by_id = {chunk.chunk_id: chunk for chunk in request.evidence}

        # One bounded repair attempt for core answer/citation grounding errors only.
        for attempt in range(2):
            try:
                raw = await self._generator.generate_grounded_v3(request)
                if (
                    raw.request_id != request.request_id
                    or len(raw.used_evidence) != len(expected)
                    or set(raw.used_evidence) != expected
                ):
                    raise ValueError("generation input identity mismatch")
                citations = [
                    {
                        "chunkId": citation["chunkId"],
                        "quote": recover_source_quote(
                            citation["quote"], by_id[citation["chunkId"]].content
                        ),
                    }
                    for citation in raw.citations
                ]
                if (raw.status == "ANSWERED") != bool(citations):
                    raise ValueError("answer status and citations disagree")
                break
            except (ValueError, KeyError):
                if attempt:
                    raise
        else:  # pragma: no cover
            raise RuntimeError("unreachable generation retry")

        # Surface validation is strictly isolated: invalid surfaces never fail or retry text output.
        ui_surface: AiSurfaceDraft | None = None
        ui_surface_status: UiSurfaceStatus
        if raw.status == "INSUFFICIENT_EVIDENCE":
            ui_surface_status = "OMITTED_INSUFFICIENT"
        elif request.ui_surface_mode == "DISABLED":
            ui_surface_status = "DISABLED"
        elif raw.surface_parse_failed or raw.raw_ui_surface is None:
            ui_surface_status = "OMITTED_INVALID"
        else:
            try:
                draft = AiSurfaceDraft.model_validate(raw.raw_ui_surface)
                validate_ai_surface_draft(
                    draft,
                    catalog=request.source_catalog,
                    citation_count=len(citations),
                )
                ui_surface = draft
                ui_surface_status = "GENERATED"
            except (ValidationError, SurfaceValidationError, ValueError) as error:
                logger.warning(
                    json.dumps(
                        {
                            "event": "ui_surface_omitted_invalid",
                            "requestId": str(request.request_id),
                            "errorType": type(error).__name__,
                        }
                    )
                )
                ui_surface = None
                ui_surface_status = "OMITTED_INVALID"

        return GenerationV3Response.model_validate(
            {
                "contractVersion": 3,
                "requestId": str(request.request_id),
                "status": raw.status,
                "answer": raw.answer,
                "citations": citations,
                "usedEvidence": raw.used_evidence,
                "uiSurface": (
                    ui_surface.model_dump(mode="json", by_alias=True)
                    if ui_surface is not None
                    else None
                ),
                "uiSurfaceStatus": ui_surface_status,
            }
        )
