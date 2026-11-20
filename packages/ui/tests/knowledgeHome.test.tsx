// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { homeSourceItems, useHomePublications } from "../src/knowledge/useHomePublications";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import { emptyLibraryFilters, filterLibrary } from "../src/knowledge/KnowledgeLibraryBrowse";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => createElement("p", null, "Exact document content"), ArdenRichTextEditor: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: ({ search }: { search?: ReactNode }) => search ?? null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const common: api.PublishedKnowledge = { id: "common-version", draftId: "common-doc", title: "Common working guide", classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null }, responsibleDepartmentId: "finance", responsibleDepartmentName: "Finance",
  audienceIds: [], contentHash: "hash", body: "Exact document content", mimeType: "text/plain", publishedAt: "2026-11-19T00:00:00Z",
  validFrom: "2026-11-19T00:00:00Z", validUntil: null, management: { type: "Guide", version: "1.0", effectiveDate: null, expirationDate: null, changeNote: "" } };
const assigned = { ...common, id: "assigned-version", draftId: "assigned-doc", title: "Common reference", management: { ...common.management!, type: "Reference" as const } };
const department = { ...common, id: "department-version", draftId: "department-doc", title: "Department access procedure",
  targetReaders: { mode: "DEPARTMENT" as const, departmentId: "engineering", memberIds: [] } };
const selected = { ...common, id: "selected-version", draftId: "selected-doc", title: "Selected working guide",
  targetReaders: { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: ["synthetic-member"] } };
const legacy = { ...common, id: "old-version", draftId: "old-doc", title: "Legacy readable guidance", targetReaders: null };
const catalog: api.KnowledgeCatalog = { canManage: true, topics: [], collections: [{ id: "folder", name: "Company handbook", description: "", status: "ACTIVE", version: 1,
  cover: "handbook", allowedTypes: ["Guide", "Reference"], documentIds: [assigned.id] }] };
const props = { platform: "web" as const, organizationId: "org", organizationName: "Synthetic organization", view: "knowledge" as const,
  active: true, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(), canUsePrivateWorkspace: true };
function setup() {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [{ id: "engineering", name: "Engineering" }], audiences: [], primaryDepartmentId: "engineering" });
  vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue(catalog);
  const lists = vi.spyOn(api, "listPublishedKnowledge").mockImplementation(async (_platform, _org, scope) => scope === "ORGANIZATION" ? [common, assigned]
    : scope === "SHARED" ? [department, selected] : [common, assigned, department, selected, legacy]);
  vi.spyOn(api, "loadPublishedKnowledge").mockImplementation(async (_platform, _org, id) => [common, assigned, department, selected, legacy].find(item => item.id === id)!);
  return lists;
}
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const read = (title: string) => screen.queryByRole("button", { name: `Read ${title}` });

describe("Home source contract", () => {
  it("uses approved readers rather than owner department, selected count or title", () => {
    expect(homeSourceItems([common], "organization")).toEqual([common]);
    expect(homeSourceItems([department, selected], "shared")).toEqual([department, selected]);
    expect(homeSourceItems([common, department, selected, legacy], "other")).toEqual([legacy]);
    expect(() => homeSourceItems([department], "organization")).toThrow();
    expect(() => homeSourceItems([common], "shared")).toThrow();
    expect(() => homeSourceItems([legacy], "organization")).toThrow();
  });
  it("rejects malformed and ignored-scope responses instead of mixing results", () => {
    expect(() => homeSourceItems(null as unknown as api.PublishedKnowledge[], "organization")).toThrow();
    expect(() => homeSourceItems([null] as unknown as api.PublishedKnowledge[], "organization")).toThrow();
    expect(() => homeSourceItems([{ ...common, targetReaders: { ...common.targetReaders!, mode: "ADMIN" } }] as unknown as api.PublishedKnowledge[], "other")).toThrow();
    expect(() => homeSourceItems([common, department, legacy], "organization")).toThrow();
  });
  it("keeps assigned documents in the common master register and has a separate Unassigned filter", () => {
    expect(filterLibrary([common, assigned], catalog, "", emptyLibraryFilters())).toHaveLength(2);
    expect(filterLibrary([common, assigned], catalog, "", { ...emptyLibraryFilters(), collectionId: "unassigned" })).toEqual([common]);
    expect(filterLibrary([common, assigned], null, "", { ...emptyLibraryFilters(), collectionId: "unassigned" })).toEqual([]);
  });
  it.each(["web", "desktop"] as const)("requests the three bounded source views through %s", async platform => {
    const lists = setup(); const { result } = renderHook(() => useHomePublications(platform, "org"));
    await act(async () => { await result.current.refresh(); });
    expect(lists.mock.calls.map(call => call[2])).toEqual(["ORGANIZATION", "SHARED", "ALL_READABLE"]);
    expect(lists.mock.calls.every(call => call[0] === platform && call[1] === "org")).toBe(true);
    expect(result.current.views.other.items).toEqual([legacy]);
  });
  it("does not let a late refresh replace newer scope results", async () => {
    const pending: ((items: api.PublishedKnowledge[]) => void)[] = [];
    const lists = setup().mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    const { result } = renderHook(() => useHomePublications("web", "org"));
    let first!: Promise<void>; act(() => { first = result.current.refresh(); });
    lists.mockImplementation(async (_platform, _org, scope) => scope === "ORGANIZATION" ? [assigned] : []);
    await act(async () => { await result.current.refresh(); });
    await act(async () => { pending[0]!([common]); pending[1]!([department]); pending[2]!([legacy]); await first; });
    expect(result.current.views.organization.items).toEqual([assigned]);
    expect(result.current.views.shared.items).toEqual([]); expect(result.current.views.other.items).toEqual([]);
  });
  it("clears old titles/counts on a failed refresh while other source views remain usable", async () => {
    const lists = setup(); const { result } = renderHook(() => useHomePublications("web", "org"));
    await act(async () => { await result.current.refresh(); });
    lists.mockImplementation(async (_platform, _org, scope) => { if (scope === "ORGANIZATION") throw new api.ApiError(403, "private diagnostic"); return scope === "SHARED" ? [selected] : []; });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.views.organization).toEqual({ status: "error", items: [] });
    expect(result.current.views.shared).toEqual({ status: "ready", items: [selected] });
  });
});

describe("connected Home composition", () => {
  it("allows another tab to load while one source is still waiting", async () => {
    let finish!: (items: api.PublishedKnowledge[]) => void;
    setup().mockImplementation(async (_platform, _org, scope) => scope === "ORGANIZATION"
      ? new Promise(resolve => { finish = resolve; }) : scope === "SHARED" ? [department] : []);
    const view = render(createElement(ServerKnowledgeFeaturePage, props));
    fireEvent.click(await screen.findByRole("tab", { name: /Shared with me/ }));
    await screen.findByRole("button", { name: `Read ${department.title}` }); expect(read(common.title)).toBeNull();
    view.unmount(); await act(async () => { finish([common]); });
  });
  it("never reuses the old organization's results after a context change", async () => {
    const pending: ((items: api.PublishedKnowledge[]) => void)[] = [];
    setup().mockImplementation(async (_platform, org, scope) => org === "org" ? new Promise(resolve => { pending.push(resolve); })
      : scope === "ORGANIZATION" ? [{ ...common, title: "Other organization guide" }] : []);
    const view = render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("tab", { name: /Organization/ });
    view.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, organizationId: "other-org" }));
    await screen.findByRole("button", { name: "Read Other organization guide" });
    await act(async () => { pending.forEach((finish, index) => finish(index === 0 ? [common] : index === 1 ? [department] : [legacy])); });
    expect(read(common.title)).toBeNull(); expect(read(department.title)).toBeNull();
    expect(tab(/Organization/).textContent).toBe("Organization1");
  });
  it("opens a shared citation independently of the Organization tab and returns to Shared with me", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, { ...props, citationTarget: {
      navigationId: "citation-1", documentId: department.draftId, versionId: department.id, excerpt: "Exact document content" } }));
    await screen.findByRole("heading", { name: "Document information" });
    expect(api.loadPublishedKnowledge).toHaveBeenCalledWith("web", "org", department.id);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(tab(/Shared with me/).getAttribute("aria-selected")).toBe("true"); expect(read(department.title)).toBeTruthy(); expect(read(common.title)).toBeNull();
  });
  it("removes a publication from discovery when opening it confirms access is lost", async () => {
    const lists = setup(); vi.mocked(api.loadPublishedKnowledge).mockRejectedValue(new api.ApiError(404, "This document is unavailable."));
    render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("button", { name: `Read ${common.title}` });
    lists.mockResolvedValue([]); fireEvent.click(read(common.title)!);
    await screen.findByText("This document is unavailable.");
    await waitFor(() => expect(read(common.title)).toBeNull());
    expect(screen.queryByRole("heading", { name: "Document information" })).toBeNull();
  });
  it("separates common, shared and legacy discovery/counts; Admin does not merge them", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("button", { name: `Read ${common.title}` });
    expect(tab(/Organization/).textContent).toBe("Organization2"); expect(tab(/Shared with me/).textContent).toBe("Shared with me2");
    expect(read(department.title)).toBeNull(); expect(read(selected.title)).toBeNull(); expect(read(legacy.title)).toBeNull();
    fireEvent.click(tab(/Shared with me/)); expect(read(department.title)).toBeTruthy(); expect(read(selected.title)).toBeTruthy();
    expect(screen.getByText("Department readers")).toBeTruthy(); expect(screen.getByText("Selected readers")).toBeTruthy();
    expect(screen.queryByText("synthetic-member")).toBeNull();
    expect(read(common.title)).toBeNull(); expect(screen.queryByRole("combobox", { name: "Collection" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Company handbook|Manage collections/ })).toBeNull();
    fireEvent.click(tab(/Other documents/)); expect(read(legacy.title)).toBeTruthy(); expect(read(common.title)).toBeNull();
    expect(screen.getByText("Readable documents with sharing details not recorded.")).toBeTruthy();
  });
  it("opens folder contents, All includes assigned and unassigned, and Unassigned is narrower", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props));
    fireEvent.click(await screen.findByRole("button", { name: /Company handbook/ }));
    expect(read(assigned.title)).toBeTruthy(); expect(read(common.title)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All documents" })); expect(read(common.title)).toBeTruthy(); expect(read(assigned.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" })); expect(read(common.title)).toBeTruthy(); expect(read(assigned.title)).toBeNull();
  });
  it("retains each scope's search/filter state and reader Back restores the origin and focus", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("button", { name: `Read ${common.title}` });
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "working" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "Guide" } });
    fireEvent.click(tab(/Shared with me/)); expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Type" }) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Selected" } }); expect(read(department.title)).toBeNull();
    fireEvent.click(tab(/Organization/)); expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("working");
    expect((screen.getByRole("combobox", { name: "Collection" }) as HTMLSelectElement).value).toBe("unassigned");
    fireEvent.click(read(common.title)!); await screen.findByRole("heading", { name: "Document information" });
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(read(common.title)).toBe(document.activeElement); expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("working");
    fireEvent.click(tab(/Shared with me/)); expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Selected");
  });
  it("preserves legacy readability/owner labels separately when scoped results are empty", async () => {
    setup().mockImplementation(async (_platform, _org, scope) => scope === "ALL_READABLE" ? [legacy] : []);
    render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByText("No documents available"); expect(read(legacy.title)).toBeNull();
    fireEvent.click(tab(/Other documents/)); expect(read(legacy.title)).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Finance" })).toBeTruthy();
  });
  it("shows outage, not empty or cached content; a deliberate retry can recover", async () => {
    const lists = setup().mockImplementation(async (_platform, _org, scope) => { if (scope === "ORGANIZATION") throw new Error("internal detail"); return scope === "SHARED" ? [department] : []; });
    render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("heading", { name: "Documents unavailable" }); expect(screen.queryByText("No documents available")).toBeNull();
    expect(screen.queryByText("internal detail")).toBeNull(); expect(tab(/Organization/).textContent).toBe("Organization");
    fireEvent.click(tab(/Shared with me/)); expect(read(department.title)).toBeTruthy();
    lists.mockImplementation(async (_platform, _org, scope) => scope === "ORGANIZATION" ? [common] : []);
    fireEvent.click(tab(/Organization/)); fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: `Read ${common.title}` });
  });
  it("keeps private originals as a capability-gated route, never a published source", async () => {
    const lists = setup(), open = vi.fn(); const view = render(createElement(ServerKnowledgeFeaturePage, { ...props, onOpenPrivateNotes: open }));
    fireEvent.click(await screen.findByRole("button", { name: "Private notes" })); expect(open).toHaveBeenCalledOnce();
    expect(screen.getByText("Only you")).toBeTruthy(); expect(lists.mock.calls).toHaveLength(3);
    view.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, onOpenPrivateNotes: open, canUsePrivateWorkspace: false }));
    expect((screen.getByRole("button", { name: "Private notes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Unavailable in this workspace")).toBeTruthy();
  });
  it("keeps Contributions separate and keyboard arrows skip disabled planned tabs", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props)); await screen.findByRole("tab", { name: /Organization/ });
    const tabs = screen.getByRole("tablist", { name: "Home knowledge" });
    const start = within(tabs).getByRole("tab", { name: /Organization/ }); start.focus(); fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(tab(/Shared with me/)).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: "End" }); expect(tab(/My Contributions/)).toBe(document.activeElement);
    expect(screen.getByText("No contributions yet")).toBeTruthy(); expect(screen.queryByText("Only you")).toBeTruthy();
    expect(read(common.title)).toBeNull(); expect(screen.queryByRole("combobox", { name: "Collection" })).toBeNull();
  });
  it("keeps All usable when catalog fails and never reports Unassigned as empty", async () => {
    setup(); vi.mocked(api.loadKnowledgeCatalog).mockRejectedValue(new Error("catalog outage"));
    render(createElement(ServerKnowledgeFeaturePage, props)); await screen.findByRole("button", { name: `Read ${common.title}` });
    fireEvent.click(screen.getByRole("button", { name: "All documents" })); expect(read(common.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(screen.getByText("Collection unavailable. Clear filters to browse documents.")).toBeTruthy(); expect(screen.queryByText("No results")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); expect(read(common.title)).toBeTruthy();
  });
  it("restores Home navigation if catalog refresh fails while management is open", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("button", { name: /Manage collections/ });
    fireEvent.click(screen.getByRole("button", { name: /Manage collections/ }));
    expect(await screen.findByRole("heading", { name: "Manage collections" })).toBeTruthy();
    vi.mocked(api.loadKnowledgeCatalog).mockRejectedValue(new Error("catalog outage"));
    fireEvent.focus(window);
    await screen.findByRole("tab", { name: /Organization/ });
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    fireEvent.click(tab(/Shared with me/));
    expect(await screen.findByRole("button", { name: `Read ${department.title}` })).toBeTruthy();
  });
  it("Overview exits search and returns to common discovery without changing Shared filters", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props)); await screen.findByRole("button", { name: `Read ${common.title}` });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } }); expect(screen.getByText("No results")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All documents" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(""); expect(screen.getByRole("heading", { name: "Collections" })).toBeTruthy();
  });
  it("keeps a selected type active after clearing an Overview search", async () => {
    setup(); render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("button", { name: `Read ${common.title}` });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "common" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "Guide" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect((screen.getByRole("combobox", { name: "Type" }) as HTMLSelectElement).value).toBe("Guide");
    expect(read(common.title)).toBeTruthy(); expect(read(assigned.title)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Collections" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("heading", { name: "Collections" })).toBeTruthy();
  });
  it("cannot treat an older server ignoring scope as the Organization register", async () => {
    setup().mockResolvedValue([common, department, legacy]); render(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("heading", { name: "Documents unavailable" }); expect(read(common.title)).toBeNull();
    fireEvent.click(tab(/Other documents/)); expect(read(legacy.title)).toBeTruthy(); expect(read(department.title)).toBeNull();
  });
});
