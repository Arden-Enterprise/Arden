// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";
import { ApiError, type OrganizationAdministration } from "../src/shared/api-client";
import type { AudienceGroupRecord } from "../src/shared/audience-group-contracts";
import * as apiClient from "../src/shared/api-client";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return { ...actual,
    loadOrganizationAdministration: vi.fn(), listReviewerGrants: vi.fn(),
    createDepartment: vi.fn(), loadAudienceGroups: vi.fn(), saveAudienceGroup: vi.fn(),
    loadKnowledgeCatalog: vi.fn(), listPublishedKnowledge: vi.fn(), saveKnowledgeCatalogEntry: vi.fn(),
  };
});

const administration: OrganizationAdministration = {
  departments: [], roles: [], invitations: [],
  members: [
    { id: "waiting", name: "Waiting", email: "waiting@example.test", status: "ACTIVE",
      departmentId: null, isOrganizationAdmin: false, roleIds: [], roleNames: [] },
    { id: "ready", name: "Ready", email: "ready@example.test", status: "ACTIVE",
      departmentId: "department", isOrganizationAdmin: false, roleIds: [], roleNames: [] },
  ],
};
const group: AudienceGroupRecord = {
  id: "group", name: "Operations readers", description: "Original", status: "ACTIVE", version: 1, members: [],
};
let restoreDialogs: () => void;

beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.clearAllMocks();
  vi.mocked(apiClient.loadOrganizationAdministration).mockResolvedValue(administration);
  vi.mocked(apiClient.listReviewerGrants).mockResolvedValue([]);
  vi.mocked(apiClient.loadAudienceGroups).mockResolvedValue([group]);
  vi.mocked(apiClient.loadKnowledgeCatalog).mockResolvedValue({ canManage: true, topics: [], collections: [] });
  vi.mocked(apiClient.listPublishedKnowledge).mockResolvedValue([]);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); restoreDialogs(); Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); });

function openAdmin() {
  render(createElement(OrganizationAdminPage, {
    platform: "web", organizationId: "org", organizationName: "Test Org",
    contextOpen: false, onToggleContext: vi.fn(),
  }));
}

describe("organization admin manual findings", () => {
  it("shows department creation failures beside the name field", async () => {
    vi.mocked(apiClient.createDepartment).mockRejectedValue(new ApiError(500, "Could not create department.", "INTERNAL_ERROR"));
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: /Departments/i }));
    const input = screen.getByRole("textbox", { name: "New department" });
    fireEvent.change(input, { target: { value: "A".repeat(80) } });
    fireEvent.click(screen.getByRole("button", { name: "Create department" }));
    await waitFor(() => expect(apiClient.createDepartment).toHaveBeenCalledWith("web", "org", "A".repeat(80)));
    expect(await screen.findByText("Could not create department.")).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("makes custom group renaming visible and omits unassigned members from Add", async () => {
    vi.mocked(apiClient.saveAudienceGroup).mockResolvedValue({ ...group, name: "Renamed readers", version: 2 });
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: /Readers/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Operations readers/i }));
    const addMembers = screen.getByRole("combobox", { name: "Add an active member" });
    expect(within(addMembers).queryByRole("option", { name: /Waiting/i })).toBeNull();
    expect(within(addMembers).getByRole("option", { name: /Ready/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    const name = screen.getByRole("textbox", { name: "Group name" });
    fireEvent.change(name, { target: { value: "Renamed readers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(apiClient.saveAudienceGroup).toHaveBeenCalledWith(
      "web", "org", group, { name: "Renamed readers", description: "Original" },
    ));
  });

  it("creates a Topic directly in Administration", async () => {
    vi.mocked(apiClient.saveKnowledgeCatalogEntry).mockResolvedValue({
      id: "topic-1", name: "Operations", description: "", status: "ACTIVE", version: 1,
    });
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: "Topics" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Name *" }), { target: { value: "Operations" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(apiClient.saveKnowledgeCatalogEntry).toHaveBeenCalledWith("web", "org", "topics", null,
      { name: "Operations", description: "", status: "ACTIVE" }));
    expect(screen.queryByRole("button", { name: "Open Knowledge" })).toBeNull();
  });

  it("guards unsaved Topic edits when leaving Administration's catalog tab", async () => {
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: "Topics" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Name *" }), { target: { value: "Draft topic" } });
    fireEvent.click(screen.getByRole("tab", { name: /Members/i }));
    expect(await screen.findByText(/Changes have not been saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: "Name *" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Members/i }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Name *" })).toBeNull());
  });

  it("does not show the catalog editor when catalog management is denied", async () => {
    vi.mocked(apiClient.loadKnowledgeCatalog).mockResolvedValue({ canManage: false, topics: [], collections: [] });
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: "Topics" }));
    expect(await screen.findByText("Catalog management is unavailable for this account.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Name *" })).toBeNull();
  });
});
