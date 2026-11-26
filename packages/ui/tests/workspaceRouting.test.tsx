// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArdenShell } from "../src/app/ArdenShell";
import { allowedRoute, parseWorkspacePath, rememberReturnPath, routeForView, takeReturnPath, workspacePath } from "../src/app/workspaceRoute";
import * as apiClient from "../src/shared/api-client";
import * as privateApi from "../src/shared/private-workspace-api";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return { ...actual, restoreSession: vi.fn(), apiRequest: vi.fn() };
});

describe("workspace routes", () => {
  it("round-trips every workspace screen through its path", () => {
    const paths = ["/", "/new", "/documents/version-1", "/drafts/draft-1", "/reports/case-1",
      "/reviews", "/reviews/submission-1", "/reviews/maintenance", "/reviews/maintenance/case-1",
      "/ask", "/ask/chat-1", "/private", "/private/notes/note-1", "/private/collections/c-1", "/private/trash", "/private/archive",
      "/admin"];
    for (const path of paths) expect(workspacePath(parseWorkspacePath(path)!)).toBe(path);
    expect(parseWorkspacePath("/ask/")).toEqual({ view: "ask-arden", conversationId: null });
  });

  it("rejects addresses that are not workspace screens", () => {
    for (const path of ["/invite/abc", "/reset-password", "/documents", "/documents/a/b", "/new/x", "/admin/x",
      "/private/notes", "/private/other", "/reviews/maintenance/a/b", "/documents/a%2Fb", "/unknown"]) {
      expect(parseWorkspacePath(path)).toBeNull();
    }
  });

  it("describes the shown screen from what each feature reports", () => {
    const features = {
      knowledge: { home: { kind: "draft" as const, id: "draft-1" }, reviews: { kind: "maintenance-case" as const, caseId: "case-1" } },
      conversationId: "chat-1", private: { kind: "trash" as const },
    };
    expect(workspacePath(routeForView("knowledge", features))).toBe("/drafts/draft-1");
    expect(workspacePath(routeForView("review-queue", features))).toBe("/reviews/maintenance/case-1");
    expect(workspacePath(routeForView("ask-arden", features))).toBe("/ask/chat-1");
    expect(workspacePath(routeForView("personal-workspace", features))).toBe("/private/trash");
  });

  it("falls back to Home for a screen the member cannot open", () => {
    const member = { admin: false, privateNotes: false };
    expect(allowedRoute({ view: "organization-access" }, member)).toEqual({ view: "knowledge", at: { kind: "home" } });
    expect(allowedRoute({ view: "personal-workspace", at: { kind: "root" } }, member)).toEqual({ view: "knowledge", at: { kind: "home" } });
    expect(allowedRoute({ view: "ask-arden", conversationId: null }, member)).toEqual({ view: "ask-arden", conversationId: null });
  });

  it("keeps only a workspace address across a sign-in redirect, once", () => {
    rememberReturnPath("/reset-password");
    expect(takeReturnPath()).toBeNull();
    rememberReturnPath("/drafts/draft-1");
    expect(takeReturnPath()).toBe("/drafts/draft-1");
    expect(takeReturnPath()).toBeNull();
  });
});

function membership(roleCodes: string[]) {
  return { organization: { id: "org-1", name: "Test Org" }, status: "active", departmentId: "dept-1", roleCodes, canUsePrivateWorkspace: true };
}

function visibleSlot() {
  if (!document.querySelector<HTMLElement>(".workspace-feature-slot")?.hidden) return "ask";
  if (!document.querySelector<HTMLElement>(".knowledge-feature-slot")?.hidden) return "knowledge";
  return "other";
}

async function enterWorkspace(platform: "web" | "desktop" = "web") {
  render(createElement(ArdenShell, { platform }));
  // A restored session with one organization opens it directly.
  await screen.findByRole("button", { name: /Workspace: Test Org/i });
}

function privateNote(id: string, title: string) {
  return { id, organizationId: "org-1", title, currentVersion: { id: `${id}-v`, version: 1 }, createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z", body: `${title} body`, collectionId: null, favoritedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
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
  const notes = [privateNote("note-a", "Note A"), privateNote("note-b", "Note B")];
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
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ArdenShell browser history", () => {
  it("gives each screen an address so Back and Forward move between screens instead of leaving Arden", async () => {
    await enterWorkspace();
    expect(window.location.pathname).toBe("/");
    const startLength = window.history.length;

    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    await waitFor(() => expect(window.location.pathname).toBe("/ask"));
    expect(window.history.length).toBe(startLength + 1);
    expect(visibleSlot()).toBe("ask");

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(visibleSlot()).toBe("knowledge"));

    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/ask"));
    await waitFor(() => expect(visibleSlot()).toBe("ask"));
  });

  it("opens the screen named by the address after a reload", async () => {
    window.history.replaceState(null, "", "/ask");
    await enterWorkspace();
    await waitFor(() => expect(visibleSlot()).toBe("ask"));
    expect(window.location.pathname).toBe("/ask");
  });

  it("sends a member without Administration back to Home instead of an empty page", async () => {
    vi.mocked(apiClient.restoreSession).mockResolvedValue({
      actor: { id: "user-2", email: "member@example.com", fullName: "Member" },
      account: { passwordSetupRequired: false },
      memberships: [membership(["MEMBER"])],
    } as unknown as apiClient.CurrentSession);
    window.history.replaceState(null, "", "/admin");
    await enterWorkspace();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(visibleSlot()).toBe("knowledge");
  });

  it("returns to Home when a linked document or draft cannot be opened", async () => {
    const notFound = new apiClient.ApiError(404, "Not found", "NOT_FOUND");
    const load = vi.spyOn(apiClient, "loadPublishedKnowledge").mockRejectedValue(notFound);
    window.history.replaceState(null, "", "/documents/version-1");
    await enterWorkspace();
    await waitFor(() => expect(load).toHaveBeenCalledWith("web", "org-1", "version-1"));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(visibleSlot()).toBe("knowledge");
    cleanup();

    const draft = vi.spyOn(apiClient, "loadKnowledgeDraft").mockRejectedValue(notFound);
    window.history.replaceState(null, "", "/drafts/draft-1");
    await enterWorkspace();
    await waitFor(() => expect(draft).toHaveBeenCalledWith("web", "org-1", "draft-1"));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("opens a Private note from its address and steps back through the notes opened", async () => {
    window.history.replaceState(null, "", "/private/notes/note-b");
    await enterWorkspace();
    await waitFor(() => expect(screen.getByDisplayValue("Note B")).toBeTruthy());
    expect(window.location.pathname).toBe("/private/notes/note-b");

    fireEvent.click(screen.getAllByRole("button", { name: "Note A" })[0]);
    await waitFor(() => expect(window.location.pathname).toBe("/private/notes/note-a"));
    expect(screen.getByDisplayValue("Note A")).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/private/notes/note-b"));
    await waitFor(() => expect(screen.getByDisplayValue("Note B")).toBeTruthy());
  });

  it("steps back through Private notes to Home without rewriting earlier entries", async () => {
    await enterWorkspace();
    fireEvent.click(screen.getAllByRole("button", { name: "Private" })[0]);
    // Private picks its first note on opening; that choice takes the Private entry instead of adding one.
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/private\/notes\//));
    const firstPrivatePath = window.location.pathname;
    const target = firstPrivatePath === "/private/notes/note-b" ? "Note A" : "Note B";
    fireEvent.click(screen.getAllByRole("button", { name: target })[0]);
    await waitFor(() => expect(window.location.pathname).not.toBe(firstPrivatePath));

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe(firstPrivatePath));
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(visibleSlot()).toBe("knowledge"));
  });

  it("opens the Private root when a linked note no longer exists", async () => {
    window.history.replaceState(null, "", "/private/notes/gone");
    await enterWorkspace();
    await waitFor(() => expect(window.location.pathname).toBe("/private"));
  });

  it("opens a saved Ask Arden chat from its address, and a new chat when it cannot be opened", async () => {
    const load = vi.spyOn(apiClient, "loadAiConversation").mockResolvedValue({
      id: "chat-1", title: "Leave policy", revision: 1, createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z",
      turns: [{ id: "turn-1", requestId: "r-1", question: "How many leave days?", sequence: 1, answer: "Twelve.", status: "ANSWERED", citations: [] }],
    } as unknown as apiClient.AiConversation);
    window.history.replaceState(null, "", "/ask/chat-1");
    await enterWorkspace();
    expect(await screen.findByText("Twelve.")).toBeTruthy();
    expect(load).toHaveBeenCalledWith("web", "org-1", "chat-1");
    expect(window.location.pathname).toBe("/ask/chat-1");
    cleanup();

    load.mockRejectedValue(new apiClient.ApiError(404, "Not found", "NOT_FOUND"));
    window.history.replaceState(null, "", "/ask/chat-2");
    await enterWorkspace();
    await waitFor(() => expect(load).toHaveBeenCalledWith("web", "org-1", "chat-2"));
    await waitFor(() => expect(window.location.pathname).toBe("/ask"));
  });

  it("lands on the page kept before a Google sign-in redirect", async () => {
    rememberReturnPath("/ask");
    await enterWorkspace();
    await waitFor(() => expect(visibleSlot()).toBe("ask"));
    expect(window.location.pathname).toBe("/ask");
  });

  it("leaves the desktop file address alone", async () => {
    await enterWorkspace("desktop");
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Arden" })[0]);
    await waitFor(() => expect(visibleSlot()).toBe("ask"));
    expect(window.location.pathname).toBe("/");
  });
});

describe("ArdenShell entry addresses", () => {
  function twoOrganizations() {
    vi.mocked(apiClient.restoreSession).mockResolvedValue({
      actor: { id: "user-1", email: "admin@example.com", fullName: "Admin" },
      account: { passwordSetupRequired: false },
      memberships: [membership(["ORG_ADMIN"]), { ...membership(["MEMBER"]), organization: { id: "org-2", name: "Other Org" } }],
    } as unknown as apiClient.CurrentSession);
  }

  it("shows no sign-in form while the saved session is checked, then gives sign-in its address", async () => {
    let finish!: (value: apiClient.CurrentSession | null) => void;
    vi.mocked(apiClient.restoreSession).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    window.history.replaceState(null, "", "/private/notes/note-b");
    render(createElement(ArdenShell, { platform: "web" }));
    expect(screen.getByRole("status").textContent).toBe("Loading Arden…");
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    finish(null);
    await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
    expect(takeReturnPath()).toBe("/private/notes/note-b");
  });

  it("returns a reload to the organization opened last, and keeps the chooser at its own address", async () => {
    twoOrganizations();
    window.history.replaceState(null, "", "/ask");
    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
    expect(window.location.pathname).toBe("/workspaces");
    fireEvent.click(screen.getAllByRole("button", { name: /Other Org/i })[0]);
    await waitFor(() => expect(window.location.pathname).toBe("/ask"));
    cleanup();

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("button", { name: /Workspace: Other Org/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Choose your workspace" })).toBeNull();
    cleanup();

    window.history.replaceState(null, "", "/workspaces");
    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
  });

  it("moves to the chooser address when switching workspace", async () => {
    await enterWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /Workspace: Test Org/i }));
    expect(await screen.findByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
    expect(window.location.pathname).toBe("/workspaces");
  });
});
