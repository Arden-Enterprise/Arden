from __future__ import annotations

import hashlib
import io
import re
from collections.abc import Iterable

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from arden_ai.domain.compiler import CompiledMarkdown, SourceSpan

PDF_COMPILER_VERSION = "pdf-markdown-v1"
MAX_PDF_PAGES = 500


def _normalize_page_text(value: str) -> str:
    value = value.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    value = "\n".join(line.rstrip() for line in value.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def compile_pdf_pages(pages: Iterable[str]) -> CompiledMarkdown:
    parts: list[str] = []
    spans: list[SourceSpan] = []
    offset = 0
    emitted = 0

    def append(value: str) -> None:
        nonlocal offset
        parts.append(value)
        offset += len(value)

    for page_number, raw_text in enumerate(pages, start=1):
        text = _normalize_page_text(raw_text)
        if not text:
            continue
        if emitted:
            append("\n\n")
        title = f"Page {page_number}"
        heading_start = offset
        append(f"## {title}")
        spans.append(
            SourceSpan(
                block_id=f"pdf-page-{page_number}-heading",
                block_type="heading",
                start_offset=heading_start,
                end_offset=offset,
                heading_path=(title,),
                ancestor_block_ids=(),
            )
        )
        append("\n\n")
        body_start = offset
        append(text)
        spans.append(
            SourceSpan(
                block_id=f"pdf-page-{page_number}",
                block_type="paragraph",
                start_offset=body_start,
                end_offset=offset,
                heading_path=(title,),
                ancestor_block_ids=(),
            )
        )
        emitted += 1

    if not emitted:
        raise ValueError("PDF contains no extractable text; OCR is not enabled")

    append("\n")
    markdown = "".join(parts)
    return CompiledMarkdown(
        compiler_version=PDF_COMPILER_VERSION,
        markdown=markdown,
        content_hash=hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
        source_map=tuple(spans),
    )


def compile_pdf(content: bytes) -> CompiledMarkdown:
    try:
        reader = PdfReader(io.BytesIO(content), strict=False)
    except (PdfReadError, OSError, ValueError) as error:
        raise ValueError("PDF snapshot cannot be parsed") from error
    if reader.is_encrypted:
        raise ValueError("encrypted PDFs are not supported")
    if len(reader.pages) > MAX_PDF_PAGES:
        raise ValueError(f"PDF exceeds the {MAX_PDF_PAGES}-page indexing limit")

    page_texts: list[str] = []
    for page in reader.pages:
        try:
            page_texts.append(page.extract_text(extraction_mode="layout") or "")
        except (PdfReadError, KeyError, TypeError, ValueError) as error:
            raise ValueError("PDF text extraction failed") from error
    return compile_pdf_pages(page_texts)
