// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import type { KnowledgeLocation } from "../src/knowledge/knowledgeRoute";
import { deferred } from "./readerSummary.test-support";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null, ArdenRichTextEditor: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const published: api.PublishedKnowledge = { id: "v1", draftId: "doc", title: "Synthetic policy", classification: "INTERNAL",
  targetReaders: { mode: "ORGANIZATION", departmentId: null }, responsibleDepartmentId: "hr", responsibleDepartmentName: "HR",
  audienceIds: [], contentHash: "hash", body: "Exact document content", mimeType: "text/plain", publishedAt: "2026-11-19T00:00:00Z",
  validFrom: "2026-11-19T00:00:00Z", validUntil: null, management: null };

function mockWorkspace() {
  vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
  vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
  vi.spyOn(api, "listPublishedKnowledge").mockImplementation(async (_platform, _org, scope) => scope === "SHARED" ? [] : [published]);
  vi.spyOn(api, "loadPublishedKnowledge").mockResolvedValue(published);
  vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
  vi.spyOn(api, "listClosedPublicationReports").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
  vi.spyOn(api, "listPublicationRenewals").mockResolvedValue([]);
  vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [] });
  vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: false, collections: [] });
}

describe("Knowledge address reporting", () => {
  it("reports each full-page screen it shows and settles every request from the address bar", async () => {
    mockWorkspace();
    const onRouteChange = vi.fn();
    const onRouteSettled = vi.fn();
    const props = { platform: "web" as const, organizationId: "org", organizationName: "Test", active: true, view: "knowledge" as const,
      createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(), onRouteChange, onRouteSettled };
    const request = (location: KnowledgeLocation, navigationId: string) => ({ ...props, routeRequest: { location, navigationId } });
    const view = render(createElement(ServerKnowledgeFeaturePage, props));
    await waitFor(() => expect(onRouteChange).toHaveBeenLastCalledWith(
      { home: { kind: "home" }, reviews: { kind: "reviews" } }, { replace: false }));

    view.rerender(createElement(ServerKnowledgeFeaturePage, request({ kind: "document", id: "v1" }, "open-1")));
    await waitFor(() => expect(onRouteChange).toHaveBeenLastCalledWith(
      { home: { kind: "document", id: "v1" }, reviews: { kind: "reviews" } }, { replace: false }));
    await waitFor(() => expect(onRouteSettled).toHaveBeenCalledTimes(1));
    expect(view.container.textContent).toContain("Synthetic policy");

    view.rerender(createElement(ServerKnowledgeFeaturePage, request({ kind: "create" }, "create-1")));
    await waitFor(() => expect(onRouteChange).toHaveBeenLastCalledWith(
      { home: { kind: "create" }, reviews: { kind: "reviews" } }, { replace: false }));

    view.rerender(createElement(ServerKnowledgeFeaturePage, request({ kind: "home" }, "home-1")));
    await waitFor(() => expect(onRouteChange).toHaveBeenLastCalledWith(
      { home: { kind: "home" }, reviews: { kind: "reviews" } }, { replace: false }));
    await waitFor(() => expect(onRouteSettled).toHaveBeenCalledTimes(3));
  });

  it("reports the maintenance queue when Reviews switches to Maintenance", async () => {
    mockWorkspace();
    vi.spyOn(await import("../src/maintenance/maintenance-client"), "listMaintenanceCases").mockResolvedValue([]);
    const onRouteChange = vi.fn();
    const onRouteSettled = vi.fn();
    const props = { platform: "web" as const, organizationId: "org", organizationName: "Test", active: true, view: "review-queue" as const,
      createdDraftId: null, contextOpen: false, onToggleContext: vi.fn(), onRouteChange, onRouteSettled };
    const view = render(createElement(ServerKnowledgeFeaturePage, props));
    view.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, routeRequest: { location: { kind: "maintenance" }, navigationId: "m-1" } }));
    await waitFor(() => expect(onRouteChange).toHaveBeenLastCalledWith(
      { home: { kind: "home" }, reviews: { kind: "maintenance" } }, { replace: false }));
    expect(onRouteSettled).toHaveBeenCalled();
  });
});

describe("Reviews loading", () => {
  it.each(["web", "desktop"] as const)("loads the board on %s and resumes it while Contributions is stalled", async platform => {
    mockWorkspace();
    const stalled = deferred<api.KnowledgeSubmission[]>();
    vi.mocked(api.listKnowledgeSubmissions).mockReturnValue(stalled.promise);
    vi.mocked(api.loadKnowledgeOptions).mockReturnValue(deferred<api.KnowledgeOptions>().promise);
    const props = { platform, organizationId: "org", organizationName: "Test", active: true,
      view: "review-queue" as const, createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() };
    const page = render(createElement(ServerKnowledgeFeaturePage, props));

    await screen.findByRole("heading", { name: /^Reviews$/ });
    expect(api.listKnowledgeReviewBoard).toHaveBeenCalledExactlyOnceWith(platform, "org");
    expect(api.listKnowledgeDrafts).not.toHaveBeenCalled();
    expect(api.listKnowledgeSubmissions).not.toHaveBeenCalled();
    expect(api.listPublishedKnowledge).not.toHaveBeenCalled();
    expect(api.loadKnowledgeCatalog).not.toHaveBeenCalled();
    expect(api.listPublicationRenewals).not.toHaveBeenCalled();

    page.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, view: "knowledge" }));
    fireEvent.click(await screen.findByRole("tab", { name: /My Contributions/ }));
    await screen.findByText("Loading contributions…");
    expect(api.listKnowledgeSubmissions).toHaveBeenCalledExactlyOnceWith(platform, "org");
    page.rerender(createElement(ServerKnowledgeFeaturePage, props));
    await screen.findByRole("heading", { name: /^Reviews$/ });
    await act(async () => { stalled.resolve([]); });
    expect(api.listKnowledgeReviewBoard).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("No contributions yet")).toBeNull();
    expect(api.listKnowledgeSubmissions).toHaveBeenCalledTimes(1);
  });

  it("discards a late board response across workspaces and retries a denied board", async () => {
    mockWorkspace();
    const stale = deferred<Awaited<ReturnType<typeof api.listKnowledgeReviewBoard>>>();
    vi.mocked(api.listKnowledgeReviewBoard).mockReturnValueOnce(stale.promise)
      .mockRejectedValueOnce(new api.ApiError(403, "Reviews unavailable", "FORBIDDEN"));
    const onAssignedReviewCount = vi.fn();
    const props = { platform: "web" as const, organizationId: "old", organizationName: "Test",
      active: true, view: "review-queue" as const, createdDraftId: null, contextOpen: false,
      onToggleContext: vi.fn(), onAssignedReviewCount };
    const page = render(createElement(ServerKnowledgeFeaturePage, props));
    page.rerender(createElement(ServerKnowledgeFeaturePage, { ...props, organizationId: "new" }));
    await screen.findByText("Reviews unavailable");
    const row: api.AssignedKnowledgeReview = { submissionId: "old", snapshotId: "old-version", title: "Old workspace",
      departmentId: "old-department", classification: "INTERNAL", submittedAt: "2026-11-27T00:00:00Z", approvalBlocked: false };
    await act(async () => { stale.resolve({ items: [row], decided: [] }); });
    expect(onAssignedReviewCount).not.toHaveBeenCalledWith(1);
    expect(screen.queryByText("Old workspace")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: /^Reviews$/ });
    expect(api.listKnowledgeReviewBoard).toHaveBeenLastCalledWith("web", "new");
  });
});
