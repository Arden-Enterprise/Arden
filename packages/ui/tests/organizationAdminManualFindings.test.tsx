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
    createDepartment: vi.fn(), deleteDepartment: vi.fn(), loadAudienceGroups: vi.fn(), saveAudienceGroup: vi.fn(),
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

  it("does not refocus an old department error on tab return", async () => {
    vi.mocked(apiClient.createDepartment).mockRejectedValue(new ApiError(500, "Create failed."));
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: /Departments/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "New department" }), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Create department" }));
    await screen.findByText("Create failed.");
    fireEvent.click(screen.getByRole("tab", { name: /Members/i }));
    const tab = screen.getByRole("tab", { name: /Departments/i }); tab.focus(); fireEvent.click(tab);
    expect(document.activeElement).toBe(tab);
  });

  it("keeps focus out of the name field when an unrelated deletion fails", async () => {
    vi.mocked(apiClient.loadOrganizationAdministration).mockResolvedValue({ ...administration,
      departments: [{ id: "empty", name: "Empty", defaultRoleId: "role", defaultRoleName: "Empty members" }] });
    vi.mocked(apiClient.createDepartment).mockRejectedValue(new ApiError(500, "Create failed."));
    vi.mocked(apiClient.deleteDepartment).mockRejectedValue(new ApiError(500, "Delete failed."));
    openAdmin();
    fireEvent.click(await screen.findByRole("tab", { name: /Departments/i }));
    const input = screen.getByRole("textbox", { name: "New department" });
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Create department" }));
    await screen.findByText("Create failed.");
    fireEvent.click(screen.getByRole("button", { name: "Open Empty" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete department", exact: true }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete department", exact: true });
    confirm.focus(); fireEvent.click(confirm);
    await within(dialog).findByText("Delete failed.");
    expect(document.activeElement).not.toBe(input);
    expect(screen.getByRole("alertdialog")).toBe(dialog);
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

  it("no longer points admins to Topic management (decision 0025)", async () => {
    openAdmin();
    expect(await screen.findByRole("tab", { name: /Members/ })).toBeTruthy();
    expect(screen.queryByText(/Topic/)).toBeNull();
  });
});
