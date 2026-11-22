// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import * as maintenance from "../src/maintenance/maintenance-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const caseId = "11111111-1111-4111-8111-111111111111";
const assigned: maintenance.MaintenanceCase = { kind: "assigned", caseId, reporterStatus: "In Progress", title: "Synthetic policy",
  description: "Step 3 is wrong.", revision: 2, canDecide: true, canReassign: false, assigneeMembershipId: "reviewer",
  documentId: "doc", publishedVersionId: "v1" };
const props = { platform: "web" as const, organizationId: "org", organizationName: "Test", active: true,
  createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() };
const published: api.PublishedKnowledge = { id: "v1", draftId: "doc", title: "Synthetic policy", classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null }, responsibleDepartmentId: "hr", responsibleDepartmentName: "HR",
  audienceIds: [], contentHash: "hash", body: "Exact document content", mimeType: "text/plain", publishedAt: "2026-11-19T00:00:00Z",
  validFrom: "2026-11-19T00:00:00Z", validUntil: null, management: null };

function mockWorkspace(drafts: api.KnowledgeDraftSummary[] = []) {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue(drafts);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listPublishedKnowledge").mockImplementation(async (_platform, _org, scope) => scope === "SHARED" ? [] : [published]);
  vi.spyOn(api, "loadPublishedKnowledge").mockResolvedValue(published);
  vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
  vi.spyOn(api, "listClosedPublicationReports").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [] });
  vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
}

function openReviews() {
  mockWorkspace();
  vi.spyOn(maintenance, "listMaintenanceCases").mockImplementation(async (_platform, _org, scope) => scope === "mine" ? []
    : [{ kind: "queue", caseId, reporterStatus: "Submitted", title: "Synthetic policy", revision: 1 }]);
  const getCase = vi.spyOn(maintenance, "getMaintenanceCase").mockResolvedValue(assigned);
  vi.spyOn(maintenance, "listMaintenanceHistory").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(maintenance, "listMaintenanceLinks").mockResolvedValue({ items: [] });
  const analysis = vi.spyOn(maintenance, "readMaintenanceAnalysis").mockResolvedValue(null as unknown as maintenance.AnalysisRun);
  const versions = vi.spyOn(maintenance, "listMaintenanceVersions").mockResolvedValue({ items: [], currentPublishedVersionId: null });
  const view = render(createElement(ServerKnowledgeFeaturePage, { ...props, view: "review-queue" }));
  const openCase = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Maintenance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Synthetic policy, Submitted" }));
  };
  return { getCase, analysis, versions, view, openCase };
}

async function writeNotes() {
  fireEvent.change(await screen.findByLabelText("Reporter explanation"), { target: { value: "Step 3 now names the right menu." } });
  fireEvent.change(screen.getByLabelText("Reviewer rationale"), { target: { value: "Checked against the current screens." } });
}

describe("maintenance case actions", () => {
  it("keeps the case and the reviewer's notes when a decision fails, then shows the latest case", async () => {
    const { getCase, openCase } = openReviews();
    const resolve = vi.spyOn(maintenance, "resolveMaintenanceCase")
      .mockRejectedValueOnce(new api.ApiError(409, "This case changed. Reload it and try again.", "MAINTENANCE_STALE"))
      .mockResolvedValueOnce({ ...assigned, reporterStatus: "Resolved", revision: 4, canDecide: false,
        reporterExplanation: "Step 3 now names the right menu." });
    await openCase();
    await writeNotes();
    getCase.mockResolvedValue({ ...assigned, revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));

    expect((await screen.findByRole("alert")).textContent).toContain("This case changed while you were working");
    expect(screen.queryByText("That case is unavailable")).toBeNull();
    expect(screen.getByRole("heading", { name: "Synthetic policy" })).toBeTruthy();
    expect(screen.getByLabelText("Reporter explanation")).toHaveProperty("value", "Step 3 now names the right menu.");
    expect(screen.getByLabelText("Reviewer rationale")).toHaveProperty("value", "Checked against the current screens.");
    await waitFor(() => expect(getCase).toHaveBeenCalledTimes(2));

    // The retry uses the refreshed revision under a new key and clears the inline error once it succeeds.
    await waitFor(() => expect(screen.getByRole("button", { name: "No change needed" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls[1]![3]).toMatchObject({ expectedRevision: 3 });
    expect(resolve.mock.calls[1]![4]).not.toBe(resolve.mock.calls[0]![4]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("Step 3 now names the right menu.")).toBeTruthy();
  });

  it("reopens the case without its sources when a failed action shows the reviewer lost access", async () => {
    const { getCase, versions, openCase } = openReviews();
    versions.mockResolvedValueOnce({ currentPublishedVersionId: "v2", items: [
      { publishedVersionId: "v1", versionNo: 1, publishedAt: "2026-11-19T00:00:00Z", current: false },
      { publishedVersionId: "v2", versionNo: 2, publishedAt: "2026-11-20T00:00:00Z", current: true }] })
      .mockRejectedValue(new api.ApiError(404, "That case is unavailable.", "MAINTENANCE_UNAVAILABLE"));
    vi.spyOn(maintenance, "compareMaintenanceCase").mockResolvedValue({ unavailable: false, rows: [{ kind: "added", text: "Restricted line" }] });
    vi.spyOn(maintenance, "resolveMaintenanceCase").mockRejectedValue(new api.ApiError(404, "That case is unavailable.", "MAINTENANCE_UNAVAILABLE"));
    await openCase();
    expect(await screen.findByText("Restricted line")).toBeTruthy();
    await writeNotes();
    getCase.mockResolvedValue({ kind: "queue", caseId, reporterStatus: "In Progress", title: "Synthetic policy", revision: 3, needsReassignment: true });
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));

    expect(await screen.findByText("Needs reassignment. You can no longer decide this case.")).toBeTruthy();
    expect(screen.queryByText("Restricted line")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("That case is unavailable.");
  });

  it("removes the open case and its evidence when the refresh denies access entirely", async () => {
    const { getCase, openCase } = openReviews();
    const denied = new api.ApiError(404, "That case is unavailable.", "MAINTENANCE_UNAVAILABLE");
    vi.spyOn(maintenance, "readMaintenanceOriginal").mockResolvedValue({
      unavailable: false, publishedVersionId: "v1", text: "Restricted original",
    });
    vi.spyOn(maintenance, "resolveMaintenanceCase").mockRejectedValue(denied);
    await openCase();
    fireEvent.click(await screen.findByRole("button", { name: "Open reported version" }));
    expect(await screen.findByText("Restricted original")).toBeTruthy();
    await writeNotes();

    getCase.mockRejectedValue(denied);
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));

    expect(await screen.findByRole("heading", { name: "That case is unavailable" })).toBeTruthy();
    expect(screen.queryByText("Restricted original")).toBeNull();
    expect(screen.queryByText(assigned.description!)).toBeNull();
  });

  it.each([
    { failure: new Error("Connection lost"), replay: true },
    { failure: new api.ApiError(409, "This case changed.", "MAINTENANCE_STALE"), replay: false },
  ])("retries a question using the right command after $failure.message", async ({ failure, replay }) => {
    const { getCase, openCase } = openReviews();
    const refreshed = { ...assigned, revision: 3, description: "Refreshed case details." };
    const send = vi.spyOn(maintenance, "postMaintenanceMessage").mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(refreshed);
    await openCase();
    const question = await screen.findByLabelText("Question for the reporter");
    fireEvent.change(question, { target: { value: "Does this still happen?" } });
    getCase.mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    expect(await screen.findByText("Refreshed case details.")).toBeTruthy();
    expect(question).toHaveProperty("value", "Does this still happen?");

    fireEvent.click(screen.getByRole("button", { name: "Ask", exact: true }));
    await waitFor(() => expect(question).toHaveProperty("value", ""));
    const [, , , body, key] = send.mock.calls[1]!;
    expect(body).toEqual({ expectedRevision: replay ? 2 : 3, message: "Does this still happen?" });
    if (replay) expect(key).toBe(send.mock.calls[0]![4]);
    else expect(key).not.toBe(send.mock.calls[0]![4]);
  });

  it("follows an analysis that is still running when the case opens", async () => {
    const { analysis, openCase } = openReviews();
    analysis.mockResolvedValueOnce({ runId: "run", state: "running", findings: [], attempt: 1 })
      .mockResolvedValue({ runId: "run", state: "succeeded", attempt: 1,
        findings: [{ versionId: "v1", summary: "Step 3 still names the old menu." }] });
    await openCase();
    expect(await screen.findByText("Step 3 still names the old menu.", {}, { timeout: 4000 })).toBeTruthy();
    expect(analysis).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("keeps a case opened in Reviews out of Home → My reports", async () => {
    const { view, openCase } = openReviews();
    await openCase();
    expect(await screen.findByLabelText("Reporter explanation")).toBeTruthy();
    view.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, view: "knowledge" }));
    fireEvent.click(await screen.findByRole("tab", { name: /My reports/ }));
    expect(await screen.findByText("No reports yet")).toBeTruthy();
    expect(screen.queryByLabelText("Reporter explanation")).toBeNull();
  });
});

describe("start review from a document", () => {
  let restoreDialogs: () => void;
  beforeEach(() => { restoreDialogs = installTestDialogs(); });
  afterEach(() => { cleanup(); restoreDialogs(); });
  const openDocument = async () => {
    render(createElement(ServerKnowledgeFeaturePage, { ...props, view: "knowledge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read Synthetic policy" }));
  };

  it("explains a denied review instead of reporting an unavailable case", async () => {
    mockWorkspace();
    vi.spyOn(maintenance, "createMaintenanceCase")
      .mockRejectedValue(new api.ApiError(404, "That case is unavailable.", "MAINTENANCE_UNAVAILABLE"));
    await openDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Start review" }));
    fireEvent.change(screen.getByLabelText("Review objective"), { target: { value: "Check the escalation steps." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Start review" }).at(-1)!);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Only a reviewer whose grant covers this document, and who didn't write it, can start a review.");
  });

  it("does not offer a review of the reader's own document", async () => {
    mockWorkspace([{ id: "doc", organizationId: "org", title: "Synthetic policy", classification: "INTERNAL",
      responsibleDepartmentId: "hr" } as unknown as api.KnowledgeDraftSummary]);
    await openDocument();
    expect(await screen.findByRole("button", { name: /Report an issue/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });
});
