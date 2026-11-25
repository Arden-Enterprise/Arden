// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { DirectSharesSection, SharedItemReader } from "../src/knowledge/DirectShares";
import { DirectSharingSettings } from "../src/organization/DirectSharingSettings";
import { parseWorkspacePath, workspacePath } from "../src/app/workspaceRoute";
import type { ItemShares } from "../src/shared/direct-share-api";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));

/** Spec F03-SHR (decision 0034): sharing a private item with named people, without review. */
let controllerRef: PrivateNotesController;
function Workspace() {
  const controller = usePrivateNotes([], []);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" }, createElement(PersonalWorkspacePage, {
    controller, platform: "web", organizationId: "org", contributionAttempt: null,
    onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
  }));
}

const note = { id: "n1", organizationId: "org", title: "Onboarding plan", body: "Step one", collectionId: null,
  createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z", currentVersion: { id: "v1", version: 1 },
  favoritedAt: null, position: null };
let settings: { enabled: boolean; recipientLimit: number };
let itemShares: ItemShares;
let requests: Array<{ method: string; path: string; body?: unknown }>;
let restoreDialogs: () => void;

const lan = { shareId: "s1", membershipId: "m-lan", name: "Lan Nguyen", email: "lan@example.test", active: true, sharedAt: "2026-11-26T00:00:00Z" };
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  settings = { enabled: true, recipientLimit: 3 };
  itemShares = { ...settings, recipients: [lan] };
  requests = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(api, "findKnowledgeReaders").mockResolvedValue([
    { id: "m-lan", name: "Lan Nguyen", email: "lan@example.test" }, { id: "m-minh", name: "Minh Tran", email: "minh@example.test" }]);
  vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, body });
    if (method === "GET" && path.includes("/drafts?")) return { items: [note], nextCursor: null };
    if (method === "GET" && path.endsWith("/collections")) return { items: [] };
    if (method === "GET" && path.endsWith("/trash")) return { items: [] };
    if (method === "GET" && path.endsWith("/drafts/n1")) return note;
    if (method === "GET" && path.endsWith("/direct-sharing")) return settings;
    if (method === "PUT" && path.endsWith("/direct-sharing")) { settings = body; return settings; }
    if (method === "GET" && path.endsWith("/drafts/n1/shares")) return itemShares;
    if (method === "POST" && path.endsWith("/drafts/n1/shares")) {
      itemShares = { ...itemShares, recipients: [...itemShares.recipients, ...body.recipientMembershipIds.map((id: string) => ({
        ...lan, shareId: `s-${id}`, membershipId: id, name: "Minh Tran", email: "minh@example.test" }))] };
      return itemShares;
    }
    if (method === "POST" && path.endsWith("/shares/s1/revoke")) {
      itemShares = { ...itemShares, recipients: itemShares.recipients.filter((recipient) => recipient.shareId !== "s1") };
      return itemShares;
    }
    if (method === "GET" && path.endsWith("/shared-with-me")) return { items: [
      { id: "p9", title: "Signed contract", kind: "pdf", ownerName: "Khoi", sharedAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", reviewed: false }] };
    if (method === "GET" && path.endsWith("/shared-with-me/n9")) return { id: "n9", title: "Team notes", kind: "note", ownerName: "Khoi",
      sharedAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", reviewed: false, version: 4, body: "Shared body" };
    if (method === "GET" && path.endsWith("/shared-with-me/p9")) return { id: "p9", title: "Signed contract", kind: "pdf", ownerName: "Khoi",
      sharedAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z", reviewed: false, version: 1, body: "" };
    if (method === "GET" && path.endsWith("/shared-with-me/p9/pdf")) return { pdfBase64: btoa("%PDF-1.7") };
    if (method === "GET" && path.endsWith("/shared-with-me/gone")) throw new api.ApiError(404, "This resource is not available.", "RESOURCE_NOT_AVAILABLE");
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

async function openShare() {
  render(createElement(Workspace));
  await act(() => controllerRef.connectServer("web", "org"));
  await act(async () => { controllerRef.openNote("n1"); });
  await waitFor(() => expect(controllerRef.selectedNote?.sourceVersionId).toBe("v1"));
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
}

describe("Share with people", () => {
  it("is offered with its consequence only while the organization allows it", async () => {
    await openShare();
    const people = await screen.findByRole("button", { name: /Share with people/ });
    expect(people.textContent).toContain("Not reviewed · view only · not an official document");
    cleanup();
    settings = { enabled: false, recipientLimit: 3 };
    await openShare();
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/direct-sharing"))).toBe(true));
    expect(screen.queryByRole("button", { name: /Share with people/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Contribute to a department/ })).toBeTruthy();
  });

  it("lists who has access, adds people by name, revokes one and suggests contributing near the limit", async () => {
    await openShare();
    fireEvent.click(await screen.findByRole("button", { name: /Share with people/ }));
    const panel = await screen.findByRole("dialog", { name: "Share with people" });
    const access = await within(panel).findByRole("region", { name: "People with access" });
    expect(access.textContent).toContain("Lan Nguyen");

    fireEvent.change(within(panel).getByRole("searchbox", { name: "Add people by name or email" }), { target: { value: "mi" } });
    // People who already have access are not offered again.
    const add = await within(panel).findByRole("button", { name: "Add Minh Tran, minh@example.test" });
    expect(within(panel).queryByRole("button", { name: /Add Lan Nguyen/ })).toBeNull();
    fireEvent.click(add);
    expect(within(panel).getByRole("note").textContent).toContain("contribute a copy for review");
    fireEvent.click(within(panel).getByRole("button", { name: "Share" }));
    await waitFor(() => expect(within(panel).getByText("Shared with Minh Tran")).toBeTruthy());
    expect(requests.find((request) => request.method === "POST" && request.path.endsWith("/shares"))?.body)
      .toEqual({ recipientMembershipIds: ["m-minh"] });

    fireEvent.click(within(panel).getByRole("button", { name: "Revoke access for Lan Nguyen" }));
    await waitFor(() => expect(within(panel).queryByText("Lan Nguyen")).toBeNull());
    // One of three people: no longer close to the limit.
    expect(within(panel).queryByRole("note")).toBeNull();
  });

  it("switches to contributing a copy when an item reaches many people", async () => {
    itemShares = { ...itemShares, recipients: [lan, { ...lan, shareId: "s2", membershipId: "m-minh", name: "Minh Tran" }] };
    await openShare();
    fireEvent.click(await screen.findByRole("button", { name: /Share with people/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Contribute instead" }));
    expect(screen.getByRole("dialog", { name: "Create review draft" })).toBeTruthy();
  });
});

describe("Items shared with me", () => {
  it("lists direct shares apart from publications and opens a PDF read-only without Download", async () => {
    const onOpen = vi.fn();
    render(createElement(DirectSharesSection, { platform: "web", organizationId: "org", refreshKey: 0, onOpen }));
    const section = await screen.findByRole("region", { name: "Shared directly — not reviewed" });
    expect(section.textContent).toContain("Shared by Khoi");
    expect(section.textContent).toContain("Not reviewed");
    fireEvent.click(within(section).getByRole("button", { name: /Signed contract/ }));
    expect(onOpen).toHaveBeenCalledWith("p9");
    cleanup();

    render(createElement(SharedItemReader, { platform: "web", organizationId: "org", itemId: "p9", renderText: () => null,
      onBack: vi.fn(), onLost: vi.fn() }));
    expect((await screen.findByRole("note")).textContent).toContain("Shared by Khoi — not reviewed · view only");
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/shared-with-me/p9/pdf"))).toBe(true));
    expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
  });

  it("shows a shared note's text and says when access has ended", async () => {
    const renderText = vi.fn((item: { body: string }) => createElement("p", null, item.body));
    render(createElement(SharedItemReader, { platform: "web", organizationId: "org", itemId: "n9", renderText, onBack: vi.fn(), onLost: vi.fn() }));
    expect(await screen.findByText("Shared body")).toBeTruthy();
    cleanup();
    const onLost = vi.fn();
    render(createElement(SharedItemReader, { platform: "web", organizationId: "org", itemId: "gone", renderText, onBack: vi.fn(), onLost }));
    expect((await screen.findByRole("alert")).textContent).toContain("You no longer have access to this item.");
    expect(onLost).toHaveBeenCalled();
  });

  it("has its own address so Back and reload return to it", () => {
    expect(parseWorkspacePath("/shared/p9")).toEqual({ view: "knowledge", at: { kind: "shared", id: "p9" } });
    expect(workspacePath({ view: "knowledge", at: { kind: "shared", id: "p9" } })).toBe("/shared/p9");
  });
});

describe("Organization sharing setting", () => {
  it("saves the switch and a limit between 1 and 100", async () => {
    render(createElement(DirectSharingSettings, { platform: "web", organizationId: "org" }));
    const limit = await screen.findByRole("spinbutton", { name: "People per item" });
    fireEvent.change(limit, { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(limit, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow sharing with people" }));
    expect(screen.getByRole("note").textContent).toContain("hides every item already shared");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Sharing settings saved."));
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ enabled: false, recipientLimit: 5 });
  });
});
