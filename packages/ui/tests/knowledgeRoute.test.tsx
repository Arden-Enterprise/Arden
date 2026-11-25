// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import type { KnowledgeLocation } from "../src/knowledge/knowledgeRoute";

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
