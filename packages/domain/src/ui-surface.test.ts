import { describe, expect, it } from "vitest";
import {
  PROTOTYPE_DENYLIST,
  UI_SURFACE_MAX_COMPACT_BYTES,
  UI_SURFACE_MAX_DEPTH,
  UI_SURFACE_MAX_NODES,
  UI_SURFACE_MAX_PROSE_LENGTH,
  normalizeAndValidateSurface,
  validateStoredBoundSurface,
  type AiSurfaceDraft,
  type AiSurfaceNode,
  type BoundUiSurface,
  type GovernanceFieldKey,
  type MetricKey,
  type SurfaceHandleMap,
} from "./ui-surface.js";

const DOC1 = {
  documentId: "00000000-0000-0000-0000-000000000001",
  publishedVersionId: "10000000-0000-0000-0000-000000000001",
};
const DOC2 = {
  documentId: "00000000-0000-0000-0000-000000000002",
  publishedVersionId: "10000000-0000-0000-0000-000000000002",
};
const DOC3 = {
  documentId: "00000000-0000-0000-0000-000000000003",
  publishedVersionId: "10000000-0000-0000-0000-000000000003",
};
const DEPT1 = "20000000-0000-0000-0000-000000000001";
const COL1 = "30000000-0000-0000-0000-000000000001";

const BASE_HANDLES: SurfaceHandleMap = {
  documents: { D1: DOC1, D2: DOC2, D3: DOC3 },
  departments: { DEPT1 },
  collections: { C1: COL1 },
};

function makeDraft(nodes: AiSurfaceNode[], rootId = "root"): AiSurfaceDraft {
  return { schemaVersion: 1, rootId, nodes };
}

function expectOk(result: ReturnType<typeof normalizeAndValidateSurface>): BoundUiSurface {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.surface;
}

function expectErr(
  result: ReturnType<typeof normalizeAndValidateSurface>,
  expectedCode?: string,
) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failure, got ok");
  if (expectedCode) expect(result.error.code).toBe(expectedCode);
  return result.error;
}

describe("UiSurface v1 validator — valid compositions & handle translation", () => {
  it("accepts the canonical 0-based depth-4 composition stack(0)->tabs(1)->split(2)->card(3)->governance_kv(4)", () => {
    const draft = makeDraft([
      { id: "root", kind: "stack", gap: "md", childIds: ["tabs1"] },
      {
        id: "tabs1",
        kind: "tabs",
        defaultTabId: "compare",
        tabs: [
          { id: "compare", label: "Comparison", childIds: ["split1"] },
          { id: "summary", label: "Summary", childIds: ["p1"] },
        ],
      },
      {
        id: "split1",
        kind: "split",
        leftTitle: "Policy A",
        leftId: "cardL",
        rightTitle: "Policy B",
        rightId: "cardR",
      },
      {
        id: "cardL",
        kind: "card",
        title: "Security Standard",
        bodyIds: ["kvL"],
        footerIds: ["actL"],
      },
      {
        id: "cardR",
        kind: "card",
        title: "Incident Procedure",
        tone: "subtle",
        bodyIds: ["kvR"],
      },
      {
        id: "kvL",
        kind: "governance_kv",
        docRef: "D1",
        fields: ["ownerDepartment", "version", "validUntil", "ownerDepartment"],
      },
      {
        id: "kvR",
        kind: "governance_kv",
        docRef: "D2",
      },
      {
        id: "actL",
        kind: "open_reader",
        label: "Open policy",
        docRef: "D1",
        page: 4,
        blockId: "sec-4-1",
      },
      {
        id: "p1",
        kind: "prose",
        markdown: "Both documents govern incident escalation [1] and disclosure [2].",
      },
    ]);

    const surface = expectOk(normalizeAndValidateSurface(draft, BASE_HANDLES, 2));

    expect(Object.getPrototypeOf(surface.nodes)).toBeNull();
    expect(surface.schemaVersion).toBe(1);
    expect(surface.rootId).toBe("root");
    expect(surface.nodes["kvL"]).toEqual({
      kind: "governance_kv",
      documentId: DOC1.documentId,
      publishedVersionId: DOC1.publishedVersionId,
      fields: ["ownerDepartment", "version", "validUntil"],
    });
    expect(surface.nodes["actL"]).toEqual({
      kind: "open_reader",
      label: "Open policy",
      documentId: DOC1.documentId,
      publishedVersionId: DOC1.publishedVersionId,
      page: 4,
      blockId: "sec-4-1",
    });
    expect(surface.bindings.documents).toEqual([DOC1, DOC2]);
    expect(surface.bindings.citationIndexes).toEqual([1, 2]);

    // Must round-trip through JSON serialization + validateStoredBoundSurface
    const persisted = JSON.parse(JSON.stringify(surface)) as unknown;
    const reloaded = expectOk(validateStoredBoundSurface(persisted, { citationCount: 2 }));
    expect(Object.getPrototypeOf(reloaded.nodes)).toBeNull();
    expect(reloaded.bindings).toEqual(surface.bindings);
  });

  it("accepts card as root with all 7 leaves and all 4 action types including all 5 graph_action ops", () => {
    const draft = makeDraft(
      [
        {
          id: "root",
          kind: "card",
          title: "Governance Overview",
          subtitle: "Verified from published company documents",
          tone: "default",
          bodyIds: ["p1", "sec1", "row1", "tbl1", "call1", "met1", "lin1"],
          footerIds: ["a1", "a2", "a3", "a4"],
        },
        {
          id: "p1",
          kind: "prose",
          markdown: "Expiring <= 30 days and x < y and y > z. Sensitive data: see https://docs.internal/policy [1].",
          citationIndexes: [1, 1],
        },
        {
          id: "sec1",
          kind: "section",
          title: "Graph actions",
          defaultOpen: false,
          childIds: ["g2", "g3", "g4", "g5", "g6", "g7"],
        },
        {
          id: "row1",
          kind: "row",
          columns: 2,
          childIds: ["doc1", "doc2"],
        },
        {
          id: "doc1",
          kind: "document_item",
          docRef: "D1",
          highlightNote: "Primary escalation rule",
        },
        {
          id: "doc2",
          kind: "document_item",
          docRef: "D2",
          highlightNote: null,
        },
        {
          id: "tbl1",
          kind: "comparison_table",
          caption: "SLA Comparison",
          columns: ["Dimension", "Policy A", "Policy B"],
          rows: [
            {
              cells: [
                { text: "Response SLA" },
                { text: "4 hours", citationIndexes: [1] },
                { text: "2 hours", citationIndexes: [2, 2] },
              ],
            },
          ],
        },
        {
          id: "call1",
          kind: "callout",
          tone: "conflict",
          title: "Timeline discrepancy",
          body: "Policy A specifies 4 hours while Policy B requires 2 hours.",
          citationIndexes: [1, 2],
        },
        {
          id: "met1",
          kind: "metric_strip",
          metricKeys: ["MATCHED_DOCS", "EXPIRING_SOON_DOCS", "MATCHED_DOCS"],
        },
        {
          id: "lin1",
          kind: "lineage_tree",
          docRef: "D1",
        },
        {
          id: "a1",
          kind: "graph_action",
          label: "Focus docs",
          action: { op: "focus_nodes", docRefs: ["D1", "D2", "D1"] },
        },
        {
          id: "a2",
          kind: "open_reader",
          label: "Read Policy A",
          docRef: "D1",
          page: 1,
          blockId: null,
        },
        {
          id: "a3",
          kind: "workflow_handoff",
          label: "Report issue",
          handoff: "report_issue",
          docRef: "D1",
        },
        {
          id: "a4",
          kind: "prompt_chip",
          label: "Compare retention",
          prompt: "Compare data retention periods across these two policies.",
        },
        {
          id: "g2",
          kind: "graph_action",
          label: "Filter engineering",
          action: {
            op: "apply_filter",
            departmentRef: "DEPT1",
            collectionRef: "C1",
            typeCode: "POLICY_AND_STANDARD",
            readerScope: "ORGANIZATION",
            validity: "EXPIRING_SOON",
          },
        },
        {
          id: "g3",
          kind: "graph_action",
          label: "Isolate dept",
          action: { op: "isolate_branch", branchKind: "department", branchRef: "DEPT1" },
        },
        {
          id: "g4",
          kind: "graph_action",
          label: "Isolate collection",
          action: { op: "isolate_branch", branchKind: "collection", branchRef: "C1" },
        },
        {
          id: "g5",
          kind: "graph_action",
          label: "Isolate type",
          action: { op: "isolate_branch", branchKind: "type", branchRef: "PROCEDURE" },
        },
        {
          id: "g6",
          kind: "graph_action",
          label: "Show links",
          action: {
            op: "toggle_links",
            enabled: true,
            relationshipTypes: ["REFERENCES", "SUPERSEDES", "REFERENCES"],
          },
        },
        {
          id: "g7",
          kind: "graph_action",
          label: "Pin to context",
          action: { op: "pin_to_context", docRefs: ["D3"] },
        },
      ],
      "root",
    );

    const surface = expectOk(normalizeAndValidateSurface(draft, BASE_HANDLES, 2));

    expect(surface.nodes["met1"]).toEqual({
      kind: "metric_strip",
      metricKeys: ["MATCHED_DOCS", "EXPIRING_SOON_DOCS"],
    });
    expect(surface.nodes["a1"]).toEqual({
      kind: "graph_action",
      label: "Focus docs",
      action: { op: "focus_nodes", documentIds: [DOC1.documentId, DOC2.documentId] },
    });
    expect(surface.nodes["g2"]).toEqual({
      kind: "graph_action",
      label: "Filter engineering",
      action: {
        op: "apply_filter",
        ownerDepartmentId: DEPT1,
        collectionId: COL1,
        typeCode: "POLICY_AND_STANDARD",
        readerScope: "ORGANIZATION",
        validity: "EXPIRING_SOON",
      },
    });
    expect(surface.nodes["g3"]).toEqual({
      kind: "graph_action",
      label: "Isolate dept",
      action: { op: "isolate_branch", branchKind: "department", branchId: DEPT1 },
    });
    expect(surface.nodes["g4"]).toEqual({
      kind: "graph_action",
      label: "Isolate collection",
      action: { op: "isolate_branch", branchKind: "collection", branchId: COL1 },
    });
    expect(surface.nodes["g5"]).toEqual({
      kind: "graph_action",
      label: "Isolate type",
      action: { op: "isolate_branch", branchKind: "type", branchId: "PROCEDURE" },
    });
    expect(surface.nodes["g6"]).toEqual({
      kind: "graph_action",
      label: "Show links",
      action: { op: "toggle_links", enabled: true, relationshipTypes: ["REFERENCES", "SUPERSEDES"] },
    });
    expect(surface.nodes["g7"]).toEqual({
      kind: "graph_action",
      label: "Pin to context",
      action: { op: "pin_to_context", documentIds: [DOC3.documentId] },
    });
    expect(surface.bindings.documents).toEqual([DOC1, DOC2, DOC3]);
    expect(surface.bindings.citationIndexes).toEqual([1, 2]);

    expectOk(validateStoredBoundSurface(JSON.parse(JSON.stringify(surface)), { citationCount: 2 }));
  });

  it("accepts prose up to exactly 12,000 characters and rectangular 1..12-row comparison tables", () => {
    const maxProse = `${"a".repeat(UI_SURFACE_MAX_PROSE_LENGTH - 4)} [1]`;
    expect(maxProse.length).toBe(12_000);

    const proseSurface = expectOk(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: maxProse },
        ]),
        BASE_HANDLES,
        1,
      ),
    );
    expect(proseSurface.bindings.citationIndexes).toEqual([1]);

    const twelveRows = Array.from({ length: 12 }, (_, idx) => ({
      cells: [
        { text: `Item ${idx + 1}` },
        { text: `Rule ${idx + 1}`, citationIndexes: [1] },
      ],
    }));
    const tableSurface = expectOk(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          { id: "t1", kind: "comparison_table", columns: ["Topic", "Rule"], rows: twelveRows },
        ]),
        BASE_HANDLES,
        1,
      ),
    );
    expect(tableSurface.bindings.citationIndexes).toEqual([1]);
  });

  it("allows warning and gap callout tones with 0 citations ONLY when allowCoreCalloutTones is true", () => {
    const gapDraft = makeDraft([
      { id: "root", kind: "stack", childIds: ["c1"] },
      {
        id: "c1",
        kind: "callout",
        tone: "gap",
        title: "Insufficient evidence",
        body: "No authorized published documents answer this question.",
      },
    ]);
    const warningDraft = makeDraft([
      { id: "root", kind: "stack", childIds: ["c1"] },
      {
        id: "c1",
        kind: "callout",
        tone: "warning",
        title: "Expiring policy",
        body: "This policy expires in 7 days.",
      },
    ]);

    expectErr(normalizeAndValidateSurface(gapDraft, BASE_HANDLES, 0), "FORBIDDEN_CALLOUT_TONE");
    expectErr(normalizeAndValidateSurface(warningDraft, BASE_HANDLES, 0), "FORBIDDEN_CALLOUT_TONE");

    const gapSurface = expectOk(
      normalizeAndValidateSurface(gapDraft, BASE_HANDLES, 0, { allowCoreCalloutTones: true }),
    );
    expect(gapSurface.bindings).toEqual({ documents: [], citationIndexes: [] });
    expectOk(validateStoredBoundSurface(JSON.parse(JSON.stringify(gapSurface)), { citationCount: 0 }));

    const warnSurface = expectOk(
      normalizeAndValidateSurface(warningDraft, BASE_HANDLES, 0, { allowCoreCalloutTones: true }),
    );
    expectOk(validateStoredBoundSurface(JSON.parse(JSON.stringify(warnSurface)), { citationCount: 0 }));
  });

  it("accepts exactly 32 nodes at maximum capacity", () => {
    const nodes: AiSurfaceNode[] = [
      { id: "root", kind: "stack", childIds: ["s1", "s2", "s3"] },
      { id: "s1", kind: "stack", childIds: Array.from({ length: 10 }, (_, i) => `p1_${i}`) },
      { id: "s2", kind: "stack", childIds: Array.from({ length: 10 }, (_, i) => `p2_${i}`) },
      { id: "s3", kind: "stack", childIds: Array.from({ length: 8 }, (_, i) => `p3_${i}`) },
    ];
    for (let i = 0; i < 10; i++) nodes.push({ id: `p1_${i}`, kind: "prose", markdown: `Line ${i}` });
    for (let i = 0; i < 10; i++) nodes.push({ id: `p2_${i}`, kind: "prose", markdown: `Line ${i}` });
    for (let i = 0; i < 8; i++) nodes.push({ id: `p3_${i}`, kind: "prose", markdown: `Line ${i}` });
    expect(nodes.length).toBe(UI_SURFACE_MAX_NODES);

    const surface = expectOk(normalizeAndValidateSurface(makeDraft(nodes), BASE_HANDLES, 0));
    expect(Object.keys(surface.nodes)).toHaveLength(32);
  });
});

describe("UiSurface v1 validator — tree, depth & ancestor-invariant rejections", () => {
  it("rejects non-stack/non-card root kinds", () => {
    const badRoots: AiSurfaceNode[] = [
      { id: "root", kind: "prose", markdown: "Hello" },
      { id: "root", kind: "row", childIds: ["p1"] },
      { id: "root", kind: "section", title: "Sec", childIds: ["p1"] },
      {
        id: "root",
        kind: "tabs",
        defaultTabId: "a",
        tabs: [
          { id: "a", label: "A", childIds: ["p1"] },
          { id: "b", label: "B", childIds: ["p2"] },
        ],
      },
      { id: "root", kind: "split", leftId: "p1", rightId: "p2" },
      { id: "root", kind: "callout", tone: "info", title: "Info", body: "Body", citationIndexes: [1] },
      { id: "root", kind: "prompt_chip", label: "Ask", prompt: "Ask more" },
    ];

    for (const root of badRoots) {
      const extra: AiSurfaceNode[] =
        root.kind === "row" || root.kind === "section"
          ? [{ id: "p1", kind: "prose", markdown: "x" }]
          : root.kind === "tabs" || root.kind === "split"
            ? [
                { id: "p1", kind: "prose", markdown: "x" },
                { id: "p2", kind: "prose", markdown: "y" },
              ]
            : [];
      expectErr(normalizeAndValidateSurface(makeDraft([root, ...extra]), BASE_HANDLES, 1), "INVALID_ROOT");
    }
  });

  it("rejects depth 5 (both via tabs+split+card+section+prose and nested stacks)", () => {
    const depth5ViaTabs = makeDraft([
      { id: "root", kind: "stack", childIds: ["t1"] },
      {
        id: "t1",
        kind: "tabs",
        defaultTabId: "a",
        tabs: [
          { id: "a", label: "A", childIds: ["sp1"] },
          { id: "b", label: "B", childIds: ["pb"] },
        ],
      },
      { id: "pb", kind: "prose", markdown: "Tab B" },
      { id: "sp1", kind: "split", leftId: "c1", rightId: "pr" },
      { id: "pr", kind: "prose", markdown: "Right" },
      { id: "c1", kind: "card", bodyIds: ["sec1"] },
      { id: "sec1", kind: "section", title: "Too deep", childIds: ["leaf"] },
      { id: "leaf", kind: "prose", markdown: "Depth 5" },
    ]);
    expectErr(normalizeAndValidateSurface(depth5ViaTabs, BASE_HANDLES, 0), "DEPTH_LIMIT_EXCEEDED");

    const depth5ViaStacks = makeDraft([
      { id: "root", kind: "stack", childIds: ["s1"] },
      { id: "s1", kind: "stack", childIds: ["s2"] },
      { id: "s2", kind: "stack", childIds: ["s3"] },
      { id: "s3", kind: "stack", childIds: ["s4"] },
      { id: "s4", kind: "stack", childIds: ["leaf"] },
      { id: "leaf", kind: "prose", markdown: "Depth 5" },
    ]);
    expectErr(normalizeAndValidateSurface(depth5ViaStacks, BASE_HANDLES, 0), "DEPTH_LIMIT_EXCEEDED");
    expect(UI_SURFACE_MAX_DEPTH).toBe(4);
  });

  it("rejects cycles, DAG diamond reuse, duplicate childIds, and orphan nodes", () => {
    // Self-cycle
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([{ id: "root", kind: "stack", childIds: ["root"] }]),
        BASE_HANDLES,
        0,
      ),
      "CYCLE_OR_REUSED_NODE",
    );

    // 2-node cycle
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["s1"] },
          { id: "s1", kind: "stack", childIds: ["root"] },
        ]),
        BASE_HANDLES,
        0,
      ),
      "CYCLE_OR_REUSED_NODE",
    );

    // DAG diamond reuse
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["s1", "s2"] },
          { id: "s1", kind: "stack", childIds: ["shared"] },
          { id: "s2", kind: "stack", childIds: ["shared"] },
          { id: "shared", kind: "prose", markdown: "Shared leaf" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "CYCLE_OR_REUSED_NODE",
    );

    // Split reusing same child on left and right
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sp1"] },
          { id: "sp1", kind: "split", leftId: "p1", rightId: "p1" },
          { id: "p1", kind: "prose", markdown: "Both sides" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "CYCLE_OR_REUSED_NODE",
    );

    // Orphan node
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Reachable" },
          { id: "orphan", kind: "prose", markdown: "Unreachable" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "ORPHAN_NODE",
    );

    // Disconnected cycle (orphan cycle)
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Reachable" },
          { id: "c1", kind: "stack", childIds: ["c2"] },
          { id: "c2", kind: "stack", childIds: ["c1"] },
        ]),
        BASE_HANDLES,
        0,
      ),
      "ORPHAN_NODE",
    );
  });

  it("rejects > 32 nodes", () => {
    const nodes: AiSurfaceNode[] = [
      { id: "root", kind: "stack", childIds: ["s1", "s2", "s3"] },
      { id: "s1", kind: "stack", childIds: Array.from({ length: 10 }, (_, i) => `a${i}`) },
      { id: "s2", kind: "stack", childIds: Array.from({ length: 10 }, (_, i) => `b${i}`) },
      { id: "s3", kind: "stack", childIds: Array.from({ length: 9 }, (_, i) => `c${i}`) },
    ];
    for (let i = 0; i < 10; i++) nodes.push({ id: `a${i}`, kind: "prose", markdown: `a${i}` });
    for (let i = 0; i < 10; i++) nodes.push({ id: `b${i}`, kind: "prose", markdown: `b${i}` });
    for (let i = 0; i < 9; i++) nodes.push({ id: `c${i}`, kind: "prose", markdown: `c${i}` });
    expect(nodes.length).toBe(33);

    expectErr(normalizeAndValidateSurface(makeDraft(nodes), BASE_HANDLES, 0), "NODE_LIMIT_EXCEEDED");
  });

  it("enforces ancestor-invariant container bans across full subtrees (direct and indirect)", () => {
    // card -> stack -> card
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "card", bodyIds: ["mid"] },
          { id: "mid", kind: "stack", childIds: ["inner"] },
          { id: "inner", kind: "card", bodyIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Nested card" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // section -> card -> section
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sec1"] },
          { id: "sec1", kind: "section", title: "Outer", childIds: ["c1"] },
          { id: "c1", kind: "card", bodyIds: ["sec2"] },
          { id: "sec2", kind: "section", title: "Inner", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Nested section" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // tabs -> stack -> tabs
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "a",
            tabs: [
              { id: "a", label: "A", childIds: ["mid"] },
              { id: "b", label: "B", childIds: ["pb"] },
            ],
          },
          { id: "pb", kind: "prose", markdown: "B" },
          { id: "mid", kind: "stack", childIds: ["t2"] },
          {
            id: "t2",
            kind: "tabs",
            defaultTabId: "x",
            tabs: [
              { id: "x", label: "X", childIds: ["px"] },
              { id: "y", label: "Y", childIds: ["py"] },
            ],
          },
          { id: "px", kind: "prose", markdown: "X" },
          { id: "py", kind: "prose", markdown: "Y" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // section -> card -> tabs
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sec1"] },
          { id: "sec1", kind: "section", title: "S", childIds: ["c1"] },
          { id: "c1", kind: "card", bodyIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "a",
            tabs: [
              { id: "a", label: "A", childIds: ["pa"] },
              { id: "b", label: "B", childIds: ["pb"] },
            ],
          },
          { id: "pa", kind: "prose", markdown: "A" },
          { id: "pb", kind: "prose", markdown: "B" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // row -> card -> tabs
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["r1"] },
          { id: "r1", kind: "row", childIds: ["c1"] },
          { id: "c1", kind: "card", bodyIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "a",
            tabs: [
              { id: "a", label: "A", childIds: ["pa"] },
              { id: "b", label: "B", childIds: ["pb"] },
            ],
          },
          { id: "pa", kind: "prose", markdown: "A" },
          { id: "pb", kind: "prose", markdown: "B" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // split -> card -> tabs
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sp1"] },
          { id: "sp1", kind: "split", leftId: "c1", rightId: "pr" },
          { id: "pr", kind: "prose", markdown: "Right" },
          { id: "c1", kind: "card", bodyIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "a",
            tabs: [
              { id: "a", label: "A", childIds: ["pa"] },
              { id: "b", label: "B", childIds: ["pb"] },
            ],
          },
          { id: "pa", kind: "prose", markdown: "A" },
          { id: "pb", kind: "prose", markdown: "B" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // split -> stack -> split
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sp1"] },
          { id: "sp1", kind: "split", leftId: "mid", rightId: "pr" },
          { id: "pr", kind: "prose", markdown: "R" },
          { id: "mid", kind: "stack", childIds: ["sp2"] },
          { id: "sp2", kind: "split", leftId: "p1", rightId: "p2" },
          { id: "p1", kind: "prose", markdown: "1" },
          { id: "p2", kind: "prose", markdown: "2" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // row -> card -> split
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["r1"] },
          { id: "r1", kind: "row", childIds: ["c1"] },
          { id: "c1", kind: "card", bodyIds: ["sp1"] },
          { id: "sp1", kind: "split", leftId: "p1", rightId: "p2" },
          { id: "p1", kind: "prose", markdown: "1" },
          { id: "p2", kind: "prose", markdown: "2" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // row -> stack -> row
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["r1"] },
          { id: "r1", kind: "row", childIds: ["mid"] },
          { id: "mid", kind: "stack", childIds: ["r2"] },
          { id: "r2", kind: "row", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Nested row" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "FORBIDDEN_NESTING",
    );

    // row -> card -> comparison_table
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["r1"] },
          { id: "r1", kind: "row", childIds: ["c1"] },
          { id: "c1", kind: "card", bodyIds: ["tbl1"] },
          {
            id: "tbl1",
            kind: "comparison_table",
            columns: ["A", "B"],
            rows: [{ cells: [{ text: "x", citationIndexes: [1] }, { text: "y" }] }],
          },
        ]),
        BASE_HANDLES,
        1,
      ),
      "FORBIDDEN_NESTING",
    );

    // split -> card -> comparison_table
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["sp1"] },
          { id: "sp1", kind: "split", leftId: "c1", rightId: "pr" },
          { id: "pr", kind: "prose", markdown: "R" },
          { id: "c1", kind: "card", bodyIds: ["tbl1"] },
          {
            id: "tbl1",
            kind: "comparison_table",
            columns: ["A", "B"],
            rows: [{ cells: [{ text: "x", citationIndexes: [1] }, { text: "y" }] }],
          },
        ]),
        BASE_HANDLES,
        1,
      ),
      "FORBIDDEN_NESTING",
    );
  });

  it("rejects non-action primitives in card.footerIds", () => {
    const nonActions: AiSurfaceNode[] = [
      { id: "f1", kind: "prose", markdown: "Not an action" },
      { id: "f1", kind: "document_item", docRef: "D1" },
      { id: "f1", kind: "metric_strip", metricKeys: ["MATCHED_DOCS"] },
      { id: "f1", kind: "callout", tone: "info", title: "T", body: "B", citationIndexes: [1] },
    ];
    for (const badFooter of nonActions) {
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "card", bodyIds: ["p1"], footerIds: ["f1"] },
            { id: "p1", kind: "prose", markdown: "Body" },
            badFooter,
          ]),
          BASE_HANDLES,
          1,
        ),
        "INVALID_FOOTER_NODE",
      );
    }
  });
});

describe("UiSurface v1 validator — security, prototype pollution, handles & bounds", () => {
  it("rejects every PROTOTYPE_DENYLIST key as nodeId, rootId, tab.id, or handle ref", () => {
    for (const forbidden of PROTOTYPE_DENYLIST) {
      // As child node ID
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: [forbidden] },
            { id: forbidden, kind: "prose", markdown: "Evil" },
          ]),
          BASE_HANDLES,
          0,
        ),
        "INVALID_NODE_ID",
      );

      // As rootId
      expectErr(
        normalizeAndValidateSurface(
          makeDraft(
            [
              { id: forbidden, kind: "stack", childIds: ["p1"] },
              { id: "p1", kind: "prose", markdown: "Evil" },
            ],
            forbidden,
          ),
          BASE_HANDLES,
          0,
        ),
        "INVALID_NODE_ID",
      );

      // As docRef handle
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["d1"] },
            { id: "d1", kind: "document_item", docRef: forbidden },
          ]),
          BASE_HANDLES,
          0,
        ),
        "UNKNOWN_HANDLE",
      );
    }
  });

  it("rejects JSON.parse own __proto__ keys and forged prototype chains in validateStoredBoundSurface", () => {
    const rawWithProto = JSON.parse(
      `{
        "schemaVersion": 1,
        "rootId": "root",
        "nodes": {
          "root": { "kind": "stack", "childIds": ["__proto__"] },
          "__proto__": { "kind": "prose", "markdown": "polluted" }
        },
        "bindings": { "documents": [], "citationIndexes": [] }
      }`,
    ) as unknown;
    expectErr(validateStoredBoundSurface(rawWithProto), "INVALID_NODE_ID");

    // Inherited node via custom prototype chain
    const inheritedNodes = Object.create({
      p1: { kind: "prose", markdown: "inherited" },
    }) as Record<string, unknown>;
    inheritedNodes["root"] = { kind: "stack", childIds: ["p1"] };
    expectErr(
      validateStoredBoundSurface({
        schemaVersion: 1,
        rootId: "root",
        nodes: inheritedNodes,
        bindings: { documents: [], citationIndexes: [] },
      }),
      "INVALID_SHAPE",
    );

    // Inherited handle in handleMap is never trusted
    const protoHandleMap: SurfaceHandleMap = {
      documents: Object.create({ D1: DOC1 }) as SurfaceHandleMap["documents"],
    };
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["d1"] },
          { id: "d1", kind: "document_item", docRef: "D1" },
        ]),
        protoHandleMap,
        0,
      ),
      "UNKNOWN_HANDLE",
    );
  });

  it("rejects unknown opaque handles and raw UUIDs passed in place of handles", () => {
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["d1"] },
          { id: "d1", kind: "document_item", docRef: "D99" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "UNKNOWN_HANDLE",
    );

    // Passing a real UUID instead of an opaque handle must fail!
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["d1"] },
          { id: "d1", kind: "document_item", docRef: DOC1.documentId },
        ]),
        BASE_HANDLES,
        0,
      ),
      "UNKNOWN_HANDLE",
    );

    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["g1"] },
          {
            id: "g1",
            kind: "graph_action",
            label: "Bad dept",
            action: { op: "apply_filter", departmentRef: "DEPT99" },
          },
        ]),
        BASE_HANDLES,
        0,
      ),
      "UNKNOWN_HANDLE",
    );

    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["g1"] },
          {
            id: "g1",
            kind: "graph_action",
            label: "Bad col",
            action: { op: "isolate_branch", branchKind: "collection", branchRef: "C99" },
          },
        ]),
        BASE_HANDLES,
        0,
      ),
      "UNKNOWN_HANDLE",
    );

    // apply_filter forbids EXPIRED validity and forbids empty filter
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["g1"] },
          {
            id: "g1",
            kind: "graph_action",
            label: "Expired",
            action: { op: "apply_filter", validity: "EXPIRED" as unknown as "CURRENT" },
          },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["g1"] },
          {
            id: "g1",
            kind: "graph_action",
            label: "Empty",
            action: { op: "apply_filter" },
          },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );
  });

  it("rejects invalid inline citations, uncited or 0-row comparison tables, invalid callouts, tabs, pages & bounds", () => {
    // Inline citation out of range
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Fabricated source [3]." },
        ]),
        BASE_HANDLES,
        2,
      ),
      "INVALID_CITATION",
    );
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Zero citation [0]." },
        ]),
        BASE_HANDLES,
        2,
      ),
      "INVALID_CITATION",
    );

    // Prose > 12,000 chars
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "a".repeat(12_001) },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );

    // 0-row comparison table
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          { id: "t1", kind: "comparison_table", columns: ["A", "B"], rows: [] },
        ]),
        BASE_HANDLES,
        1,
      ),
      "INVALID_FIELD_VALUE",
    );

    // Uncited row in comparison table
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "comparison_table",
            columns: ["A", "B"],
            rows: [
              { cells: [{ text: "Cited", citationIndexes: [1] }, { text: "OK" }] },
              { cells: [{ text: "Uncited" }, { text: "Fabricated" }] },
            ],
          },
        ]),
        BASE_HANDLES,
        1,
      ),
      "UNCITED_TABLE_ROW",
    );

    // Non-rectangular comparison table
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "comparison_table",
            columns: ["A", "B"],
            rows: [{ cells: [{ text: "Only 1 cell", citationIndexes: [1] }] }],
          },
        ]),
        BASE_HANDLES,
        1,
      ),
      "INVALID_FIELD_VALUE",
    );

    // LLM info callout without citationIndexes
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["c1"] },
          { id: "c1", kind: "callout", tone: "info", title: "Note", body: "Uncited claim." },
        ]),
        BASE_HANDLES,
        1,
      ),
      "INVALID_CITATION",
    );

    // Duplicate tab IDs and missing defaultTabId
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "dup",
            tabs: [
              { id: "dup", label: "One", childIds: ["p1"] },
              { id: "dup", label: "Two", childIds: ["p2"] },
            ],
          },
          { id: "p1", kind: "prose", markdown: "1" },
          { id: "p2", kind: "prose", markdown: "2" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "tabs",
            defaultTabId: "missing",
            tabs: [
              { id: "a", label: "One", childIds: ["p1"] },
              { id: "b", label: "Two", childIds: ["p2"] },
            ],
          },
          { id: "p1", kind: "prose", markdown: "1" },
          { id: "p2", kind: "prose", markdown: "2" },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );

    // open_reader.page bounds
    for (const badPage of [0, -1, 1.5, 100_001]) {
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["a1"] },
            { id: "a1", kind: "open_reader", label: "Open", docRef: "D1", page: badPage },
          ]),
          BASE_HANDLES,
          0,
        ),
        "INVALID_FIELD_VALUE",
      );
    }

    // metric_strip empty or unknown key
    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["m1"] },
          { id: "m1", kind: "metric_strip", metricKeys: [] },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );
  });

  it("rejects raw HTML tags and script/event-handler payloads everywhere", () => {
    const xssPayloads = [
      "<script>alert(1)</script>",
      "<script src='x'>",
      "<iframe src='https://evil.test'>",
      "<img src=x onerror=alert(1)>",
      "<svg onload=alert(1)>",
      "Click onclick=alert(1)",
      "javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "<a href=\"x\">link</a>",
      "<!-- hidden -->",
    ];

    for (const payload of xssPayloads) {
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["p1"] },
            { id: "p1", kind: "prose", markdown: payload },
          ]),
          BASE_HANDLES,
          0,
        ),
        "UNSAFE_CONTENT",
      );

      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "card", title: payload, bodyIds: ["p1"] },
            { id: "p1", kind: "prose", markdown: "Safe body" },
          ]),
          BASE_HANDLES,
          0,
        ),
        "UNSAFE_CONTENT",
      );
    }
  });

  it("rejects arbitrary URLs in non-prose and action fields", () => {
    const urls = [
      "https://evil.example/phish",
      "http://169.254.169.254/latest",
      "file:///C:/Windows/win.ini",
      "ftp://attacker.example/file",
      "mailto:phish@evil.example",
      "tel:+15551234567",
      "//evil.example/redirect",
    ];

    for (const url of urls) {
      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["d1"] },
            { id: "d1", kind: "document_item", docRef: "D1", highlightNote: `See ${url}` },
          ]),
          BASE_HANDLES,
          0,
        ),
        "UNSAFE_CONTENT",
      );

      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["a1"] },
            { id: "a1", kind: "prompt_chip", label: "Check", prompt: `Open ${url}` },
          ]),
          BASE_HANDLES,
          0,
        ),
        "UNSAFE_CONTENT",
      );

      expectErr(
        normalizeAndValidateSurface(
          makeDraft([
            { id: "root", kind: "stack", childIds: ["t1"] },
            {
              id: "t1",
              kind: "comparison_table",
              columns: ["Source", "Rule"],
              rows: [{ cells: [{ text: url, citationIndexes: [1] }, { text: "OK" }] }],
            },
          ]),
          BASE_HANDLES,
          1,
        ),
        "UNSAFE_CONTENT",
      );
    }
  });

  it("enforces the 48,000 compact UTF-8 byte ceiling (including multi-byte characters)", () => {
    // 5 prose nodes x 10,000 ASCII chars > 48,000 bytes
    const overAscii = makeDraft([
      { id: "root", kind: "stack", childIds: ["p1", "p2", "p3", "p4", "p5"] },
      { id: "p1", kind: "prose", markdown: "a".repeat(10_000) },
      { id: "p2", kind: "prose", markdown: "b".repeat(10_000) },
      { id: "p3", kind: "prose", markdown: "c".repeat(10_000) },
      { id: "p4", kind: "prose", markdown: "d".repeat(10_000) },
      { id: "p5", kind: "prose", markdown: "e".repeat(10_000) },
    ]);
    expectErr(normalizeAndValidateSurface(overAscii, BASE_HANDLES, 0), "BYTE_LIMIT_EXCEEDED");

    // 2 prose nodes x 9,000 3-byte Vietnamese chars = 54,000 UTF-8 bytes (> 48,000) even though char count is 18,000!
    const overUtf8 = makeDraft([
      { id: "root", kind: "stack", childIds: ["p1", "p2"] },
      { id: "p1", kind: "prose", markdown: "ệ".repeat(9_000) },
      { id: "p2", kind: "prose", markdown: "ệ".repeat(9_000) },
    ]);
    expectErr(normalizeAndValidateSurface(overUtf8, BASE_HANDLES, 0), "BYTE_LIMIT_EXCEEDED");
    expect(UI_SURFACE_MAX_COMPACT_BYTES).toBe(48_000);
  });

  it("rejects tampered stored BoundUiSurface bindings, untranslated handles, and citation drift", () => {
    const validSurface = expectOk(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["p1", "d1"] },
          { id: "p1", kind: "prose", markdown: "Grounded claim [1]." },
          { id: "d1", kind: "document_item", docRef: "D1" },
        ]),
        BASE_HANDLES,
        1,
      ),
    );
    const clone = () => JSON.parse(JSON.stringify(validSurface)) as BoundUiSurface;

    // Missing document in bindings
    const missingDoc = clone();
    missingDoc.bindings.documents = [];
    expectErr(validateStoredBoundSurface(missingDoc, { citationCount: 1 }), "BINDINGS_MISMATCH");

    // Extra phantom document in bindings
    const extraDoc = clone();
    extraDoc.bindings.documents.push(DOC2);
    expectErr(validateStoredBoundSurface(extraDoc, { citationCount: 1 }), "BINDINGS_MISMATCH");

    // Missing citation in bindings
    const missingCit = clone();
    missingCit.bindings.citationIndexes = [];
    expectErr(validateStoredBoundSurface(missingCit, { citationCount: 1 }), "BINDINGS_MISMATCH");

    // Extra citation in bindings
    const extraCit = clone();
    extraCit.bindings.citationIndexes = [1, 2];
    expectErr(validateStoredBoundSurface(extraCit, { citationCount: 2 }), "BINDINGS_MISMATCH");

    // Citation exceeds provided citationCount on reload
    expectErr(validateStoredBoundSurface(clone(), { citationCount: 0 }), "INVALID_CITATION");

    // Untranslated opaque handle in stored documentId
    const badUuid = clone();
    (badUuid.nodes["d1"] as { documentId: string }).documentId = "D1";
    badUuid.bindings.documents[0]!.documentId = "D1";
    expectErr(validateStoredBoundSurface(badUuid, { citationCount: 1 }), "INVALID_FIELD_VALUE");

    // focus_nodes-only surface round-trips cleanly and rejects missing bindings
    const focusOnly = expectOk(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["a1"] },
          { id: "a1", kind: "graph_action", label: "Focus", action: { op: "focus_nodes", docRefs: ["D1"] } },
        ]),
        BASE_HANDLES,
        0,
      ),
    );
    expect(focusOnly.bindings.documents).toEqual([DOC1]);
    expectOk(validateStoredBoundSurface(JSON.parse(JSON.stringify(focusOnly)), { citationCount: 0 }));

    const missingFocusBinding = JSON.parse(JSON.stringify(focusOnly)) as BoundUiSurface;
    missingFocusBinding.bindings.documents = [];
    expectErr(validateStoredBoundSurface(missingFocusBinding, { citationCount: 0 }), "BINDINGS_MISMATCH");
  });

  it("enforces max 8 bound documents and rejects empty toggle_links.relationshipTypes", () => {
    const nineHandles: SurfaceHandleMap = {
      documents: Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [
          `D${i + 1}`,
          {
            documentId: `00000000-0000-0000-0000-00000000000${i + 1}`,
            publishedVersionId: `10000000-0000-0000-0000-00000000000${i + 1}`,
          },
        ]),
      ),
    };
    const nineDocNodes: AiSurfaceNode[] = [
      { id: "root", kind: "stack", childIds: Array.from({ length: 9 }, (_, i) => `d${i + 1}`) },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `d${i + 1}`,
        kind: "document_item" as const,
        docRef: `D${i + 1}`,
      })),
    ];
    expectErr(normalizeAndValidateSurface(makeDraft(nineDocNodes), nineHandles, 0), "DOCUMENT_LIMIT_EXCEEDED");

    expectErr(
      normalizeAndValidateSurface(
        makeDraft([
          { id: "root", kind: "stack", childIds: ["g1"] },
          {
            id: "g1",
            kind: "graph_action",
            label: "Toggle",
            action: { op: "toggle_links", enabled: true, relationshipTypes: [] },
          },
        ]),
        BASE_HANDLES,
        0,
      ),
      "INVALID_FIELD_VALUE",
    );
  });
});

describe("UiSurface v1 validator — deterministic adversarial fuzz suite", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ALL_GOV_FIELDS: GovernanceFieldKey[] = [
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
  ];
  const ALL_METRICS: MetricKey[] = [
    "MATCHED_DOCS",
    "EXPIRING_SOON_DOCS",
    "OPEN_MAINTENANCE_CASES",
    "DISTINCT_OWNER_DEPTS",
  ];

  function generateValidDraft(rand: () => number): AiSurfaceDraft {
    const nodes: AiSurfaceNode[] = [];
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${++counter}`;
    const docRefs = ["D1", "D2", "D3"];
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

    function makeAction(): string {
      const id = nextId("act");
      const kind = pick(["graph_action", "open_reader", "workflow_handoff", "prompt_chip"] as const);
      if (kind === "graph_action") {
        nodes.push({
          id,
          kind: "graph_action",
          label: "Focus doc",
          action: { op: "focus_nodes", docRefs: [pick(docRefs)] },
        });
      } else if (kind === "open_reader") {
        nodes.push({
          id,
          kind: "open_reader",
          label: "Open reader",
          docRef: pick(docRefs),
          page: 1 + Math.floor(rand() * 20),
        });
      } else if (kind === "workflow_handoff") {
        nodes.push({
          id,
          kind: "workflow_handoff",
          label: "Renew",
          handoff: pick(["report_issue", "open_maintenance_case", "open_renewal"] as const),
          docRef: pick(docRefs),
        });
      } else {
        nodes.push({
          id,
          kind: "prompt_chip",
          label: "Follow up",
          prompt: "Explain this requirement in detail.",
        });
      }
      return id;
    }

    function makeLeaf(ancestors: Set<string>): string {
      const id = nextId("leaf");
      const allowedLeaves: Array<
        "prose" | "document_item" | "governance_kv" | "comparison_table" | "callout" | "metric_strip" | "lineage_tree"
      > = ["prose", "document_item", "governance_kv", "callout", "metric_strip", "lineage_tree"];
      if (!ancestors.has("row") && !ancestors.has("split")) {
        allowedLeaves.push("comparison_table");
      }
      const kind = pick(allowedLeaves);
      switch (kind) {
        case "prose":
          nodes.push({ id, kind: "prose", markdown: `Grounded fact [${1 + Math.floor(rand() * 3)}].` });
          break;
        case "document_item":
          nodes.push({ id, kind: "document_item", docRef: pick(docRefs), highlightNote: "Relevant rule" });
          break;
        case "governance_kv":
          nodes.push({ id, kind: "governance_kv", docRef: pick(docRefs), fields: [pick(ALL_GOV_FIELDS)] });
          break;
        case "comparison_table":
          nodes.push({
            id,
            kind: "comparison_table",
            columns: ["Field", "Value"],
            rows: [{ cells: [{ text: "Rule" }, { text: "Mandatory", citationIndexes: [1] }] }],
          });
          break;
        case "callout":
          nodes.push({
            id,
            kind: "callout",
            tone: pick(["info", "conflict"] as const),
            title: "Verified note",
            body: "Supported by published policy.",
            citationIndexes: [1],
          });
          break;
        case "metric_strip":
          nodes.push({ id, kind: "metric_strip", metricKeys: [pick(ALL_METRICS)] });
          break;
        case "lineage_tree":
          nodes.push({ id, kind: "lineage_tree", docRef: pick(docRefs) });
          break;
      }
      return id;
    }

    function buildNode(depth: number, ancestors: Set<string>, isRoot: boolean): string {
      if (!isRoot && (depth >= 4 || nodes.length >= 20 || rand() < 0.45)) {
        return rand() < 0.25 ? makeAction() : makeLeaf(ancestors);
      }

      const id = isRoot ? "root" : nextId("ctr");
      const candidates: Array<"stack" | "card" | "row" | "section" | "tabs" | "split"> = isRoot
        ? ["stack", "card"]
        : ["stack"];
      if (!isRoot) {
        if (!ancestors.has("card")) candidates.push("card");
        if (!ancestors.has("section")) candidates.push("section");
        if (!ancestors.has("row")) candidates.push("row");
        if (!ancestors.has("split") && !ancestors.has("row")) candidates.push("split");
        if (!ancestors.has("tabs") && !ancestors.has("section") && !ancestors.has("row") && !ancestors.has("split")) {
          candidates.push("tabs");
        }
      }

      const kind = pick(candidates);
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(kind);

      // Reserve placeholder slot so root stays valid; push node after children are built
      if (kind === "stack") {
        const count = depth >= 3 ? 1 : 1 + Math.floor(rand() * 2);
        const childIds = Array.from({ length: count }, () => buildNode(depth + 1, nextAncestors, false));
        nodes.push({ id, kind: "stack", gap: pick(["sm", "md"] as const), childIds });
      } else if (kind === "card") {
        const bodyIds = [buildNode(depth + 1, nextAncestors, false)];
        const footerIds = nodes.length < 24 && rand() < 0.5 ? [makeAction()] : undefined;
        nodes.push({ id, kind: "card", title: "Card", bodyIds, ...(footerIds ? { footerIds } : {}) });
      } else if (kind === "section") {
        const childIds = [buildNode(depth + 1, nextAncestors, false)];
        nodes.push({ id, kind: "section", title: "Details", childIds });
      } else if (kind === "row") {
        const childIds = [buildNode(depth + 1, nextAncestors, false)];
        nodes.push({ id, kind: "row", columns: 2, childIds });
      } else if (kind === "split") {
        const leftId = buildNode(depth + 1, nextAncestors, false);
        const rightId = buildNode(depth + 1, nextAncestors, false);
        nodes.push({ id, kind: "split", leftId, rightId });
      } else {
        const aId = buildNode(depth + 1, nextAncestors, false);
        const bId = buildNode(depth + 1, nextAncestors, false);
        nodes.push({
          id,
          kind: "tabs",
          defaultTabId: "t1",
          tabs: [
            { id: "t1", label: "First", childIds: [aId] },
            { id: "t2", label: "Second", childIds: [bId] },
          ],
        });
      }
      return id;
    }

    buildNode(0, new Set(), true);
    return makeDraft(nodes, "root");
  }

  it("accepts 100 randomly generated valid grammar-compliant trees and round-trips every one", () => {
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < 100; i++) {
      const draft = generateValidDraft(rand);
      const surface = expectOk(normalizeAndValidateSurface(draft, BASE_HANDLES, 3));
      const reloaded = expectOk(
        validateStoredBoundSurface(JSON.parse(JSON.stringify(surface)), { citationCount: 3 }),
      );
      expect(reloaded.bindings).toEqual(surface.bindings);
    }
  });

  it("rejects 100% of adversarially mutated drafts across all attack categories", () => {
    const rand = mulberry32(0xbadf00d);
    for (let i = 0; i < 40; i++) {
      const base = generateValidDraft(rand);
      const attack = i % 8;

      if (attack === 0) {
        // Inject orphan node
        base.nodes.push({ id: "sneaky_orphan", kind: "prose", markdown: "Hidden" });
        expectErr(normalizeAndValidateSurface(base, BASE_HANDLES, 3), "ORPHAN_NODE");
      } else if (attack === 1) {
        // Inject unknown handle
        const mutated = makeDraft([
          { id: "root", kind: "stack", childIds: ["bad_doc"] },
          { id: "bad_doc", kind: "document_item", docRef: `D${10 + i}` },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "UNKNOWN_HANDLE");
      } else if (attack === 2) {
        // Inject HTML script tag
        const mutated = makeDraft([
          { id: "root", kind: "stack", childIds: ["xss"] },
          { id: "xss", kind: "prose", markdown: `Hello <img src=x onerror=alert(${i})>` },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "UNSAFE_CONTENT");
      } else if (attack === 3) {
        // Inject URL into non-prose field
        const mutated = makeDraft([
          { id: "root", kind: "card", title: `Visit https://evil-${i}.example`, bodyIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Safe" },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "UNSAFE_CONTENT");
      } else if (attack === 4) {
        // Indirect card -> stack -> section -> card nesting bypass
        const mutated = makeDraft([
          { id: "root", kind: "card", bodyIds: ["s1"] },
          { id: "s1", kind: "stack", childIds: ["sec1"] },
          { id: "sec1", kind: "section", title: "Bypass", childIds: ["c2"] },
          { id: "c2", kind: "card", bodyIds: ["p1"] },
          { id: "p1", kind: "prose", markdown: "Bypassed" },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "FORBIDDEN_NESTING");
      } else if (attack === 5) {
        // Uncited table row
        const mutated = makeDraft([
          { id: "root", kind: "stack", childIds: ["t1"] },
          {
            id: "t1",
            kind: "comparison_table",
            columns: ["A", "B"],
            rows: [{ cells: [{ text: `Row ${i}` }, { text: "No citation" }] }],
          },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "UNCITED_TABLE_ROW");
      } else if (attack === 6) {
        // Prototype key as node ID
        const mutated = makeDraft([
          { id: "root", kind: "stack", childIds: ["constructor"] },
          { id: "constructor", kind: "prose", markdown: "Pollute" },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "INVALID_NODE_ID");
      } else {
        // Depth 5 chain
        const mutated = makeDraft([
          { id: "root", kind: "stack", childIds: ["d1"] },
          { id: "d1", kind: "stack", childIds: ["d2"] },
          { id: "d2", kind: "stack", childIds: ["d3"] },
          { id: "d3", kind: "stack", childIds: ["d4"] },
          { id: "d4", kind: "stack", childIds: ["d5"] },
          { id: "d5", kind: "prose", markdown: `Depth 5 case ${i}` },
        ]);
        expectErr(normalizeAndValidateSurface(mutated, BASE_HANDLES, 3), "DEPTH_LIMIT_EXCEEDED");
      }
    }
  });
});
