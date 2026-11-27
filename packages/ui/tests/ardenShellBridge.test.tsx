// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoundUiSurface, HydratedDocumentSummary } from "@arden/domain";
import { createElement, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArdenShell } from "../src/app/ArdenShell";
import { useShellBridge } from "../src/app/ShellBridgeContext";
import { allowedRoute, parseWorkspacePath, rememberReturnPath, routeForView, takeReturnPath, workspacePath } from "../src/app/workspaceRoute";
import { createGraphIntentBus, type GraphIntentEnvelope } from "../src/graph/intent-bus";
import * as maintenanceClient from "../src/maintenance/maintenance-client";
import * as apiClient from "../src/shared/api-client";
import * as privateApi from "../src/shared/private-workspace-api";
import { WorkspaceTopbar, type ContextControlProps } from "../src/shared/WorkspaceTopbar";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return { ...actual, restoreSession: vi.fn(), apiRequest: vi.fn() };
});

vi.mock("../src/organization/OrganizationAdminPage", async () => {
  const { createElement: element } = await import("react");
  const { useShellBridge: useBridge } = await import("../src/app/ShellBridgeContext");
  return {
    OrganizationAdminPage: () => {
      const bridge = useBridge();
      return element("main", { "aria-label": "Administration" },
        element("button", {
          type: "button",
          onClick: () => bridge?.dispatchGraphIntent(
            { type: "focus_nodes", documentIds: ["doc-77"] },
            { openAgentPanel: true },
          ),
        }, "Focus doc 77 in Graph"),
        element("button", {
          type: "button",
          onClick: () => bridge?.openReportIssue({
            documentId: "doc-admin",
            publishedVersionId: "ver-admin",
            title: "Org Governance Policy",
          }),
        }, "Report From Admin"),
      );
    },
  };
});

function membership(roleCodes: string[]) {
  return {
    organization: { id: "org-1", name: "Test Org" },
    status: "active",
    departmentId: "dept-1",
    roleCodes,
    canUsePrivateWorkspace: true,
  };
}

function privateNote(id: string, title: string, version = 1) {
  return {
    id,
    organizationId: "org-1",
    title,
    currentVersion: { id: `${id}-v${version}`, version },
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
    body: `${title} body`,
    collectionId: null,
    favoritedAt: null,
  };
}

function GraphHarness(context: ContextControlProps) {
  const bridge = useShellBridge();
  const [received, setReceived] = useState<GraphIntentEnvelope[]>([]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.graphIntentBus.subscribe((envelope) => {
      setReceived((current) => [...current, envelope]);
    });
  }, [bridge]);

  return (
    <main id="arden-main" className="workspace-page" aria-label="Knowledge Graph" tabIndex={-1}>
      <WorkspaceTopbar breadcrumb="Test Org / Graph" {...context} />
      <div data-testid="graph-search">{bridge?.graphSearch ?? ""}</div>
      <div data-testid="graph-intents">{JSON.stringify(received.map((entry) => entry.intent))}</div>
      <button type="button" onClick={() => bridge?.setGraphSearch("?view=collections&typeCode=GUIDE")}>
        Filter Guide
      </button>
      <button type="button" onClick={() => bridge?.setGraphSearch("?view=accountability&focusDocumentId=doc-9")}>
        Focus Doc 9
      </button>
      <button
        type="button"
        onClick={() => bridge?.openReportIssue({
          documentId: "doc-1",
          publishedVersionId: "ver-1",
          title: "Security Handbook",
          versionLabel: "2.1",
        })}
      >
        Report Graph Doc
      </button>
    </main>
  );
}

let restoreDialogs: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  restoreDialogs = installTestDialogs();
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.mocked(apiClient.restoreSession).mockResolvedValue({
    actor: { id: "user-1", email: "admin@example.com", fullName: "Admin" },
    account: { passwordSetupRequired: false },
    memberships: [membership(["ORG_ADMIN"])],
  } as unknown as apiClient.CurrentSession);
  vi.mocked(apiClient.apiRequest).mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(apiClient, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(apiClient, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(apiClient, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(apiClient, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(apiClient, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [] });
  vi.spyOn(apiClient, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
  const notes = [privateNote("note-a", "Personal handover", 3), privateNote("note-b", "Second note", 1)];
  vi.spyOn(privateApi, "listPrivateNotes").mockResolvedValue({ items: notes, nextCursor: null });
  vi.spyOn(privateApi, "loadPrivateNote").mockImplementation(async (_platform, _org, id) => notes.find((note) => note.id === id)!);
  vi.spyOn(privateApi, "listPrivateCollections").mockResolvedValue([]);
  vi.spyOn(privateApi, "listPrivateTrash").mockResolvedValue([]);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("workspaceRoute /graph query preservation", () => {
  it("parses and round-trips /graph with and without query strings", () => {
    expect(parseWorkspacePath("/graph")).toEqual({ view: "graph", search: "" });
    expect(parseWorkspacePath("/graph/")).toEqual({ view: "graph", search: "" });
    expect(parseWorkspacePath("/graph/extra")).toBeNull();

    const queryUrl = "/graph?view=collections&typeCode=GUIDE&focusDocumentId=doc-42";
    const parsed = parseWorkspacePath(queryUrl);
    expect(parsed).toEqual({
      view: "graph",
      search: "?view=collections&typeCode=GUIDE&focusDocumentId=doc-42",
    });
    expect(workspacePath(parsed!)).toBe(queryUrl);
    expect(parseWorkspacePath("/graph", "?view=collections")).toEqual({
      view: "graph",
      search: "?view=collections",
    });
    expect(allowedRoute(parsed!, { admin: false, privateNotes: false, reviews: false })).toEqual(parsed);
  });

  it("includes graphSearch in routeForView while keeping Home default and existing routes unchanged", () => {
    const features = {
      knowledge: { home: { kind: "home" as const }, reviews: { kind: "reviews" as const } },
      conversationId: null,
      private: { kind: "root" as const },
      graphSearch: "?view=collections&typeCode=GUIDE",
    };
    expect(workspacePath(routeForView("graph", features))).toBe("/graph?view=collections&typeCode=GUIDE");
    expect(workspacePath(routeForView("knowledge", features))).toBe("/");
  });

  it("preserves /graph query strings across rememberReturnPath and takeReturnPath", () => {
    const target = "/graph?view=collections&typeCode=GUIDE&focusDocumentId=doc-1";
    rememberReturnPath(target);
    expect(takeReturnPath()).toBe(target);
    expect(takeReturnPath()).toBeNull();

    rememberReturnPath("/graph", "?view=accountability&focusDocumentId=doc-2");
    expect(takeReturnPath()).toBe("/graph?view=accountability&focusDocumentId=doc-2");
  });
});

describe("ArdenShell Web URL query preservation and history navigation", () => {
  it("preserves /graph query parameters on reload, filter pushState, and Back/Forward when only search changes", async () => {
    window.history.replaceState(null, "", "/graph?view=collections&typeCode=GUIDE&focusDocumentId=doc-1");
    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    expect(window.location.pathname).toBe("/graph");
    expect(window.location.search).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-1");
    expect(screen.getByTestId("graph-search").textContent).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-1");

    fireEvent.click(screen.getByRole("button", { name: "Focus Doc 9" }));
    await waitFor(() => expect(window.location.search).toBe("?view=accountability&focusDocumentId=doc-9"));
    expect(window.location.pathname).toBe("/graph");

    // Back changes only window.location.search while pathname stays /graph.
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-1"));
    await waitFor(() => expect(screen.getByTestId("graph-search").textContent).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-1"));

    window.history.forward();
    await waitFor(() => expect(window.location.search).toBe("?view=accountability&focusDocumentId=doc-9"));
    await waitFor(() => expect(screen.getByTestId("graph-search").textContent).toBe("?view=accountability&focusDocumentId=doc-9"));
  });

  it("remembers and restores /graph query parameters across sign-in redirect", async () => {
    let finishRestore!: (value: apiClient.CurrentSession | null) => void;
    vi.mocked(apiClient.restoreSession).mockReturnValueOnce(new Promise((resolve) => { finishRestore = resolve; }));
    window.history.replaceState(null, "", "/graph?view=collections&typeCode=GUIDE&focusDocumentId=doc-7");
    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));

    finishRestore(null);
    await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
    expect(window.location.search).toBe("");
    const saved = takeReturnPath();
    expect(saved).toBe("/graph?view=collections&typeCode=GUIDE&focusDocumentId=doc-7");

    cleanup();
    rememberReturnPath(saved!);
    window.history.replaceState(null, "", "/");
    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    await waitFor(() => expect(window.location.pathname).toBe("/graph"));
    expect(window.location.search).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-7");
    expect(screen.getByTestId("graph-search").textContent).toBe("?view=collections&typeCode=GUIDE&focusDocumentId=doc-7");
  });
});

describe("ArdenShell unified Company chat and Private isolation", () => {
  it("shares one live Company chat across AskArdenPage, Graph AgentPanel, and survives a Private visit", async () => {
    const citation = {
      documentId: "doc-1",
      versionId: "ver-1",
      blockId: "b1",
      page: 2,
      excerpt: "Approved travel requires manager sign-off.",
      title: "Travel Policy",
      version: "1.0",
      scope: "Company-wide",
      classification: "INTERNAL" as const,
    };
    const askCompany = vi.spyOn(apiClient, "askArden")
      .mockResolvedValueOnce({
        status: "ANSWERED",
        answer: "Manager sign-off is required.",
        citations: [citation],
        conversationId: "conv-1",
        revision: 1,
        turnId: "turn-1",
      })
      .mockResolvedValueOnce({
        status: "ANSWERED",
        answer: "Submit receipts within 14 days.",
        citations: [],
        conversationId: "conv-1",
        revision: 2,
        turnId: "turn-2",
      });
    const askPrivate = vi.spyOn(privateApi, "askPrivateNote").mockResolvedValue({
      status: "ANSWERED",
      answer: "Return the badge on Friday.",
      citations: [],
    });

    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    // 1. Start conversation on AskArdenPage and open Sources panel.
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    const askMain = await screen.findByRole("main", { name: "Ask Arden" });
    fireEvent.change(within(askMain).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "What is the travel policy?" } });
    fireEvent.click(within(askMain).getByRole("button", { name: "Send message" }));
    expect(await within(askMain).findByText("Manager sign-off is required.")).toBeTruthy();
    fireEvent.click(within(askMain).getByRole("button", { name: "View sources" }));
    expect(within(askMain).getByRole("complementary", { name: "Sources" })).toBeTruthy();

    // 2. Navigate to /graph via history/route and open docked AgentPanel: exact same thread & sources panel.
    window.history.pushState(null, "", "/graph?view=collections");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const graphMain = await screen.findByRole("main", { name: "Knowledge Graph" });
    fireEvent.click(within(graphMain).getByRole("button", { name: /^Ask Arden$/ }));
    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(panel).getByText("Manager sign-off is required.")).toBeTruthy();
    expect(within(panel).getByRole("complementary", { name: "Sources" })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Close sources" }));

    // 3. Send a follow-up from docked AgentPanel and verify revision continuity.
    fireEvent.change(within(panel).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "When are receipts due?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send message" }));
    expect(await within(panel).findByText("Submit receipts within 14 days.")).toBeTruthy();
    expect(askCompany.mock.calls[1]).toMatchObject([
      "web", "org-1", "When are receipts due?", { conversationId: "conv-1", expectedRevision: 1 },
    ]);

    // 4. Switch to Private: AgentPanel uses isolated Private note chat without destroying Company chat.
    fireEvent.click(screen.getAllByRole("button", { name: "Private" })[0]);
    const privateMain = await screen.findByRole("main", { name: "Private" });
    await waitFor(() => {
      const privatePanel = screen.getByRole("complementary", { name: "Ask Arden" });
      expect(within(privatePanel).getByText("Personal handover")).toBeTruthy();
    });
    const privatePanel = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(privatePanel).queryByText("Manager sign-off is required.")).toBeNull();

    fireEvent.change(within(privatePanel).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Badge return?" } });
    fireEvent.click(within(privatePanel).getByRole("button", { name: "Send message" }));
    expect(await within(privatePanel).findByText("Return the badge on Friday.")).toBeTruthy();
    expect(askPrivate).toHaveBeenCalledWith("web", "org-1", "note-a", 3, "Badge return?", expect.any(String));

    // Switching notes in Private still clears Private chat.
    fireEvent.click(screen.getAllByRole("button", { name: "Second note" })[0]);
    await waitFor(() => {
      const nextPrivatePanel = screen.getByRole("complementary", { name: "Ask Arden" });
      expect(within(nextPrivatePanel).getByText("Second note")).toBeTruthy();
    });
    expect(within(screen.getByRole("complementary", { name: "Ask Arden" })).queryByText("Return the badge on Friday.")).toBeNull();

    // 5. Return to Home (Company): the hoisted Company thread is restored intact!
    fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);
    await waitFor(() => {
      const restoredPanel = screen.getByRole("complementary", { name: "Ask Arden" });
      expect(within(restoredPanel).getByText("Manager sign-off is required.")).toBeTruthy();
    });
    const restoredPanel = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(restoredPanel).getByText("Submit receipts within 14 days.")).toBeTruthy();
    expect(within(restoredPanel).queryByText("Return the badge on Friday.")).toBeNull();

    // And returning to AskArdenPage shows both turns as well.
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    const askAgain = await screen.findByRole("main", { name: "Ask Arden" });
    expect(within(askAgain).getByText("Manager sign-off is required.")).toBeTruthy();
    expect(within(askAgain).getByText("Submit receipts within 14 days.")).toBeTruthy();
    expect(privateMain).toBeTruthy();
  });
});

describe("ArdenShell GraphIntentBus desktop parity and shell ReportIssueDialog host", () => {
  it.each(["web", "desktop"] as const)("opens Graph from a %s answer and rekeys a failed send when the scope changes", async (platform) => {
    const documentId = "00000000-0000-4000-8000-000000000001";
    const publishedVersionId = "00000000-0000-4000-8000-000000000002";
    const doc: HydratedDocumentSummary = {
      documentId, publishedVersionId, title: "Travel Policy", type: "Guide", version: "1.0",
      ownerDepartmentId: "dept-1", ownerDepartmentName: "Operations", authorDisplayName: null,
      publishedAt: "2026-11-01T00:00:00Z", validUntil: null, validityStatus: "Current", daysUntilExpiry: null,
      readerScope: "ORGANIZATION", collectionName: null, openMaintenanceCaseCount: null,
      openTarget: "READER", canReportIssue: true, canOpenMaintenance: false, canRenew: false,
    };
    const uiSurface: BoundUiSurface = {
      schemaVersion: 1, rootId: "root",
      nodes: {
        root: { kind: "stack", gap: "sm", childIds: ["answer", "graph", "pin"] },
        answer: { kind: "prose", markdown: "Travel approval is required." },
        graph: { kind: "graph_action", label: "Show travel policy in Graph", action: { op: "focus_nodes", documentIds: [documentId] } },
        pin: { kind: "graph_action", label: "Scope to travel policy", action: { op: "pin_to_context", documentIds: [documentId] } },
      },
      bindings: { documents: [{ documentId, publishedVersionId }], citationIndexes: [] },
    };
    const ask = vi.spyOn(apiClient, "askArden")
      .mockResolvedValueOnce({ status: "ANSWERED", answer: "Travel approval is required.", citations: [],
        conversationId: "company-chat", revision: 1, turnId: "turn-1", uiSurface,
        hydratedDocuments: { [publishedVersionId]: doc } })
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce({ status: "ANSWERED", answer: "Keep a receipt.", citations: [],
        conversationId: "company-chat", revision: 2, turnId: "turn-2" });
    render(createElement(ArdenShell, { platform, renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    const askMain = within(await screen.findByRole("main", { name: "Ask Arden" }));
    fireEvent.change(askMain.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "What is the policy?" } });
    fireEvent.click(askMain.getByRole("button", { name: "Send message" }));
    fireEvent.click(await askMain.findByRole("button", { name: "Show travel policy in Graph" }));
    await screen.findByRole("main", { name: "Knowledge Graph" });
    expect(window.location.pathname).toBe(platform === "web" ? "/graph" : "/");
    expect(screen.getByTestId("graph-intents").textContent).toContain(documentId);

    const panel = within(screen.getByRole("complementary", { name: "Ask Arden" }));
    expect(panel.getByText("Travel approval is required.")).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Scope to travel policy" }));
    expect(panel.getByText("Scoped to 1 document")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(panel.queryByText("Scoped to 1 document")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Scope to travel policy" }));
    fireEvent.change(panel.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "What is the follow-up?" } });
    fireEvent.click(panel.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(ask.mock.calls[1]?.[3]).toMatchObject({
      conversationId: "company-chat", expectedRevision: 1, scopeFilter: { documentIds: [documentId] },
    }));
    await panel.findByRole("alert");
    fireEvent.click(panel.getByRole("button", { name: "Clear scope" }));
    fireEvent.click(panel.getByRole("button", { name: "Send message" }));
    expect(await panel.findByText("Keep a receipt.")).toBeTruthy();
    const retry = ask.mock.calls[2]?.[3];
    expect(retry?.scopeFilter).toBeUndefined();
    expect(retry?.requestId).not.toBe(ask.mock.calls[1]?.[3]?.requestId);
  });

  it("dispatches GraphIntentBus intents identically on Electron (routing === false) and Web with live Company chat", async () => {
    vi.spyOn(apiClient, "askArden").mockResolvedValue({
      status: "ANSWERED",
      answer: "Desktop thread stays alive.",
      citations: [],
      conversationId: "conv-desktop",
      revision: 1,
      turnId: "turn-d1",
    });
    const bus = createGraphIntentBus();
    bus.dispatch({ type: "open_graph", view: "collections" });

    render(createElement(ArdenShell, {
      platform: "desktop",
      graphIntentBus: bus,
      renderGraphView: (ctx) => createElement(GraphHarness, ctx),
    }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    // Pre-session intents were cleared on org entry.
    expect(bus.peekPending()).toEqual([]);

    // Start a Company conversation on AskArdenPage.
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    const askMain = await screen.findByRole("main", { name: "Ask Arden" });
    fireEvent.change(within(askMain).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Desktop check?" } });
    fireEvent.click(within(askMain).getByRole("button", { name: "Send message" }));
    expect(await within(askMain).findByText("Desktop thread stays alive.")).toBeTruthy();

    // Trigger dispatchGraphIntent from another screen (Admin) on Electron: buffers intent, mounts /graph,
    // delivers intent on subscribe, opens AgentPanel on the shared Company thread, never mutates URL.
    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    fireEvent.click(await screen.findByRole("button", { name: "Focus doc 77 in Graph" }));

    expect(await screen.findByRole("main", { name: "Knowledge Graph" })).toBeTruthy();
    expect(screen.getByTestId("graph-search").textContent).toBe("?focusDocumentId=doc-77");
    expect(JSON.parse(screen.getByTestId("graph-intents").textContent || "[]")).toEqual([
      { type: "focus_nodes", documentIds: ["doc-77"] },
    ]);
    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(within(panel).getByText("Desktop thread stays alive.")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  it("syncs Web URL query state when dispatchGraphIntent navigates to /graph", async () => {
    render(createElement(ArdenShell, {
      platform: "web",
      renderGraphView: (ctx) => createElement(GraphHarness, ctx),
    }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    fireEvent.click(await screen.findByRole("button", { name: "Focus doc 77 in Graph" }));

    expect(await screen.findByRole("main", { name: "Knowledge Graph" })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe("/graph"));
    expect(window.location.search).toBe("?focusDocumentId=doc-77");
    expect(JSON.parse(screen.getByTestId("graph-intents").textContent || "[]")).toEqual([
      { type: "focus_nodes", documentIds: ["doc-77"] },
    ]);
  });

  it("opens the shell-level human-confirmed ReportIssueDialog from /graph and submits via Flow 4 API", async () => {
    const createCase = vi.spyOn(maintenanceClient, "createMaintenanceCase").mockResolvedValue({
      kind: "reporter",
      caseId: "case-99",
      reporterStatus: "Submitted",
    });
    vi.spyOn(maintenanceClient, "getMaintenanceCase").mockResolvedValue({
      kind: "reporter",
      caseId: "case-99",
      reporterStatus: "Submitted",
      documentId: "doc-1",
      publishedVersionId: "ver-1",
      title: "Security Handbook",
      description: "Link on page 2 is outdated.",
    });
    vi.spyOn(maintenanceClient, "listMaintenanceHistory").mockResolvedValue({ items: [], nextCursor: null });

    window.history.replaceState(null, "", "/graph");
    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    fireEvent.click(screen.getByRole("button", { name: "Report Graph Doc" }));

    // Dialog opens and waits for human confirmation (no autonomous submit).
    expect(createCase).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Report an issue", hidden: true })).toBeTruthy();
    expect(screen.getByText("Security Handbook")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("What needs attention?"), {
      target: { value: "Link on page 2 is outdated." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit report", hidden: true }));

    expect(await screen.findByText(/Case case-99/)).toBeTruthy();
    expect(createCase).toHaveBeenCalledWith(
      "web",
      "org-1",
      {
        documentId: "doc-1",
        publishedVersionId: "ver-1",
        description: "Link on page 2 is outdated.",
        anchor: { page: undefined, passage: undefined },
      },
      expect.any(String),
    );

    fireEvent.click(screen.getByRole("button", { name: "View in My reports", hidden: true }));
    await waitFor(() => expect(window.location.pathname).toBe("/reports/case-99"));
  });

  it("renders pin_to_context confirmation toast with Undo on AskArdenPage (/ask) and auto-dismisses it", async () => {
    const documentId = "00000000-0000-4000-8000-000000000011";
    const publishedVersionId = "00000000-0000-4000-8000-000000000012";
    const doc: HydratedDocumentSummary = {
      documentId, publishedVersionId, title: "Expense Policy", type: "Policy & Standard", version: "2.0",
      ownerDepartmentId: "dept-fin", ownerDepartmentName: "Finance", authorDisplayName: null,
      publishedAt: "2026-11-01T00:00:00Z", validUntil: null, validityStatus: "Current", daysUntilExpiry: null,
      readerScope: "ORGANIZATION", collectionName: null, openMaintenanceCaseCount: null,
      openTarget: "READER", canReportIssue: true, canOpenMaintenance: false, canRenew: false,
    };
    const uiSurface: BoundUiSurface = {
      schemaVersion: 1, rootId: "root",
      nodes: {
        root: { kind: "stack", gap: "sm", childIds: ["answer", "pin"] },
        answer: { kind: "prose", markdown: "Submit expenses within 30 days." },
        pin: { kind: "graph_action", label: "Scope to expense policy", action: { op: "pin_to_context", documentIds: [documentId] } },
      },
      bindings: { documents: [{ documentId, publishedVersionId }], citationIndexes: [] },
    };
    vi.spyOn(apiClient, "askArden").mockResolvedValueOnce({
      status: "ANSWERED",
      answer: "Submit expenses within 30 days.",
      citations: [],
      conversationId: "ask-toast-chat",
      revision: 1,
      turnId: "turn-1",
      uiSurface,
      hydratedDocuments: { [publishedVersionId]: doc },
    });

    render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });

    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    const askMain = await screen.findByRole("main", { name: "Ask Arden" });
    fireEvent.change(within(askMain).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Expense rules?" } });
    fireEvent.click(within(askMain).getByRole("button", { name: "Send message" }));

    fireEvent.click(await within(askMain).findByRole("button", { name: "Scope to expense policy" }));

    // Toast with Undo button must visibly render right inside AskArdenPage (which has no WorkspaceTopbar).
    expect(within(askMain).getByText("Scoped to 1 document")).toBeTruthy();
    expect(within(askMain).getByText("Scoped Ask Arden to 1 document.")).toBeTruthy();
    const undoButton = within(askMain).getByRole("button", { name: "Undo" });
    fireEvent.click(undoButton);

    expect(within(askMain).queryByText("Scoped to 1 document")).toBeNull();
    expect(within(askMain).queryByText("Scoped Ask Arden to 1 document.")).toBeNull();

    // Pin again and verify auto-dismiss removes the toast cleanly after 8s.
    vi.useFakeTimers();
    try {
      fireEvent.click(within(askMain).getByRole("button", { name: "Scope to expense policy" }));
      expect(within(askMain).getByText("Scoped Ask Arden to 1 document.")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(7_900); });
      expect(within(askMain).getByText("Scoped Ask Arden to 1 document.")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(200); });
      expect(within(askMain).queryByText("Scoped Ask Arden to 1 document.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles .is-context-resizing on .arden-app-shell during Ask Arden panel drag", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains("app-sidebar") ? 256 : 1440;
      return { width, height: 900, top: 0, left: 0, bottom: 900, right: width, x: 0, y: 0, toJSON: () => ({}) };
    });

    window.history.replaceState(null, "", "/graph");
    const view = render(createElement(ArdenShell, { platform: "web", renderGraphView: (ctx) => createElement(GraphHarness, ctx) }));
    await screen.findByRole("button", { name: /Workspace: Test Org/i });
    const graphMain = await screen.findByRole("main", { name: "Knowledge Graph" });
    fireEvent.click(within(graphMain).getByRole("button", { name: /^Ask Arden$/ }));

    const shell = view.container.querySelector(".arden-app-shell") as HTMLElement;
    const handle = await screen.findByRole("separator", { name: "Resize Ask Arden" });
    expect(shell.classList.contains("is-context-resizing")).toBe(false);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 1080 });
    expect(shell.classList.contains("is-context-resizing")).toBe(true);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 980 });
    expect(shell.classList.contains("is-context-resizing")).toBe(true);

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 980 });
    expect(shell.classList.contains("is-context-resizing")).toBe(false);
  });
});
