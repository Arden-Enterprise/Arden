from arden_ai.domain import SemanticDocument, compile_markdown


def test_compiler_is_deterministic_and_maps_unicode_offsets() -> None:
    document = SemanticDocument.model_validate(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "intro",
                    "type": "heading",
                    "props": {"level": 1},
                    "content": [{"type": "text", "text": "Quy định", "styles": {}}],
                    "children": [],
                },
                {
                    "id": "body",
                    "type": "paragraph",
                    "props": {},
                    "content": [{"type": "text", "text": "Nghỉ phép 🏖️", "styles": {"bold": True}}],
                    "children": [],
                },
            ],
        }
    )

    first = compile_markdown(document)
    second = compile_markdown(document)

    assert first == second
    assert first.markdown == "# Quy định\n\n**Nghỉ phép 🏖️**\n"
    body = next(span for span in first.source_map if span.block_id == "body")
    assert first.markdown[body.start_offset : body.end_offset] == "**Nghỉ phép 🏖️**"
    assert body.heading_path == ("Quy định",)
    assert len(first.content_hash) == 64


def test_compiler_preserves_structures_without_exposing_asset_ids() -> None:
    document = SemanticDocument.model_validate(
        {
            "schemaVersion": 1,
            "blocks": [
                {
                    "id": "code",
                    "type": "code",
                    "props": {"language": "python"},
                    "content": [{"type": "text", "text": "print(`ok`)", "styles": {}}],
                    "children": [],
                },
                {
                    "id": "table",
                    "type": "table",
                    "props": {"columns": 2},
                    "content": [
                        {
                            "cells": [
                                [{"type": "text", "text": "Name", "styles": {}}],
                                [{"type": "text", "text": "Value", "styles": {}}],
                            ]
                        },
                        {
                            "cells": [
                                [{"type": "text", "text": "A", "styles": {}}],
                                [{"type": "text", "text": "B", "styles": {}}],
                            ]
                        },
                    ],
                    "children": [],
                },
                {
                    "id": "asset",
                    "type": "asset",
                    "props": {"assetVersionId": "asset-v1", "label": "Employee handbook"},
                    "content": [],
                    "children": [],
                },
            ],
        }
    )

    compiled = compile_markdown(document)

    assert "```python\nprint(`ok`)\n```" in compiled.markdown
    assert "| Name | Value |\n| --- | --- |\n| A | B |" in compiled.markdown
    assert "Attachment: Employee handbook" in compiled.markdown
    assert "asset-v1" not in compiled.markdown


def test_document_rejects_duplicate_ids_and_unsafe_links() -> None:
    common = {"type": "paragraph", "props": {}, "children": []}
    try:
        SemanticDocument.model_validate(
            {
                "schemaVersion": 1,
                "blocks": [
                    {**common, "id": "same", "content": []},
                    {**common, "id": "same", "content": []},
                ],
            }
        )
    except ValueError as error:
        assert "block IDs must be unique" in str(error)
    else:
        raise AssertionError("duplicate block IDs must be rejected")

    try:
        SemanticDocument.model_validate(
            {
                "schemaVersion": 1,
                "blocks": [
                    {
                        **common,
                        "id": "unsafe",
                        "content": [
                            {
                                "type": "link",
                                "href": "javascript:alert(1)",
                                "content": [{"type": "text", "text": "bad", "styles": {}}],
                            }
                        ],
                    }
                ],
            }
        )
    except ValueError as error:
        assert "link scheme" in str(error)
    else:
        raise AssertionError("unsafe links must be rejected")

