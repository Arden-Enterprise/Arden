// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installTestDialogs } from "./dialogTestSupport";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({
  ArdenRichTextEditor: () => createElement("div", { "aria-label": "Document text" }),
  ArdenDocumentView: () => createElement("div", null, "Document content"),
}));

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

const categories = [
  { id: "policy", code: "POLICY", name: "Policy", isDefault: false },
  { id: "general", code: "GENERAL", name: "General", isDefault: true },
];

function draft(categoryId: string | null): api.KnowledgeDraftRecord {
  return {
    id: "draft", organizationId: "org", title: "Team guide", body: "Document content",
    classification: "INTERNAL", status: "ACTIVE", responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT",
    teamTag: null, projectTag: null, audienceIds: ["readers"], hasPendingSubmission: false,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    currentVersion: { id: "version", version: 1, mimeType: "text/plain", contentHash: "hash" },
    categoryId,
  };
}

function renderEditor(categoryId: string | null, withCategories = true) {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({
    departments: [{ id: "dept", name: "Engineering" }],
    audiences: [{ id: "readers", name: "Engineering", kind: "DEPARTMENT_ALL", departmentId: "dept" }],
    primaryDepartmentId: "dept", organizationReviewerAvailable: true,
    ...(withCategories ? { categories } : {}),
  });
  vi.spyOn(api, "loadKnowledgeDraft").mockResolvedValue(draft(categoryId));
  render(createElement(ServerKnowledgeFeaturePage, {
    platform: "web", organizationId: "org", organizationName: "Example", view: "knowledge",
    active: true, createdDraftId: "draft", contextOpen: false, onToggleContext: vi.fn(),
  }));
}

const submitButton = () => screen.getByRole("button", { name: /Submit v1 for review/ }) as HTMLButtonElement;
const readiness = () => within(screen.getByRole("list", { name: "Submission readiness" }));

describe("T3.2/T3.3 Category in the contribution form", () => {
  it("requires a category before Submit and saves the chosen one", async () => {
    renderEditor(null);
    await screen.findByRole("heading", { name: "Before you submit" });
    const select = await screen.findByRole("combobox", { name: "Category" }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose category", "Policy", "General"]);
    expect(readiness().getByText("Category").closest("li")?.className).not.toContain("is-done");
    expect(submitButton().disabled).toBe(true);

    const save = vi.spyOn(api, "saveKnowledgeDraft").mockResolvedValue({
      ...draft("policy"), currentVersion: { id: "version-2", version: 2, mimeType: "text/plain", contentHash: "hash" } });
    fireEvent.change(select, { target: { value: "policy" } });
    expect(readiness().getByText("Category").closest("li")?.className).toContain("is-done");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("web", "org", "draft", 1,
      expect.objectContaining({ categoryId: "policy" })));
    await waitFor(() => expect((screen.getByRole("button", { name: /Submit v2 for review/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows a saved category and keeps an inactive one visible", async () => {
    renderEditor("archived-category");
    const select = await screen.findByRole("combobox", { name: "Category" }) as HTMLSelectElement;
    expect(select.value).toBe("archived-category");
    expect(screen.getByRole("option", { name: "Unavailable category" })).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it("hides the field and sends no category to a server without categories", async () => {
    renderEditor(null, false);
    await screen.findByRole("heading", { name: "Before you submit" });
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
    expect(readiness().queryByText("Category")).toBeNull();
    const save = vi.spyOn(api, "saveKnowledgeDraft").mockResolvedValue(draft(null));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Renamed guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[4]).not.toHaveProperty("categoryId");
  });
});
