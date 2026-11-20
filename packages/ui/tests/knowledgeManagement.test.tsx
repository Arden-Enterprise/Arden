// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KnowledgeLibraryBrowse, emptyLibraryFilters, filterLibrary } from "../src/knowledge/KnowledgeLibraryBrowse";
import { KnowledgeCatalogEditor } from "../src/knowledge/KnowledgeCatalogEditor";
import { KnowledgeMetadataFields, editableKnowledgeMetadata } from "../src/knowledge/KnowledgeMetadataFields";
import { emptyKnowledgeMetadata } from "@arden/domain";
import * as api from "../src/shared/api-client";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const topic = { id: "topic", name: "People & work", description: "", status: "ACTIVE" as const, version: 1 };
const collection = { id: "collection", name: "Employee handbook", description: "Start here", status: "ACTIVE" as const, version: 1,
  cover: "handbook" as const, documentIds: ["readable"] };
const catalog: api.KnowledgeCatalog = { canManage: false, topics: [topic], collections: [collection] };
const publication: api.PublishedKnowledge = { id: "readable", draftId: "draft", title: "Working together", classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
  responsibleDepartmentId: "hr", responsibleDepartmentName: "HR", audienceIds: [], contentHash: "hash",
  publishedAt: "2026-11-12T10:00:00Z", validFrom: "2026-11-12T10:00:00Z", validUntil: null,
  management: { type: "Guide", topicId: topic.id, topicName: topic.name, version: "1.0", effectiveDate: "2027-01-01",
    expirationDate: null, changeNote: "", releaseKind: "NEW" } };
describe("live Library management components", () => {
  it("does not report an empty Topic catalog when loading the catalog failed", () => {
    render(createElement(KnowledgeLibraryBrowse, { items: [], catalog: null,
      catalogError: "Catalog is unavailable.", query: "", filters: emptyLibraryFilters(),
      onFilters: vi.fn(), discover: true, onBrowse: vi.fn(), onOpen: vi.fn(), onManage: vi.fn() }));
    expect(screen.getByText("Catalog is unavailable.")).toBeTruthy();
    expect(screen.queryByText(/No topics yet/)).toBeNull();
  });
  it("uses exact canonical fields, not title prefixes, and keeps sort/filter behavior deterministic", () => {
    // Decision 0021: there is no Document Code to search.
    expect(filterLibrary([publication], catalog, "ARD-123", emptyLibraryFilters())).toHaveLength(0);
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
    expect(screen.queryByRole("button", { name: /Manage collections/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Topics" })).toBeNull();
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
  it("offers only unassigned Organization publications, even if restricted sources are readable", () => {
    const department = { ...publication, id: "department", title: "Department-only guide",
      targetReaders: { mode: "DEPARTMENT" as const, departmentId: "hr", memberIds: [] } };
    const selected = { ...publication, id: "selected", title: "Selected-member guide",
      targetReaders: { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: ["admin", "reader"] } };
    const legacy = { ...publication, id: "legacy", title: "Unmapped legacy guide", targetReaders: null };
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog: { ...catalog, canManage: true, collections: [] },
      publications: [publication, department, selected, legacy], onSaved: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() }));
    expect(screen.getByRole("button", { name: `Move ${publication.title}` })).toBeTruthy();
    expect(screen.queryByText(department.title)).toBeNull();
    expect(screen.queryByText(selected.title)).toBeNull();
    expect(screen.queryByText(legacy.title)).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find organization documents" }), { target: { value: department.title } });
    expect(screen.getByText("No matching documents.")).toBeTruthy();
  });
  it("shows a truthful empty Collection picker when only restricted publications are supplied", () => {
    render(createElement(KnowledgeCatalogEditor, { platform: "web", organizationId: "org", catalog: { ...catalog, canManage: true },
      publications: [{ ...publication, targetReaders: { mode: "DEPARTMENT", departmentId: "hr", memberIds: [] } }],
      onSaved: vi.fn(), onClose: vi.fn() }));
    expect(screen.getByText("No documents here.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("does not default readership, shows optional expiration, and looks up explicit members", async () => {
    vi.spyOn(api, "findKnowledgeReaders").mockResolvedValue([{ id: "reader", name: "Selected colleague",
      email: "colleague@example.test", department: "HR" }]);
    const onReaders = vi.fn();
    const view = render(createElement(KnowledgeMetadataFields, { value: emptyKnowledgeMetadata(), readers: null, departments: [],
      busy: false, isUpdate: false, platform: "web", organizationId: "org", onChange: vi.fn(), onReaders }));
    expect((screen.getByRole("combobox", { name: "Target Readers" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByLabelText(/^Valid until/)).toBeTruthy(); expect(screen.queryByLabelText(/Effective Date/)).toBeNull(); expect(screen.queryByLabelText("Change Note *")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Target Readers" }), { target: { value: "SELECTED_MEMBERS" } });
    expect(onReaders).toHaveBeenCalledWith({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] });
    view.rerender(createElement(KnowledgeMetadataFields, { value: emptyKnowledgeMetadata(), readers: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] },
      departments: [], busy: false, isUpdate: true, platform: "web", organizationId: "org", onChange: vi.fn(), onReaders }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Add people by name or email" }), { target: { value: "colleague@example" } });
    // Decision 0021: suggestions show the name, full email and department, like sharing in Google Drive.
    const suggestion = await screen.findByRole("button", { name: "Add Selected colleague, colleague@example.test" });
    expect(suggestion.textContent).toContain("colleague@example.test · HR");
    expect(api.findKnowledgeReaders).toHaveBeenLastCalledWith("web", "org", "colleague@example", []);
    fireEvent.click(suggestion); expect(onReaders).toHaveBeenLastCalledWith({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["reader"] });
  });
  it("has no Topic or Collection picker in contribution", () => {
    const props = { value: emptyKnowledgeMetadata(), readers: null, departments: [],
      busy: false, isUpdate: false, platform: "web" as const, organizationId: "org",
      onChange: vi.fn(), onReaders: vi.fn() };
    render(createElement(KnowledgeMetadataFields, props));
    expect(screen.queryByLabelText(/Topic|Collection/)).toBeNull();
    expect(screen.queryByText(/Ask an Org Admin to add a Topic/)).toBeNull();
  });
  it("clears retired Topic input on new saves without modifying historical response metadata", () => {
    const legacy = publication.management!;
    expect(editableKnowledgeMetadata(legacy)).toEqual({ type: "Guide", topicId: null, version: "1.0",
      effectiveDate: null, expirationDate: null, changeNote: "" });
    expect(legacy.topicId).toBe(topic.id);
    expect(legacy.topicName).toBe(topic.name);
    expect(legacy.effectiveDate).toBe("2027-01-01");
  });
  it("says when a pasted email is not a member of the organization (decision 0021)", async () => {
    vi.spyOn(api, "findKnowledgeReaders").mockResolvedValue([]);
    render(createElement(KnowledgeMetadataFields, { value: emptyKnowledgeMetadata(), readers: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] },
      departments: [], busy: false, isUpdate: false, platform: "web", organizationId: "org", onChange: vi.fn(), onReaders: vi.fn() }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Add people by name or email" }), { target: { value: "outsider@other.test" } });
    expect(await screen.findByText("No member with this email in this organization.")).toBeTruthy();
  });
});
