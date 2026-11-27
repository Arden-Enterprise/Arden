import hashlib

import pytest

from arden_ai.domain.pdf import PDF_COMPILER_VERSION, compile_pdf_pages


def test_pdf_pages_compile_to_deterministic_markdown_with_source_map() -> None:
    compiled = compile_pdf_pages(["Policy title\n\nRule one", "\n", "Rule two\r\n\r\n\r\nEnd"])

    assert compiled.compiler_version == PDF_COMPILER_VERSION
    assert compiled.markdown == (
        "## Page 1\n\nPolicy title\n\nRule one\n\n## Page 3\n\nRule two\n\nEnd\n"
    )
    assert compiled.content_hash == hashlib.sha256(compiled.markdown.encode()).hexdigest()
    assert [span.block_id for span in compiled.source_map] == [
        "pdf-page-1-heading",
        "pdf-page-1",
        "pdf-page-3-heading",
        "pdf-page-3",
    ]


def test_pdf_pages_reject_image_only_documents() -> None:
    with pytest.raises(ValueError, match="no extractable text"):
        compile_pdf_pages(["", "\n"])
