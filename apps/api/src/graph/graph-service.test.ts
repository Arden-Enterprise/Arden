import Fastify, { type FastifyError } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  GRAPH_MAX_DOCUMENTS,
  GRAPH_MAX_RELATIONSHIPS,
  type DocumentId,
  type DocumentRelationshipType,
  type KnowledgeGraphPayload,
} from "@arden/domain";
import {
  GraphProjectionService,
  type GraphMonitorHandler,
  type GraphRawDocument,
  type GraphRawRelationship,
  type GraphSnapshot,
  type GraphStore,
} from "./graph-service.js";
import { registerGraphRoutes } from "./graph-routes.js";
import { buildApp } from "../app.js";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const otherMembershipId = "33333333-3333-4333-8333-333333333333";
const salesDeptId = "44444444-4444-4444-8444-444444444444";
const engDeptId = "55555555-5555-4555-8555-555555555555";
const legalDeptId = "66666666-6666-4666-8666-666666666666";
const colHandbookId = "77777777-7777-4777-8777-777777777777";
const colExpiredOnlyId = "88888888-8888-4888-8888-888888888888";
const colLegacyId = "99999999-9999-4999-8999-999999999999";

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const makeUuid = (prefix: string, index: number) =>
  `${prefix}-${prefix.slice(0, 4)}-4${prefix.slice(0, 3)}-8${prefix.slice(0, 3)}-${String(index).padStart(12, "0")}`;

function makeDoc(overrides: Partial<GraphRawDocument> = {}): GraphRawDocument {
  const index = 1;
  return {
    documentId: makeUuid("dddddddd", index),
    publishedVersionId: makeUuid("eeeeeeee", index),
    title: "MFA Policy",
    management: {
      type: "Policy & Standard",
      version: "2.0",
      expirationDate: "2026-12-31",
      changeNote: "Annual update",
    },
    ownerDepartmentId: salesDeptId,
    ownerDepartmentName: "Sales",
    authorDisplayName: "Alice Author",
    publishedAt: new Date("2026-11-20T10:00:00.000Z"),
    validUntil: "2026-12-31",
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    knowledgeBaseScopeType: "ORGANIZATION",
    collection: {
      id: colHandbookId,
      name: "Company Handbook",
      allowedTypes: ["Policy & Standard", "Guide"],
      status: "ACTIVE",
    },
    isAuthor: false,
    canRenew: false,
    ...overrides,
  };
}

class FakeGraphStore implements GraphStore {
  snapshot: GraphSnapshot | null = {
    organization: { id: orgId, name: "Acme Corp" },
    actor: {
      membershipId,
      organizationId: orgId,
      status: "ACTIVE",
      departmentIds: [salesDeptId],
      isOrgAdmin: false,
      hasAuthoredPublishedDoc: false,
    },
    utcToday: "2026-11-26",
    documents: [],
  };
  relationships: GraphRawRelationship[] = [];
  loadMonitorProjection?: GraphStore["loadMonitorProjection"];
  listRelationshipsCalls: Array<{
    userId: string;
    organizationId: string;
    documentIds: readonly string[];
    relationshipTypes: readonly DocumentRelationshipType[] | null;
    limitPlusOne: number;
  }> = [];

  async loadReadableSnapshot(_userId: string, organizationId: string): Promise<GraphSnapshot | null> {
    if (!this.snapshot || this.snapshot.organization.id !== organizationId) return null;
    return this.snapshot;
  }

  async listRelationships(
    actorUserId: string,
    organizationId: string,
    documentIds: readonly string[],
    relationshipTypes: readonly DocumentRelationshipType[] | null,
    limitPlusOne: number,
  ): Promise<GraphRawRelationship[]> {
    this.listRelationshipsCalls.push({
      userId: actorUserId,
      organizationId,
      documentIds: [...documentIds],
      relationshipTypes: relationshipTypes ? [...relationshipTypes] : null,
      limitPlusOne,
    });
    const allowedDocs = new Set(documentIds);
    const allowedTypes = relationshipTypes ? new Set(relationshipTypes) : null;
    return this.relationships
      .filter((edge) => allowedDocs.has(edge.sourceDocumentId) && allowedDocs.has(edge.targetDocumentId))
      .filter((edge) => !allowedTypes || allowedTypes.has(edge.relationshipType))
      .slice(0, limitPlusOne);
  }
}

describe("GraphProjectionService", () => {
  it("returns null when the actor has no active membership in the organization", async () => {
    const store = new FakeGraphStore();
    store.snapshot = null;
    const service = new GraphProjectionService(store);
    await expect(service.getGraph(userId, orgId, {})).resolves.toBeNull();
  });

  it("projects readable unexpired documents in deterministic publishedAt DESC, documentId ASC order", async () => {
    const store = new FakeGraphStore();
    const docEarlier = makeDoc({
      documentId: makeUuid("10000000", 1),
      publishedVersionId: makeUuid("20000000", 1),
      title: "Older Doc",
      publishedAt: new Date("2026-11-10T10:00:00.000Z"),
    });
    const docTieB = makeDoc({
      documentId: "dddddddd-dddd-4ddd-8ddd-00000000000b",
      publishedVersionId: makeUuid("20000000", 2),
      title: "Tie B",
      publishedAt: new Date("2026-11-20T10:00:00.000Z"),
    });
    const docTieA = makeDoc({
      documentId: "dddddddd-dddd-4ddd-8ddd-00000000000a",
      publishedVersionId: makeUuid("20000000", 3),
      title: "Tie A",
      publishedAt: new Date("2026-11-20T10:00:00.000Z"),
    });
    const docTodayExpiry = makeDoc({
      documentId: makeUuid("10000000", 4),
      publishedVersionId: makeUuid("20000000", 4),
      title: "Expires Today (Still Readable)",
      publishedAt: new Date("2026-11-25T10:00:00.000Z"),
      validUntil: "2026-11-26",
      authorDisplayName: null,
    });
    const docExpired = makeDoc({
      documentId: makeUuid("10000000", 5),
      publishedVersionId: makeUuid("20000000", 5),
      title: "Expired Yesterday",
      publishedAt: new Date("2026-11-25T11:00:00.000Z"),
      validUntil: "2026-11-25",
      ownerDepartmentId: legalDeptId,
      ownerDepartmentName: "Legal",
      collection: {
        id: colExpiredOnlyId,
        name: "Expired Only Collection",
        allowedTypes: ["Policy & Standard"],
        status: "ACTIVE",
      },
    });
    const docUnreadableSelected = makeDoc({
      documentId: makeUuid("10000000", 6),
      publishedVersionId: makeUuid("20000000", 6),
      title: "Restricted Selected Members",
      publishedAt: new Date("2026-11-25T12:00:00.000Z"),
      ownerDepartmentId: engDeptId,
      ownerDepartmentName: "Engineering",
      targetReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [otherMembershipId] },
    });
    const docUnreadableDepartment = makeDoc({
      documentId: makeUuid("10000000", 7),
      publishedVersionId: makeUuid("20000000", 7),
      title: "Engineering Only",
      publishedAt: new Date("2026-11-25T13:00:00.000Z"),
      ownerDepartmentId: engDeptId,
      ownerDepartmentName: "Engineering",
      targetReaders: { mode: "DEPARTMENT", departmentId: engDeptId, memberIds: [] },
    });

    store.snapshot!.documents = [
      docEarlier,
      docTieB,
      docTieA,
      docTodayExpiry,
      docExpired,
      docUnreadableSelected,
      docUnreadableDepartment,
    ];

    const service = new GraphProjectionService(store);
    const payload = await service.getGraph(userId, orgId, {});
    expect(payload).not.toBeNull();
    expect(payload!.schemaVersion).toBe(1);
    expect(payload!.organization).toEqual({ id: orgId, name: "Acme Corp" });
    expect(payload!.appliedMode).toEqual({
      view: "accountability",
      monitorActive: false,
      includeExpiredActive: false,
      includeLinksActive: false,
    });
    expect(payload!.documents.map((doc) => doc.documentId)).toEqual([
      docTodayExpiry.documentId,
      docTieA.documentId,
      docTieB.documentId,
      docEarlier.documentId,
    ]);
    expect(payload!.documents[0]).toMatchObject({
      title: "Expires Today (Still Readable)",
      authorDisplayName: null,
      validUntil: "2026-11-26",
      validityStatus: "Expiring soon",
      daysUntilExpiry: 0,
      openTarget: "READER",
      monitorSignals: null,
    });
    // Anti-leak ADR 0032 A2: Legal (expired-only) and Engineering (unreadable) are excluded;
    // Expired Only Collection is excluded.
    expect(payload!.departments).toEqual([{ id: salesDeptId, name: "Sales" }]);
    expect(payload!.collections).toEqual([
      { id: colHandbookId, name: "Company Handbook", allowedTypes: ["Policy & Standard", "Guide"] },
    ]);
    expect(payload!.truncation).toEqual({
      limit: GRAPH_MAX_DOCUMENTS,
      returnedCount: 4,
      truncated: false,
      relationshipsLimit: GRAPH_MAX_RELATIONSHIPS,
      relationshipsTruncated: false,
    });
    expect(payload!.relationships).toEqual([]);
    expect(store.listRelationshipsCalls).toHaveLength(0);
  });

  it("preserves legacy nullables, maps readerScope without leaking identities, and clears collectionId for non-org docs", async () => {
    const store = new FakeGraphStore();
    const docLegacyUnconfigured = makeDoc({
      documentId: makeUuid("10000000", 1),
      publishedVersionId: makeUuid("20000000", 1),
      title: "Legacy Policy",
      management: null,
      validUntil: null,
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      knowledgeBaseScopeType: "ORGANIZATION",
      collection: {
        id: colLegacyId,
        name: "Legacy Folder",
        allowedTypes: null,
        status: "ACTIVE",
      },
    });
    const docSelected = makeDoc({
      documentId: makeUuid("10000000", 2),
      publishedVersionId: makeUuid("20000000", 2),
      title: "Selected Doc",
      management: { type: null, version: "   ", expirationDate: null, changeNote: "" },
      validUntil: null,
      targetReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [membershipId, otherMembershipId] },
      knowledgeBaseScopeType: "DEPARTMENT",
      collection: {
        id: colHandbookId,
        name: "Should Not Attach",
        allowedTypes: ["Guide"],
        status: "ACTIVE",
      },
    });
    const docLegacyFallback = makeDoc({
      documentId: makeUuid("10000000", 3),
      publishedVersionId: makeUuid("20000000", 3),
      title: "Legacy Audience Doc",
      targetReaders: null,
      knowledgeBaseScopeType: null,
      collection: null,
    });
    const docInactiveCollection = makeDoc({
      documentId: makeUuid("10000000", 4),
      publishedVersionId: makeUuid("20000000", 4),
      title: "Inactive Folder Doc",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      collection: {
        id: makeUuid("77777777", 99),
        name: "Archived Folder",
        allowedTypes: ["Guide"],
        status: "INACTIVE",
      },
    });

    store.snapshot!.documents = [
      docLegacyUnconfigured,
      docSelected,
      docLegacyFallback,
      docInactiveCollection,
    ];

    const service = new GraphProjectionService(store);
    const payload = await service.getGraph(userId, orgId, { view: "collections" });

    expect(payload!.appliedMode.view).toBe("collections");
    const byId = new Map(payload!.documents.map((doc) => [doc.documentId, doc]));
    expect(byId.get(docLegacyUnconfigured.documentId as DocumentId)).toMatchObject({
      type: null,
      version: "Version unavailable",
      readerScope: "ORGANIZATION",
      collectionId: colLegacyId,
      validityStatus: "Current",
      daysUntilExpiry: null,
    });
    expect(byId.get(docSelected.documentId as DocumentId)).toMatchObject({
      type: null,
      version: "Version unavailable",
      readerScope: "SELECTED_MEMBERS",
      collectionId: null,
    });
    expect(byId.has(docLegacyFallback.documentId as DocumentId)).toBe(false);
    expect(byId.get(docInactiveCollection.documentId as DocumentId)).toMatchObject({
      readerScope: "ORGANIZATION",
      collectionId: null,
    });
    expect(payload!.collections).toEqual([
      { id: colLegacyId, name: "Legacy Folder", allowedTypes: null },
    ]);
    expect(JSON.stringify(payload)).not.toContain(otherMembershipId);
  });

  it("filters accurately by ASCII typeCode, collectionId (UUID and UNASSIGNED), ownerDepartmentId, readerScope, validity, and q", async () => {
    const store = new FakeGraphStore();
    store.snapshot!.actor.departmentIds = [salesDeptId, engDeptId];

    const docPolicy = makeDoc({
      documentId: makeUuid("10000000", 1),
      title: "Security & Access Policy",
      management: { type: "Policy & Standard", version: "1.0", expirationDate: "2027-06-01", changeNote: "" },
      validUntil: "2027-06-01",
      ownerDepartmentId: salesDeptId,
      ownerDepartmentName: "Sales",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      collection: { id: colHandbookId, name: "Handbook", allowedTypes: ["Policy & Standard"], status: "ACTIVE" },
    });
    const docUncatUnassigned = makeDoc({
      documentId: makeUuid("10000000", 2),
      title: "Legacy Runbook",
      management: null,
      validUntil: "2026-12-10", // 14 days from 2026-11-26 => Expiring soon
      ownerDepartmentId: engDeptId,
      ownerDepartmentName: "Engineering",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      collection: null,
    });
    const docDeptGuide = makeDoc({
      documentId: makeUuid("10000000", 3),
      title: "Engineering Onboarding Guide",
      management: { type: "Guide", version: "3.1", expirationDate: "2026-12-27", changeNote: "" },
      validUntil: "2026-12-27", // 31 days from 2026-11-26 => Current
      ownerDepartmentId: engDeptId,
      ownerDepartmentName: "Engineering",
      targetReaders: { mode: "DEPARTMENT", departmentId: engDeptId, memberIds: [] },
      collection: null,
    });
    store.snapshot!.documents = [docPolicy, docUncatUnassigned, docDeptGuide];

    const service = new GraphProjectionService(store);

    const byPolicy = await service.getGraph(userId, orgId, { typeCode: "POLICY_AND_STANDARD" });
    expect(byPolicy!.documents.map((d) => d.documentId)).toEqual([docPolicy.documentId]);

    const byUncat = await service.getGraph(userId, orgId, { typeCode: "UNCATEGORIZED" });
    expect(byUncat!.documents.map((d) => d.documentId)).toEqual([docUncatUnassigned.documentId]);

    const byUnassigned = await service.getGraph(userId, orgId, { collectionId: "UNASSIGNED" });
    expect(byUnassigned!.documents.map((d) => d.documentId)).toEqual([docUncatUnassigned.documentId]);

    const byCollection = await service.getGraph(userId, orgId, { collectionId: colHandbookId });
    expect(byCollection!.documents.map((d) => d.documentId)).toEqual([docPolicy.documentId]);

    const byDept = await service.getGraph(userId, orgId, { ownerDepartmentId: engDeptId });
    expect(byDept!.documents.map((d) => d.documentId)).toEqual([docUncatUnassigned.documentId, docDeptGuide.documentId]);

    const byScope = await service.getGraph(userId, orgId, { readerScope: "DEPARTMENT" });
    expect(byScope!.documents.map((d) => d.documentId)).toEqual([docDeptGuide.documentId]);

    const byExpiring = await service.getGraph(userId, orgId, { validity: "EXPIRING_SOON" });
    expect(byExpiring!.documents.map((d) => d.documentId)).toEqual([docUncatUnassigned.documentId]);
    expect(byExpiring!.documents[0]!.daysUntilExpiry).toBe(14);

    const byCurrent = await service.getGraph(userId, orgId, { validity: "CURRENT" });
    expect(byCurrent!.documents.map((d) => d.documentId)).toEqual([docPolicy.documentId, docDeptGuide.documentId]);
    expect(byCurrent!.documents.find((d) => d.documentId === docDeptGuide.documentId)?.daysUntilExpiry).toBe(31);

    const bySearch = await service.getGraph(userId, orgId, { q: "onboarding" });
    expect(bySearch!.documents.map((d) => d.documentId)).toEqual([docDeptGuide.documentId]);
  });

  it("enforces limit truncation and guarantees authorized focusDocumentId inclusion beyond cap without leaking unauthorized targets", async () => {
    const store = new FakeGraphStore();
    const docs: GraphRawDocument[] = Array.from({ length: 505 }, (_, i) =>
      makeDoc({
        documentId: makeUuid("10000000", i + 1),
        publishedVersionId: makeUuid("20000000", i + 1),
        title: `Doc ${i + 1}`,
        publishedAt: new Date(Date.UTC(2026, 10, 26, 0, 0, 0) - i * 60_000),
      }),
    );
    const hiddenDoc = makeDoc({
      documentId: makeUuid("90000000", 1),
      publishedVersionId: makeUuid("90000000", 2),
      title: "Hidden Restricted Doc",
      targetReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [otherMembershipId] },
    });
    store.snapshot!.documents = [...docs, hiddenDoc];

    const service = new GraphProjectionService(store);
    const tailDocId = docs[504]!.documentId;

    const defaultTruncated = await service.getGraph(userId, orgId, {});
    expect(defaultTruncated!.truncation.limit).toBe(500);
    expect(defaultTruncated!.truncation.returnedCount).toBe(500);
    expect(defaultTruncated!.truncation.truncated).toBe(true);
    expect(defaultTruncated!.documents.some((d) => d.documentId === tailDocId)).toBe(false);

    const withFocus = await service.getGraph(userId, orgId, { focusDocumentId: tailDocId });
    expect(withFocus!.documents).toHaveLength(500);
    expect(withFocus!.truncation.returnedCount).toBe(500);
    expect(withFocus!.truncation.truncated).toBe(true);
    expect(withFocus!.documents.some((d) => d.documentId === tailDocId)).toBe(true);
    expect(withFocus!.documents[499]!.documentId).toBe(tailDocId);

    const withSmallLimit = await service.getGraph(userId, orgId, { limit: 3, focusDocumentId: tailDocId });
    expect(withSmallLimit!.documents).toHaveLength(3);
    expect(withSmallLimit!.truncation.limit).toBe(3);
    expect(withSmallLimit!.truncation.returnedCount).toBe(3);
    expect(withSmallLimit!.truncation.truncated).toBe(true);
    expect(withSmallLimit!.documents.map((d) => d.documentId)).toEqual([
      docs[0]!.documentId,
      docs[1]!.documentId,
      tailDocId,
    ]);

    const withUnauthorizedFocus = await service.getGraph(userId, orgId, { limit: 3, focusDocumentId: hiddenDoc.documentId });
    expect(withUnauthorizedFocus!.documents).toHaveLength(3);
    expect(withUnauthorizedFocus!.documents.some((d) => d.documentId === hiddenDoc.documentId)).toBe(false);
  });

  it("derives capabilities, keeps pre-T-07 monitor/expired requests fail-closed, and supports the T-07 monitor seam", async () => {
    const store = new FakeGraphStore();
    const ownDoc = makeDoc({
      documentId: makeUuid("10000000", 1),
      isAuthor: true,
      canRenew: true,
    });
    const otherDoc = makeDoc({
      documentId: makeUuid("10000000", 2),
      isAuthor: false,
      canRenew: false,
    });
    const expiredDoc = makeDoc({
      documentId: makeUuid("10000000", 3),
      validUntil: "2026-11-01",
      isAuthor: true,
      canRenew: true,
    });
    store.snapshot!.actor.hasAuthoredPublishedDoc = true;
    store.snapshot!.documents = [ownDoc, otherDoc, expiredDoc];

    const service = new GraphProjectionService(store);
    const ordinary = await service.getGraph(userId, orgId, {
      monitor: true,
      includeExpired: true,
      validity: "EXPIRED",
      onlyOpenCases: true,
      onlyUnassignedOrg: true,
    });
    expect(ordinary!.capabilities).toEqual({
      canUseMonitorMode: false,
      canIncludeExpired: false,
      canManageRelationships: true,
    });
    expect(ordinary!.appliedMode).toEqual({
      view: "accountability",
      monitorActive: false,
      includeExpiredActive: false,
      includeLinksActive: false,
    });
    expect(ordinary!.documents).toEqual([]);

    const normalAuthor = await service.getGraph(userId, orgId, {});
    expect(normalAuthor!.documents.map((d) => ({
      id: d.documentId,
      canEditRelationships: d.canEditRelationships,
      canRenew: d.canRenew,
    }))).toEqual([
      { id: ownDoc.documentId, canEditRelationships: true, canRenew: true },
      { id: otherDoc.documentId, canEditRelationships: false, canRenew: false },
    ]);

    // Verify Org Admin gets canEditRelationships=true on all readable docs.
    store.snapshot!.actor.isOrgAdmin = true;
    store.snapshot!.actor.hasAuthoredPublishedDoc = false;
    const adminPayload = await service.getGraph(userId, orgId, {});
    expect(adminPayload!.capabilities.canManageRelationships).toBe(true);
    expect(adminPayload!.documents.every((d) => d.canEditRelationships)).toBe(true);

    // Verify T-07 Monitor Mode seam plugs cleanly into GraphProjectionService.
    const monitorHandler: GraphMonitorHandler = async () => ({
      canUseMonitorMode: true,
      canIncludeExpired: true,
      monitorActive: true,
      includeExpiredActive: true,
      documents: [
        {
          raw: expiredDoc,
          isCurrentlyReadable: false,
          openTarget: "MY_CONTRIBUTIONS",
          monitorSignals: {
            openMaintenanceCaseCount: null,
            isUnassignedOrgDoc: false,
            requiresAuditedInspection: false,
          },
        },
      ],
    });
    const monitorService = new GraphProjectionService(store, { monitorHandler });
    const monitorResult = await monitorService.getGraph(userId, orgId, {
      monitor: true,
      includeExpired: true,
      validity: "EXPIRED",
    });
    expect(monitorResult!.capabilities.canUseMonitorMode).toBe(true);
    expect(monitorResult!.appliedMode.monitorActive).toBe(true);
    expect(monitorResult!.appliedMode.includeExpiredActive).toBe(true);
    expect(monitorResult!.documents).toHaveLength(1);
    expect(monitorResult!.documents[0]).toMatchObject({
      documentId: expiredDoc.documentId,
      validityStatus: "Expired",
      daysUntilExpiry: 0,
      openTarget: "MY_CONTRIBUTIONS",
      canEditRelationships: false,
      monitorSignals: {
        openMaintenanceCaseCount: null,
        isUnassignedOrgDoc: false,
        requiresAuditedInspection: false,
      },
    });
  });

  it("returns dual-endpoint authorized relationships only when includeLinks=true and enforces the 1,000-edge cap", async () => {
    const store = new FakeGraphStore();
    const docA = makeDoc({ documentId: makeUuid("10000000", 1), publishedVersionId: makeUuid("20000000", 1) });
    const docB = makeDoc({ documentId: makeUuid("10000000", 2), publishedVersionId: makeUuid("20000000", 2) });
    const docUnreadable = makeDoc({
      documentId: makeUuid("10000000", 3),
      publishedVersionId: makeUuid("20000000", 3),
      targetReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [otherMembershipId] },
    });
    store.snapshot!.documents = [docA, docB, docUnreadable];

    const manyEdges: GraphRawRelationship[] = Array.from({ length: 1002 }, (_, i) => ({
      relationshipId: makeUuid("30000000", i + 1),
      sourceDocumentId: docA.documentId,
      targetDocumentId: docB.documentId,
      relationshipType: i === 0 ? "SUPERSEDES" : "REFERENCES",
      createdAt: new Date(Date.UTC(2026, 10, 26, 0, 0, 0) - i * 1000),
    }));
    const leakedEdge: GraphRawRelationship = {
      relationshipId: makeUuid("30000000", 9999),
      sourceDocumentId: docA.documentId,
      targetDocumentId: docUnreadable.documentId,
      relationshipType: "RELATED",
      createdAt: new Date("2026-11-26T00:00:00.000Z"),
    };
    store.relationships = [leakedEdge, ...manyEdges];

    const service = new GraphProjectionService(store);

    const truncatedLinks = await service.getGraph(userId, orgId, { includeLinks: true });
    expect(truncatedLinks!.appliedMode.includeLinksActive).toBe(true);
    expect(truncatedLinks!.relationships).toHaveLength(GRAPH_MAX_RELATIONSHIPS);
    expect(truncatedLinks!.truncation.relationshipsLimit).toBe(GRAPH_MAX_RELATIONSHIPS);
    expect(truncatedLinks!.truncation.relationshipsTruncated).toBe(true);
    expect(truncatedLinks!.relationships.some((e) => e.relationshipId === leakedEdge.relationshipId)).toBe(false);
    expect(store.listRelationshipsCalls[0]!.limitPlusOne).toBe(GRAPH_MAX_RELATIONSHIPS + 1);

    const filteredLinks = await service.getGraph(userId, orgId, {
      includeLinks: true,
      relationshipTypes: "SUPERSEDES,RELATED",
    });
    expect(filteredLinks!.relationships).toHaveLength(1);
    expect(filteredLinks!.relationships[0]!.relationshipType).toBe("SUPERSEDES");
    expect(filteredLinks!.truncation.relationshipsTruncated).toBe(false);
  });
});

describe("registerGraphRoutes", () => {
  function buildTestApp(service: GraphProjectionService | undefined, authenticated = true) {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error.validation) {
        return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "The request is invalid.", requestId: request.id } });
      }
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId: request.id } });
    });
    registerGraphRoutes(app, {
      service,
      uuidPattern,
      requestActor: async (_request, reply) => {
        if (!authenticated) {
          reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } });
          return null;
        }
        return { userId };
      },
    });
    return app;
  }

  it("returns 401 when unauthenticated, 503 when service is unavailable, and 404 for non-members with Cache-Control: no-store", async () => {
    const unauthApp = buildTestApp(new GraphProjectionService(new FakeGraphStore()), false);
    const unauth = await unauthApp.inject({ method: "GET", url: `/api/v1/organizations/${orgId}/knowledge/graph` });
    expect(unauth.statusCode).toBe(401);
    await unauthApp.close();

    const unavailableApp = buildTestApp(undefined, true);
    const unavailable = await unavailableApp.inject({ method: "GET", url: `/api/v1/organizations/${orgId}/knowledge/graph` });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    await unavailableApp.close();

    const store = new FakeGraphStore();
    store.snapshot = null;
    const memberApp = buildTestApp(new GraphProjectionService(store), true);
    const notFound = await memberApp.inject({ method: "GET", url: `/api/v1/organizations/${otherOrgId}/knowledge/graph` });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.headers["cache-control"]).toBe("no-store");
    expect(notFound.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");
    await memberApp.close();
  });

  it("accepts all 15 valid query parameters, sets Cache-Control: no-store, and rejects malformed/unknown/duplicate parameters with 400", async () => {
    const store = new FakeGraphStore();
    store.snapshot!.documents = [makeDoc()];
    const service = new GraphProjectionService(store);
    const spy = vi.spyOn(service, "getGraph");
    const app = buildTestApp(service, true);

    const validUrl = `/api/v1/organizations/${orgId}/knowledge/graph?view=collections&q=MFA&ownerDepartmentId=${salesDeptId}&typeCode=POLICY_AND_STANDARD&collectionId=UNASSIGNED&readerScope=ORGANIZATION&validity=CURRENT&includeLinks=true&relationshipTypes=REFERENCES,SUPERSEDES&monitor=false&onlyOpenCases=false&onlyUnassignedOrg=false&includeExpired=false&focusDocumentId=${makeUuid("dddddddd", 1)}&limit=25`;
    const ok = await app.inject({ method: "GET", url: validUrl });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect((ok.json() as KnowledgeGraphPayload).schemaVersion).toBe(1);
    expect(spy).toHaveBeenCalledWith(userId, orgId, expect.objectContaining({
      view: "collections",
      q: "MFA",
      ownerDepartmentId: salesDeptId,
      typeCode: "POLICY_AND_STANDARD",
      collectionId: "UNASSIGNED",
      readerScope: "ORGANIZATION",
      validity: "CURRENT",
      includeLinks: true,
      relationshipTypes: "REFERENCES,SUPERSEDES",
      monitor: false,
      onlyOpenCases: false,
      onlyUnassignedOrg: false,
      includeExpired: false,
      focusDocumentId: makeUuid("dddddddd", 1),
      limit: 25,
    }));

    const badUrls = [
      `/api/v1/organizations/not-a-uuid/knowledge/graph`,
      `/api/v1/organizations/${orgId}/knowledge/graph?unknown=1`,
      `/api/v1/organizations/${orgId}/knowledge/graph?view=invalid`,
      `/api/v1/organizations/${orgId}/knowledge/graph?q=${"a".repeat(121)}`,
      `/api/v1/organizations/${orgId}/knowledge/graph?ownerDepartmentId=not-a-uuid`,
      `/api/v1/organizations/${orgId}/knowledge/graph?typeCode=Policy`,
      `/api/v1/organizations/${orgId}/knowledge/graph?collectionId=not-a-uuid`,
      `/api/v1/organizations/${orgId}/knowledge/graph?readerScope=PRIVATE`,
      `/api/v1/organizations/${orgId}/knowledge/graph?validity=ARCHIVED`,
      `/api/v1/organizations/${orgId}/knowledge/graph?includeLinks=maybe`,
      `/api/v1/organizations/${orgId}/knowledge/graph?includeLinks=1`,
      `/api/v1/organizations/${orgId}/knowledge/graph?includeLinks=`,
      `/api/v1/organizations/${orgId}/knowledge/graph?monitor=yes`,
      `/api/v1/organizations/${orgId}/knowledge/graph?relationshipTypes=UNKNOWN`,
      `/api/v1/organizations/${orgId}/knowledge/graph?relationshipTypes=REFERENCES,REFERENCES`,
      `/api/v1/organizations/${orgId}/knowledge/graph?relationshipTypes=REFERENCES,`,
      `/api/v1/organizations/${orgId}/knowledge/graph?focusDocumentId=bad`,
      `/api/v1/organizations/${orgId}/knowledge/graph?limit=0`,
      `/api/v1/organizations/${orgId}/knowledge/graph?limit=501`,
      `/api/v1/organizations/${orgId}/knowledge/graph?limit=1.5`,
      `/api/v1/organizations/${orgId}/knowledge/graph?view=accountability&view=collections`,
    ];
    for (const url of badUrls) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(400);
    }

    await app.close();
  });

  it("wires GET /knowledge/graph through buildApp with repository.graph", async () => {
    const store = new FakeGraphStore();
    store.snapshot!.documents = [makeDoc()];
    const fakeRepo = { graph: store } as unknown as ArdenDataRepository;
    const fakeStorage = {} as unknown as PrivateContentStorage;
    const app = buildApp({
      checkDatabase: async () => undefined,
      auth: null,
      authTrustedOrigins: ["http://localhost:5180"],
      secureCookies: false,
      repository: fakeRepo,
      storage: fakeStorage,
      testActor: { userId, email: "reader@example.test", fullName: "Reader", emailVerified: true },
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgId}/knowledge/graph?typeCode=POLICY_AND_STANDARD`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json() as KnowledgeGraphPayload;
      expect(body.schemaVersion).toBe(1);
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0]!.type).toBe("Policy & Standard");
    } finally {
      await app.close();
    }
  });
});

describe("T-07 Governance Monitor Mode projection", () => {
  it("delegates to store.loadMonitorProjection automatically without an explicit monitorHandler option", async () => {
    const store = new FakeGraphStore();
    const expiredDoc = makeDoc({
      documentId: makeUuid("dddddddd", 90),
      publishedVersionId: makeUuid("eeeeeeee", 90),
      title: "Expired Author Policy",
      validUntil: "2026-10-01",
      isAuthor: true,
      canRenew: true,
    });
    const restrictedReviewerDoc = makeDoc({
      documentId: makeUuid("dddddddd", 91),
      publishedVersionId: makeUuid("eeeeeeee", 91),
      title: "Restricted Department SOP",
      validUntil: "2026-12-05",
      targetReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [otherMembershipId] },
      collection: null,
      isAuthor: false,
      canRenew: false,
    });
    const unassignedAdminDoc = makeDoc({
      documentId: makeUuid("dddddddd", 92),
      publishedVersionId: makeUuid("eeeeeeee", 92),
      title: "Unassigned Org Standard",
      validUntil: "2027-06-01",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      collection: null,
      isAuthor: false,
      canRenew: false,
    });

    store.snapshot!.documents = [];
    store.snapshot!.actor.hasAuthoredPublishedDoc = true;

    const loadMonitorProjection = vi.fn(async (_u: string, _o: string, opts: { monitorRequested: boolean; includeExpired: boolean }) => ({
      canUseMonitorMode: true,
      canIncludeExpired: true,
      monitorActive: opts.monitorRequested,
      includeExpiredActive: opts.monitorRequested && opts.includeExpired,
      documents: opts.monitorRequested
        ? [
          {
            raw: expiredDoc,
            isCurrentlyReadable: false,
            openTarget: "MY_CONTRIBUTIONS" as const,
            monitorSignals: {
              openMaintenanceCaseCount: null,
              isUnassignedOrgDoc: false,
              requiresAuditedInspection: false,
            },
          },
          {
            raw: restrictedReviewerDoc,
            isCurrentlyReadable: false,
            openTarget: "RESPONSIBLE_VIEW" as const,
            monitorSignals: {
              openMaintenanceCaseCount: 2,
              isUnassignedOrgDoc: false,
              requiresAuditedInspection: false,
            },
          },
          {
            raw: unassignedAdminDoc,
            isCurrentlyReadable: false,
            openTarget: "ADMIN_INSPECTION" as const,
            monitorSignals: {
              openMaintenanceCaseCount: 0,
              isUnassignedOrgDoc: true,
              requiresAuditedInspection: true,
            },
          },
        ]
        : [],
    }));
    store.loadMonitorProjection = loadMonitorProjection;

    const service = new GraphProjectionService(store);

    // 1. Default mode (monitor=false): expired-only author STILL gets canUseMonitorMode: true!
    const defaultView = await service.getGraph(userId, orgId, {});
    expect(defaultView?.capabilities.canUseMonitorMode).toBe(true);
    expect(defaultView?.capabilities.canIncludeExpired).toBe(true);
    expect(defaultView?.appliedMode.monitorActive).toBe(false);
    expect(defaultView?.documents).toHaveLength(0);

    // 2. Monitor Mode with includeExpired=false hides expired doc, exposes openTarget & nullable case count.
    const activeUnexpired = await service.getGraph(userId, orgId, { monitor: true });
    expect(activeUnexpired?.appliedMode.monitorActive).toBe(true);
    expect(activeUnexpired?.appliedMode.includeExpiredActive).toBe(false);
    expect(activeUnexpired?.documents.map((d) => d.title)).toEqual([
      "Restricted Department SOP",
      "Unassigned Org Standard",
    ]);
    const reviewerNode = activeUnexpired?.documents.find((d) => d.title === "Restricted Department SOP");
    expect(reviewerNode?.openTarget).toBe("RESPONSIBLE_VIEW");
    expect(reviewerNode?.monitorSignals?.openMaintenanceCaseCount).toBe(2);
    expect(reviewerNode?.canEditRelationships).toBe(false);

    const adminNode = activeUnexpired?.documents.find((d) => d.title === "Unassigned Org Standard");
    expect(adminNode?.openTarget).toBe("ADMIN_INSPECTION");
    expect(adminNode?.monitorSignals?.requiresAuditedInspection).toBe(true);
    expect(adminNode?.monitorSignals?.isUnassignedOrgDoc).toBe(true);

    // 3. Monitor Mode with includeExpired=true surfaces expired own doc with MY_CONTRIBUTIONS and null case count.
    const withExpired = await service.getGraph(userId, orgId, { monitor: true, includeExpired: true });
    expect(withExpired?.appliedMode.includeExpiredActive).toBe(true);
    const expiredNode = withExpired?.documents.find((d) => d.title === "Expired Author Policy");
    expect(expiredNode?.validityStatus).toBe("Expired");
    expect(expiredNode?.openTarget).toBe("MY_CONTRIBUTIONS");
    expect(expiredNode?.monitorSignals?.openMaintenanceCaseCount).toBeNull();
    expect(expiredNode?.canEditRelationships).toBe(false);
    expect(expiredNode?.canRenew).toBe(true);

    // 4. onlyOpenCases excludes null and 0; onlyUnassignedOrg returns only unassigned org docs.
    const openOnly = await service.getGraph(userId, orgId, { monitor: true, includeExpired: true, onlyOpenCases: true });
    expect(openOnly?.documents.map((d) => d.title)).toEqual(["Restricted Department SOP"]);

    const unassignedOnly = await service.getGraph(userId, orgId, { monitor: true, onlyUnassignedOrg: true });
    expect(unassignedOnly?.documents.map((d) => d.title)).toEqual(["Unassigned Org Standard"]);
  });

  it("refuses Monitor Mode and expired docs for non-accountable ordinary readers", async () => {
    const store = new FakeGraphStore();
    store.snapshot!.documents = [makeDoc()];
    store.loadMonitorProjection = async () => ({
      canUseMonitorMode: false,
      canIncludeExpired: false,
      monitorActive: false,
      includeExpiredActive: false,
      documents: [],
    });

    const service = new GraphProjectionService(store);
    const result = await service.getGraph(userId, orgId, {
      monitor: true,
      includeExpired: true,
      validity: "EXPIRED",
    });

    expect(result?.capabilities.canUseMonitorMode).toBe(false);
    expect(result?.capabilities.canIncludeExpired).toBe(false);
    expect(result?.appliedMode.monitorActive).toBe(false);
    expect(result?.appliedMode.includeExpiredActive).toBe(false);
    expect(result?.documents).toHaveLength(0);
  });

  it("uses single-transaction loadGraphBundle when available without invoking separate monitor/snapshot/relationship scans", async () => {
    const store = new FakeGraphStore();
    const docA = makeDoc({
      documentId: makeUuid("10000000", 1),
      publishedVersionId: makeUuid("20000000", 1),
      title: "Alpha Policy",
      ownerDepartmentId: salesDeptId,
      ownerDepartmentName: "Sales",
      isAuthor: true,
      canRenew: true,
    });
    const docFocus = makeDoc({
      documentId: makeUuid("10000000", 2),
      publishedVersionId: makeUuid("20000000", 2),
      title: "Focused Engineering Guide",
      ownerDepartmentId: engDeptId,
      ownerDepartmentName: "Engineering",
      management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
      validUntil: null,
      collection: null,
    });
    const edge: GraphRawRelationship = {
      relationshipId: makeUuid("30000000", 1),
      sourceDocumentId: docA.documentId,
      targetDocumentId: docFocus.documentId,
      relationshipType: "REFERENCES",
      createdAt: new Date("2026-11-26T00:00:00.000Z"),
    };

    const loadReadableSnapshotSpy = vi.spyOn(store, "loadReadableSnapshot");
    const loadMonitorProjectionSpy = vi.fn();
    store.loadMonitorProjection = loadMonitorProjectionSpy;

    const loadGraphBundleSpy = vi.fn<NonNullable<GraphStore["loadGraphBundle"]>>(async (_u, _o, input) => {
      const base = {
        organization: { id: orgId, name: "Acme Corp" },
        actor: {
          membershipId,
          organizationId: orgId,
          status: "ACTIVE" as const,
          departmentIds: [salesDeptId, engDeptId],
          isOrgAdmin: false,
          hasAuthoredPublishedDoc: true,
        },
        utcToday: "2026-11-26",
        canUseMonitorMode: true,
        canIncludeExpired: true,
        monitorActive: false,
        includeExpiredActive: false,
        entries: [
          { raw: docA, isCurrentlyReadable: true, openTarget: "READER" as const, monitorSignals: null },
          { raw: docFocus, isCurrentlyReadable: true, openTarget: "READER" as const, monitorSignals: null },
        ],
      };
      const returnedIds = input.selectDocumentIdsForLinks(base);
      return {
        ...base,
        relationships: input.includeLinks && returnedIds.includes(docA.documentId) && returnedIds.includes(docFocus.documentId)
          ? [edge]
          : [],
      };
    });
    (store as GraphStore & { loadGraphBundle?: unknown }).loadGraphBundle = loadGraphBundleSpy;

    const service = new GraphProjectionService(store);
    // Filter by Sales department, but focusDocumentId is in Engineering (F3G-05a must keep focusDocumentId AND load its link in-tx).
    const payload = await service.getGraph(userId, orgId, {
      ownerDepartmentId: salesDeptId,
      focusDocumentId: docFocus.documentId,
      includeLinks: true,
      monitor: false,
    });

    expect(loadGraphBundleSpy).toHaveBeenCalledTimes(1);
    expect(loadGraphBundleSpy.mock.calls[0]![2]).toMatchObject({
      monitorRequested: false,
      includeExpired: false,
      includeLinks: true,
    });
    expect(loadReadableSnapshotSpy).not.toHaveBeenCalled();
    expect(loadMonitorProjectionSpy).not.toHaveBeenCalled();
    expect(store.listRelationshipsCalls).toHaveLength(0);
    expect(payload?.capabilities).toEqual({
      canUseMonitorMode: true,
      canIncludeExpired: true,
      canManageRelationships: true,
    });
    expect(payload?.documents.map((d) => d.documentId)).toContain(docFocus.documentId);
    expect(payload?.relationships).toHaveLength(1);
    expect(payload?.relationships[0]?.relationshipId).toBe(edge.relationshipId);
  });

  it("promotes authorized 1-hop relationship peers of focusDocumentId when truncated with links enabled", async () => {
    const store = new FakeGraphStore();
    const doc1 = makeDoc({ documentId: makeUuid("10000000", 1), publishedAt: new Date("2026-11-25T00:00:00Z") });
    const doc2 = makeDoc({ documentId: makeUuid("10000000", 2), publishedAt: new Date("2026-11-24T00:00:00Z") });
    const doc3 = makeDoc({ documentId: makeUuid("10000000", 3), publishedAt: new Date("2026-11-23T00:00:00Z") });
    const docPeer = makeDoc({
      documentId: makeUuid("10000000", 4),
      ownerDepartmentId: salesDeptId,
      ownerDepartmentName: "Sales",
      publishedAt: new Date("2026-11-20T00:00:00Z"),
    });
    const edge: GraphRawRelationship = {
      relationshipId: makeUuid("80000000", 42),
      sourceDocumentId: doc1.documentId,
      targetDocumentId: docPeer.documentId,
      relationshipType: "REFERENCES",
      createdAt: new Date("2026-11-26T00:00:00Z"),
    };

    const loadGraphBundle: NonNullable<GraphStore["loadGraphBundle"]> = async (_u, _o, input) => {
      const base = {
        organization: { id: orgId, name: "Acme Corp" },
        actor: {
          membershipId,
          organizationId: orgId,
          status: "ACTIVE" as const,
          departmentIds: [engDeptId, salesDeptId],
          isOrgAdmin: false,
          hasAuthoredPublishedDoc: true,
        },
        utcToday: "2026-11-26",
        canUseMonitorMode: true,
        canIncludeExpired: true,
        monitorActive: false,
        includeExpiredActive: false,
        entries: [doc1, doc2, doc3, docPeer].map((raw) => ({
          raw,
          isCurrentlyReadable: true,
          openTarget: "READER" as const,
          monitorSignals: null,
        })),
      };
      const returnedIds = input.selectDocumentIdsForLinks(base, [docPeer.documentId]);
      return {
        ...base,
        relationships: input.includeLinks && returnedIds.includes(doc1.documentId) && returnedIds.includes(docPeer.documentId)
          ? [edge]
          : [],
      };
    };
    (store as GraphStore).loadGraphBundle = loadGraphBundle;

    const service = new GraphProjectionService(store);
    const payload = await service.getGraph(userId, orgId, {
      limit: 2,
      includeLinks: true,
      focusDocumentId: doc1.documentId,
    });

    expect(payload?.truncation.truncated).toBe(true);
    expect(payload?.documents).toHaveLength(2);
    expect(payload?.documents.map((d) => d.documentId)).toEqual([doc1.documentId, docPeer.documentId]);
    expect(payload?.relationships).toHaveLength(1);
    expect(payload?.relationships[0]?.targetDocumentId).toBe(docPeer.documentId);
  });
});
