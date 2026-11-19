// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestDialogs } from "./dialogTestSupport";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null, ArdenRichTextEditor: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const departments = [{ id: "hr", name: "HR" }, { id: "ops", name: "Operations" }];

function commonApi() {
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments, audiences: [], primaryDepartmentId: "hr" });
  vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
}

function render_(view: "knowledge" | "review-queue") {
  render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org", organizationName: "Test",
    active: true, view, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() }));
}

describe("T2.2 reviewer approves fewer readers", () => {
  function reviewDetail(readers: api.TargetReaders | null, requestType?: api.KnowledgeSubmission["requestType"]): api.KnowledgeReviewDetail {
    return { id: "submission", draftId: "draft", snapshotVersionId: "snapshot", title: "Synthetic guide",
      classification: "INTERNAL", responsibleDepartmentId: "hr", targetScopeType: "ORGANIZATION", targetDepartmentId: null,
      audienceIds: [], contentHash: "a".repeat(64), status: "PENDING_REVIEW", publicationState: "NONE",
      submittedAt: "2026-11-14T09:00:00Z", publishedVersionId: null, decisionComment: null, requestType,
      proposedTargetReaders: readers, body: "Synthetic body", mimeType: "text/plain", submittedByMembershipId: "author",
      teamTag: null, projectTag: null,
      proposedReaders: readers ? { mode: readers.mode, department: readers.departmentId ? { id: readers.departmentId, name: "HR" } : null,
        members: readers.memberIds.map((membershipId, index) => ({ membershipId, displayName: ["An", "Binh", "Chi"][index] ?? null })) } : null };
  }

  async function openReview(detail: api.KnowledgeReviewDetail) {
    commonApi();
    vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [{ submissionId: detail.id,
      snapshotId: detail.snapshotVersionId, title: detail.title, departmentId: "hr", classification: "INTERNAL",
      submittedAt: detail.submittedAt, approvalBlocked: false, requestType: detail.requestType }], decided: [] });
    vi.spyOn(api, "loadKnowledgeReview").mockResolvedValue(detail);
    const decide = vi.spyOn(api, "decideKnowledgeReview").mockResolvedValue({ ...detail, status: "APPROVED" });
    render_("review-queue");
    fireEvent.click(await screen.findByRole("button", { name: /Synthetic guide/ }));
    const approve = await screen.findByRole("button", { name: "Approve", exact: true });
    await waitFor(() => expect(approve.hasAttribute("disabled")).toBe(false));
    return decide;
  }

  async function confirmApproval() {
    fireEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve", exact: true }));
    return dialog;
  }

  it("approves the proposed readers without sending approved readers", async () => {
    const decide = await openReview(reviewDetail({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["m1", "m2", "m3"] }));
    expect(screen.getByRole("radio", { name: /Proposed readers/ })).toHaveProperty("checked", true);
    await confirmApproval();
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide.mock.calls[0]![6]).toBeUndefined();
  });

  it("keeps a subset of selected members, names them in the confirmation and sends only them", async () => {
    const decide = await openReview(reviewDetail({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["m1", "m2", "m3"] }));
    fireEvent.click(screen.getByRole("radio", { name: /Fewer readers/ }));
    const members = screen.getByRole("list", { name: "Approved readers" });
    fireEvent.click(within(members).getByRole("checkbox", { name: "Chi" }));
    expect(screen.getByText("2 of 3 kept · keep at least 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve", exact: true }));
    expect(within(screen.getByRole("alertdialog")).getByText("An, Binh")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve", exact: true }));
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide.mock.calls[0]![6]).toEqual({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["m1", "m2"] });
  });

  it("blocks approval while fewer than two members remain", async () => {
    const decide = await openReview(reviewDetail({ mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["m1", "m2", "m3"] }));
    fireEvent.click(screen.getByRole("radio", { name: /Fewer readers/ }));
    const members = screen.getByRole("list", { name: "Approved readers" });
    fireEvent.click(within(members).getByRole("checkbox", { name: "Binh" }));
    fireEvent.click(within(members).getByRole("checkbox", { name: "Chi" }));
    expect(screen.getByText("Keep at least 2 readers to approve.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve", exact: true }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Proposed readers/ }));
    expect(screen.getByRole("button", { name: "Approve", exact: true }).hasAttribute("disabled")).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it("narrows an organization-wide proposal to one department", async () => {
    const decide = await openReview(reviewDetail({ mode: "ORGANIZATION", departmentId: null, memberIds: [] }));
    fireEvent.click(screen.getByRole("radio", { name: /Fewer readers/ }));
    expect(screen.getByRole("button", { name: "Approve", exact: true }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Reader department" }), { target: { value: "ops" } });
    await confirmApproval();
    await waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(decide.mock.calls[0]![6]).toEqual({ mode: "DEPARTMENT", departmentId: "ops", memberIds: [] });
  });

  it("shows the server refusal when the readers would widen", async () => {
    const decide = await openReview(reviewDetail({ mode: "ORGANIZATION", departmentId: null, memberIds: [] }));
    decide.mockRejectedValueOnce(new api.ApiError(409, "Approved readers can keep or narrow the proposed readers, never widen them.", "READERS_WIDENED"));
    fireEvent.click(screen.getByRole("radio", { name: /Fewer readers/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reader department" }), { target: { value: "hr" } });
    await confirmApproval();
    expect(await screen.findAllByText("Approved readers can keep or narrow the proposed readers, never widen them.")).not.toHaveLength(0);
  });

  it("offers no reader choice for a withdrawal or a legacy audience submission", async () => {
    await openReview(reviewDetail({ mode: "ORGANIZATION", departmentId: null, memberIds: [] }, "WITHDRAWAL"));
    expect(screen.queryByRole("radio", { name: /Proposed readers/ })).toBeNull();
    cleanup(); vi.restoreAllMocks();
    await openReview(reviewDetail(null));
    expect(screen.queryByRole("radio", { name: /Proposed readers/ })).toBeNull();
  });
});

describe("T6.4 author requests a reader change or withdrawal", () => {
  const draft: api.KnowledgeDraftSummary = { id: "draft", organizationId: "org", title: "Leave policy", classification: "INTERNAL",
    responsibleDepartmentId: "hr", targetScopeType: "ORGANIZATION", teamTag: null, projectTag: null, audienceIds: [],
    versionId: "version", mimeType: "text/plain", contentHash: "hash", currentVersion: 1, hasPendingSubmission: false,
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
  const published: api.KnowledgeSubmission = { id: "published", draftId: "draft", snapshotVersionId: "version", title: draft.title,
    classification: "INTERNAL", responsibleDepartmentId: "hr", targetScopeType: "ORGANIZATION", targetDepartmentId: null,
    audienceIds: [], contentHash: "hash", status: "APPROVED", publicationState: "ACTIVE", submittedAt: "2026-11-01T00:00:00Z",
    publishedVersionId: "publication", decisionComment: null, requestType: "CONTENT" };

  async function openContribution(submissions: api.KnowledgeSubmission[], summary = draft) {
    commonApi();
    vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([summary]);
    const list = vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue(submissions);
    vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
    vi.spyOn(api, "listKnowledgeDraftVersions").mockResolvedValue([]);
    render_("knowledge");
    fireEvent.click(await screen.findByRole("tab", { name: /My Contributions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open details for Leave policy" }));
    return list;
  }

  it("requires a reason, then sends a withdrawal request and refreshes", async () => {
    const list = await openContribution([published]);
    const send = vi.spyOn(api, "requestPublicationChange").mockResolvedValue({ ...published, id: "request",
      status: "PENDING_REVIEW", publicationState: "NONE", requestType: "WITHDRAWAL", requestReason: "Outdated" });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw document" }));
    const dialog = screen.getByRole("dialog", { name: "Request withdrawal" });
    expect(within(dialog).getByText(/leaves the Library and AI answers/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(within(dialog).getByText("Enter a reason.")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "  Outdated  " } });
    list.mockResolvedValue([published, { ...published, id: "request", status: "PENDING_REVIEW", publicationState: "NONE",
      requestType: "WITHDRAWAL", requestReason: "Outdated", submittedAt: "2026-11-15T00:00:00Z" }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]!.slice(0, 4)).toEqual(["web", "org", "draft", { type: "WITHDRAWAL", reason: "Outdated" }]);
    await screen.findByText("Withdrawal sent for review");
    expect(screen.queryByRole("dialog", { name: "Request withdrawal" })).toBeNull();
    await screen.findByText("Withdrawal · awaiting review");
    expect(screen.queryByRole("button", { name: "Withdraw document" })).toBeNull();
  });

  it("requires new readers and reuses the idempotency key when retrying the same request", async () => {
    await openContribution([published]);
    const send = vi.spyOn(api, "requestPublicationChange")
      .mockRejectedValueOnce(new api.ApiError(0, "Couldn’t confirm this action."))
      .mockResolvedValueOnce({ ...published, id: "request", status: "PENDING_REVIEW", publicationState: "NONE", requestType: "READER_CHANGE" });
    fireEvent.click(screen.getByRole("button", { name: "Change readers" }));
    const dialog = screen.getByRole("dialog", { name: "Request a reader change" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "HR only" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(within(dialog).getByText("Choose the new readers.")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "New readers" }), { target: { value: "DEPARTMENT" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reader department" }), { target: { value: "hr" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(await within(dialog).findByText("Couldn’t confirm this action.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    await screen.findByText("Reader change sent for review");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![3]).toEqual({ type: "READER_CHANGE", reason: "HR only",
      targetReaders: { mode: "DEPARTMENT", departmentId: "hr", memberIds: [] } });
    expect(send.mock.calls[1]![4]).toBe(send.mock.calls[0]![4]);
  });

  it("cancels without sending anything", async () => {
    await openContribution([published]);
    const send = vi.spyOn(api, "requestPublicationChange");
    fireEvent.click(screen.getByRole("button", { name: "Change readers" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { name: "an unpublished draft", submissions: [{ ...published, status: "REJECTED" as const, publicationState: "NONE" as const }] },
    { name: "a withdrawn publication", submissions: [{ ...published, publicationState: "WITHDRAWN" as const }] },
    { name: "a document with a pending request", submissions: [published, { ...published, id: "pending", status: "PENDING_REVIEW" as const,
      publicationState: "NONE" as const, submittedAt: "2026-11-15T00:00:00Z" }] },
  ])("offers no change request for $name", async ({ submissions }) => {
    await openContribution(submissions);
    expect(screen.queryByRole("button", { name: "Change readers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw document" })).toBeNull();
  });

  describe("T6.3 the author retries a failed preparation", () => {
    const failed = (publicationFailure: api.KnowledgeSubmission["publicationFailure"]): api.KnowledgeSubmission =>
      ({ ...published, publicationState: "FAILED", publishedVersionId: null, publicationFailure });

    it("restarts a temporary failure without a new review and refreshes", async () => {
      const list = await openContribution([failed("TEMPORARY")]);
      const retry = vi.spyOn(api, "retryKnowledgePublication").mockResolvedValue({ ...failed(null), publicationState: "PREPARING" });
      expect(screen.getByText(/briefly unavailable/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Change readers" })).toBeNull();
      list.mockResolvedValue([{ ...failed(null), publicationState: "PREPARING" }]);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(retry).toHaveBeenCalledWith("web", "org", "published"));
      await screen.findByText("Publication restarted");
      await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
      expect(screen.getAllByText("Preparing publication").length).toBeGreaterThan(0);
    });

    it.each([
      { failure: "CONTENT" as const, copy: /Fix it in the draft and submit it again/ },
      { failure: "SYSTEM" as const, copy: /contact your administrator/ },
    ])("explains a $failure failure without offering a retry", async ({ failure, copy }) => {
      await openContribution([failed(failure)]);
      expect(screen.getByText(copy)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });
  });

  it.each([
    { by: "REVIEWER" as const, heading: "Withdrawn by a reviewer" },
    { by: "ORGANIZATION_ADMIN" as const, heading: "Withdrawn by an administrator" },
  ])("shows the author who withdrew the document and why (decision 0023, $by)", async ({ by, heading }) => {
    await openContribution([{ ...published, publicationState: "WITHDRAWN",
      withdrawal: { by, reason: "Figures are out of date", at: "2026-11-16T00:00:00Z" } }]);
    expect(screen.getByText(heading)).toBeTruthy();
    expect(screen.getByText("Figures are out of date")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw document" })).toBeNull();
  });
});
