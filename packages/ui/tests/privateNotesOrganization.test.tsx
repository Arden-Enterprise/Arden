// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AppSidebar } from "../src/app/AppSidebar";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { childrenOf, favoriteItems, moveDestinations } from "../src/personal-workspace/privateNotesModel";
import { trashMeta } from "../src/personal-workspace/PrivateNotesTrash";
import type { PrivateCollection, PrivateNote } from "../src/shared/types";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => import("./richEditorStub"));
vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));

const collections: PrivateCollection[] = [
  { id: "c1", title: "Capstone", parentId: null, favoritedAt: null },
  { id: "c2", title: "Sprints", parentId: "c1", favoritedAt: null },
  { id: "c3", title: "Reading", parentId: null, favoritedAt: null },
];
const notes: PrivateNote[] = [
  { id: "n1", title: "Loose idea", body: "Root body", updatedLabel: "Saved", collectionId: null },
  { id: "n2", title: "Sprint plan", body: "Plan body", updatedLabel: "Saved", collectionId: "c2" },
  { id: "n3", title: "Dashboard", body: "Dash body", updatedLabel: "Saved", collectionId: "c1" },
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
function Workspace({ seedNotes = notes, seedCollections = collections, connect }: {
  seedNotes?: PrivateNote[]; seedCollections?: PrivateCollection[]; connect?: boolean;
}) {
  const controller = usePrivateNotes(seedNotes, seedCollections);
  controllerRef = controller;
  return createElement("div", { className: "arden-app-shell" },
    createElement(AppSidebar, {
      activeView: "personal-workspace", platform: "web", memberName: "Lan Nguyen", memberRole: "Member", onNavigate: vi.fn(), onSignOut: vi.fn(), onOpenSettings: vi.fn(),
      privateNotes: { controller, pageVisible: true, onOpen: vi.fn() },
      trashCount: controller.trash.length, onOpenTrash: () => controller.openTrash(),
    }),
    createElement(PersonalWorkspacePage, {
      controller, platform: "web", organizationId: connect ? "org" : "", contributionAttempt: null,
      onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
    }));
}

/** Visible text without the icon font glyphs. */
const textOf = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(".arden-icon").forEach((icon) => icon.remove());
  return copy.textContent ?? "";
};
const tree = () => screen.getByRole("group", { name: "Private notes" });
const rowTitles = () => [...tree().querySelectorAll<HTMLElement>(".pn-row-main, .pn-section-label")].map(textOf);
const openRowMenu = (title: string, index = 0) =>
  fireEvent.click(within(tree()).getAllByRole("button", { name: `More actions for ${title}` })[index]!);
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

describe("private notes model", () => {
  it("orders collections before notes and keeps orphaned notes visible at the root", () => {
    const orphan = { id: "n9", title: "Orphan", body: "", updatedLabel: "", collectionId: "gone" };
    expect(childrenOf(collections, [...notes, orphan], null).map((item) => item.title)).toEqual(["Capstone", "Reading", "Loose idea", "Orphan"]);
    expect(childrenOf(collections, notes, "c1").map((item) => item.title)).toEqual(["Sprints", "Dashboard"]);
  });

  it("excludes a collection and its descendants from Move to and marks the current place", () => {
    const destinations = moveDestinations(collections, { kind: "collection", id: "c1", parentId: null });
    expect(destinations.map((entry) => entry.title)).toEqual(["Private", "Reading"]);
    expect(destinations[0]).toMatchObject({ current: true });
    const forNote = moveDestinations(collections, { kind: "note", id: "n2", parentId: "c2" });
    expect(forNote.map((entry) => [entry.title, entry.depth, entry.current])).toEqual([
      ["Private", 0, false], ["Capstone", 1, false], ["Sprints", 2, true], ["Reading", 1, false]]);
  });

  it("lists favorites oldest first across notes and collections", () => {
    const favorites = favoriteItems(
      [{ ...collections[2]!, favoritedAt: "2026-11-02" }],
      [{ ...notes[0]!, favoritedAt: "2026-11-01" }]);
    expect(favorites.map((item) => item.title)).toEqual(["Loose idea", "Reading"]);
  });

  it("describes trash batches with their origin and remaining days", () => {
    const now = Date.parse("2026-11-23T00:00:00Z");
    expect(trashMeta({ batchId: "b", kind: "note", id: "n", title: "x", fromCollectionTitle: null, itemCount: 1,
      trashedAt: "2026-11-23T00:00:00Z", purgeAfter: "2026-12-23T00:00:00Z" }, now)).toBe("From Private · Deletes in 30 days");
    expect(trashMeta({ batchId: "b", kind: "collection", id: "c", title: "x", fromCollectionTitle: "Capstone", itemCount: 3,
      trashedAt: "2026-11-23T00:00:00Z", purgeAfter: "2026-11-24T00:00:00Z" }, now)).toBe("From Capstone · 3 items · Deletes in 1 day");
  });
});

describe("Private tree in demo mode", () => {
  it("renders collections before notes, expands nested collections and shows no Favorites section without favorites", () => {
    render(createElement(Workspace));
    expect(rowTitles()).toEqual(["Capstone", "Reading", "Loose idea"]);
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    fireEvent.click(within(tree()).getByRole("button", { name: "Expand Capstone" }));
    fireEvent.click(within(tree()).getByRole("button", { name: "Expand Sprints" }));
    expect(rowTitles()).toEqual(["Capstone", "Sprints", "Sprint plan", "Dashboard", "Reading", "Loose idea"]);
    fireEvent.click(within(tree()).getByRole("button", { name: "Expand Reading" }));
    expect(within(tree()).getByText("No notes inside")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show or hide private notes" }));
    expect(screen.queryByRole("group", { name: "Private notes" })).toBeNull();
  });

  it("adds to favorites from the row menu, keeps the item in place and toggles from the note header", async () => {
    render(createElement(Workspace));
    openRowMenu("Loose idea");
    await act(async () => fireEvent.click(menuItem("Add to favorites")));
    const favorites = screen.getByRole("group", { name: "Favorites" });
    expect(within(favorites).getByRole("button", { name: "Loose idea" })).toBeTruthy();
    expect(rowTitles()).toEqual(["Favorites", "Loose idea", "Collections & notes", "Capstone", "Reading", "Loose idea"]);
    fireEvent.click(within(tree()).getAllByRole("button", { name: "Loose idea" })[0]!);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove from favorites" })));
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to favorites" })).toBeTruthy();
  });

  it("closes the menu with Escape and returns focus to its trigger", () => {
    render(createElement(Workspace));
    openRowMenu("Loose idea");
    const trigger = within(tree()).getByRole("button", { name: "More actions for Loose idea" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(menuItem("Add to favorites"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    openRowMenu("Loose idea");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("duplicates, renames inline and moves notes; Move to never offers a collection's own subtree", async () => {
    render(createElement(Workspace));
    openRowMenu("Loose idea");
    await act(async () => fireEvent.click(menuItem("Duplicate")));
    expect(rowTitles()).toContain("Loose idea (copy)");

    openRowMenu("Loose idea (copy)");
    fireEvent.click(menuItem("Rename"));
    const input = screen.getByRole("textbox", { name: "Rename Loose idea (copy)" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Renamed idea" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(rowTitles()).toContain("Renamed idea");

    openRowMenu("Capstone");
    fireEvent.click(menuItem("Move to"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Move to…")).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Move to Capstone" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Move to Sprints" })).toBeNull();
    const current = within(menu).getByRole("menuitem", { name: "Move to Private" }) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(within(current).getByText("Current")).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Escape" });

    openRowMenu("Renamed idea");
    fireEvent.click(menuItem("Move to"));
    await act(async () => fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move to Reading" })));
    // The destination expands so the moved note stays in view.
    expect(controllerRef.state.notes.find((note) => note.title === "Renamed idea")?.collectionId).toBe("c3");
    expect(within(tree()).getByRole("button", { name: "Collapse Reading" })).toBeTruthy();
    expect(rowTitles().slice(-3)).toEqual(["Reading", "Renamed idea", "Loose idea"]);
  });

  it("creates a collection and a note with an autofocused inline name that commits on Enter", async () => {
    render(createElement(Workspace));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New collection" })));
    let input = screen.getByRole("textbox", { name: "Rename Untitled collection" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Meetings" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(rowTitles()).toContain("Meetings");
    expect(screen.getByRole("heading", { name: "Meetings" })).toBeTruthy();

    await act(async () => fireEvent.click(within(tree()).getByRole("button", { name: "Add a note to Meetings" })));
    input = screen.getByRole("textbox", { name: "Rename Untitled private note" });
    fireEvent.change(input, { target: { value: "Weekly sync" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(rowTitles()).toEqual(expect.arrayContaining(["Meetings", "Weekly sync"]));
    expect(controllerRef.state.notes.find((note) => note.title === "Weekly sync")?.collectionId).toBe(controllerRef.collections.find((c) => c.title === "Meetings")?.id);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New note" })));
    input = screen.getByRole("textbox", { name: "Rename Untitled private note" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Rename Untitled private note" })).toBeNull();
  });

  it("moves a collection subtree to trash, restores it and deletes another permanently after confirmation", async () => {
    render(createElement(Workspace));
    openRowMenu("Capstone");
    await act(async () => fireEvent.click(menuItem("Move to trash")));
    expect(rowTitles()).toEqual(["Reading", "Loose idea"]);
    expect(controllerRef.state.notes.map((note) => note.id)).toEqual(["n1"]);

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Trash" }));
    expect(screen.getByRole("heading", { name: "Trash" })).toBeTruthy();
    expect(screen.getByText("Items in trash are permanently deleted after 30 days. Only you can see them.")).toBeTruthy();
    expect(screen.getByText("From Private · 4 items · Deletes in 30 days")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restore" })));
    expect(rowTitles()).toEqual(["Capstone", "Reading", "Loose idea"]);
    expect(controllerRef.state.notes).toHaveLength(3);
    expect(screen.getByText("Trash is empty.")).toBeTruthy();

    openRowMenu("Loose idea");
    await act(async () => fireEvent.click(menuItem("Move to trash")));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Loose idea")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" })));
    expect(screen.getByText("Trash is empty.")).toBeTruthy();
    expect(controllerRef.trash).toEqual([]);
  });

  it("asks before trashing a note with unsaved edits", async () => {
    render(createElement(Workspace));
    fireEvent.click(within(tree()).getByRole("button", { name: "Loose idea" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note content" }), { target: { value: "Unsaved" } });
    openRowMenu("Loose idea");
    await act(async () => fireEvent.click(menuItem("Move to trash")));
    expect(controllerRef.trashConfirm).toEqual({ kind: "note", id: "n1" });
    expect(rowTitles()).toContain("Loose idea, unsaved changes");
    act(() => controllerRef.cancelTrash());
    expect(controllerRef.state.drafts.n1?.body).toBe("Unsaved");
  });

  it("relies on autosave instead of a Save button in the note toolbar", async () => {
    render(createElement(Workspace));
    fireEvent.click(within(tree()).getByRole("button", { name: "Loose idea" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note content" }), { target: { value: "Edited" } });
    const toolbar = screen.getByRole("toolbar", { name: "Note actions" });
    expect(within(toolbar).getByText("Unsaved changes")).toBeTruthy();
    expect(within(toolbar).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("opens a collection page listing its children with a New note in this collection action", async () => {
    render(createElement(Workspace));
    fireEvent.click(within(tree()).getByRole("button", { name: "Capstone" }));
    const page = screen.getByRole("region", { name: "Capstone" });
    expect(within(page).getByText("Collection · 2 items · Only you")).toBeTruthy();
    expect(within(page).getAllByRole("button").map(textOf)).toEqual(
      expect.arrayContaining(["SprintsCollection", "DashboardNote", "New note in this collection"]));
    await act(async () => fireEvent.click(within(page).getByRole("button", { name: "New note in this collection" })));
    expect(controllerRef.selectedNote?.collectionId).toBe("c1");
  });
});

describe("top bar breadcrumb", () => {
  const crumbs = () => [...within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem")].map(textOf);

  it("starts at the outermost collection and navigates back through its steps", () => {
    render(createElement(Workspace));
    act(() => controllerRef.openNote("n2"));
    expect(crumbs()).toEqual(["Capstone", "Sprints", "Sprint plan"]);
    const bar = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(bar).queryByRole("button", { name: "Sprint plan" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Capstone" }));
    expect(screen.getByRole("region", { name: "Capstone" })).toBeTruthy();
    expect(crumbs()).toEqual(["Private", "Capstone"]);
  });

  it("shows the Private root only for top-level notes and returns to it", () => {
    render(createElement(Workspace));
    act(() => controllerRef.openNote("n1"));
    expect(crumbs()).toEqual(["Private", "Loose idea"]);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Private" }));
    expect(controllerRef.focus.kind).toBe("root");
  });
});

describe("account menu", () => {
  it("shows identity, Settings, Trash and sign-out, closing on Escape with focus returned", () => {
    render(createElement(Workspace));
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(within(menu).getByText("Member · Organization")).toBeTruthy();
    expect(within(menu).getAllByRole("menuitem").map(textOf)).toEqual(["Settings", "Trash", "Log out"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("server-backed organization actions", () => {
  const record = (id: string, title: string, collectionId: string | null, favoritedAt: string | null = null) => ({
    id, organizationId: "org", title, body: `${title} body`, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    currentVersion: { id: `${id}-v1`, version: 1 }, collectionId, favoritedAt,
  });
  const collection = { id: "c1", title: "Capstone", parentId: null, favoritedAt: null, createdAt: "", updatedAt: "" };

  it("calls the contract routes for favorite, move, trash, restore and purge", async () => {
    const entry = { batchId: "b1", kind: "collection", id: "c1", title: "Capstone", fromCollectionTitle: null, itemCount: 2,
      trashedAt: "2026-11-23T00:00:00Z", purgeAfter: "2026-12-23T00:00:00Z" };
    const request = vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) return { items: [record("n1", "Loose", null), record("n2", "Inside", "c1")], nextCursor: null };
      if (method === "GET" && path.endsWith("/drafts/n1")) return record("n1", "Loose", null);
      if (method === "GET" && path.endsWith("/drafts/n2")) return record("n2", "Inside", "c1");
      if (method === "GET" && path.endsWith("/collections")) return { items: [collection] };
      if (method === "GET" && path.endsWith("/trash")) return { items: [] };
      if (path.endsWith("/drafts/n1/favorite")) return record("n1", "Loose", null, "2026-11-23T00:00:00Z");
      if (path.endsWith("/drafts/n1/collection")) return record("n1", "Loose", "c1", "2026-11-23T00:00:00Z");
      if (path.endsWith("/collections/c1/trash")) return entry;
      if (path.endsWith("/trash/b1/restore")) return { collections: [collection], notes: [record("n2", "Inside", "c1")] };
      if (path.endsWith("/trash/b1/purge")) return undefined;
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(createElement(Workspace, { seedNotes: [], seedCollections: [], connect: true }));
    await act(() => controllerRef.connectServer("web", "org"));
    expect(rowTitles()).toEqual(["Capstone", "Loose"]);

    openRowMenu("Loose");
    await act(async () => fireEvent.click(menuItem("Add to favorites")));
    openRowMenu("Loose", 1);
    fireEvent.click(menuItem("Move to"));
    await act(async () => fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move to Capstone" })));
    await act(() => controllerRef.requestTrash({ kind: "collection", id: "c1" }));
    expect(controllerRef.trash).toHaveLength(1);
    await act(() => controllerRef.restore("b1"));
    await act(async () => { await controllerRef.requestTrash({ kind: "collection", id: "c1" }); await controllerRef.purge("b1"); });

    const writes = request.mock.calls.filter(([, , init]) => init?.method && init.method !== "GET")
      .map(([, path, init]) => [init!.method, path.replace("/api/v1/organizations/org/private-workspace", ""), init!.body ?? null]);
    expect(writes).toEqual([
      ["PUT", "/drafts/n1/favorite", JSON.stringify({ favorite: true })],
      ["PUT", "/drafts/n1/collection", JSON.stringify({ collectionId: "c1" })],
      ["POST", "/collections/c1/trash", null],
      ["POST", "/trash/b1/restore", null],
      ["POST", "/collections/c1/trash", null],
      ["POST", "/trash/b1/purge", null],
    ]);
    expect(controllerRef.trash).toEqual([]);
  });

  it("shows an explicit error and refreshes the tree when an action fails", async () => {
    let listCalls = 0;
    vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) { listCalls += 1; return { items: [record("n1", "Loose", null)], nextCursor: null }; }
      if (method === "GET" && path.endsWith("/drafts/n1")) return record("n1", "Loose", null);
      if (method === "GET" && (path.endsWith("/collections") || path.endsWith("/trash"))) return { items: [] };
      if (path.endsWith("/duplicate")) throw new api.ApiError(404, "Not found", "NOT_FOUND");
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(createElement(Workspace, { seedNotes: [], seedCollections: [], connect: true }));
    await act(() => controllerRef.connectServer("web", "org"));
    openRowMenu("Loose");
    await act(async () => fireEvent.click(menuItem("Duplicate")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("This item is no longer available."));
    expect(listCalls).toBe(2);
  });
});
