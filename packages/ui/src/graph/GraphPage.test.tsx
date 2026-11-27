// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentId,
  GraphDocumentNode,
  GraphRelationshipEdge,
  KnowledgeGraphPayload,
  PublishedVersionId,
} from "@arden/domain";
import { ShellBridgeContext, type ShellBridge } from "../app/ShellBridgeContext";
import { createGraphIntentBus, graphIntentToSearch, type GraphIntent } from "./intent-bus";
import * as apiClient from "../shared/api-client";
import { GraphPage } from "./GraphPage";
import { KnowledgeLibraryBrowse, emptyLibraryFilters } from "../knowledge/KnowledgeLibraryBrowse";
import { KnowledgeDocumentDetail } from "../knowledge/KnowledgeDocumentDetail";
import { installTestDialogs } from "../../tests/dialogTestSupport";

const { fitView, setCenter } = vi.hoisted(() => ({ fitView: vi.fn(), setCenter: vi.fn() }));

vi.mock("../knowledge/ArdenRichTextEditor", async () => {
  const { createElement: element } = await import("react");
  return { ArdenDocumentView: ({ body }: { body: string }) => element("div", null, body) };
});

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: ReactNode }) => React.createElement("div", { "data-testid": "rf-provider" }, children),
    ReactFlow: ({
      nodes = [],
      edges = [],
      nodeTypes = {},
      onNodeClick,
      onPaneClick,
      children,
    }: {
      nodes?: Array<{ id: string; type?: string; data: unknown }>;
      edges?: Array<{ id: string }>;
      nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown; selected?: boolean }>>;
      onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: unknown }) => void;
      onPaneClick?: () => void;
      children?: ReactNode;
    }) => React.createElement(
      "div",
      { "data-testid": "react-flow-canvas", "data-edge-count": String(edges.length) },
      React.createElement("div", { "data-testid": "rf-pane", onClick: () => onPaneClick?.() }),
      nodes.map((node) => {
        const Comp = node.type ? nodeTypes[node.type] : null;
        return React.createElement(
          "div",
          {
            key: node.id,
            "data-node-id": node.id,
            onClick: (event: React.MouseEvent) => onNodeClick?.(event, node),
          },
          Comp ? React.createElement(Comp, { id: node.id, data: node.data, selected: false }) : node.id,
        );
      }),
      children,
    ),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    useReactFlow: () => ({
      fitView,
      setCenter,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: vi.fn(),
      getNode: () => undefined,
    }),
  };
});

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
    collectionId: "col-handbook",
    openTarget: "READER",
    canEditRelationships: true,
    canRenew: false,
    monitorSignals: null,
    ...rest,
  };
}

function makePayload(overrides: Partial<KnowledgeGraphPayload> = {}): KnowledgeGraphPayload {
  const documents = overrides.documents ?? [
    makeDoc({
      documentId: "doc-1",
      title: "Security Policy",
      type: "Policy & Standard",
      ownerDepartmentId: "dept-sec",
      ownerDepartmentName: "Security",
      collectionId: "col-handbook",
    }),
    makeDoc({
      documentId: "doc-2",
      title: "Legacy Runbook",
      type: null,
      ownerDepartmentId: "dept-eng",
      ownerDepartmentName: "Engineering",
      collectionId: null,
      openTarget: "MY_CONTRIBUTIONS",
    }),
    makeDoc({
      documentId: "doc-3",
      title: "Department Onboarding",
      type: "Guide",
      ownerDepartmentId: "dept-eng",
      ownerDepartmentName: "Engineering",
      readerScope: "DEPARTMENT",
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
      returnedCount: documents.length,
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
    ],
    documents,
    relationships: [],
    ...overrides,
  };
}

function setViewportMatch(mobile: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("max-width: 767px") ? mobile : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function createBridge(initialSearch = "") {
  const bus = createGraphIntentBus();
  let search = initialSearch;
  const openReportIssue = vi.fn();
  const dispatchGraphIntent = vi.fn((intent: GraphIntent) => {
    search = graphIntentToSearch(intent, search);
    bus.dispatch(intent);
  });
  const setGraphSearch = vi.fn((next: string) => {
    search = next;
  });
  const bridge: ShellBridge = {
    graphIntentBus: bus,
    dispatchGraphIntent,
    get graphSearch() { return search; },
    setGraphSearch,
    openReportIssue,
  };
  return { bridge, bus, openReportIssue, dispatchGraphIntent, setGraphSearch };
}

let restoreDialogs: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  restoreDialogs = installTestDialogs();
  setViewportMatch(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GraphPage", () => {
  it("renders deterministic loading skeleton then Accountability view, and handles empty state with Clear filters", async () => {
    let resolveLoad!: (payload: KnowledgeGraphPayload) => void;
    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        organizationName: "Arden Labs",
        contextOpen: false,
        onToggleContext: vi.fn(),
      }),
    ));

    expect(screen.getByRole("status", { name: /Loading Knowledge Graph/i })).toBeTruthy();

    resolveLoad(makePayload());
    expect(await screen.findByText("Security Policy")).toBeTruthy();
    const canvas = screen.getByTestId("react-flow-canvas");
    expect(within(canvas).getByText("Uncategorized (legacy)")).toBeTruthy();
    expect(getGraph).toHaveBeenCalledWith("web", "org-1", expect.objectContaining({ view: "accountability" }));

    // Filter to non-matching search with Isolate matching enabled -> honest empty state + Clear filters button.
    fireEvent.click(screen.getByRole("button", { name: /Isolate matching/i }));
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter graph/i }), {
      target: { value: "does-not-exist-anywhere" },
    });

    const emptyHeading = await screen.findByText(/No matching documents/i);
    const clearBtn = within(emptyHeading.closest(".graph-state-card") as HTMLElement).getByRole("button", { name: /Clear filters/i });
    fireEvent.click(clearBtn);
    expect(await screen.findByText("Security Policy")).toBeTruthy();
  });

  it("displays amber truncation banners when documents or relationships are truncated", async () => {
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({
      truncation: {
        limit: 500,
        returnedCount: 3,
        truncated: true,
        relationshipsLimit: 1000,
        relationshipsTruncated: true,
      },
    }));
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    expect(await screen.findByText(/Showing first 500 matching documents/i)).toBeTruthy();
    expect(screen.getAllByText(/Partial branch counts while filtered/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Showing first 1,000 relationships/i)).toBeTruthy();
  });

  it("switches between Accountability and Collections views and separates Shared documents", async () => {
    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementation(async (_platform, _org, query) => makePayload({
      appliedMode: {
        view: query?.view ?? "accountability",
        monitorActive: false,
        includeExpiredActive: false,
        includeLinksActive: false,
      },
    }));
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));

    await waitFor(() => expect(getGraph).toHaveBeenLastCalledWith("web", "org-1", expect.objectContaining({ view: "collections" })));
    const canvas = screen.getByTestId("react-flow-canvas");
    expect(await within(canvas).findByText("Company Handbook")).toBeTruthy();
    expect(within(canvas).getByText("Unassigned")).toBeTruthy();
    expect(within(canvas).getByText("Shared")).toBeTruthy();
  });

  it("defaults to Outline View below 768px and supports full WCAG 2.2 AA treegrid keyboard navigation", async () => {
    setViewportMatch(true);
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload());
    const onOpenDocument = vi.fn();
    const onPinDocument = vi.fn();
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        onOpenDocument,
        onPinDocument,
      }),
    ));

    const treegrid = await screen.findByRole("treegrid", { name: /Knowledge Graph outline/i });
    const rows = within(treegrid).getAllByRole("row").filter((row) => row.hasAttribute("aria-level"));
    expect(rows.length).toBeGreaterThan(3);

    // Focus first row (Org), ArrowDown to Engineering branch, ArrowLeft collapses it, ArrowRight expands it.
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    const deptRow = document.activeElement as HTMLElement;
    expect(deptRow.getAttribute("aria-level")).toBe("2");
    expect(deptRow.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(deptRow, { key: "ArrowLeft" });
    await waitFor(() => expect(deptRow.getAttribute("aria-expanded")).toBe("false"));

    fireEvent.keyDown(deptRow, { key: "ArrowRight" });
    await waitFor(() => expect(deptRow.getAttribute("aria-expanded")).toBe("true"));

    // Navigate down to first document row, press P to pin and Enter to open via openTarget.
    fireEvent.keyDown(deptRow, { key: "ArrowDown" }); // type branch
    const typeRow = document.activeElement as HTMLElement;
    fireEvent.keyDown(typeRow, { key: "ArrowDown" }); // document row
    const docRow = document.activeElement as HTMLElement;
    expect(docRow.getAttribute("aria-level")).toBe("4");

    fireEvent.keyDown(docRow, { key: "p" });
    expect(onPinDocument).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(docRow, { key: "Enter" });
    expect(onOpenDocument).toHaveBeenCalledTimes(1);

    // Escape clears selection cleanly.
    fireEvent.keyDown(docRow, { key: "Escape" });
    expect(docRow.getAttribute("aria-selected")).toBe("false");
  });

  it.each([false, true])("shows an authorized focus target despite conflicting facets (isolate %s)", async (isolate) => {
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload());
    const { bridge, bus } = createBridge();
    render(createElement(ShellBridgeContext.Provider, { value: bridge }, createElement(GraphPage, {
      platform: "web", organizationId: "org-1", contextOpen: false, onToggleContext: vi.fn(),
    })));

    await screen.findByText("Security Policy");
    if (isolate) fireEvent.click(screen.getByRole("button", { name: /Isolate matching/i }));
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter graph/i }), {
      target: { value: "Department Onboarding" },
    });
    await waitFor(() => expect(screen.queryByText("Security Policy")).toBeNull());

    bus.dispatch({ type: "focus_nodes", documentIds: ["doc-1"] });
    expect(await screen.findByRole("toolbar", { name: /Actions for Security Policy/i })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: /Filter graph/i }) as HTMLInputElement).value).toBe("Department Onboarding");
  });

  it("shows the same filtered cross-links to read-only members on narrow Outline", async () => {
    setViewportMatch(true);
    const relations: GraphRelationshipEdge[] = [
      { relationshipId: "rel-1", sourceDocumentId: "doc-1" as DocumentId, targetDocumentId: "doc-2" as DocumentId,
        relationshipType: "REFERENCES", createdAt: "2026-11-21T00:00:00Z" },
      { relationshipId: "rel-2", sourceDocumentId: "doc-1" as DocumentId, targetDocumentId: "doc-3" as DocumentId,
        relationshipType: "RELATED", createdAt: "2026-11-21T00:00:00Z" },
    ];
    const base = makePayload();
    vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementation(async (_platform, _org, query) => makePayload({
      documents: base.documents.map((doc) => ({ ...doc, canEditRelationships: false })),
      appliedMode: { ...base.appliedMode, includeLinksActive: Boolean(query?.includeLinks) },
      relationships: query?.includeLinks ? relations : [],
    }));
    const { bridge, bus } = createBridge();
    render(createElement(ShellBridgeContext.Provider, { value: bridge }, createElement(GraphPage, {
      platform: "web", organizationId: "org-1", contextOpen: false, onToggleContext: vi.fn(),
      elkLayoutFn: async (input) => input,
    })));

    await screen.findByRole("treegrid");
    bus.dispatch({ type: "toggle_links", enabled: true, relationshipTypes: ["REFERENCES"] });
    fireEvent.click(await screen.findByText("Cross-links (1)"));
    const links = within(screen.getByRole("region", { name: "Knowledge Graph view" })).getByRole("list");
    expect(within(links).getByRole("listitem").textContent?.trim()).toBe("Security Policy references Legacy Runbook");
    expect(screen.queryByRole("button", { name: "Manage links" })).toBeNull();
  });

  it("handles GraphIntentBus intents (focus_nodes, apply_filter, isolate_branch, toggle_links)", async () => {
    const rel: GraphRelationshipEdge = {
      relationshipId: "rel-1",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-2" as DocumentId,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-21T00:00:00Z",
    };
    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementation(async (_platform, _org, query) => makePayload({
      appliedMode: {
        view: query?.view ?? "accountability",
        monitorActive: false,
        includeExpiredActive: false,
        includeLinksActive: Boolean(query?.includeLinks),
      },
      relationships: query?.includeLinks ? [rel] : [],
    }));
    const { bridge, bus } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");

    // Dispatch focus_nodes -> selects doc-1 and shows floating action toolbar.
    bus.dispatch({ type: "focus_nodes", documentIds: ["doc-1"] });
    expect(await screen.findByRole("toolbar", { name: /Actions for Security Policy/i })).toBeTruthy();

    // Dispatch apply_filter -> updates active type filter.
    bus.dispatch({ type: "apply_filter", typeCode: "POLICY_AND_STANDARD" });
    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: /Document type/i }) as HTMLSelectElement;
      expect(select.value).toBe("POLICY_AND_STANDARD");
    });

    // Dispatch toggle_links -> refetches with includeLinks=true.
    bus.dispatch({ type: "toggle_links", enabled: true, relationshipTypes: ["REFERENCES"] });
    await waitFor(() => expect(getGraph).toHaveBeenCalledWith("web", "org-1", expect.objectContaining({
      includeLinks: true,
      relationshipTypes: "REFERENCES",
    })));

    fitView.mockClear();
    bus.dispatch({ type: "isolate_branch", branchKind: "department", branchId: "dept-eng" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Isolate matching" }).getAttribute("aria-pressed")).toBe("true");
      expect(fitView).toHaveBeenCalled();
      expect(screen.queryByRole("toolbar", { name: /Actions for Security Policy/i })).toBeNull();
    });
  });

  it("still calls fitView for isolate_branch when an earlier layout computation settles right before isolate renders", async () => {
    const rel: GraphRelationshipEdge = {
      relationshipId: "rel-race",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-2" as DocumentId,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-21T00:00:00Z",
    };
    let resolveSlowLayout: (() => void) | null = null;
    let elkCalls = 0;
    const elkLayoutFn = vi.fn(async (graph: { children: Array<{ id: string }> }) => {
      elkCalls += 1;
      if (elkCalls === 1) {
        await new Promise<void>((resolve) => { resolveSlowLayout = resolve; });
      }
      return { children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })) };
    });
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({
      appliedMode: { view: "accountability", monitorActive: false, includeExpiredActive: true, includeLinksActive: true },
      relationships: [rel],
    }));
    const { bridge, bus } = createBridge("?includeLinks=true");

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn,
      }),
    ));

    await waitFor(() => expect(elkLayoutFn).toHaveBeenCalledTimes(1));
    fitView.mockClear();
    bus.dispatch({ type: "isolate_branch", branchKind: "department", branchId: "dept-eng" });
    resolveSlowLayout?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Isolate matching" }).getAttribute("aria-pressed")).toBe("true");
      expect(fitView).toHaveBeenCalled();
    });
  });

  it("opens GraphRelationshipDialog from floating toolbar, creates/removes links, and surfaces 409 conflicts cleanly", async () => {
    const existingEdge: GraphRelationshipEdge = {
      relationshipId: "rel-existing",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-2" as DocumentId,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-21T00:00:00Z",
    };
    const createdEdge: GraphRelationshipEdge = {
      relationshipId: "rel-new",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-3" as DocumentId,
      relationshipType: "SUPERSEDES",
      createdAt: "2026-11-22T00:00:00Z",
    };
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({
      appliedMode: { view: "accountability", monitorActive: false, includeExpiredActive: false, includeLinksActive: true },
      relationships: [existingEdge],
    }));
    const createRel = vi.spyOn(apiClient, "createDocumentRelationship")
      .mockRejectedValueOnce(new apiClient.ApiError(409, "Cycle detected.", "RELATIONSHIP_CYCLE"))
      .mockResolvedValueOnce(createdEdge);
    const removeRel = vi.spyOn(apiClient, "removeDocumentRelationship").mockResolvedValue({ removed: true });
    const { bridge, bus } = createBridge("?includeLinks=true");

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");
    bus.dispatch({ type: "focus_nodes", documentIds: ["doc-1"] });
    const toolbar = await screen.findByRole("toolbar", { name: /Actions for Security Policy/i });
    fireEvent.click(within(toolbar).getByRole("button", { name: /Manage links/i }));

    const dialog = await screen.findByRole("dialog", { name: /Manage links/i, hidden: true });
    expect(within(dialog).getByText("Legacy Runbook")).toBeTruthy();

    // Attempt to add SUPERSEDES link -> 409 cycle error displayed inline.
    fireEvent.change(within(dialog).getByLabelText(/Target document/i), { target: { value: "doc-3" } });
    fireEvent.change(within(dialog).getByLabelText(/Relationship type/i), { target: { value: "SUPERSEDES" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add link/i, hidden: true }));

    expect(await within(dialog).findByRole("alert", { hidden: true })).toBeTruthy();
    expect(createRel).toHaveBeenCalledTimes(1);

    // Retry creates the link cleanly with a fresh UUID idempotency key.
    fireEvent.click(within(dialog).getByRole("button", { name: /Add link/i, hidden: true }));
    await waitFor(() => expect(createRel).toHaveBeenCalledTimes(2));
    expect(createRel.mock.calls[0]![4]).not.toBe(createRel.mock.calls[1]![4]);

    // Remove existing outgoing link.
    fireEvent.click(within(dialog).getByRole("button", { name: /Remove link to Legacy Runbook/i, hidden: true }));
    await waitFor(() => expect(removeRel).toHaveBeenCalledWith("web", "org-1", "doc-1", "rel-existing", expect.any(String)));
  });

  it("dispatches focus_nodes from Home row and Reader Info Panel View in Graph buttons", () => {
    const { bridge, dispatchGraphIntent } = createBridge();
    const published: apiClient.PublishedKnowledge = {
      id: "ver-9",
      draftId: "doc-9",
      title: "Incident Playbook",
      classification: "INTERNAL",
      responsibleDepartmentId: "dept-eng",
      responsibleDepartmentName: "Engineering",
      audienceIds: [],
      contentHash: "h",
      publishedAt: "2026-11-20T00:00:00Z",
      validFrom: "2026-11-20T00:00:00Z",
      validUntil: null,
      management: { type: "Procedure", version: "2.0", expirationDate: null, changeNote: "" },
    };

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(KnowledgeLibraryBrowse, {
        items: [published],
        catalog: null,
        catalogError: "",
        query: "",
        filters: emptyLibraryFilters(),
        onFilters: vi.fn(),
        discover: false,
        onBrowse: vi.fn(),
        onOpen: vi.fn(),
        onManage: vi.fn(),
        onViewInGraph: (docId: string) => bridge.dispatchGraphIntent({ type: "focus_nodes", documentIds: [docId] }),
      }),
    ));

    fireEvent.click(screen.getByRole("button", { name: /View Incident Playbook in Graph/i }));
    expect(dispatchGraphIntent).toHaveBeenCalledWith({ type: "focus_nodes", documentIds: ["doc-9"] });
    cleanup();

    render(createElement(
      KnowledgeDocumentDetail,
      {
        metadata: {
          title: "Incident Playbook",
          ownerDepartment: "Engineering",
          summary: "",
          activeVersionId: "ver-9",
          versions: [{ id: "ver-9", label: "2.0", status: "EFFECTIVE" }],
        },
        content: createElement("p", null, "Steps"),
        onBack: vi.fn(),
        informationActions: createElement(
          "button",
          { type: "button", onClick: () => bridge.dispatchGraphIntent({ type: "focus_nodes", documentIds: ["doc-9"] }) },
          "View in Graph",
        ),
      },
    ));

    fireEvent.click(screen.getByRole("button", { name: "View in Graph" }));
    expect(dispatchGraphIntent).toHaveBeenCalledTimes(2);
  });

  it("loads the exact version in the responsible reviewer dialog and reports the route", async () => {
    const responsible = makeDoc({
      documentId: "doc-review",
      title: "Reviewer Only SOP",
      openTarget: "RESPONSIBLE_VIEW",
      canEditRelationships: false,
    });
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({ documents: [responsible] }));
    const loadResponsible = vi.spyOn(apiClient, "loadResponsiblePublication").mockResolvedValue({
      documentId: "doc-review",
      publishedVersionId: "ver-doc-review",
      title: "Reviewer Only SOP",
      mimeType: "text/plain",
      contentHash: "hash",
      body: "Responsible reviewer content",
      responsibleDepartmentId: "dept-eng",
      readers: { mode: "DEPARTMENT", departmentId: "dept-eng" },
    });
    const onOpenDocument = vi.fn();
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        onOpenDocument,
        openResponsibleViewInPlace: true,
      }),
    ));

    const nodeText = await screen.findByText("Reviewer Only SOP");
    fireEvent.click(nodeText.closest("[data-node-id]") as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: /Responsible view/i }));

    await waitFor(() => expect(loadResponsible).toHaveBeenCalledWith("web", "org-1", "doc-review"));
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-review", openTarget: "RESPONSIBLE_VIEW" }));
    await waitFor(() => {
      const dialog = screen.getByRole("dialog", { name: "Reviewer Only SOP" });
      expect(within(dialog).getByText("Responsible reviewer content")).toBeTruthy();
    });
  });

  it("auto-enables includeExpired when selecting Expired validity in Monitor Mode and renders role-scoped badges", async () => {
    const monitorDocs: GraphDocumentNode[] = [
      makeDoc({
        documentId: "doc-exp",
        title: "Expired Author Spec",
        validityStatus: "Expired",
        daysUntilExpiry: 0,
        openTarget: "MY_CONTRIBUTIONS",
        canEditRelationships: false,
        canRenew: true,
        monitorSignals: {
          openMaintenanceCaseCount: null,
          isUnassignedOrgDoc: false,
          requiresAuditedInspection: false,
        },
      }),
      makeDoc({
        documentId: "doc-rev",
        title: "Reviewed Dept SOP",
        validityStatus: "Expiring soon",
        daysUntilExpiry: 5,
        openTarget: "RESPONSIBLE_VIEW",
        canEditRelationships: false,
        monitorSignals: {
          openMaintenanceCaseCount: 2,
          isUnassignedOrgDoc: false,
          requiresAuditedInspection: false,
        },
      }),
      makeDoc({
        documentId: "doc-adm",
        title: "Unassigned Admin Doc",
        validityStatus: "Current",
        collectionId: null,
        openTarget: "ADMIN_INSPECTION",
        canEditRelationships: false,
        monitorSignals: {
          openMaintenanceCaseCount: 0,
          isUnassignedOrgDoc: true,
          requiresAuditedInspection: true,
        },
      }),
    ];

    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementation(async (_platform, _org, query) => makePayload({
      appliedMode: {
        view: query?.view ?? "accountability",
        monitorActive: Boolean(query?.monitor),
        includeExpiredActive: Boolean(query?.monitor && query?.includeExpired),
        includeLinksActive: false,
      },
      documents: query?.monitor
        ? (query.includeExpired ? monitorDocs : monitorDocs.filter((doc) => doc.validityStatus !== "Expired"))
        : [monitorDocs[2]!],
    }));

    const { bridge } = createBridge();
    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Unassigned Admin Doc");
    fireEvent.click(screen.getByRole("button", { name: /^Monitor$/i }));
    await waitFor(() => expect(getGraph).toHaveBeenLastCalledWith("web", "org-1", expect.objectContaining({ monitor: true })));

    // Selecting Expired from the Validity dropdown should automatically request includeExpired=true.
    fireEvent.change(screen.getByLabelText("Validity"), { target: { value: "EXPIRED" } });
    await waitFor(() => expect(getGraph).toHaveBeenLastCalledWith("web", "org-1", expect.objectContaining({
      monitor: true,
      includeExpired: true,
    })));
    const canvas = screen.getByTestId("react-flow-canvas");
    expect(await within(canvas).findByText("Expired Author Spec")).toBeTruthy();

    // Clear validity filter to verify all 3 Monitor cards: 2 cases shown on doc-rev, omitted when null/0, Inspect + Unassigned shown on doc-adm.
    fireEvent.change(screen.getByLabelText("Validity"), { target: { value: "" } });
    expect(await within(canvas).findByText("2 cases")).toBeTruthy();
    expect(within(canvas).getByText("Unassigned")).toBeTruthy();
    expect(within(canvas).getByText("Inspect")).toBeTruthy();
    expect(within(canvas).queryByText("0 cases")).toBeNull();
  });

  it("focuses the filter input on Cmd/Ctrl+K, clears stale facets on isolate_branch, restores row focus on Escape from Outline buttons, and reuses idempotency keys across transient 503 retries", async () => {
    const existingEdge: GraphRelationshipEdge = {
      relationshipId: "rel-existing",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-2" as DocumentId,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-21T00:00:00Z",
    };
    const createdEdge: GraphRelationshipEdge = {
      relationshipId: "rel-transient",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-3" as DocumentId,
      relationshipType: "RELATED",
      createdAt: "2026-11-22T00:00:00Z",
    };
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({
      appliedMode: { view: "accountability", monitorActive: false, includeExpiredActive: false, includeLinksActive: true },
      relationships: [existingEdge],
    }));
    const createRel = vi.spyOn(apiClient, "createDocumentRelationship")
      .mockRejectedValueOnce(new apiClient.ApiError(503, "Temporary outage.", "SERVICE_UNAVAILABLE"))
      .mockResolvedValueOnce(createdEdge);
    const { bridge, bus } = createBridge("?ownerDepartmentId=dept-sec&typeCode=POLICY_AND_STANDARD");

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");

    // Cmd/Ctrl+K jumps directly to the filter input.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Filter graph"));

    // isolate_branch clears conflicting prior department/type facets.
    bus.dispatch({ type: "isolate_branch", branchKind: "type", branchId: "GUIDE" });
    await waitFor(() => {
      expect((screen.getByLabelText("Owner department") as HTMLSelectElement).value).toBe("");
      expect((screen.getByLabelText("Document type") as HTMLSelectElement).value).toBe("GUIDE");
    });

    // Clear filters and verify Escape inside an Outline cell button restores focus to its parent treegrid row.
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Outline$/i }));
    const treegrid = await screen.findByRole("treegrid", { name: /Knowledge Graph outline/i });
    const docRow = within(treegrid).getAllByRole("row").find((row) => row.textContent?.includes("Security Policy"))!;
    const openBtn = within(docRow).getByRole("button", { name: /^Open$/i });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);
    fireEvent.keyDown(openBtn, { key: "Escape" });
    expect(document.activeElement).toBe(docRow);

    // Open Manage links from Outline and verify transient 503 retry preserves the exact Idempotency-Key.
    fireEvent.click(within(docRow).getByRole("button", { name: /^Manage links$/i }));
    const dialog = await screen.findByRole("dialog", { name: /Manage links/i, hidden: true });
    expect(within(within(dialog).getByRole("list", { hidden: true })).getByText("References")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Target document/i), { target: { value: "doc-3" } });
    fireEvent.change(within(dialog).getByLabelText(/Relationship type/i), { target: { value: "RELATED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add link/i, hidden: true }));
    expect(await within(dialog).findByRole("alert", { hidden: true })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Add link/i, hidden: true }));
    await waitFor(() => expect(createRel).toHaveBeenCalledTimes(2));
    expect(createRel.mock.calls[0]![4]).toBe(createRel.mock.calls[1]![4]);
  });

  it("pins only matching docs from a filtered branch and disables pinning a 0-match dimmed branch", async () => {
    const docs = [
      makeDoc({ documentId: "doc-eng-guide", title: "Eng Guide", type: "Guide", ownerDepartmentId: "dept-eng", ownerDepartmentName: "Engineering" }),
      makeDoc({ documentId: "doc-eng-ref", title: "Eng Ref", type: "Reference", ownerDepartmentId: "dept-eng", ownerDepartmentName: "Engineering" }),
      makeDoc({ documentId: "doc-sec-pol", title: "Sec Policy", type: "Policy & Standard", ownerDepartmentId: "dept-sec", ownerDepartmentName: "Security" }),
    ];
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload({ documents: docs }));
    const onPinBranch = vi.fn();
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        onPinBranch,
      }),
    ));

    await screen.findByText("Eng Guide");

    // Filter to GUIDE: Engineering has 1 match (doc-eng-guide) + 1 dimmed (doc-eng-ref); Security has 0 matches.
    fireEvent.change(screen.getByRole("combobox", { name: /Document type/i }), { target: { value: "GUIDE" } });
    await waitFor(() => expect(screen.queryByText("Sec Policy")).toBeNull());

    const pinEng = screen.getByRole("button", { name: "Pin Engineering to Ask Arden" });
    fireEvent.click(pinEng);
    expect(onPinBranch).toHaveBeenCalledWith("Engineering", [expect.objectContaining({ documentId: "doc-eng-guide" })], false);

    // 0-match dimmed branch disables its Pin button so dimmed docs are never silently pinned.
    const pinSec = screen.getByRole("button", { name: "Pin Security to Ask Arden" }) as HTMLButtonElement;
    expect(pinSec.disabled).toBe(true);
  });

  it("expands an auto-collapsed empty branch when clicking its Expand chevron and resets on filter change", async () => {
    vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload());
    const { bridge } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");
    fireEvent.change(screen.getByRole("combobox", { name: /Document type/i }), { target: { value: "GUIDE" } });
    await waitFor(() => expect(screen.queryByText("Security Policy")).toBeNull());

    // Security is auto-collapsed; clicking Expand Security must actually expand it!
    fireEvent.click(screen.getByRole("button", { name: "Expand Security" }));
    expect(await screen.findByRole("button", { name: "Collapse Security" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Policy & Standard" }));
    expect(await screen.findByText("Security Policy")).toBeTruthy();

    // Changing the filter resets manual expand overrides cleanly.
    fireEvent.change(screen.getByRole("combobox", { name: /Document type/i }), { target: { value: "UNCATEGORIZED" } });
    await waitFor(() => expect(screen.queryByText("Security Policy")).toBeNull());
    expect(screen.getByRole("button", { name: "Expand Security" })).toBeTruthy();
  });

  it("glides camera once per focusNonce without snapping back on subsequent branch toggles, clears focusDocumentId on deselect, and skips redundant server fetch when already present in untruncated payload", async () => {
    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockResolvedValue(makePayload());
    const onUnfilteredSnapshot = vi.fn();
    const { bridge, bus, setGraphSearch } = createBridge();

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        onUnfilteredSnapshot,
      }),
    ));

    await screen.findByText("Security Policy");
    expect(getGraph).toHaveBeenCalledTimes(1);
    expect(onUnfilteredSnapshot).toHaveBeenCalledTimes(1);

    // Filter to Department Onboarding so doc-1 (Security Policy) is dimmed/collapsed.
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter graph/i }), {
      target: { value: "Department Onboarding" },
    });
    await waitFor(() => expect(screen.queryByText("Security Policy")).toBeNull());

    setCenter.mockClear();
    // Focus doc-1 which is ALREADY in the untruncated payload -> NO redundant server fetch!
    bus.dispatch({ type: "focus_nodes", documentIds: ["doc-1"] });
    expect(await screen.findByRole("toolbar", { name: /Actions for Security Policy/i })).toBeTruthy();
    await waitFor(() => expect(setCenter).toHaveBeenCalledTimes(1));
    expect(getGraph).toHaveBeenCalledTimes(1);

    // Collapsing a branch updates nodes, but must NOT snap the camera back!
    fireEvent.click(screen.getByRole("button", { name: "Collapse Engineering" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Engineering" })).toBeTruthy());
    expect(setCenter).toHaveBeenCalledTimes(1);

    // Deselecting via pane click clears focusDocumentId from URL/state so doc-1 re-dims/collapses under active filter.
    setGraphSearch.mockClear();
    fireEvent.click(screen.getByTestId("rf-pane"));
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: /Actions for Security Policy/i })).toBeNull());
    await waitFor(() => expect(screen.queryByText("Security Policy")).toBeNull());
    expect(setGraphSearch).toHaveBeenLastCalledWith("?q=Department+Onboarding", { replace: true });

    // Clearing filters + clicking Refresh now runs onUnfilteredSnapshot (not blocked by stale focusDocumentId).
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    await screen.findByText("Security Policy");
    onUnfilteredSnapshot.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(onUnfilteredSnapshot).toHaveBeenCalledTimes(1));

    // Focusing a doc missing from the current payload still fetches from server with focusDocumentId.
    bus.dispatch({ type: "focus_nodes", documentIds: ["doc-remote-99"] });
    await waitFor(() => expect(getGraph).toHaveBeenLastCalledWith("web", "org-1", expect.objectContaining({
      focusDocumentId: "doc-remote-99",
    })));
  });

  it("loads unfiltered links in GraphRelationshipDialog when GraphPage is filtered or truncated and warns on incomplete results", async () => {
    const crossDeptDoc: GraphDocumentNode = {
      ...makePayload().documents[0]!,
      documentId: "doc-hr" as DocumentId,
      publishedVersionId: "pv-hr" as PublishedVersionId,
      title: "HR Policy",
      ownerDepartmentId: "dept-hr",
      ownerDepartmentName: "Human Resources",
      canEditRelationships: false,
    };
    const crossDeptEdge: GraphRelationshipEdge = {
      relationshipId: "rel-cross-dept",
      sourceDocumentId: "doc-1" as DocumentId,
      targetDocumentId: "doc-hr" as DocumentId,
      relationshipType: "REFERENCES",
      createdAt: "2026-11-22T00:00:00Z",
    };
    const filteredSlice = makePayload({
      appliedMode: { view: "accountability", monitorActive: false, includeExpiredActive: false, includeLinksActive: true },
      truncation: { limit: 500, returnedCount: 1, truncated: true, relationshipsLimit: 1000, relationshipsTruncated: false },
      departments: [{ id: "dept-eng", name: "Engineering" }],
      documents: [makePayload().documents[0]!],
      relationships: [],
    });
    const unfilteredForDialog = makePayload({
      appliedMode: { view: "accountability", monitorActive: false, includeExpiredActive: false, includeLinksActive: true },
      truncation: { limit: 500, returnedCount: 2, truncated: true, relationshipsLimit: 1000, relationshipsTruncated: false },
      departments: [{ id: "dept-eng", name: "Engineering" }, { id: "dept-hr", name: "Human Resources" }],
      documents: [makePayload().documents[0]!, crossDeptDoc],
      relationships: [crossDeptEdge],
    });
    const getGraph = vi.spyOn(apiClient, "getKnowledgeGraph").mockImplementation(async (_platform, _org, query) => (
      query?.focusDocumentId === "doc-1" && !query.ownerDepartmentId ? unfilteredForDialog : filteredSlice
    ));
    const { bridge } = createBridge("?includeLinks=true&ownerDepartmentId=dept-eng");

    render(createElement(
      ShellBridgeContext.Provider,
      { value: bridge },
      createElement(GraphPage, {
        platform: "web",
        organizationId: "org-1",
        contextOpen: false,
        onToggleContext: vi.fn(),
        elkLayoutFn: async (graph) => ({
          children: graph.children.map((child, idx) => ({ id: child.id, x: idx * 280, y: 0 })),
        }),
      }),
    ));

    await screen.findByText("Security Policy");
    fireEvent.click(screen.getByText("Security Policy"));
    const toolbar = await screen.findByRole("toolbar", { name: /Actions for Security Policy/i });
    fireEvent.click(within(toolbar).getByRole("button", { name: /Manage links/i }));

    const dialog = await screen.findByRole("dialog", { name: /Manage links/i, hidden: true });
    await waitFor(() => expect(getGraph).toHaveBeenLastCalledWith("web", "org-1", {
      includeLinks: true,
      focusDocumentId: "doc-1",
    }));
    expect(await within(dialog).findByText("HR Policy")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Remove link to HR Policy/i, hidden: true })).toBeTruthy();
    expect(within(dialog).getByRole("status", { hidden: true }).textContent).toContain("up to 500 documents");
  });

  it("GovernanceActionDialog queries exact documentId renewal state instead of scanning the capped list", async () => {
    const { GovernanceActionDialog } = await import("../knowledge/GovernanceActionDialog");
    const listRenewals = vi.spyOn(apiClient, "listPublicationRenewals").mockResolvedValue([{
      documentId: "doc-1005",
      publishedVersionId: "pv-1005",
      title: "Policy 1005",
      responsibleDepartmentId: "dept-eng",
      expirationDate: "2099-12-31",
      renewalPending: false,
      authorActive: true,
      isAuthor: true,
      canRenew: true,
      authorName: "Alice Author",
      pending: null,
    }]);

    render(createElement(GovernanceActionDialog, {
      platform: "web",
      organizationId: "org-1",
      target: { kind: "renewal", documentId: "doc-1005", publishedVersionId: "pv-1005", title: "Policy 1005" },
      onClose: vi.fn(),
    }));

    await waitFor(() => expect(listRenewals).toHaveBeenCalledWith("web", "org-1", "doc-1005"));
    expect(await screen.findByText(/Policy 1005/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send for review" })).toBeTruthy();
  });

});
