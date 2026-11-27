"""Prepare bounded passages and resolve model-selected citations."""

import asyncio
import logging
import time
from collections.abc import Iterator
from typing import Annotated, Protocol

from pydantic import BaseModel, ConfigDict, Field

from arden_ai.contracts.submission_review import (
    MAX_REVIEW_CITATIONS,
    CheckCategory,
    ReviewCitation,
    SubmissionReviewRequest,
    SubmissionReviewRequestV2,
    SubmissionReviewResponse,
    SubmissionReviewResponseV2,
)
from arden_ai.domain.pdf import compile_pdf
from arden_ai.domain.semantic_document import (
    ARDEN_DOCUMENT_PREFIX,
    AssetBlock,
    Inline,
    SemanticBlock,
    TableBlock,
    TextRun,
    parse_semantic_document,
)

MAX_REVIEW_TEXT = 32_000
PASSAGE_LENGTH = 360
logger = logging.getLogger(__name__)


class UnsupportedSubmission(ValueError):
    pass


class InvalidSubmissionReview(ValueError):
    pass


class ModelPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=240)]
    source_ids: Annotated[
        list[Annotated[str, Field(pattern=r"^S[1-9][0-9]{0,4}$")]],
        Field(min_length=1, max_length=MAX_REVIEW_CITATIONS),
    ]


class ModelCheck(ModelPoint):
    category: CheckCategory


class ModelReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: Annotated[list[ModelPoint], Field(min_length=1, max_length=3)]
    checks: Annotated[list[ModelCheck], Field(max_length=3)]


class SubmissionReviewProvider(Protocol):
    async def generate(
        self, passages: dict[str, ReviewCitation], max_sources: int,
    ) -> ModelReview: ...


def _visible_inlines(inlines: list[Inline]) -> str:
    return "".join(
        item.text if isinstance(item, TextRun) else "".join(run.text for run in item.content)
        for item in inlines
    )


def _visible_blocks(blocks: list[SemanticBlock]) -> Iterator[str]:
    for block in blocks:
        if isinstance(block, TableBlock):
            for row in block.content:
                yield " | ".join(_visible_inlines(cell) for cell in row.cells)
        elif not isinstance(block, AssetBlock):
            yield _visible_inlines(list(block.content))
        yield from _visible_blocks(block.children)


def _review_passages(
    request: SubmissionReviewRequest | SubmissionReviewRequestV2,
) -> dict[str, ReviewCitation]:
    sections: list[tuple[int | None, str]]
    try:
        if request.content is None:
            compiled = compile_pdf(request.source_bytes())
            sections = [
                (int(span.block_id.removeprefix("pdf-page-")),
                 compiled.markdown[span.start_offset : span.end_offset])
                for span in compiled.source_map if span.block_type == "paragraph"
            ]
        elif request.content.startswith(ARDEN_DOCUMENT_PREFIX):
            document = parse_semantic_document(request.content)
            sections = [(None, "\n\n".join(_visible_blocks(document.blocks)))]
        else:
            sections = [(None, request.content)]
    except ValueError as error:
        raise UnsupportedSubmission("source could not be extracted") from error
    if sum(len(text) for _, text in sections) > MAX_REVIEW_TEXT:
        raise UnsupportedSubmission("source exceeds the review text limit")

    passages: dict[str, ReviewCitation] = {}
    for page, text in sections:
        start = 0
        while start < len(text):
            end = min(start + PASSAGE_LENGTH, len(text))
            if end < len(text):
                split = text.rfind("\n", end - 90, end)
                if split < start:
                    split = text.rfind(" ", end - 90, end)
                if split >= start:
                    end = split + 1
            excerpt = text[start:end].strip()
            if excerpt:
                passages[f"S{len(passages) + 1}"] = ReviewCitation.model_validate(
                    {"excerpt": excerpt, "page": page}
                )
            start = end
    if not passages:
        raise UnsupportedSubmission("source contains no usable text")
    return passages


class SubmissionReviewer:
    def __init__(self, provider: SubmissionReviewProvider) -> None:
        self._provider = provider

    async def run(
        self, request: SubmissionReviewRequest | SubmissionReviewRequestV2,
    ) -> SubmissionReviewResponse | SubmissionReviewResponseV2:
        started = time.monotonic()
        passages = await asyncio.to_thread(_review_passages, request)
        prepared = time.monotonic()
        multi_source = request.contract_version == 2
        max_sources = MAX_REVIEW_CITATIONS if multi_source else 1
        result = await self._provider.generate(passages, max_sources)
        generated = time.monotonic()

        def cite(point: ModelPoint) -> dict[str, object]:
            ids = point.source_ids
            if (len(ids) > max_sources or len(set(ids)) != len(ids)
                or any(source_id not in passages for source_id in ids) or not point.text.strip()):
                raise InvalidSubmissionReview("unverifiable review point")
            sources = [passages[source_id] for source_id in ids]
            citations = list({(source.page, source.excerpt): source for source in sources}.values())
            return {"text": point.text.strip(), "citation": citations[0],
                    **({"additionalCitations": citations[1:]} if multi_source else {})}

        response = SubmissionReviewResponseV2 if multi_source else SubmissionReviewResponse
        verified = response.model_validate({
            "contractVersion": request.contract_version,
            "requestId": request.request_id,
            "snapshotVersionId": request.snapshot_version_id,
            "snapshotContentHash": request.snapshot_content_hash,
            "summary": [cite(point) for point in result.summary],
            "checks": [{**cite(point), "category": point.category} for point in result.checks],
        })
        logger.info("Submission review completed", extra={
            "operation_id": str(request.request_id),
            "passage_count": len(passages),
            "source_preparation_ms": round((prepared - started) * 1000),
            "inference_ms": round((generated - prepared) * 1000),
        })
        return verified
