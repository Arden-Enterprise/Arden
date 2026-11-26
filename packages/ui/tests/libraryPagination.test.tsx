// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedKnowledge } from "../src/shared/api-client";
import { emptyLibraryFilters, KnowledgeLibraryBrowse, type LibraryFilters } from "../src/knowledge/KnowledgeLibraryBrowse";
import { paginationRange } from "../src/shared/IslandPagination";

afterEach(cleanup);

/** Synthetic documents; document 1 is the newest so the default order is 1, 2, 3, … */
const documents = (count: number): PublishedKnowledge[] => Array.from({ length: count }, (_, index) => ({
  id: `version-${index + 1}`, draftId: `doc-${index + 1}`, title: `Synthetic document ${index + 1}`, classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null }, responsibleDepartmentId: index % 2 ? "finance" : "engineering",
  responsibleDepartmentName: index % 2 ? "Finance" : "Engineering", audienceIds: [], contentHash: "hash", body: "", mimeType: "text/plain",
  publishedAt: new Date(Date.UTC(2026, 10, 25) - index * 60_000).toISOString(), validFrom: "2026-11-01T00:00:00Z", validUntil: null,
  management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" } }));

function browse(items: PublishedKnowledge[], filters: LibraryFilters = emptyLibraryFilters(), query = "") {
  const props = { items, catalog: null, catalogError: "", query, filters, onFilters: vi.fn(), discover: false,
    onBrowse: vi.fn(), onOpen: vi.fn(), onManage: vi.fn(), allowCollections: false };
  const view = render(createElement(KnowledgeLibraryBrowse, props));
  return { ...view, update: (next: Partial<typeof props>) => view.rerender(createElement(KnowledgeLibraryBrowse, { ...props, ...next })) };
}
const titles = () => screen.getAllByRole("button", { name: /^Read / }).map(button => button.getAttribute("aria-label")!.replace("Read ", ""));
const pager = () => screen.getByRole("navigation", { name: "All documents pages" });

describe("paginationRange", () => {
  it("lists every page when there are seven or fewer", () => {
    expect(paginationRange(1, 1)).toEqual([1]);
    expect(paginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("keeps seven stable slots with gaps for long ranges", () => {
    expect(paginationRange(1, 167)).toEqual([1, 2, 3, 4, 5, "gap", 167]);
    expect(paginationRange(4, 167)).toEqual([1, 2, 3, 4, 5, "gap", 167]);
    expect(paginationRange(50, 167)).toEqual([1, "gap", 49, 50, 51, "gap", 167]);
    expect(paginationRange(164, 167)).toEqual([1, "gap", 163, 164, 165, 166, 167]);
  });
});

describe("paged document register", () => {
  it("shows no pager for ten or fewer documents", () => {
    browse(documents(10));
    expect(titles()).toHaveLength(10);
    expect(screen.queryByRole("navigation", { name: "All documents pages" })).toBeNull();
  });

  it("shows 20 per page by default and moves between pages", () => {
    browse(documents(45));
    expect(titles()).toHaveLength(20);
    expect(within(pager()).getByRole("status").textContent).toBe("Showing 1–20 of 45 documents");
    expect(within(pager()).getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
    expect((within(pager()).getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(pager()).getByRole("button", { name: "Next page" }));
    expect(titles()[0]).toBe("Synthetic document 21");
    fireEvent.click(within(pager()).getByRole("button", { name: "Last page" }));
    expect(titles()).toEqual(["Synthetic document 41", "Synthetic document 42", "Synthetic document 43", "Synthetic document 44", "Synthetic document 45"]);
    expect(within(pager()).getByRole("status").textContent).toBe("Showing 41–45 of 45 documents");
    expect((within(pager()).getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the reader choose 10 per page and restarts on page 1", () => {
    browse(documents(45));
    fireEvent.click(within(pager()).getByRole("button", { name: "Page 2" }));
    fireEvent.change(within(pager()).getByRole("combobox", { name: "Documents per page" }), { target: { value: "10" } });
    expect(titles()).toHaveLength(10);
    expect(titles()[0]).toBe("Synthetic document 1");
    expect(within(pager()).getByRole("button", { name: "Page 5" })).toBeTruthy();
  });

  it("returns to page 1 when search, filters or sorting change", () => {
    const view = browse(documents(45));
    fireEvent.click(within(pager()).getByRole("button", { name: "Page 3" }));
    view.update({ filters: { ...emptyLibraryFilters(), ownerId: "engineering" } });
    expect(within(pager()).getByRole("status").textContent).toBe("Showing 1–20 of 23 documents");

    fireEvent.click(within(pager()).getByRole("button", { name: "Page 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by updated" }));
    expect(within(pager()).getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
    expect(titles()[0]).toBe("Synthetic document 45");
  });

  it("stays on the nearest page when a refresh removes documents", () => {
    const view = browse(documents(45));
    fireEvent.click(within(pager()).getByRole("button", { name: "Last page" }));
    view.update({ items: documents(30) });
    expect(within(pager()).getByRole("status").textContent).toBe("Showing 21–30 of 30 documents");
  });
});
