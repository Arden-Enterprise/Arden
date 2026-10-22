from dataclasses import dataclass

from arden_ai.contracts.indexing import IndexGenerationRequest
from arden_ai.domain.compiler import CompiledMarkdown, compile_markdown
from arden_ai.pipeline.chunking import PreparedChunk, chunk_markdown


@dataclass(frozen=True, slots=True)
class PreparedGeneration:
    request: IndexGenerationRequest
    compiled: CompiledMarkdown
    chunks: tuple[PreparedChunk, ...]


def prepare_generation(request: IndexGenerationRequest) -> PreparedGeneration:
    compiled = compile_markdown(request.document)
    chunks = chunk_markdown(compiled, str(request.generation_id))
    if not chunks:
        raise ValueError("approved snapshot produced no indexable chunks")
    return PreparedGeneration(request=request, compiled=compiled, chunks=chunks)

