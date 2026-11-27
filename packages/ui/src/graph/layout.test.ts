import { describe, expect, it, vi } from "vitest";
import type {
  DocumentId,
  GraphDocumentNode,
  GraphRelationshipEdge,
  KnowledgeGraphPayload,
  PublishedVersionId,
} from "@arden/domain";
import {
  computeGraphLayout,
  DIMMED_OPACITY,
  DOC_NODE_WIDTH,
  BRANCH_NODE_WIDTH,
  ELK_MAX_EDGES,
  ELK_MAX_NODES,
  type ElkInputGraph,
  type ElkOutputGraph,
} from "./layout";

function makeDoc(overrides: Partial<GraphDocumentNode> & { documentId: string; title: string }): GraphDocumentNode {
  const { documentId, title, ...rest } = overrides;
  return {
    documentId: documentId as DocumentId,
    publishedVersionId: `ver-${documentId}` as PublishedVersionId,
    title,
    type: "Guide",
    version: "1.0",
    ownerDepartmentId: "dept-eng",
    ownerDepartmentName: "Engineering",
    authorDisplayName: "Lan Nguyen",
    publishedAt: "2026-11-20T10:00:00Z",
    validUntil: null,
    validityStatus: "Current",
    daysUntilExpiry: null,
    readerScope: "ORGANIZATION",
    collectionId: null,
    openTarget: "READER",
    canEditRelationships: true,
    canRenew: false,
    monitorSignals: null,
    ...rest,
  };
}

function makePayload(overrides: Partial<KnowledgeGraphPayload> = {}): KnowledgeGraphPayload {
  const docs: GraphDocumentNode[] = overrides.documents ?? [
    makeDoc({
      documentId: "doc-1",
      title: "Security Policy",
      type: "Policy & Standard",
      ownerDepartmentId: "dept-sec",
      ownerDepartmentName: "Security",
      readerScope: "ORGANIZATION",
      collectionId: "col-handbook",
    }),
    makeDoc({
      documentId: "doc-2",
      title: "Legacy Runbook",
      type: null,
      ownerDepartmentId: "dept-eng",
      ownerDepartmentName: "Engineering",
      readerScope: "ORGANIZATION",
      collectionId: null,
    }),
    makeDoc({
      documentId: "doc-3",
      title: "Team Onboarding",
      type: "Guide",
      ownerDepartmentId: "dept-eng",
      ownerDepartmentName: "Engineering",
      readerScope: "DEPARTMENT",
      collectionId: null,
    }),
    makeDoc({
      documentId: "doc-4",
      title: "Executive Brief",
      type: "Reference",
      ownerDepartmentId: "dept-sec",
      ownerDepartmentName: "Security",
      readerScope: "SELECTED_MEMBERS",
      collectionId: null,
    }),
  ];

  return {
    schemaVersion: 1,
    organization: { id: "org-1", name: "Arden Labs" },
    capabilities: {
      canUseMonitorMode: true,
      canIncludeExpired: true,
      canManageRelationships: true,
    },
    appliedMode: {
      view: "accountability",
      monitorActive: false,
      includeExpiredActive: false,
      includeLinksActive: false,
    },
    truncation: {
      limit: 500,
      returnedCount: docs.length,
      truncated: false,
      relationshipsLimit: 1000,
      relationshipsTruncated: false,
    },
    departments: [
      { id: "dept-eng", name: "Engineering" },
      { id: "dept-sec", name: "Security" },
    ],
    collections: [
      { id: "col-handbook", name: "Company Handbook", allowedTypes: ["Policy & Standard", "Guide"] },
      { id: "col-empty", name: "Empty Collection", allowedTypes: ["Procedure"] },
    ],
    documents: docs,
    relationships: [],
    ...overrides,
  };
}

describe("GraphLayoutEngine (computeGraphLayout)", () => {
  it("builds the Accountability tree with Org -> Owner Department -> Controlled Type (plus Uncategorized legacy) -> Documents", async () => {
    const payload = makePayload();
    const result = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: false,
    });

    expect(result.layoutEngine).toBe("d3-tree");
    expect(result.elkThresholdExceeded).toBe(false);

    const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
    expect(nodeById.get("org:org-1")?.type).toBe("orgNode");
    expect(nodeById.get("dept:dept-eng")?.type).toBe("branchNode");
    expect(nodeById.get("dept:dept-eng")?.width).toBe(BRANCH_NODE_WIDTH);
    expect(nodeById.get("dept:dept-sec")?.type).toBe("branchNode");

    // Legacy null type is grouped under "Uncategorized (legacy)".
    const uncategorized = nodeById.get("type:dept-eng:UNCATEGORIZED");
    expect(uncategorized).toBeDefined();
    expect(uncategorized?.data.label).toBe("Uncategorized (legacy)");
    expect(uncategorized?.data.totalCount).toBe(1);

    const policyBranch = nodeById.get("type:dept-sec:POLICY_AND_STANDARD");
    expect(policyBranch?.data.label).toBe("Policy & Standard");

    // Document cards use fixed 248px Island width and left-to-right x depth progression.
    const doc1 = nodeById.get("doc:doc-1")!;
    expect(doc1.type).toBe("documentNode");
    expect(doc1.width).toBe(DOC_NODE_WIDTH);
    expect(doc1.position.x).toBeGreaterThan(policyBranch!.position.x);
    expect(policyBranch!.position.x).toBeGreaterThan(nodeById.get("dept:dept-sec")!.position.x);
    expect(nodeById.get("dept:dept-sec")!.position.x).toBeGreaterThan(nodeById.get("org:org-1")!.position.x);

    // Outline rows mirror every visible canvas node in deterministic DFS pre-order.
    expect(result.outlineRows.map((row) => row.id)).toEqual(result.nodes.map((node) => node.id));
    expect(result.outlineRows[0]).toMatchObject({ id: "org:org-1", level: 1, parentId: null });
    expect(result.outlineRows.find((row) => row.id === "type:dept-eng:UNCATEGORIZED")).toMatchObject({
      level: 3,
      parentId: "dept:dept-eng",
      label: "Uncategorized (legacy)",
    });
    expect(result.outlineRows.find((row) => row.id === "doc:doc-2")).toMatchObject({
      level: 4,
      parentId: "type:dept-eng:UNCATEGORIZED",
    });
  });

  it("builds the Collections tree with non-empty Org Collections + Unassigned and a visibly separate Shared branch (ADR 0026)", async () => {
    const payload = makePayload();
    const result = await computeGraphLayout(payload, {
      viewMode: "collections",
      collapsedBranchIds: new Set(),
      crossLinksOn: false,
    });

    const nodeIds = result.nodes.map((node) => node.id);
    // Empty collection is never shown (prevents ADR 0032 expired-collection leak).
    expect(nodeIds).not.toContain("col:col-empty");
    expect(nodeIds).toContain("col:col-handbook");
    expect(nodeIds).toContain("unassigned:org");
    expect(nodeIds).toContain("shared:org");

    const edges = result.edges;
    expect(edges).toContainEqual(expect.objectContaining({ source: "col:col-handbook", target: "doc:doc-1" }));
    expect(edges).toContainEqual(expect.objectContaining({ source: "unassigned:org", target: "doc:doc-2" }));
    // Department and Selected Members documents belong ONLY in the separate Shared branch.
    expect(edges).toContainEqual(expect.objectContaining({ source: "shared:org", target: "doc:doc-3" }));
    expect(edges).toContainEqual(expect.objectContaining({ source: "shared:org", target: "doc:doc-4" }));

    const sharedNode = result.nodes.find((node) => node.id === "shared:org");
    expect(sharedNode?.data.totalCount).toBe(2);
    expect(result.outlineRows.map((row) => row.id)).toEqual(nodeIds);
  });

  it("dims non-matching siblings (opacity 0.28) and collapses empty branches in dim mode, and omits them in Isolate Mode", async () => {
    const payload = makePayload();

    // Filter to typeCode = GUIDE (only doc-3 in Engineering matches; Security has 0 matches).
    const dimmed = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      isolateMatching: false,
      crossLinksOn: false,
    });

    expect(dimmed.hasActiveClientFilters).toBe(true);
    expect(dimmed.matchedDocumentIds).toEqual(["doc-3"]);

    const secBranch = dimmed.nodes.find((n) => n.id === "dept:dept-sec");
    expect(secBranch?.data.dimmed).toBe(true);
    expect(secBranch?.data.opacity).toBe(DIMMED_OPACITY);
    expect(secBranch?.data.collapsed).toBe(true);
    // Children of auto-collapsed empty branch are hidden in both canvas and outline.
    expect(dimmed.nodes.find((n) => n.id === "doc:doc-1")).toBeUndefined();

    // Sibling type branch under Engineering with 0 matches is dimmed & collapsed; matching doc-3 is undimmed.
    const uncatBranch = dimmed.nodes.find((n) => n.id === "type:dept-eng:UNCATEGORIZED");
    expect(uncatBranch?.data.dimmed).toBe(true);
    expect(uncatBranch?.data.opacity).toBe(DIMMED_OPACITY);
    expect(uncatBranch?.data.collapsed).toBe(true);

    const matchedDoc = dimmed.nodes.find((n) => n.id === "doc:doc-3");
    expect(matchedDoc?.data.dimmed).toBe(false);
    expect(matchedDoc?.data.opacity).toBe(1);

    // Isolate Mode omits all non-matching branches and documents cleanly.
    const isolated = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      isolateMatching: true,
      crossLinksOn: false,
    });

    expect(isolated.nodes.map((n) => n.id)).toEqual([
      "org:org-1",
      "dept:dept-eng",
      "type:dept-eng:GUIDE",
      "doc:doc-3",
    ]);
    expect(isolated.outlineRows.map((row) => row.id)).toEqual(isolated.nodes.map((n) => n.id));
  });

  it("respects manual branch collapse identically across canvas nodes and outline rows", async () => {
    const payload = makePayload();
    const result = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(["dept:dept-eng"]),
      crossLinksOn: false,
    });

    const eng = result.nodes.find((n) => n.id === "dept:dept-eng");
    expect(eng?.data.collapsed).toBe(true);
    expect(result.nodes.find((n) => n.id === "doc:doc-2")).toBeUndefined();
    expect(result.nodes.find((n) => n.id === "doc:doc-3")).toBeUndefined();
    expect(result.outlineRows.find((r) => r.id === "dept:dept-eng")?.expanded).toBe(false);
    expect(result.outlineRows.find((r) => r.id === "doc:doc-2")).toBeUndefined();
    expect(result.outlineRows.map((r) => r.id)).toEqual(result.nodes.map((n) => n.id));
  });

  it("invokes lazy ELK layout only when crossLinksOn is true and graph is within 250 nodes / 500 edges", async () => {
    const relationships: GraphRelationshipEdge[] = [
      {
        relationshipId: "rel-1",
        sourceDocumentId: "doc-1" as DocumentId,
        targetDocumentId: "doc-3" as DocumentId,
        relationshipType: "REFERENCES",
        createdAt: "2026-11-21T00:00:00Z",
      },
    ];
    const payload = makePayload({ relationships });

    const elkSpy = vi.fn(async (graph: ElkInputGraph): Promise<ElkOutputGraph> => ({
      id: graph.id,
      children: (graph.children ?? []).map((child, idx) => ({
        id: child.id,
        x: idx * 320,
        y: idx * 90,
      })),
    }));

    // Off: never calls ELK.
    const offResult = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: false,
      elkLayoutFn: elkSpy,
    });
    expect(elkSpy).not.toHaveBeenCalled();
    expect(offResult.layoutEngine).toBe("d3-tree");

    // On & within thresholds: calls ELK and applies ELK coordinates.
    const onResult = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: true,
      elkLayoutFn: elkSpy,
    });
    expect(elkSpy).toHaveBeenCalledTimes(1);
    expect(onResult.layoutEngine).toBe("elk-layered");
    expect(onResult.elkThresholdExceeded).toBe(false);
    expect(onResult.visibleRelationshipCount).toBe(1);
    expect(onResult.edges).toContainEqual(expect.objectContaining({
      id: "rel:rel-1",
      source: "doc:doc-1",
      target: "doc:doc-3",
      kind: "relationship",
      relationshipType: "REFERENCES",
    }));
    // Coordinates came from ELK output.
    expect(onResult.nodes[1]!.position).toEqual({ x: 320, y: 90 });
  });

  it("falls back automatically to d3-bezier-overlay without calling ELK when visible nodes exceed 250", async () => {
    const docs: GraphDocumentNode[] = Array.from({ length: ELK_MAX_NODES + 5 }, (_, index) =>
      makeDoc({
        documentId: `doc-${index}`,
        title: `Policy ${index}`,
        type: "Policy & Standard",
        ownerDepartmentId: "dept-eng",
        ownerDepartmentName: "Engineering",
      }),
    );
    const relationships: GraphRelationshipEdge[] = [
      {
        relationshipId: "rel-big",
        sourceDocumentId: "doc-0" as DocumentId,
        targetDocumentId: "doc-1" as DocumentId,
        relationshipType: "SUPERSEDES",
        createdAt: "2026-11-21T00:00:00Z",
      },
    ];
    const payload = makePayload({
      departments: [{ id: "dept-eng", name: "Engineering" }],
      documents: docs,
      relationships,
    });

    const elkSpy = vi.fn();
    const result = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: true,
      elkLayoutFn: elkSpy,
    });

    expect(elkSpy).not.toHaveBeenCalled();
    expect(result.layoutEngine).toBe("d3-bezier-overlay");
    expect(result.elkThresholdExceeded).toBe(true);
    const relEdge = result.edges.find((e) => e.id === "rel:rel-big");
    expect(relEdge).toMatchObject({ kind: "relationship", type: "default", relationshipType: "SUPERSEDES" });
  });

  it("falls back automatically to d3-bezier-overlay without calling ELK when visible edges exceed 500", async () => {
    const docs: GraphDocumentNode[] = Array.from({ length: 40 }, (_, index) =>
      makeDoc({
        documentId: `doc-${index}`,
        title: `Doc ${index}`,
        type: "Guide",
        ownerDepartmentId: "dept-eng",
        ownerDepartmentName: "Engineering",
      }),
    );
    const relationships: GraphRelationshipEdge[] = Array.from({ length: ELK_MAX_EDGES }, (_, index) => ({
      relationshipId: `rel-${index}`,
      sourceDocumentId: `doc-${index % 20}` as DocumentId,
      targetDocumentId: `doc-${20 + (index % 20)}` as DocumentId,
      relationshipType: "RELATED",
      createdAt: "2026-11-21T00:00:00Z",
    }));
    const payload = makePayload({
      departments: [{ id: "dept-eng", name: "Engineering" }],
      documents: docs,
      relationships,
    });

    const elkSpy = vi.fn();
    const result = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: true,
      elkLayoutFn: elkSpy,
    });

    expect(elkSpy).not.toHaveBeenCalled();
    expect(result.layoutEngine).toBe("d3-bezier-overlay");
    expect(result.elkThresholdExceeded).toBe(true);
    expect(result.visibleRelationshipCount).toBe(ELK_MAX_EDGES);
  });

  it("marks branch nodes with partialCounts when server payload is truncated", async () => {
    const payload = makePayload({
      truncation: {
        limit: 500,
        returnedCount: 4,
        truncated: true,
        relationshipsLimit: 1000,
        relationshipsTruncated: false,
      },
    });
    const result = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { q: "Security" },
      crossLinksOn: false,
    });

    // Server already narrowed when truncated; returned docs stay undimmed and branch counts are flagged partial.
    expect(result.nodes.find((n) => n.id === "dept:dept-eng")?.data.partialCounts).toBe(true);
    expect(result.nodes.find((n) => n.id === "doc:doc-2")?.data.dimmed).toBe(false);
  });

  it("scopes branch documentIds to only matching (and focus-revealed) docs when client filters are active", async () => {
    const payload = makePayload();

    // Unfiltered: Engineering branch includes both doc-2 and doc-3.
    const unfiltered = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      crossLinksOn: false,
    });
    expect(unfiltered.nodes.find((n) => n.id === "dept:dept-eng")?.data.documentIds).toEqual(["doc-2", "doc-3"]);

    // Filtered (Dim mode, typeCode=GUIDE): only doc-3 matches Engineering; Security has 0 matches.
    const dimmed = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      isolateMatching: false,
      crossLinksOn: false,
    });
    expect(dimmed.nodes.find((n) => n.id === "dept:dept-eng")?.data.documentIds).toEqual(["doc-3"]);
    expect(dimmed.outlineRows.find((r) => r.id === "dept:dept-eng")?.documentIds).toEqual(["doc-3"]);
    expect(dimmed.nodes.find((n) => n.id === "dept:dept-sec")?.data.documentIds).toEqual([]);
    expect(dimmed.outlineRows.find((r) => r.id === "dept:dept-sec")?.documentIds).toEqual([]);

    // Filtered (Isolate mode, typeCode=GUIDE): Engineering branch still contains only doc-3 (never hidden doc-2).
    const isolated = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      isolateMatching: true,
      crossLinksOn: false,
    });
    expect(isolated.nodes.find((n) => n.id === "dept:dept-eng")?.data.documentIds).toEqual(["doc-3"]);

    // Filtered with focusDocumentIds=["doc-1"]: Security branch pins only the focus-revealed doc-1 (not doc-4).
    const focused = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      focusDocumentIds: ["doc-1"],
      isolateMatching: false,
      crossLinksOn: false,
    });
    expect(focused.nodes.find((n) => n.id === "dept:dept-sec")?.data.documentIds).toEqual(["doc-1"]);
  });

  it("allows manually expanding an auto-collapsed 0-match branch via expandedBranchIds", async () => {
    const payload = makePayload();

    // Auto-collapsed when Security has 0 matches under typeCode=GUIDE.
    const collapsed = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      filters: { typeCode: "GUIDE" },
      isolateMatching: false,
      crossLinksOn: false,
    });
    expect(collapsed.nodes.find((n) => n.id === "dept:dept-sec")?.data.collapsed).toBe(true);
    expect(collapsed.nodes.find((n) => n.id === "type:dept-sec:POLICY_AND_STANDARD")).toBeUndefined();

    // Passing expandedBranchIds overrides autoCollapsed for that branch.
    const expanded = await computeGraphLayout(payload, {
      viewMode: "accountability",
      collapsedBranchIds: new Set(),
      expandedBranchIds: new Set(["dept:dept-sec", "type:dept-sec:POLICY_AND_STANDARD"]),
      filters: { typeCode: "GUIDE" },
      isolateMatching: false,
      crossLinksOn: false,
    });
    expect(expanded.nodes.find((n) => n.id === "dept:dept-sec")?.data.collapsed).toBe(false);
    expect(expanded.nodes.find((n) => n.id === "type:dept-sec:POLICY_AND_STANDARD")?.data.collapsed).toBe(false);
    expect(expanded.nodes.find((n) => n.id === "doc:doc-1")).toBeDefined();
    expect(expanded.nodes.find((n) => n.id === "dept:dept-sec")?.data.documentIds).toEqual([]);
  });
});
