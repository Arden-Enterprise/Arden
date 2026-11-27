import { hierarchy, tree } from "d3-hierarchy";
import {
  graphTypeCodes,
  knowledgeTypeToCode,
  type DocumentRelationshipType,
  type GraphDocumentNode,
  type GraphReaderScope,
  type GraphTypeCode,
  type GraphValidityFilter,
  type GraphViewMode,
  type KnowledgeGraphPayload,
} from "@arden/domain";

/** Fixed Island card dimensions (SPEC-knowledge-graph.md §6.1). */
export const ORG_NODE_WIDTH = 208;
export const ORG_NODE_HEIGHT = 76;
export const BRANCH_NODE_WIDTH = 208;
export const BRANCH_NODE_HEIGHT = 68;
export const DOC_NODE_WIDTH = 248;
export const DOC_NODE_HEIGHT = 118;

/** Automatic safety thresholds for in-thread lazy ELK layout (SPEC-knowledge-graph.md §2). */
export const ELK_MAX_NODES = 250;
export const ELK_MAX_EDGES = 500;

/** Opacity applied to dimmed non-matching siblings during client-side filtering. */
export const DIMMED_OPACITY = 0.28;

const HORIZONTAL_STEP = 316;
const VERTICAL_STEP = 140;

const TYPE_DISPLAY_LABELS: Record<GraphTypeCode, string> = {
  POLICY_AND_STANDARD: "Policy & Standard",
  PROCEDURE: "Procedure",
  GUIDE: "Guide",
  REFERENCE: "Reference",
  LESSONS_LEARNED: "Lessons Learned",
  UNCATEGORIZED: "Uncategorized (legacy)",
};

export type GraphNodeKind =
  | "org"
  | "department"
  | "type"
  | "collection"
  | "unassigned"
  | "shared"
  | "document";

export type GraphBranchKind = "department" | "type" | "collection" | "unassigned" | "shared";

export interface GraphClientFilters {
  q?: string;
  ownerDepartmentId?: string;
  typeCode?: GraphTypeCode | "";
  collectionId?: string;
  readerScope?: GraphReaderScope | "";
  validity?: GraphValidityFilter | "";
  onlyOpenCases?: boolean;
  onlyUnassignedOrg?: boolean;
  relationshipTypes?: readonly DocumentRelationshipType[];
}

export interface GraphNodeData extends Record<string, unknown> {
  id: string;
  kind: GraphNodeKind;
  label: string;
  subtitle?: string;
  branchKind?: GraphBranchKind;
  branchId?: string;
  totalCount: number;
  matchCount: number;
  collapsed: boolean;
  hasChildren: boolean;
  dimmed: boolean;
  opacity: number;
  partialCounts: boolean;
  documentIds: string[];
  document?: GraphDocumentNode;
}

export interface GraphPositionedNode {
  id: string;
  type: "orgNode" | "branchNode" | "documentNode";
  position: { x: number; y: number };
  width: number;
  height: number;
  data: GraphNodeData;
}

export interface GraphPositionedEdge {
  id: string;
  source: string;
  target: string;
  kind: "hierarchy" | "relationship";
  relationshipType?: DocumentRelationshipType;
  relationshipId?: string;
  label?: string;
  dimmed: boolean;
  opacity: number;
  type: "smoothstep" | "default";
}

export interface OutlineNode {
  id: string;
  kind: GraphNodeKind;
  level: number;
  parentId: string | null;
  expanded: boolean;
  hasChildren: boolean;
  totalCount: number;
  matchCount: number;
  dimmed: boolean;
  label: string;
  badge?: string;
  branchKind?: GraphBranchKind;
  branchId?: string;
  documentIds: string[];
  document?: GraphDocumentNode;
}

export type GraphLayoutEngineKind = "d3-tree" | "elk-layered" | "d3-bezier-overlay";

export interface ElkInputGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: Array<{ id: string; width: number; height: number }>;
  edges?: Array<{ id: string; sources: string[]; targets: string[] }>;
}

export interface ElkOutputGraph {
  id?: string;
  children?: Array<{ id: string; x?: number; y?: number }>;
}

export type ElkLayoutFn = (graph: ElkInputGraph) => Promise<ElkOutputGraph>;

export interface GraphLayoutOptions {
  viewMode: GraphViewMode;
  collapsedBranchIds: ReadonlySet<string> | readonly string[];
  expandedBranchIds?: ReadonlySet<string> | readonly string[];
  filters?: GraphClientFilters;
  isolateMatching?: boolean;
  focusDocumentIds?: readonly string[];
  crossLinksOn?: boolean;
  elkLayoutFn?: ElkLayoutFn;
}

export interface GraphLayoutResult {
  nodes: GraphPositionedNode[];
  edges: GraphPositionedEdge[];
  outlineRows: OutlineNode[];
  layoutEngine: GraphLayoutEngineKind;
  hasActiveClientFilters: boolean;
  matchedDocumentIds: string[];
  totalDocumentCount: number;
  visibleRelationshipCount: number;
  elkThresholdExceeded: boolean;
}

interface InternalTreeNode {
  id: string;
  nodeType: "orgNode" | "branchNode" | "documentNode";
  kind: GraphNodeKind;
  label: string;
  subtitle?: string;
  branchKind?: GraphBranchKind;
  branchId?: string;
  document?: GraphDocumentNode;
  children: InternalTreeNode[];
  totalCount: number;
  matchCount: number;
  documentIds: string[];
  matched: boolean;
  dimmed: boolean;
  collapsed: boolean;
  hasChildren: boolean;
}

function hasAnyClientFilter(filters?: GraphClientFilters): boolean {
  if (!filters) return false;
  return Boolean(
    (filters.q && filters.q.trim().length > 0)
    || filters.ownerDepartmentId
    || filters.typeCode
    || filters.collectionId
    || filters.readerScope
    || filters.validity
    || filters.onlyOpenCases
    || filters.onlyUnassignedOrg,
  );
}

function matchesClientFilters(
  doc: GraphDocumentNode,
  filters: GraphClientFilters,
  collectionNames: ReadonlyMap<string, string>,
): boolean {
  const q = filters.q?.trim().toLocaleLowerCase();
  if (q) {
    const typeLabel = TYPE_DISPLAY_LABELS[knowledgeTypeToCode(doc.type)];
    const collectionName = doc.collectionId ? (collectionNames.get(doc.collectionId) ?? "") : "";
    const haystack = [
      doc.title,
      doc.ownerDepartmentName,
      typeLabel,
      doc.version,
      doc.authorDisplayName ?? "",
      collectionName,
    ];
    if (!haystack.some((value) => value.toLocaleLowerCase().includes(q))) {
      return false;
    }
  }
  if (filters.ownerDepartmentId && doc.ownerDepartmentId !== filters.ownerDepartmentId) {
    return false;
  }
  if (filters.typeCode && knowledgeTypeToCode(doc.type) !== filters.typeCode) {
    return false;
  }
  if (filters.collectionId) {
    if (filters.collectionId === "UNASSIGNED") {
      if (!(doc.readerScope === "ORGANIZATION" && doc.collectionId === null)) return false;
    } else if (!(doc.readerScope === "ORGANIZATION" && doc.collectionId === filters.collectionId)) {
      return false;
    }
  }
  if (filters.readerScope && doc.readerScope !== filters.readerScope) {
    return false;
  }
  if (filters.validity) {
    if (filters.validity === "CURRENT" && doc.validityStatus !== "Current") return false;
    if (filters.validity === "EXPIRING_SOON" && doc.validityStatus !== "Expiring soon") return false;
    if (filters.validity === "EXPIRED" && doc.validityStatus !== "Expired") return false;
  }
  if (filters.onlyOpenCases) {
    if ((doc.monitorSignals?.openMaintenanceCaseCount ?? 0) <= 0) return false;
  }
  if (filters.onlyUnassignedOrg) {
    const isUnassigned = doc.monitorSignals?.isUnassignedOrgDoc
      ?? (doc.readerScope === "ORGANIZATION" && doc.collectionId === null);
    if (!isUnassigned) return false;
  }
  return true;
}

function compareByNameThenId(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

function makeDocumentTreeNode(doc: GraphDocumentNode, matched: boolean): InternalTreeNode {
  return {
    id: `doc:${doc.documentId}`,
    nodeType: "documentNode",
    kind: "document",
    label: doc.title,
    document: doc,
    children: [],
    totalCount: 1,
    matchCount: matched ? 1 : 0,
    documentIds: [doc.documentId],
    matched,
    dimmed: !matched,
    collapsed: false,
    hasChildren: false,
  };
}

function buildAccountabilityTree(
  payload: KnowledgeGraphPayload,
  matchedSet: ReadonlySet<string>,
): InternalTreeNode {
  const deptNameById = new Map<string, string>();
  for (const dept of payload.departments) {
    deptNameById.set(dept.id, dept.name);
  }
  const docsByDept = new Map<string, GraphDocumentNode[]>();
  for (const doc of payload.documents) {
    if (!deptNameById.has(doc.ownerDepartmentId)) {
      deptNameById.set(doc.ownerDepartmentId, doc.ownerDepartmentName || "Department");
    }
    const bucket = docsByDept.get(doc.ownerDepartmentId);
    if (bucket) bucket.push(doc);
    else docsByDept.set(doc.ownerDepartmentId, [doc]);
  }

  const orderedDepts = [...docsByDept.keys()]
    .map((id) => ({ id, name: deptNameById.get(id) ?? "Department" }))
    .sort(compareByNameThenId);

  const deptChildren: InternalTreeNode[] = orderedDepts.map((dept) => {
    const deptDocs = docsByDept.get(dept.id) ?? [];
    const byType = new Map<GraphTypeCode, GraphDocumentNode[]>();
    for (const doc of deptDocs) {
      const code = knowledgeTypeToCode(doc.type);
      const list = byType.get(code);
      if (list) list.push(doc);
      else byType.set(code, [doc]);
    }

    const typeChildren: InternalTreeNode[] = [];
    for (const code of graphTypeCodes) {
      const typeDocs = byType.get(code);
      if (!typeDocs || typeDocs.length === 0) continue;
      const docNodes = typeDocs.map((doc) => makeDocumentTreeNode(doc, matchedSet.has(doc.documentId)));
      const matchCount = docNodes.reduce((sum, node) => sum + node.matchCount, 0);
      typeChildren.push({
        id: `type:${dept.id}:${code}`,
        nodeType: "branchNode",
        kind: "type",
        label: TYPE_DISPLAY_LABELS[code],
        branchKind: "type",
        branchId: code,
        children: docNodes,
        totalCount: docNodes.length,
        matchCount,
        documentIds: typeDocs.map((doc) => doc.documentId),
        matched: matchCount > 0,
        dimmed: matchCount === 0,
        collapsed: false,
        hasChildren: docNodes.length > 0,
      });
    }

    const matchCount = typeChildren.reduce((sum, node) => sum + node.matchCount, 0);
    return {
      id: `dept:${dept.id}`,
      nodeType: "branchNode",
      kind: "department",
      label: dept.name,
      subtitle: "Owner department",
      branchKind: "department",
      branchId: dept.id,
      children: typeChildren,
      totalCount: deptDocs.length,
      matchCount,
      documentIds: deptDocs.map((doc) => doc.documentId),
      matched: matchCount > 0,
      dimmed: matchCount === 0,
      collapsed: false,
      hasChildren: typeChildren.length > 0,
    };
  });

  const totalMatch = deptChildren.reduce((sum, node) => sum + node.matchCount, 0);
  return {
    id: `org:${payload.organization.id}`,
    nodeType: "orgNode",
    kind: "org",
    label: payload.organization.name,
    subtitle: "Accountability",
    children: deptChildren,
    totalCount: payload.documents.length,
    matchCount: totalMatch,
    documentIds: payload.documents.map((doc) => doc.documentId),
    matched: totalMatch > 0 || payload.documents.length === 0,
    dimmed: false,
    collapsed: false,
    hasChildren: deptChildren.length > 0,
  };
}

function buildCollectionsTree(
  payload: KnowledgeGraphPayload,
  matchedSet: ReadonlySet<string>,
): InternalTreeNode {
  const collectionMap = new Map(payload.collections.map((col) => [col.id, col]));
  const docsByCollection = new Map<string, GraphDocumentNode[]>();
  const unassignedOrgDocs: GraphDocumentNode[] = [];
  const sharedDocs: GraphDocumentNode[] = [];

  for (const doc of payload.documents) {
    if (doc.readerScope !== "ORGANIZATION") {
      sharedDocs.push(doc);
      continue;
    }
    if (doc.collectionId && collectionMap.has(doc.collectionId)) {
      const bucket = docsByCollection.get(doc.collectionId);
      if (bucket) bucket.push(doc);
      else docsByCollection.set(doc.collectionId, [doc]);
    } else {
      unassignedOrgDocs.push(doc);
    }
  }

  const orderedCollections = [...docsByCollection.keys()]
    .map((id) => ({ id, name: collectionMap.get(id)!.name }))
    .sort(compareByNameThenId);

  const branches: InternalTreeNode[] = orderedCollections.map((col) => {
    const colDocs = docsByCollection.get(col.id) ?? [];
    const docNodes = colDocs.map((doc) => makeDocumentTreeNode(doc, matchedSet.has(doc.documentId)));
    const matchCount = docNodes.reduce((sum, node) => sum + node.matchCount, 0);
    return {
      id: `col:${col.id}`,
      nodeType: "branchNode",
      kind: "collection",
      label: col.name,
      subtitle: "Organization collection",
      branchKind: "collection",
      branchId: col.id,
      children: docNodes,
      totalCount: docNodes.length,
      matchCount,
      documentIds: colDocs.map((doc) => doc.documentId),
      matched: matchCount > 0,
      dimmed: matchCount === 0,
      collapsed: false,
      hasChildren: docNodes.length > 0,
    };
  });

  if (unassignedOrgDocs.length > 0) {
    const docNodes = unassignedOrgDocs.map((doc) => makeDocumentTreeNode(doc, matchedSet.has(doc.documentId)));
    const matchCount = docNodes.reduce((sum, node) => sum + node.matchCount, 0);
    branches.push({
      id: "unassigned:org",
      nodeType: "branchNode",
      kind: "unassigned",
      label: "Unassigned",
      subtitle: "Organization-wide",
      branchKind: "unassigned",
      branchId: "UNASSIGNED",
      children: docNodes,
      totalCount: docNodes.length,
      matchCount,
      documentIds: unassignedOrgDocs.map((doc) => doc.documentId),
      matched: matchCount > 0,
      dimmed: matchCount === 0,
      collapsed: false,
      hasChildren: docNodes.length > 0,
    });
  }

  if (sharedDocs.length > 0) {
    const docNodes = sharedDocs.map((doc) => makeDocumentTreeNode(doc, matchedSet.has(doc.documentId)));
    const matchCount = docNodes.reduce((sum, node) => sum + node.matchCount, 0);
    branches.push({
      id: "shared:org",
      nodeType: "branchNode",
      kind: "shared",
      label: "Shared",
      subtitle: "Department · Selected · Legacy",
      branchKind: "shared",
      branchId: "SHARED",
      children: docNodes,
      totalCount: docNodes.length,
      matchCount,
      documentIds: sharedDocs.map((doc) => doc.documentId),
      matched: matchCount > 0,
      dimmed: matchCount === 0,
      collapsed: false,
      hasChildren: docNodes.length > 0,
    });
  }

  const totalMatch = branches.reduce((sum, node) => sum + node.matchCount, 0);
  return {
    id: `org:${payload.organization.id}`,
    nodeType: "orgNode",
    kind: "org",
    label: payload.organization.name,
    subtitle: "Collections",
    children: branches,
    totalCount: payload.documents.length,
    matchCount: totalMatch,
    documentIds: payload.documents.map((doc) => doc.documentId),
    matched: totalMatch > 0 || payload.documents.length === 0,
    dimmed: false,
    collapsed: false,
    hasChildren: branches.length > 0,
  };
}

function pruneTree(
  node: InternalTreeNode,
  options: {
    collapsedSet: ReadonlySet<string>;
    expandedSet: ReadonlySet<string>;
    matchedSet: ReadonlySet<string>;
    focusSet: ReadonlySet<string>;
    applyDimming: boolean;
    isolateMatching: boolean;
  },
): InternalTreeNode | null {
  const hasFocus = node.documentIds.some((id) => options.focusSet.has(id));
  if (node.kind !== "org" && options.applyDimming && options.isolateMatching && !node.matched && !hasFocus) {
    return null;
  }

  const isBranch = node.kind !== "document" && node.kind !== "org";
  const autoCollapsed = isBranch && options.applyDimming && !options.isolateMatching && node.matchCount === 0 && !hasFocus;
  const manuallyCollapsed = node.kind !== "document" && options.collapsedSet.has(node.id);
  const manuallyExpanded = isBranch && options.expandedSet.has(node.id);
  const collapsed = manuallyCollapsed || (autoCollapsed && !manuallyExpanded);

  let nextChildren: InternalTreeNode[] = [];
  let hasChildren = node.children.length > 0;

  if (!collapsed) {
    const pruned: InternalTreeNode[] = [];
    for (const child of node.children) {
      const next = pruneTree(child, options);
      if (next) pruned.push(next);
    }
    nextChildren = pruned;
    hasChildren = pruned.length > 0;
  } else if (options.applyDimming && options.isolateMatching) {
    hasChildren = node.children.some((child) => child.matched || child.documentIds.some((id) => options.focusSet.has(id)));
  }

  const dimmed = node.kind !== "org" && options.applyDimming && !options.isolateMatching && node.dimmed && !hasFocus;
  const activeDocumentIds = options.applyDimming
    ? node.documentIds.filter((id) => options.matchedSet.has(id) || options.focusSet.has(id))
    : node.documentIds;

  return {
    ...node,
    documentIds: activeDocumentIds,
    children: nextChildren,
    collapsed,
    hasChildren,
    dimmed,
  };
}

function dimensionsFor(nodeType: InternalTreeNode["nodeType"]): { width: number; height: number } {
  switch (nodeType) {
    case "orgNode":
      return { width: ORG_NODE_WIDTH, height: ORG_NODE_HEIGHT };
    case "branchNode":
      return { width: BRANCH_NODE_WIDTH, height: BRANCH_NODE_HEIGHT };
    case "documentNode":
      return { width: DOC_NODE_WIDTH, height: DOC_NODE_HEIGHT };
  }
}

function badgeForOutline(node: InternalTreeNode, partialCounts: boolean): string | undefined {
  if (node.kind === "document") {
    return node.document?.type ?? "Uncategorized";
  }
  const count = node.matchCount !== node.totalCount ? `${node.matchCount}/${node.totalCount}` : `${node.totalCount}`;
  return partialCounts ? `${count} (partial)` : count;
}

async function runBundledElk(graph: ElkInputGraph): Promise<ElkOutputGraph> {
  // Dynamically imported on demand in-thread (zero blob: Web Workers under Electron CSP).
  const mod = await import("elkjs/lib/elk.bundled.js");
  const ElkCtor = (mod.default ?? mod) as unknown as new () => {
    layout: (input: ElkInputGraph) => Promise<ElkOutputGraph>;
  };
  const elk = new ElkCtor();
  return elk.layout(graph);
}

/**
 * Pure, side-effect-free layout engine for `/graph`.
 * Produces deterministic left-to-right coordinates (`d3-hierarchy` or on-demand lazy `elk.bundled.js`),
 * dimmed/isolated filter states, and an identical synchronized `outlineRows` treegrid array.
 */
export async function computeGraphLayout(
  payload: KnowledgeGraphPayload,
  options: GraphLayoutOptions,
): Promise<GraphLayoutResult> {
  const collapsedSet = options.collapsedBranchIds instanceof Set
    ? options.collapsedBranchIds
    : new Set(options.collapsedBranchIds);
  const expandedSet = options.expandedBranchIds instanceof Set
    ? options.expandedBranchIds
    : new Set(options.expandedBranchIds ?? []);
  const filters = options.filters ?? {};
  const hasActiveClientFilters = hasAnyClientFilter(filters);
  const applyClientFiltering = !payload.truncation.truncated && hasActiveClientFilters;
  const isolateMatching = Boolean(options.isolateMatching);
  const focusSet = new Set(options.focusDocumentIds);
  const partialCounts = payload.truncation.truncated;

  const collectionNames = new Map(payload.collections.map((col) => [col.id, col.name]));
  const matchedSet = new Set<string>();
  for (const doc of payload.documents) {
    if (!applyClientFiltering || matchesClientFilters(doc, filters, collectionNames)) {
      matchedSet.add(doc.documentId);
    }
  }

  const matchedDocumentIds = payload.documents
    .filter((doc) => matchedSet.has(doc.documentId))
    .map((doc) => doc.documentId);

  const hasVisibleFocus = payload.documents.some((doc) => focusSet.has(doc.documentId));
  if (payload.documents.length === 0 || (applyClientFiltering && isolateMatching && matchedDocumentIds.length === 0 && !hasVisibleFocus)) {
    return {
      nodes: [],
      edges: [],
      outlineRows: [],
      layoutEngine: "d3-tree",
      hasActiveClientFilters,
      matchedDocumentIds,
      totalDocumentCount: payload.documents.length,
      visibleRelationshipCount: 0,
      elkThresholdExceeded: false,
    };
  }

  const rawRoot = options.viewMode === "collections"
    ? buildCollectionsTree(payload, matchedSet)
    : buildAccountabilityTree(payload, matchedSet);

  const visibleRoot = pruneTree(rawRoot, {
    collapsedSet,
    expandedSet,
    matchedSet,
    focusSet,
    applyDimming: applyClientFiltering,
    isolateMatching,
  });

  if (!visibleRoot) {
    return {
      nodes: [],
      edges: [],
      outlineRows: [],
      layoutEngine: "d3-tree",
      hasActiveClientFilters,
      matchedDocumentIds,
      totalDocumentCount: payload.documents.length,
      visibleRelationshipCount: 0,
      elkThresholdExceeded: false,
    };
  }

  // Compute deterministic left-to-right tidy tree positions via d3-hierarchy.
  const rootHierarchy = hierarchy<InternalTreeNode>(visibleRoot, (d) => d.children);
  const layoutTree = tree<InternalTreeNode>().nodeSize([VERTICAL_STEP, HORIZONTAL_STEP]);
  const laidOut = layoutTree(rootHierarchy);

  // Depth-first pre-order traversal so outlineRows form a valid hierarchical treegrid.
  const descendants: Array<typeof laidOut> = [];
  laidOut.eachBefore((node) => {
    descendants.push(node);
  });
  let minY = Infinity;
  for (const d of descendants) {
    if (d.x < minY) minY = d.x;
  }
  const yOffset = Number.isFinite(minY) ? -minY : 0;

  const nodes: GraphPositionedNode[] = [];
  const nodeById = new Map<string, GraphPositionedNode>();
  const outlineRows: OutlineNode[] = [];
  const hierarchyEdges: GraphPositionedEdge[] = [];

  for (const d of descendants) {
    const item = d.data;
    const { width, height } = dimensionsFor(item.nodeType);
    const opacity = item.dimmed ? DIMMED_OPACITY : 1;
    const positioned: GraphPositionedNode = {
      id: item.id,
      type: item.nodeType,
      position: {
        x: Math.round(d.y),
        y: Math.round(d.x + yOffset),
      },
      width,
      height,
      data: {
        id: item.id,
        kind: item.kind,
        label: item.label,
        subtitle: item.subtitle,
        branchKind: item.branchKind,
        branchId: item.branchId,
        totalCount: item.totalCount,
        matchCount: item.matchCount,
        collapsed: item.collapsed,
        hasChildren: item.hasChildren,
        dimmed: item.dimmed,
        opacity,
        partialCounts,
        documentIds: item.documentIds,
        document: item.document,
      },
    };
    nodes.push(positioned);
    nodeById.set(positioned.id, positioned);

    outlineRows.push({
      id: item.id,
      kind: item.kind,
      level: d.depth + 1,
      parentId: d.parent ? d.parent.data.id : null,
      expanded: !item.collapsed,
      hasChildren: item.hasChildren,
      totalCount: item.totalCount,
      matchCount: item.matchCount,
      dimmed: item.dimmed,
      label: item.label,
      badge: badgeForOutline(item, partialCounts),
      branchKind: item.branchKind,
      branchId: item.branchId,
      documentIds: item.documentIds,
      document: item.document,
    });

    if (d.parent) {
      const parentId = d.parent.data.id;
      const edgeDimmed = d.parent.data.dimmed || item.dimmed;
      hierarchyEdges.push({
        id: `hier:${parentId}->${item.id}`,
        source: parentId,
        target: item.id,
        kind: "hierarchy",
        dimmed: edgeDimmed,
        opacity: edgeDimmed ? DIMMED_OPACITY : 1,
        type: "smoothstep",
      });
    }
  }

  // Append visible cross-document relationship edges when toggled on.
  const relationshipEdges: GraphPositionedEdge[] = [];
  if (options.crossLinksOn && payload.relationships.length > 0) {
    const allowedRelTypes = filters.relationshipTypes
      ? new Set<DocumentRelationshipType>(filters.relationshipTypes)
      : null;

    for (const rel of payload.relationships) {
      if (allowedRelTypes && !allowedRelTypes.has(rel.relationshipType)) continue;
      const sourceNode = nodeById.get(`doc:${rel.sourceDocumentId}`);
      const targetNode = nodeById.get(`doc:${rel.targetDocumentId}`);
      if (!sourceNode || !targetNode) continue;
      const edgeDimmed = sourceNode.data.dimmed || targetNode.data.dimmed;
      const relLabel = rel.relationshipType === "REFERENCES"
        ? "References"
        : rel.relationshipType === "SUPERSEDES"
          ? "Supersedes"
          : "Related";
      relationshipEdges.push({
        id: `rel:${rel.relationshipId}`,
        source: sourceNode.id,
        target: targetNode.id,
        kind: "relationship",
        relationshipId: rel.relationshipId,
        relationshipType: rel.relationshipType,
        label: relLabel,
        dimmed: edgeDimmed,
        opacity: edgeDimmed ? DIMMED_OPACITY : 1,
        type: "default",
      });
    }
  }

  const allEdges = [...hierarchyEdges, ...relationshipEdges];
  let layoutEngine: GraphLayoutEngineKind = "d3-tree";
  let elkThresholdExceeded = false;

  if (options.crossLinksOn && relationshipEdges.length > 0) {
    if (nodes.length <= ELK_MAX_NODES && allEdges.length <= ELK_MAX_EDGES) {
      const elkGraph: ElkInputGraph = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "36",
          "elk.layered.spacing.nodeNodeBetweenLayers": "76",
          "elk.edgeRouting": "ORTHOGONAL",
        },
        children: nodes.map((node) => ({
          id: node.id,
          width: node.width,
          height: node.height,
        })),
        edges: allEdges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      };
      try {
        const runner = options.elkLayoutFn ?? runBundledElk;
        const elkOutput = await runner(elkGraph);
        if (elkOutput.children && elkOutput.children.length > 0) {
          for (const child of elkOutput.children) {
            const target = nodeById.get(child.id);
            if (target && typeof child.x === "number" && typeof child.y === "number") {
              target.position = { x: Math.round(child.x), y: Math.round(child.y) };
            }
          }
          for (const relEdge of relationshipEdges) {
            relEdge.type = "smoothstep";
          }
          layoutEngine = "elk-layered";
        } else {
          layoutEngine = "d3-bezier-overlay";
        }
      } catch {
        // Never block the user if ELK fails; gracefully render crisp bezier overlays over d3-tree.
        layoutEngine = "d3-bezier-overlay";
      }
    } else {
      elkThresholdExceeded = true;
      layoutEngine = "d3-bezier-overlay";
    }
  }

  return {
    nodes,
    edges: allEdges,
    outlineRows,
    layoutEngine,
    hasActiveClientFilters,
    matchedDocumentIds,
    totalDocumentCount: payload.documents.length,
    visibleRelationshipCount: relationshipEdges.length,
    elkThresholdExceeded,
  };
}
