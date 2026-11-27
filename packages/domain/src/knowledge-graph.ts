import type { KnowledgeType, ValidityStatus } from "./knowledge-metadata.js";

/** Maximum authorized documents returned in a single Knowledge Graph payload. */
export const GRAPH_MAX_DOCUMENTS = 500;
/** Maximum dual-endpoint authorized relationships returned in a single Knowledge Graph payload. */
export const GRAPH_MAX_RELATIONSHIPS = 1_000;
/** Maximum documents a user may pin into the Ask Arden Context Basket at once. */
export const CONTEXT_BASKET_MAX_DOCUMENTS = 50;

export type DocumentId = string & { readonly __brand: "DocumentId" };
export type PublishedVersionId = string & { readonly __brand: "PublishedVersionId" };

export const graphViewModes = ["accountability", "collections"] as const;
export type GraphViewMode = typeof graphViewModes[number];

/** ASCII query codes avoid `&` URL-encoding ambiguity for `"Policy & Standard"`. */
export const graphTypeCodes = [
  "POLICY_AND_STANDARD",
  "PROCEDURE",
  "GUIDE",
  "REFERENCE",
  "LESSONS_LEARNED",
  "UNCATEGORIZED",
] as const;
export type GraphTypeCode = typeof graphTypeCodes[number];

export const graphReaderScopes = [
  "ORGANIZATION",
  "DEPARTMENT",
  "SELECTED_MEMBERS",
  "LEGACY_AUDIENCE",
] as const;
export type GraphReaderScope = typeof graphReaderScopes[number];

export const graphValidityFilters = ["CURRENT", "EXPIRING_SOON", "EXPIRED"] as const;
export type GraphValidityFilter = typeof graphValidityFilters[number];

export const documentRelationshipTypes = ["REFERENCES", "RELATED", "SUPERSEDES"] as const;
export type DocumentRelationshipType = typeof documentRelationshipTypes[number];

export const graphOpenTargets = [
  "READER",
  "RESPONSIBLE_VIEW",
  "ADMIN_INSPECTION",
  "MY_CONTRIBUTIONS",
] as const;
export type GraphOpenTarget = typeof graphOpenTargets[number];

export function knowledgeTypeToCode(type: KnowledgeType | null): GraphTypeCode {
  switch (type) {
    case "Policy & Standard":
      return "POLICY_AND_STANDARD";
    case "Procedure":
      return "PROCEDURE";
    case "Guide":
      return "GUIDE";
    case "Reference":
      return "REFERENCE";
    case "Lessons Learned":
      return "LESSONS_LEARNED";
    case null:
      return "UNCATEGORIZED";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function codeToKnowledgeType(code: GraphTypeCode): KnowledgeType | null {
  switch (code) {
    case "POLICY_AND_STANDARD":
      return "Policy & Standard";
    case "PROCEDURE":
      return "Procedure";
    case "GUIDE":
      return "Guide";
    case "REFERENCE":
      return "Reference";
    case "LESSONS_LEARNED":
      return "Lessons Learned";
    case "UNCATEGORIZED":
      return null;
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

export interface AnswerScopeFilter {
  documentIds: readonly string[];
}

export interface KnowledgeGraphQuery {
  view?: GraphViewMode;
  q?: string;
  ownerDepartmentId?: string;
  typeCode?: GraphTypeCode;
  collectionId?: string;
  readerScope?: GraphReaderScope;
  validity?: GraphValidityFilter;
  includeLinks?: boolean;
  relationshipTypes?: string;
  monitor?: boolean;
  onlyOpenCases?: boolean;
  onlyUnassignedOrg?: boolean;
  includeExpired?: boolean;
  focusDocumentId?: string;
  limit?: number;
}

export interface GraphDocumentNode {
  documentId: DocumentId;
  publishedVersionId: PublishedVersionId;
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
  collectionId: string | null;
  openTarget: GraphOpenTarget;
  canEditRelationships: boolean;
  canRenew: boolean;
  monitorSignals: {
    openMaintenanceCaseCount: number | null;
    isUnassignedOrgDoc: boolean;
    requiresAuditedInspection: boolean;
  } | null;
}

export interface GraphRelationshipEdge {
  relationshipId: string;
  sourceDocumentId: DocumentId;
  targetDocumentId: DocumentId;
  relationshipType: DocumentRelationshipType;
  createdAt: string;
}

export interface KnowledgeGraphPayload {
  schemaVersion: 1;
  organization: { id: string; name: string };
  capabilities: {
    canUseMonitorMode: boolean;
    canIncludeExpired: boolean;
    canManageRelationships: boolean;
  };
  appliedMode: {
    view: GraphViewMode;
    monitorActive: boolean;
    includeExpiredActive: boolean;
    includeLinksActive: boolean;
  };
  truncation: {
    limit: number;
    returnedCount: number;
    truncated: boolean;
    relationshipsLimit: typeof GRAPH_MAX_RELATIONSHIPS;
    relationshipsTruncated: boolean;
  };
  departments: Array<{ id: string; name: string }>;
  collections: Array<{
    id: string;
    name: string;
    allowedTypes: KnowledgeType[] | null;
  }>;
  documents: GraphDocumentNode[];
  relationships: GraphRelationshipEdge[];
}
