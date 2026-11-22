// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import * as maintenance from "../src/maintenance/maintenance-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const caseId = "11111111-1111-4111-8111-111111111111";
const assigned: maintenance.MaintenanceCase = { kind: "assigned", caseId, reporterStatus: "In Progress", title: "Synthetic policy",
  description: "Step 3 is wrong.", revision: 2, canDecide: true, canReassign: false, assigneeMembershipId: "reviewer" };

function openReviews() {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
  vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
  vi.spyOn(api, "listClosedPublicationReports").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [] });
  vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
  vi.spyOn(maintenance, "listMaintenanceCases").mockResolvedValue([
    { kind: "queue", caseId, reporterStatus: "Submitted", title: "Synthetic policy", revision: 1 }]);
  const getCase = vi.spyOn(maintenance, "getMaintenanceCase").mockResolvedValue(assigned);
  vi.spyOn(maintenance, "listMaintenanceHistory").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(maintenance, "listMaintenanceLinks").mockResolvedValue({ items: [] });
  vi.spyOn(maintenance, "readMaintenanceAnalysis").mockResolvedValue(null as unknown as maintenance.AnalysisRun);
  vi.spyOn(maintenance, "listMaintenanceVersions").mockResolvedValue({ items: [], currentPublishedVersionId: null });
  render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org", organizationName: "Test",
    active: true, view: "review-queue", createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() }));
  return getCase;
}

describe("maintenance case actions", () => {
  it("keeps the case and the reviewer's notes when a decision fails, then shows the latest case", async () => {
    const getCase = openReviews();
    const resolve = vi.spyOn(maintenance, "resolveMaintenanceCase")
      .mockRejectedValueOnce(new api.ApiError(409, "This case changed. Reload it and try again.", "MAINTENANCE_STALE"))
      .mockResolvedValueOnce({ ...assigned, reporterStatus: "Resolved", revision: 4, canDecide: false,
        reporterExplanation: "Step 3 now names the right menu." });
    fireEvent.click(await screen.findByRole("button", { name: "Maintenance" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Synthetic policy, Submitted" }));
    const explanation = await screen.findByLabelText("Reporter explanation");
    fireEvent.change(explanation, { target: { value: "Step 3 now names the right menu." } });
    fireEvent.change(screen.getByLabelText("Reviewer rationale"), { target: { value: "Checked against the current screens." } });
    getCase.mockResolvedValue({ ...assigned, revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));

    expect((await screen.findByRole("alert")).textContent).toContain("This case changed while you were working");
    expect(screen.queryByText("That case is unavailable")).toBeNull();
    expect(screen.getByRole("heading", { name: "Synthetic policy" })).toBeTruthy();
    expect(screen.getByLabelText("Reporter explanation")).toHaveProperty("value", "Step 3 now names the right menu.");
    expect(screen.getByLabelText("Reviewer rationale")).toHaveProperty("value", "Checked against the current screens.");
    await waitFor(() => expect(getCase).toHaveBeenCalledTimes(2));

    // The retry uses the refreshed revision and clears the inline error once it succeeds.
    await waitFor(() => expect(screen.getByRole("button", { name: "No change needed" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "No change needed" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls[1]![3]).toMatchObject({ expectedRevision: 3 });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("Step 3 now names the right menu.")).toBeTruthy();
  });
});
