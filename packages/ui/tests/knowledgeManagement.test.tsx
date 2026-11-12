// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KnowledgeLibraryBrowse, emptyLibraryFilters, filterLibrary } from "../src/knowledge/KnowledgeLibraryBrowse";
import { KnowledgeCatalogEditor } from "../src/knowledge/KnowledgeCatalogEditor";
import { KnowledgeMetadataFields } from "../src/knowledge/KnowledgeMetadataFields";
import { emptyKnowledgeMetadata } from "@arden/domain";
import * as api from "../src/shared/api-client";
import { installTestDialogs } from "./dialogTestSupport";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const topic = { id: "topic", name: "People & work", description: "", status: "ACTIVE" as const, version: 1 };
const collection = { id: "collection", name: "Employee handbook", description: "Start here", status: "ACTIVE" as const, version: 1,
  cover: "handbook" as const, documentIds: ["readable"] };
const catalog: api.KnowledgeCatalog = { canManage: false, topics: [topic], collections: [collection] };
const publication: api.PublishedKnowledge = { id: "readable", draftId: "draft", title: "Working together", classification: "INTERNAL",
  responsibleDepartmentId: "hr", responsibleDepartmentName: "HR", documentCode: "ARD-123", audienceIds: [], contentHash: "hash",
  publishedAt: "2026-11-12T10:00:00Z", validFrom: "2026-11-12T10:00:00Z", validUntil: null,
  management: { type: "Guide", topicId: topic.id, topicName: topic.name, version: "1.0", effectiveDate: "2027-01-01",
    expirationDate: null, changeNote: "", releaseKind: "NEW" } };
describe("live Library management components", () => {
  it("uses exact canonical fields, not title prefixes, and keeps sort/filter behavior deterministic", () => {
    expect(filterLibrary([publication], catalog, "ARD-123", emptyLibraryFilters())).toHaveLength(1);
    expect(filterLibrary([publication], catalog, "HR", emptyLibraryFilters())).toHaveLength(1);
    expect(filterLibrary([publication], catalog, "", { ...emptyLibraryFilters(), type: "Procedure" })).toEqual([]);
    expect(filterLibrary([publication], catalog, "", { ...emptyLibraryFilters(), collectionId: "forged" })).toEqual([]);
    const legacy = { ...publication, id: "legacy", title: "Policy guide", management: null };
    expect(filterLibrary([legacy], catalog, "", { ...emptyLibraryFilters(), type: "Guide" })).toEqual([]);
  });
  it("browses a real collection and topic, and does not expose admin controls to members", () => {
    const onOpen = vi.fn();
    function Browse() {
      const [filters, setFilters] = useState(emptyLibraryFilters), [discover, setDiscover] = useState(true);
      return createElement(KnowledgeLibraryBrowse, { items: [publication], catalog, catalogError: "", query: "", filters,
        onFilters: setFilters, discover, onBrowse: () => setDiscover(false), onOpen, onManage: vi.fn() });
    }
    render(createElement(Browse));
    expect(screen.queryByRole("button", { name: /Manage catalog/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Employee handbook/ }).querySelector("img")?.getAttribute("src")).toContain("employee-handbook.png");
    fireEvent.click(screen.getByRole("button", { name: /Employee handbook/ }));
    expect(screen.getByRole("combobox", { name: "Type" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read Working together" })); expect(onOpen).toHaveBeenCalledWith("readable");
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "Procedure" } });
    expect(screen.getByText("No results")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); expect(screen.getByRole("button", { name: "Read Working together" })).toBeTruthy();
  });
  it("hides empty/unreadable collections and presents unavailable catalog honestly", () => {
    render(createElement(KnowledgeLibraryBrowse, { items: [], catalog, catalogError: "Catalog is unavailable.", query: "", filters: emptyLibraryFilters(),
      onFilters: vi.fn(), discover: true, onBrowse: vi.fn(), onOpen: vi.fn(), onManage: vi.fn() }));
    expect(screen.queryByRole("button", { name: /Employee handbook/ })).toBeNull();
    expect(screen.getByText("No documents available")).toBeTruthy();
    expect(screen.getByText("Catalog is unavailable.")).toBeTruthy();
  });
  it("keeps catalog form errors, cancel guard and chosen generated cover", async () => {
    const restore = installTestDialogs(); const close = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined);
    const save = vi.spyOn(api, "saveKnowledgeCatalogEntry").mockRejectedValue(new api.ApiError(412, "Catalog changed. Reload before saving."));
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog: { ...catalog, canManage: true }, publications: [publication], onSaved: refresh, onClose: close }));
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name *" }), { target: { value: "Engineering handbook" } });
    fireEvent.click(screen.getByRole("radio", { name: "Systems & operations" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Working together" }));
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await screen.findByText("Catalog changed. Reload before saving.");
    expect(save.mock.calls[0][4]).toMatchObject({ cover: "production", documentIds: ["readable"] });
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Keep working" })); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" })); expect(close).toHaveBeenCalledOnce(); restore();
  });
  it("does not default readership, shows optional expiration, and looks up explicit members", async () => {
    vi.spyOn(api, "findKnowledgeReaders").mockResolvedValue([{ id: "reader", name: "Selected colleague" }]);
    const onReaders = vi.fn();
    const view = render(createElement(KnowledgeMetadataFields, { value: emptyKnowledgeMetadata(), readers: null, topics: [topic], departments: [],
      busy: false, isUpdate: false, platform: "web", organizationId: "org", onChange: vi.fn(), onReaders }));
    expect((screen.getByRole("combobox", { name: "Target Readers" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByLabelText("Expiration Date")).toBeTruthy(); expect(screen.queryByLabelText("Change Note *")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Target Readers" }), { target: { value: "SELECTED_MEMBERS" } });
    expect(onReaders).toHaveBeenCalledWith({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] });
    view.rerender(createElement(KnowledgeMetadataFields, { value: emptyKnowledgeMetadata(), readers: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] },
      topics: [topic], departments: [], busy: false, isUpdate: true, platform: "web", organizationId: "org", onChange: vi.fn(), onReaders }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find members" }), { target: { value: "Selected" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Selected colleague" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Selected colleague" })); expect(onReaders).toHaveBeenLastCalledWith({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["reader"] });
  });
});
