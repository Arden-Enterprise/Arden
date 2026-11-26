// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));

/** Spec F03-SHR (decision 0034): one Share button whose panel names each choice's consequence. */
let controllerRef: PrivateNotesController;
const onCreated = vi.fn();
function Workspace() {
  const controller = usePrivateNotes([], []);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" }, createElement(PersonalWorkspacePage, {
    controller, platform: "web", organizationId: "org", contributionAttempt: null,
    onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: onCreated, contextOpen: false, onToggleContext: vi.fn(),
  }));
}

const note = { id: "n1", organizationId: "org", title: "Onboarding checklist", body: "Step one", collectionId: null,
  createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z", currentVersion: { id: "v1", version: 1 },
  favoritedAt: null, position: null };

let restoreDialogs: () => void;
let contributed: string[];
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  contributed = [];
  onCreated.mockReset();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && path.includes("/drafts?")) return { items: [note], nextCursor: null };
    if (method === "GET" && path.endsWith("/collections")) return { items: [] };
    if (method === "GET" && path.endsWith("/trash")) return { items: [] };
    if (method === "GET" && path.endsWith("/drafts/n1")) return note;
    throw new Error(`Unexpected ${method} ${path}`);
  });
  vi.spyOn(api, "createKnowledgeDraft").mockImplementation(async (_platform, _org, versionId) => {
    contributed.push(versionId);
    return { id: "shared-1" } as Awaited<ReturnType<typeof api.createKnowledgeDraft>>;
  });
});
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

async function openNote() {
  render(createElement(Workspace));
  await act(() => controllerRef.connectServer("web", "org"));
  await act(async () => { controllerRef.openNote("n1"); });
  await waitFor(() => expect(controllerRef.selectedNote?.sourceVersionId).toBe("v1"));
}

describe("Share button", () => {
  it("replaces Create review draft and shows the contribution choice with its consequence", async () => {
    await openNote();
    expect(screen.queryByRole("button", { name: "Create review draft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const panel = screen.getByRole("dialog", { name: "Share" });
    expect(panel.textContent).toContain("Onboarding checklist");
    const contribute = within(panel).getByRole("button", { name: /Contribute to a department or the organization/ });
    expect(contribute.textContent).toContain("Creates a copy for review · becomes an official document after approval");
  });

  it("opens the existing contribution form, goes back to the choices and creates the copy", async () => {
    await openNote();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: /Contribute to a department/ }));
    const form = screen.getByRole("dialog", { name: "Create review draft" });
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Share" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Contribute to a department/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create review draft" })).getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(contributed).toEqual(["v1"]);
    expect(screen.queryByRole("dialog", { name: "Share" })).toBeNull();
  });

  it("asks to save first before contributing an edited note, and closes with Escape", async () => {
    await openNote();
    act(() => controllerRef.editBody("Step one, edited"));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const contribute = screen.getByRole("button", { name: /Contribute to a department/ });
    expect((contribute as HTMLButtonElement).disabled).toBe(true);
    expect(contribute.textContent).toContain("Save your changes before contributing a copy.");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Share" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Share" })).toBeNull();
  });
});
