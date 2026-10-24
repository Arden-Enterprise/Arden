from arden_ai.domain import CHUNKING_VERSION, SemanticDocument, chunk_markdown, compile_markdown


def test_langchain_chunking_preserves_offsets_and_parent_sections() -> None:
    repeated = " ".join(f"policy-{index}" for index in range(900))
    document = SemanticDocument.model_validate(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "leave-heading",
                    "type": "heading",
                    "props": {"level": 1},
                    "content": [{"type": "text", "text": "Leave", "styles": {}}],
                    "children": [],
                },
                {
                    "id": "leave-body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": repeated, "styles": {}}],
                    "children": [],
                },
                {
                    "id": "security-heading",
                    "type": "heading",
                    "props": {"level": 1},
                    "content": [{"type": "text", "text": "Security", "styles": {}}],
                    "children": [],
                },
                {
                    "id": "security-body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Use MFA.", "styles": {}}],
                    "children": [],
                },
            ],
        }
    )
    compiled = compile_markdown(document)

    chunks = chunk_markdown(
        compiled,
        "10000000-0000-4000-8000-000000000004",
        chunk_size=120,
        chunk_overlap=12,
    )

    assert CHUNKING_VERSION == "langchain-section-token-v1"
    assert len(chunks) > 2
    assert len({chunk.chunk_id for chunk in chunks}) == len(chunks)
    for chunk in chunks:
        assert compiled.markdown[chunk.start_offset : chunk.end_offset] == chunk.text
        assert chunk.token_count <= 140
        assert chunk.source_block_ids

    security = chunks[-1]
    assert security.parent_section_block_id == "security-heading"
    assert security.heading_path == ("Security",)
    assert security.embedding_text.startswith("Section: Security\n\n")
    assert "security-body" in security.source_block_ids


def test_chunking_rejects_invalid_overlap() -> None:
    document = SemanticDocument.model_validate(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Body", "styles": {}}],
                    "children": [],
                }
            ],
        }
    )
    try:
        chunk_markdown(compile_markdown(document), "generation", chunk_size=10, chunk_overlap=10)
    except ValueError as error:
        assert "smaller than chunk_size" in str(error)
    else:
        raise AssertionError("invalid overlap must be rejected")

