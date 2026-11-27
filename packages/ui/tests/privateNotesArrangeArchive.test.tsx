// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AppSidebar } from "../src/app/AppSidebar";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { arrangeArchived, compareNotes, notesIn, placeNote, serverIndex } from "../src/personal-workspace/privateNotesModel";
import type { PrivateCollection, PrivateNote } from "../src/shared/types";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));

/** Spec F03-ARR: note order, drag and drop, in-place collection titles and the Archived view. */
const collections: PrivateCollection[] = [
  { id: "c1", title: "Capstone", parentId: null, favoritedAt: null },
  { id: "c2", title: "Reading", parentId: null, favoritedAt: null },
];
const notes: PrivateNote[] = [
  { id: "n1", title: "Alpha", body: "a", updatedLabel: "Saved", collectionId: "c1", position: 1 },
  { id: "n2", title: "Beta", body: "b", updatedLabel: "Saved", collectionId: "c1", position: 2 },
  { id: "n3", title: "Gamma", body: "c", updatedLabel: "Saved", collectionId: "c1", position: 3 },
  { id: "n4", title: "Loose", body: "d", updatedLabel: "Saved", collectionId: null, favoritedAt: "2026-11-20T00:00:00Z" },
];

let restoreDialogs: () => void;
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
});
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

let controllerRef: PrivateNotesController;
function Workspace({ seedNotes = notes, seedCollections = collections, connect }: { seedNotes?: PrivateNote[]; seedCollections?: PrivateCollection[]; connect?: boolean }) {
  const controller = usePrivateNotes(seedNotes, seedCollections);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" },
    createElement(AppSidebar, {
      activeView: "personal-workspace", platform: "web", memberName: "Lan Nguyen", memberRole: "Member", onNavigate: vi.fn(), onSignOut: vi.fn(), onOpenSettings: vi.fn(),
      privateNotes: { controller, pageVisible: true, onOpen: vi.fn() },
      trashCount: controller.trash.length, onOpenTrash: () => controller.openTrash(), onOpenArchive: () => controller.openArchive(),
    }),
    createElement(PersonalWorkspacePage, {
      controller, platform: "web", organizationId: connect ? "org" : "", contributionAttempt: null,
      onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
    }));
}

const textOf = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(".arden-icon").forEach((icon) => icon.remove());
  return copy.textContent ?? "";
};
const tree = () => screen.getByRole("group", { name: "Private notes" });
const rowTitles = () => [...tree().querySelectorAll<HTMLElement>(".pn-row-main, .pn-section-label")].map(textOf);
const rowOf = (title: string) => within(tree()).getAllByRole("button", { name: title }).at(-1)!.closest(".pn-row") as HTMLElement;
const openRowMenu = (title: string) => fireEvent.click(within(tree()).getAllByRole("button", { name: `More actions for ${title}` }).at(-1)!);
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });
const expandCapstone = () => fireEvent.click(within(tree()).getByRole("button", { name: "Expand Capstone" }));
const dataTransfer = () => {
  const items = new Map<string, string>();
  return {
    setData: (format: string, value: string) => items.set(format, value),
    getData: (format: string) => items.get(format) ?? "",
    get types() { return [...items.keys()]; },
    effectAllowed: "",
    dropEffect: "",
  };
};

describe("note order model", () => {
  it("lists unplaced notes first (newest first, never-saved first), then by position, like the API", () => {
    const list: PrivateNote[] = [
      { id: "a", title: "Placed 2", body: "", updatedLabel: "", position: 2 },
      { id: "b", title: "Old", body: "", updatedLabel: "", createdAt: "2026-11-01T00:00:00Z" },
      { id: "c", title: "Placed 1", body: "", updatedLabel: "", position: 1 },
      { id: "d", title: "New", body: "", updatedLabel: "", createdAt: "2026-11-20T00:00:00Z" },
      { id: "e", title: "Pending", body: "", updatedLabel: "Not saved" },
    ];
    expect([...list].sort(compareNotes).map((note) => note.title)).toEqual(["Pending", "New", "Old", "Placed 1", "Placed 2"]);
  });

  it("renumbers the destination from 1 and returns only changed notes", () => {
    const changed = placeNote(collections, notes, "n3", "c1", 0);
    expect(changed.map((note) => [note.id, note.position])).toEqual([["n3", 1], ["n1", 2], ["n2", 3]]);
    const intoOther = placeNote(collections, notes, "n1", "c2", null);
    expect(intoOther).toEqual([expect.objectContaining({ id: "n1", collectionId: "c2", position: 1 })]);
    const nextOrder = notesIn(collections, notes.map((note) => changed.find((entry) => entry.id === note.id) ?? note), "c1");
    expect(nextOrder.map((note) => note.title)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("does not count never-saved notes in the index sent to the server", () => {
    const displayed: PrivateNote[] = [
      { id: "p", title: "Pending", body: "", updatedLabel: "Not saved" },
      { id: "x", title: "Saved", body: "", updatedLabel: "Saved" },
    ];
    expect(serverIndex(displayed, 2, (note) => note.updatedLabel === "Not saved")).toBe(1);
  });

  it("filters archived notes by title, sorts them and groups by original collection with the root last", () => {
    const items = [
      { id: "1", title: "Budget", collectionId: null, collectionTitle: null, archivedAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
      { id: "2", title: "Agenda", collectionId: "c1", collectionTitle: "Capstone", archivedAt: "2026-11-21T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" },
      { id: "3", title: "Backlog", collectionId: "c1", collectionTitle: "Capstone", archivedAt: "2026-11-23T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" },
    ];
    const byArchive = arrangeArchived(items, "", "archived");
    expect(byArchive.map((group) => [group.title, group.items.map((item) => item.title)]))
      .toEqual([["Capstone", ["Backlog", "Agenda"]], ["Private", ["Budget"]]]);
    expect(arrangeArchived(items, "", "title")[0]!.items.map((item) => item.title)).toEqual(["Agenda", "Backlog"]);
    expect(arrangeArchived(items, "", "updated")[0]!.items.map((item) => item.title)).toEqual(["Agenda", "Backlog"]);
    expect(arrangeArchived(items, "  BUD ", "archived").flatMap((group) => group.items.map((item) => item.id))).toEqual(["1"]);
    expect(arrangeArchived(items, "zzz", "archived")).toEqual([]);
  });
});

describe("arranging notes in the sidebar tree", () => {
  it("reorders notes inside a collection by drag and drop", async () => {
    render(createElement(Workspace));
    expandCapstone();
    expect(rowTitles()).toEqual(["Favorites", "Loose", "Collections & notes", "Capstone", "Alpha", "Beta", "Gamma", "Reading", "Loose"]);
    const transfer = dataTransfer();
    fireEvent.dragStart(rowOf("Alpha"), { dataTransfer: transfer });
    expect(rowOf("Alpha").classList.contains("is-dragging")).toBe(true);
    fireEvent.dragOver(rowOf("Capstone"), { dataTransfer: transfer });
    expect(rowOf("Capstone").classList.contains("is-drop-into")).toBe(true);
    // jsdom drag events carry no pointer position, so the lower half ("after") is chosen.
    fireEvent.dragOver(rowOf("Gamma"), { dataTransfer: transfer });
    expect(rowOf("Gamma").classList.contains("is-drop-after")).toBe(true);
    expect(rowOf("Capstone").classList.contains("is-drop-into")).toBe(false);
    await act(async () => fireEvent.drop(rowOf("Gamma"), { dataTransfer: transfer }));
    expect(rowTitles().slice(4, 7)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(controllerRef.state.notes.find((note) => note.id === "n1")?.position).toBe(3);
    expect(tree().querySelector(".is-dragging, .is-drop-before, .is-drop-after, .is-drop-into")).toBeNull();
  });

  it("moves a note into another collection and to the root by dropping on them", async () => {
    render(createElement(Workspace));
    expandCapstone();
    let transfer = dataTransfer();
    fireEvent.dragStart(rowOf("Beta"), { dataTransfer: transfer });
    await act(async () => fireEvent.drop(rowOf("Reading"), { dataTransfer: transfer }));
    expect(controllerRef.state.notes.find((note) => note.id === "n2")?.collectionId).toBe("c2");
    expect(within(tree()).getByRole("button", { name: "Collapse Reading" })).toBeTruthy();

    transfer = dataTransfer();
    fireEvent.dragStart(rowOf("Beta"), { dataTransfer: transfer });
    const rootRow = screen.getByRole("button", { name: "Show or hide private notes" }).closest(".pn-nav-row") as HTMLElement;
    await act(async () => fireEvent.drop(rootRow, { dataTransfer: transfer }));
    expect(controllerRef.state.notes.find((note) => note.id === "n2")?.collectionId).toBeNull();
  });

  it("offers Move up and Move down as the keyboard alternative, disabled at the ends", async () => {
    render(createElement(Workspace));
    expandCapstone();
    openRowMenu("Alpha");
    expect((menuItem("Move up") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(menuItem("Move down")));
    expect(rowTitles().slice(4, 7)).toEqual(["Beta", "Alpha", "Gamma"]);
    openRowMenu("Gamma");
    expect((menuItem("Move down") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(menuItem("Move up")));
    expect(rowTitles().slice(4, 7)).toEqual(["Beta", "Gamma", "Alpha"]);
    openRowMenu("Capstone");
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });
});

describe("collection title on its page", () => {
  it("edits in place: Enter saves and syncs the sidebar and breadcrumb, Escape cancels, empty is rejected", async () => {
    render(createElement(Workspace));
    fireEvent.click(within(tree()).getByRole("button", { name: "Capstone" }));
    const heading = screen.getByRole("heading", { name: "Capstone" });
    fireEvent.click(within(heading).getByRole("button", { name: "Capstone" }));
    let input = screen.getByRole("textbox", { name: "Rename Capstone" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("A collection needs a title.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Rename Capstone" })).toBe(input);

    fireEvent.change(input, { target: { value: "Thesis" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.getByRole("heading", { name: "Thesis" })).toBeTruthy();
    expect(within(tree()).getByRole("button", { name: "Thesis" })).toBeTruthy();
    const crumbs = [...within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem")].map(textOf);
    expect(crumbs).toEqual(["Private", "Thesis"]);

    fireEvent.click(within(screen.getByRole("heading", { name: "Thesis" })).getByRole("button", { name: "Thesis" }));
    input = screen.getByRole("textbox", { name: "Rename Thesis" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Thesis" })).toBeTruthy();

    // Leaving an emptied field keeps the old title instead of saving "Untitled collection".
    fireEvent.click(within(screen.getByRole("heading", { name: "Thesis" })).getByRole("button", { name: "Thesis" }));
    input = screen.getByRole("textbox", { name: "Rename Thesis" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => fireEvent.blur(input));
    expect(controllerRef.collections.find((collection) => collection.id === "c1")?.title).toBe("Thesis");
  });
});

describe("archived notes", () => {
  it("archives from the row menu, hides the note from the tree and favorites, then unarchives it to its place", async () => {
    render(createElement(Workspace));
    openRowMenu("Loose");
    await act(async () => fireEvent.click(menuItem("Archive")));
    expect(rowTitles()).toEqual(["Capstone", "Reading"]);
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(within(screen.getByRole("menu", { name: "Account" })).getAllByRole("menuitem").map(textOf))
      .toEqual(["Settings", "Archived", "Trash", "Log out"]);
    await act(async () => fireEvent.click(menuItem("Archived")));
    const page = screen.getByRole("region", { name: "Archived notes" });
    expect(within(page).getByRole("region", { name: "From Private" })).toBeTruthy();
    await act(async () => fireEvent.click(within(page).getByRole("button", { name: "Unarchive Loose" })));
    expect(within(page).getByText(/No archived notes\./)).toBeTruthy();
    expect(rowTitles()).toEqual(["Favorites", "Loose", "Collections & notes", "Capstone", "Reading", "Loose"]);
  });

  it("searches, and Delete moves the note to Trash rather than deleting it permanently", async () => {
    render(createElement(Workspace));
    expandCapstone();
    for (const title of ["Alpha", "Beta"]) {
      openRowMenu(title);
      await act(async () => fireEvent.click(menuItem("Archive")));
    }
    await act(async () => controllerRef.openArchive());
    const page = screen.getByRole("region", { name: "Archived notes" });
    expect(within(page).getByRole("region", { name: "From Capstone" })).toBeTruthy();
    fireEvent.change(within(page).getByRole("searchbox", { name: "Search archived notes" }), { target: { value: "alp" } });
    expect(within(page).queryByText("Beta")).toBeNull();
    expect(within(page).getByText("Alpha")).toBeTruthy();
    fireEvent.change(within(page).getByRole("searchbox", { name: "Search archived notes" }), { target: { value: "zzz" } });
    expect(within(page).getByText("No archived notes match “zzz”.")).toBeTruthy();
    fireEvent.change(within(page).getByRole("searchbox", { name: "Search archived notes" }), { target: { value: "" } });
    fireEvent.change(within(page).getByRole("combobox", { name: "Sort archived notes" }), { target: { value: "title" } });

    await act(async () => fireEvent.click(within(page).getByRole("button", { name: "Delete Beta: move it to trash" })));
    expect(controllerRef.archive.map((item) => item.title)).toEqual(["Alpha"]);
    expect(controllerRef.trash).toEqual([expect.objectContaining({ kind: "note", title: "Beta" })]);
    // Restoring it from Trash brings it back to its collection, not to Archived.
    await act(() => controllerRef.restore(controllerRef.trash[0]!.batchId));
    expect(controllerRef.state.notes.find((note) => note.title === "Beta")?.collectionId).toBe("c1");
  });

  it("keeps Archive unavailable for a note with unsaved edits", () => {
    render(createElement(Workspace));
    act(() => controllerRef.openNote("n4"));
    act(() => controllerRef.editBody("changed"));
    openRowMenu("Loose");
    expect((menuItem("Archive") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("server routes for order and archive", () => {
  const record = (id: string, title: string, collectionId: string | null, position: number | null = null) => ({
    id, organizationId: "org", title, body: `${title} body`, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    currentVersion: { id: `${id}-v1`, version: 1 }, collectionId, favoritedAt: null, position,
  });
  const collection = { id: "c1", title: "Capstone", parentId: null, favoritedAt: null, createdAt: "", updatedAt: "" };

  it("sends the placement index and the archive flag, and lists the archive", async () => {
    const request = vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) return { items: [record("n1", "One", "c1", 1), record("n2", "Two", "c1", 2)], nextCursor: null };
      if (method === "GET" && path.endsWith("/drafts/n1")) return record("n1", "One", "c1", 1);
      if (method === "GET" && path.endsWith("/drafts/n2")) return record("n2", "Two", "c1", 2);
      if (method === "GET" && path.endsWith("/collections")) return { items: [collection] };
      if (method === "GET" && path.endsWith("/trash")) return { items: [] };
      if (method === "GET" && path.endsWith("/archive")) return { items: [], hasMore: false };
      if (path.endsWith("/drafts/n2/collection")) return record("n2", "Two", "c1", 1);
      if (path.endsWith("/drafts/n1/archive")) return { ...record("n1", "One", "c1", 2), archivedAt: "2026-11-23T00:00:00Z" };
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(createElement(Workspace, { seedNotes: [], seedCollections: [], connect: true }));
    await act(() => controllerRef.connectServer("web", "org"));
    await act(() => controllerRef.shiftNote("n2", -1));
    await act(() => controllerRef.archiveNote("n1"));
    await act(async () => controllerRef.openArchive());
    const calls = request.mock.calls.map(([, path, init]) => [init?.method ?? "GET",
      path.replace("/api/v1/organizations/org/private-workspace", ""), init?.body ?? null]).filter(([method, path]) => method !== "GET" || path === "/archive");
    expect(calls).toEqual([
      ["PUT", "/drafts/n2/collection", JSON.stringify({ collectionId: "c1", index: 0 })],
      ["PUT", "/drafts/n1/archive", JSON.stringify({ archived: true })],
      ["GET", "/archive", null],
    ]);
    expect(controllerRef.state.notes.map((note) => note.id)).toEqual(["n2"]);
  });
});
