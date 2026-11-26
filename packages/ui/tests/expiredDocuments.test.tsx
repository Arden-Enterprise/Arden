// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestDialogs } from "./dialogTestSupport";
import * as api from "../src/shared/api-client";
import { GovernanceDocumentsPanel, matchesValidityFilter } from "../src/knowledge/PublicationGovernance";
import { OnBehalfRenewalDecision, RenewPublicationDialog, renewalStatus } from "../src/knowledge/RenewPublicationDialog";
import { contributionStatus } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null }));

let restoreDialogs: () => void;
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
});
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); vi.useRealTimers(); });

const state = (overrides: Partial<api.PublicationRenewalState> = {}): api.PublicationRenewalState => ({
  documentId: "doc", publishedVersionId: "version", title: "Travel policy", responsibleDepartmentId: "hr",
  expirationDate: "2026-11-30", renewalPending: false, authorActive: true, isAuthor: false, canRenew: true, ...overrides });

describe("decision 0032 validity for responsible people", () => {
  it("names Current, Expires in N days, Expired and a waiting renewal", () => {
    expect(renewalStatus(state({ expirationDate: null }))).toEqual({ label: "Current", tone: "" });
    expect(renewalStatus(state({ expirationDate: "2027-06-01" }))).toEqual({ label: "Current", tone: "" });
    expect(renewalStatus(state())).toEqual({ label: "Expires in 6 days", tone: "is-attention" });
    expect(renewalStatus(state({ expirationDate: "2026-11-24" })).label).toBe("Expires today");
    expect(renewalStatus(state({ expirationDate: "2026-11-23" }))).toEqual({ label: "Expired", tone: "is-danger" });
    expect(renewalStatus(state({ renewalPending: true })).label).toBe("Renewal awaiting review");
    expect(matchesValidityFilter(state(), "EXPIRING")).toBe(true);
    expect(matchesValidityFilter(state(), "EXPIRED")).toBe(false);
    expect(matchesValidityFilter(state({ expirationDate: "2026-11-01" }), "EXPIRED")).toBe(true);
    expect(matchesValidityFilter(undefined, "EXPIRED")).toBe(false);
    expect(matchesValidityFilter(undefined, "")).toBe(true);
  });

  it("keeps the My Contributions status for drafts and shows validity for a current publication", () => {
    const draft = { hasPendingSubmission: false, responsibleDepartmentId: "hr", targetScopeType: "ORGANIZATION" as const,
      audienceIds: ["a"], versionId: "v1" };
    const latest = { status: "APPROVED", publicationState: "ACTIVE", snapshotVersionId: "v1", requestType: "CONTENT" } as api.KnowledgeSubmission;
    expect(contributionStatus(draft, latest, undefined).label).toBe("Published");
    expect(contributionStatus(draft, latest, state({ expirationDate: "2027-06-01" })).label).toBe("Published");
    expect(contributionStatus(draft, latest, state({ expirationDate: "2026-11-01" })).label).toBe("Expired");
    expect(contributionStatus(draft, latest, state()).label).toBe("Expires in 6 days");
  });

  it("filters Administration → Documents by Expiring soon and Expired and offers Renew where allowed", async () => {
    vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
    vi.spyOn(api, "listGovernancePublications").mockResolvedValue([
      { documentId: "soon", publishedVersionId: "v1", title: "Soon", responsibleDepartmentId: "hr", readerMode: "ORGANIZATION",
        readerDepartmentId: null, versionLabel: "1.0", snapshotVersionNo: 1, publishedAt: "2026-10-01T00:00:00Z", openReports: 0, readable: true },
      { documentId: "gone", publishedVersionId: "v2", title: "Gone", responsibleDepartmentId: "hr", readerMode: "ORGANIZATION",
        readerDepartmentId: null, versionLabel: "1.0", snapshotVersionNo: 1, publishedAt: "2026-09-01T00:00:00Z", openReports: 0, readable: false },
      { documentId: "fine", publishedVersionId: "v3", title: "Fine", responsibleDepartmentId: "hr", readerMode: "ORGANIZATION",
        readerDepartmentId: null, versionLabel: "1.0", snapshotVersionNo: 1, publishedAt: "2026-09-01T00:00:00Z", openReports: 0, readable: true }]);
    vi.spyOn(api, "listPublicationRenewals").mockResolvedValue([
      state({ documentId: "soon", title: "Soon", canRenew: false }),
      state({ documentId: "gone", title: "Gone", expirationDate: "2026-11-02" }),
      state({ documentId: "fine", title: "Fine", expirationDate: null, canRenew: false })]);
    render(createElement(GovernanceDocumentsPanel, { platform: "web", organizationId: "org", departmentName: () => "HR" }));
    const row = async (title: string) => (await screen.findByText(title)).closest("[role=row]") as HTMLElement;
    expect(within(await row("Gone")).getByText("Expired")).toBeTruthy();
    expect(within(await row("Soon")).getByText("Expires in 6 days")).toBeTruthy();
    expect(within(await row("Soon")).queryByRole("button", { name: "Renew" })).toBeNull();
    expect(within(await row("Gone")).getByRole("button", { name: "Renew" })).toBeTruthy();
    const filter = screen.getByRole("combobox", { name: "Validity" });
    fireEvent.change(filter, { target: { value: "EXPIRED" } });
    expect(screen.queryByText("Soon")).toBeNull();
    expect(screen.getByText("Gone")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "EXPIRING" } });
    expect(screen.getByText("Soon")).toBeTruthy();
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.queryByText("Fine")).toBeNull();
  });

  it("sends a renewal with a date or no expiry and keeps one idempotency key across retries", async () => {
    const send = vi.spyOn(api, "requestPublicationRenewal")
      .mockRejectedValueOnce(new api.ApiError(409, "A renewal is already waiting for review.", "RENEWAL_PENDING"))
      .mockResolvedValue({} as api.KnowledgeSubmission);
    const sent = vi.fn();
    render(createElement(RenewPublicationDialog, { target: state({ authorName: "Avery Author" }), platform: "web",
      organizationId: "org", departmentName: () => "HR", onClose: vi.fn(), onSent: sent }));
    const dialog = screen.getByRole("dialog", { name: "Renew document" });
    expect(within(dialog).getByText("You’re renewing on behalf of Avery Author. They’ll see your name and reason and can approve or reject it within 3 days; after that a reviewer for HR can decide.",
      { normalizer: (text) => text.replace(/\s+/g, " ").trim() })).toBeTruthy();
    expect(within(dialog).queryByText(/can’t approve|cannot approve/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(within(dialog).getByText("Choose a date after today, or no expiry.")).toBeTruthy();
    expect(within(dialog).getByText("Enter a reason.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/New Valid until/), { target: { value: "2027-05-31" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: " Checked again " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    expect(await within(dialog).findByText("A renewal is already waiting for review.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "No expiry" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(send.mock.calls[0]!.slice(0, 4)).toEqual(["web", "org", "doc", { expirationDate: "2027-05-31", reason: "Checked again" }]);
    expect(send.mock.calls[1]![3]).toEqual({ expirationDate: null, reason: "Checked again" });
    expect(send.mock.calls[1]![4]).toBe(send.mock.calls[0]![4]);
  });

  it("explains who decides for an inactive author and for the author's own request", () => {
    render(createElement(RenewPublicationDialog, { target: state({ authorActive: false, authorName: null }), platform: "web",
      organizationId: "org", departmentName: () => "HR", onClose: vi.fn(), onSent: vi.fn() }));
    expect(screen.getByText("The author is no longer active, so a reviewer for HR decides it.")).toBeTruthy();
    cleanup();
    render(createElement(RenewPublicationDialog, { target: state({ isAuthor: true }), platform: "web",
      organizationId: "org", departmentName: () => "HR", onClose: vi.fn(), onSent: vi.fn() }));
    expect(screen.getByText("A reviewer for HR decides it.")).toBeTruthy();
  });

  it("lets the author approve, or reject with a note, a renewal asked on their behalf", async () => {
    const pending = { submissionId: "sub", snapshotVersionId: "snap", contentHash: "a".repeat(64), onBehalfOfAuthor: true,
      requestedByName: "Blake Reviewer", reason: "Still valid", expirationDate: "2027-05-31",
      requestedAt: "2026-11-24T10:00:00Z", authorWindowUntil: "2026-11-27T10:00:00Z", canDecide: true };
    expect(renewalStatus(state({ renewalPending: true, pending })).label).toBe("Renewal awaiting your decision");
    const decide = vi.spyOn(api, "decidePublicationRenewal").mockResolvedValue({} as api.KnowledgeSubmission);
    const decided = vi.fn();
    render(createElement(OnBehalfRenewalDecision, { pending, platform: "web", organizationId: "org", onDecided: decided }));
    expect(screen.getByText(/Blake Reviewer asked to renew this document until May 31, 2027: Still valid/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject renewal" }));
    expect(screen.getByText("Enter a note.")).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Note for the requester/ }), { target: { value: " Not needed " } });
    fireEvent.click(screen.getByRole("button", { name: "Reject renewal" }));
    await waitFor(() => expect(decided).toHaveBeenCalledWith("REJECT"));
    expect(decide.mock.calls[0]!.slice(0, 5)).toEqual(["web", "org", pending, "REJECT", "Not needed"]);
    cleanup();
    render(createElement(OnBehalfRenewalDecision, { pending, platform: "web", organizationId: "org", onDecided: decided }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decided).toHaveBeenCalledWith("APPROVE"));
    expect(decide.mock.calls[1]!.slice(0, 5)).toEqual(["web", "org", pending, "APPROVE", null]);
  });
});
