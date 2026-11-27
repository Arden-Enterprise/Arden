"""Additive v3 governed generation contract with flat array UiSurface drafts."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, Field, model_validator

from arden_ai.contracts.governed import DialogueTurn, Evidence, EvidenceCitation
from arden_ai.contracts.indexing import ContractModel, Sha256

PROTOTYPE_DENYLIST: frozenset[str] = frozenset(
    {
        "__proto__",
        "constructor",
        "prototype",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
    }
)

NODE_ID_PATTERN = r"^[a-zA-Z0-9_-]{1,32}$"
DOC_REF_PATTERN = r"^D[1-8]$"
DEPARTMENT_REF_PATTERN = r"^DEPT[1-9][0-9]{0,2}$"
COLLECTION_REF_PATTERN = r"^C[1-9][0-9]{0,2}$"


def _reject_prototype_key(value: str) -> str:
    if value in PROTOTYPE_DENYLIST:
        raise ValueError(f"forbidden prototype key: {value}")
    return value


NodeId = Annotated[str, Field(pattern=NODE_ID_PATTERN), AfterValidator(_reject_prototype_key)]
DocRef = Annotated[str, Field(pattern=DOC_REF_PATTERN)]
DepartmentRef = Annotated[str, Field(pattern=DEPARTMENT_REF_PATTERN)]
CollectionRef = Annotated[str, Field(pattern=COLLECTION_REF_PATTERN)]
CitationIndex = Annotated[int, Field(ge=1, le=12, strict=True)]

KnowledgeType = Literal[
    "Policy & Standard",
    "Procedure",
    "Guide",
    "Reference",
    "Lessons Learned",
]
GraphTypeCode = Literal[
    "POLICY_AND_STANDARD",
    "PROCEDURE",
    "GUIDE",
    "REFERENCE",
    "LESSONS_LEARNED",
    "UNCATEGORIZED",
]
GRAPH_TYPE_CODES: frozenset[str] = frozenset(
    {
        "POLICY_AND_STANDARD",
        "PROCEDURE",
        "GUIDE",
        "REFERENCE",
        "LESSONS_LEARNED",
        "UNCATEGORIZED",
    }
)
GraphReaderScope = Literal[
    "ORGANIZATION",
    "DEPARTMENT",
    "SELECTED_MEMBERS",
    "LEGACY_AUDIENCE",
]
DocumentRelationshipType = Literal["REFERENCES", "RELATED", "SUPERSEDES"]
GovernanceFieldKey = Literal[
    "ownerDepartment",
    "authorDisplayName",
    "type",
    "version",
    "publishedAt",
    "validUntil",
    "validityStatus",
    "readerScope",
    "collectionName",
    "openMaintenanceCaseCount",
]
MetricKey = Literal[
    "MATCHED_DOCS",
    "EXPIRING_SOON_DOCS",
    "OPEN_MAINTENANCE_CASES",
    "DISTINCT_OWNER_DEPTS",
]
WorkflowHandoffKind = Literal[
    "report_issue",
    "open_maintenance_case",
    "open_renewal",
]
UiSurfaceMode = Literal["AUTO", "DISABLED"]
UiSurfaceStatus = Literal[
    "GENERATED",
    "OMITTED_INSUFFICIENT",
    "OMITTED_INVALID",
    "DISABLED",
]


class SourceCatalogEntry(ContractModel):
    doc_ref: DocRef
    title: Annotated[str, Field(min_length=1, max_length=1_000)]
    type: KnowledgeType | None = None
    owner_department: Annotated[str, Field(min_length=1, max_length=200)]
    version: Annotated[str, Field(min_length=1, max_length=100)]
    reader_scope: GraphReaderScope
    has_direct_relationships: bool = False
    department_ref: DepartmentRef
    collection_ref: CollectionRef | None = None


# ---------------------------------------------------------------------------
# Containers (6)
# ---------------------------------------------------------------------------


class AiStackNode(ContractModel):
    id: NodeId
    kind: Literal["stack"]
    gap: Literal["sm", "md"] | None = None
    child_ids: Annotated[list[NodeId], Field(min_length=1, max_length=12)]


class AiRowNode(ContractModel):
    id: NodeId
    kind: Literal["row"]
    columns: Literal[2, 3] | None = None
    child_ids: Annotated[list[NodeId], Field(min_length=1, max_length=6)]


class AiCardNode(ContractModel):
    id: NodeId
    kind: Literal["card"]
    title: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    subtitle: Annotated[str, Field(min_length=1, max_length=160)] | None = None
    tone: Literal["default", "subtle"] | None = None
    body_ids: Annotated[list[NodeId], Field(min_length=1, max_length=8)]
    footer_ids: Annotated[list[NodeId], Field(max_length=4)] | None = None


class AiSectionNode(ContractModel):
    id: NodeId
    kind: Literal["section"]
    title: Annotated[str, Field(min_length=1, max_length=120)]
    default_open: bool | None = None
    child_ids: Annotated[list[NodeId], Field(min_length=1, max_length=8)]


class AiTabPanel(ContractModel):
    id: NodeId
    label: Annotated[str, Field(min_length=1, max_length=40)]
    child_ids: Annotated[list[NodeId], Field(min_length=1, max_length=6)]


class AiTabsNode(ContractModel):
    id: NodeId
    kind: Literal["tabs"]
    default_tab_id: NodeId
    tabs: Annotated[list[AiTabPanel], Field(min_length=2, max_length=4)]

    @model_validator(mode="after")
    def validate_tabs(self) -> AiTabsNode:
        tab_ids = [tab.id for tab in self.tabs]
        if len(set(tab_ids)) != len(tab_ids):
            raise ValueError("duplicate tab id")
        if self.default_tab_id not in tab_ids:
            raise ValueError("defaultTabId must match one tab id")
        return self


class AiSplitNode(ContractModel):
    id: NodeId
    kind: Literal["split"]
    left_title: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    left_id: NodeId
    right_title: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    right_id: NodeId


# ---------------------------------------------------------------------------
# Leaves (7)
# ---------------------------------------------------------------------------


class AiProseNode(ContractModel):
    id: NodeId
    kind: Literal["prose"]
    markdown: Annotated[str, Field(min_length=1, max_length=12_000)]
    citation_indexes: Annotated[list[CitationIndex], Field(max_length=12)] | None = None


class AiDocumentItemNode(ContractModel):
    id: NodeId
    kind: Literal["document_item"]
    doc_ref: DocRef
    highlight_note: Annotated[str, Field(min_length=1, max_length=120)] | None = None


class AiGovernanceKvNode(ContractModel):
    id: NodeId
    kind: Literal["governance_kv"]
    doc_ref: DocRef
    fields: Annotated[list[GovernanceFieldKey], Field(min_length=1, max_length=10)] | None = None


class AiTableCell(ContractModel):
    text: Annotated[str, Field(min_length=1, max_length=280)]
    citation_indexes: Annotated[list[CitationIndex], Field(max_length=4)] | None = None


class AiTableRow(ContractModel):
    cells: Annotated[list[AiTableCell], Field(min_length=2, max_length=5)]


class AiComparisonTableNode(ContractModel):
    id: NodeId
    kind: Literal["comparison_table"]
    caption: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    columns: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=60)]],
        Field(min_length=2, max_length=5),
    ]
    rows: Annotated[list[AiTableRow], Field(min_length=1, max_length=12)]


class AiCalloutNode(ContractModel):
    id: NodeId
    kind: Literal["callout"]
    tone: Literal["info", "conflict"]
    title: Annotated[str, Field(min_length=1, max_length=120)]
    body: Annotated[str, Field(min_length=1, max_length=800)]
    citation_indexes: Annotated[list[CitationIndex], Field(min_length=1, max_length=6)]


class AiMetricStripNode(ContractModel):
    id: NodeId
    kind: Literal["metric_strip"]
    metric_keys: Annotated[list[MetricKey], Field(min_length=1, max_length=4)]


class AiLineageTreeNode(ContractModel):
    id: NodeId
    kind: Literal["lineage_tree"]
    doc_ref: DocRef


# ---------------------------------------------------------------------------
# Allowlisted Actions (4) + Graph Action Payloads (5)
# ---------------------------------------------------------------------------


class AiFocusNodesAction(ContractModel):
    op: Literal["focus_nodes"]
    doc_refs: Annotated[list[DocRef], Field(min_length=1, max_length=8)]


class AiApplyFilterAction(ContractModel):
    op: Literal["apply_filter"]
    department_ref: DepartmentRef | None = None
    type_code: GraphTypeCode | None = None
    collection_ref: CollectionRef | None = None
    reader_scope: GraphReaderScope | None = None
    validity: Literal["CURRENT", "EXPIRING_SOON"] | None = None

    @model_validator(mode="after")
    def validate_non_empty(self) -> AiApplyFilterAction:
        if (
            self.department_ref is None
            and self.type_code is None
            and self.collection_ref is None
            and self.reader_scope is None
            and self.validity is None
        ):
            raise ValueError("apply_filter requires at least one filter facet")
        return self


class AiIsolateBranchAction(ContractModel):
    op: Literal["isolate_branch"]
    branch_kind: Literal["department", "collection", "type"]
    branch_ref: Annotated[str, Field(min_length=1, max_length=64)]


class AiToggleLinksAction(ContractModel):
    op: Literal["toggle_links"]
    enabled: bool
    relationship_types: (
        Annotated[list[DocumentRelationshipType], Field(min_length=1, max_length=3)] | None
    ) = None


class AiPinToContextAction(ContractModel):
    op: Literal["pin_to_context"]
    doc_refs: Annotated[list[DocRef], Field(min_length=1, max_length=8)]


AiGraphActionPayload = (
    AiFocusNodesAction
    | AiApplyFilterAction
    | AiIsolateBranchAction
    | AiToggleLinksAction
    | AiPinToContextAction
)


class AiGraphActionNode(ContractModel):
    id: NodeId
    kind: Literal["graph_action"]
    label: Annotated[str, Field(min_length=1, max_length=48)]
    action: AiGraphActionPayload


class AiOpenReaderNode(ContractModel):
    id: NodeId
    kind: Literal["open_reader"]
    label: Annotated[str, Field(min_length=1, max_length=48)]
    doc_ref: DocRef
    block_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    page: Annotated[int, Field(ge=1, le=100_000, strict=True)] | None = None


class AiWorkflowHandoffNode(ContractModel):
    id: NodeId
    kind: Literal["workflow_handoff"]
    label: Annotated[str, Field(min_length=1, max_length=48)]
    handoff: WorkflowHandoffKind
    doc_ref: DocRef


class AiPromptChipNode(ContractModel):
    id: NodeId
    kind: Literal["prompt_chip"]
    label: Annotated[str, Field(min_length=1, max_length=60)]
    prompt: Annotated[str, Field(min_length=1, max_length=400)]


AiSurfaceNode = (
    AiStackNode
    | AiRowNode
    | AiCardNode
    | AiSectionNode
    | AiTabsNode
    | AiSplitNode
    | AiProseNode
    | AiDocumentItemNode
    | AiGovernanceKvNode
    | AiComparisonTableNode
    | AiCalloutNode
    | AiMetricStripNode
    | AiLineageTreeNode
    | AiGraphActionNode
    | AiOpenReaderNode
    | AiWorkflowHandoffNode
    | AiPromptChipNode
)


class AiSurfaceDraft(ContractModel):
    schema_version: Literal[1] = 1
    root_id: NodeId
    nodes: Annotated[list[AiSurfaceNode], Field(min_length=1, max_length=32)]


class GenerationV3Request(ContractModel):
    contract_version: Literal[3] = 3
    purpose: Literal["PUBLISHED_CHAT"] = "PUBLISHED_CHAT"
    request_id: UUID
    organization_id: UUID
    query: Annotated[str, Field(min_length=1, max_length=4_000)]
    history: Annotated[list[DialogueTurn], Field(max_length=4)] = Field(default_factory=list)
    evidence: Annotated[list[Evidence], Field(min_length=1, max_length=8)]
    source_catalog: Annotated[list[SourceCatalogEntry], Field(min_length=1, max_length=8)]
    ui_surface_mode: UiSurfaceMode = "AUTO"

    @model_validator(mode="after")
    def validate_budget_and_catalog(self) -> GenerationV3Request:
        if len({chunk.chunk_id for chunk in self.evidence}) != len(self.evidence):
            raise ValueError("duplicate generation evidence")
        if sum(len(chunk.content) for chunk in self.evidence) > 64_000:
            raise ValueError("evidence exceeds generation budget")
        if sum(len(turn.question) + len(turn.answer) for turn in self.history) > 24_000:
            raise ValueError("history exceeds generation budget")
        doc_refs = [entry.doc_ref for entry in self.source_catalog]
        if len(set(doc_refs)) != len(doc_refs):
            raise ValueError("duplicate sourceCatalog docRef")
        return self


class GenerationV3Response(ContractModel):
    contract_version: Literal[3] = 3
    request_id: UUID
    status: Literal["ANSWERED", "INSUFFICIENT_EVIDENCE"]
    answer: Annotated[str, Field(min_length=1, max_length=12_000)]
    citations: Annotated[list[EvidenceCitation], Field(max_length=12)]
    used_evidence: Annotated[list[Sha256], Field(min_length=1, max_length=8)]
    ui_surface: AiSurfaceDraft | None
    ui_surface_status: UiSurfaceStatus

    @model_validator(mode="after")
    def validate_status(self) -> GenerationV3Response:
        if (self.status == "ANSWERED") != bool(self.citations):
            raise ValueError("answer status and citations disagree")
        if len(set(self.used_evidence)) != len(self.used_evidence):
            raise ValueError("duplicate used evidence")
        if any(citation.chunk_id not in self.used_evidence for citation in self.citations):
            raise ValueError("citation exceeds the generation input set")
        if self.status == "INSUFFICIENT_EVIDENCE":
            if self.ui_surface is not None or self.ui_surface_status != "OMITTED_INSUFFICIENT":
                raise ValueError(
                    "INSUFFICIENT_EVIDENCE requires uiSurface=None and "
                    "uiSurfaceStatus=OMITTED_INSUFFICIENT"
                )
        elif self.ui_surface_status == "OMITTED_INSUFFICIENT":
            raise ValueError("OMITTED_INSUFFICIENT is only valid for INSUFFICIENT_EVIDENCE")
        elif self.ui_surface_status == "GENERATED":
            if self.ui_surface is None:
                raise ValueError("GENERATED requires a non-null uiSurface")
        elif self.ui_surface is not None:
            raise ValueError("non-GENERATED uiSurfaceStatus requires uiSurface=None")
        return self
