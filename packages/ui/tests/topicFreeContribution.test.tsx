// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyKnowledgeMetadata } from "@arden/domain";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null, ArdenRichTextEditor: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

function draft(overrides: Partial<api.KnowledgeDraftRecord> = {}): api.KnowledgeDraftRecord {
  return { id: "draft", organizationId: "org", title: "Synthetic working guide", classification: "INTERNAL",
    status: "ACTIVE", hasPendingSubmission: false, body: "Useful synthetic guidance.", responsibleDepartmentId: "hr",
    targetScopeType: "ORGANIZATION", teamTag: null, projectTag: null, audienceIds: [],
    management: { ...emptyKnowledgeMetadata(), type: "Guide", version: "1.0" },
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    currentVersion: { id: "revision", version: 1, mimeType: "text/plain", contentHash: "a".repeat(64) },
    createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", ...overrides };
}

async function open(value: api.KnowledgeDraftRecord, catalogUnavailable = false) {
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [{ id: "hr", name: "HR" }], audiences: [], primaryDepartmentId: "hr" });
  const catalog = vi.spyOn(api, "loadKnowledgeCatalog");
  if (catalogUnavailable) catalog.mockRejectedValue(new Error("Synthetic catalog outage"));
  else catalog.mockResolvedValue({ canManage: false, topics: [], collections: [] });
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([value]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "listKnowledgeDraftVersions").mockResolvedValue([]);
  vi.spyOn(api, "loadKnowledgeDraft").mockResolvedValue(value);
  render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org", organizationName: "Synthetic organization",
    active: true, view: "knowledge", createdDraftId: "draft", contextOpen: false, onToggleContext: vi.fn() }));
  return screen.findByRole("button", { name: "Submit for review", exact: true });
}

describe("Topic-free contribution readiness", () => {
  it.each([false, true])("submits without Topics even when catalog is unavailable: %s", async unavailable => {
    const submit = vi.spyOn(api, "submitKnowledgeDraft").mockResolvedValue({ status: "PENDING_REVIEW" } as api.KnowledgeSubmission);
    const button = await open(draft(), unavailable);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByLabelText(/Topic|Collection/)).toBeNull();
    expect(screen.getByRole("button", { name: "Back", exact: true })).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledWith("web", "org", "draft", 1, expect.any(String)));
  });

  it.each([
    { management: { ...emptyKnowledgeMetadata(), version: "1.0" } },
    { management: { ...emptyKnowledgeMetadata(), type: "Guide" as const } },
    { targetReaders: null },
    { targetReaders: { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: [] } },
    { responsibleDepartmentId: null },
    { hasPublishedVersion: true },
    { body: "" },
  ])("keeps non-Topic readiness checks: %j", async changes => {
    const button = await open(draft(changes));
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("saves a legacy draft with Topic cleared, no Collection and unchanged readers", async () => {
    const value = draft({ management: { ...emptyKnowledgeMetadata(), type: "Guide", version: "1.0", topicId: "legacy-topic" } });
    const save = vi.spyOn(api, "saveKnowledgeDraft").mockResolvedValue({ ...value,
      title: "Updated title", currentVersion: { ...value.currentVersion, version: 2 } });
    await open(value);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Updated title" } });
    expect(screen.getByRole("button", { name: "Cancel", exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit for review", exact: true }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save changes", exact: true }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![4]).toMatchObject({ management: { type: "Guide", version: "1.0" },
      targetReaders: value.targetReaders });
    expect(save.mock.calls[0]![4]).not.toHaveProperty("collectionId");
    expect(save.mock.calls[0]![4]?.management).not.toHaveProperty("topicId");
    expect(value.management?.topicId).toBe("legacy-topic");
  });
});
