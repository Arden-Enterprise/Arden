// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { SettingsDialog } from "../src/settings/SettingsDialog";
import { AccountSettingsSection } from "../src/settings/sections/AccountSettingsSection";
import { registerSettingsSection } from "../src/settings/registry";
import type { SettingsSectionProps } from "../src/settings/types";
import { installTestDialogs } from "./dialogTestSupport";
import * as apiClient from "../src/shared/api-client";

let restoreDialogs: () => void;

beforeEach(() => {
  restoreDialogs = installTestDialogs();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  restoreDialogs?.();
});

describe("Settings Framework & Dialog", () => {
  it("renders SettingsDialog with default Account section", () => {
    render(
      createElement(SettingsDialog, {
        platform: "web",
        session: null,
        organization: null,
        memberName: "Lan Nguyen",
        memberRole: "Member",
        onClose: vi.fn(),
      })
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /account/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /account settings/i })).toBeTruthy();
    expect(screen.getByText("Lan Nguyen")).toBeTruthy();
  });

  it("supports dynamic registration of teammate settings sections", () => {
    function CustomAISettings({ platform }: SettingsSectionProps) {
      return createElement("div", { "data-testid": "ai-settings" }, "AI Settings Content for " + platform);
    }

    const unregister = registerSettingsSection({
      id: "ai-settings",
      label: "Arden AI",
      icon: "chat",
      description: "Custom AI settings",
      component: CustomAISettings,
      order: 50,
    });

    try {
      render(
        createElement(SettingsDialog, {
          platform: "desktop",
          session: null,
          organization: null,
          onClose: vi.fn(),
        })
      );

      const aiTab = screen.getByRole("tab", { name: /arden ai/i });
      expect(aiTab).toBeTruthy();

      // Click the custom AI tab
      fireEvent.click(aiTab);

      expect(screen.getByTestId("ai-settings")).toBeTruthy();
      expect(screen.getByText(/AI Settings Content for desktop/i)).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it("shows a section registered while the dialog is mounting", async () => {
    function Registrar() {
      useLayoutEffect(() => registerSettingsSection({
        id: "during-mount",
        label: "During mount",
        component: () => createElement("div", null, "Mounted during open"),
        order: 40,
      }), []);
      return null;
    }

    render(
      createElement(SettingsDialog, {
        platform: "desktop",
        session: null,
        organization: null,
        onClose: vi.fn(),
        extraSections: [{
          id: "registrar",
          label: "Registrar",
          component: Registrar,
          order: 5,
        }],
      })
    );

    expect(await screen.findByRole("tab", { name: /during mount/i })).toBeTruthy();
  });

  it("shows a section registered while settings is open", async () => {
    render(
      createElement(SettingsDialog, {
        platform: "desktop",
        session: null,
        organization: null,
        onClose: vi.fn(),
      })
    );
    const unregister = registerSettingsSection({
      id: "live-ai",
      label: "Live AI",
      icon: "chat",
      component: () => createElement("div", null, "Live AI section"),
      order: 30,
    });
    try {
      expect(await screen.findByRole("tab", { name: /live ai/i })).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      createElement(SettingsDialog, {
        platform: "web",
        session: null,
        organization: null,
        onClose,
      })
    );

    const closeBtn = screen.getByRole("button", { name: /close settings/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AccountSettingsSection", () => {
  it("displays preview notice when in sample preview mode (session is null)", () => {
    render(
      createElement(AccountSettingsSection, {
        platform: "web",
        session: null,
        organization: { name: "Sample Org", templateId: "test", departments: [], members: [] },
        memberName: "Alex Preview",
        memberRole: "Member",
        memberDepartment: "Engineering",
        onClose: vi.fn(),
      })
    );

    expect(screen.getByText(/Sample Preview Session/i)).toBeTruthy();
    expect(screen.getByText("Alex Preview")).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Sample Org")).toBeTruthy();
  });

  it("validates password length and matching confirmation when authenticated", async () => {
    const mockSession: apiClient.CurrentSession = {
      actor: { id: "user-123", email: "user@example.com" },
      account: { passwordSetupRequired: false },
      memberships: [],
    };

    render(
      createElement(AccountSettingsSection, {
        platform: "web",
        session: mockSession,
        organization: null,
        memberName: "Alice Developer",
        memberRole: "Organization Admin",
        onClose: vi.fn(),
      })
    );

    const newPasswordInput = screen.getByLabelText(/new password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const submitBtn = screen.getByRole("button", { name: /update password/i });

    // Too short
    fireEvent.change(newPasswordInput, { target: { value: "123" } });
    fireEvent.change(confirmInput, { target: { value: "123" } });
    fireEvent.click(submitBtn);

    expect(screen.getByRole("alert").textContent).toContain("at least 8 characters");

    // Passwords mismatch
    fireEvent.change(newPasswordInput, { target: { value: "password123" } });
    fireEvent.change(confirmInput, { target: { value: "different123" } });
    fireEvent.click(submitBtn);

    expect(screen.getByRole("alert").textContent).toContain("do not match");
  });

  it("updates password successfully for authenticated user", async () => {
    const mockSession: apiClient.CurrentSession = {
      actor: { id: "user-123", email: "user@example.com" },
      account: { passwordSetupRequired: false },
      memberships: [],
    };

    const updateSpy = vi.spyOn(apiClient, "updateAccountPassword").mockResolvedValue(undefined);

    render(
      createElement(AccountSettingsSection, {
        platform: "web",
        session: mockSession,
        organization: null,
        memberName: "Alice Developer",
        onClose: vi.fn(),
      })
    );

    const newPasswordInput = screen.getByLabelText(/new password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    fireEvent.change(newPasswordInput, { target: { value: "NewSecurePassword123!" } });
    fireEvent.change(confirmInput, { target: { value: "NewSecurePassword123!" } });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("web", "NewSecurePassword123!");
      expect(screen.getByRole("status").textContent).toContain("Password updated successfully");
    });
  });

  it("sets initial password when passwordSetupRequired is true", async () => {
    const mockSession: apiClient.CurrentSession = {
      actor: { id: "user-google", email: "googleuser@example.com" },
      account: { passwordSetupRequired: true },
      memberships: [],
    };

    const setSpy = vi.spyOn(apiClient, "setAccountPassword").mockResolvedValue(mockSession);
    const onRefreshSession = vi.fn().mockResolvedValue(undefined);

    render(
      createElement(AccountSettingsSection, {
        platform: "web",
        session: mockSession,
        organization: null,
        onRefreshSession,
        onClose: vi.fn(),
      })
    );

    expect(screen.getByText(/Password Setup Required/i)).toBeTruthy();

    const newPasswordInput = screen.getByLabelText(/create password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    fireEvent.change(newPasswordInput, { target: { value: "GoogleFirstPassword123!" } });
    fireEvent.change(confirmInput, { target: { value: "GoogleFirstPassword123!" } });

    const submitBtn = screen.getByRole("button", { name: /set password/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith("web", "GoogleFirstPassword123!");
      expect(onRefreshSession).toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toContain("Password has been set successfully");
    });
  });
});
