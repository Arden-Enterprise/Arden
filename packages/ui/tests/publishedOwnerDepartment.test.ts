// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({
  ArdenDocumentView: () => createElement("div", null, "Published document content"),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(ownerName: string | null | undefined, ownerId = "hr") {
  const publication: api.PublishedKnowledge = {
    id: "publication", draftId: "draft", title: "Employee lifecycle guide", classification: "INTERNAL",
    responsibleDepartmentId: ownerId, responsibleDepartmentName: ownerName,
    audienceIds: ["organization-readers"], contentHash: "hash", body: "Published document content",
    mimeType: "text/plain", publishedAt: "2026-01-01T00:00:00Z", validFrom: "2026-01-01T00:00:00Z", validUntil: null,
  };
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([publication]);
  vi.spyOn(api, "loadPublishedKnowledge").mockResolvedValue(publication);
  // The reader may read the publication, but can only author in Engineering.
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({
    departments: [{ id: "engineering", name: "Engineering" }], primaryDepartmentId: "engineering",
    audiences: [{ id: "organization-readers", name: "Everyone", kind: "ORGANIZATION_ALL", departmentId: null }],
  });
}

describe("published owner department display", () => {
  it.each([
    ["web", "HR"], ["web", "Finance"], ["desktop", "HR"], ["desktop", "Finance"],
  ] as const)("shows %s publication owner %s without adding it to authoring choices", async (platform, owner) => {
    setup(owner);
    render(createElement(ServerKnowledgeFeaturePage, {
      platform, organizationId: "org", organizationName: "Example", view: "knowledge",
      active: true, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(),
    }));
    const open = await screen.findByRole("button", { name: "Read Employee lifecycle guide" });
    expect(screen.getByText(owner)).toBeTruthy();
    expect(screen.queryByText("Unassigned")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl K)" }));
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: owner } });
    expect(screen.getByRole("button", { name: "Read Employee lifecycle guide" })).toBeTruthy();
    fireEvent.click(open);
    await screen.findByRole("heading", { name: "Document information" });
    expect(screen.getByText(owner)).toBeTruthy();
    expect(screen.queryByText("Unassigned")).toBeNull();
    await expect(vi.mocked(api.loadKnowledgeOptions).mock.results[0]?.value).resolves.toMatchObject({
      departments: [{ id: "engineering", name: "Engineering" }],
    });
  });

  it.each([undefined, null, "  "])("keeps the department lookup fallback for an older response (%s)", async (name) => {
    setup(name, "engineering");
    render(createElement(ServerKnowledgeFeaturePage, {
      platform: "web", organizationId: "org", organizationName: "Example", view: "knowledge",
      active: true, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(),
    }));
    await screen.findByRole("button", { name: "Read Employee lifecycle guide" });
    expect(screen.getByText("Engineering")).toBeTruthy();
  });
});
