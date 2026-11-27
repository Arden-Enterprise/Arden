import "@xyflow/react/dist/style.css";
import { canPinGraphDocument } from "./context-basket";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { GraphDocumentNode, GraphReaderScope } from "@arden/domain";
import { Icon, type IconName } from "../shared/Icon";
import type { GraphNodeData, GraphPositionedEdge, GraphPositionedNode } from "./layout";

export interface GraphCanvasProps {
  nodes: readonly GraphPositionedNode[];
  edges: readonly GraphPositionedEdge[];
  selectedNodeId: string | null;
  focusNodeIds: readonly string[];
  focusNonce: number;
  pinnedDocumentIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string | null) => void;
  onToggleBranch: (branchId: string, nextCollapsed: boolean) => void;
  onOpenDocument: (document: GraphDocumentNode) => void;
  onManageLinks?: (document: GraphDocumentNode) => void;
  onPinDocument?: (document: GraphDocumentNode) => void;
  onPinBranch?: (branch: { kind: string; id: string; label: string; documentIds: string[] }) => void;
  onReportIssue?: (document: GraphDocumentNode) => void;
}

interface GraphCanvasActionsContextValue {
  selectedNodeId: string | null;
  pinnedDocumentIds: ReadonlySet<string>;
  onToggleBranch: (branchId: string, nextCollapsed: boolean) => void;
  onPinBranch?: (branch: { kind: string; id: string; label: string; documentIds: string[] }) => void;
  /** Tooltip warmup: 300ms delay for first tooltip, then 0ms instant across adjacent cards. */
  tooltipWarm: boolean;
  onTooltipShown: () => void;
  onTooltipLeave: () => void;
}

const GraphCanvasActionsContext = createContext<GraphCanvasActionsContextValue>({
  selectedNodeId: null,
  pinnedDocumentIds: new Set(),
  onToggleBranch: () => undefined,
  tooltipWarm: false,
  onTooltipShown: () => undefined,
  onTooltipLeave: () => undefined,
});

const SCOPE_BADGES: Record<GraphReaderScope, { icon: IconName; label: string }> = {
  ORGANIZATION: { icon: "building", label: "Organization" },
  DEPARTMENT: { icon: "people", label: "Department" },
  SELECTED_MEMBERS: { icon: "lock", label: "Selected" },
  LEGACY_AUDIENCE: { icon: "layers", label: "Legacy" },
};

function iconForBranch(kind: GraphNodeData["kind"]): IconName {
  switch (kind) {
    case "department":
      return "building";
    case "type":
      return "layers";
    case "collection":
    case "unassigned":
      return "folder";
    case "shared":
      return "people";
    default:
      return "graph";
  }
}

function openTargetLabel(doc: GraphDocumentNode): string {
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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function OrgCardNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className="graph-card graph-card-org" style={{ opacity: data.opacity }}>
      <div className="graph-card-head">
        <span className="graph-card-icon" aria-hidden="true">
          <Icon name="organization" size={15} />
        </span>
        <span className="graph-card-title" title={data.label}>{data.label}</span>
      </div>
      <div className="graph-card-foot">
        <span className="graph-card-subtitle">{data.subtitle ?? "Organization"}</span>
        <span className="graph-count-pill">
          {data.matchCount !== data.totalCount ? `${data.matchCount}/${data.totalCount}` : data.totalCount}
          {data.partialCounts ? " · Partial" : ""}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="graph-handle" isConnectable={false} />
    </div>
  );
}

function BranchCardNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { selectedNodeId, onToggleBranch, onPinBranch } = useContext(GraphCanvasActionsContext);
  const selected = selectedNodeId === data.id;
  const countText = data.matchCount !== data.totalCount
    ? `${data.matchCount}/${data.totalCount}`
    : `${data.totalCount}`;

  return (
    <div
      className={`graph-card graph-card-branch${selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}`}
      style={{ opacity: data.opacity }}
    >
      <Handle type="target" position={Position.Left} className="graph-handle" isConnectable={false} />
      <div className="graph-card-head">
        {data.hasChildren && (
          <button
            type="button"
            className="graph-branch-toggle"
            aria-expanded={!data.collapsed}
            aria-label={data.collapsed ? `Expand ${data.label}` : `Collapse ${data.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleBranch(data.id, !data.collapsed);
            }}
          >
            <Icon name="chevron" size={11} />
          </button>
        )}
        <span className="graph-card-icon" aria-hidden="true">
          <Icon name={iconForBranch(data.kind)} size={14} />
        </span>
        <span className="graph-card-title" title={data.label}>{data.label}</span>
      </div>
      <div className="graph-card-foot">
        {data.subtitle && <span className="graph-card-subtitle">{data.subtitle}</span>}
        <span className="graph-count-pill">
          {countText}
          {data.partialCounts ? " · Partial" : ""}
        </span>
        {onPinBranch && data.branchKind && data.branchId && (
          <button
            type="button"
            className="graph-card-mini-pin"
            aria-label={`Pin ${data.label} to Ask Arden`}
            disabled={data.documentIds.length === 0}
            title={data.documentIds.length === 0 ? "No matching documents in this branch to pin" : "Pin branch to Ask Arden"}
            onClick={(event) => {
              event.stopPropagation();
              if (data.documentIds.length === 0) return;
              onPinBranch({
                kind: data.branchKind!,
                id: data.branchId!,
                label: data.label,
                documentIds: data.documentIds,
              });
            }}
          >
            Pin
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="graph-handle" isConnectable={false} />
    </div>
  );
}

function DocumentCardNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { selectedNodeId, pinnedDocumentIds, tooltipWarm, onTooltipShown, onTooltipLeave } = useContext(GraphCanvasActionsContext);
  const doc = data.document;
  const [tooltip, setTooltip] = useState<"animated" | "instant" | null>(null);
  const tooltipTimer = useRef<number | null>(null);
  const cancelTooltipDelay = useCallback(() => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
  }, []);

  useEffect(() => cancelTooltipDelay, [cancelTooltipDelay]);
  useEffect(() => {
    if (!tooltip) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTooltip(null);
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [tooltip]);

  if (!doc) return null;

  const selected = selectedNodeId === data.id;
  const pinned = pinnedDocumentIds.has(doc.documentId);
  const scopeMeta = SCOPE_BADGES[doc.readerScope];
  const openCases = doc.monitorSignals?.openMaintenanceCaseCount ?? null;

  return (
    <div
      className={`graph-card graph-card-document${selected ? " is-selected" : ""}${pinned ? " is-pinned" : ""}${data.dimmed ? " is-dimmed" : ""}`}
      style={{ opacity: data.opacity }}
      onMouseEnter={() => {
        if (tooltipWarm || prefersReducedMotion()) {
          setTooltip("instant");
          onTooltipShown();
        } else {
          tooltipTimer.current = window.setTimeout(() => {
            tooltipTimer.current = null;
            setTooltip("animated");
            onTooltipShown();
          }, 300);
        }
      }}
      onMouseLeave={() => {
        cancelTooltipDelay();
        setTooltip(null);
        onTooltipLeave();
      }}
    >
      <Handle type="target" position={Position.Left} className="graph-handle" isConnectable={false} />
      <div className="graph-card-head">
        <span className="graph-card-icon" aria-hidden="true">
          <Icon name="document" size={14} />
        </span>
        <span className="graph-card-title" title={doc.title}>{doc.title}</span>
        {pinned && <span className="graph-pinned-dot" role="img" aria-label="Pinned to Ask Arden" title="Pinned" />}
      </div>

      {tooltip && (
        <div
          className="graph-node-tooltip"
          role="tooltip"
          data-instant={tooltip === "instant" ? "true" : undefined}
        >
          {doc.title}
        </div>
      )}

      <div className="graph-card-meta">
        <span className="graph-type-badge">{doc.type ?? "Uncategorized"}</span>
        <span className="graph-version-badge">v{doc.version}</span>
      </div>

      <div className="graph-card-foot">
        <span className="graph-scope-inline">
          <Icon name={scopeMeta.icon} size={11} />
          <span>{scopeMeta.label}</span>
        </span>

        <span className="graph-card-signals">
          {doc.validityStatus === "Expired" && (
            <span className="graph-chip is-danger">
              <Icon name="warning" size={10} />
              Expired
            </span>
          )}
          {doc.validityStatus === "Expiring soon" && (
            <span className="graph-chip is-warning">
              <Icon name="calendar" size={10} />
              {doc.daysUntilExpiry === 0 ? "Today" : `${doc.daysUntilExpiry}d`}
            </span>
          )}
          {openCases !== null && openCases > 0 && (
            <span className="graph-chip is-danger">
              <Icon name="flag" size={10} />
              {openCases} {openCases === 1 ? "case" : "cases"}
            </span>
          )}
          {doc.monitorSignals?.isUnassignedOrgDoc && (
            <span className="graph-chip is-warning">
              <Icon name="folder" size={10} />
              Unassigned
            </span>
          )}
          {doc.monitorSignals?.requiresAuditedInspection && (
            <span className="graph-chip is-info">
              <Icon name="shield" size={10} />
              Inspect
            </span>
          )}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="graph-handle" isConnectable={false} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  orgNode: OrgCardNode,
  branchNode: BranchCardNode,
  documentNode: DocumentCardNode,
};

function GraphCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  focusNodeIds,
  focusNonce,
  pinnedDocumentIds,
  onSelectNode,
  onToggleBranch,
  onOpenDocument,
  onManageLinks,
  onPinDocument,
  onPinBranch,
  onReportIssue,
}: GraphCanvasProps) {
  const reactFlow = useReactFlow();
  const [tooltipWarm, setTooltipWarm] = useState(false);
  const coolTimer = useRef<number | null>(null);
  const glideActiveRef = useRef(false);
  const glideTimerRef = useRef<number | null>(null);
  const initialFitDone = useRef(false);

  const interruptCameraGlide = useCallback(() => {
    if (!glideActiveRef.current) return;
    glideActiveRef.current = false;
    if (glideTimerRef.current !== null) {
      window.clearTimeout(glideTimerRef.current);
      glideTimerRef.current = null;
    }
    try {
      const current = reactFlow.getViewport();
      void reactFlow.setViewport(current, { duration: 0 });
    } catch {
      /* Ignore when unmounted or mocked. */
    }
  }, [reactFlow]);

  const startCameraGlide = useCallback((run: (duration: number) => void) => {
    const duration = prefersReducedMotion() ? 0 : 280;
    if (glideTimerRef.current !== null) window.clearTimeout(glideTimerRef.current);
    glideActiveRef.current = duration > 0;
    run(duration);
    if (duration > 0) {
      glideTimerRef.current = window.setTimeout(() => {
        glideActiveRef.current = false;
        glideTimerRef.current = null;
      }, duration + 20);
    }
  }, []);

  useEffect(() => () => {
    if (coolTimer.current !== null) window.clearTimeout(coolTimer.current);
    if (glideTimerRef.current !== null) window.clearTimeout(glideTimerRef.current);
  }, []);

  // Initial fitView on first non-empty render; kept stable across AgentPanel container resizes.
  useEffect(() => {
    if (initialFitDone.current || nodes.length === 0) return;
    initialFitDone.current = true;
    if (focusNonce > 0) return;
    startCameraGlide((duration) => {
      void reactFlow.fitView({ padding: 0.16, duration, maxZoom: 1.1 });
    });
  }, [focusNonce, nodes.length, reactFlow, startCameraGlide]);

  // Interruptible camera glide when focus_nodes / focusDocumentId intent arrives.
  const lastHandledFocusNonce = useRef(0);
  useEffect(() => {
    if (focusNonce === 0 || focusNonce === lastHandledFocusNonce.current || nodes.length === 0) return;
    if (focusNodeIds.length === 0) {
      lastHandledFocusNonce.current = focusNonce;
      startCameraGlide((duration) => { void reactFlow.fitView({ padding: 0.16, duration, maxZoom: 1.1 }); });
      return;
    }
    const targets = focusNodeIds
      .map((id) => nodes.find((node) => node.id === id || node.id === `doc:${id}`))
      .filter((node): node is GraphPositionedNode => Boolean(node));
    if (targets.length === 0) return;

    lastHandledFocusNonce.current = focusNonce;
    startCameraGlide((duration) => {
      if (targets.length === 1) {
        const target = targets[0]!;
        void reactFlow.setCenter(
          target.position.x + target.width / 2,
          target.position.y + target.height / 2,
          { zoom: 1, duration },
        );
      } else {
        void reactFlow.fitView({
          nodes: targets.map((item) => ({ id: item.id })),
          padding: 0.24,
          duration,
          maxZoom: 1.1,
        });
      }
    });
  }, [focusNonce, focusNodeIds, nodes, reactFlow, startCameraGlide]);

  const rfNodes = useMemo<Node<GraphNodeData>[]>(
    () => nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      width: node.width,
      height: node.height,
      selected: node.id === selectedNodeId,
      data: node.data,
    })),
    [nodes, selectedNodeId],
  );

  const rfEdges = useMemo<Edge[]>(
    () => edges.map((edge) => {
      const isRel = edge.kind === "relationship";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.label,
        animated: false,
        className: isRel
          ? `graph-edge-rel graph-edge-rel-${edge.relationshipType?.toLowerCase() ?? "related"}`
          : "graph-edge-hierarchy",
        style: {
          opacity: edge.opacity,
        },
        markerEnd: isRel ? { type: MarkerType.ArrowClosed, width: 14, height: 14 } : undefined,
      };
    }),
    [edges],
  );

  const selectedDocument = useMemo<GraphDocumentNode | null>(() => {
    if (!selectedNodeId) return null;
    const found = nodes.find((node) => node.id === selectedNodeId);
    return found?.data.document ?? null;
  }, [nodes, selectedNodeId]);

  const [exitingDocument, setExitingDocument] = useState<GraphDocumentNode | null>(null);
  const lastSelectedRef = useRef<GraphDocumentNode | null>(null);
  const toolbarExitTimer = useRef<number | null>(null);

  useEffect(() => {
    if (selectedDocument) {
      if (toolbarExitTimer.current !== null) {
        window.clearTimeout(toolbarExitTimer.current);
        toolbarExitTimer.current = null;
      }
      lastSelectedRef.current = selectedDocument;
      setExitingDocument(null);
    } else if (lastSelectedRef.current) {
      const previous = lastSelectedRef.current;
      lastSelectedRef.current = null;
      if (prefersReducedMotion()) {
        setExitingDocument(null);
      } else {
        setExitingDocument(previous);
        toolbarExitTimer.current = window.setTimeout(() => {
          toolbarExitTimer.current = null;
          setExitingDocument(null);
        }, 125);
      }
    }
  }, [selectedDocument]);

  useEffect(() => () => {
    if (toolbarExitTimer.current !== null) window.clearTimeout(toolbarExitTimer.current);
  }, []);

  const toolbarDocument = selectedDocument ?? exitingDocument;
  const toolbarExiting = !selectedDocument && exitingDocument !== null;
  const isSelectedPinned = toolbarDocument ? pinnedDocumentIds.has(toolbarDocument.documentId) : false;

  const actionsContextValue = useMemo<GraphCanvasActionsContextValue>(
    () => ({
      selectedNodeId,
      pinnedDocumentIds,
      onToggleBranch,
      onPinBranch,
      tooltipWarm,
      onTooltipShown: () => {
        if (coolTimer.current !== null) {
          window.clearTimeout(coolTimer.current);
          coolTimer.current = null;
        }
        setTooltipWarm(true);
      },
      onTooltipLeave: () => {
        if (coolTimer.current !== null) window.clearTimeout(coolTimer.current);
        coolTimer.current = window.setTimeout(() => {
          setTooltipWarm(false);
          coolTimer.current = null;
        }, 420);
      },
    }),
    [selectedNodeId, pinnedDocumentIds, onToggleBranch, onPinBranch, tooltipWarm],
  );

  return (
    <GraphCanvasActionsContext.Provider value={actionsContextValue}>
      <div
        className="graph-canvas-stage"
        onPointerDown={interruptCameraGlide}
        onWheel={interruptCameraGlide}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            interruptCameraGlide();
          }
          if (event.key === "Escape" && selectedNodeId) {
            onSelectNode(null);
          }
        }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          minZoom={0.25}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_event, node) => {
            onSelectNode(node.id);
          }}
          onPaneClick={() => onSelectNode(null)}
        >
          <Background gap={22} size={1} color="var(--arden-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {toolbarDocument && (
          <div
            className={`graph-floating-toolbar${toolbarExiting ? " is-exiting" : ""}`}
            role={toolbarExiting ? undefined : "toolbar"}
            aria-label={toolbarExiting ? undefined : `Actions for ${toolbarDocument.title}`}
            aria-hidden={toolbarExiting ? "true" : undefined}
          >
            <div className="graph-floating-toolbar-title" title={toolbarDocument.title}>
              <strong>{toolbarDocument.title}</strong>
              <small>
                {toolbarDocument.type ?? "Uncategorized"} · v{toolbarDocument.version} · {toolbarDocument.ownerDepartmentName}
              </small>
            </div>
            <div className="graph-floating-toolbar-actions">
              <button
                type="button"
                className="primary-button graph-toolbar-btn"
                disabled={toolbarExiting}
                onClick={() => onOpenDocument(toolbarDocument)}
              >
                <Icon name="open-external" size={13} />
                {openTargetLabel(toolbarDocument)}
              </button>
              {toolbarDocument.canEditRelationships && onManageLinks && (
                <button
                  type="button"
                  className="secondary-button graph-toolbar-btn"
                  disabled={toolbarExiting}
                  onClick={() => onManageLinks(toolbarDocument)}
                >
                  <Icon name="branch" size={13} />
                  Manage links
                </button>
              )}
              {onPinDocument && canPinGraphDocument(toolbarDocument) && (
                <button
                  type="button"
                  className="secondary-button graph-toolbar-btn"
                  disabled={toolbarExiting}
                  aria-pressed={isSelectedPinned}
                  onClick={() => onPinDocument(toolbarDocument)}
                >
                  <Icon name="star" size={13} />
                  {isSelectedPinned ? "Unpin" : "Pin to Ask Arden"}
                </button>
              )}
              {onReportIssue && canPinGraphDocument(toolbarDocument) && (
                <button
                  type="button"
                  className="secondary-button graph-toolbar-btn"
                  disabled={toolbarExiting}
                  onClick={() => onReportIssue(toolbarDocument)}
                >
                  <Icon name="flag" size={13} />
                  Report issue
                </button>
              )}
              <button
                type="button"
                className="island-icon-button graph-toolbar-close"
                aria-label="Close selection toolbar"
                disabled={toolbarExiting}
                onClick={() => onSelectNode(null)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </GraphCanvasActionsContext.Provider>
  );
}

/** Lazy-loaded React Flow Knowledge Graph canvas with fixed Island node cards and origin-aware action toolbar. */
export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
