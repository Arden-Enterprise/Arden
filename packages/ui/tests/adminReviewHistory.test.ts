// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";
import { ServerAudienceGroupPanel } from "../src/organization/ServerAudienceGroupPanel";
import { ServerKnowledgeFeaturePage } from "../src/knowledge/ServerKnowledgeFeaturePage";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/shared/api-client")>(),
  loadOrganizationAdministration: vi.fn(), listReviewerGrants: vi.fn(), loadAudienceGroups: vi.fn(),
  deactivateAudienceGroup: vi.fn(),
  createReviewerGrant: vi.fn(), listKnowledgeDrafts: vi.fn(), listKnowledgeSubmissions: vi.fn(),
  listPublishedKnowledge: vi.fn(), listKnowledgeReviewBoard: vi.fn(), loadKnowledgeOptions: vi.fn(),
  listKnowledgeDraftVersions: vi.fn(), loadKnowledgeDraftVersion: vi.fn(),
}));
vi.mock("../src/knowledge/ArdenRichTextEditor", () => ({
  ArdenDocumentView: ({ body }: { body: string }) => createElement("div", null, body),
}));

const grant: api.ReviewerGrant = {
  id: "grant", reviewerMembershipId: "reviewer", scope: "DEPARTMENT", departmentId: "department",
  classifications: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"], level: "STANDARD",
  teamTag: null, projectTag: null, validFrom: "2026-11-01T00:00:00.000Z", validUntil: null, status: "ACTIVE",
};
let restoreDialogs: () => void;
let previousScroll: PropertyDescriptor | undefined;
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.clearAllMocks();
  vi.mocked(api.loadOrganizationAdministration).mockResolvedValue({
    departments: [{ id: "department", name: "General", defaultRoleId: "role", defaultRoleName: "Member" }],
    roles: [], members: [{ id: "reviewer", email: "reviewer@example.test", name: "Reviewer", status: "ACTIVE",
      departmentId: "department", departmentIds: ["department"], isOrganizationAdmin: false, roleIds: [], roleNames: [] }],
    invitations: [{ id: "invite", email: "person@example.test", departmentId: null, status: "PENDING",
      expiresAt: "2099-01-01T00:00:00.000Z" }],
  });
  vi.mocked(api.listReviewerGrants).mockResolvedValue([grant]);
  vi.mocked(api.loadAudienceGroups).mockResolvedValue([]);
});
afterEach(() => {
  cleanup(); restoreDialogs(); vi.restoreAllMocks();
  if (previousScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", previousScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("organization administration fixes", () => {
  it("shows invitation email without an attached Member label", async () => {
    render(createElement(OrganizationAdminPage, { platform: "web", organizationId: "org",
      organizationName: "Example", contextOpen: false, onToggleContext: vi.fn() }));
    fireEvent.click(await screen.findByRole("tab", { name: /Invitations/ }));
    const table = screen.getByRole("table", { name: "Invitations" });
    expect(within(table).getByText("person@example.test")).toBeTruthy();
    expect(within(table).queryByText("Member")).toBeNull();
  });

  it("blocks the same reviewer scope and tags, but permits a different team tag", async () => {
    render(createElement(OrganizationAdminPage, { platform: "web", organizationId: "org",
      organizationName: "Example", contextOpen: false, onToggleContext: vi.fn() }));
    fireEvent.click(await screen.findByRole("tab", { name: /Review permissions/ }));
    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "department" } });
    expect((screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Review permission already assigned for this scope and tags.")).toBeTruthy();
    fireEvent.submit(document.getElementById("admin-grant-form")!);
    expect(api.createReviewerGrant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Team tag Optional"), { target: { value: "Operations" } });
    expect((screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("places inactive reader groups in their own section", async () => {
    vi.mocked(api.loadAudienceGroups).mockResolvedValue([
      { id: "active", name: "Active readers", description: "", version: 1, status: "ACTIVE", members: [] },
      { id: "inactive", name: "Former readers", description: "", version: 2, status: "INACTIVE", members: [] },
    ]);
    render(createElement(ServerAudienceGroupPanel, { platform: "web", organizationId: "org",
      organizationName: "Example", members: [], departments: [] }));
    const active = await screen.findByRole("region", { name: "Reader groups" });
    const inactive = screen.getByRole("region", { name: "Inactive reader groups" });
    expect(within(active).getByRole("button", { name: /Active readers/ })).toBeTruthy();
    expect(within(active).queryByRole("button", { name: /Former readers/ })).toBeNull();
    expect(within(inactive).getByRole("button", { name: /Former readers/ })).toBeTruthy();
  });

  it("moves a group to Inactive immediately after deactivation", async () => {
    const activeGroup = { id: "group", name: "Former readers", description: "", version: 1,
      status: "ACTIVE" as const, members: [] };
    vi.mocked(api.loadAudienceGroups).mockResolvedValue([activeGroup]);
    vi.mocked(api.deactivateAudienceGroup).mockResolvedValue({ ...activeGroup, version: 2, status: "INACTIVE" });
    render(createElement(ServerAudienceGroupPanel, { platform: "web", organizationId: "org",
      organizationName: "Example", members: [], departments: [] }));
    await screen.findByRole("button", { name: /Former readers/ });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate reader group" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deactivate group" }));
    const inactive = await screen.findByRole("region", { name: "Inactive reader groups" });
    expect(within(inactive).getByRole("button", { name: /Former readers/ })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Reader groups" })).queryByRole("button", { name: /Former readers/ })).toBeNull();
  });
});

describe("contribution version history", () => {
  it("opens a saved version as read-only content", async () => {
    vi.mocked(api.listKnowledgeDrafts).mockResolvedValue([{
      id: "draft", organizationId: "org", title: "Runbook", classification: "INTERNAL",
      responsibleDepartmentId: "department", targetScopeType: "DEPARTMENT", teamTag: null, projectTag: null,
      audienceIds: [], versionId: "v2", mimeType: "text/plain", contentHash: "hash", currentVersion: 2,
      hasPendingSubmission: false, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
    }]);
    vi.mocked(api.listKnowledgeSubmissions).mockResolvedValue([]);
    vi.mocked(api.listPublishedKnowledge).mockResolvedValue([]);
    vi.mocked(api.listKnowledgeReviewBoard).mockResolvedValue({ items: [], decided: [] });
    vi.mocked(api.loadKnowledgeOptions).mockResolvedValue({ departments: [{ id: "department", name: "General" }],
      audiences: [], primaryDepartmentId: "department" });
    vi.mocked(api.listKnowledgeDraftVersions).mockResolvedValue([
      { id: "v2", version: 2, mimeType: "text/plain", createdAt: "2026-11-02T00:00:00.000Z" },
      { id: "v1", version: 1, mimeType: "text/plain", createdAt: "2026-11-01T00:00:00.000Z" },
    ]);
    vi.mocked(api.loadKnowledgeDraftVersion).mockResolvedValue({ id: "v1", version: 1,
      mimeType: "text/plain", createdAt: "2026-11-01T00:00:00.000Z", body: "Previous content" });
    render(createElement(ServerKnowledgeFeaturePage, { platform: "web", organizationId: "org",
      organizationName: "Example", view: "knowledge", active: true, createdDraftId: null,
      contextOpen: false, onToggleContext: vi.fn() }));
    fireEvent.click(await screen.findByRole("tab", { name: /My Contributions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open details for Runbook" }));
    fireEvent.click(await screen.findByRole("button", { name: "View version 1" }));
    expect(await screen.findByRole("dialog", { name: "Version v1" })).toBeTruthy();
    expect(await screen.findByText("Previous content")).toBeTruthy();
    expect(api.loadKnowledgeDraftVersion).toHaveBeenCalledWith("web", "org", "draft", "v1");
  });
});
