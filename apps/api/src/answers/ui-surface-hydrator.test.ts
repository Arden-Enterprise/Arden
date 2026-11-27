import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeAndValidateSurface,
  validateStoredBoundSurface,
  type BoundUiSurface,
  type HydratedDocumentSummary,
} from "@arden/domain";
import type { AuthorizedAiSource } from "../db/repository.js";
import type { PublicCitation } from "./governed-contracts.js";
import {
  buildSourceCatalogAndHandleMap,
  hydrateConversationSurfaces,
  synthesizeFallbackSurface,
  type SurfaceHydrationLoader,
  type SurfaceLineageEdgeRecord,
  type TurnSurfaceInput,
} from "./ui-surface-hydrator.js";

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function makeCitation(documentId: string, versionId: string, excerpt = "MFA is required."): PublicCitation {
  return {
    documentId,
    versionId,
    blockId: "pdf-page-2",
    page: 2,
    excerpt,
    title: "Security Policy",
    version: "1.0",
    scope: "Company-wide",
    classification: "INTERNAL",
    documentCode: null,
    startOffset: 0,
    endOffset: Array.from(excerpt).length,
  };
}

function makeHydratedDoc(overrides: Partial<HydratedDocumentSummary> = {}): HydratedDocumentSummary {
  return {
    documentId: randomUUID(),
    publishedVersionId: randomUUID(),
    title: "Security Policy",
    type: "Policy & Standard",
    version: "1.0",
    ownerDepartmentId: randomUUID(),
    ownerDepartmentName: "Security",
    authorDisplayName: "Alice Author",
    publishedAt: "2026-11-20T00:00:00.000Z",
    validUntil: null,
    validityStatus: "Current",
    daysUntilExpiry: null,
    readerScope: "ORGANIZATION",
    collectionName: "Handbook",
    openMaintenanceCaseCount: null,
    openTarget: "READER",
    canReportIssue: true,
    canOpenMaintenance: false,
    canRenew: false,
    ...overrides,
  };
}

describe("synthesizeFallbackSurface", () => {
  it("builds a Core gap callout for INSUFFICIENT_EVIDENCE with empty bindings", () => {
    const surface = synthesizeFallbackSurface(
      "INSUFFICIENT_EVIDENCE",
      "I could not find enough authorized knowledge in this scope to answer that question.",
      [],
      [],
    );
    const validated = validateStoredBoundSurface(surface, { citationCount: 0 });
    expect(validated.ok).toBe(true);
    expect(surface.bindings).toEqual({ documents: [], citationIndexes: [] });
    const root = surface.nodes[surface.rootId];
    expect(root?.kind).toBe("stack");
    if (root?.kind === "stack") {
      expect(root.childIds).toHaveLength(1);
      const callout = surface.nodes[root.childIds[0]!];
      expect(callout).toMatchObject({
        kind: "callout",
        tone: "gap",
        title: "Insufficient authorized knowledge",
      });
    }
  });

  it("preserves INSUFFICIENT_EVIDENCE answers longer than 800 characters via an added prose node", () => {
    const longAnswer = "No matching policy found. ".repeat(45).trim();
    expect(longAnswer.length).toBeGreaterThan(800);

    const surface = synthesizeFallbackSurface("INSUFFICIENT_EVIDENCE", longAnswer, [], []);
    const validated = validateStoredBoundSurface(surface, { citationCount: 0 });
    expect(validated.ok).toBe(true);
    const root = surface.nodes[surface.rootId];
    expect(root?.kind).toBe("stack");
    if (root?.kind === "stack") {
      expect(root.childIds).toHaveLength(2);
      const callout = surface.nodes[root.childIds[0]!];
      const prose = surface.nodes[root.childIds[1]!];
      expect(callout?.kind).toBe("callout");
      if (callout?.kind === "callout") expect(callout.body.length).toBeLessThanOrEqual(800);
      expect(prose).toEqual({ kind: "prose", markdown: longAnswer });
    }
  });

  it("supports a full 12,000-char ANSWERED response with sources card and footer actions", () => {
    const docA = { documentId: randomUUID(), publishedVersionId: randomUUID() };
    const docB = { documentId: randomUUID(), publishedVersionId: randomUUID() };
    const longAnswer = `${"A".repeat(11_996)} [1]`;
    expect(longAnswer.length).toBe(12_000);
    const citations = [makeCitation(docA.documentId, docA.publishedVersionId)];

    const surface = synthesizeFallbackSurface("ANSWERED", longAnswer, citations, [docA, docB]);
    const validated = validateStoredBoundSurface(surface, { citationCount: citations.length });
    expect(validated.ok).toBe(true);
    expect(surface.bindings.documents).toHaveLength(2);
    expect(surface.bindings.citationIndexes).toEqual([1]);

    const kinds = Object.values(surface.nodes).map((n) => n.kind);
    expect(kinds).toContain("prose");
    expect(kinds).toContain("card");
    expect(kinds).toContain("document_item");
    expect(kinds).toContain("open_reader");
    expect(kinds).toContain("graph_action");
  });

  it("caps fallback sources at 8 unique documents prioritizing cited docs and sanitizes unsafe raw text", () => {
    const docs = Array.from({ length: 10 }, () => ({
      documentId: randomUUID(),
      publishedVersionId: randomUUID(),
    }));
    const citedDoc = docs[9]!;
    const citations = [makeCitation(citedDoc.documentId, citedDoc.publishedVersionId)];
    const trickyAnswer = "See <script>alert(1)</script> and [99] in policy [1].";

    const surface = synthesizeFallbackSurface("ANSWERED", trickyAnswer, citations, docs);
    const validated = validateStoredBoundSurface(surface, { citationCount: citations.length });
    expect(validated.ok).toBe(true);
    expect(surface.bindings.documents).toHaveLength(8);
    expect(surface.bindings.documents.some((d) => d.documentId === citedDoc.documentId)).toBe(true);
  });
});

describe("buildSourceCatalogAndHandleMap", () => {
  it("emits zero raw UUIDs in sourceCatalog and maps golden v3 draft handles cleanly", () => {
    const docId = randomUUID();
    const versionId = randomUUID();
    const deptId = randomUUID();
    const colId = randomUUID();

    const source: AuthorizedAiSource = {
      generationId: randomUUID(),
      snapshotVersionId: randomUUID(),
      snapshotContentHash: "b".repeat(64),
      publishedVersionId: versionId,
      draftId: docId,
      title: "Security Policy",
      versionNo: 1,
      classification: "INTERNAL",
      targetScopeType: "ORGANIZATION",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      management: { type: "Policy & Standard", version: "1.0", expirationDate: null, changeNote: "" },
      chunks: [],
    };

    const { sourceCatalog, handleMap } = buildSourceCatalogAndHandleMap([source], new Map([
      [versionId, {
        ownerDepartmentId: deptId,
        ownerDepartmentName: "Security",
        version: "1.0",
        readerScope: "ORGANIZATION",
        collectionId: colId,
        hasDirectRelationships: true,
      }],
    ]));

    expect(sourceCatalog).toEqual([{
      docRef: "D1",
      title: "Security Policy",
      type: "Policy & Standard",
      ownerDepartment: "Security",
      version: "1.0",
      readerScope: "ORGANIZATION",
      hasDirectRelationships: true,
      departmentRef: "DEPT1",
      collectionRef: "C1",
    }]);
    expect(UUID_REGEX.test(JSON.stringify(sourceCatalog))).toBe(false);
    expect(handleMap).toEqual({
      documents: { D1: { documentId: docId, publishedVersionId: versionId } },
      departments: { DEPT1: deptId },
      collections: { C1: colId },
    });

    const goldenV3 = JSON.parse(readFileSync(new URL("./fixtures/governed-v3.json", import.meta.url), "utf8")) as {
      generationV3Response: { uiSurface: unknown };
    };
    const normalized = normalizeAndValidateSurface(goldenV3.generationV3Response.uiSurface, handleMap, 1);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.surface.bindings.documents).toEqual([{ documentId: docId, publishedVersionId: versionId }]);
    }
  });

  it("populates departmentRef and handleMap.departments from source.responsibleDepartmentId when metadataMap is absent, and never collides unmapped fallback with real DEPT1", () => {
    const docNoDept = randomUUID();
    const verNoDept = randomUUID();
    const docWithDept = randomUUID();
    const verWithDept = randomUUID();
    const realDeptId = randomUUID();

    const legacySource: AuthorizedAiSource = {
      generationId: randomUUID(),
      snapshotVersionId: randomUUID(),
      snapshotContentHash: "a".repeat(64),
      publishedVersionId: verNoDept,
      draftId: docNoDept,
      title: "Legacy Policy",
      versionNo: 1,
      classification: "INTERNAL",
      targetScopeType: "ORGANIZATION",
      targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      management: { type: "Policy & Standard", version: "1.0", expirationDate: null, changeNote: "" },
      chunks: [],
    };
    const governedSource: AuthorizedAiSource = {
      ...legacySource,
      generationId: randomUUID(),
      snapshotVersionId: randomUUID(),
      publishedVersionId: verWithDept,
      draftId: docWithDept,
      title: "Engineering Policy",
      responsibleDepartmentId: realDeptId,
    };

    const { sourceCatalog, handleMap } = buildSourceCatalogAndHandleMap([legacySource, governedSource], new Map());
    expect(UUID_REGEX.test(JSON.stringify(sourceCatalog))).toBe(false);
    // Real department gets DEPT1 and is mapped in handleMap.departments (even without metadataMap).
    expect(sourceCatalog[1]!.departmentRef).toBe("DEPT1");
    expect(handleMap.departments).toEqual({ DEPT1: realDeptId });
    // Legacy source without a valid department UUID does NOT claim DEPT1 or map a synthetic UUID.
    expect(sourceCatalog[0]!.departmentRef).toMatch(/^DEPT[1-9][0-9]{0,2}$/);
    expect(sourceCatalog[0]!.departmentRef).not.toBe("DEPT1");
    expect(handleMap.departments?.[sourceCatalog[0]!.departmentRef]).toBeUndefined();
  });
});

describe("hydrateConversationSurfaces", () => {
  it("batches unique version hydration once across turns and computes per-turn metrics accurately", async () => {
    const deptEng = randomUUID();
    const deptSec = randomUUID();
    const doc1 = makeHydratedDoc({
      ownerDepartmentId: deptEng,
      ownerDepartmentName: "Engineering",
      validityStatus: "Expiring soon",
      daysUntilExpiry: 5,
      openMaintenanceCaseCount: 2,
      canOpenMaintenance: true,
    });
    const doc2 = makeHydratedDoc({
      ownerDepartmentId: deptSec,
      ownerDepartmentName: "Security",
      validityStatus: "Current",
      openMaintenanceCaseCount: 1,
      canOpenMaintenance: true,
    });
    const doc3 = makeHydratedDoc({
      ownerDepartmentId: deptSec,
      ownerDepartmentName: "Security",
      validityStatus: "Current",
      openMaintenanceCaseCount: 4,
      canOpenMaintenance: true,
    });

    const turn1Surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["metrics_1", "doc_1", "doc_2"] },
        metrics_1: {
          kind: "metric_strip",
          metricKeys: ["MATCHED_DOCS", "EXPIRING_SOON_DOCS", "OPEN_MAINTENANCE_CASES", "DISTINCT_OWNER_DEPTS"],
        },
        doc_1: { kind: "document_item", documentId: doc1.documentId, publishedVersionId: doc1.publishedVersionId },
        doc_2: { kind: "document_item", documentId: doc2.documentId, publishedVersionId: doc2.publishedVersionId },
      },
      bindings: {
        documents: [
          { documentId: doc1.documentId, publishedVersionId: doc1.publishedVersionId },
          { documentId: doc2.documentId, publishedVersionId: doc2.publishedVersionId },
        ].sort((a, b) => a.documentId.localeCompare(b.documentId)),
        citationIndexes: [],
      },
    };

    const turn2Surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["metrics_2", "doc_3"] },
        metrics_2: {
          kind: "metric_strip",
          metricKeys: ["MATCHED_DOCS", "EXPIRING_SOON_DOCS", "OPEN_MAINTENANCE_CASES", "DISTINCT_OWNER_DEPTS"],
        },
        doc_3: { kind: "document_item", documentId: doc3.documentId, publishedVersionId: doc3.publishedVersionId },
      },
      bindings: {
        documents: [{ documentId: doc3.documentId, publishedVersionId: doc3.publishedVersionId }],
        citationIndexes: [],
      },
    };

    const loadDocuments = vi.fn<SurfaceHydrationLoader["loadDocuments"]>(async () => new Map([
      [doc1.publishedVersionId, doc1],
      [doc2.publishedVersionId, doc2],
      [doc3.publishedVersionId, doc3],
    ]));
    const loadLineages = vi.fn<SurfaceHydrationLoader["loadLineages"]>(async () => new Map());

    const turns: TurnSurfaceInput[] = [
      { id: "t1", status: "ANSWERED", answer: "Answer 1", citations: [], surface: turn1Surface },
      { id: "t2", status: "ANSWERED", answer: "Answer 2", citations: [], surface: turn2Surface },
    ];

    const bundle = await hydrateConversationSurfaces({ loadDocuments, loadLineages }, "user-1", "org-1", turns);

    expect(loadDocuments).toHaveBeenCalledTimes(1);
    expect(loadDocuments.mock.calls[0]![2]).toHaveLength(3);
    expect(loadLineages).not.toHaveBeenCalled();

    expect(Object.keys(bundle.hydratedDocuments)).toHaveLength(3);
    // Turn 1 metrics computed STRICTLY over Turn 1 bindings (doc1 + doc2, NOT doc3)
    expect(bundle.turnsById.get("t1")?.turnHydration.metrics.metrics_1).toEqual([
      { key: "MATCHED_DOCS", label: "Matched documents", value: 2, tone: "neutral" },
      { key: "EXPIRING_SOON_DOCS", label: "Expiring soon", value: 1, tone: "warning" },
      { key: "OPEN_MAINTENANCE_CASES", label: "Open maintenance cases", value: 3, tone: "attention" },
      { key: "DISTINCT_OWNER_DEPTS", label: "Owner departments", value: 2, tone: "neutral" },
    ]);
    // Turn 2 metrics computed STRICTLY over Turn 2 bindings (doc3 only)
    expect(bundle.turnsById.get("t2")?.turnHydration.metrics.metrics_2).toEqual([
      { key: "MATCHED_DOCS", label: "Matched documents", value: 1, tone: "neutral" },
      { key: "EXPIRING_SOON_DOCS", label: "Expiring soon", value: 0, tone: "neutral" },
      { key: "OPEN_MAINTENANCE_CASES", label: "Open maintenance cases", value: 4, tone: "attention" },
      { key: "DISTINCT_OWNER_DEPTS", label: "Owner departments", value: 1, tone: "neutral" },
    ]);
  });

  it("omits OPEN_MAINTENANCE_CASES metric tile when openMaintenanceCaseCount is null (ordinary reader or author)", async () => {
    const readerDoc = makeHydratedDoc({ openMaintenanceCaseCount: null, canOpenMaintenance: false });
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["metrics", "doc"] },
        metrics: { kind: "metric_strip", metricKeys: ["MATCHED_DOCS", "OPEN_MAINTENANCE_CASES"] },
        doc: { kind: "document_item", documentId: readerDoc.documentId, publishedVersionId: readerDoc.publishedVersionId },
      },
      bindings: {
        documents: [{ documentId: readerDoc.documentId, publishedVersionId: readerDoc.publishedVersionId }],
        citationIndexes: [],
      },
    };

    const bundle = await hydrateConversationSurfaces(
      {
        loadDocuments: async () => new Map([[readerDoc.publishedVersionId, readerDoc]]),
        loadLineages: async () => new Map(),
      },
      "reader-1",
      "org-1",
      [{ id: "t1", status: "ANSWERED", answer: "Answer", citations: [], surface }],
    );

    const tiles = bundle.turnsById.get("t1")?.turnHydration.metrics.metrics ?? [];
    expect(tiles.map((t) => t.key)).toEqual(["MATCHED_DOCS"]);
    expect(bundle.hydratedDocuments[readerDoc.publishedVersionId]?.openMaintenanceCaseCount).toBeNull();
  });

  it("strips unauthorized workflow_handoff nodes from footerIds and removes empty footerIds", async () => {
    const doc = makeHydratedDoc({
      canReportIssue: true,
      canOpenMaintenance: false,
      canRenew: false,
    });
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["card_1", "card_2"] },
        card_1: {
          kind: "card",
          title: "Doc card",
          bodyIds: ["doc_1"],
          footerIds: ["report_btn", "maint_btn", "renew_btn"],
        },
        card_2: {
          kind: "card",
          title: "Only disallowed footer",
          bodyIds: ["prose_1"],
          footerIds: ["maint_only"],
        },
        doc_1: { kind: "document_item", documentId: doc.documentId, publishedVersionId: doc.publishedVersionId },
        prose_1: { kind: "prose", markdown: "Details." },
        report_btn: {
          kind: "workflow_handoff",
          label: "Report issue",
          handoff: "report_issue",
          documentId: doc.documentId,
          publishedVersionId: doc.publishedVersionId,
        },
        maint_btn: {
          kind: "workflow_handoff",
          label: "Open maintenance",
          handoff: "open_maintenance_case",
          documentId: doc.documentId,
          publishedVersionId: doc.publishedVersionId,
        },
        renew_btn: {
          kind: "workflow_handoff",
          label: "Renew doc",
          handoff: "open_renewal",
          documentId: doc.documentId,
          publishedVersionId: doc.publishedVersionId,
        },
        maint_only: {
          kind: "workflow_handoff",
          label: "Maintenance",
          handoff: "open_maintenance_case",
          documentId: doc.documentId,
          publishedVersionId: doc.publishedVersionId,
        },
      },
      bindings: {
        documents: [{ documentId: doc.documentId, publishedVersionId: doc.publishedVersionId }],
        citationIndexes: [],
      },
    };

    const bundle = await hydrateConversationSurfaces(
      {
        loadDocuments: async () => new Map([[doc.publishedVersionId, doc]]),
        loadLineages: async () => new Map(),
      },
      "reader-1",
      "org-1",
      [{ id: "t1", status: "ANSWERED", answer: "Details.", citations: [], surface }],
    );

    const hydratedSurface = bundle.turnsById.get("t1")!.surface;
    expect(validateStoredBoundSurface(hydratedSurface, { citationCount: 0 }).ok).toBe(true);
    expect(hydratedSurface.nodes.card_1).toMatchObject({ footerIds: ["report_btn"] });
    expect(hydratedSurface.nodes.card_2).not.toHaveProperty("footerIds");
    expect(hydratedSurface.nodes.report_btn).toBeDefined();
    expect(hydratedSurface.nodes.maint_btn).toBeUndefined();
    expect(hydratedSurface.nodes.renew_btn).toBeUndefined();
    expect(hydratedSurface.nodes.maint_only).toBeUndefined();
  });

  it("degrades cleanly to synthesizeFallbackSurface when capability stripping empties a required container", async () => {
    const doc = makeHydratedDoc({ canRenew: false });
    const citation = makeCitation(doc.documentId, doc.publishedVersionId);
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["renew_only"] },
        renew_only: {
          kind: "workflow_handoff",
          label: "Renew doc",
          handoff: "open_renewal",
          documentId: doc.documentId,
          publishedVersionId: doc.publishedVersionId,
        },
      },
      bindings: {
        documents: [{ documentId: doc.documentId, publishedVersionId: doc.publishedVersionId }],
        citationIndexes: [],
      },
    };

    const bundle = await hydrateConversationSurfaces(
      {
        loadDocuments: async () => new Map([[doc.publishedVersionId, doc]]),
        loadLineages: async () => new Map(),
      },
      "reader-1",
      "org-1",
      [{ id: "t1", status: "ANSWERED", answer: "MFA is required [1].", citations: [citation], surface }],
    );

    const hydratedSurface = bundle.turnsById.get("t1")!.surface;
    expect(validateStoredBoundSurface(hydratedSurface, { citationCount: 1 }).ok).toBe(true);
    expect(Object.values(hydratedSurface.nodes).some((n) => n.kind === "workflow_handoff")).toBe(false);
    expect(Object.values(hydratedSurface.nodes).some((n) => n.kind === "prose")).toBe(true);
  });

  it("hydrates live lineage_tree edges capped at 8 and degrades gracefully to empty edges when none exist", async () => {
    const rootDoc = makeHydratedDoc({ title: "Root Policy" });
    const emptyDoc = makeHydratedDoc({ title: "Standalone Guide" });
    const edges: SurfaceLineageEdgeRecord[] = Array.from({ length: 10 }, (_, idx) => ({
      relationshipId: randomUUID(),
      direction: idx % 2 === 0 ? "OUTGOING" : "INCOMING",
      relationshipType: idx % 3 === 0 ? "REFERENCES" : idx % 3 === 1 ? "RELATED" : "SUPERSEDES",
      peerDocumentId: randomUUID(),
      peerPublishedVersionId: randomUUID(),
      peerTitle: `Peer Doc ${idx + 1}`,
      peerType: "Guide",
    }));

    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["lin_populated", "lin_empty"] },
        lin_populated: {
          kind: "lineage_tree",
          rootDocumentId: rootDoc.documentId,
          rootPublishedVersionId: rootDoc.publishedVersionId,
        },
        lin_empty: {
          kind: "lineage_tree",
          rootDocumentId: emptyDoc.documentId,
          rootPublishedVersionId: emptyDoc.publishedVersionId,
        },
      },
      bindings: {
        documents: [
          { documentId: rootDoc.documentId, publishedVersionId: rootDoc.publishedVersionId },
          { documentId: emptyDoc.documentId, publishedVersionId: emptyDoc.publishedVersionId },
        ].sort((a, b) => a.documentId.localeCompare(b.documentId)),
        citationIndexes: [],
      },
    };

    const bundle = await hydrateConversationSurfaces(
      {
        loadDocuments: async () => new Map([
          [rootDoc.publishedVersionId, rootDoc],
          [emptyDoc.publishedVersionId, emptyDoc],
        ]),
        loadLineages: async () => new Map([[rootDoc.documentId, edges]]),
      },
      "user-1",
      "org-1",
      [{ id: "t1", status: "ANSWERED", answer: "Lineage", citations: [], surface }],
    );

    const hydratedLineages = bundle.turnsById.get("t1")!.turnHydration.lineages;
    expect(hydratedLineages.lin_populated).toEqual({
      rootDocumentId: rootDoc.documentId,
      edges: edges.slice(0, 8),
    });
    expect(hydratedLineages.lin_empty).toEqual({
      rootDocumentId: emptyDoc.documentId,
      edges: [],
    });
  });
});
