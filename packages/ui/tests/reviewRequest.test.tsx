// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("publication request review presentation", () => {
  it.each([
    { type: undefined, title: "Approve this submission?", effect: "This version will be prepared for publication.", success: "Preparing publication" },
    { type: "CONTENT" as const, title: "Approve this submission?", effect: "This version will be prepared for publication.", success: "Preparing publication" },
    { type: "WITHDRAWAL" as const, title: "Withdraw this document?", effect: "This document will be removed from Library and AI answers.", success: "Document withdrawn" },
    { type: "READER_CHANGE" as const, title: "Change this document’s readers?", effect: "The proposed readers will replace the current readers.", success: "Readers updated" },
  ])("shows the real $type effect and never submits until confirmed", async ({ type, title, effect, success }) => {
    const detail: api.KnowledgeReviewDetail = { id: "submission", draftId: "draft", snapshotVersionId: "snapshot",
      title: "Synthetic policy", classification: "INTERNAL", responsibleDepartmentId: "hr", targetScopeType: "ORGANIZATION",
      targetDepartmentId: null, audienceIds: [], contentHash: "a".repeat(64), status: "PENDING_REVIEW", publicationState: "NONE",
      submittedAt: "2026-11-14T09:00:00Z", publishedVersionId: null, decisionComment: null, requestType: type,
      requestReason: "<b>Updated business requirement</b>", body: "Synthetic source", mimeType: "text/plain",
      submittedByMembershipId: "author", teamTag: null, projectTag: null };
    const board: api.AssignedKnowledgeReview = { submissionId: detail.id, snapshotId: detail.snapshotVersionId,
      title: detail.title, departmentId: "hr", classification: "INTERNAL", submittedAt: detail.submittedAt,
      approvalBlocked: false, requestType: type };
    vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
    vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [board], decided: [] });
    vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [{ id: "hr", name: "HR" }], audiences: [] });
    vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, topics: [], collections: [] });
    vi.spyOn(api, "loadKnowledgeReview").mockResolvedValue(detail);
    const decide = vi.spyOn(api, "decideKnowledgeReview").mockResolvedValue({ ...detail, status: "APPROVED" });
    render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org", organizationName: "Test",
      active: true, view: "review-queue", createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() }));
    const row = await screen.findByRole("button", { name: /Synthetic policy/ });
    if (type === "WITHDRAWAL" || type === "READER_CHANGE") {
      expect(within(row).getByText(type === "WITHDRAWAL" ? "Withdrawal" : "Reader change")).toBeTruthy();
    }
    fireEvent.click(row);
    const approve = await screen.findByRole("button", { name: "Approve", exact: true });
    if (type && type !== "CONTENT") {
      expect(screen.getByText(detail.requestReason!)).toBeTruthy();
      expect(screen.getByText(detail.requestReason!).querySelector("b")).toBeNull();
    }
    fireEvent.click(approve);
    const dialog = screen.getByRole("alertdialog", { name: title });
    expect(within(dialog).getByText(effect)).toBeTruthy(); expect(decide).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull(); expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve", exact: true }));
    await screen.findByText(success); expect(decide).toHaveBeenCalledOnce();
  });
});
