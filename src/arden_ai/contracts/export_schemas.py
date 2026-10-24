import json
from pathlib import Path

from pydantic.json_schema import models_json_schema

from arden_ai.contracts.answering import AnswerRequest, AnswerResponse
from arden_ai.contracts.indexing import IndexGenerationManifest, IndexGenerationRequest
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
        )

