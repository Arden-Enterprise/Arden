// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as api from "../src/shared/api-client";
import { KnowledgeLibraryBrowse, emptyLibraryFilters } from "../src/knowledge/KnowledgeLibraryBrowse";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const base: api.PublishedKnowledge = { id: "v1", draftId: "d1", title: "Employee Lifecycle Responsibilities Reference for every department",
  classification: "INTERNAL", targetReaders: { mode: "ORGANIZATION", departmentId: null }, responsibleDepartmentId: "hr",
  responsibleDepartmentName: "HR", audienceIds: [], contentHash: "hash", body: "", mimeType: "text/plain",
  publishedAt: "2026-11-12T00:00:00Z", validFrom: "2026-11-12T00:00:00Z", validUntil: null,
  management: { type: "Reference", version: "1.0", expirationDate: null, changeNote: "" } };
const item = (id: string, management: Partial<NonNullable<api.PublishedKnowledge["management"]>>): api.PublishedKnowledge =>
  ({ ...base, id, draftId: `d-${id}`, title: `Document ${id}`, management: { ...base.management!, ...management } });

function renderRegister(items: api.PublishedKnowledge[], showReaders = false) {
  render(createElement(KnowledgeLibraryBrowse, { items, catalog: null, catalogError: "", query: "", filters: emptyLibraryFilters(),
    onFilters: vi.fn(), discover: false, onBrowse: vi.fn(), onOpen: vi.fn(), onManage: vi.fn(), allowCollections: false, showReaders }));
}

describe("document list rows", () => {
  it("shows the full title on hover and adds no empty meta line", () => {
    renderRegister([base]);
    const name = screen.getByRole("button", { name: `Read ${base.title}` });
    expect(name.getAttribute("title")).toBe(base.title);
    expect(name.querySelector(".library-row-meta")).toBeNull();
  });

  it("keeps the readers line when the Shared view needs it", () => {
    renderRegister([{ ...base, targetReaders: { mode: "DEPARTMENT", departmentId: "hr", memberIds: [] } }], true);
    expect(screen.getByText("Department readers")).toBeTruthy();
  });

  it("shows DOCUMENT · TYPE · OWNER · AUTHOR · UPDATED without version or status (decision 0032)", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    renderRegister([{ ...item("current", {}), authorName: "Avery Author" }, item("left", {}),
      item("soon", { expirationDate: "2026-11-25" }), item("later", { expirationDate: "2027-01-31" })]);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.replace(/[^A-Z]/g, ""))).toEqual(
      ["DOCUMENT", "TYPE", "OWNER", "AUTHOR", "UPDATED"]);
    const row = (id: string) => within(screen.getByRole("button", { name: `Read Document ${id}` }).closest("[role=row]") as HTMLElement);
    expect(row("current").getByText("Avery Author")).toBeTruthy();
    // An inactive or unknown author shows a dash, never an email or reviewer.
    expect(row("left").getByText("—")).toBeTruthy();
    expect(row("current").getByText("Nov 12, 2026")).toBeTruthy();
    expect(document.querySelector(".library-row-status, .km-no-expiry")).toBeNull();
    expect(screen.queryByText(/Current|Expired/)).toBeNull();
    // Only a document expiring in 30 days or less gets the amber clock, with an accessible label.
    expect(row("soon").getByRole("img", { name: "Expires in 3 days · Nov 25, 2026" })).toBeTruthy();
    expect(row("later").queryByRole("img")).toBeNull();
    expect(row("current").queryByRole("img")).toBeNull();
  });

  it("sorts by any column, newest UPDATED first by default", async () => {
    const { fireEvent } = await import("@testing-library/react");
    renderRegister([{ ...item("a", {}), title: "Alpha", publishedAt: "2026-10-01T00:00:00Z", authorName: "Zed" },
      { ...item("b", {}), title: "Bravo", publishedAt: "2026-11-20T00:00:00Z", authorName: null },
      { ...item("c", {}), title: "Charlie", publishedAt: "2026-11-01T00:00:00Z", authorName: "Amy" }]);
    const titles = () => screen.getAllByRole("button", { name: /^Read / }).map((button) => button.getAttribute("title"));
    expect(titles()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(screen.getAllByRole("columnheader")[4]!.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by updated" }));
    expect(titles()).toEqual(["Alpha", "Charlie", "Bravo"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by author" }));
    expect(titles()).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(screen.getAllByRole("columnheader")[3]!.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by document" }));
    expect(titles()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
});
