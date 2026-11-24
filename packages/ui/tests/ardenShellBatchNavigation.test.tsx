// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArdenShell } from "../src/app/ArdenShell";
import * as apiClient from "../src/shared/api-client";
import * as privateApi from "../src/shared/private-workspace-api";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    restoreSession: vi.fn(),
    apiRequest: vi.fn(),
  };
});

describe("ArdenShell Private sidebar", () => {
  it("uses the open note in Private and removes the composer from the Private root", async () => {
    const note = { id: "note-a", organizationId: "org-1", title: "Personal handover",
      currentVersion: { id: "version-a", version: 3 }, createdAt: "2026-11-24T00:00:00Z",
      updatedAt: "2026-11-24T00:00:00Z", body: "Return the badge Friday.", collectionId: null, favoritedAt: null };
    vi.spyOn(privateApi, "listPrivateNotes").mockResolvedValue({ items: [note], nextCursor: null });
    vi.spyOn(privateApi, "loadPrivateNote").mockResolvedValue(note);
    vi.spyOn(privateApi, "listPrivateCollections").mockResolvedValue([]);
    vi.spyOn(privateApi, "listPrivateTrash").mockResolvedValue([]);
    const ask = vi.spyOn(privateApi, "askPrivateNote").mockResolvedValue({
      status: "ANSWERED", answer: "Friday.", citations: [],
    });
    render(createElement(ArdenShell, { platform: "web" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test Org/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Private" })[0]);
    const privateRoot = await within(screen.getByRole("main", { name: "Private" }))
      .findByRole("button", { name: "Private", exact: true });
    fireEvent.click(within(screen.getByRole("main", { name: "Private" })).getByRole("button", { name: "Ask Arden", exact: true }));
    const ready = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(ready).getByText("Personal handover")).toBeTruthy();
    fireEvent.change(within(ready).getByRole("textbox", { name: "Ask Arden" }), { target: { value: "When?" } });
    fireEvent.click(within(ready).getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Friday.")).toBeTruthy();
    expect(ask).toHaveBeenCalledWith("web", "org-1", "note-a", 3, "When?", expect.any(String));
    fireEvent.click(privateRoot);
    const root = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(root).queryByRole("textbox")).toBeNull();
    expect(within(root).queryByText("Friday.")).toBeNull();
  });
});

vi.mock("../src/organization/OrganizationAdminPage", async () => {
  const { createElement: element } = await import("react");
  return {
    OrganizationAdminPage: ({ onSendingInvitationsChange, onDirtyChange }: {
      onSendingInvitationsChange: (sending: boolean) => void;
      onDirtyChange: (dirty: boolean) => void;
    }) =>
      element("main", null,
        element("p", null, "Batch in progress"),
        element("button", { onClick: () => onDirtyChange(true) }, "Mark unsaved"),
        element("button", { onClick: () => onSendingInvitationsChange(true) }, "Start batch"),
        element("button", { onClick: () => onSendingInvitationsChange(false) }, "Finish batch")),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.open = false; },
  });
  vi.mocked(apiClient.restoreSession).mockResolvedValue({
    actor: { id: "user-1", email: "admin@example.com", fullName: "Admin" },
    account: { passwordSetupRequired: false },
    memberships: [{ organization: { id: "org-1", name: "Test Org" }, status: "active", departmentId: "dept-1", roleCodes: ["ORG_ADMIN"], canUsePrivateWorkspace: true }],
  });
  vi.mocked(apiClient.apiRequest).mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(apiClient, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(apiClient, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(apiClient, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(apiClient, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(apiClient, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [] });
  vi.spyOn(apiClient, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  Reflect.deleteProperty(document, "fonts");
  vi.unstubAllGlobals();
});

describe("ArdenShell invitation batch navigation", () => {
  it("preserves an unsaved shared draft until workspace switching is confirmed", async () => {
    render(createElement(ArdenShell, { platform: "web" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test Org/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Home", exact: true })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Create from PDF" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Unsaved shared draft" } });
    const workspaceButton = screen.getByRole("button", { name: /Workspace: Test Org.*Switch or create workspace/i });
    fireEvent.click(workspaceButton);
    expect(screen.getByRole("heading", { name: "Discard changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Unsaved shared draft");
    fireEvent.click(workspaceButton);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Test Org/i }));
    fireEvent.click(screen.getByRole("button", { name: /Workspace: Test Org.*Switch or create workspace/i }));
    expect(screen.queryByRole("heading", { name: "Discard changes?" })).toBeNull();
  });

  it("lets a member with one workspace open the selector and create another", async () => {
    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create another organization/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Test Org/i }));
    const workspaceButton = await screen.findByRole("button", { name: /Workspace: Test Org.*Switch or create workspace/i });
    expect((workspaceButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(workspaceButton);
    expect(screen.getByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create another organization/i })).toBeTruthy();
  });

  it("keeps the administrator on the result page until sending finishes", async () => {
    render(createElement(ArdenShell, { platform: "web" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test Org/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Administration" }));
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Private" })[0]);
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    const unloadWhileSending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadWhileSending);
    expect(unloadWhileSending.defaultPrevented).toBe(true);
    fireEvent.click(document.querySelector(".sidebar-member") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish batch" }));
    const unloadAfterSending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadAfterSending);
    expect(unloadAfterSending.defaultPrevented).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Private" })[0]);
    await waitFor(() => expect(screen.queryByText("Batch in progress")).toBeNull());
  });

  it("asks before leaving unsaved organization edits for the workspace chooser", async () => {
    render(createElement(ArdenShell, { platform: "web" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test Org/i }));
    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark unsaved" }));
    const workspaceButton = screen.getByRole("button", { name: /Workspace: Test Org.*Switch or create workspace/i });
    fireEvent.click(workspaceButton);
    expect(screen.getByRole("heading", { name: "Discard changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    fireEvent.click(workspaceButton);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("heading", { name: "Choose your workspace" })).toBeTruthy();
  });
});
