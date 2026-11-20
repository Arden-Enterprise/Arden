// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../src/shared/api-client";
import { KnowledgeCatalogEditor } from "../src/knowledge/KnowledgeCatalogEditor";
import { CollectionForm } from "../src/knowledge/CollectionForm";
import { CollectionPlacementEditor } from "../src/knowledge/CollectionPlacementEditor";
import { installTestDialogs } from "./dialogTestSupport";

const folder: api.KnowledgeCollection = { id: "folder", name: "Working guides", description: "", status: "ACTIVE", version: 3,
  cover: "handbook", allowedTypes: ["Guide"], documentIds: [] };
const catalog: api.KnowledgeCatalog = { canManage: true, topics: [], collections: [folder] };
const source: api.PublishedKnowledge = { id: "exact-version", draftId: "logical-document", title: "Access request guide", classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] }, responsibleDepartmentId: "hr", audienceIds: [], contentHash: "hash",
  publishedAt: "2026-11-19T00:00:00Z", validFrom: "2026-11-19T00:00:00Z", validUntil: null,
  management: { type: "Guide", version: "1.0", effectiveDate: null, expirationDate: null, changeNote: "" } };
let restore: () => void;
beforeEach(() => { restore = installTestDialogs(); });
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });
const formProps = () => ({ platform: "web" as const, organizationId: "org", entry: null as api.KnowledgeCollection | null,
  onSaved: vi.fn().mockResolvedValue(undefined), onCancel: vi.fn(), onBusy: vi.fn() });
const moveProps = () => ({ platform: "web" as const, organizationId: "org", publication: source, collections: [folder],
  onSaved: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), onBusy: vi.fn() });
function fill() {
  fireEvent.change(screen.getByRole("textbox", { name: "Name *" }), { target: { value: "Common guidance" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Guide" }));
}
describe("Collection configuration", () => {
  it("requires Name and controlled Allowed types, sends no placement or Topic fields", async () => {
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockResolvedValue(folder);
    const props = formProps(); render(createElement(CollectionForm, props));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Name *" }), { target: { value: "Common guidance" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Name *" }).closest("form")!);
    expect(save).not.toHaveBeenCalled();
    fill(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith("web", "org", "collections", null, { name: "Common guidance", description: "", status: "ACTIVE", cover: "handbook", allowedTypes: ["Guide"] });
    expect(screen.queryByLabelText(/Topic|Documents/)).toBeNull();
  });
  it("keeps an exit and guards dirty cancellation without saving", () => {
    const props = formProps(); render(createElement(CollectionForm, props)); fill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep working" })); expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" })); expect(props.onCancel).toHaveBeenCalledOnce();
  });
  it("preserves the editing revision across a background catalog refresh", async () => {
    const props = { ...formProps(), entry: folder };
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockRejectedValue(new api.ApiError(412, "raw"));
    const view = render(createElement(CollectionForm, props));
    fireEvent.change(screen.getByRole("textbox", { name: "Name *" }), { target: { value: "My edit" } });
    view.rerender(createElement(CollectionForm, { ...props, entry: { ...folder, version: 4, name: "Other edit" } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Collection changed. Reload before editing.");
    expect(save.mock.calls[0]![3]?.version).toBe(3);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload collections" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce()); expect(save).toHaveBeenCalledOnce();
  });
  it("does not retry an uncertain create or misreport a confirmed save if refresh fails", async () => {
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockRejectedValueOnce(new Error("network"));
    const props = formProps(); render(createElement(CollectionForm, props)); fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Couldn’t confirm the change. Reload to check.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });
  it("shows confirmed success separately from refresh failure", async () => {
    vi.spyOn(api, "saveKnowledgeCatalogEntry").mockResolvedValue(folder);
    const props = { ...formProps(), onSaved: vi.fn().mockRejectedValue(new Error("offline")) };
    render(createElement(CollectionForm, props)); fill(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved. Reload to update this view.");
  });
  it("confirms Archive, preserves cancel, and sends only inactive configuration", async () => {
    // Model native showModal moving focus before the parent's passive effects run.
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function(this: HTMLDialogElement) {
      this.setAttribute("open", ""); this.querySelector<HTMLElement>("[autofocus]")?.focus();
    });
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockResolvedValue({ ...folder, status: "INACTIVE" });
    render(createElement(CollectionForm, { ...formProps(), entry: folder }));
    const opener = screen.getByRole("button", { name: "Archive collection" }); opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("alertdialog"); expect(within(dialog).getByText(/They stay published/)).toBeTruthy();
    within(dialog).getByRole("button", { name: "Cancel" }).focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(screen.getByRole("button", { name: "Archive collection" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive collection" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![4]).toMatchObject({ status: "INACTIVE", allowedTypes: ["Guide"] });
    expect(save.mock.calls[0]![4]).not.toHaveProperty("documentIds");
  });
  it("shows archived folders read-only and leaves unconfigured folders explicitly unconfigured", () => {
    const props = { ...formProps(), entry: { ...folder, status: "INACTIVE" as const, allowedTypes: null } };
    render(createElement(CollectionForm, props));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Name *" }) as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Guide" }) as HTMLInputElement).checked).toBe(false);
  });
  it("ignores a completed write after its organization context unmounts", async () => {
    let finish!: (value: api.KnowledgeCatalogEntry) => void;
    vi.spyOn(api, "saveKnowledgeCatalogEntry").mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const props = formProps(), view = render(createElement(CollectionForm, props)); fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" })); view.unmount();
    await act(async () => { finish(folder); }); expect(props.onSaved).not.toHaveBeenCalled();
  });
});
describe("one-document placement", () => {
  it.each(["web", "desktop"] as const)("uses the logical ID and loaded revision on %s; filters incompatible destinations", async platform => {
    vi.spyOn(api, "loadCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: null, revision: 7 });
    const save = vi.spyOn(api, "saveCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: folder.id, revision: 8 });
    const props = { ...moveProps(), platform, collections: [folder, { ...folder, id: "other", name: "Policies", allowedTypes: ["Policy & Standard" as const] },
      { ...folder, id: "archived", name: "Archived", status: "INACTIVE" as const }, { ...folder, id: "legacy", name: "Legacy", allowedTypes: null }] };
    render(createElement(CollectionPlacementEditor, props));
    await screen.findByRole("option", { name: folder.name });
    expect(api.loadCollectionPlacement).toHaveBeenCalledWith(platform, "org", source.draftId);
    expect(screen.queryByRole("option", { name: /Policies|Archived|Legacy/ })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), { target: { value: folder.id } });
    fireEvent.click(screen.getByRole("button", { name: "Move", exact: true }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(platform, "org", { documentId: source.draftId, collectionId: null, revision: 7 }, folder.id);
  });
  it("removes a location using null without deleting or withdrawing", async () => {
    vi.spyOn(api, "loadCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: folder.id, revision: 2 });
    const save = vi.spyOn(api, "saveCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: null, revision: 3 });
    render(createElement(CollectionPlacementEditor, moveProps()));
    await screen.findByRole("combobox", { name: "Collection" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } }); fireEvent.click(screen.getByRole("button", { name: "Move", exact: true }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(save.mock.calls[0]![3]).toBeNull();
  });
  it.each([new api.ApiError(412, "raw"), new Error("network")])("forces a fresh read after conflict/uncertainty, never auto-retries", async cause => {
    const load = vi.spyOn(api, "loadCollectionPlacement").mockResolvedValueOnce({ documentId: source.draftId, collectionId: null, revision: 0 })
      .mockResolvedValueOnce({ documentId: source.draftId, collectionId: folder.id, revision: 1 });
    const save = vi.spyOn(api, "saveCollectionPlacement").mockRejectedValue(cause);
    render(createElement(CollectionPlacementEditor, moveProps())); await screen.findByRole("combobox");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: folder.id } }); fireEvent.click(screen.getByRole("button", { name: "Move", exact: true }));
    await screen.findByRole("button", { name: "Reload location" }); expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Move", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload location" }));
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(folder.id));
    expect(load).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledOnce();
  });
  it("allows exit on read denial without displaying raw server details", async () => {
    vi.spyOn(api, "loadCollectionPlacement").mockRejectedValue(new api.ApiError(404, "private title"));
    const props = moveProps(); render(createElement(CollectionPlacementEditor, props)); await screen.findByRole("alert");
    expect(screen.queryByText("private title")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("can cancel an unfinished read and ignores its late result", async () => {
    let finish!: (value: api.CollectionPlacement) => void;
    vi.spyOn(api, "loadCollectionPlacement").mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const props = moveProps(), view = render(createElement(CollectionPlacementEditor, props));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(props.onClose).toHaveBeenCalledOnce();
    view.unmount(); await act(async () => { finish({ documentId: source.draftId, collectionId: null, revision: 0 }); });
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
describe("manager integration", () => {
  it("discards pending read UI on privilege loss and does not revive it on regrant", async () => {
    let finish!: (value: api.CollectionPlacement) => void;
    vi.spyOn(api, "loadCollectionPlacement").mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const props = { platform: "web" as const, organizationId: "org", catalog, publications: [source], onSaved: vi.fn(), onClose: vi.fn() };
    const view = render(createElement(KnowledgeCatalogEditor, props));
    fireEvent.click(screen.getByRole("button", { name: `Move ${source.title}` }));
    view.rerender(createElement(KnowledgeCatalogEditor, { ...props, catalog: { ...catalog, canManage: false } }));
    await act(async () => { finish({ documentId: source.draftId, collectionId: null, revision: 0 }); });
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(createElement(KnowledgeCatalogEditor, props));
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("recovers a confirmed config save through GET after refresh failure, without another POST", async () => {
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockResolvedValue(folder);
    const load = vi.spyOn(api, "loadKnowledgeCatalog").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(catalog);
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog, publications: [source], onSaved: vi.fn(), onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "New collection" })); fill(); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved. Reload to update this view.");
    fireEvent.click(screen.getByRole("button", { name: "Reload collections" })); await screen.findByText("Updated.");
    expect(save).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledTimes(2);
  });
  it("refreshes after a move, shows folder contents and returns focus on Cancel", async () => {
    vi.spyOn(api, "loadCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: null, revision: 0 });
    vi.spyOn(api, "saveCollectionPlacement").mockResolvedValue({ documentId: source.draftId, collectionId: folder.id, revision: 1 });
    vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ ...catalog, collections: [{ ...folder, documentIds: [source.id] }] });
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog, publications: [source], onSaved: vi.fn(), onClose: vi.fn() }));
    const opener = screen.getByRole("button", { name: `Move ${source.title}` }); opener.focus(); fireEvent.click(opener);
    await screen.findByRole("combobox"); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: `Move ${source.title}` })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: `Move ${source.title}` })); await screen.findByRole("combobox");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: folder.id } }); fireEvent.click(screen.getByRole("button", { name: "Move", exact: true }));
    await screen.findByText("Updated."); expect(screen.queryByText(source.title)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: folder.name })); expect(screen.getByText(source.title)).toBeTruthy();
  });
  it("offers no management controls to a Member even if mounted directly", () => {
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog: { ...catalog, canManage: false }, publications: [source], onSaved: vi.fn(), onClose: vi.fn() }));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
