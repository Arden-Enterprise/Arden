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

const draft: api.KnowledgeDraftSummary = {
  id: "draft", organizationId: "org", title: "Team guide", classification: "INTERNAL",
  responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT", teamTag: null, projectTag: null,
  audienceIds: ["readers"], versionId: "version", mimeType: "text/plain", contentHash: "hash",
  currentVersion: 1, hasPendingSubmission: true,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};

function submission(status: api.KnowledgeSubmission["status"]): api.KnowledgeSubmission {
  return {
    id: "submission", draftId: "draft", snapshotVersionId: "version", title: draft.title,
    classification: "INTERNAL", responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT",
    targetDepartmentId: "dept", audienceIds: ["readers"], contentHash: "hash",
    status, publicationState: "NONE", submittedAt: "2026-10-01T00:00:00Z",
    publishedVersionId: null, decisionComment: null,
  };
}

function renderContributions(status: api.KnowledgeSubmission["status"]) {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([draft]);
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({
    departments: [{ id: "dept", name: "Engineering" }],
    audiences: [{ id: "readers", name: "Engineering", kind: "DEPARTMENT_ALL", departmentId: "dept" }],
    primaryDepartmentId: "dept", organizationReviewerAvailable: true,
  });
  const submissions = vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([submission(status)]);
  render(createElement(ServerKnowledgeFeaturePage, {
    platform: "web", organizationId: "org", organizationName: "Example", view: "knowledge",
    active: true, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(),
  }));
  return submissions;
}

async function openContribution() {
  fireEvent.click(await screen.findByRole("tab", { name: /My Contributions/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open details for Team guide" }));
}

describe("T5.1 withdraw a pending review request", () => {
  it("asks for confirmation, withdraws the request and refreshes the list", async () => {
    const submissions = renderContributions("PENDING_REVIEW");
    const withdraw = vi.spyOn(api, "withdrawKnowledgeSubmission").mockResolvedValue(submission("WITHDRAWN"));
    await openContribution();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    expect(screen.getByRole("alertdialog", { name: "Withdraw this review request?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep request" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(withdraw).not.toHaveBeenCalled();

    submissions.mockResolvedValue([submission("WITHDRAWN")]);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    // While confirming, the only "Withdraw request" button is the one inside the confirmation.
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith("web", "org", "submission"));
    await screen.findByText("Request withdrawn");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull());
  });

  it.each(["APPROVED", "REJECTED", "WITHDRAWN"] as const)("offers no withdrawal for a %s request", async (status) => {
    renderContributions(status);
    await openContribution();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
  });
});
