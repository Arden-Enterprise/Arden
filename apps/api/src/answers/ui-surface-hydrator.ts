import type { PoolClient } from "pg";
import {
  knowledgeTypes,
  UI_SURFACE_MAX_CITATIONS,
  UI_SURFACE_MAX_DOCUMENTS,
  UI_SURFACE_MAX_PROSE_LENGTH,
  UI_SURFACE_SCHEMA_VERSION,
  validateStoredBoundSurface,
  validityStatus,
  type BoundCardNode,
  type BoundUiNode,
  type BoundUiSurface,
  type DocumentRelationshipType,
  type GraphOpenTarget,
  type GraphReaderScope,
  type HydratedDocumentSummary,
  type KnowledgeMetadata,
  type KnowledgeType,
  type LineagePreview,
  type MetricKey,
  type MetricTile,
  type NodeId,
  type SurfaceDocumentHandle,
  type SurfaceHandleMap,
  type TurnHydration,
} from "@arden/domain";
import type { AuthorizedAiSource } from "../db/repository.js";
import { computeCanRenewByDocument } from "../knowledge/renewal-eligibility.js";
import { canRead, type ReaderActor, type ReaderMode, type ReaderSelection } from "../target-readers/policy.js";
import type { PublicCitation, SourceCatalogEntry } from "./governed-contracts.js";

const AUTHOR_NAME_BATCH_SIZE = 1_000;
const MAX_LINEAGE_EDGES = 8;
const CALLOUT_MAX_BODY = 800;
const VERSION_UNAVAILABLE_LABEL = "Version unavailable";
const UNKNOWN_DEPARTMENT_LABEL = "Unknown department";
const FALLBACK_UNMAPPED_DEPT_REF = "DEPT999";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

type ActorTransaction = <T>(
  userId: string,
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export interface SourceCatalogMetadata {
  ownerDepartmentId: string | null;
  ownerDepartmentName: string;
  version: string;
  readerScope: GraphReaderScope;
  collectionId: string | null;
  hasDirectRelationships: boolean;
}

export type SurfaceLineageEdgeRecord = LineagePreview["edges"][number];

export interface TurnSurfaceInput {
  id: string;
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE";
  answer: string;
  citations: readonly PublicCitation[];
  surface: BoundUiSurface;
}

export interface HydratedTurnSurface {
  surface: BoundUiSurface;
  turnHydration: TurnHydration;
}

export interface ConversationHydrationBundle {
  hydratedDocuments: Record<string, HydratedDocumentSummary>;
  turnsById: Map<string, HydratedTurnSurface>;
}

export interface SurfaceHydrationLoader {
  loadDocuments(
    userId: string,
    organizationId: string,
    publishedVersionIds: readonly string[],
  ): Promise<Map<string, HydratedDocumentSummary>>;
  loadLineages(
    userId: string,
    organizationId: string,
    rootDocumentIds: readonly string[],
  ): Promise<Map<string, SurfaceLineageEdgeRecord[]>>;
}

export interface UiSurfaceHydrator extends SurfaceHydrationLoader {
  loadCatalogMetadata(
    userId: string,
    organizationId: string,
    publishedVersionIds: readonly string[],
  ): Promise<Map<string, SourceCatalogMetadata>>;
  hydrateConversationSurfaces(
    userId: string,
    organizationId: string,
    turns: readonly TurnSurfaceInput[],
  ): Promise<ConversationHydrationBundle>;
}

function normalizeKnowledgeType(raw: unknown): KnowledgeType | null {
  return typeof raw === "string" && (knowledgeTypes as readonly string[]).includes(raw)
    ? (raw as KnowledgeType)
    : null;
}

function normalizeVersionLabel(raw: unknown): string {
  if (typeof raw !== "string") return VERSION_UNAVAILABLE_LABEL;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : VERSION_UNAVAILABLE_LABEL;
}

function resolveReaderScope(
  targetReaders: ReaderSelection | null,
  knowledgeBaseScopeType: "ORGANIZATION" | "DEPARTMENT" | null,
): GraphReaderScope {
  if (targetReaders) {
    switch (targetReaders.mode) {
      case "ORGANIZATION":
        return "ORGANIZATION";
      case "DEPARTMENT":
        return "DEPARTMENT";
      case "SELECTED_MEMBERS":
        return "SELECTED_MEMBERS";
    }
  }
  if (knowledgeBaseScopeType === "ORGANIZATION") return "ORGANIZATION";
  if (knowledgeBaseScopeType === "DEPARTMENT") return "DEPARTMENT";
  return "LEGACY_AUDIENCE";
}

function sortDocumentHandles(docs: readonly SurfaceDocumentHandle[]): SurfaceDocumentHandle[] {
  return [...docs].sort((a, b) =>
    a.documentId < b.documentId
      ? -1
      : a.documentId > b.documentId
        ? 1
        : a.publishedVersionId < b.publishedVersionId
          ? -1
          : a.publishedVersionId > b.publishedVersionId
            ? 1
            : 0,
  );
}

function sanitizeFallbackText(raw: string, opts: { maxLength: number; stripUrls: boolean; citationCount: number }): string {
  let cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(/<!--/g, "(comment) ")
    .replace(/</g, "\u2039")
    .replace(/>/g, "\u203A")
    .replace(/\b(on[a-z]+)\s*=/gi, "$1 =")
    .replace(/\b(javascript|vbscript)\s*:/gi, "$1 :")
    .replace(/\bdata\s*:\s*([a-z0-9.+-]+\/[a-z0-9.+-]+)/gi, "data $1");

  if (opts.stripUrls) {
    cleaned = cleaned
      .replace(/(?:https?|ftp|file):\/\//gi, "")
      .replace(/\b(?:mailto|tel):/gi, "")
      .replace(/(^|\s)\/\/([a-z0-9.-]+\.[a-z]{2,})/gi, "$1$2");
  }

  // Neutralize any inline [n] marker that falls outside 1..citationCount so validator accepts fallback prose.
  cleaned = cleaned.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const idx = Number(digits);
    if (!digits.startsWith("0") && Number.isSafeInteger(idx) && idx >= 1 && idx <= opts.citationCount) {
      return match;
    }
    return `(${digits})`;
  });

  if (cleaned.length > opts.maxLength) {
    cleaned = cleaned.slice(0, opts.maxLength);
  }
  if (cleaned.trim().length === 0) {
    return "See authorized sources for details.";
  }
  return cleaned;
}

function buildFallbackCandidate(
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE",
  answerText: string,
  citations: readonly PublicCitation[],
  docs: readonly SurfaceDocumentHandle[],
  opts: { allowAnchor: boolean },
): BoundUiSurface {
  const nodes: Record<NodeId, BoundUiNode> = Object.create(null) as Record<NodeId, BoundUiNode>;

  if (status === "INSUFFICIENT_EVIDENCE") {
    const body = answerText.length > CALLOUT_MAX_BODY ? answerText.slice(0, CALLOUT_MAX_BODY) : answerText;
    const childIds: NodeId[] = ["gap_callout"];
    nodes.gap_callout = {
      kind: "callout",
      tone: "gap",
      title: "Insufficient authorized knowledge",
      body,
    };
    if (answerText.length > CALLOUT_MAX_BODY) {
      nodes.gap_prose = { kind: "prose", markdown: answerText };
      childIds.push("gap_prose");
    }
    nodes.root = { kind: "stack", gap: "md", childIds };
    return {
      schemaVersion: UI_SURFACE_SCHEMA_VERSION,
      rootId: "root",
      nodes,
      bindings: { documents: [], citationIndexes: [] },
    };
  }

  const maxCitations = Math.min(citations.length, UI_SURFACE_MAX_CITATIONS);
  const citationIndexes = Array.from({ length: maxCitations }, (_, i) => i + 1);
  nodes.answer_prose = {
    kind: "prose",
    markdown: answerText,
    ...(citationIndexes.length > 0 ? { citationIndexes } : {}),
  };

  const rootChildren: NodeId[] = ["answer_prose"];
  if (docs.length > 0) {
    const bodyIds: NodeId[] = [];
    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]!;
      const nodeId = `doc_${i + 1}`;
      nodes[nodeId] = {
        kind: "document_item",
        documentId: doc.documentId,
        publishedVersionId: doc.publishedVersionId,
      };
      bodyIds.push(nodeId);
    }

    const primaryDoc = docs[0]!;
    const primaryCitation = citations.find((c) => c.documentId === primaryDoc.documentId && c.versionId === primaryDoc.publishedVersionId)
      ?? citations[0];
    const blockId = opts.allowAnchor && primaryCitation?.blockId && primaryCitation.blockId.length <= 128
      ? primaryCitation.blockId
      : undefined;
    const page = opts.allowAnchor && primaryCitation?.page !== undefined
      && Number.isSafeInteger(primaryCitation.page) && primaryCitation.page >= 1 && primaryCitation.page <= 100_000
      ? primaryCitation.page
      : undefined;

    nodes.open_primary = {
      kind: "open_reader",
      label: "Open primary source",
      documentId: primaryDoc.documentId,
      publishedVersionId: primaryDoc.publishedVersionId,
      ...(blockId !== undefined ? { blockId } : {}),
      ...(page !== undefined ? { page } : {}),
    };
    nodes.focus_graph = {
      kind: "graph_action",
      label: "Focus in Graph",
      action: { op: "focus_nodes", documentIds: docs.map((d) => d.documentId) },
    };
    nodes.sources_card = {
      kind: "card",
      title: "Sources",
      tone: "subtle",
      bodyIds,
      footerIds: ["open_primary", "focus_graph"],
    };
    rootChildren.push("sources_card");
  }

  nodes.root = { kind: "stack", gap: "md", childIds: rootChildren };
  return {
    schemaVersion: UI_SURFACE_SCHEMA_VERSION,
    rootId: "root",
    nodes,
    bindings: {
      documents: sortDocumentHandles(docs),
      citationIndexes,
    },
  };
}

/**
 * Deterministic Core fallback surface guaranteed to pass `validateStoredBoundSurface`.
 * Preserves full answers up to 12,000 characters and never fails chat delivery.
 */
export function synthesizeFallbackSurface(
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE",
  answer: string,
  citations: readonly PublicCitation[],
  evidenceDocs: readonly SurfaceDocumentHandle[],
): BoundUiSurface {
  const citationCount = Math.min(citations.length, UI_SURFACE_MAX_CITATIONS);
  const seenDocIds = new Set<string>();
  const uniqueDocs: SurfaceDocumentHandle[] = [];

  // Prioritize cited documents first, then remaining evidence documents, up to 8 unique docs.
  for (const citation of citations) {
    if (uniqueDocs.length >= UI_SURFACE_MAX_DOCUMENTS) break;
    if (UUID_PATTERN.test(citation.documentId) && UUID_PATTERN.test(citation.versionId) && !seenDocIds.has(citation.documentId)) {
      seenDocIds.add(citation.documentId);
      uniqueDocs.push({ documentId: citation.documentId, publishedVersionId: citation.versionId });
    }
  }
  for (const doc of evidenceDocs) {
    if (uniqueDocs.length >= UI_SURFACE_MAX_DOCUMENTS) break;
    if (UUID_PATTERN.test(doc.documentId) && UUID_PATTERN.test(doc.publishedVersionId) && !seenDocIds.has(doc.documentId)) {
      seenDocIds.add(doc.documentId);
      uniqueDocs.push({ documentId: doc.documentId, publishedVersionId: doc.publishedVersionId });
    }
  }

  const boundedRaw = answer.length > UI_SURFACE_MAX_PROSE_LENGTH
    ? answer.slice(0, UI_SURFACE_MAX_PROSE_LENGTH)
    : answer;

  const firstAttempt = buildFallbackCandidate(status, boundedRaw, citations, uniqueDocs, { allowAnchor: true });
  const firstCheck = validateStoredBoundSurface(firstAttempt, { citationCount });
  if (firstCheck.ok) return firstCheck.surface;

  // Retry with sanitized text (and without blockId anchor in case blockId contained unsafe characters).
  let sanitized = sanitizeFallbackText(boundedRaw, {
    maxLength: UI_SURFACE_MAX_PROSE_LENGTH,
    stripUrls: status === "INSUFFICIENT_EVIDENCE",
    citationCount,
  });
  let secondAttempt = buildFallbackCandidate(status, sanitized, citations, uniqueDocs, { allowAnchor: false });
  let secondCheck = validateStoredBoundSurface(secondAttempt, { citationCount });
  if (secondCheck.ok) return secondCheck.surface;

  // Final byte-budget guard (e.g. 12,000 multi-byte code points exceeding 48 KB compact UTF-8 cap).
  while (sanitized.length > 100) {
    sanitized = sanitized.slice(0, Math.floor(sanitized.length * 0.75));
    secondAttempt = buildFallbackCandidate(status, sanitized, citations, uniqueDocs, { allowAnchor: false });
    secondCheck = validateStoredBoundSurface(secondAttempt, { citationCount });
    if (secondCheck.ok) return secondCheck.surface;
  }

  // Absolute last resort guaranteed valid minimal surface.
  const minimal = buildFallbackCandidate(
    status,
    status === "INSUFFICIENT_EVIDENCE"
      ? "I could not find enough authorized knowledge in this scope to answer that question."
      : "Answer available in citations.",
    citations,
    [],
    { allowAnchor: false },
  );
  const minimalCheck = validateStoredBoundSurface(minimal, { citationCount });
  if (minimalCheck.ok) return minimalCheck.surface;
  throw new Error(`Fallback UiSurface failed validation: ${minimalCheck.error.code}`);
}

/**
 * Maps up to 8 unique evidence sources into opaque `D1..D8` / `DEPT1..` / `C1..` handles
 * with zero raw UUIDs in `sourceCatalog`, plus the exact `SurfaceHandleMap` for Core validation.
 */
export function buildSourceCatalogAndHandleMap(
  evidenceSources: readonly AuthorizedAiSource[],
  metadataMap: ReadonlyMap<string, SourceCatalogMetadata> = new Map(),
): { sourceCatalog: SourceCatalogEntry[]; handleMap: SurfaceHandleMap } {
  const documents: Record<string, SurfaceDocumentHandle> = {};
  const departments: Record<string, string> = {};
  const collections: Record<string, string> = {};

  const deptRefById = new Map<string, string>();
  const colRefById = new Map<string, string>();
  const seenDocIds = new Set<string>();
  const sourceCatalog: SourceCatalogEntry[] = [];

  let nextDeptIdx = 1;
  let nextColIdx = 1;

  for (const source of evidenceSources) {
    if (sourceCatalog.length >= UI_SURFACE_MAX_DOCUMENTS) break;
    if (seenDocIds.has(source.draftId)) continue;
    seenDocIds.add(source.draftId);

    const docRef = `D${sourceCatalog.length + 1}`;
    documents[docRef] = {
      documentId: source.draftId,
      publishedVersionId: source.publishedVersionId,
    };

    const meta = metadataMap.get(source.publishedVersionId);
    const resolvedOwnerDepartmentId =
      meta?.ownerDepartmentId && UUID_PATTERN.test(meta.ownerDepartmentId)
        ? meta.ownerDepartmentId
        : source.responsibleDepartmentId && UUID_PATTERN.test(source.responsibleDepartmentId)
          ? source.responsibleDepartmentId
          : null;
    let departmentRef: string;
    if (resolvedOwnerDepartmentId) {
      const existing = deptRefById.get(resolvedOwnerDepartmentId);
      if (existing) {
        departmentRef = existing;
      } else {
        departmentRef = `DEPT${nextDeptIdx++}`;
        deptRefById.set(resolvedOwnerDepartmentId, departmentRef);
        departments[departmentRef] = resolvedOwnerDepartmentId;
      }
    } else {
      // Arden-AI v3 SourceCatalogEntry requires a non-null `^DEPT[1-9][0-9]{0,2}$` string.
      // Emit a reserved sentinel that never collides with real DEPT1..DEPT8 handles and is never
      // inserted into handleMap.departments so Core fails closed if a draft references it.
      departmentRef = FALLBACK_UNMAPPED_DEPT_REF;
    }

    const readerScope = meta?.readerScope ?? resolveReaderScope(source.targetReaders, source.targetScopeType);
    let collectionRef: string | null = null;
    if (readerScope === "ORGANIZATION" && meta?.collectionId && UUID_PATTERN.test(meta.collectionId)) {
      const existing = colRefById.get(meta.collectionId);
      if (existing) {
        collectionRef = existing;
      } else {
        collectionRef = `C${nextColIdx++}`;
        colRefById.set(meta.collectionId, collectionRef);
        collections[collectionRef] = meta.collectionId;
      }
    }

    const title = source.title.trim().slice(0, 1_000) || "Untitled document";
    const ownerDepartment = (meta?.ownerDepartmentName?.trim() || UNKNOWN_DEPARTMENT_LABEL).slice(0, 200);
    const version = normalizeVersionLabel(meta?.version ?? source.management?.version);

    sourceCatalog.push({
      docRef,
      title,
      type: normalizeKnowledgeType(source.management?.type ?? null),
      ownerDepartment,
      version,
      readerScope,
      hasDirectRelationships: Boolean(meta?.hasDirectRelationships),
      departmentRef,
      collectionRef,
    });
  }

  return {
    sourceCatalog,
    handleMap: {
      documents,
      ...(Object.keys(departments).length > 0 ? { departments } : {}),
      ...(Object.keys(collections).length > 0 ? { collections } : {}),
    },
  };
}

function workflowHandoffAllowed(
  handoff: "report_issue" | "open_maintenance_case" | "open_renewal",
  doc: HydratedDocumentSummary | undefined,
): boolean {
  if (!doc) return false;
  switch (handoff) {
    case "report_issue":
      return doc.canReportIssue;
    case "open_maintenance_case":
      return doc.canOpenMaintenance;
    case "open_renewal":
      return doc.canRenew;
  }
}

function collectReferencedDocs(nodes: Record<NodeId, BoundUiNode>, originalBindings: readonly SurfaceDocumentHandle[]): SurfaceDocumentHandle[] {
  const byDocId = new Map<string, SurfaceDocumentHandle>();
  const bindingVersionByDocId = new Map(originalBindings.map((b) => [b.documentId, b.publishedVersionId]));

  for (const key of Object.keys(nodes)) {
    const node = nodes[key]!;
    switch (node.kind) {
      case "document_item":
      case "governance_kv":
      case "open_reader":
      case "workflow_handoff":
        byDocId.set(node.documentId, { documentId: node.documentId, publishedVersionId: node.publishedVersionId });
        break;
      case "lineage_tree":
        byDocId.set(node.rootDocumentId, {
          documentId: node.rootDocumentId,
          publishedVersionId: node.rootPublishedVersionId,
        });
        break;
      case "graph_action":
        if (node.action.op === "focus_nodes" || node.action.op === "pin_to_context") {
          for (const docId of node.action.documentIds) {
            const verId = bindingVersionByDocId.get(docId);
            if (verId && !byDocId.has(docId)) {
              byDocId.set(docId, { documentId: docId, publishedVersionId: verId });
            }
          }
        }
        break;
      default:
        break;
    }
  }
  return sortDocumentHandles([...byDocId.values()]);
}

export function stripUnauthorizedHandoffs(
  turn: TurnSurfaceInput,
  hydratedDocuments: Readonly<Record<string, HydratedDocumentSummary>>,
): BoundUiSurface {
  const removedIds = new Set<NodeId>();
  for (const nodeId of Object.keys(turn.surface.nodes)) {
    const node = turn.surface.nodes[nodeId]!;
    if (node.kind === "workflow_handoff") {
      const doc = hydratedDocuments[node.publishedVersionId];
      if (!workflowHandoffAllowed(node.handoff, doc)) {
        removedIds.add(nodeId);
      }
    }
  }

  if (removedIds.size === 0) return turn.surface;

  const fallback = () => synthesizeFallbackSurface(
    turn.status,
    turn.answer,
    turn.citations,
    turn.surface.bindings.documents,
  );

  if (removedIds.has(turn.surface.rootId)) return fallback();

  const nextNodes: Record<NodeId, BoundUiNode> = Object.create(null) as Record<NodeId, BoundUiNode>;
  for (const nodeId of Object.keys(turn.surface.nodes)) {
    if (removedIds.has(nodeId)) continue;
    const node = turn.surface.nodes[nodeId]!;
    switch (node.kind) {
      case "stack":
      case "row":
      case "section": {
        const filtered = node.childIds.filter((id) => !removedIds.has(id));
        if (filtered.length === 0) return fallback();
        nextNodes[nodeId] = { ...node, childIds: filtered };
        break;
      }
      case "card": {
        const nextBodyIds = node.bodyIds.filter((id) => !removedIds.has(id));
        if (nextBodyIds.length === 0) return fallback();
        const nextFooterIds = node.footerIds?.filter((id) => !removedIds.has(id));
        const nextCard: BoundCardNode = {
          kind: "card",
          ...(node.title !== undefined ? { title: node.title } : {}),
          ...(node.subtitle !== undefined ? { subtitle: node.subtitle } : {}),
          ...(node.tone !== undefined ? { tone: node.tone } : {}),
          bodyIds: nextBodyIds,
          ...(nextFooterIds && nextFooterIds.length > 0 ? { footerIds: nextFooterIds } : {}),
        };
        nextNodes[nodeId] = nextCard;
        break;
      }
      case "tabs": {
        const nextTabs = [];
        for (const tab of node.tabs) {
          const filtered = tab.childIds.filter((id) => !removedIds.has(id));
          if (filtered.length === 0) return fallback();
          nextTabs.push({ ...tab, childIds: filtered });
        }
        nextNodes[nodeId] = { ...node, tabs: nextTabs };
        break;
      }
      case "split": {
        if (removedIds.has(node.leftId) || removedIds.has(node.rightId)) return fallback();
        nextNodes[nodeId] = node;
        break;
      }
      default:
        nextNodes[nodeId] = node;
        break;
    }
  }

  const candidate: BoundUiSurface = {
    schemaVersion: turn.surface.schemaVersion,
    rootId: turn.surface.rootId,
    nodes: nextNodes,
    bindings: {
      documents: collectReferencedDocs(nextNodes, turn.surface.bindings.documents),
      citationIndexes: [...turn.surface.bindings.citationIndexes],
    },
  };
  const checked = validateStoredBoundSurface(candidate, { citationCount: turn.citations.length });
  return checked.ok ? checked.surface : fallback();
}

function buildMetricTile(key: MetricKey, turnDocs: readonly HydratedDocumentSummary[]): MetricTile | null {
  switch (key) {
    case "MATCHED_DOCS":
      return { key, label: "Matched documents", value: turnDocs.length, tone: "neutral" };
    case "EXPIRING_SOON_DOCS": {
      const value = turnDocs.filter((doc) => doc.validityStatus === "Expiring soon").length;
      return { key, label: "Expiring soon", value, tone: value > 0 ? "warning" : "neutral" };
    }
    case "OPEN_MAINTENANCE_CASES": {
      const visibleCounts = turnDocs
        .map((doc) => doc.openMaintenanceCaseCount)
        .filter((count): count is number => count !== null);
      if (visibleCounts.length === 0) return null;
      const value = visibleCounts.reduce((sum, count) => sum + count, 0);
      return { key, label: "Open maintenance cases", value, tone: value > 0 ? "attention" : "neutral" };
    }
    case "DISTINCT_OWNER_DEPTS": {
      const depts = new Set(turnDocs.map((doc) => doc.ownerDepartmentId).filter((id) => id.length > 0));
      return { key, label: "Owner departments", value: depts.size, tone: "neutral" };
    }
  }
}

export function computeTurnHydration(
  surface: BoundUiSurface,
  hydratedDocuments: Readonly<Record<string, HydratedDocumentSummary>>,
  lineagesByDocId: ReadonlyMap<string, SurfaceLineageEdgeRecord[]>,
): TurnHydration {
  const turnDocs: HydratedDocumentSummary[] = [];
  for (const binding of surface.bindings.documents) {
    const doc = hydratedDocuments[binding.publishedVersionId];
    if (doc) turnDocs.push(doc);
  }

  const metrics: Record<NodeId, MetricTile[]> = {};
  const lineages: Record<NodeId, LineagePreview> = {};

  for (const nodeId of Object.keys(surface.nodes)) {
    const node = surface.nodes[nodeId]!;
    if (node.kind === "metric_strip") {
      const tiles: MetricTile[] = [];
      for (const key of node.metricKeys) {
        const tile = buildMetricTile(key, turnDocs);
        if (tile) tiles.push(tile);
      }
      metrics[nodeId] = tiles;
    } else if (node.kind === "lineage_tree") {
      const rawEdges = lineagesByDocId.get(node.rootDocumentId) ?? [];
      lineages[nodeId] = {
        rootDocumentId: node.rootDocumentId,
        edges: rawEdges.slice(0, MAX_LINEAGE_EDGES),
      };
    }
  }

  return { metrics, lineages };
}

/**
 * Pure batched conversation surface hydrator: loads all unique document summaries once,
 * loads all unique lineage roots once (if any), strips unauthorized `workflow_handoff` nodes,
 * and computes per-turn `metrics` strictly over each turn's exact `bindings.documents`.
 */
export async function hydrateConversationSurfaces(
  loader: SurfaceHydrationLoader,
  userId: string,
  organizationId: string,
  turns: readonly TurnSurfaceInput[],
): Promise<ConversationHydrationBundle> {
  if (turns.length === 0) {
    return { hydratedDocuments: {}, turnsById: new Map() };
  }

  const versionIds = new Set<string>();
  const lineageRootIds = new Set<string>();
  for (const turn of turns) {
    for (const binding of turn.surface.bindings.documents) {
      versionIds.add(binding.publishedVersionId);
    }
    for (const nodeId of Object.keys(turn.surface.nodes)) {
      const node = turn.surface.nodes[nodeId]!;
      if (node.kind === "lineage_tree") {
        lineageRootIds.add(node.rootDocumentId);
      }
    }
  }

  const docMap = versionIds.size > 0
    ? await loader.loadDocuments(userId, organizationId, [...versionIds])
    : new Map<string, HydratedDocumentSummary>();

  const hydratedDocuments: Record<string, HydratedDocumentSummary> = {};
  for (const [verId, summary] of docMap) {
    hydratedDocuments[verId] = summary;
  }

  const lineagesByDocId = lineageRootIds.size > 0
    ? await loader.loadLineages(userId, organizationId, [...lineageRootIds])
    : new Map<string, SurfaceLineageEdgeRecord[]>();

  const turnsById = new Map<string, HydratedTurnSurface>();
  for (const turn of turns) {
    const strippedSurface = stripUnauthorizedHandoffs(turn, hydratedDocuments);
    const turnHydration = computeTurnHydration(strippedSurface, hydratedDocuments, lineagesByDocId);
    turnsById.set(turn.id, { surface: strippedSurface, turnHydration });
  }

  return { hydratedDocuments, turnsById };
}

type PgHydratorActorRow = {
  membership_id: string;
  status: ReaderActor["status"];
  department_ids: string[];
  is_org_admin: boolean;
  utc_today: string;
};

type PgHydratedDocRow = {
  published_version_id: string;
  document_id: string;
  title: string;
  management: KnowledgeMetadata | null;
  owner_department_id: string | null;
  owner_department_name: string | null;
  published_at: Date;
  knowledge_base_scope_type: "ORGANIZATION" | "DEPARTMENT" | null;
  target_scope_type: "ORGANIZATION" | "DEPARTMENT";
  index_status: string;
  expiration_date: string | null;
  readers_selection_id: string | null;
  readers_mode: ReaderMode | null;
  readers_department_id: string | null;
  readers_member_ids: string[] | null;
  is_author: boolean;
  collection_id: string | null;
  collection_name: string | null;
  can_review_version: boolean;
  open_maintenance_case_count: number | null;
  has_direct_relationships: boolean;
};

type PgLineageRow = {
  relationship_id: string;
  source_document_id: string;
  target_document_id: string;
  relationship_type: DocumentRelationshipType;
  source_published_version_id: string;
  source_title: string;
  source_management: KnowledgeMetadata | null;
  source_readers_selection_id: string | null;
  source_readers_mode: ReaderMode | null;
  source_readers_department_id: string | null;
  source_readers_member_ids: string[] | null;
  target_published_version_id: string;
  target_title: string;
  target_management: KnowledgeMetadata | null;
  target_readers_selection_id: string | null;
  target_readers_mode: ReaderMode | null;
  target_readers_department_id: string | null;
  target_readers_member_ids: string[] | null;
};

function mapSelection(
  selectionId: string | null,
  mode: ReaderMode | null,
  departmentId: string | null,
  memberIds: string[] | null,
): ReaderSelection | null {
  if (selectionId === null) return null;
  if (mode === null) return { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] };
  return { mode, departmentId, memberIds: memberIds ?? [] };
}

function deriveOpenTarget(opts: {
  isCurrentlyReadable: boolean;
  isExpired: boolean;
  isAuthor: boolean;
  canReviewVersion: boolean;
  isOrgAdmin: boolean;
}): GraphOpenTarget {
  if (opts.isCurrentlyReadable && !opts.isExpired) return "READER";
  if (opts.isAuthor) return "MY_CONTRIBUTIONS";
  if (opts.canReviewVersion) return "RESPONSIBLE_VIEW";
  if (opts.isOrgAdmin) return "ADMIN_INSPECTION";
  return "READER";
}

export class PgSurfaceHydrator implements UiSurfaceHydrator {
  constructor(private readonly withActor: ActorTransaction) {}

  async loadCatalogMetadata(
    userId: string,
    organizationId: string,
    publishedVersionIds: readonly string[],
  ): Promise<Map<string, SourceCatalogMetadata>> {
    const uniqueIds = [...new Set(publishedVersionIds)];
    if (uniqueIds.length === 0) return new Map();

    return this.withActor(userId, organizationId, async (client) => {
      const actor = await this.loadActor(client, userId, organizationId);
      if (!actor) return new Map();
      const rows = await this.queryHydratedDocRows(client, organizationId, uniqueIds, actor);
      const result = new Map<string, SourceCatalogMetadata>();
      for (const row of rows) {
        const readers = mapSelection(
          row.readers_selection_id,
          row.readers_mode,
          row.readers_department_id,
          row.readers_member_ids,
        );
        if (!canRead(actor.readerActor, { organizationId, readers })) continue;
        const readerScope = resolveReaderScope(readers, row.knowledge_base_scope_type);
        result.set(row.published_version_id, {
          ownerDepartmentId: row.owner_department_id,
          ownerDepartmentName: row.owner_department_name ?? UNKNOWN_DEPARTMENT_LABEL,
          version: normalizeVersionLabel(row.management?.version),
          readerScope,
          collectionId: readerScope === "ORGANIZATION" ? row.collection_id : null,
          hasDirectRelationships: row.has_direct_relationships,
        });
      }
      return result;
    });
  }

  async loadDocuments(
    userId: string,
    organizationId: string,
    publishedVersionIds: readonly string[],
  ): Promise<Map<string, HydratedDocumentSummary>> {
    const uniqueIds = [...new Set(publishedVersionIds)];
    if (uniqueIds.length === 0) return new Map();

    return this.withActor(userId, organizationId, async (client) => {
      const actor = await this.loadActor(client, userId, organizationId);
      if (!actor) return new Map();
      return this.loadDocumentsInTx(client, organizationId, uniqueIds, actor);
    });
  }

  async loadLineages(
    userId: string,
    organizationId: string,
    rootDocumentIds: readonly string[],
  ): Promise<Map<string, SurfaceLineageEdgeRecord[]>> {
    const uniqueIds = [...new Set(rootDocumentIds)];
    if (uniqueIds.length === 0) return new Map();

    return this.withActor(userId, organizationId, async (client) => {
      const actor = await this.loadActor(client, userId, organizationId);
      if (!actor) return new Map();
      return this.loadLineagesInTx(client, organizationId, uniqueIds, actor.readerActor);
    });
  }

  async hydrateConversationSurfaces(
    userId: string,
    organizationId: string,
    turns: readonly TurnSurfaceInput[],
  ): Promise<ConversationHydrationBundle> {
    if (turns.length === 0) {
      return { hydratedDocuments: {}, turnsById: new Map() };
    }

    return this.withActor(userId, organizationId, async (client) => {
      const actor = await this.loadActor(client, userId, organizationId);
      if (!actor) {
        return hydrateConversationSurfaces(
          { loadDocuments: async () => new Map(), loadLineages: async () => new Map() },
          userId,
          organizationId,
          turns,
        );
      }

      const txLoader: SurfaceHydrationLoader = {
        loadDocuments: (_u, org, versionIds) => this.loadDocumentsInTx(client, org, versionIds, actor),
        loadLineages: (_u, org, rootIds) => this.loadLineagesInTx(client, org, rootIds, actor.readerActor),
      };
      return hydrateConversationSurfaces(txLoader, userId, organizationId, turns);
    });
  }

  private async loadActor(client: PoolClient, userId: string, organizationId: string): Promise<{
    readerActor: ReaderActor;
    isOrgAdmin: boolean;
    utcToday: string;
  } | null> {
    const result = await client.query<PgHydratorActorRow>(`
      SELECT om.membership_id,
             om.status,
             ARRAY(
               SELECT dm.department_id::text
                 FROM department_membership dm
                 JOIN department d
                   ON d.department_id = dm.department_id
                  AND d.organization_id = om.organization_id
                  AND d.status = 'ACTIVE'
                WHERE dm.membership_id = om.membership_id
                  AND dm.status = 'ACTIVE'
                ORDER BY dm.department_id
             ) AS department_ids,
             maintenance_actor_is_admin($2) AS is_org_admin,
             to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS utc_today
        FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
       WHERE om.user_id = $1
         AND om.organization_id = $2
         AND om.status = 'ACTIVE'`, [userId, organizationId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      readerActor: {
        membershipId: row.membership_id,
        organizationId,
        status: row.status,
        departmentIds: row.department_ids,
      },
      isOrgAdmin: row.is_org_admin,
      utcToday: row.utc_today,
    };
  }

  private async queryHydratedDocRows(
    client: PoolClient,
    organizationId: string,
    publishedVersionIds: readonly string[],
    actor: { readerActor: ReaderActor; isOrgAdmin: boolean; utcToday: string },
  ): Promise<PgHydratedDocRow[]> {
    const result = await client.query<PgHydratedDocRow>(`
      SELECT pv.published_version_id,
             pv.shared_draft_id AS document_id,
             pv.title,
             pv.management,
             pv.responsible_department_id AS owner_department_id,
             owner_department.name AS owner_department_name,
             pv.published_at,
             kb.scope_type AS knowledge_base_scope_type,
             cp.target_scope_type,
             pv.index_status,
             to_char(publication_expiration_date(pv.published_version_id, pv.management), 'YYYY-MM-DD') AS expiration_date,
             pv.reader_selection_id AS readers_selection_id,
             (SELECT rs.reader_mode FROM reader_selection rs WHERE rs.selection_id = pv.reader_selection_id) AS readers_mode,
             (SELECT rs.department_id FROM reader_selection rs WHERE rs.selection_id = pv.reader_selection_id) AS readers_department_id,
             ARRAY(
               SELECT sr.membership_id::text
                 FROM selected_reader sr
                WHERE sr.selection_id = pv.reader_selection_id
                ORDER BY sr.ordinal
             ) AS readers_member_ids,
             (own_draft.shared_draft_id IS NOT NULL) AS is_author,
             kc.collection_id,
             kc.name AS collection_name,
             maintenance_actor_can_review_version(pv.published_version_id) AS can_review_version,
             CASE
               WHEN $3::boolean OR maintenance_actor_can_review_version(pv.published_version_id) THEN (
                 SELECT count(*)::integer
                   FROM maintenance_case mc
                  WHERE mc.organization_id = cp.organization_id
                    AND mc.document_id = cp.shared_draft_id
                    AND mc.published_version_id = pv.published_version_id
                    AND mc.reporter_status IN ('Submitted', 'In Progress')
               )
               ELSE NULL
             END AS open_maintenance_case_count,
             EXISTS (
               SELECT 1
                 FROM document_relationship dr
                 JOIN knowledge_current_publication peer_cp
                   ON peer_cp.organization_id = dr.organization_id
                  AND peer_cp.shared_draft_id = CASE
                        WHEN dr.source_document_id = cp.shared_draft_id THEN dr.target_document_id
                        ELSE dr.source_document_id
                      END
                  AND peer_cp.valid_from <= now()
                  AND (peer_cp.valid_until IS NULL OR peer_cp.valid_until > now())
                 JOIN published_knowledge_version peer_pv
                   ON peer_pv.published_version_id = peer_cp.published_version_id
                  AND peer_pv.published_at <= now()
                  AND (
                    publication_expiration_date(peer_pv.published_version_id, peer_pv.management) IS NULL
                    OR publication_expiration_date(peer_pv.published_version_id, peer_pv.management) >= (now() AT TIME ZONE 'UTC')::date
                  )
                WHERE dr.organization_id = cp.organization_id
                  AND (dr.source_document_id = cp.shared_draft_id OR dr.target_document_id = cp.shared_draft_id)
             ) AS has_direct_relationships
        FROM knowledge_current_publication cp
        JOIN published_knowledge_version pv
          ON pv.published_version_id = cp.published_version_id
         AND pv.shared_draft_id = cp.shared_draft_id
        JOIN knowledge_base kb
          ON kb.knowledge_base_id = pv.knowledge_base_id
         AND kb.organization_id = cp.organization_id
        LEFT JOIN department owner_department
          ON owner_department.department_id = pv.responsible_department_id
         AND owner_department.organization_id = cp.organization_id
        LEFT JOIN shared_draft own_draft
          ON own_draft.shared_draft_id = cp.shared_draft_id
         AND own_draft.organization_id = cp.organization_id
         AND own_draft.author_membership_id = $4
         AND own_draft.status = 'ACTIVE'
        LEFT JOIN knowledge_collection_placement kcp
          ON kcp.shared_draft_id = cp.shared_draft_id
         AND kcp.organization_id = cp.organization_id
        LEFT JOIN knowledge_collection kc
          ON kc.collection_id = kcp.collection_id
         AND kc.organization_id = cp.organization_id
         AND kc.status = 'ACTIVE'
       WHERE cp.organization_id = $1
         AND pv.published_version_id = ANY($2::uuid[])
         AND cp.valid_from <= now()
         AND (cp.valid_until IS NULL OR cp.valid_until > now())
         AND pv.published_at <= now()
         AND (
           publication_expiration_date(pv.published_version_id, pv.management) IS NULL
           OR publication_expiration_date(pv.published_version_id, pv.management) >= (now() AT TIME ZONE 'UTC')::date
         )`, [organizationId, publishedVersionIds, actor.isOrgAdmin, actor.readerActor.membershipId]);
    return result.rows;
  }

  private async loadDocumentsInTx(
    client: PoolClient,
    organizationId: string,
    publishedVersionIds: readonly string[],
    actor: { readerActor: ReaderActor; isOrgAdmin: boolean; utcToday: string },
  ): Promise<Map<string, HydratedDocumentSummary>> {
    const rawRows = await this.queryHydratedDocRows(client, organizationId, publishedVersionIds, actor);
    const readableRows = rawRows.filter((row) =>
      canRead(actor.readerActor, {
        organizationId,
        readers: mapSelection(
          row.readers_selection_id,
          row.readers_mode,
          row.readers_department_id,
          row.readers_member_ids,
        ),
      }),
    );
    if (readableRows.length === 0) return new Map();

    const readableVersionIds = readableRows.map((row) => row.published_version_id);

    const authorNames = new Map<string, string>();
    for (let offset = 0; offset < readableVersionIds.length; offset += AUTHOR_NAME_BATCH_SIZE) {
      const chunk = readableVersionIds.slice(offset, offset + AUTHOR_NAME_BATCH_SIZE);
      const namesResult = await client.query<{ published_version_id: string; author_name: string }>(
        "SELECT published_version_id, author_name FROM list_publication_author_names($1::uuid[])",
        [chunk],
      );
      for (const nameRow of namesResult.rows) {
        authorNames.set(nameRow.published_version_id, nameRow.author_name);
      }
    }

    const canRenewByDocument = await computeCanRenewByDocument(client, {
      organizationId,
      actorMembershipId: actor.readerActor.membershipId,
      isOrgAdmin: actor.isOrgAdmin,
      utcToday: actor.utcToday,
      candidates: readableRows.map((row) => ({
        documentId: row.document_id,
        publishedVersionId: row.published_version_id,
        ownerDepartmentId: row.owner_department_id,
        expirationDate: row.expiration_date,
        governanceReaderMode: row.readers_mode
          ?? (row.target_scope_type === "ORGANIZATION" ? "ORGANIZATION" : "DEPARTMENT"),
        isAuthor: row.is_author,
        indexStatus: row.index_status,
      })),
      activeAuthorVersionIds: new Set(authorNames.keys()),
    });

    const result = new Map<string, HydratedDocumentSummary>();
    for (const row of readableRows) {
      const readers = mapSelection(
        row.readers_selection_id,
        row.readers_mode,
        row.readers_department_id,
        row.readers_member_ids,
      );
      const readerScope = resolveReaderScope(readers, row.knowledge_base_scope_type);
      const type = normalizeKnowledgeType(row.management?.type ?? null);
      const version = normalizeVersionLabel(row.management?.version);
      const validity = validityStatus(
        { type, version, expirationDate: row.expiration_date, changeNote: "" },
        actor.utcToday,
      );
      const isAuthor = row.is_author;
      const isExpired = validity.status === "Expired";
      const canOpenMaintenance = actor.isOrgAdmin || row.can_review_version;

      result.set(row.published_version_id, {
        documentId: row.document_id,
        publishedVersionId: row.published_version_id,
        title: row.title,
        type,
        version,
        ownerDepartmentId: row.owner_department_id ?? "",
        ownerDepartmentName: row.owner_department_name ?? UNKNOWN_DEPARTMENT_LABEL,
        authorDisplayName: authorNames.get(row.published_version_id) ?? null,
        publishedAt: row.published_at.toISOString(),
        validUntil: row.expiration_date,
        validityStatus: validity.status,
        daysUntilExpiry: validity.daysLeft,
        readerScope,
        collectionName: readerScope === "ORGANIZATION" ? (row.collection_name ?? null) : null,
        openMaintenanceCaseCount: canOpenMaintenance ? (row.open_maintenance_case_count ?? 0) : null,
        openTarget: deriveOpenTarget({
          isCurrentlyReadable: true,
          isExpired,
          isAuthor,
          canReviewVersion: row.can_review_version,
          isOrgAdmin: actor.isOrgAdmin,
        }),
        canReportIssue: !isExpired,
        canOpenMaintenance,
        canRenew: canRenewByDocument.get(row.document_id) === true,
      });
    }
    return result;
  }

  private async loadLineagesInTx(
    client: PoolClient,
    organizationId: string,
    rootDocumentIds: readonly string[],
    readerActor: ReaderActor,
  ): Promise<Map<string, SurfaceLineageEdgeRecord[]>> {
    const result = await client.query<PgLineageRow>(`
      SELECT r.relationship_id,
             r.source_document_id,
             r.target_document_id,
             r.relationship_type,
             src_cp.published_version_id AS source_published_version_id,
             src_pv.title AS source_title,
             src_pv.management AS source_management,
             src_pv.reader_selection_id AS source_readers_selection_id,
             (SELECT rs.reader_mode FROM reader_selection rs WHERE rs.selection_id = src_pv.reader_selection_id) AS source_readers_mode,
             (SELECT rs.department_id FROM reader_selection rs WHERE rs.selection_id = src_pv.reader_selection_id) AS source_readers_department_id,
             ARRAY(SELECT sr.membership_id::text FROM selected_reader sr WHERE sr.selection_id = src_pv.reader_selection_id ORDER BY sr.ordinal) AS source_readers_member_ids,
             tgt_cp.published_version_id AS target_published_version_id,
             tgt_pv.title AS target_title,
             tgt_pv.management AS target_management,
             tgt_pv.reader_selection_id AS target_readers_selection_id,
             (SELECT rs.reader_mode FROM reader_selection rs WHERE rs.selection_id = tgt_pv.reader_selection_id) AS target_readers_mode,
             (SELECT rs.department_id FROM reader_selection rs WHERE rs.selection_id = tgt_pv.reader_selection_id) AS target_readers_department_id,
             ARRAY(SELECT sr.membership_id::text FROM selected_reader sr WHERE sr.selection_id = tgt_pv.reader_selection_id ORDER BY sr.ordinal) AS target_readers_member_ids
        FROM document_relationship r
        JOIN knowledge_current_publication src_cp
          ON src_cp.organization_id = r.organization_id
         AND src_cp.shared_draft_id = r.source_document_id
         AND src_cp.valid_from <= now()
         AND (src_cp.valid_until IS NULL OR src_cp.valid_until > now())
        JOIN published_knowledge_version src_pv
          ON src_pv.published_version_id = src_cp.published_version_id
         AND src_pv.published_at <= now()
         AND (
           publication_expiration_date(src_pv.published_version_id, src_pv.management) IS NULL
           OR publication_expiration_date(src_pv.published_version_id, src_pv.management) >= (now() AT TIME ZONE 'UTC')::date
         )
        JOIN knowledge_current_publication tgt_cp
          ON tgt_cp.organization_id = r.organization_id
         AND tgt_cp.shared_draft_id = r.target_document_id
         AND tgt_cp.valid_from <= now()
         AND (tgt_cp.valid_until IS NULL OR tgt_cp.valid_until > now())
        JOIN published_knowledge_version tgt_pv
          ON tgt_pv.published_version_id = tgt_cp.published_version_id
         AND tgt_pv.published_at <= now()
         AND (
           publication_expiration_date(tgt_pv.published_version_id, tgt_pv.management) IS NULL
           OR publication_expiration_date(tgt_pv.published_version_id, tgt_pv.management) >= (now() AT TIME ZONE 'UTC')::date
         )
       WHERE r.organization_id = $1
         AND (r.source_document_id = ANY($2::uuid[]) OR r.target_document_id = ANY($2::uuid[]))
       ORDER BY r.created_at DESC, r.relationship_id ASC`, [organizationId, rootDocumentIds]);

    const rootSet = new Set(rootDocumentIds);
    const byRoot = new Map<string, SurfaceLineageEdgeRecord[]>();

    for (const row of result.rows) {
      const sourceReadable = canRead(readerActor, {
        organizationId,
        readers: mapSelection(
          row.source_readers_selection_id,
          row.source_readers_mode,
          row.source_readers_department_id,
          row.source_readers_member_ids,
        ),
      });
      const targetReadable = canRead(readerActor, {
        organizationId,
        readers: mapSelection(
          row.target_readers_selection_id,
          row.target_readers_mode,
          row.target_readers_department_id,
          row.target_readers_member_ids,
        ),
      });
      if (!sourceReadable || !targetReadable) continue;

      if (rootSet.has(row.source_document_id)) {
        const list = byRoot.get(row.source_document_id) ?? [];
        if (list.length < MAX_LINEAGE_EDGES) {
          list.push({
            relationshipId: row.relationship_id,
            direction: "OUTGOING",
            relationshipType: row.relationship_type,
            peerDocumentId: row.target_document_id,
            peerPublishedVersionId: row.target_published_version_id,
            peerTitle: row.target_title,
            peerType: normalizeKnowledgeType(row.target_management?.type ?? null),
          });
          byRoot.set(row.source_document_id, list);
        }
      }
      if (rootSet.has(row.target_document_id)) {
        const list = byRoot.get(row.target_document_id) ?? [];
        if (list.length < MAX_LINEAGE_EDGES) {
          list.push({
            relationshipId: row.relationship_id,
            direction: "INCOMING",
            relationshipType: row.relationship_type,
            peerDocumentId: row.source_document_id,
            peerPublishedVersionId: row.source_published_version_id,
            peerTitle: row.source_title,
            peerType: normalizeKnowledgeType(row.source_management?.type ?? null),
          });
          byRoot.set(row.target_document_id, list);
        }
      }
    }

    return byRoot;
  }
}
