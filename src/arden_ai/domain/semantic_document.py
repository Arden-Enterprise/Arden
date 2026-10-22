from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

BlockId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextStyles(StrictModel):
    bold: Literal[True] | None = None
    italic: Literal[True] | None = None
    underline: Literal[True] | None = None
    strike: Literal[True] | None = None
    code: Literal[True] | None = None


class TextRun(StrictModel):
    type: Literal["text"]
    text: str
    styles: TextStyles


class Link(StrictModel):
    type: Literal["link"]
    href: Annotated[str, Field(max_length=2_048)]
    content: list[TextRun]

    @model_validator(mode="after")
    def validate_scheme(self) -> Link:
        if urlsplit(self.href).scheme.lower() not in {"http", "https", "mailto"}:
            raise ValueError("link scheme must be http, https, or mailto")
        return self


Inline = Annotated[TextRun | Link, Field(discriminator="type")]


class EmptyProps(StrictModel):
    pass


class HeadingProps(StrictModel):
    level: Literal[1, 2, 3]


class CodeProps(StrictModel):
    language: str | None


class TableProps(StrictModel):
    columns: Annotated[int, Field(ge=1, le=32)]


class AssetProps(StrictModel):
    assetVersionId: BlockId
    label: Annotated[str, Field(max_length=512)] | None


class TableRow(StrictModel):
    cells: list[list[Inline]]


class BlockBase(StrictModel):
    id: BlockId
    children: list[SemanticBlock]


class ParagraphBlock(BlockBase):
    type: Literal["paragraph"]
    props: EmptyProps
    content: list[Inline]


class HeadingBlock(BlockBase):
    type: Literal["heading"]
    props: HeadingProps
    content: list[Inline]


class BulletListItemBlock(BlockBase):
    type: Literal["bulletListItem"]
    props: EmptyProps
    content: list[Inline]


class NumberedListItemBlock(BlockBase):
    type: Literal["numberedListItem"]
    props: EmptyProps
    content: list[Inline]


class QuoteBlock(BlockBase):
    type: Literal["quote"]
    props: EmptyProps
    content: list[Inline]


class CodeBlock(BlockBase):
    type: Literal["code"]
    props: CodeProps
    content: list[TextRun]


class TableBlock(BlockBase):
    type: Literal["table"]
    props: TableProps
    content: list[TableRow]

    @model_validator(mode="after")
    def validate_column_count(self) -> TableBlock:
        if any(len(row.cells) != self.props.columns for row in self.content):
            raise ValueError("every table row must match props.columns")
        return self


class AssetBlock(BlockBase):
    type: Literal["asset"]
    props: AssetProps
    content: Annotated[list[None], Field(max_length=0)]


SemanticBlock = Annotated[
    ParagraphBlock
    | HeadingBlock
    | BulletListItemBlock
    | NumberedListItemBlock
    | QuoteBlock
    | CodeBlock
    | TableBlock
    | AssetBlock,
    Field(discriminator="type"),
]


class SemanticDocument(StrictModel):
    schemaVersion: Literal[1]
    blocks: Annotated[list[SemanticBlock], Field(min_length=1)]

    @model_validator(mode="after")
    def validate_document_limits(self) -> SemanticDocument:
        seen: set[str] = set()
        block_count = 0
        text_count = 0

        def visit(block: SemanticBlock, depth: int) -> None:
            nonlocal block_count, text_count
            if depth > 8:
                raise ValueError("document exceeds maximum block depth")
            if block.id in seen:
                raise ValueError("block IDs must be unique")
            seen.add(block.id)
            block_count += 1
            if block_count > 2_000:
                raise ValueError("document exceeds maximum block count")

            if isinstance(block, TableBlock):
                inlines = [inline for row in block.content for cell in row.cells for inline in cell]
            elif isinstance(block, AssetBlock):
                inlines = []
            else:
                inlines = list(block.content)
            for inline in inlines:
                if isinstance(inline, TextRun):
                    text_count += len(inline.text)
                elif isinstance(inline, Link):
                    text_count += sum(len(run.text) for run in inline.content)

            for child in block.children:
                visit(child, depth + 1)

        for root in self.blocks:
            visit(root, 0)
        if text_count > 131_072:
            raise ValueError("document exceeds maximum text length")
        return self


BlockBase.model_rebuild()
SemanticDocument.model_rebuild()

