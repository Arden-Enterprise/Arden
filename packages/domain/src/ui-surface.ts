import type { KnowledgeType, ValidityStatus } from "./knowledge-metadata.js";
import {
  documentRelationshipTypes,
  graphReaderScopes,
  graphTypeCodes,
  type DocumentRelationshipType,
  type GraphOpenTarget,
  type GraphReaderScope,
  type GraphTypeCode,
} from "./knowledge-graph.js";

export const UI_SURFACE_SCHEMA_VERSION = 1 as const;
export const UI_SURFACE_MAX_NODES = 32;
export const UI_SURFACE_MAX_DEPTH = 4;
/** Compact UTF-8 byte cap leaving safe headroom under PostgreSQL's 65,536-byte `jsonb::text` check. */
export const UI_SURFACE_MAX_COMPACT_BYTES = 48_000;
export const UI_SURFACE_MAX_PROSE_LENGTH = 12_000;
export const UI_SURFACE_MAX_DOCUMENTS = 8;
export const UI_SURFACE_MAX_CITATIONS = 12;

export type NodeId = string;

export const PROTOTYPE_DENYLIST: ReadonlySet<string> = new Set([
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
]);

export const governanceFieldKeys = [
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
] as const;
export type GovernanceFieldKey = typeof governanceFieldKeys[number];

export const metricKeys = [
  "MATCHED_DOCS",
  "EXPIRING_SOON_DOCS",
  "OPEN_MAINTENANCE_CASES",
  "DISTINCT_OWNER_DEPTS",
] as const;
export type MetricKey = typeof metricKeys[number];

export const calloutTones = ["info", "warning", "gap", "conflict"] as const;
export type CalloutTone = typeof calloutTones[number];

export const workflowHandoffKinds = [
  "report_issue",
  "open_maintenance_case",
  "open_renewal",
] as const;
export type WorkflowHandoffKind = typeof workflowHandoffKinds[number];

export interface HydratedDocumentSummary {
  documentId: string;
  publishedVersionId: string;
  title: string;
  type: KnowledgeType | null;
  version: string;
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  authorDisplayName: string | null;
  publishedAt: string;
  validUntil: string | null;
  validityStatus: ValidityStatus;
  daysUntilExpiry: number | null;
  readerScope: GraphReaderScope;
  collectionName: string | null;
  openMaintenanceCaseCount: number | null;
  openTarget: GraphOpenTarget;
  canReportIssue: boolean;
  canOpenMaintenance: boolean;
  canRenew: boolean;
}

export interface MetricTile {
  key: MetricKey;
  label: string;
  value: number;
  tone: "neutral" | "warning" | "attention";
}

export interface LineagePreview {
  rootDocumentId: string;
  edges: Array<{
    relationshipId: string;
    direction: "OUTGOING" | "INCOMING";
    relationshipType: DocumentRelationshipType;
    peerDocumentId: string;
    peerPublishedVersionId: string;
    peerTitle: string;
    peerType: KnowledgeType | null;
  }>;
}

export interface TurnHydration {
  metrics: Record<NodeId, MetricTile[]>;
  lineages: Record<NodeId, LineagePreview>;
}

export type GraphActionPayload =
  | { op: "focus_nodes"; documentIds: string[] }
  | {
      op: "apply_filter";
      ownerDepartmentId?: string;
      typeCode?: GraphTypeCode;
      collectionId?: string;
      readerScope?: GraphReaderScope;
      validity?: "CURRENT" | "EXPIRING_SOON";
    }
  | { op: "isolate_branch"; branchKind: "department" | "collection" | "type"; branchId: string }
  | { op: "toggle_links"; enabled: boolean; relationshipTypes?: DocumentRelationshipType[] }
  | { op: "pin_to_context"; documentIds: string[] };

export type SurfaceAction =
  | { kind: "graph_action"; label: string; action: GraphActionPayload }
  | {
      kind: "open_reader";
      label: string;
      documentId: string;
      publishedVersionId: string;
      blockId?: string;
      page?: number;
    }
  | {
      kind: "workflow_handoff";
      label: string;
      handoff: WorkflowHandoffKind;
      documentId: string;
      publishedVersionId: string;
    }
  | { kind: "prompt_chip"; label: string; prompt: string };

export interface BoundStackNode {
  kind: "stack";
  gap?: "sm" | "md";
  childIds: NodeId[];
}

export interface BoundRowNode {
  kind: "row";
  columns?: 2 | 3;
  childIds: NodeId[];
}

export interface BoundCardNode {
  kind: "card";
  title?: string;
  subtitle?: string;
  tone?: "default" | "subtle";
  bodyIds: NodeId[];
  footerIds?: NodeId[];
}

export interface BoundSectionNode {
  kind: "section";
  title: string;
  defaultOpen?: boolean;
  childIds: NodeId[];
}

export interface BoundTabPanel {
  id: string;
  label: string;
  childIds: NodeId[];
}

export interface BoundTabsNode {
  kind: "tabs";
  defaultTabId: string;
  tabs: BoundTabPanel[];
}

export interface BoundSplitNode {
  kind: "split";
  leftTitle?: string;
  leftId: NodeId;
  rightTitle?: string;
  rightId: NodeId;
}

export interface BoundProseNode {
  kind: "prose";
  markdown: string;
  citationIndexes?: number[];
}

export interface BoundDocumentItemNode {
  kind: "document_item";
  documentId: string;
  publishedVersionId: string;
  highlightNote?: string;
}

export interface BoundGovernanceKvNode {
  kind: "governance_kv";
  documentId: string;
  publishedVersionId: string;
  fields?: GovernanceFieldKey[];
}

export interface ComparisonTableCell {
  text: string;
  citationIndexes?: number[];
}

export interface ComparisonTableRow {
  cells: ComparisonTableCell[];
}

export interface BoundComparisonTableNode {
  kind: "comparison_table";
  caption?: string;
  columns: string[];
  rows: ComparisonTableRow[];
}

export interface BoundCalloutNode {
  kind: "callout";
  tone: CalloutTone;
  title: string;
  body: string;
  citationIndexes?: number[];
}

export interface BoundMetricStripNode {
  kind: "metric_strip";
  metricKeys: MetricKey[];
}

export interface BoundLineageTreeNode {
  kind: "lineage_tree";
  rootDocumentId: string;
  rootPublishedVersionId: string;
}

export type BoundUiNode =
  | BoundStackNode
  | BoundRowNode
  | BoundCardNode
  | BoundSectionNode
  | BoundTabsNode
  | BoundSplitNode
  | BoundProseNode
  | BoundDocumentItemNode
  | BoundGovernanceKvNode
  | BoundComparisonTableNode
  | BoundCalloutNode
  | BoundMetricStripNode
  | BoundLineageTreeNode
  | SurfaceAction;

export interface SurfaceDocumentHandle {
  documentId: string;
  publishedVersionId: string;
}

export interface BoundUiSurface {
  schemaVersion: typeof UI_SURFACE_SCHEMA_VERSION;
  rootId: NodeId;
  nodes: Record<NodeId, BoundUiNode>;
  bindings: {
    documents: SurfaceDocumentHandle[];
    citationIndexes: number[];
  };
}

export interface HydratedUiSurface {
  surface: BoundUiSurface;
  hydratedDocuments: Record<string, HydratedDocumentSummary>;
  turnHydration: TurnHydration;
}

export type AiGraphActionPayload =
  | { op: "focus_nodes"; docRefs: string[] }
  | {
      op: "apply_filter";
      departmentRef?: string | null;
      typeCode?: GraphTypeCode | null;
      collectionRef?: string | null;
      readerScope?: GraphReaderScope | null;
      validity?: "CURRENT" | "EXPIRING_SOON" | null;
    }
  | { op: "isolate_branch"; branchKind: "department" | "collection" | "type"; branchRef: string }
  | { op: "toggle_links"; enabled: boolean; relationshipTypes?: DocumentRelationshipType[] | null }
  | { op: "pin_to_context"; docRefs: string[] };

export interface AiComparisonTableCell {
  text: string;
  citationIndexes?: number[] | null;
}

export interface AiComparisonTableRow {
  cells: AiComparisonTableCell[];
}

export type AiSurfaceNode =
  | { id: NodeId; kind: "stack"; gap?: "sm" | "md" | null; childIds: NodeId[] }
  | { id: NodeId; kind: "row"; columns?: 2 | 3 | null; childIds: NodeId[] }
  | {
      id: NodeId;
      kind: "card";
      title?: string | null;
      subtitle?: string | null;
      tone?: "default" | "subtle" | null;
      bodyIds: NodeId[];
      footerIds?: NodeId[] | null;
    }
  | {
      id: NodeId;
      kind: "section";
      title: string;
      defaultOpen?: boolean | null;
      childIds: NodeId[];
    }
  | {
      id: NodeId;
      kind: "tabs";
      defaultTabId: string;
      tabs: BoundTabPanel[];
    }
  | {
      id: NodeId;
      kind: "split";
      leftTitle?: string | null;
      leftId: NodeId;
      rightTitle?: string | null;
      rightId: NodeId;
    }
  | {
      id: NodeId;
      kind: "prose";
      markdown: string;
      citationIndexes?: number[] | null;
    }
  | {
      id: NodeId;
      kind: "document_item";
      docRef: string;
      highlightNote?: string | null;
    }
  | {
      id: NodeId;
      kind: "governance_kv";
      docRef: string;
      fields?: GovernanceFieldKey[] | null;
    }
  | {
      id: NodeId;
      kind: "comparison_table";
      caption?: string | null;
      columns: string[];
      rows: AiComparisonTableRow[];
    }
  | {
      id: NodeId;
      kind: "callout";
      tone: CalloutTone;
      title: string;
      body: string;
      citationIndexes?: number[] | null;
    }
  | {
      id: NodeId;
      kind: "metric_strip";
      metricKeys: MetricKey[];
    }
  | {
      id: NodeId;
      kind: "lineage_tree";
      docRef: string;
    }
  | {
      id: NodeId;
      kind: "graph_action";
      label: string;
      action: AiGraphActionPayload;
    }
  | {
      id: NodeId;
      kind: "open_reader";
      label: string;
      docRef: string;
      blockId?: string | null;
      page?: number | null;
    }
  | {
      id: NodeId;
      kind: "workflow_handoff";
      label: string;
      handoff: WorkflowHandoffKind;
      docRef: string;
    }
  | {
      id: NodeId;
      kind: "prompt_chip";
      label: string;
      prompt: string;
    };

export interface AiSurfaceDraft {
  schemaVersion: typeof UI_SURFACE_SCHEMA_VERSION;
  rootId: NodeId;
  nodes: AiSurfaceNode[];
}

export interface SurfaceHandleMap {
  documents: Record<string, SurfaceDocumentHandle>;
  departments?: Record<string, string>;
  collections?: Record<string, string>;
}

export type SurfaceValidationErrorCode =
  | "INVALID_SHAPE"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_NODE_ID"
  | "DUPLICATE_NODE_ID"
  | "INVALID_ROOT"
  | "UNKNOWN_NODE_REF"
  | "NODE_LIMIT_EXCEEDED"
  | "DEPTH_LIMIT_EXCEEDED"
  | "CYCLE_OR_REUSED_NODE"
  | "ORPHAN_NODE"
  | "FORBIDDEN_NESTING"
  | "INVALID_FOOTER_NODE"
  | "UNKNOWN_HANDLE"
  | "INVALID_CITATION"
  | "UNCITED_TABLE_ROW"
  | "FORBIDDEN_CALLOUT_TONE"
  | "INVALID_FIELD_VALUE"
  | "UNSAFE_CONTENT"
  | "BINDINGS_MISMATCH"
  | "DOCUMENT_LIMIT_EXCEEDED"
  | "CITATION_LIMIT_EXCEEDED"
  | "BYTE_LIMIT_EXCEEDED";

export interface SurfaceValidationError {
  code: SurfaceValidationErrorCode;
  message: string;
  nodeId?: string;
  path?: string;
}

export type SurfaceValidationResult =
  | { ok: true; surface: BoundUiSurface }
  | { ok: false; error: SurfaceValidationError };

export interface NormalizeSurfaceOptions {
  allowCoreCalloutTones?: boolean;
}

export interface ValidateStoredSurfaceOptions {
  citationCount?: number;
}

const NODE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_CITATION_PATTERN = /\[(\d+)\]/g;
const DANGEROUS_HTML_TAG_PATTERN =
  /<\s*\/?\s*(?:script|iframe|img|svg|object|embed|style|link|meta|base|form|input|button|textarea|select|applet|math|video|audio|source|body|html|head)\b/i;
const GENERIC_HTML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^<>]*|\/?)>/;
const HTML_COMMENT_PATTERN = /<!--/;
const EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/i;
const DANGEROUS_SCHEME_PATTERN = /\b(?:javascript|vbscript)\s*:|\bdata\s*:\s*[a-z0-9.+-]+\/[a-z0-9.+-]+/i;
const ARBITRARY_URL_PATTERN = /(?:https?|ftp|file):\/\/|\b(?:mailto|tel):|(?:^|\s)\/\/[a-z0-9.-]+\.[a-z]{2,}/i;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const GOVERNANCE_FIELD_SET: ReadonlySet<string> = new Set(governanceFieldKeys);
const METRIC_KEY_SET: ReadonlySet<string> = new Set(metricKeys);
const GRAPH_TYPE_CODE_SET: ReadonlySet<string> = new Set(graphTypeCodes);
const GRAPH_READER_SCOPE_SET: ReadonlySet<string> = new Set(graphReaderScopes);
const RELATIONSHIP_TYPE_SET: ReadonlySet<string> = new Set(documentRelationshipTypes);
const WORKFLOW_HANDOFF_SET: ReadonlySet<string> = new Set(workflowHandoffKinds);
const CALLOUT_TONE_SET: ReadonlySet<string> = new Set(calloutTones);
const LLM_CALLOUT_TONE_SET: ReadonlySet<string> = new Set(["info", "conflict"]);
const ACTION_KIND_SET: ReadonlySet<BoundUiNode["kind"]> = new Set([
  "graph_action",
  "open_reader",
  "workflow_handoff",
  "prompt_chip",
]);

const utf8Encoder = new TextEncoder();

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: SurfaceValidationError };

function ok<T>(value: T): ParseOutcome<T> {
  return { ok: true, value };
}

function fail(
  code: SurfaceValidationErrorCode,
  message: string,
  nodeId?: string,
  path?: string,
): { ok: false; error: SurfaceValidationError } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(path !== undefined ? { path } : {}),
    },
  };
}

export function isValidNodeId(value: unknown): value is NodeId {
  return typeof value === "string" && NODE_ID_PATTERN.test(value) && !PROTOTYPE_DENYLIST.has(value);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecordObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownProp(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function hasOnlyOwnKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_DENYLIST.has(key) || !allowedSet.has(key)) return false;
  }
  return true;
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasUnsafeHtml(value: string): boolean {
  const collapsed = value.replace(/[\t\r\n]+/g, "");
  return (
    DANGEROUS_HTML_TAG_PATTERN.test(value) ||
    GENERIC_HTML_TAG_PATTERN.test(value) ||
    HTML_COMMENT_PATTERN.test(value) ||
    EVENT_HANDLER_PATTERN.test(value) ||
    DANGEROUS_SCHEME_PATTERN.test(value) ||
    DANGEROUS_SCHEME_PATTERN.test(collapsed)
  );
}

function validateSafeText(
  value: unknown,
  opts: {
    minLength: number;
    maxLength: number;
    allowUrls: boolean;
    nodeId?: string;
    path: string;
  },
): ParseOutcome<string> {
  if (typeof value !== "string") {
    return fail("INVALID_FIELD_VALUE", `${opts.path} must be a string.`, opts.nodeId, opts.path);
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return fail("UNSAFE_CONTENT", `${opts.path} contains disallowed control characters.`, opts.nodeId, opts.path);
  }
  if (value.length < opts.minLength || value.length > opts.maxLength) {
    return fail(
      "INVALID_FIELD_VALUE",
      `${opts.path} length must be within ${opts.minLength}..${opts.maxLength}.`,
      opts.nodeId,
      opts.path,
    );
  }
  if (opts.minLength > 0 && value.trim().length === 0) {
    return fail("INVALID_FIELD_VALUE", `${opts.path} must not be blank.`, opts.nodeId, opts.path);
  }
  if (hasUnsafeHtml(value)) {
    return fail("UNSAFE_CONTENT", `${opts.path} contains disallowed HTML or script content.`, opts.nodeId, opts.path);
  }
  if (!opts.allowUrls && ARBITRARY_URL_PATTERN.test(value)) {
    return fail("UNSAFE_CONTENT", `${opts.path} must not contain raw URLs.`, opts.nodeId, opts.path);
  }
  return ok(value);
}

function validateOptionalText(
  value: unknown,
  opts: { maxLength: number; allowNull: boolean; allowUrls: boolean; nodeId?: string; path: string },
): ParseOutcome<string | undefined> {
  if (value === undefined || (opts.allowNull && value === null)) return ok(undefined);
  return validateSafeText(value, {
    minLength: 1,
    maxLength: opts.maxLength,
    allowUrls: opts.allowUrls,
    nodeId: opts.nodeId,
    path: opts.path,
  });
}

function parseNodeIdArray(
  value: unknown,
  min: number,
  max: number,
  nodeId: string,
  path: string,
): ParseOutcome<NodeId[]> {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return fail("INVALID_FIELD_VALUE", `${path} must contain ${min}..${max} node IDs.`, nodeId, path);
  }
  const result: NodeId[] = [];
  for (let i = 0; i < value.length; i++) {
    const id = value[i];
    if (!isValidNodeId(id)) {
      return fail("INVALID_NODE_ID", `${path}[${i}] is not a valid NodeId.`, nodeId, `${path}[${i}]`);
    }
    result.push(id);
  }
  return ok(result);
}

function parseCitationIndexArray(
  value: unknown,
  opts: {
    min: number;
    max: number;
    allowNull: boolean;
    dedupe: boolean;
    maxCitationCount: number | undefined;
    nodeId: string;
    path: string;
  },
): ParseOutcome<number[] | undefined> {
  if (value === undefined || (opts.allowNull && value === null)) {
    if (opts.min > 0) {
      return fail("INVALID_CITATION", `${opts.path} requires at least ${opts.min} citation.`, opts.nodeId, opts.path);
    }
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return fail("INVALID_CITATION", `${opts.path} must be an array of citation indexes.`, opts.nodeId, opts.path);
  }
  if (value.length > opts.max * 2) {
    return fail("INVALID_CITATION", `${opts.path} exceeds maximum citation count.`, opts.nodeId, opts.path);
  }
  const seen = new Set<number>();
  const upperBound = opts.maxCitationCount ?? UI_SURFACE_MAX_CITATIONS;
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 1 || entry > upperBound) {
      return fail("INVALID_CITATION", `${opts.path}[${i}] is outside valid citation bounds.`, opts.nodeId, `${opts.path}[${i}]`);
    }
    if (!opts.dedupe && seen.has(entry)) {
      return fail("INVALID_CITATION", `${opts.path}[${i}] contains duplicate citation index.`, opts.nodeId, `${opts.path}[${i}]`);
    }
    seen.add(entry);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length < opts.min || sorted.length > opts.max) {
    return fail(
      "INVALID_CITATION",
      `${opts.path} must contain ${opts.min}..${opts.max} citation indexes.`,
      opts.nodeId,
      opts.path,
    );
  }
  return ok(sorted.length > 0 ? sorted : undefined);
}

function extractInlineProseCitations(
  markdown: string,
  maxCitationCount: number | undefined,
  nodeId: string,
): ParseOutcome<number[]> {
  const found = new Set<number>();
  const upperBound = maxCitationCount ?? UI_SURFACE_MAX_CITATIONS;
  INLINE_CITATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_CITATION_PATTERN.exec(markdown)) !== null) {
    const rawDigits = match[1]!;
    if (rawDigits.startsWith("0")) {
      return fail("INVALID_CITATION", "Inline citation marker must be a positive 1-based integer.", nodeId, "markdown");
    }
    const index = Number(rawDigits);
    if (!Number.isSafeInteger(index) || index < 1 || index > upperBound) {
      return fail("INVALID_CITATION", "Inline citation marker is outside valid citation bounds.", nodeId, "markdown");
    }
    found.add(index);
  }
  return ok([...found].sort((a, b) => a - b));
}

function parseEnumList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  opts: { min: number; max: number; allowNull: boolean; dedupe: boolean; nodeId: string; path: string },
): ParseOutcome<T[] | undefined> {
  if (value === undefined || (opts.allowNull && value === null)) {
    if (opts.min > 0) {
      return fail("INVALID_FIELD_VALUE", `${opts.path} is required.`, opts.nodeId, opts.path);
    }
    return ok(undefined);
  }
  if (!Array.isArray(value) || value.length > opts.max * 2) {
    return fail("INVALID_FIELD_VALUE", `${opts.path} must be a bounded array.`, opts.nodeId, opts.path);
  }
  const deduped: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string" || !allowed.has(item)) {
      return fail("INVALID_FIELD_VALUE", `${opts.path}[${i}] is not an allowed value.`, opts.nodeId, `${opts.path}[${i}]`);
    }
    if (!opts.dedupe && seen.has(item)) {
      return fail("INVALID_FIELD_VALUE", `${opts.path}[${i}] must not be duplicated.`, opts.nodeId, `${opts.path}[${i}]`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      deduped.push(item as T);
    }
  }
  if (deduped.length < opts.min || deduped.length > opts.max) {
    return fail(
      "INVALID_FIELD_VALUE",
      `${opts.path} must contain ${opts.min}..${opts.max} entries.`,
      opts.nodeId,
      opts.path,
    );
  }
  return ok(deduped);
}

interface NodeParseContext {
  mode: "draft" | "stored";
  handleMap?: SurfaceHandleMap;
  citationCount: number | undefined;
  allowCoreCalloutTones: boolean;
}

interface ParsedNodeEntry {
  node: BoundUiNode;
  exactDocs: SurfaceDocumentHandle[];
  actionDocIds: string[];
  citations: number[];
}

function resolveDocumentHandle(
  ref: unknown,
  handleMap: SurfaceHandleMap,
  nodeId: string,
  path: string,
): ParseOutcome<SurfaceDocumentHandle> {
  if (typeof ref !== "string" || PROTOTYPE_DENYLIST.has(ref) || !isRecordObject(handleMap.documents)) {
    return fail("UNKNOWN_HANDLE", `${path} is not a recognized document handle.`, nodeId, path);
  }
  if (!Object.hasOwn(handleMap.documents, ref)) {
    return fail("UNKNOWN_HANDLE", `${path} does not exist in handleMap.documents.`, nodeId, path);
  }
  const resolved = handleMap.documents[ref];
  if (!isPlainObject(resolved) || !isValidUuid(ownProp(resolved, "documentId")) || !isValidUuid(ownProp(resolved, "publishedVersionId"))) {
    return fail("INVALID_FIELD_VALUE", `handleMap.documents entry for ${path} has invalid UUIDs.`, nodeId, path);
  }
  return ok({
    documentId: ownProp(resolved, "documentId") as string,
    publishedVersionId: ownProp(resolved, "publishedVersionId") as string,
  });
}

function resolveNamedHandle(
  ref: unknown,
  table: Record<string, string> | undefined,
  kindLabel: string,
  nodeId: string,
  path: string,
): ParseOutcome<string> {
  if (typeof ref !== "string" || PROTOTYPE_DENYLIST.has(ref) || !isRecordObject(table) || !Object.hasOwn(table, ref)) {
    return fail("UNKNOWN_HANDLE", `${path} is not a recognized ${kindLabel} handle.`, nodeId, path);
  }
  const resolved = table[ref];
  if (!isValidUuid(resolved)) {
    return fail("INVALID_FIELD_VALUE", `Resolved ${kindLabel} ID for ${path} is not a valid UUID.`, nodeId, path);
  }
  return ok(resolved);
}

function parseGraphActionPayload(
  raw: unknown,
  ctx: NodeParseContext,
  nodeId: string,
): ParseOutcome<{ payload: GraphActionPayload; exactDocs: SurfaceDocumentHandle[]; actionDocIds: string[] }> {
  if (!isPlainObject(raw)) {
    return fail("INVALID_FIELD_VALUE", "action must be an object.", nodeId, "action");
  }
  const op = ownProp(raw, "op");
  const allowNull = ctx.mode === "draft";
  const dedupe = ctx.mode === "draft";

  if (op === "focus_nodes" || op === "pin_to_context") {
    if (ctx.mode === "draft") {
      if (!hasOnlyOwnKeys(raw, ["op", "docRefs"])) {
        return fail("INVALID_SHAPE", `${op} has unexpected keys.`, nodeId, "action");
      }
      const docRefs = ownProp(raw, "docRefs");
      if (!Array.isArray(docRefs) || docRefs.length === 0 || docRefs.length > UI_SURFACE_MAX_DOCUMENTS * 2) {
        return fail("INVALID_FIELD_VALUE", `${op}.docRefs must contain 1..${UI_SURFACE_MAX_DOCUMENTS} handles.`, nodeId, "action.docRefs");
      }
      const exactDocs: SurfaceDocumentHandle[] = [];
      const docIds: string[] = [];
      const seenVersionByDocId = new Map<string, string>();
      for (let i = 0; i < docRefs.length; i++) {
        const resolved = resolveDocumentHandle(docRefs[i], ctx.handleMap!, nodeId, `action.docRefs[${i}]`);
        if (!resolved.ok) return resolved;
        const existingVersion = seenVersionByDocId.get(resolved.value.documentId);
        if (existingVersion !== undefined && existingVersion !== resolved.value.publishedVersionId) {
          return fail("BINDINGS_MISMATCH", `${op} references conflicting publishedVersionIds for one documentId.`, nodeId, `action.docRefs[${i}]`);
        }
        if (existingVersion === undefined) {
          seenVersionByDocId.set(resolved.value.documentId, resolved.value.publishedVersionId);
          docIds.push(resolved.value.documentId);
          exactDocs.push(resolved.value);
        }
      }
      if (docIds.length < 1 || docIds.length > UI_SURFACE_MAX_DOCUMENTS) {
        return fail("DOCUMENT_LIMIT_EXCEEDED", `${op} must reference 1..${UI_SURFACE_MAX_DOCUMENTS} documents.`, nodeId, "action.docRefs");
      }
      return ok({ payload: { op, documentIds: docIds }, exactDocs, actionDocIds: docIds });
    }

    if (!hasOnlyOwnKeys(raw, ["op", "documentIds"])) {
      return fail("INVALID_SHAPE", `${op} has unexpected keys.`, nodeId, "action");
    }
    const documentIds = ownProp(raw, "documentIds");
    if (!Array.isArray(documentIds) || documentIds.length < 1 || documentIds.length > UI_SURFACE_MAX_DOCUMENTS) {
      return fail("INVALID_FIELD_VALUE", `${op}.documentIds must contain 1..${UI_SURFACE_MAX_DOCUMENTS} UUIDs.`, nodeId, "action.documentIds");
    }
    const seen = new Set<string>();
    const validated: string[] = [];
    for (let i = 0; i < documentIds.length; i++) {
      const id = documentIds[i];
      if (!isValidUuid(id) || seen.has(id)) {
        return fail("INVALID_FIELD_VALUE", `${op}.documentIds[${i}] must be a unique UUID.`, nodeId, `action.documentIds[${i}]`);
      }
      seen.add(id);
      validated.push(id);
    }
    return ok({ payload: { op, documentIds: validated }, exactDocs: [], actionDocIds: validated });
  }

  if (op === "apply_filter") {
    const allowedKeys =
      ctx.mode === "draft"
        ? ["op", "departmentRef", "typeCode", "collectionRef", "readerScope", "validity"]
        : ["op", "ownerDepartmentId", "typeCode", "collectionId", "readerScope", "validity"];
    if (!hasOnlyOwnKeys(raw, allowedKeys)) {
      return fail("INVALID_SHAPE", "apply_filter has unexpected keys.", nodeId, "action");
    }

    let ownerDepartmentId: string | undefined;
    let collectionId: string | undefined;
    if (ctx.mode === "draft") {
      const deptRef = ownProp(raw, "departmentRef");
      if (deptRef !== undefined && deptRef !== null) {
        const res = resolveNamedHandle(deptRef, ctx.handleMap!.departments, "department", nodeId, "action.departmentRef");
        if (!res.ok) return res;
        ownerDepartmentId = res.value;
      }
      const colRef = ownProp(raw, "collectionRef");
      if (colRef !== undefined && colRef !== null) {
        const res = resolveNamedHandle(colRef, ctx.handleMap!.collections, "collection", nodeId, "action.collectionRef");
        if (!res.ok) return res;
        collectionId = res.value;
      }
    } else {
      const deptId = ownProp(raw, "ownerDepartmentId");
      if (deptId !== undefined) {
        if (!isValidUuid(deptId)) {
          return fail("INVALID_FIELD_VALUE", "apply_filter.ownerDepartmentId must be a UUID.", nodeId, "action.ownerDepartmentId");
        }
        ownerDepartmentId = deptId;
      }
      const colId = ownProp(raw, "collectionId");
      if (colId !== undefined) {
        if (!isValidUuid(colId)) {
          return fail("INVALID_FIELD_VALUE", "apply_filter.collectionId must be a UUID.", nodeId, "action.collectionId");
        }
        collectionId = colId;
      }
    }

    const rawTypeCode = ownProp(raw, "typeCode");
    let typeCode: GraphTypeCode | undefined;
    if (rawTypeCode !== undefined && !(allowNull && rawTypeCode === null)) {
      if (typeof rawTypeCode !== "string" || !GRAPH_TYPE_CODE_SET.has(rawTypeCode)) {
        return fail("INVALID_FIELD_VALUE", "apply_filter.typeCode is invalid.", nodeId, "action.typeCode");
      }
      typeCode = rawTypeCode as GraphTypeCode;
    }

    const rawReaderScope = ownProp(raw, "readerScope");
    let readerScope: GraphReaderScope | undefined;
    if (rawReaderScope !== undefined && !(allowNull && rawReaderScope === null)) {
      if (typeof rawReaderScope !== "string" || !GRAPH_READER_SCOPE_SET.has(rawReaderScope)) {
        return fail("INVALID_FIELD_VALUE", "apply_filter.readerScope is invalid.", nodeId, "action.readerScope");
      }
      readerScope = rawReaderScope as GraphReaderScope;
    }

    const rawValidity = ownProp(raw, "validity");
    let validity: "CURRENT" | "EXPIRING_SOON" | undefined;
    if (rawValidity !== undefined && !(allowNull && rawValidity === null)) {
      if (rawValidity !== "CURRENT" && rawValidity !== "EXPIRING_SOON") {
        return fail("INVALID_FIELD_VALUE", "apply_filter.validity only allows CURRENT or EXPIRING_SOON.", nodeId, "action.validity");
      }
      validity = rawValidity;
    }

    if (!ownerDepartmentId && !typeCode && !collectionId && !readerScope && !validity) {
      return fail("INVALID_FIELD_VALUE", "apply_filter must specify at least one filter facet.", nodeId, "action");
    }

    return ok({
      payload: {
        op: "apply_filter",
        ...(ownerDepartmentId !== undefined ? { ownerDepartmentId } : {}),
        ...(typeCode !== undefined ? { typeCode } : {}),
        ...(collectionId !== undefined ? { collectionId } : {}),
        ...(readerScope !== undefined ? { readerScope } : {}),
        ...(validity !== undefined ? { validity } : {}),
      },
      exactDocs: [],
      actionDocIds: [],
    });
  }

  if (op === "isolate_branch") {
    const branchKind = ownProp(raw, "branchKind");
    if (branchKind !== "department" && branchKind !== "collection" && branchKind !== "type") {
      return fail("INVALID_FIELD_VALUE", "isolate_branch.branchKind is invalid.", nodeId, "action.branchKind");
    }
    if (ctx.mode === "draft") {
      if (!hasOnlyOwnKeys(raw, ["op", "branchKind", "branchRef"])) {
        return fail("INVALID_SHAPE", "isolate_branch has unexpected keys.", nodeId, "action");
      }
      const branchRef = ownProp(raw, "branchRef");
      if (branchKind === "department") {
        const resolved = resolveNamedHandle(
          branchRef,
          ctx.handleMap!.departments,
          "department",
          nodeId,
          "action.branchRef",
        );
        if (!resolved.ok) return resolved;
        return ok({
          payload: { op: "isolate_branch", branchKind, branchId: resolved.value },
          exactDocs: [],
          actionDocIds: [],
        });
      }
      if (branchKind === "collection") {
        const resolved = resolveNamedHandle(
          branchRef,
          ctx.handleMap!.collections,
          "collection",
          nodeId,
          "action.branchRef",
        );
        if (!resolved.ok) return resolved;
        return ok({
          payload: { op: "isolate_branch", branchKind, branchId: resolved.value },
          exactDocs: [],
          actionDocIds: [],
        });
      }
      if (typeof branchRef !== "string" || !GRAPH_TYPE_CODE_SET.has(branchRef)) {
        return fail("INVALID_FIELD_VALUE", "isolate_branch.branchRef must be a valid GraphTypeCode.", nodeId, "action.branchRef");
      }
      return ok({
        payload: { op: "isolate_branch", branchKind: "type", branchId: branchRef },
        exactDocs: [],
        actionDocIds: [],
      });
    }

    if (!hasOnlyOwnKeys(raw, ["op", "branchKind", "branchId"])) {
      return fail("INVALID_SHAPE", "isolate_branch has unexpected keys.", nodeId, "action");
    }
    const branchId = ownProp(raw, "branchId");
    if (branchKind === "type") {
      if (typeof branchId !== "string" || !GRAPH_TYPE_CODE_SET.has(branchId)) {
        return fail("INVALID_FIELD_VALUE", "isolate_branch.branchId must be a valid GraphTypeCode.", nodeId, "action.branchId");
      }
    } else if (!isValidUuid(branchId)) {
      return fail("INVALID_FIELD_VALUE", "isolate_branch.branchId must be a valid UUID.", nodeId, "action.branchId");
    }
    return ok({
      payload: { op: "isolate_branch", branchKind, branchId },
      exactDocs: [],
      actionDocIds: [],
    });
  }

  if (op === "toggle_links") {
    if (!hasOnlyOwnKeys(raw, ["op", "enabled", "relationshipTypes"])) {
      return fail("INVALID_SHAPE", "toggle_links has unexpected keys.", nodeId, "action");
    }
    const enabled = ownProp(raw, "enabled");
    if (typeof enabled !== "boolean") {
      return fail("INVALID_FIELD_VALUE", "toggle_links.enabled must be a boolean.", nodeId, "action.enabled");
    }
    const rawRelTypes = ownProp(raw, "relationshipTypes");
    const relTypes = parseEnumList<DocumentRelationshipType>(rawRelTypes, RELATIONSHIP_TYPE_SET, {
      min: rawRelTypes !== undefined && !(allowNull && rawRelTypes === null) ? 1 : 0,
      max: 3,
      allowNull,
      dedupe,
      nodeId,
      path: "action.relationshipTypes",
    });
    if (!relTypes.ok) return relTypes;
    return ok({
      payload: {
        op: "toggle_links",
        enabled,
        ...(relTypes.value ? { relationshipTypes: relTypes.value } : {}),
      },
      exactDocs: [],
      actionDocIds: [],
    });
  }

  return fail("INVALID_FIELD_VALUE", "Unsupported graph_action op.", nodeId, "action.op");
}

function parseSingleNode(raw: unknown, nodeId: NodeId, ctx: NodeParseContext): ParseOutcome<ParsedNodeEntry> {
  if (!isPlainObject(raw)) {
    return fail("INVALID_SHAPE", "Node entry must be a plain object.", nodeId);
  }
  const kind = ownProp(raw, "kind");
  const allowNull = ctx.mode === "draft";
  const dedupe = ctx.mode === "draft";
  const idPrefix = ctx.mode === "draft" ? ["id"] : [];

  switch (kind) {
    case "stack": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "gap", "childIds"])) {
        return fail("INVALID_SHAPE", "stack node has unexpected keys.", nodeId);
      }
      const gapRaw = ownProp(raw, "gap");
      let gap: "sm" | "md" | undefined;
      if (gapRaw !== undefined && !(allowNull && gapRaw === null)) {
        if (gapRaw !== "sm" && gapRaw !== "md") {
          return fail("INVALID_FIELD_VALUE", "stack.gap must be 'sm' or 'md'.", nodeId, "gap");
        }
        gap = gapRaw;
      }
      const childIds = parseNodeIdArray(ownProp(raw, "childIds"), 1, 12, nodeId, "childIds");
      if (!childIds.ok) return childIds;
      return ok({
        node: { kind: "stack", ...(gap ? { gap } : {}), childIds: childIds.value },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "row": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "columns", "childIds"])) {
        return fail("INVALID_SHAPE", "row node has unexpected keys.", nodeId);
      }
      const columnsRaw = ownProp(raw, "columns");
      let columns: 2 | 3 | undefined;
      if (columnsRaw !== undefined && !(allowNull && columnsRaw === null)) {
        if (columnsRaw !== 2 && columnsRaw !== 3) {
          return fail("INVALID_FIELD_VALUE", "row.columns must be 2 or 3.", nodeId, "columns");
        }
        columns = columnsRaw;
      }
      const childIds = parseNodeIdArray(ownProp(raw, "childIds"), 1, 6, nodeId, "childIds");
      if (!childIds.ok) return childIds;
      return ok({
        node: { kind: "row", ...(columns ? { columns } : {}), childIds: childIds.value },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "card": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "title", "subtitle", "tone", "bodyIds", "footerIds"])) {
        return fail("INVALID_SHAPE", "card node has unexpected keys.", nodeId);
      }
      const title = validateOptionalText(ownProp(raw, "title"), {
        maxLength: 120,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "title",
      });
      if (!title.ok) return title;
      const subtitle = validateOptionalText(ownProp(raw, "subtitle"), {
        maxLength: 160,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "subtitle",
      });
      if (!subtitle.ok) return subtitle;
      const toneRaw = ownProp(raw, "tone");
      let tone: "default" | "subtle" | undefined;
      if (toneRaw !== undefined && !(allowNull && toneRaw === null)) {
        if (toneRaw !== "default" && toneRaw !== "subtle") {
          return fail("INVALID_FIELD_VALUE", "card.tone must be 'default' or 'subtle'.", nodeId, "tone");
        }
        tone = toneRaw;
      }
      const bodyIds = parseNodeIdArray(ownProp(raw, "bodyIds"), 1, 8, nodeId, "bodyIds");
      if (!bodyIds.ok) return bodyIds;
      const footerRaw = ownProp(raw, "footerIds");
      let footerIds: NodeId[] | undefined;
      if (footerRaw !== undefined && !(allowNull && footerRaw === null)) {
        const parsed = parseNodeIdArray(footerRaw, 0, 4, nodeId, "footerIds");
        if (!parsed.ok) return parsed;
        if (parsed.value.length > 0) footerIds = parsed.value;
      }
      return ok({
        node: {
          kind: "card",
          ...(title.value !== undefined ? { title: title.value } : {}),
          ...(subtitle.value !== undefined ? { subtitle: subtitle.value } : {}),
          ...(tone !== undefined ? { tone } : {}),
          bodyIds: bodyIds.value,
          ...(footerIds !== undefined ? { footerIds } : {}),
        },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "section": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "title", "defaultOpen", "childIds"])) {
        return fail("INVALID_SHAPE", "section node has unexpected keys.", nodeId);
      }
      const title = validateSafeText(ownProp(raw, "title"), {
        minLength: 1,
        maxLength: 120,
        allowUrls: false,
        nodeId,
        path: "title",
      });
      if (!title.ok) return title;
      const defaultOpenRaw = ownProp(raw, "defaultOpen");
      let defaultOpen: boolean | undefined;
      if (defaultOpenRaw !== undefined && !(allowNull && defaultOpenRaw === null)) {
        if (typeof defaultOpenRaw !== "boolean") {
          return fail("INVALID_FIELD_VALUE", "section.defaultOpen must be a boolean.", nodeId, "defaultOpen");
        }
        defaultOpen = defaultOpenRaw;
      }
      const childIds = parseNodeIdArray(ownProp(raw, "childIds"), 1, 8, nodeId, "childIds");
      if (!childIds.ok) return childIds;
      return ok({
        node: {
          kind: "section",
          title: title.value,
          ...(defaultOpen !== undefined ? { defaultOpen } : {}),
          childIds: childIds.value,
        },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "tabs": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "defaultTabId", "tabs"])) {
        return fail("INVALID_SHAPE", "tabs node has unexpected keys.", nodeId);
      }
      const rawTabs = ownProp(raw, "tabs");
      if (!Array.isArray(rawTabs) || rawTabs.length < 2 || rawTabs.length > 4) {
        return fail("INVALID_FIELD_VALUE", "tabs.tabs must contain 2..4 tabs.", nodeId, "tabs");
      }
      const seenTabIds = new Set<string>();
      const tabs: BoundTabPanel[] = [];
      for (let i = 0; i < rawTabs.length; i++) {
        const entry = rawTabs[i];
        if (!isPlainObject(entry) || !hasOnlyOwnKeys(entry, ["id", "label", "childIds"])) {
          return fail("INVALID_SHAPE", `tabs.tabs[${i}] has invalid shape.`, nodeId, `tabs[${i}]`);
        }
        const tabId = ownProp(entry, "id");
        if (!isValidNodeId(tabId)) {
          return fail("INVALID_NODE_ID", `tabs.tabs[${i}].id is not a valid identifier.`, nodeId, `tabs[${i}].id`);
        }
        if (seenTabIds.has(tabId)) {
          return fail("INVALID_FIELD_VALUE", `tabs.tabs[${i}].id must be unique.`, nodeId, `tabs[${i}].id`);
        }
        seenTabIds.add(tabId);
        const label = validateSafeText(ownProp(entry, "label"), {
          minLength: 1,
          maxLength: 40,
          allowUrls: false,
          nodeId,
          path: `tabs[${i}].label`,
        });
        if (!label.ok) return label;
        const childIds = parseNodeIdArray(ownProp(entry, "childIds"), 1, 6, nodeId, `tabs[${i}].childIds`);
        if (!childIds.ok) return childIds;
        tabs.push({ id: tabId, label: label.value, childIds: childIds.value });
      }
      const defaultTabId = ownProp(raw, "defaultTabId");
      if (typeof defaultTabId !== "string" || !seenTabIds.has(defaultTabId)) {
        return fail("INVALID_FIELD_VALUE", "tabs.defaultTabId must match one of tabs[].id.", nodeId, "defaultTabId");
      }
      return ok({
        node: { kind: "tabs", defaultTabId, tabs },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "split": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "leftTitle", "leftId", "rightTitle", "rightId"])) {
        return fail("INVALID_SHAPE", "split node has unexpected keys.", nodeId);
      }
      const leftTitle = validateOptionalText(ownProp(raw, "leftTitle"), {
        maxLength: 80,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "leftTitle",
      });
      if (!leftTitle.ok) return leftTitle;
      const rightTitle = validateOptionalText(ownProp(raw, "rightTitle"), {
        maxLength: 80,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "rightTitle",
      });
      if (!rightTitle.ok) return rightTitle;
      const leftId = ownProp(raw, "leftId");
      const rightId = ownProp(raw, "rightId");
      if (!isValidNodeId(leftId)) {
        return fail("INVALID_NODE_ID", "split.leftId is not a valid NodeId.", nodeId, "leftId");
      }
      if (!isValidNodeId(rightId)) {
        return fail("INVALID_NODE_ID", "split.rightId is not a valid NodeId.", nodeId, "rightId");
      }
      return ok({
        node: {
          kind: "split",
          ...(leftTitle.value !== undefined ? { leftTitle: leftTitle.value } : {}),
          leftId,
          ...(rightTitle.value !== undefined ? { rightTitle: rightTitle.value } : {}),
          rightId,
        },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "prose": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "markdown", "citationIndexes"])) {
        return fail("INVALID_SHAPE", "prose node has unexpected keys.", nodeId);
      }
      const markdown = validateSafeText(ownProp(raw, "markdown"), {
        minLength: 1,
        maxLength: UI_SURFACE_MAX_PROSE_LENGTH,
        allowUrls: true,
        nodeId,
        path: "markdown",
      });
      if (!markdown.ok) return markdown;
      const inlineCitations = extractInlineProseCitations(markdown.value, ctx.citationCount, nodeId);
      if (!inlineCitations.ok) return inlineCitations;
      const explicitCitations = parseCitationIndexArray(ownProp(raw, "citationIndexes"), {
        min: 0,
        max: UI_SURFACE_MAX_CITATIONS,
        allowNull,
        dedupe,
        maxCitationCount: ctx.citationCount,
        nodeId,
        path: "citationIndexes",
      });
      if (!explicitCitations.ok) return explicitCitations;
      const allCitations = new Set<number>([...inlineCitations.value, ...(explicitCitations.value ?? [])]);
      return ok({
        node: {
          kind: "prose",
          markdown: markdown.value,
          ...(explicitCitations.value !== undefined ? { citationIndexes: explicitCitations.value } : {}),
        },
        exactDocs: [],
        actionDocIds: [],
        citations: [...allCitations],
      });
    }

    case "document_item": {
      const allowedKeys =
        ctx.mode === "draft"
          ? [...idPrefix, "kind", "docRef", "highlightNote"]
          : ["kind", "documentId", "publishedVersionId", "highlightNote"];
      if (!hasOnlyOwnKeys(raw, allowedKeys)) {
        return fail("INVALID_SHAPE", "document_item node has unexpected keys.", nodeId);
      }
      const doc = parseDocumentIdentity(raw, ctx, nodeId, "documentId", "publishedVersionId");
      if (!doc.ok) return doc;
      const highlightNote = validateOptionalText(ownProp(raw, "highlightNote"), {
        maxLength: 120,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "highlightNote",
      });
      if (!highlightNote.ok) return highlightNote;
      return ok({
        node: {
          kind: "document_item",
          documentId: doc.value.documentId,
          publishedVersionId: doc.value.publishedVersionId,
          ...(highlightNote.value !== undefined ? { highlightNote: highlightNote.value } : {}),
        },
        exactDocs: [doc.value],
        actionDocIds: [],
        citations: [],
      });
    }

    case "governance_kv": {
      const allowedKeys =
        ctx.mode === "draft"
          ? [...idPrefix, "kind", "docRef", "fields"]
          : ["kind", "documentId", "publishedVersionId", "fields"];
      if (!hasOnlyOwnKeys(raw, allowedKeys)) {
        return fail("INVALID_SHAPE", "governance_kv node has unexpected keys.", nodeId);
      }
      const doc = parseDocumentIdentity(raw, ctx, nodeId, "documentId", "publishedVersionId");
      if (!doc.ok) return doc;
      const rawFields = ownProp(raw, "fields");
      const fields = parseEnumList<GovernanceFieldKey>(rawFields, GOVERNANCE_FIELD_SET, {
        min: rawFields !== undefined && !(allowNull && rawFields === null) ? 1 : 0,
        max: governanceFieldKeys.length,
        allowNull,
        dedupe,
        nodeId,
        path: "fields",
      });
      if (!fields.ok) return fields;
      return ok({
        node: {
          kind: "governance_kv",
          documentId: doc.value.documentId,
          publishedVersionId: doc.value.publishedVersionId,
          ...(fields.value !== undefined ? { fields: fields.value } : {}),
        },
        exactDocs: [doc.value],
        actionDocIds: [],
        citations: [],
      });
    }

    case "comparison_table": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "caption", "columns", "rows"])) {
        return fail("INVALID_SHAPE", "comparison_table node has unexpected keys.", nodeId);
      }
      const caption = validateOptionalText(ownProp(raw, "caption"), {
        maxLength: 120,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "caption",
      });
      if (!caption.ok) return caption;

      const rawCols = ownProp(raw, "columns");
      if (!Array.isArray(rawCols) || rawCols.length < 2 || rawCols.length > 5) {
        return fail("INVALID_FIELD_VALUE", "comparison_table.columns must contain 2..5 headings.", nodeId, "columns");
      }
      const columns: string[] = [];
      for (let c = 0; c < rawCols.length; c++) {
        const heading = validateSafeText(rawCols[c], {
          minLength: 1,
          maxLength: 60,
          allowUrls: false,
          nodeId,
          path: `columns[${c}]`,
        });
        if (!heading.ok) return heading;
        columns.push(heading.value);
      }

      const rawRows = ownProp(raw, "rows");
      if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 12) {
        return fail("INVALID_FIELD_VALUE", "comparison_table.rows must contain 1..12 rows.", nodeId, "rows");
      }
      const tableCitations = new Set<number>();
      const rows: ComparisonTableRow[] = [];
      for (let r = 0; r < rawRows.length; r++) {
        const rawRow = rawRows[r];
        if (!isPlainObject(rawRow) || !hasOnlyOwnKeys(rawRow, ["cells"])) {
          return fail("INVALID_SHAPE", `comparison_table.rows[${r}] has invalid shape.`, nodeId, `rows[${r}]`);
        }
        const rawCells = ownProp(rawRow, "cells");
        if (!Array.isArray(rawCells) || rawCells.length !== columns.length) {
          return fail(
            "INVALID_FIELD_VALUE",
            `comparison_table.rows[${r}] must be strictly rectangular (${columns.length} cells).`,
            nodeId,
            `rows[${r}].cells`,
          );
        }
        const cells: ComparisonTableCell[] = [];
        let rowCitationCount = 0;
        for (let c = 0; c < rawCells.length; c++) {
          const rawCell = rawCells[c];
          if (!isPlainObject(rawCell) || !hasOnlyOwnKeys(rawCell, ["text", "citationIndexes"])) {
            return fail("INVALID_SHAPE", `comparison_table cell [${r}][${c}] has invalid shape.`, nodeId, `rows[${r}].cells[${c}]`);
          }
          const cellText = validateSafeText(ownProp(rawCell, "text"), {
            minLength: 0,
            maxLength: 280,
            allowUrls: false,
            nodeId,
            path: `rows[${r}].cells[${c}].text`,
          });
          if (!cellText.ok) return cellText;
          const cellCitations = parseCitationIndexArray(ownProp(rawCell, "citationIndexes"), {
            min: 0,
            max: 4,
            allowNull,
            dedupe,
            maxCitationCount: ctx.citationCount,
            nodeId,
            path: `rows[${r}].cells[${c}].citationIndexes`,
          });
          if (!cellCitations.ok) return cellCitations;
          if (cellCitations.value) {
            rowCitationCount += cellCitations.value.length;
            for (const idx of cellCitations.value) tableCitations.add(idx);
          }
          cells.push({
            text: cellText.value,
            ...(cellCitations.value !== undefined ? { citationIndexes: cellCitations.value } : {}),
          });
        }
        if (rowCitationCount < 1) {
          return fail(
            "UNCITED_TABLE_ROW",
            `comparison_table.rows[${r}] must cite at least one verified source.`,
            nodeId,
            `rows[${r}]`,
          );
        }
        rows.push({ cells });
      }
      return ok({
        node: {
          kind: "comparison_table",
          ...(caption.value !== undefined ? { caption: caption.value } : {}),
          columns,
          rows,
        },
        exactDocs: [],
        actionDocIds: [],
        citations: [...tableCitations],
      });
    }

    case "callout": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "tone", "title", "body", "citationIndexes"])) {
        return fail("INVALID_SHAPE", "callout node has unexpected keys.", nodeId);
      }
      const tone = ownProp(raw, "tone");
      if (typeof tone !== "string" || !CALLOUT_TONE_SET.has(tone)) {
        return fail("INVALID_FIELD_VALUE", "callout.tone is invalid.", nodeId, "tone");
      }
      if (!ctx.allowCoreCalloutTones && !LLM_CALLOUT_TONE_SET.has(tone)) {
        return fail(
          "FORBIDDEN_CALLOUT_TONE",
          "LLM-authored callout tones are restricted to 'info' and 'conflict'.",
          nodeId,
          "tone",
        );
      }
      const title = validateSafeText(ownProp(raw, "title"), {
        minLength: 1,
        maxLength: 120,
        allowUrls: false,
        nodeId,
        path: "title",
      });
      if (!title.ok) return title;
      const body = validateSafeText(ownProp(raw, "body"), {
        minLength: 1,
        maxLength: 800,
        allowUrls: false,
        nodeId,
        path: "body",
      });
      if (!body.ok) return body;
      const requiresCitation = LLM_CALLOUT_TONE_SET.has(tone);
      const citations = parseCitationIndexArray(ownProp(raw, "citationIndexes"), {
        min: requiresCitation ? 1 : 0,
        max: 6,
        allowNull,
        dedupe,
        maxCitationCount: ctx.citationCount,
        nodeId,
        path: "citationIndexes",
      });
      if (!citations.ok) return citations;
      return ok({
        node: {
          kind: "callout",
          tone: tone as CalloutTone,
          title: title.value,
          body: body.value,
          ...(citations.value !== undefined ? { citationIndexes: citations.value } : {}),
        },
        exactDocs: [],
        actionDocIds: [],
        citations: citations.value ?? [],
      });
    }

    case "metric_strip": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "metricKeys"])) {
        return fail("INVALID_SHAPE", "metric_strip node has unexpected keys.", nodeId);
      }
      const keys = parseEnumList<MetricKey>(ownProp(raw, "metricKeys"), METRIC_KEY_SET, {
        min: 1,
        max: 4,
        allowNull: false,
        dedupe,
        nodeId,
        path: "metricKeys",
      });
      if (!keys.ok) return keys;
      return ok({
        node: { kind: "metric_strip", metricKeys: keys.value! },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    case "lineage_tree": {
      const allowedKeys =
        ctx.mode === "draft"
          ? [...idPrefix, "kind", "docRef"]
          : ["kind", "rootDocumentId", "rootPublishedVersionId"];
      if (!hasOnlyOwnKeys(raw, allowedKeys)) {
        return fail("INVALID_SHAPE", "lineage_tree node has unexpected keys.", nodeId);
      }
      const doc = parseDocumentIdentity(raw, ctx, nodeId, "rootDocumentId", "rootPublishedVersionId");
      if (!doc.ok) return doc;
      return ok({
        node: {
          kind: "lineage_tree",
          rootDocumentId: doc.value.documentId,
          rootPublishedVersionId: doc.value.publishedVersionId,
        },
        exactDocs: [doc.value],
        actionDocIds: [],
        citations: [],
      });
    }

    case "graph_action": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "label", "action"])) {
        return fail("INVALID_SHAPE", "graph_action node has unexpected keys.", nodeId);
      }
      const label = validateSafeText(ownProp(raw, "label"), {
        minLength: 1,
        maxLength: 48,
        allowUrls: false,
        nodeId,
        path: "label",
      });
      if (!label.ok) return label;
      const action = parseGraphActionPayload(ownProp(raw, "action"), ctx, nodeId);
      if (!action.ok) return action;
      return ok({
        node: { kind: "graph_action", label: label.value, action: action.value.payload },
        exactDocs: action.value.exactDocs,
        actionDocIds: action.value.actionDocIds,
        citations: [],
      });
    }

    case "open_reader": {
      const allowedKeys =
        ctx.mode === "draft"
          ? [...idPrefix, "kind", "label", "docRef", "blockId", "page"]
          : ["kind", "label", "documentId", "publishedVersionId", "blockId", "page"];
      if (!hasOnlyOwnKeys(raw, allowedKeys)) {
        return fail("INVALID_SHAPE", "open_reader node has unexpected keys.", nodeId);
      }
      const label = validateSafeText(ownProp(raw, "label"), {
        minLength: 1,
        maxLength: 48,
        allowUrls: false,
        nodeId,
        path: "label",
      });
      if (!label.ok) return label;
      const doc = parseDocumentIdentity(raw, ctx, nodeId, "documentId", "publishedVersionId");
      if (!doc.ok) return doc;
      const blockId = validateOptionalText(ownProp(raw, "blockId"), {
        maxLength: 128,
        allowNull,
        allowUrls: false,
        nodeId,
        path: "blockId",
      });
      if (!blockId.ok) return blockId;
      const pageRaw = ownProp(raw, "page");
      let page: number | undefined;
      if (pageRaw !== undefined && !(allowNull && pageRaw === null)) {
        if (typeof pageRaw !== "number" || !Number.isSafeInteger(pageRaw) || pageRaw < 1 || pageRaw > 100_000) {
          return fail("INVALID_FIELD_VALUE", "open_reader.page must be an integer in 1..100000.", nodeId, "page");
        }
        page = pageRaw;
      }
      return ok({
        node: {
          kind: "open_reader",
          label: label.value,
          documentId: doc.value.documentId,
          publishedVersionId: doc.value.publishedVersionId,
          ...(blockId.value !== undefined ? { blockId: blockId.value } : {}),
          ...(page !== undefined ? { page } : {}),
        },
        exactDocs: [doc.value],
        actionDocIds: [],
        citations: [],
      });
    }

    case "workflow_handoff": {
      const allowedKeys =
        ctx.mode === "draft"
          ? [...idPrefix, "kind", "label", "handoff", "docRef"]
          : ["kind", "label", "handoff", "documentId", "publishedVersionId"];
      if (!hasOnlyOwnKeys(raw, allowedKeys)) {
        return fail("INVALID_SHAPE", "workflow_handoff node has unexpected keys.", nodeId);
      }
      const label = validateSafeText(ownProp(raw, "label"), {
        minLength: 1,
        maxLength: 48,
        allowUrls: false,
        nodeId,
        path: "label",
      });
      if (!label.ok) return label;
      const handoff = ownProp(raw, "handoff");
      if (typeof handoff !== "string" || !WORKFLOW_HANDOFF_SET.has(handoff)) {
        return fail("INVALID_FIELD_VALUE", "workflow_handoff.handoff is invalid.", nodeId, "handoff");
      }
      const doc = parseDocumentIdentity(raw, ctx, nodeId, "documentId", "publishedVersionId");
      if (!doc.ok) return doc;
      return ok({
        node: {
          kind: "workflow_handoff",
          label: label.value,
          handoff: handoff as WorkflowHandoffKind,
          documentId: doc.value.documentId,
          publishedVersionId: doc.value.publishedVersionId,
        },
        exactDocs: [doc.value],
        actionDocIds: [],
        citations: [],
      });
    }

    case "prompt_chip": {
      if (!hasOnlyOwnKeys(raw, [...idPrefix, "kind", "label", "prompt"])) {
        return fail("INVALID_SHAPE", "prompt_chip node has unexpected keys.", nodeId);
      }
      const label = validateSafeText(ownProp(raw, "label"), {
        minLength: 1,
        maxLength: 60,
        allowUrls: false,
        nodeId,
        path: "label",
      });
      if (!label.ok) return label;
      const prompt = validateSafeText(ownProp(raw, "prompt"), {
        minLength: 1,
        maxLength: 400,
        allowUrls: false,
        nodeId,
        path: "prompt",
      });
      if (!prompt.ok) return prompt;
      return ok({
        node: { kind: "prompt_chip", label: label.value, prompt: prompt.value },
        exactDocs: [],
        actionDocIds: [],
        citations: [],
      });
    }

    default:
      return fail("INVALID_FIELD_VALUE", "Unsupported UiSurface node kind.", nodeId, "kind");
  }
}

function parseDocumentIdentity(
  raw: Record<string, unknown>,
  ctx: NodeParseContext,
  nodeId: string,
  docKey: string,
  verKey: string,
): ParseOutcome<SurfaceDocumentHandle> {
  if (ctx.mode === "draft") {
    return resolveDocumentHandle(ownProp(raw, "docRef"), ctx.handleMap!, nodeId, "docRef");
  }
  const documentId = ownProp(raw, docKey);
  const publishedVersionId = ownProp(raw, verKey);
  if (!isValidUuid(documentId)) {
    return fail("INVALID_FIELD_VALUE", `${docKey} must be a valid UUID.`, nodeId, docKey);
  }
  if (!isValidUuid(publishedVersionId)) {
    return fail("INVALID_FIELD_VALUE", `${verKey} must be a valid UUID.`, nodeId, verKey);
  }
  return ok({ documentId, publishedVersionId });
}

function checkAncestorNesting(
  kind: BoundUiNode["kind"],
  ancestors: ReadonlySet<BoundUiNode["kind"]>,
  nodeId: NodeId,
): ParseOutcome<void> {
  if (kind === "card" && ancestors.has("card")) {
    return fail("FORBIDDEN_NESTING", "card cannot be nested anywhere inside a card subtree.", nodeId);
  }
  if (kind === "section" && ancestors.has("section")) {
    return fail("FORBIDDEN_NESTING", "section cannot be nested anywhere inside a section subtree.", nodeId);
  }
  if (
    kind === "tabs" &&
    (ancestors.has("tabs") || ancestors.has("section") || ancestors.has("row") || ancestors.has("split"))
  ) {
    return fail("FORBIDDEN_NESTING", "tabs cannot be nested inside tabs, section, row, or split subtrees.", nodeId);
  }
  if (kind === "split" && (ancestors.has("split") || ancestors.has("row"))) {
    return fail("FORBIDDEN_NESTING", "split cannot be nested inside split or row subtrees.", nodeId);
  }
  if ((kind === "row" || kind === "comparison_table") && ancestors.has("row")) {
    return fail("FORBIDDEN_NESTING", `${kind} cannot be nested inside a row subtree.`, nodeId);
  }
  if (kind === "comparison_table" && ancestors.has("split")) {
    return fail("FORBIDDEN_NESTING", "comparison_table cannot be nested inside a split subtree.", nodeId);
  }
  return ok(undefined);
}

interface TreeTraversalSummary {
  orderedNodeIds: NodeId[];
  exactDocByDocId: Map<string, string>;
  orderedExactDocs: SurfaceDocumentHandle[];
  actionDocIds: Set<string>;
  citations: Set<number>;
}

function validateStrictTree(
  rootId: NodeId,
  parsedMap: ReadonlyMap<NodeId, ParsedNodeEntry>,
): ParseOutcome<TreeTraversalSummary> {
  const rootEntry = parsedMap.get(rootId);
  if (!rootEntry) {
    return fail("UNKNOWN_NODE_REF", "rootId does not reference an existing node.", rootId, "rootId");
  }
  if (rootEntry.node.kind !== "stack" && rootEntry.node.kind !== "card") {
    return fail("INVALID_ROOT", "Root node kind must be 'stack' or 'card'.", rootId, "rootId");
  }

  const visited = new Set<NodeId>();
  const orderedNodeIds: NodeId[] = [];
  const exactDocByDocId = new Map<string, string>();
  const orderedExactDocs: SurfaceDocumentHandle[] = [];
  const actionDocIds = new Set<string>();
  const citations = new Set<number>();

  function visit(
    nodeId: NodeId,
    depth: number,
    ancestors: ReadonlySet<BoundUiNode["kind"]>,
    inFooter: boolean,
  ): ParseOutcome<void> {
    const entry = parsedMap.get(nodeId);
    if (!entry) {
      return fail("UNKNOWN_NODE_REF", "Child reference does not exist in nodes.", nodeId);
    }
    if (visited.has(nodeId)) {
      return fail("CYCLE_OR_REUSED_NODE", "Nodes must form a strict tree with no cycles or shared DAG children.", nodeId);
    }
    if (depth > UI_SURFACE_MAX_DEPTH) {
      return fail(
        "DEPTH_LIMIT_EXCEEDED",
        `Tree depth exceeds maximum allowed 0-based depth of ${UI_SURFACE_MAX_DEPTH}.`,
        nodeId,
      );
    }
    if (inFooter && !ACTION_KIND_SET.has(entry.node.kind)) {
      return fail("INVALID_FOOTER_NODE", "card.footerIds may reference Action primitives only.", nodeId);
    }
    const nestingCheck = checkAncestorNesting(entry.node.kind, ancestors, nodeId);
    if (!nestingCheck.ok) return nestingCheck;

    visited.add(nodeId);
    orderedNodeIds.push(nodeId);

    for (const doc of entry.exactDocs) {
      const existing = exactDocByDocId.get(doc.documentId);
      if (existing !== undefined && existing !== doc.publishedVersionId) {
        return fail(
          "BINDINGS_MISMATCH",
          "Conflicting publishedVersionId references for the same documentId.",
          nodeId,
        );
      }
      if (existing === undefined) {
        exactDocByDocId.set(doc.documentId, doc.publishedVersionId);
        orderedExactDocs.push(doc);
      }
    }
    for (const docId of entry.actionDocIds) {
      actionDocIds.add(docId);
    }
    for (const idx of entry.citations) {
      citations.add(idx);
    }

    const nextAncestors = new Set<BoundUiNode["kind"]>(ancestors);
    nextAncestors.add(entry.node.kind);

    const node = entry.node;
    switch (node.kind) {
      case "stack":
      case "row":
      case "section": {
        for (const childId of node.childIds) {
          const res = visit(childId, depth + 1, nextAncestors, false);
          if (!res.ok) return res;
        }
        break;
      }
      case "card": {
        for (const childId of node.bodyIds) {
          const res = visit(childId, depth + 1, nextAncestors, false);
          if (!res.ok) return res;
        }
        if (node.footerIds) {
          for (const childId of node.footerIds) {
            const res = visit(childId, depth + 1, nextAncestors, true);
            if (!res.ok) return res;
          }
        }
        break;
      }
      case "tabs": {
        for (const tab of node.tabs) {
          for (const childId of tab.childIds) {
            const res = visit(childId, depth + 1, nextAncestors, false);
            if (!res.ok) return res;
          }
        }
        break;
      }
      case "split": {
        const leftRes = visit(node.leftId, depth + 1, nextAncestors, false);
        if (!leftRes.ok) return leftRes;
        const rightRes = visit(node.rightId, depth + 1, nextAncestors, false);
        if (!rightRes.ok) return rightRes;
        break;
      }
      default:
        break;
    }
    return ok(undefined);
  }

  const rootRes = visit(rootId, 0, new Set(), false);
  if (!rootRes.ok) return rootRes;

  if (visited.size !== parsedMap.size) {
    return fail("ORPHAN_NODE", "Every node must be reachable from rootId with zero orphan nodes.");
  }
  return ok({ orderedNodeIds, exactDocByDocId, orderedExactDocs, actionDocIds, citations });
}

function finalizeSurface(
  rootId: NodeId,
  orderedNodeIds: readonly NodeId[],
  parsedMap: ReadonlyMap<NodeId, ParsedNodeEntry>,
  documents: SurfaceDocumentHandle[],
  citationIndexes: number[],
): SurfaceValidationResult {
  if (documents.length > UI_SURFACE_MAX_DOCUMENTS) {
    return fail(
      "DOCUMENT_LIMIT_EXCEEDED",
      `UiSurface may reference at most ${UI_SURFACE_MAX_DOCUMENTS} distinct documents.`,
    );
  }
  if (citationIndexes.length > UI_SURFACE_MAX_CITATIONS) {
    return fail(
      "CITATION_LIMIT_EXCEEDED",
      `UiSurface may reference at most ${UI_SURFACE_MAX_CITATIONS} distinct citations.`,
    );
  }

  const nodes = Object.create(null) as Record<NodeId, BoundUiNode>;
  for (const id of orderedNodeIds) {
    nodes[id] = parsedMap.get(id)!.node;
  }

  const sortedDocuments = [...documents].sort((a, b) =>
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

  const surface: BoundUiSurface = {
    schemaVersion: UI_SURFACE_SCHEMA_VERSION,
    rootId,
    nodes,
    bindings: {
      documents: sortedDocuments,
      citationIndexes,
    },
  };

  const compactBytes = utf8Encoder.encode(JSON.stringify(surface)).byteLength;
  if (compactBytes > UI_SURFACE_MAX_COMPACT_BYTES) {
    return fail(
      "BYTE_LIMIT_EXCEEDED",
      `Compact UiSurface payload (${compactBytes} bytes) exceeds ${UI_SURFACE_MAX_COMPACT_BYTES} byte limit.`,
    );
  }

  return { ok: true, surface };
}

/**
 * Validates an array-encoded `AiSurfaceDraft` from `Arden-AI /v3/generations` (or Core fallback),
 * strictly translates opaque handles through `handleMap`, enforces tree/depth/ancestor/content
 * invariants, and returns a null-prototype-safe `BoundUiSurface`.
 */
export function normalizeAndValidateSurface(
  draft: unknown,
  handleMap: SurfaceHandleMap,
  citationCount: number,
  options?: NormalizeSurfaceOptions,
): SurfaceValidationResult {
  if (!Number.isSafeInteger(citationCount) || citationCount < 0) {
    return fail("INVALID_FIELD_VALUE", "citationCount must be a non-negative safe integer.");
  }
  if (!isRecordObject(handleMap) || !isRecordObject(handleMap.documents)) {
    return fail("INVALID_SHAPE", "handleMap must be an object with a documents map.");
  }
  if (!isPlainObject(draft) || !hasOnlyOwnKeys(draft, ["schemaVersion", "rootId", "nodes"])) {
    return fail("INVALID_SHAPE", "AiSurfaceDraft must be a plain object with schemaVersion, rootId, and nodes.");
  }
  if (ownProp(draft, "schemaVersion") !== UI_SURFACE_SCHEMA_VERSION) {
    return fail("INVALID_SCHEMA_VERSION", "AiSurfaceDraft.schemaVersion must be 1.", undefined, "schemaVersion");
  }
  const rootId = ownProp(draft, "rootId");
  if (!isValidNodeId(rootId)) {
    return fail("INVALID_NODE_ID", "AiSurfaceDraft.rootId is not a valid NodeId.", undefined, "rootId");
  }
  const rawNodes = ownProp(draft, "nodes");
  if (!Array.isArray(rawNodes)) {
    return fail("INVALID_SHAPE", "AiSurfaceDraft.nodes must be an array.", undefined, "nodes");
  }
  if (rawNodes.length < 1 || rawNodes.length > UI_SURFACE_MAX_NODES) {
    return fail(
      "NODE_LIMIT_EXCEEDED",
      `AiSurfaceDraft.nodes must contain 1..${UI_SURFACE_MAX_NODES} nodes.`,
      undefined,
      "nodes",
    );
  }

  const ctx: NodeParseContext = {
    mode: "draft",
    handleMap,
    citationCount,
    allowCoreCalloutTones: options?.allowCoreCalloutTones === true,
  };

  const parsedMap = new Map<NodeId, ParsedNodeEntry>();
  for (let i = 0; i < rawNodes.length; i++) {
    const rawNode = rawNodes[i];
    if (!isPlainObject(rawNode)) {
      return fail("INVALID_SHAPE", `nodes[${i}] must be a plain object.`, undefined, `nodes[${i}]`);
    }
    const id = ownProp(rawNode, "id");
    if (!isValidNodeId(id)) {
      return fail("INVALID_NODE_ID", `nodes[${i}].id is not a valid NodeId.`, undefined, `nodes[${i}].id`);
    }
    if (parsedMap.has(id)) {
      return fail("DUPLICATE_NODE_ID", `Duplicate node id '${id}'.`, id, `nodes[${i}].id`);
    }
    const parsed = parseSingleNode(rawNode, id, ctx);
    if (!parsed.ok) return parsed;
    parsedMap.set(id, parsed.value);
  }

  const tree = validateStrictTree(rootId, parsedMap);
  if (!tree.ok) return tree;

  const citationIndexes = [...tree.value.citations].sort((a, b) => a - b);
  return finalizeSurface(rootId, tree.value.orderedNodeIds, parsedMap, tree.value.orderedExactDocs, citationIndexes);
}

/**
 * Validates a persisted `BoundUiSurface` loaded from storage without trusting prototype chains,
 * re-verifying all structural, ancestor, content, UUID, byte-size, and exact `bindings` invariants.
 */
export function validateStoredBoundSurface(
  stored: unknown,
  options?: ValidateStoredSurfaceOptions,
): SurfaceValidationResult {
  const citationCount = options?.citationCount;
  if (citationCount !== undefined && (!Number.isSafeInteger(citationCount) || citationCount < 0)) {
    return fail("INVALID_FIELD_VALUE", "options.citationCount must be a non-negative safe integer.");
  }
  if (!isPlainObject(stored) || !hasOnlyOwnKeys(stored, ["schemaVersion", "rootId", "nodes", "bindings"])) {
    return fail("INVALID_SHAPE", "BoundUiSurface must be a plain object with schemaVersion, rootId, nodes, and bindings.");
  }
  if (ownProp(stored, "schemaVersion") !== UI_SURFACE_SCHEMA_VERSION) {
    return fail("INVALID_SCHEMA_VERSION", "BoundUiSurface.schemaVersion must be 1.", undefined, "schemaVersion");
  }
  const rootId = ownProp(stored, "rootId");
  if (!isValidNodeId(rootId)) {
    return fail("INVALID_NODE_ID", "BoundUiSurface.rootId is not a valid NodeId.", undefined, "rootId");
  }

  const rawNodes = ownProp(stored, "nodes");
  if (!isPlainObject(rawNodes)) {
    return fail("INVALID_SHAPE", "BoundUiSurface.nodes must be a plain or null-prototype object.", undefined, "nodes");
  }
  const ownNodeKeys = Object.keys(rawNodes);
  if (ownNodeKeys.length < 1 || ownNodeKeys.length > UI_SURFACE_MAX_NODES) {
    return fail(
      "NODE_LIMIT_EXCEEDED",
      `BoundUiSurface.nodes must contain 1..${UI_SURFACE_MAX_NODES} entries.`,
      undefined,
      "nodes",
    );
  }

  const ctx: NodeParseContext = {
    mode: "stored",
    citationCount,
    allowCoreCalloutTones: true,
  };

  const parsedMap = new Map<NodeId, ParsedNodeEntry>();
  for (const key of ownNodeKeys) {
    if (!isValidNodeId(key)) {
      return fail("INVALID_NODE_ID", "BoundUiSurface.nodes contains an invalid or forbidden key.", key, "nodes");
    }
    const rawNode = ownProp(rawNodes, key);
    const parsed = parseSingleNode(rawNode, key, ctx);
    if (!parsed.ok) return parsed;
    parsedMap.set(key, parsed.value);
  }

  const tree = validateStrictTree(rootId, parsedMap);
  if (!tree.ok) return tree;

  // Validate stored bindings object and verify exact 1:1 mirror with tree references
  const rawBindings = ownProp(stored, "bindings");
  if (!isPlainObject(rawBindings) || !hasOnlyOwnKeys(rawBindings, ["documents", "citationIndexes"])) {
    return fail("INVALID_SHAPE", "BoundUiSurface.bindings must contain documents and citationIndexes.", undefined, "bindings");
  }

  const rawBoundDocs = ownProp(rawBindings, "documents");
  if (!Array.isArray(rawBoundDocs)) {
    return fail("INVALID_SHAPE", "bindings.documents must be an array.", undefined, "bindings.documents");
  }
  if (rawBoundDocs.length > UI_SURFACE_MAX_DOCUMENTS) {
    return fail("DOCUMENT_LIMIT_EXCEEDED", `bindings.documents exceeds ${UI_SURFACE_MAX_DOCUMENTS} entries.`, undefined, "bindings.documents");
  }
  const bindingByDocId = new Map<string, string>();
  const seenVersionIds = new Set<string>();
  const boundDocs: SurfaceDocumentHandle[] = [];
  for (let i = 0; i < rawBoundDocs.length; i++) {
    const entry = rawBoundDocs[i];
    if (!isPlainObject(entry) || !hasOnlyOwnKeys(entry, ["documentId", "publishedVersionId"])) {
      return fail("INVALID_SHAPE", `bindings.documents[${i}] has invalid shape.`, undefined, `bindings.documents[${i}]`);
    }
    const documentId = ownProp(entry, "documentId");
    const publishedVersionId = ownProp(entry, "publishedVersionId");
    if (!isValidUuid(documentId) || !isValidUuid(publishedVersionId)) {
      return fail(
        "INVALID_FIELD_VALUE",
        `bindings.documents[${i}] must contain valid UUIDs.`,
        undefined,
        `bindings.documents[${i}]`,
      );
    }
    if (bindingByDocId.has(documentId) || seenVersionIds.has(publishedVersionId)) {
      return fail("BINDINGS_MISMATCH", "bindings.documents must be deduplicated.", undefined, `bindings.documents[${i}]`);
    }
    bindingByDocId.set(documentId, publishedVersionId);
    seenVersionIds.add(publishedVersionId);
    boundDocs.push({ documentId, publishedVersionId });
  }

  // Every exact document node reference must match bindings.documents
  for (const [docId, verId] of tree.value.exactDocByDocId) {
    if (bindingByDocId.get(docId) !== verId) {
      return fail("BINDINGS_MISMATCH", "bindings.documents does not match node document/version references.", undefined, "bindings.documents");
    }
  }
  // Every graph_action focus_nodes / pin_to_context documentId must exist in bindings.documents
  for (const docId of tree.value.actionDocIds) {
    if (!bindingByDocId.has(docId)) {
      return fail("BINDINGS_MISMATCH", "bindings.documents is missing a document referenced by graph_action.", undefined, "bindings.documents");
    }
  }
  // Zero unreferenced phantom bindings
  for (const docId of bindingByDocId.keys()) {
    if (!tree.value.exactDocByDocId.has(docId) && !tree.value.actionDocIds.has(docId)) {
      return fail("BINDINGS_MISMATCH", "bindings.documents contains an unreferenced document.", undefined, "bindings.documents");
    }
  }

  const rawBoundCitations = ownProp(rawBindings, "citationIndexes");
  if (!Array.isArray(rawBoundCitations)) {
    return fail("INVALID_SHAPE", "bindings.citationIndexes must be an array.", undefined, "bindings.citationIndexes");
  }
  if (rawBoundCitations.length > UI_SURFACE_MAX_CITATIONS) {
    return fail("CITATION_LIMIT_EXCEEDED", `bindings.citationIndexes exceeds ${UI_SURFACE_MAX_CITATIONS} entries.`, undefined, "bindings.citationIndexes");
  }
  const boundCitationSet = new Set<number>();
  const upperCitation = citationCount ?? UI_SURFACE_MAX_CITATIONS;
  for (let i = 0; i < rawBoundCitations.length; i++) {
    const idx = rawBoundCitations[i];
    if (typeof idx !== "number" || !Number.isSafeInteger(idx) || idx < 1 || idx > upperCitation) {
      return fail(
        "INVALID_CITATION",
        `bindings.citationIndexes[${i}] is outside valid citation bounds.`,
        undefined,
        `bindings.citationIndexes[${i}]`,
      );
    }
    if (boundCitationSet.has(idx)) {
      return fail("BINDINGS_MISMATCH", "bindings.citationIndexes must be deduplicated.", undefined, "bindings.citationIndexes");
    }
    boundCitationSet.add(idx);
  }
  if (boundCitationSet.size !== tree.value.citations.size) {
    return fail("BINDINGS_MISMATCH", "bindings.citationIndexes does not match node citation references.", undefined, "bindings.citationIndexes");
  }
  for (const idx of tree.value.citations) {
    if (!boundCitationSet.has(idx)) {
      return fail("BINDINGS_MISMATCH", "bindings.citationIndexes is missing a referenced citation index.", undefined, "bindings.citationIndexes");
    }
  }

  const sortedCitations = [...boundCitationSet].sort((a, b) => a - b);
  return finalizeSurface(rootId, tree.value.orderedNodeIds, parsedMap, boundDocs, sortedCitations);
}
