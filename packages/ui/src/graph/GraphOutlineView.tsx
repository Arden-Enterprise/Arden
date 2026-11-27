import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { canPinGraphDocument } from "./context-basket";
import type { DocumentRelationshipType, GraphDocumentNode, GraphReaderScope } from "@arden/domain";
import { Icon, type IconName } from "../shared/Icon";
import type { GraphPositionedEdge, OutlineNode } from "./layout";

export interface GraphOutlineViewProps {
  rows: readonly OutlineNode[];
  edges: readonly GraphPositionedEdge[];
  selectedNodeId: string | null;
  pinnedDocumentIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string | null) => void;
  onToggleBranch: (branchId: string, nextCollapsed: boolean) => void;
  onOpenDocument: (document: GraphDocumentNode) => void;
  onManageLinks?: (document: GraphDocumentNode) => void;
  onPinDocument?: (document: GraphDocumentNode) => void;
  onPinBranch?: (branch: { kind: string; id: string; label: string; documentIds: string[] }) => void;
  onReportIssue?: (document: GraphDocumentNode) => void;
}

const SCOPE_LABELS: Record<GraphReaderScope, { icon: IconName; label: string }> = {
  ORGANIZATION: { icon: "building", label: "Organization" },
  DEPARTMENT: { icon: "people", label: "Department" },
  SELECTED_MEMBERS: { icon: "lock", label: "Selected" },
  LEGACY_AUDIENCE: { icon: "layers", label: "Legacy" },
};
const RELATIONSHIP_LABELS: Record<DocumentRelationshipType, string> = {
  REFERENCES: "references",
  RELATED: "is related to",
  SUPERSEDES: "supersedes",
};

function iconForKind(kind: OutlineNode["kind"]): IconName {
  switch (kind) {
    case "org":
      return "organization";
    case "department":
      return "building";
    case "type":
      return "layers";
    case "collection":
    case "unassigned":
      return "folder";
    case "shared":
      return "people";
    case "document":
      return "document";
  }
}

function openLabelFor(doc: GraphDocumentNode): string {
  switch (doc.openTarget) {
    case "MY_CONTRIBUTIONS":
      return "Open in Contributions";
    case "ADMIN_INSPECTION":
      return "Inspect in Admin";
    case "RESPONSIBLE_VIEW":
      return "Responsible view";
    case "READER":
    default:
      return "Open";
  }
}

/**
 * Full WCAG 2.2 AA `role="treegrid"` parity surface for `/graph`.
 * Shares the exact same `OutlineNode[]` tree as `GraphCanvas` with zero animation (`0ms`) on keyboard movement.
 */
export function GraphOutlineView({
  rows,
  edges,
  selectedNodeId,
  pinnedDocumentIds,
  onSelectNode,
  onToggleBranch,
  onOpenDocument,
  onManageLinks,
  onPinDocument,
  onPinBranch,
  onReportIssue,
}: GraphOutlineViewProps) {
  const [focusedRowId, setFocusedRowId] = useState<string | null>(() => selectedNodeId ?? rows[0]?.id ?? null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const crossLinks = useMemo(() => {
    const names = new Map(rows.map((row) => [row.id, row.label]));
    return edges.flatMap((edge) => {
      const source = names.get(edge.source), target = names.get(edge.target);
      return edge.kind === "relationship" && edge.relationshipType && source && target
        ? [{ id: edge.id, source, target, label: RELATIONSHIP_LABELS[edge.relationshipType] }]
        : [];
    });
  }, [edges, rows]);

  useEffect(() => {
    if (selectedNodeId && rows.some((row) => row.id === selectedNodeId)) {
      setFocusedRowId(selectedNodeId);
    } else if (!focusedRowId || !rows.some((row) => row.id === focusedRowId)) {
      setFocusedRowId(rows[0]?.id ?? null);
    }
  }, [rows, selectedNodeId, focusedRowId]);

  const focusRowAt = (index: number) => {
    const target = rows[index];
    if (!target) return;
    setFocusedRowId(target.id);
    onSelectNode(target.id);
    rowRefs.current.get(target.id)?.focus();
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, row: OutlineNode, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (event.target !== event.currentTarget) {
        rowRefs.current.get(row.id)?.focus();
      } else {
        onSelectNode(null);
      }
      return;
    }

    // Allow buttons inside cells to handle Enter/Space natively without swallowing them.
    if (event.target !== event.currentTarget) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRowAt(Math.min(rows.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRowAt(Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        focusRowAt(0);
        break;
      case "End":
        event.preventDefault();
        focusRowAt(rows.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (row.hasChildren) {
          if (!row.expanded) {
            onToggleBranch(row.id, false);
          } else if (rows[index + 1]?.parentId === row.id) {
            focusRowAt(index + 1);
          }
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.hasChildren && row.expanded) {
          onToggleBranch(row.id, true);
        } else if (row.parentId) {
          const parentIndex = rows.findIndex((item) => item.id === row.parentId);
          if (parentIndex >= 0) focusRowAt(parentIndex);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (row.document) {
          onOpenDocument(row.document);
        } else if (row.hasChildren) {
          onToggleBranch(row.id, row.expanded);
        }
        break;
      case " ":
        event.preventDefault();
        onSelectNode(row.id);
        break;
      case "p":
      case "P":
        if (row.document && onPinDocument && canPinGraphDocument(row.document)) {
          event.preventDefault();
          onPinDocument(row.document);
        } else if (!row.document && row.branchKind && row.branchId && onPinBranch && row.documentIds.length > 0) {
          event.preventDefault();
          onPinBranch({
            kind: row.branchKind,
            id: row.branchId,
            label: row.label,
            documentIds: row.documentIds,
          });
        }
        break;
    }
  };

  const activeId = focusedRowId && rows.some((r) => r.id === focusedRowId)
    ? focusedRowId
    : (rows[0]?.id ?? null);

  return (
    <div className="graph-outline-wrapper island">
      {crossLinks.length > 0 && <details className="graph-outline-links">
        <summary>Cross-links ({crossLinks.length})</summary>
        <ul>
          {crossLinks.map(({ id, source, target, label }) => <li key={id}>
            <strong>{source}</strong> {label} <strong>{target}</strong>
          </li>)}
        </ul>
      </details>}
      <div
        role="treegrid"
        aria-label="Knowledge Graph outline"
        aria-readonly="true"
        className="graph-treegrid"
      >
        <div role="row" className="graph-treegrid-header">
          <div role="columnheader">Name</div>
          <div role="columnheader">Type</div>
          <div role="columnheader">Scope</div>
          <div role="columnheader">Version</div>
          <div role="columnheader">Status</div>
          <div role="columnheader">Actions</div>
        </div>

        {rows.map((row, index) => {
          const doc = row.document;
          const isSelected = selectedNodeId === row.id;
          const isPinned = doc ? pinnedDocumentIds.has(doc.documentId) : false;
          const scopeMeta = doc ? SCOPE_LABELS[doc.readerScope] : null;
          const openCases = doc?.monitorSignals?.openMaintenanceCaseCount ?? null;

          return (
            <div
              key={row.id}
              ref={(el) => {
                if (el) rowRefs.current.set(row.id, el);
                else rowRefs.current.delete(row.id);
              }}
              role="row"
              aria-level={row.level}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={isSelected}
              tabIndex={row.id === activeId ? 0 : -1}
              className={`graph-treegrid-row${isSelected ? " is-selected" : ""}${row.dimmed ? " is-dimmed" : ""}${isPinned ? " is-pinned" : ""}`}
              onClick={() => {
                setFocusedRowId(row.id);
                onSelectNode(row.id);
              }}
              onKeyDown={(event) => handleRowKeyDown(event, row, index)}
            >
              <div role="gridcell" className="graph-treegrid-name" style={{ paddingLeft: `${(row.level - 1) * 18 + 10}px` }}>
                {row.hasChildren ? (
                  <button
                    type="button"
                    className="graph-tree-expand-btn"
                    tabIndex={-1}
                    aria-label={row.expanded ? `Collapse ${row.label}` : `Expand ${row.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleBranch(row.id, row.expanded);
                    }}
                  >
                    <Icon name="chevron" size={11} />
                  </button>
                ) : (
                  <span className="graph-tree-expand-spacer" aria-hidden="true" />
                )}
                <span className="graph-tree-kind-icon" aria-hidden="true">
                  <Icon name={iconForKind(row.kind)} size={14} />
                </span>
                <span className="graph-tree-label" title={row.label}>{row.label}</span>
                {!doc && row.badge && (
                  <span className="graph-count-pill">{row.badge}</span>
                )}
                {isPinned && (
                  <span className="graph-pinned-pill">Pinned</span>
                )}
              </div>

              <div role="gridcell" className="graph-treegrid-cell">
                {doc ? (doc.type ?? "Uncategorized") : "—"}
              </div>

              <div role="gridcell" className="graph-treegrid-cell">
                {scopeMeta ? (
                  <span className="graph-scope-inline">
                    <Icon name={scopeMeta.icon} size={12} />
                    <span>{scopeMeta.label}</span>
                  </span>
                ) : "—"}
              </div>

              <div role="gridcell" className="graph-treegrid-cell graph-mono">
                {doc ? doc.version : "—"}
              </div>

              <div role="gridcell" className="graph-treegrid-cell graph-status-cell">
                {doc ? (
                  <span className="graph-status-group">
                    {doc.validityStatus === "Expired" ? (
                      <span className="graph-chip is-danger">
                        <Icon name="warning" size={11} />
                        Expired
                      </span>
                    ) : doc.validityStatus === "Expiring soon" ? (
                      <span className="graph-chip is-warning">
                        <Icon name="calendar" size={11} />
                        {doc.daysUntilExpiry === 0 ? "Expires today" : `Expires in ${doc.daysUntilExpiry}d`}
                      </span>
                    ) : (
                      <span className="graph-chip is-current">
                        <Icon name="check" size={11} />
                        Current
                      </span>
                    )}
                    {openCases !== null && openCases > 0 && (
                      <span className="graph-chip is-danger">
                        <Icon name="flag" size={11} />
                        {openCases} {openCases === 1 ? "case" : "cases"}
                      </span>
                    )}
                    {doc.monitorSignals?.isUnassignedOrgDoc && (
                      <span className="graph-chip is-warning">
                        <Icon name="folder" size={11} />
                        Unassigned
                      </span>
                    )}
                  </span>
                ) : "—"}
              </div>

              <div role="gridcell" className="graph-treegrid-actions">
                {doc ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button graph-inline-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDocument(doc);
                      }}
                    >
                      {openLabelFor(doc)}
                    </button>
                    {doc.canEditRelationships && onManageLinks && (
                      <button
                        type="button"
                        className="secondary-button graph-inline-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onManageLinks(doc);
                        }}
                      >
                        Manage links
                      </button>
                    )}
                    {onPinDocument && canPinGraphDocument(doc) && (
                      <button
                        type="button"
                        className="secondary-button graph-inline-btn"
                        aria-pressed={isPinned}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPinDocument(doc);
                        }}
                      >
                        {isPinned ? "Unpin" : "Pin"}
                      </button>
                    )}
                    {onReportIssue && canPinGraphDocument(doc) && (
                      <button
                        type="button"
                        className="secondary-button graph-inline-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onReportIssue(doc);
                        }}
                      >
                        Report
                      </button>
                    )}
                  </>
                ) : row.branchKind && row.branchId && onPinBranch ? (
                  <button
                    type="button"
                    className="secondary-button graph-inline-btn"
                    disabled={row.documentIds.length === 0}
                    title={row.documentIds.length === 0 ? "No matching documents in this branch to pin" : "Pin branch to Ask Arden"}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (row.documentIds.length === 0) return;
                      onPinBranch({
                        kind: row.branchKind!,
                        id: row.branchId!,
                        label: row.label,
                        documentIds: row.documentIds,
                      });
                    }}
                  >
                    Pin branch
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
