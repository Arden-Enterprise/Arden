import {
  documentRelationshipTypes,
  graphReaderScopes,
  graphTypeCodes,
  graphValidityFilters,
  graphViewModes,
  type DocumentRelationshipType,
  type GraphReaderScope,
  type GraphTypeCode,
  type GraphValidityFilter,
  type GraphViewMode,
  type KnowledgeGraphQuery,
} from "@arden/domain";
import type { GraphClientFilters } from "./layout";

export interface GraphFilterState {
  view: GraphViewMode;
  q: string;
  ownerDepartmentId: string;
  typeCode: GraphTypeCode | "";
  collectionId: string;
  readerScope: GraphReaderScope | "";
  validity: GraphValidityFilter | "";
  isolateMatching: boolean;
  includeLinks: boolean;
  relationshipTypes: DocumentRelationshipType[];
  monitor: boolean;
  onlyOpenCases: boolean;
  onlyUnassignedOrg: boolean;
  includeExpired: boolean;
  focusDocumentId: string | null;
}

export function defaultGraphFilterState(): GraphFilterState {
  return {
    view: "accountability",
    q: "",
    ownerDepartmentId: "",
    typeCode: "",
    collectionId: "",
    readerScope: "",
    validity: "",
    isolateMatching: false,
    includeLinks: false,
    relationshipTypes: [...documentRelationshipTypes],
    monitor: false,
    onlyOpenCases: false,
    onlyUnassignedOrg: false,
    includeExpired: false,
    focusDocumentId: null,
  };
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

/** Parses a `/graph` URL search string into validated filter state. */
export function parseGraphSearch(search: string): GraphFilterState {
  const base = defaultGraphFilterState();
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return base;
  const params = new URLSearchParams(trimmed);

  const view = params.get("view");
  if (isOneOf(graphViewModes, view)) base.view = view;

  const q = params.get("q");
  if (q) base.q = q.slice(0, 120);

  const ownerDepartmentId = params.get("ownerDepartmentId");
  if (ownerDepartmentId) base.ownerDepartmentId = ownerDepartmentId;

  const typeCode = params.get("typeCode");
  if (isOneOf(graphTypeCodes, typeCode)) base.typeCode = typeCode;

  const collectionId = params.get("collectionId");
  if (collectionId) base.collectionId = collectionId;

  const readerScope = params.get("readerScope");
  if (isOneOf(graphReaderScopes, readerScope)) base.readerScope = readerScope;

  const validity = params.get("validity");
  if (isOneOf(graphValidityFilters, validity)) base.validity = validity;

  if (params.get("isolate") === "true") base.isolateMatching = true;

  if (params.get("includeLinks") === "true") {
    base.includeLinks = true;
    const rawTypes = params.get("relationshipTypes");
    if (rawTypes) {
      const parsed = rawTypes
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is DocumentRelationshipType => isOneOf(documentRelationshipTypes, item));
      if (parsed.length > 0) base.relationshipTypes = parsed;
    }
  }

  if (params.get("monitor") === "true") base.monitor = true;
  if (params.get("onlyOpenCases") === "true") base.onlyOpenCases = true;
  if (params.get("onlyUnassignedOrg") === "true") base.onlyUnassignedOrg = true;
  if (params.get("includeExpired") === "true") base.includeExpired = true;

  const focusDocumentId = params.get("focusDocumentId");
  if (focusDocumentId) base.focusDocumentId = focusDocumentId;

  return base;
}

/** Serializes active non-default Graph filter state into a URL search string. */
export function serializeGraphSearch(state: GraphFilterState): string {
  const params = new URLSearchParams();
  if (state.view !== "accountability") params.set("view", state.view);
  if (state.q.trim()) params.set("q", state.q.trim().slice(0, 120));
  if (state.ownerDepartmentId) params.set("ownerDepartmentId", state.ownerDepartmentId);
  if (state.typeCode) params.set("typeCode", state.typeCode);
  if (state.collectionId) params.set("collectionId", state.collectionId);
  if (state.readerScope) params.set("readerScope", state.readerScope);
  if (state.validity) params.set("validity", state.validity);
  if (state.isolateMatching) params.set("isolate", "true");
  if (state.includeLinks) {
    params.set("includeLinks", "true");
    const isAll = documentRelationshipTypes.every((type) => state.relationshipTypes.includes(type));
    if (!isAll && state.relationshipTypes.length > 0) {
      params.set("relationshipTypes", state.relationshipTypes.join(","));
    }
  }
  if (state.monitor) {
    params.set("monitor", "true");
    if (state.onlyOpenCases) params.set("onlyOpenCases", "true");
    if (state.onlyUnassignedOrg) params.set("onlyUnassignedOrg", "true");
    if (state.includeExpired) params.set("includeExpired", "true");
  }
  if (state.focusDocumentId) params.set("focusDocumentId", state.focusDocumentId);

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/** Projects GraphFilterState onto client-side visual filters for GraphLayoutEngine. */
export function toClientFilters(state: GraphFilterState): GraphClientFilters {
  return {
    q: state.q,
    ownerDepartmentId: state.ownerDepartmentId || undefined,
    typeCode: state.typeCode || undefined,
    collectionId: state.collectionId || undefined,
    readerScope: state.readerScope || undefined,
    validity: state.validity || undefined,
    onlyOpenCases: state.monitor && state.onlyOpenCases,
    onlyUnassignedOrg: state.monitor && state.onlyUnassignedOrg,
    relationshipTypes: state.includeLinks ? state.relationshipTypes : [],
  };
}

/** Returns true when any interactive facet filter is currently active. */
export function hasActiveFacetFilters(state: GraphFilterState): boolean {
  return Boolean(
    state.q.trim()
    || state.ownerDepartmentId
    || state.typeCode
    || state.collectionId
    || state.readerScope
    || state.validity
    || (state.monitor && state.onlyOpenCases)
    || (state.monitor && state.onlyUnassignedOrg),
  );
}

/**
 * Builds the `GET /knowledge/graph` query according to two-tier filtering:
 * - When not truncated: requests the full authorized mode slice so client-side dimming works.
 * - When truncated (> 500 docs): forwards active facets so Core narrows server-side.
 */
export function toServerGraphQuery(state: GraphFilterState, serverNarrowing: boolean): KnowledgeGraphQuery {
  const query: KnowledgeGraphQuery = {
    view: state.view,
  };
  if (state.includeLinks) {
    query.includeLinks = true;
    const isAll = documentRelationshipTypes.every((type) => state.relationshipTypes.includes(type));
    if (!isAll && state.relationshipTypes.length > 0) {
      query.relationshipTypes = state.relationshipTypes.join(",");
    }
  }
  if (state.monitor) {
    query.monitor = true;
    if (state.includeExpired) query.includeExpired = true;
  }
  if (state.focusDocumentId) {
    query.focusDocumentId = state.focusDocumentId;
  }
  if (serverNarrowing) {
    if (state.q.trim()) query.q = state.q.trim().slice(0, 120);
    if (state.ownerDepartmentId) query.ownerDepartmentId = state.ownerDepartmentId;
    if (state.typeCode) query.typeCode = state.typeCode;
    if (state.collectionId) query.collectionId = state.collectionId;
    if (state.readerScope) query.readerScope = state.readerScope;
    if (state.validity) query.validity = state.validity;
    if (state.monitor && state.onlyOpenCases) query.onlyOpenCases = true;
    if (state.monitor && state.onlyUnassignedOrg) query.onlyUnassignedOrg = true;
  }
  return query;
}
