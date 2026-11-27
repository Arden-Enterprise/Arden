"""Pure domain validation for AI-proposed flat-array UiSurface drafts."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence

from arden_ai.contracts.governed_v3 import (
    GRAPH_TYPE_CODES,
    NODE_ID_PATTERN,
    PROTOTYPE_DENYLIST,
    AiApplyFilterAction,
    AiCalloutNode,
    AiCardNode,
    AiComparisonTableNode,
    AiDocumentItemNode,
    AiFocusNodesAction,
    AiGovernanceKvNode,
    AiGraphActionNode,
    AiIsolateBranchAction,
    AiLineageTreeNode,
    AiMetricStripNode,
    AiOpenReaderNode,
    AiPinToContextAction,
    AiPromptChipNode,
    AiProseNode,
    AiRowNode,
    AiSectionNode,
    AiSplitNode,
    AiStackNode,
    AiSurfaceDraft,
    AiSurfaceNode,
    AiTabsNode,
    AiToggleLinksAction,
    AiWorkflowHandoffNode,
    SourceCatalogEntry,
)

MAX_SURFACE_NODES = 32
MAX_SURFACE_DEPTH = 4
MAX_SURFACE_COMPACT_BYTES = 48_000

_NODE_ID_RE = re.compile(NODE_ID_PATTERN)
_INLINE_CITATION_RE = re.compile(r"\[(\d+)\]")

ROOT_KINDS: frozenset[str] = frozenset({"stack", "card"})
ACTION_KINDS: frozenset[str] = frozenset(
    {"graph_action", "open_reader", "workflow_handoff", "prompt_chip"}
)

# Ancestor-invariant container nesting bans (enforced over full subtrees at any depth)
_BANNED_ANCESTORS_BY_KIND: dict[str, frozenset[str]] = {
    "card": frozenset({"card"}),
    "section": frozenset({"section"}),
    "tabs": frozenset({"tabs", "section", "row", "split"}),
    "split": frozenset({"split", "row"}),
    "row": frozenset({"row"}),
    "comparison_table": frozenset({"row", "split"}),
}


class SurfaceValidationError(ValueError):
    """Raised when an AI-proposed UiSurface draft violates structural or grounding invariants."""


def _validate_node_id(value: str, label: str) -> None:
    if value in PROTOTYPE_DENYLIST or not _NODE_ID_RE.fullmatch(value):
        raise SurfaceValidationError(f"invalid {label}: {value!r}")


def _validate_non_blank(value: str | None, label: str) -> None:
    if value is not None and not value.strip():
        raise SurfaceValidationError(f"blank {label}")


def _validate_citation_indexes(
    indexes: Sequence[int] | None,
    citation_count: int,
    *,
    required: bool = False,
    max_len: int = 12,
    label: str = "citationIndexes",
) -> None:
    if indexes is None:
        if required:
            raise SurfaceValidationError(f"{label} is required")
        return
    if required and not indexes:
        raise SurfaceValidationError(f"{label} must be non-empty")
    if len(indexes) > max_len:
        raise SurfaceValidationError(f"{label} exceeds maximum length {max_len}")
    seen: set[int] = set()
    for idx in indexes:
        if isinstance(idx, bool) or not isinstance(idx, int):
            raise SurfaceValidationError(f"{label} entries must be integers")
        if idx < 1 or idx > citation_count:
            raise SurfaceValidationError(f"{label} index {idx} out of range 1..{citation_count}")
        if idx in seen:
            raise SurfaceValidationError(f"duplicate index {idx} in {label}")
        seen.add(idx)


def _validate_unique_strings(values: Sequence[str], label: str) -> None:
    if len(set(values)) != len(values):
        raise SurfaceValidationError(f"duplicate entries in {label}")


def _validate_node_semantics(
    node: AiSurfaceNode,
    *,
    doc_refs: frozenset[str],
    dept_refs: frozenset[str],
    collection_refs: frozenset[str],
    citation_count: int,
) -> None:
    if isinstance(node, AiCardNode):
        _validate_non_blank(node.title, "card.title")
        _validate_non_blank(node.subtitle, "card.subtitle")
    elif isinstance(node, AiSectionNode):
        _validate_non_blank(node.title, "section.title")
    elif isinstance(node, AiTabsNode):
        tab_ids = [tab.id for tab in node.tabs]
        for tab in node.tabs:
            _validate_node_id(tab.id, "tab.id")
            _validate_non_blank(tab.label, "tab.label")
        _validate_unique_strings(tab_ids, "tabs.id")
        if node.default_tab_id not in tab_ids:
            raise SurfaceValidationError("tabs.defaultTabId must match a tab id")
    elif isinstance(node, AiSplitNode):
        _validate_non_blank(node.left_title, "split.leftTitle")
        _validate_non_blank(node.right_title, "split.rightTitle")
    elif isinstance(node, AiProseNode):
        _validate_non_blank(node.markdown, "prose.markdown")
        _validate_citation_indexes(
            node.citation_indexes, citation_count, required=False, max_len=12
        )
        for match in _INLINE_CITATION_RE.finditer(node.markdown):
            inline_idx = int(match.group(1))
            if inline_idx < 1 or inline_idx > citation_count:
                raise SurfaceValidationError(
                    f"inline prose citation [{inline_idx}] out of range 1..{citation_count}"
                )
    elif isinstance(node, AiDocumentItemNode):
        if node.doc_ref not in doc_refs:
            raise SurfaceValidationError(f"unknown document_item.docRef: {node.doc_ref}")
        _validate_non_blank(node.highlight_note, "document_item.highlightNote")
    elif isinstance(node, AiGovernanceKvNode):
        if node.doc_ref not in doc_refs:
            raise SurfaceValidationError(f"unknown governance_kv.docRef: {node.doc_ref}")
        if node.fields is not None:
            _validate_unique_strings(node.fields, "governance_kv.fields")
    elif isinstance(node, AiComparisonTableNode):
        _validate_non_blank(node.caption, "comparison_table.caption")
        for col in node.columns:
            _validate_non_blank(col, "comparison_table.columns")
        col_count = len(node.columns)
        for row_idx, row in enumerate(node.rows):
            if len(row.cells) != col_count:
                raise SurfaceValidationError(
                    f"comparison_table row {row_idx} cell count {len(row.cells)} != {col_count}"
                )
            row_has_citation = False
            for cell in row.cells:
                _validate_non_blank(cell.text, "comparison_table.cell.text")
                _validate_citation_indexes(
                    cell.citation_indexes,
                    citation_count,
                    required=False,
                    max_len=4,
                    label="comparison_table.cell.citationIndexes",
                )
                if cell.citation_indexes:
                    row_has_citation = True
            if not row_has_citation:
                raise SurfaceValidationError(
                    f"comparison_table row {row_idx} must cite at least one verified citationIndex"
                )
    elif isinstance(node, AiCalloutNode):
        if node.tone not in ("info", "conflict"):
            raise SurfaceValidationError(f"forbidden LLM callout tone: {node.tone}")
        _validate_non_blank(node.title, "callout.title")
        _validate_non_blank(node.body, "callout.body")
        _validate_citation_indexes(
            node.citation_indexes,
            citation_count,
            required=True,
            max_len=6,
            label="callout.citationIndexes",
        )
    elif isinstance(node, AiMetricStripNode):
        _validate_unique_strings(node.metric_keys, "metric_strip.metricKeys")
    elif isinstance(node, AiLineageTreeNode):
        if node.doc_ref not in doc_refs:
            raise SurfaceValidationError(f"unknown lineage_tree.docRef: {node.doc_ref}")
    elif isinstance(node, AiGraphActionNode):
        _validate_non_blank(node.label, "graph_action.label")
        action = node.action
        if isinstance(action, (AiFocusNodesAction, AiPinToContextAction)):
            _validate_unique_strings(action.doc_refs, f"{action.op}.docRefs")
            for ref in action.doc_refs:
                if ref not in doc_refs:
                    raise SurfaceValidationError(f"unknown {action.op} docRef: {ref}")
        elif isinstance(action, AiApplyFilterAction):
            if action.department_ref is not None and action.department_ref not in dept_refs:
                raise SurfaceValidationError(
                    f"unknown apply_filter.departmentRef: {action.department_ref}"
                )
            if action.collection_ref is not None and action.collection_ref not in collection_refs:
                raise SurfaceValidationError(
                    f"unknown apply_filter.collectionRef: {action.collection_ref}"
                )
        elif isinstance(action, AiIsolateBranchAction):
            if action.branch_kind == "department":
                if action.branch_ref not in dept_refs:
                    raise SurfaceValidationError(
                        f"unknown isolate_branch departmentRef: {action.branch_ref}"
                    )
            elif action.branch_kind == "collection":
                if action.branch_ref not in collection_refs:
                    raise SurfaceValidationError(
                        f"unknown isolate_branch collectionRef: {action.branch_ref}"
                    )
            elif action.branch_ref not in GRAPH_TYPE_CODES:
                raise SurfaceValidationError(
                    f"invalid isolate_branch typeCode: {action.branch_ref}"
                )
        elif isinstance(action, AiToggleLinksAction) and action.relationship_types is not None:
            _validate_unique_strings(action.relationship_types, "toggle_links.relationshipTypes")
    elif isinstance(node, AiOpenReaderNode):
        _validate_non_blank(node.label, "open_reader.label")
        if node.doc_ref not in doc_refs:
            raise SurfaceValidationError(f"unknown open_reader.docRef: {node.doc_ref}")
        _validate_non_blank(node.block_id, "open_reader.blockId")
        if node.page is not None and (
            isinstance(node.page, bool) or node.page < 1 or node.page > 100_000
        ):
            raise SurfaceValidationError("invalid open_reader.page")
    elif isinstance(node, AiWorkflowHandoffNode):
        _validate_non_blank(node.label, "workflow_handoff.label")
        if node.doc_ref not in doc_refs:
            raise SurfaceValidationError(f"unknown workflow_handoff.docRef: {node.doc_ref}")
    elif isinstance(node, AiPromptChipNode):
        _validate_non_blank(node.label, "prompt_chip.label")
        _validate_non_blank(node.prompt, "prompt_chip.prompt")


def _child_ids_of(node: AiSurfaceNode) -> list[str]:
    if isinstance(node, (AiStackNode, AiRowNode, AiSectionNode)):
        return list(node.child_ids)
    if isinstance(node, AiCardNode):
        return [*node.body_ids, *(node.footer_ids or ())]
    if isinstance(node, AiTabsNode):
        children: list[str] = []
        for tab in node.tabs:
            children.extend(tab.child_ids)
        return children
    if isinstance(node, AiSplitNode):
        return [node.left_id, node.right_id]
    return []


def validate_ai_surface_draft(
    draft: AiSurfaceDraft,
    *,
    catalog: Sequence[SourceCatalogEntry],
    citation_count: int,
) -> None:
    """Validate an AiSurfaceDraft against all structural, nesting, handle, and citation rules."""
    if not (1 <= len(draft.nodes) <= MAX_SURFACE_NODES):
        raise SurfaceValidationError(
            f"surface node count {len(draft.nodes)} outside 1..{MAX_SURFACE_NODES}"
        )

    compact_bytes = len(
        json.dumps(
            draft.model_dump(mode="json", by_alias=True, exclude_none=True),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    if compact_bytes > MAX_SURFACE_COMPACT_BYTES:
        raise SurfaceValidationError(
            f"surface compact size {compact_bytes} exceeds {MAX_SURFACE_COMPACT_BYTES} bytes"
        )

    _validate_node_id(draft.root_id, "rootId")
    nodes_by_id: dict[str, AiSurfaceNode] = {}
    for node in draft.nodes:
        _validate_node_id(node.id, "node.id")
        if node.id in nodes_by_id:
            raise SurfaceValidationError(f"duplicate node id: {node.id}")
        nodes_by_id[node.id] = node

    if draft.root_id not in nodes_by_id:
        raise SurfaceValidationError(f"rootId {draft.root_id!r} not found in nodes")
    root = nodes_by_id[draft.root_id]
    if root.kind not in ROOT_KINDS:
        raise SurfaceValidationError(f"root node kind must be stack or card, got {root.kind!r}")

    doc_refs = frozenset(entry.doc_ref for entry in catalog)
    dept_refs = frozenset(entry.department_ref for entry in catalog)
    collection_refs = frozenset(
        entry.collection_ref for entry in catalog if entry.collection_ref is not None
    )

    visited: set[str] = set()

    def visit(node_id: str, depth: int, ancestors: tuple[str, ...]) -> None:
        if depth > MAX_SURFACE_DEPTH:
            raise SurfaceValidationError(
                f"node {node_id!r} exceeds maximum depth {MAX_SURFACE_DEPTH}"
            )
        if node_id in visited:
            raise SurfaceValidationError(
                f"node {node_id!r} is referenced more than once (cycle or DAG diamond)"
            )
        if node_id not in nodes_by_id:
            raise SurfaceValidationError(f"dangling child reference: {node_id!r}")

        visited.add(node_id)
        node = nodes_by_id[node_id]

        banned_ancestors = _BANNED_ANCESTORS_BY_KIND.get(node.kind)
        if banned_ancestors and any(ancestor in banned_ancestors for ancestor in ancestors):
            raise SurfaceValidationError(
                f"forbidden ancestor nesting for {node.kind!r} under {ancestors}"
            )

        _validate_node_semantics(
            node,
            doc_refs=doc_refs,
            dept_refs=dept_refs,
            collection_refs=collection_refs,
            citation_count=citation_count,
        )

        if isinstance(node, AiCardNode) and node.footer_ids:
            for footer_id in node.footer_ids:
                if footer_id not in nodes_by_id:
                    raise SurfaceValidationError(f"dangling footer reference: {footer_id!r}")
                footer_kind = nodes_by_id[footer_id].kind
                if footer_kind not in ACTION_KINDS:
                    raise SurfaceValidationError(
                        f"card.footerIds accepts actions only, got {footer_kind!r}"
                    )

        next_ancestors = (*ancestors, node.kind)
        for child_id in _child_ids_of(node):
            visit(child_id, depth + 1, next_ancestors)

    visit(draft.root_id, 0, ())

    if len(visited) != len(nodes_by_id):
        orphans = sorted(set(nodes_by_id) - visited)
        raise SurfaceValidationError(f"unreachable orphan nodes: {orphans}")
