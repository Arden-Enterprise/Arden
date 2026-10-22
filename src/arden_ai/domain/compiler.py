from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass
from urllib.parse import quote

from arden_ai.domain.semantic_document import (
    AssetBlock,
    BulletListItemBlock,
    CodeBlock,
    HeadingBlock,
    Inline,
    Link,
    NumberedListItemBlock,
    QuoteBlock,
    SemanticBlock,
    SemanticDocument,
    TableBlock,
    TextRun,
)

COMPILER_VERSION = "semantic-markdown-v1"
_MARKDOWN_SPECIAL = re.compile(r"([\\`*_{}\[\]()#+\-.!|>])")
_LANGUAGE = re.compile(r"^[A-Za-z0-9_+.-]{1,64}$")


@dataclass(frozen=True, slots=True)
class SourceSpan:
    block_id: str
    block_type: str
    start_offset: int
    end_offset: int
    heading_path: tuple[str, ...]
    ancestor_block_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CompiledMarkdown:
    compiler_version: str
    markdown: str
    content_hash: str
    source_map: tuple[SourceSpan, ...]


def _escape_text(value: str) -> str:
    escaped = html.escape(value, quote=False)
    return _MARKDOWN_SPECIAL.sub(r"\\\1", escaped).replace("\n", "<br>")


def _render_text(run: TextRun) -> str:
    value = _escape_text(run.text)
    if run.styles.code:
        longest = max((len(match.group()) for match in re.finditer(r"`+", run.text)), default=0)
        fence = "`" * max(1, longest + 1)
        value = f"{fence} {run.text} {fence}"
    if run.styles.strike:
        value = f"~~{value}~~"
    if run.styles.underline:
        value = f"<u>{value}</u>"
    if run.styles.italic:
        value = f"_{value}_"
    if run.styles.bold:
        value = f"**{value}**"
    return value


def _render_inline(inline: Inline) -> str:
    if isinstance(inline, TextRun):
        return _render_text(inline)
    label = "".join(_render_text(run) for run in inline.content)
    href = quote(inline.href, safe=":/?#[]@!$&'*+,;=%")
    return f"[{label}](<{href}>)"


def _render_inlines(inlines: list[Inline]) -> str:
    return "".join(_render_inline(inline) for inline in inlines)


def _render_code(block: CodeBlock) -> str:
    code = "".join(run.text for run in block.content).replace("\r\n", "\n").replace("\r", "\n")
    longest = max((len(match.group()) for match in re.finditer(r"`+", code)), default=0)
    fence = "`" * max(3, longest + 1)
    language = block.props.language or ""
    info = language if _LANGUAGE.fullmatch(language) else ""
    return f"{fence}{info}\n{code}\n{fence}"


def _render_table(block: TableBlock) -> str:
    rows = [
        [_render_inlines(cell).replace("\n", "<br>") for cell in row.cells]
        for row in block.content
    ]
    if not rows:
        rows = [[""] * block.props.columns]
    header = "| " + " | ".join(rows[0]) + " |"
    separator = "| " + " | ".join(["---"] * block.props.columns) + " |"
    body = ["| " + " | ".join(row) + " |" for row in rows[1:]]
    return "\n".join([header, separator, *body])


def _render_block(block: SemanticBlock, depth: int) -> str:
    if isinstance(block, HeadingBlock):
        return f"{'#' * block.props.level} {_render_inlines(block.content)}"
    if isinstance(block, BulletListItemBlock):
        return f"{'  ' * depth}- {_render_inlines(block.content)}"
    if isinstance(block, NumberedListItemBlock):
        return f"{'  ' * depth}1. {_render_inlines(block.content)}"
    if isinstance(block, QuoteBlock):
        content = _render_inlines(block.content)
        return "\n".join(f"> {line}" for line in content.split("\n"))
    if isinstance(block, CodeBlock):
        return _render_code(block)
    if isinstance(block, TableBlock):
        return _render_table(block)
    if isinstance(block, AssetBlock):
        return f"Attachment: {_escape_text(block.props.label or 'Untitled asset')}"
    return _render_inlines(block.content)


def compile_markdown(document: SemanticDocument) -> CompiledMarkdown:
    parts: list[str] = []
    spans: list[SourceSpan] = []
    headings: list[str] = []
    offset = 0

    def append(value: str) -> None:
        nonlocal offset
        parts.append(value)
        offset += len(value)

    def emit(block: SemanticBlock, depth: int, ancestors: tuple[str, ...], separator: str) -> None:
        nonlocal headings
        append(separator)
        rendered = _render_block(block, depth)
        if isinstance(block, HeadingBlock):
            title = "".join(
                run.text if isinstance(inline, Link) else inline.text
                for inline in block.content
                for run in (inline.content if isinstance(inline, Link) else [inline])
            )
            headings = headings[: block.props.level - 1]
            headings.append(title)
        start = offset
        append(rendered)
        spans.append(
            SourceSpan(
                block_id=block.id,
                block_type=block.type,
                start_offset=start,
                end_offset=offset,
                heading_path=tuple(headings),
                ancestor_block_ids=ancestors,
            )
        )
        for index, child in enumerate(block.children):
            child_separator = "\n" if index == 0 else "\n\n"
            emit(child, depth + 1, (*ancestors, block.id), child_separator)

    for index, block in enumerate(document.blocks):
        emit(block, 0, (), "" if index == 0 else "\n\n")

    markdown = "".join(parts).rstrip("\n") + "\n"
    digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    return CompiledMarkdown(
        compiler_version=COMPILER_VERSION,
        markdown=markdown,
        content_hash=digest,
        source_map=tuple(spans),
    )

