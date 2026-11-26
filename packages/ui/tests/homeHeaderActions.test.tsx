// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestDialogs } from "./dialogTestSupport";
import * as api from "../src/shared/api-client";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";

vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({ ArdenDocumentView: () => null, ArdenRichTextEditor: () => null }));
vi.mock("../src/shared/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

describe("Home header actions", () => {
  it("keeps a single Collection management action in each Organization view and offers a quiet Refresh", async () => {
    const listPublished = vi.spyOn(api, "listPublishedKnowledge").mockResolvedValue([]);
    vi.spyOn(api, "listPublicationReports").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeDrafts").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeSubmissions").mockResolvedValue([]);
    vi.spyOn(api, "listKnowledgeReviewBoard").mockResolvedValue({ items: [], decided: [] });
    vi.spyOn(api, "loadKnowledgeOptions").mockResolvedValue({ departments: [], audiences: [], primaryDepartmentId: null });
    vi.spyOn(api, "loadKnowledgeCatalog").mockResolvedValue({ canManage: true, collections: [] });
    vi.spyOn(api, "listPublicationRenewals").mockResolvedValue([]);
    render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org", organizationName: "Test",
      active: true, view: "knowledge", createdDraftId: null, contextOpen: false, onToggleContext: vi.fn() }));

    // Discover: every section uses the same heading level, and Manage catalog sits once, in Collections.
    for (const name of ["Browse by type", "Collections", "Newly published"]) {
      expect((await screen.findByRole("heading", { name })).tagName).toBe("H2");
    }
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Manage collections/ })).toHaveLength(1));

    // All documents: the header no longer repeats Manage catalog.
    fireEvent.click(screen.getByRole("button", { name: "All documents" }));
    expect(screen.getAllByRole("button", { name: /Manage collections/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /Shared with me/ }));
    expect(screen.queryByRole("button", { name: /Manage collections/ })).toBeNull();

    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh.className).toContain("island-icon-button");
    const calls = listPublished.mock.calls.length;
    await act(async () => { fireEvent.click(refresh); });
    await waitFor(() => expect(listPublished.mock.calls.length).toBeGreaterThan(calls));
  });
});
