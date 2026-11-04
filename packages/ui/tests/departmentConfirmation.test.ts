// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";
import * as apiClient from "../src/shared/api-client";
import { installTestDialogs } from "./dialogTestSupport";

let restoreDialogs: () => void;

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    loadOrganizationAdministration: vi.fn(),
    listReviewerGrants: vi.fn(),
    loadAudienceGroups: vi.fn(),
    changePrimaryDepartment: vi.fn(),
  };
});

const mockAdminData: apiClient.OrganizationAdminData = {
  departments: [
    { id: "dept-1", name: "Engineering", defaultRoleId: "role-1", defaultRoleName: "Engineer" },
    { id: "dept-2", name: "Product", defaultRoleId: "role-2", defaultRoleName: "Product Manager" },
  ],
  roles: [],
  members: [
    {
      id: "member-1",
      name: "Alice Unassigned",
      email: "alice@example.com",
      status: "ACTIVE",
      departmentId: null,
      departmentIds: [],
      isOrganizationAdmin: false,
      roleIds: [],
      roleNames: [],
    },
    {
      id: "member-2",
      name: "Bob InEngineering",
      email: "bob@example.com",
      status: "ACTIVE",
      departmentId: "dept-1",
      departmentIds: ["dept-1"],
      isOrganizationAdmin: false,
      roleIds: [],
      roleNames: [],
    },
  ],
  invitations: [],
};

beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.clearAllMocks();
  vi.mocked(apiClient.loadOrganizationAdministration).mockResolvedValue(mockAdminData);
  vi.mocked(apiClient.listReviewerGrants).mockResolvedValue([]);
  vi.mocked(apiClient.loadAudienceGroups).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  restoreDialogs?.();
});

describe("OrganizationAdminPage department assignment confirmation", () => {
  it("prompts confirmation when assigning an unassigned member to a department", async () => {
    vi.mocked(apiClient.changePrimaryDepartment).mockResolvedValue(undefined);

    render(
      createElement(OrganizationAdminPage, {
        platform: "web",
        organizationId: "org-1",
        organizationName: "Test Org",
      })
    );

    // Wait for members table to load
    await waitFor(() => {
      expect(screen.getByText("Alice Unassigned")).toBeTruthy();
    });

    // Click on Alice Unassigned to open MemberDetailIsland
    const manageBtn = screen.getAllByRole("button", { name: /manage alice unassigned/i })[0];
    fireEvent.click(manageBtn);

    // Member details island should be open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Alice Unassigned" })).toBeTruthy();
    });

    // Click Move button
    const moveBtn = screen.getByRole("button", { name: /^move$/i });
    fireEvent.click(moveBtn);

    // Select Engineering department from dropdown
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "dept-1" } });

    // Confirmation dialog should appear with Assign title
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /assign alice unassigned to engineering\?/i })).toBeTruthy();
      expect(screen.getByText(/alice unassigned will be assigned to engineering as their primary department/i)).toBeTruthy();
    });

    // Click confirm button
    const confirmBtn = screen.getByRole("button", { name: /assign department/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiClient.changePrimaryDepartment).toHaveBeenCalledWith("web", "org-1", "member-1", "dept-1");
    });
  });

  it("prompts confirmation when moving an already assigned member to another department", async () => {
    vi.mocked(apiClient.changePrimaryDepartment).mockResolvedValue(undefined);

    render(
      createElement(OrganizationAdminPage, {
        platform: "web",
        organizationId: "org-1",
        organizationName: "Test Org",
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Bob InEngineering")).toBeTruthy();
    });

    // Click Bob
    const manageBtn = screen.getAllByRole("button", { name: /manage bob inengineering/i })[0];
    fireEvent.click(manageBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bob InEngineering" })).toBeTruthy();
    });

    // Click Move button
    const moveBtn = screen.getByRole("button", { name: /^move$/i });
    fireEvent.click(moveBtn);

    // Select Product department
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "dept-2" } });

    // Confirmation dialog should appear with Move title
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /move bob inengineering to product\?/i })).toBeTruthy();
      expect(screen.getByText(/bob inengineering's primary department will change from engineering to product/i)).toBeTruthy();
    });

    // Click confirm
    const confirmBtn = screen.getByRole("button", { name: /move department/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiClient.changePrimaryDepartment).toHaveBeenCalledWith("web", "org-1", "member-2", "dept-2");
    });
  });
});
