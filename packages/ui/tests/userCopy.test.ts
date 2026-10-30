// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../src/shared/api-client";
import { ContributePrivateNoteDialog, type ContributionAttempt } from "../src/personal-workspace/ContributePrivateNoteDialog";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { ErrorBoundary } from "../src/shared/ErrorBoundary";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({
  ArdenRichTextEditor: () => createElement("div", { "aria-label": "Document text" }),
  ArdenDocumentView: () => createElement("div", null, "Document content"),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockKnowledge(publicationState: api.KnowledgeSubmission["publicationState"] = "PREPARING") {
  const draft: api.KnowledgeDraftRecord = {
    id: "draft", organizationId: "org", title: "Team guide", body: "Document content",
    classification: "INTERNAL", responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT",
    teamTag: null, projectTag: null, audienceIds: ["readers"], hasPendingSubmission: false,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    currentVersion: { id: "version", version: 1, mimeType: "text/plain", contentHash: "private-hash" },
  };
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listAssignedKnowledgeReviews").mockResolvedValue([]);
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({
    departments: [{ id: "dept", name: "Engineering" }], audiences: [{ id: "readers", name: "Engineering", kind: "DEPARTMENT_ALL", departmentId: "dept" }],
    primaryDepartmentId: "dept", organizationReviewerAvailable: true,
  });
  vi.spyOn(api, "loadKnowledgeDraft").mockResolvedValue(draft);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([{
    id: "submission", draftId: "draft", snapshotVersionId: "version", title: draft.title,
    classification: "INTERNAL", responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT",
    targetDepartmentId: "dept", audienceIds: ["readers"], contentHash: "private-hash",
    status: "APPROVED", publicationState, submittedAt: "2026-10-01T00:00:00Z",
    publishedVersionId: publicationState === "ACTIVE" ? "publication" : null, decisionComment: null,
  }]);
}

describe("concise user-facing copy", () => {
  it.each([
    ["PREPARING", "Preparing publication"], ["ACTIVE", "Published"], ["FAILED", "Publication failed"],
  ] as const)("keeps %s publication state accurate without repeating it", async (state, label) => {
    mockKnowledge(state);
    render(createElement(ServerKnowledgeFeaturePage, {
      platform: "web", organizationId: "org", organizationName: "Example", view: "knowledge",
      active: true, createdDraftId: "draft", contextOpen: false, onToggleContext: vi.fn(),
    }));
    await screen.findByRole("heading", { name: "Before you submit" });
    expect(screen.getByText("Reviewer: Engineering reviewer")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(label)).toHaveLength(1));
    expect(screen.queryByText("private-hash")).toBeNull();
    expect(screen.queryByText(/atomic activation|governance metadata|active reviewer grant/i)).toBeNull();
    if (state !== "ACTIVE") expect(screen.queryByText("Published", { exact: true })).toBeNull();
  });

  it("does not claim an index is ready in the empty chat", () => {
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    expect(screen.getByText("Published documents")).toBeTruthy();
    expect(screen.queryByText(/indexed|permission-aware/i)).toBeNull();
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Attachments aren’t available yet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["DEPARTMENT", "ORGANIZATION"] as const)("shows the %s boundary before approving group readers", async (scope) => {
    mockKnowledge();
    vi.mocked(api.loadKnowledgeOptions).mockResolvedValue({
      departments: [{ id: "dept", name: "Engineering" }], primaryDepartmentId: "dept",
      audiences: [{ id: "readers", name: "Project group", kind: "GROUP", departmentId: null }],
    });
    vi.mocked(api.listAssignedKnowledgeReviews).mockResolvedValue([{
      submissionId: "submission", snapshotId: "version", title: "Group guide", departmentId: "dept",
      classification: "INTERNAL", submittedAt: "2026-10-01T00:00:00Z", approvalBlocked: false,
    }]);
    vi.spyOn(api, "loadKnowledgeReview").mockResolvedValue({
      id: "submission", draftId: "draft", snapshotVersionId: "version", title: "Group guide",
      classification: "INTERNAL", responsibleDepartmentId: "dept", targetScopeType: scope,
      targetDepartmentId: scope === "DEPARTMENT" ? "dept" : null, audienceIds: ["readers"],
      contentHash: "private-hash", status: "PENDING_REVIEW", publicationState: "NONE",
      submittedAt: "2026-10-01T00:00:00Z", publishedVersionId: null, decisionComment: null,
      body: "Document content", mimeType: "text/plain", submittedByMembershipId: "author", teamTag: null, projectTag: null,
    });
    render(createElement(ServerKnowledgeFeaturePage, {
      platform: "web", organizationId: "org", organizationName: "Example", view: "review-queue",
      active: true, contextOpen: false, onToggleContext: vi.fn(),
    }));
    fireEvent.click(await screen.findByRole("button", { name: /Group guide/ }));
    await screen.findByRole("button", { name: "Approve", exact: true });
    const boundary = screen.getByText("Within").parentElement;
    expect(boundary?.textContent).toBe(`Within${scope === "DEPARTMENT" ? "Engineering" : "Across departments"}`);
    expect(screen.getByText("Project group")).toBeTruthy();
    expect(screen.queryByText("private-hash")).toBeNull();
  });

  it("keeps the private-copy warning and reuses retry identity without showing request keys", async () => {
    const created = vi.spyOn(api, "createKnowledgeDraft")
      .mockRejectedValueOnce(new api.ApiError(0, "Couldn’t confirm draft creation."))
      .mockResolvedValueOnce({ id: "draft", organizationId: "org", title: "Note", body: "Private text", classification: "INTERNAL", status: "ACTIVE" });
    const onCreated = vi.fn();
    function CopyForm() {
      const [attempt, setAttempt] = useState<ContributionAttempt | null>(null);
      return createElement(ContributePrivateNoteDialog, {
        platform: "web", organizationId: "org", source: { title: "Note", body: "Private text", versionId: "saved-version" },
        attempt, onAttemptChange: setAttempt, onCreated, onClose: vi.fn(),
      });
    }
    render(createElement(CopyForm));
    expect(screen.getByText("Your original stays private.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getAllByText("Couldn’t confirm draft creation.")).toHaveLength(1);
    fireEvent.click(retry);
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(created.mock.calls[1][4]).toBe(created.mock.calls[0][4]);
    expect(created.mock.calls[0][4]).toBeTruthy();
    expect(screen.queryByText(/request key|idempotency/i)).toBeNull();
  });

  it("does not expose an internal exception in the page fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenPage(): never { throw new Error("internal database diagnostic"); }
    render(createElement(ErrorBoundary, null, createElement(BrokenPage)));
    expect(screen.getByText("Couldn’t open this page.")).toBeTruthy();
    expect(screen.queryByText("internal database diagnostic")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
