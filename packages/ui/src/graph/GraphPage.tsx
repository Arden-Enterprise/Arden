import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canPinGraphDocument } from "./context-basket";
import {
  documentRelationshipTypes,
  type GraphDocumentNode,
  type KnowledgeGraphPayload,
} from "@arden/domain";
import { useShellBridge } from "../app/ShellBridgeContext";
import { GovernanceActionDialog } from "../knowledge/GovernanceActionDialog";
import {
  ApiError,
  getKnowledgeGraph,
} from "../shared/api-client";
import { Icon } from "../shared/Icon";
import type { Platform } from "../shared/types";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { GraphCanvas } from "./GraphCanvas";
import { GraphFilterBar, type GraphDisplayMode } from "./GraphFilterBar";
import { GraphOutlineView } from "./GraphOutlineView";
import { GraphRelationshipDialog } from "./GraphRelationshipDialog";
import type { GraphIntent } from "./intent-bus";
import {
  computeGraphLayout,
  type ElkLayoutFn,
  type GraphLayoutResult,
} from "./layout";
import {
  defaultGraphFilterState,
  hasActiveFacetFilters,
  parseGraphSearch,
  serializeGraphSearch,
  toClientFilters,
  toServerGraphQuery,
  type GraphFilterState,
} from "./query-state";

export interface GraphPageProps extends ContextControlProps {
  platform: Platform;
  organizationId: string;
  organizationName?: string;
  /** Handles opening a document according to its server-computed `openTarget`. */
  onOpenDocument?: (document: GraphDocumentNode) => void;
  /** When true, `RESPONSIBLE_VIEW` documents open directly in an in-place read-only dialog. */
  openResponsibleViewInPlace?: boolean;
  pinnedDocumentIds?: ReadonlySet<string> | readonly string[];
  onPinDocument?: (document: GraphDocumentNode) => void;
  onPinBranch?: (label: string, documents: readonly GraphDocumentNode[], truncated: boolean) => void;
  onUnfilteredSnapshot?: (documents: readonly GraphDocumentNode[]) => void;
  /** Optional injectable ELK runner for deterministic tests. */
  elkLayoutFn?: ElkLayoutFn;
}

function initialDisplayMode(): GraphDisplayMode {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    if (window.matchMedia("(max-width: 767px)").matches) return "outline";
  }
  return "canvas";
}

function GraphLoadingSkeleton() {
  return (
    <div
      className="graph-skeleton island"
      role="status"
      aria-busy="true"
      aria-label="Loading Knowledge Graph"
    >
      <div className="graph-skeleton-column">
        <div className="graph-skeleton-card is-branch" />
      </div>
      <div className="graph-skeleton-column">
        <div className="graph-skeleton-card is-branch" />
        <div className="graph-skeleton-card is-branch" />
      </div>
      <div className="graph-skeleton-column">
        <div className="graph-skeleton-card is-doc" />
        <div className="graph-skeleton-card is-doc" />
        <div className="graph-skeleton-card is-doc" />
      </div>
    </div>
  );
}

/**
 * Authorized, tree-first Knowledge Graph workspace (`/graph`).
 * Lazy-loaded by `ArdenShell` so `@xyflow/react`, `d3-hierarchy`, and `elk.bundled.js`
 * never land in Home's initial bundle.
 */
export function GraphPage({
  platform,
  organizationId,
  organizationName,
  contextOpen,
  onToggleContext,
  onOpenDocument,
  openResponsibleViewInPlace = false,
  pinnedDocumentIds: rawPinnedIds,
  onPinDocument,
  onPinBranch,
  onUnfilteredSnapshot,
  elkLayoutFn,
}: GraphPageProps) {
  const shellBridge = useShellBridge();
  const [filterState, setFilterState] = useState<GraphFilterState>(() => (
    parseGraphSearch(shellBridge?.graphSearch ?? "")
  ));
  const [displayMode, setDisplayMode] = useState<GraphDisplayMode>(initialDisplayMode);
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(() => new Set());
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeIds, setFocusNodeIds] = useState<string[]>([]);
  const [focusNonce, setFocusNonce] = useState(0);
  const [serverFocusDocumentId, setServerFocusDocumentId] = useState<string | null>(() => filterState.focusDocumentId);

  const [payload, setPayload] = useState<KnowledgeGraphPayload | null>(null);
  const payloadRef = useRef<KnowledgeGraphPayload | null>(null);
  payloadRef.current = payload;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [serverTruncated, setServerTruncated] = useState(false);

  const [layout, setLayout] = useState<GraphLayoutResult | null>(null);
  const [relationshipDialogDoc, setRelationshipDialogDoc] = useState<GraphDocumentNode | null>(null);
  const [responsibleDoc, setResponsibleDoc] = useState<GraphDocumentNode | null>(null);

  const filterStateRef = useRef(filterState);
  const lastSyncedSearch = useRef<string>(shellBridge?.graphSearch ?? "");
  const requestIdRef = useRef(0);
  const layoutIdRef = useRef(0);
  const isolateFitPending = useRef(false);

  const pinnedSet = useMemo<ReadonlySet<string>>(() => {
    if (!rawPinnedIds) return new Set();
    return rawPinnedIds instanceof Set ? rawPinnedIds : new Set(rawPinnedIds);
  }, [rawPinnedIds]);

  const isLocallyFocusable = useCallback((ids: readonly string[]): boolean => {
    const currentPayload = payloadRef.current;
    return Boolean(
      currentPayload
      && !currentPayload.truncation.truncated
      && ids.length > 0
      && ids.every((id) => currentPayload.documents.some((doc) => doc.documentId === id)),
    );
  }, []);

  // Reset workspace state cleanly on organization change.
  useEffect(() => {
    setPayload(null);
    setLayout(null);
    setSelectedNodeId(null);
    setCollapsedBranchIds(new Set());
    setExpandedBranchIds(new Set());
    setServerFocusDocumentId(filterStateRef.current.focusDocumentId);
    setServerTruncated(false);
    setRelationshipDialogDoc(null);
    setResponsibleDoc(null);
  }, [organizationId]);

  // Reset manual expand overrides whenever active filters, view mode, or organization change.
  const filterResetKey = useMemo(
    () => JSON.stringify([
      organizationId,
      filterState.view,
      filterState.q,
      filterState.ownerDepartmentId,
      filterState.typeCode,
      filterState.collectionId,
      filterState.readerScope,
      filterState.validity,
      filterState.isolateMatching,
      filterState.monitor,
      filterState.onlyOpenCases,
      filterState.onlyUnassignedOrg,
    ]),
    [
      organizationId,
      filterState.view,
      filterState.q,
      filterState.ownerDepartmentId,
      filterState.typeCode,
      filterState.collectionId,
      filterState.readerScope,
      filterState.validity,
      filterState.isolateMatching,
      filterState.monitor,
      filterState.onlyOpenCases,
      filterState.onlyUnassignedOrg,
    ],
  );
  useEffect(() => {
    setExpandedBranchIds(new Set());
  }, [filterResetKey]);

  // Sync external URL / history changes (Web Back/Forward) into filterState.
  useEffect(() => {
    const external = shellBridge?.graphSearch ?? "";
    if (external === lastSyncedSearch.current) return;
    lastSyncedSearch.current = external;
    const parsed = parseGraphSearch(external);
    filterStateRef.current = parsed;
    setFilterState(parsed);
    if (parsed.focusDocumentId) {
      if (!isLocallyFocusable([parsed.focusDocumentId])) {
        setServerFocusDocumentId(parsed.focusDocumentId);
      }
      setSelectedNodeId(`doc:${parsed.focusDocumentId}`);
      setFocusNodeIds([parsed.focusDocumentId]);
      setFocusNonce((n) => n + 1);
      setCollapsedBranchIds(new Set());
    } else {
      setServerFocusDocumentId(null);
    }
  }, [shellBridge?.graphSearch, isLocallyFocusable]);

  const updateFilterState = useCallback(
    (updater: (current: GraphFilterState) => GraphFilterState, replace = false) => {
      const next = updater(filterStateRef.current);
      filterStateRef.current = next;
      setFilterState(next);
      const serialized = serializeGraphSearch(next);
      if (serialized !== lastSyncedSearch.current) {
        lastSyncedSearch.current = serialized;
        shellBridge?.setGraphSearch(serialized, { replace });
      }
    },
    [shellBridge],
  );

  // Subscribe to GraphIntentBus (identical across Web and Electron file://).
  const applyIntent = useCallback((intent: GraphIntent) => {
    switch (intent.type) {
      case "focus_nodes": {
        const firstId = intent.documentIds[0];
        if (!firstId) return;
        if (!isLocallyFocusable(intent.documentIds)) {
          setServerFocusDocumentId(firstId);
        }
        setSelectedNodeId(`doc:${firstId}`);
        setFocusNodeIds([...intent.documentIds]);
        setFocusNonce((n) => n + 1);
        setCollapsedBranchIds(new Set());
        updateFilterState((current) => ({ ...current, focusDocumentId: firstId }), true);
        break;
      }
      case "apply_filter": {
        updateFilterState((current) => ({
          ...current,
          ...(intent.ownerDepartmentId !== undefined ? { ownerDepartmentId: intent.ownerDepartmentId } : {}),
          ...(intent.typeCode !== undefined ? { typeCode: intent.typeCode } : {}),
          ...(intent.collectionId !== undefined ? { collectionId: intent.collectionId } : {}),
          ...(intent.readerScope !== undefined ? { readerScope: intent.readerScope } : {}),
          ...(intent.validity !== undefined ? { validity: intent.validity } : {}),
        }));
        break;
      }
      case "isolate_branch": {
        isolateFitPending.current = true;
        setSelectedNodeId(null);
        setFocusNodeIds([]);
        setServerFocusDocumentId(null);
        setCollapsedBranchIds(new Set());
        setExpandedBranchIds(new Set());
        updateFilterState((current) => {
          const isolated: GraphFilterState = {
            ...current,
            q: "",
            ownerDepartmentId: "",
            typeCode: "",
            collectionId: "",
            readerScope: "",
            validity: "",
            isolateMatching: true,
            focusDocumentId: null,
          };
          if (intent.branchKind === "department") {
            return { ...isolated, view: "accountability", ownerDepartmentId: intent.branchId };
          }
          if (intent.branchKind === "collection") {
            return { ...isolated, view: "collections", collectionId: intent.branchId };
          }
          return {
            ...isolated,
            view: "accountability",
            typeCode: intent.branchId as GraphFilterState["typeCode"],
          };
        });
        break;
      }
      case "toggle_links": {
        updateFilterState((current) => ({
          ...current,
          includeLinks: intent.enabled,
          ...(intent.relationshipTypes && intent.relationshipTypes.length > 0
            ? { relationshipTypes: [...intent.relationshipTypes] }
            : intent.enabled && current.relationshipTypes.length === 0
              ? { relationshipTypes: [...documentRelationshipTypes] }
              : {}),
        }));
        break;
      }
      case "open_graph": {
        const parsedSearch = intent.search !== undefined ? parseGraphSearch(intent.search) : null;
        const targetFocusId = intent.focusDocumentId ?? parsedSearch?.focusDocumentId ?? null;
        if (targetFocusId) {
          if (!isLocallyFocusable([targetFocusId])) {
            setServerFocusDocumentId(targetFocusId);
          }
        } else if (intent.search !== undefined) {
          setServerFocusDocumentId(null);
        }
        updateFilterState((current) => {
          const base = parsedSearch ?? current;
          return {
            ...base,
            ...(intent.view ? { view: intent.view } : {}),
            ...(intent.focusDocumentId ? { focusDocumentId: intent.focusDocumentId } : {}),
          };
        });
        if (targetFocusId) {
          setSelectedNodeId(`doc:${targetFocusId}`);
          setFocusNodeIds([targetFocusId]);
          setFocusNonce((n) => n + 1);
          setCollapsedBranchIds(new Set());
        }
        break;
      }
    }
  }, [updateFilterState, isLocallyFocusable]);

  useEffect(() => {
    if (!shellBridge) return;
    return shellBridge.graphIntentBus.subscribe((envelope) => {
      applyIntent(envelope.intent);
    });
  }, [shellBridge, applyIntent]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const onUnfilteredSnapshotRef = useRef(onUnfilteredSnapshot);
  onUnfilteredSnapshotRef.current = onUnfilteredSnapshot;

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  // Two-tier query key: re-fetch on server mode changes, and also on interactive facet changes when truncated.
  const serverQuery = useMemo(
    () => toServerGraphQuery({ ...filterState, focusDocumentId: serverFocusDocumentId }, serverTruncated),
    [filterState, serverFocusDocumentId, serverTruncated],
  );
  const serverQueryKey = useMemo(() => JSON.stringify(serverQuery), [serverQuery]);
  const serverQueryRef = useRef(serverQuery);
  serverQueryRef.current = serverQuery;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    const querySnapshot = serverQueryRef.current;
    const requestedWithFacets = hasActiveFacetFilters(filterStateRef.current);
    setLoading(true);
    setError("");

    void getKnowledgeGraph(platform, organizationId, querySnapshot)
      .then((nextPayload) => {
        if (!active || requestIdRef.current !== requestId) return;
        setPayload(nextPayload);
        const latest = filterStateRef.current;
        if (!nextPayload.truncation.truncated && !querySnapshot.monitor && !querySnapshot.focusDocumentId
          && !requestedWithFacets && !latest.monitor && !latest.focusDocumentId
          && !latest.isolateMatching && !hasActiveFacetFilters(latest)) {
          onUnfilteredSnapshotRef.current?.(nextPayload.documents);
        }
        if (nextPayload.truncation.truncated) {
          setServerTruncated(true);
        } else if (!requestedWithFacets && !hasActiveFacetFilters(latest)) {
          setServerTruncated(false);
        }
        if (latest.focusDocumentId && nextPayload.documents.some((d) => d.documentId === latest.focusDocumentId)) {
          setSelectedNodeId(`doc:${latest.focusDocumentId}`);
          const focusId = latest.focusDocumentId;
          setFocusNodeIds((current) => current[0] === focusId ? current : [focusId]);
          setFocusNonce((n) => n + 1);
        }
      })
      .catch((caught: unknown) => {
        if (!active || requestIdRef.current !== requestId) return;
        setError(caught instanceof ApiError ? caught.message : "Couldn’t load the Knowledge Graph.");
      })
      .finally(() => {
        if (active && requestIdRef.current === requestId) setLoading(false);
      });

    return () => { active = false; };
  }, [platform, organizationId, serverQueryKey, refreshTick]);

  // Run pure GraphLayoutEngine whenever payload, view mode, collapses, or client filters change.
  const clientFilters = useMemo(() => toClientFilters(filterState), [filterState]);
  const layoutFocusIds = useMemo(() => {
    const focusId = filterState.focusDocumentId;
    if (!focusId) return [];
    return focusNodeIds[0] === focusId ? focusNodeIds : [focusId];
  }, [filterState.focusDocumentId, focusNodeIds]);
  const effectiveCrossLinksOn = Boolean(
    filterState.includeLinks
    && payload?.appliedMode.includeLinksActive
    && filterState.relationshipTypes.length > 0,
  );

  useEffect(() => {
    if (!payload) {
      setLayout(null);
      return;
    }
    const runId = ++layoutIdRef.current;
    let active = true;
    void computeGraphLayout(payload, {
      viewMode: filterState.view,
      collapsedBranchIds,
      expandedBranchIds,
      filters: clientFilters,
      isolateMatching: filterState.isolateMatching,
      focusDocumentIds: layoutFocusIds,
      crossLinksOn: effectiveCrossLinksOn,
      elkLayoutFn,
    }).then((computed) => {
      if (active && layoutIdRef.current === runId) {
        setLayout(computed);
        if (isolateFitPending.current) {
          isolateFitPending.current = false;
          if (filterState.isolateMatching) setFocusNonce((nonce) => nonce + 1);
        }
      }
    });
    return () => { active = false; };
  }, [
    payload,
    filterState.view,
    filterState.isolateMatching,
    collapsedBranchIds,
    expandedBranchIds,
    clientFilters,
    layoutFocusIds,
    effectiveCrossLinksOn,
    elkLayoutFn,
  ]);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId === null) {
      setFocusNodeIds([]);
      setServerFocusDocumentId(null);
      if (filterStateRef.current.focusDocumentId !== null) {
        updateFilterState((current) => (
          current.focusDocumentId === null ? current : { ...current, focusDocumentId: null }
        ), true);
      }
    }
  }, [updateFilterState]);

  const handleToggleBranch = useCallback((branchId: string, nextCollapsed: boolean) => {
    setCollapsedBranchIds((current) => {
      const next = new Set(current);
      if (nextCollapsed) next.add(branchId);
      else next.delete(branchId);
      return next;
    });
    setExpandedBranchIds((current) => {
      const next = new Set(current);
      if (nextCollapsed) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setCollapsedBranchIds(new Set());
    setExpandedBranchIds(new Set());
    setServerFocusDocumentId(null);
    updateFilterState((current) => ({
      ...defaultGraphFilterState(),
      view: current.view,
      includeLinks: current.includeLinks,
      relationshipTypes: current.relationshipTypes,
      monitor: current.monitor,
    }));
  }, [updateFilterState]);

  const handleOpenDocument = useCallback((doc: GraphDocumentNode) => {
    if (openResponsibleViewInPlace && doc.openTarget === "RESPONSIBLE_VIEW") {
      setResponsibleDoc(doc);
    }
    onOpenDocument?.(doc);
  }, [onOpenDocument, openResponsibleViewInPlace]);

  const handleReportIssue = useCallback((doc: GraphDocumentNode) => {
    shellBridge?.openReportIssue({
      documentId: doc.documentId,
      publishedVersionId: doc.publishedVersionId,
      title: doc.title,
      versionLabel: doc.version,
    });
  }, [shellBridge]);

  const handlePinBranch = onPinBranch && payload && !loading
    ? (branch: { label: string; documentIds: string[] }) => {
      const branchIds = new Set<string>(branch.documentIds);
      onPinBranch(branch.label, payload.documents.filter((doc) => branchIds.has(doc.documentId) && canPinGraphDocument(doc)),
        payload.truncation.truncated);
    }
    : undefined;

  const capabilities = payload?.capabilities ?? {
    canUseMonitorMode: false,
    canIncludeExpired: false,
    canManageRelationships: false,
  };

  const breadcrumbOrg = organizationName || payload?.organization.name || "Arden";
  const isInitialLoading = loading && !payload;
  const isEmpty = Boolean(payload && layout && layout.nodes.length === 0);
  const canClearEmpty = hasActiveFacetFilters(filterState) || filterState.isolateMatching;

  return (
    <main
      id="arden-main"
      className="workspace-page graph-workspace-page"
      aria-labelledby="graph-workspace-title"
      tabIndex={-1}
    >
      <WorkspaceTopbar
        breadcrumb={`${breadcrumbOrg} / Graph`}
        contextOpen={contextOpen}
        onToggleContext={onToggleContext}
      />

      <div className="graph-page-body">
        <header className="graph-page-header">
          <div>
            <span className="meta-label">KNOWLEDGE</span>
            <h1 id="graph-workspace-title">Knowledge Graph</h1>
          </div>
          {payload?.appliedMode.monitorActive && (
            <span className="graph-monitor-active-chip">
              <Icon name="shield" size={13} />
              Monitor Mode active
            </span>
          )}
        </header>

        <GraphFilterBar
          state={filterState}
          displayMode={displayMode}
          departments={payload?.departments ?? []}
          collections={payload?.collections ?? []}
          capabilities={capabilities}
          matchedCount={layout?.matchedDocumentIds.length ?? payload?.documents.length ?? 0}
          totalCount={payload?.documents.length ?? 0}
          partialCounts={Boolean(payload?.truncation.truncated)}
          busy={loading}
          searchInputRef={searchInputRef}
          onChange={(patch) => updateFilterState((current) => ({ ...current, ...patch }))}
          onDisplayModeChange={setDisplayMode}
          onClearFilters={handleClearFilters}
          onRefresh={() => setRefreshTick((tick) => tick + 1)}
        />

        {payload?.truncation.truncated && (
          <div className="island-note is-warning graph-banner" role="status">
            <Icon name="warning" size={15} />
            <span>
              <strong>Showing first {payload.truncation.limit} matching documents.</strong>{" "}
              Partial branch counts while filtered — narrow filters to inspect other documents.
            </span>
          </div>
        )}

        {payload?.truncation.relationshipsTruncated && (
          <div className="island-note is-warning graph-banner" role="status">
            <Icon name="warning" size={15} />
            <span>
              <strong>Showing first {payload.truncation.relationshipsLimit.toLocaleString()} relationships.</strong>{" "}
              Filter by relationship type or department to focus on a smaller slice.
            </span>
          </div>
        )}

        {layout?.elkThresholdExceeded && (
          <div className="island-note graph-banner" role="status">
            <Icon name="branch" size={14} />
            <span>
              Large graph slice detected — cross-links are rendered as direct overlays over the tree layout.
            </span>
          </div>
        )}

        {error ? (
          <div className="island island-empty graph-state-card" role="alert">
            <Icon name="warning" size={20} />
            <h2>Knowledge Graph unavailable</h2>
            <p>{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRefreshTick((tick) => tick + 1)}
            >
              Try again
            </button>
          </div>
        ) : isInitialLoading ? (
          <GraphLoadingSkeleton />
        ) : isEmpty ? (
          <div className="island island-empty graph-state-card" role="status">
            <Icon name="graph" size={22} />
            <h2>{canClearEmpty ? "No matching documents" : "No published documents yet"}</h2>
            <p>
              {canClearEmpty
                ? "Try adjusting or clearing your filters to see authorized documents."
                : "Published Company documents you can read will appear here."}
            </p>
            {canClearEmpty && (
              <button type="button" className="secondary-button" onClick={handleClearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : layout ? (
          <section className="graph-viewport-region" aria-label="Knowledge Graph view">
            {displayMode === "canvas" ? (
              <GraphCanvas
                nodes={layout.nodes}
                edges={layout.edges}
                selectedNodeId={selectedNodeId}
                focusNodeIds={layoutFocusIds}
                focusNonce={focusNonce}
                pinnedDocumentIds={pinnedSet}
                onSelectNode={handleSelectNode}
                onToggleBranch={handleToggleBranch}
                onOpenDocument={handleOpenDocument}
                onManageLinks={(doc) => setRelationshipDialogDoc(doc)}
                onPinDocument={onPinDocument}
                onPinBranch={handlePinBranch}
                onReportIssue={shellBridge ? handleReportIssue : undefined}
              />
            ) : (
              <GraphOutlineView
                rows={layout.outlineRows}
                edges={layout.edges}
                selectedNodeId={selectedNodeId}
                pinnedDocumentIds={pinnedSet}
                onSelectNode={handleSelectNode}
                onToggleBranch={handleToggleBranch}
                onOpenDocument={handleOpenDocument}
                onManageLinks={(doc) => setRelationshipDialogDoc(doc)}
                onPinDocument={onPinDocument}
                onPinBranch={handlePinBranch}
                onReportIssue={shellBridge ? handleReportIssue : undefined}
              />
            )}
          </section>
        ) : null}
      </div>

      {relationshipDialogDoc && (
        <GraphRelationshipDialog
          platform={platform}
          organizationId={organizationId}
          sourceDocument={{
            documentId: relationshipDialogDoc.documentId,
            title: relationshipDialogDoc.title,
            version: relationshipDialogDoc.version,
          }}
          documents={payload?.documents}
          relationships={payload?.appliedMode.includeLinksActive ? payload.relationships : undefined}
          onChanged={() => setRefreshTick((tick) => tick + 1)}
          onClose={() => setRelationshipDialogDoc(null)}
        />
      )}

      {responsibleDoc && <GovernanceActionDialog key={responsibleDoc.publishedVersionId}
        target={{ ...responsibleDoc, kind: "responsible" }} platform={platform} organizationId={organizationId}
        onClose={() => setResponsibleDoc(null)} />}
    </main>
  );
}

export default GraphPage;
