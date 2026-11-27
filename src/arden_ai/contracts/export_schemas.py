import json
from pathlib import Path

from pydantic.json_schema import models_json_schema

from arden_ai.contracts.answering import AnswerRequest, AnswerResponse
from arden_ai.contracts.governed import (
    GenerationRequest,
    GenerationResponse,
    RetrievalRequest,
    RetrievalResponse,
)
from arden_ai.contracts.governed_v3 import (
    GenerationV3Request,
    GenerationV3Response,
)
from arden_ai.contracts.indexing import IndexGenerationManifest, IndexGenerationRequest
from arden_ai.contracts.reader import ReaderSourceRequest, ReaderSourceResponse
from arden_ai.contracts.reader_summary import ReaderSummaryResponse
from arden_ai.contracts.submission_review import (
    SubmissionReviewRequest,
    SubmissionReviewRequestV2,
    SubmissionReviewResponse,
    SubmissionReviewResponseV2,
)
from arden_ai.contracts.writing import WritingRequest, WritingResponse
from arden_ai.domain.semantic_document import SemanticDocument


def build_schemas() -> dict[str, dict[str, object]]:
    semantic = SemanticDocument.model_json_schema(by_alias=True)
    _, indexing_root = models_json_schema(
        [
            (IndexGenerationRequest, "validation"),
            (IndexGenerationManifest, "validation"),
        ],
        by_alias=True,
        title="Arden indexing contract v1",
    )
    _, answering_root = models_json_schema(
        [(AnswerRequest, "validation"), (AnswerResponse, "validation")],
        by_alias=True,
        title="Arden answer contract v1",
    )
    return {
        "submission-review-v2.schema.json": models_json_schema(
            [(SubmissionReviewRequestV2, "validation"), (SubmissionReviewResponseV2, "validation")],
            by_alias=True,
            title="Arden submission review contract v2",
        )[1],
        "submission-review-v1.schema.json": models_json_schema(
            [(SubmissionReviewRequest, "validation"), (SubmissionReviewResponse, "validation")],
            by_alias=True,
            title="Arden submission review contract v1",
        )[1],
        "writing-v1.schema.json": models_json_schema(
            [(WritingRequest, "validation"), (WritingResponse, "validation")],
            by_alias=True,
            title="Arden writing action contract v1",
        )[1],
        "reader-summary-v1.schema.json": models_json_schema(
            [(ReaderSourceResponse, "validation"), (ReaderSummaryResponse, "validation")],
            by_alias=True,
            title="Arden reader Summary contract v1",
        )[1],
        "reader-source-v1.schema.json": models_json_schema(
            [(ReaderSourceRequest, "validation"), (ReaderSourceResponse, "validation")],
            by_alias=True,
            title="Arden reader source contract v1",
        )[1],
        "answer-v3.schema.json": models_json_schema(
            [
                (GenerationV3Request, "validation"),
                (GenerationV3Response, "validation"),
            ],
            by_alias=True,
            title="Arden governed answer contract v3",
        )[1],
        "answer-v2.schema.json": models_json_schema(
            [
                (RetrievalRequest, "validation"),
                (RetrievalResponse, "validation"),
                (GenerationRequest, "validation"),
                (GenerationResponse, "validation"),
            ],
            by_alias=True,
            title="Arden governed answer contract v2",
        )[1],
        "answer-v1.schema.json": answering_root,
        "semantic-document-v1.schema.json": semantic,
        "index-generation-v1.schema.json": indexing_root,
    }


def main() -> None:
    output = Path(__file__).resolve().parents[3] / "schemas"
    output.mkdir(exist_ok=True)

    for name, schema in build_schemas().items():
        target = output / name
        target.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
