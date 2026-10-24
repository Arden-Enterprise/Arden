from __future__ import annotations

import hashlib
from dataclasses import dataclass

import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

from arden_ai.domain.compiler import CompiledMarkdown, SourceSpan

CHUNKING_VERSION = "langchain-section-token-v1"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


@dataclass(frozen=True, slots=True)
class PreparedChunk:
    chunk_id: str
    ordinal: int
    text: str
    embedding_text: str
    content_hash: str
    token_count: int
    start_offset: int
    end_offset: int
    source_block_ids: tuple[str, ...]
    parent_section_block_id: str | None
    heading_path: tuple[str, ...]


def _overlapping_spans(
    spans: tuple[SourceSpan, ...], start: int, end: int
) -> tuple[SourceSpan, ...]:
    return tuple(span for span in spans if span.start_offset < end and span.end_offset > start)


def _parent_heading(
    spans: tuple[SourceSpan, ...], start: int
) -> tuple[str | None, tuple[str, ...]]:
    headings = [
        span for span in spans if span.block_type == "heading" and span.start_offset <= start
    ]
    if not headings:
        return None, ()
    parent = max(headings, key=lambda span: span.start_offset)
    return parent.block_id, parent.heading_path


def _sections(compiled: CompiledMarkdown) -> tuple[tuple[int, int], ...]:
    heading_starts = sorted(
        span.start_offset for span in compiled.source_map if span.block_type == "heading"
    )
    starts = ([0] if not heading_starts or heading_starts[0] > 0 else []) + heading_starts
    return tuple(
        (start, starts[index + 1] if index + 1 < len(starts) else len(compiled.markdown))
        for index, start in enumerate(starts)
    )


def chunk_markdown(
    compiled: CompiledMarkdown,
    generation_id: str,
    *,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    chunk_size: int = 600,
    chunk_overlap: int = 60,
) -> tuple[PreparedChunk, ...]:
    if chunk_size < 1:
        raise ValueError("chunk_size must be positive")
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be non-negative and smaller than chunk_size")

    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        model_name=embedding_model,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=True,
        keep_separator="start",
        strip_whitespace=False,
        separators=["\n\n", "\n", " ", ""],
    )
    encoding = tiktoken.encoding_for_model(embedding_model)
    chunks: list[PreparedChunk] = []
    ordinal = 0

    for section_start, section_end in _sections(compiled):
        section_heading = next(
            (
                span
                for span in compiled.source_map
                if span.block_type == "heading" and span.start_offset == section_start
            ),
            None,
        )
        if section_heading is not None:
            body_start = section_heading.end_offset
            while body_start < section_end and compiled.markdown[body_start].isspace():
                body_start += 1
            section_start = body_start if body_start < section_end else section_start
        section = compiled.markdown[section_start:section_end]
        documents = splitter.create_documents([section])
        previous_local_start = -1
        for document in documents:
            local_start = document.metadata.get("start_index")
            text = document.page_content
            if not isinstance(local_start, int) or local_start < 0:
                # Repeated overlapping substrings can make LangChain report -1. Recover the next
                # exact occurrence and fail closed when it is no longer present.
                local_start = section.find(text, previous_local_start + 1)
            if local_start < 0:
                raise ValueError("LangChain chunk no longer maps to its source section")
            previous_local_start = local_start
            raw_start = section_start + local_start
            end = raw_start + len(text)
            if compiled.markdown[raw_start:end] != text:
                raise ValueError("LangChain chunk no longer maps exactly to compiled Markdown")
            if not text.strip():
                continue

            overlapping = _overlapping_spans(compiled.source_map, raw_start, end)
            parent_id, heading_path = _parent_heading(compiled.source_map, raw_start)
            breadcrumb = " > ".join(heading_path)
            embedding_text = f"Section: {breadcrumb}\n\n{text}" if breadcrumb else text
            content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            identity = f"{generation_id}:{ordinal}:{raw_start}:{end}:{content_hash}"
            chunk_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()
            chunks.append(
                PreparedChunk(
                    chunk_id=chunk_id,
                    ordinal=ordinal,
                    text=text,
                    embedding_text=embedding_text,
                    content_hash=content_hash,
                    token_count=len(encoding.encode(embedding_text, disallowed_special=())),
                    start_offset=raw_start,
                    end_offset=end,
                    source_block_ids=tuple(span.block_id for span in overlapping),
                    parent_section_block_id=parent_id,
                    heading_path=heading_path,
                )
            )
            ordinal += 1

    return tuple(chunks)
