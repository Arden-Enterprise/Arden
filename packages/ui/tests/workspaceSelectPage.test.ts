// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { WorkspaceSelectPage } from "../src/sign-in/WorkspaceSelectPage";
import type { OrganizationMembership } from "../src/shared/api-client";

describe("WorkspaceSelectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("renders 'Create your organization' directly when user has no active workspaces", async () => {
    const onCreateOrg = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();

    render(
      createElement(WorkspaceSelectPage, {
        organizationName: "test-org",
        memberships: [],
        onContinue: vi.fn(),
        onBack,
        onCreateOrganization: onCreateOrg,
      })
    );

    // Primary heading is "Create your organization"
    expect(screen.getByRole("heading", { name: /create your organization/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/e\.g\. Acme Corporation/i)).toBeTruthy();

    // Type organization name and submit
    const input = screen.getByPlaceholderText(/e\.g\. Acme Corporation/i);
    fireEvent.change(input, { target: { value: "My Tech Startup" } });

    const submitBtn = screen.getByRole("button", { name: /create organization/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onCreateOrg).toHaveBeenCalledWith("My Tech Startup");
    });

    // Sign out button is present
    const signOutBtn = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(signOutBtn);
    expect(onBack).toHaveBeenCalled();
  });

  it("renders workspace choices when active memberships exist and allows creating another", async () => {
    const memberships: OrganizationMembership[] = [
      {
        organization: { id: "org-1", name: "Alpha Corp" },
        status: "active",
        departmentId: "dept-1",
        departmentName: "Engineering",
        roleCodes: ["MEMBER"],
        canUsePrivateWorkspace: true,
      },
    ];
    const onContinue = vi.fn();
    const onCreateOrg = vi.fn().mockResolvedValue(undefined);

    render(
      createElement(WorkspaceSelectPage, {
        organizationName: "Alpha Corp",
        memberships,
        onContinue,
        onBack: vi.fn(),
        onCreateOrganization: onCreateOrg,
      })
    );

    expect(screen.getByRole("heading", { name: /choose your workspace/i })).toBeTruthy();
    expect(screen.getByText("Alpha Corp")).toBeTruthy();
    expect(screen.getByText(/AVAILABLE/i)).toBeTruthy();

    // Clicking the workspace triggers onContinue
    const choiceBtn = screen.getByRole("button", { name: /Alpha Corp/i });
    fireEvent.click(choiceBtn);
    expect(onContinue).toHaveBeenCalledWith("org-1");

    // Can toggle "+ Create another organization"
    const createAnotherBtn = screen.getByRole("button", { name: /\+ create another organization/i });
    fireEvent.click(createAnotherBtn);

    expect(screen.getByRole("heading", { name: /create your organization/i })).toBeTruthy();
  });

  it("renders sample workspace in preview mode", () => {
    const onContinue = vi.fn();
    const onBack = vi.fn();

    render(
      createElement(WorkspaceSelectPage, {
        organizationName: "FPT Digital",
        onContinue,
        onBack,
      })
    );

    expect(screen.getByRole("heading", { name: /choose your workspace/i })).toBeTruthy();
    expect(screen.getByText("FPT Digital")).toBeTruthy();

    const continueBtn = screen.getByRole("button", { name: /continue to workspace/i });
    fireEvent.click(continueBtn);
    expect(onContinue).toHaveBeenCalled();
  });
});
