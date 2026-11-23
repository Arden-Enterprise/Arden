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

  it("uses the reader's status chips, never violet text", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    renderRegister([item("current", {}), item("another", {}),
      item("soon", { expirationDate: "2026-11-25" }), item("expired", { expirationDate: "2026-11-01" })]);
    const chip = (id: string) => within(screen.getByRole("button", { name: `Read Document ${id}` }).closest("[role=row]") as HTMLElement)
      .getByText(/Current|Expires|Expired/);
    expect(chip("current").className).toContain("island-chip knowledge-reader-status library-row-status is-effective");
    expect(chip("another").className).toContain("is-effective");
    expect(chip("soon").textContent).toBe("Expires in 3 days");
    expect(chip("soon").className).toContain("is-expiring");
    expect(chip("expired").className).toContain("is-expired");
    expect(document.querySelector(".km-applicability")).toBeNull();
  });
});
