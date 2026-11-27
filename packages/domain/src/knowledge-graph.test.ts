import { describe, expect, it } from "vitest";
import { knowledgeTypes, type KnowledgeType } from "./knowledge-metadata.js";
import {
  CONTEXT_BASKET_MAX_DOCUMENTS,
  GRAPH_MAX_DOCUMENTS,
  GRAPH_MAX_RELATIONSHIPS,
  codeToKnowledgeType,
  documentRelationshipTypes,
  graphOpenTargets,
  graphReaderScopes,
  graphTypeCodes,
  graphValidityFilters,
  graphViewModes,
  knowledgeTypeToCode,
  type DocumentId,
  type GraphDocumentNode,
  type GraphRelationshipEdge,
  type GraphTypeCode,
  type KnowledgeGraphPayload,
  type KnowledgeGraphQuery,
  type PublishedVersionId,
} from "./knowledge-graph.js";

describe("knowledge-graph domain contracts", () => {
  it("exports exact bounded graph and context-basket limits", () => {
    expect(GRAPH_MAX_DOCUMENTS).toBe(500);
    expect(GRAPH_MAX_RELATIONSHIPS).toBe(1_000);
    expect(CONTEXT_BASKET_MAX_DOCUMENTS).toBe(50);
  });

  it("maps every KnowledgeType and null to pure ASCII GraphTypeCode values", () => {
    expect(knowledgeTypeToCode("Policy & Standard")).toBe("POLICY_AND_STANDARD");
    expect(knowledgeTypeToCode("Procedure")).toBe("PROCEDURE");
    expect(knowledgeTypeToCode("Guide")).toBe("GUIDE");
    expect(knowledgeTypeToCode("Reference")).toBe("REFERENCE");
    expect(knowledgeTypeToCode("Lessons Learned")).toBe("LESSONS_LEARNED");
    expect(knowledgeTypeToCode(null)).toBe("UNCATEGORIZED");

    for (const code of graphTypeCodes) {
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("maps every GraphTypeCode back to its exact KnowledgeType or null bi-directionally", () => {
    const allInputs: Array<KnowledgeType | null> = [...knowledgeTypes, null];
    expect(graphTypeCodes).toHaveLength(allInputs.length);

    for (const type of allInputs) {
      const code = knowledgeTypeToCode(type);
      expect(codeToKnowledgeType(code)).toBe(type);
    }

    for (const code of graphTypeCodes) {
      const type = codeToKnowledgeType(code);
      expect(knowledgeTypeToCode(type)).toBe(code);
    }
  });

  it("exports canonical enum allowlists matching SPEC-knowledge-graph", () => {
    expect(graphViewModes).toEqual(["accountability", "collections"]);
    expect(graphTypeCodes).toEqual([
      "POLICY_AND_STANDARD",
      "PROCEDURE",
      "GUIDE",
      "REFERENCE",
      "LESSONS_LEARNED",
      "UNCATEGORIZED",
    ]);
    expect(graphReaderScopes).toEqual([
      "ORGANIZATION",
      "DEPARTMENT",
      "SELECTED_MEMBERS",
      "LEGACY_AUDIENCE",
    ]);
    expect(graphValidityFilters).toEqual(["CURRENT", "EXPIRING_SOON", "EXPIRED"]);
    expect(documentRelationshipTypes).toEqual(["REFERENCES", "RELATED", "SUPERSEDES"]);
    expect(graphOpenTargets).toEqual([
      "READER",
      "RESPONSIBLE_VIEW",
      "ADMIN_INSPECTION",
      "MY_CONTRIBUTIONS",
    ]);
  });

  it("models query, legacy-nullable nodes, monitor signals, and edges cleanly", () => {
    const docA = "00000000-0000-0000-0000-000000000001" as DocumentId;
    const docB = "00000000-0000-0000-0000-000000000002" as DocumentId;
    const verA = "10000000-0000-0000-0000-000000000001" as PublishedVersionId;
    const verB = "10000000-0000-0000-0000-000000000002" as PublishedVersionId;

    const query: KnowledgeGraphQuery = {
      view: "accountability",
      typeCode: "POLICY_AND_STANDARD",
      readerScope: "ORGANIZATION",
      validity: "CURRENT",
      includeLinks: true,
      relationshipTypes: "REFERENCES,SUPERSEDES",
      monitor: true,
      onlyOpenCases: false,
      onlyUnassignedOrg: false,
      includeExpired: false,
      focusDocumentId: docA,
      limit: GRAPH_MAX_DOCUMENTS,
    };

    const legacyNode: GraphDocumentNode = {
      documentId: docA,
      publishedVersionId: verA,
      title: "Legacy Security Handbook",
      type: null,
      version: "Version unavailable",
      ownerDepartmentId: "20000000-0000-0000-0000-000000000001",
      ownerDepartmentName: "Engineering",
      authorDisplayName: null,
      publishedAt: "2026-10-01T00:00:00Z",
      validUntil: null,
      validityStatus: "Current",
      daysUntilExpiry: null,
      readerScope: "LEGACY_AUDIENCE",
      collectionId: null,
      openTarget: "READER",
      canEditRelationships: false,
      canRenew: false,
      monitorSignals: null,
    };

    const monitoredNode: GraphDocumentNode = {
      documentId: docB,
      publishedVersionId: verB,
      title: "Incident Response Procedure",
      type: codeToKnowledgeType("PROCEDURE" satisfies GraphTypeCode),
      version: "2.0",
      ownerDepartmentId: "20000000-0000-0000-0000-000000000001",
      ownerDepartmentName: "Engineering",
      authorDisplayName: "Linh Tran",
      publishedAt: "2026-11-01T00:00:00Z",
      validUntil: "2026-12-10",
      validityStatus: "Expiring soon",
      daysUntilExpiry: 14,
      readerScope: "ORGANIZATION",
      collectionId: null,
      openTarget: "ADMIN_INSPECTION",
      canEditRelationships: true,
      canRenew: true,
      monitorSignals: {
        openMaintenanceCaseCount: null,
        isUnassignedOrgDoc: true,
        requiresAuditedInspection: true,
      },
    };

    const edge: GraphRelationshipEdge = {
      relationshipId: "30000000-0000-0000-0000-000000000001",
      sourceDocumentId: docB,
      targetDocumentId: docA,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-05T00:00:00Z",
    };

    const payload: KnowledgeGraphPayload = {
      schemaVersion: 1,
      organization: { id: "40000000-0000-0000-0000-000000000001", name: "NorthStar" },
      capabilities: {
        canUseMonitorMode: true,
        canIncludeExpired: true,
        canManageRelationships: true,
      },
      appliedMode: {
        view: query.view ?? "accountability",
        monitorActive: true,
        includeExpiredActive: false,
        includeLinksActive: true,
      },
      truncation: {
        limit: GRAPH_MAX_DOCUMENTS,
        returnedCount: 2,
        truncated: false,
        relationshipsLimit: GRAPH_MAX_RELATIONSHIPS,
        relationshipsTruncated: false,
      },
      departments: [{ id: "20000000-0000-0000-0000-000000000001", name: "Engineering" }],
      collections: [
        {
          id: "50000000-0000-0000-0000-000000000001",
          name: "Core Standards",
          allowedTypes: null,
        },
      ],
      documents: [legacyNode, monitoredNode],
      relationships: [edge],
    };

    expect(payload.schemaVersion).toBe(1);
    expect(payload.documents[0]?.type).toBeNull();
    expect(payload.documents[1]?.monitorSignals?.openMaintenanceCaseCount).toBeNull();
    expect(payload.relationships).toHaveLength(1);
  });
});
