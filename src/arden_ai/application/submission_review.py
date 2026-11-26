"""Prepare bounded passages and resolve model-selected citations."""

import asyncio
from collections.abc import Iterator
from typing import Annotated, Protocol

from pydantic import BaseModel, ConfigDict, Field

from arden_ai.contracts.submission_review import (
    CheckCategory,
    ReviewCitation,
    SubmissionReviewRequest,
    SubmissionReviewResponse,
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


class UnsupportedSubmission(ValueError):
    pass


class InvalidSubmissionReview(ValueError):
    pass


class ModelPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=240)]
    source_id: Annotated[str, Field(pattern=r"^S[1-9][0-9]{0,4}$")]


class ModelCheck(ModelPoint):
    category: CheckCategory


class ModelReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: Annotated[list[ModelPoint], Field(min_length=1, max_length=3)]
    checks: Annotated[list[ModelCheck], Field(max_length=3)]


class SubmissionReviewProvider(Protocol):
    async def generate(self, passages: dict[str, ReviewCitation]) -> ModelReview: ...


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


def _review_passages(request: SubmissionReviewRequest) -> dict[str, ReviewCitation]:
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
                split = max(text.rfind("\n", end - 90, end), text.rfind(" ", end - 90, end))
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

    async def run(self, request: SubmissionReviewRequest) -> SubmissionReviewResponse:
        passages = await asyncio.to_thread(_review_passages, request)
        result = await self._provider.generate(passages)

        def cite(point: ModelPoint) -> dict[str, object]:
            citation = passages.get(point.source_id)
            if citation is None or not point.text.strip():
                raise InvalidSubmissionReview("unverifiable review point")
            return {"text": point.text.strip(), "citation": citation}

        return SubmissionReviewResponse.model_validate({
            "requestId": request.request_id,
            "snapshotVersionId": request.snapshot_version_id,
            "snapshotContentHash": request.snapshot_content_hash,
            "summary": [cite(point) for point in result.summary],
            "checks": [{**cite(point), "category": point.category} for point in result.checks],
        })
