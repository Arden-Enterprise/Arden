// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArdenShell } from "../src/app/ArdenShell";
import { SystemConsolePage } from "../src/system-console/SystemConsolePage";
import type { CurrentSession } from "../src/shared/api-client";

const api = vi.hoisted(() => ({
  restoreSession: vi.fn(),
  getSystemSetupStatus: vi.fn(async () => ({ needsInitialSetup: false, hasOrganizations: true })),
  restoreSystemSession: vi.fn(async () => null),
  completeSystemSetup: vi.fn(),
  systemSignIn: vi.fn(),
  systemSignOut: vi.fn(async () => undefined),
  getSystemConsoleReport: vi.fn(),
  getSystemConsoleOrganization: vi.fn(),
}));

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return { ...actual, ...api };
});

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("System Console", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it.each(["web", "desktop"] as const)("shows org reports and detail as read-only pages on %s", async platform => {
    api.getSystemConsoleReport.mockImplementation(async (_platform: string, report: string) => {
      if (report === "organizations") {
        return { items: [{ id: organizationId, name: "Northwind", status: "ACTIVE", drafts: 2, published: 4, openCases: 1 }], total: 1 };
      }
      return { organizations: { total: 1, active: 1 }, knowledge: { drafts: 2, publications: 4 } };
    });
    api.getSystemConsoleOrganization.mockResolvedValue({
      id: organizationId, name: "Northwind", status: "ACTIVE", storageBytes: 1024,
      contributions: { approved: 3 }, openCases: 1,
    });

    render(createElement(SystemConsolePage, { platform, onSignOut: vi.fn() }));
    expect(await screen.findByRole("heading", { name: "Tổng quan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tổ chứcTrạng thái và quy mô/ }));
    expect(await screen.findByText("Northwind")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByRole("cell", { name: "Đang hoạt động" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
    expect(await screen.findByRole("heading", { name: "Chi tiết tổ chức" })).toBeTruthy();
    expect(await screen.findByText("Dữ liệu tham chiếu (bytes)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tạo tổ chức|Sửa tổ chức|Tạm dừng tổ chức|Cấp quyền/ })).toBeNull();
    expect(api.getSystemConsoleOrganization).toHaveBeenCalledWith(platform, organizationId, expect.objectContaining({
      from: expect.any(String), to: expect.any(String),
    }));
  });

  it("rejects overlong custom ranges while allowing a one-day report", async () => {
    api.getSystemConsoleReport.mockResolvedValue({ organizations: { total: 1 } });
    render(createElement(SystemConsolePage, { platform: "web", onSignOut: vi.fn() }));
    await screen.findByRole("heading", { name: "Tổng quan" });
    const before = api.getSystemConsoleReport.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Khoảng thời gian"), { target: { value: "custom" } });
    const from = screen.getByLabelText("Từ ngày");
    const to = screen.getByLabelText("Đến ngày");
    fireEvent.change(from, { target: { value: "2024-01-01" } });
    fireEvent.change(to, { target: { value: "2026-01-01" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(api.getSystemConsoleReport).toHaveBeenCalledTimes(before));

    fireEvent.change(from, { target: { value: "2026-11-23" } });
    fireEvent.change(to, { target: { value: "2026-11-23" } });
    await waitFor(() => expect(api.getSystemConsoleReport).toHaveBeenCalledTimes(before + 1));
  });

  it("routes every report group through its matching read-only endpoint", async () => {
    api.getSystemConsoleReport.mockResolvedValue({});
    render(createElement(SystemConsolePage, { platform: "web", onSignOut: vi.fn() }));
    await screen.findByRole("heading", { name: "Tổng quan" });
    const sections = [
      ["Kho tri thức", "knowledge"], ["Sử dụng AI", "ai-usage"],
      ["Đóng góp tri thức", "contributions"], ["Phản hồi AI & lỗi", "feedback"],
      ["Chất lượng tri thức", "quality"], ["Sức khỏe hệ thống", "health"],
    ] as const;
    for (const [label, endpoint] of sections) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
      await waitFor(() => expect(api.getSystemConsoleReport).toHaveBeenLastCalledWith("web", endpoint, expect.objectContaining({
        from: expect.any(String), to: expect.any(String),
      })));
    }
  });

  it("opens the Console only for a no-membership session the API marked eligible", async () => {
    const session: CurrentSession = {
      actor: { id: "11111111-1111-4111-8111-111111111111", email: "system@example.test", emailVerified: true },
      account: { passwordSetupRequired: false },
      canAccessSystemConsole: true,
      memberships: [],
    };
    api.restoreSession.mockResolvedValue(session);
    api.getSystemConsoleReport.mockResolvedValue({ organizations: { total: 0 } });

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: "Tổng quan" })).toBeTruthy();
    await waitFor(() => expect(api.getSystemConsoleReport).toHaveBeenCalled());
  });

  it("keeps the organization route when membership exists even if a stale session claims Console access", async () => {
    api.restoreSession.mockResolvedValue({
      actor: { id: "33333333-3333-4333-8333-333333333333", email: "member@example.test", emailVerified: true },
      account: { passwordSetupRequired: false },
      canAccessSystemConsole: true,
      memberships: [{ organization: { id: organizationId, name: "Northwind" }, status: "active",
        roleCodes: ["MEMBER"], canUsePrivateWorkspace: true }],
    } satisfies CurrentSession);

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /choose your workspace/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tổng quan" })).toBeNull();
    expect(api.getSystemConsoleReport).not.toHaveBeenCalled();
  });

  it("does not force an unassigned account to create an organization", async () => {
    api.restoreSession.mockResolvedValue({
      actor: { id: "22222222-2222-4222-8222-222222222222", email: "dedicated@example.test", emailVerified: true },
      account: { passwordSetupRequired: false },
      canAccessSystemConsole: false,
      memberships: [],
    } satisfies CurrentSession);

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /create your organization/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue without creating an organization/i }));
    expect(await screen.findByRole("heading", { name: /account setup complete/i })).toBeTruthy();
    expect(api.getSystemConsoleReport).not.toHaveBeenCalled();
  });

  it("opens First-Time System Admin Setup automatically on a fresh installation and enters the Console after setup", async () => {
    api.restoreSession.mockResolvedValue(null);
    api.getSystemSetupStatus.mockResolvedValue({ needsInitialSetup: true, hasOrganizations: false });
    api.restoreSystemSession.mockResolvedValue(null);
    api.completeSystemSetup.mockResolvedValue({
      administrator: {
        id: "44444444-4444-4444-8444-444444444444",
        email: "sysadmin@arden.local",
        fullName: "System Operator",
        canManageSystemAdmins: true,
      },
      sessionExpiresAt: "2026-11-27T00:00:00.000Z",
    });
    api.getSystemConsoleReport.mockResolvedValue({ organizations: { total: 0 } });

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /create the first system admin/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("One-time setup token"), { target: { value: "valid-setup-token-123456" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "System Operator" } });
    fireEvent.change(screen.getByLabelText("System Admin email"), { target: { value: "sysadmin@arden.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPassword!1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "StrongPassword!1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create System Admin" }));

    expect(await screen.findByRole("heading", { name: "Tổng quan" })).toBeTruthy();
    expect(api.completeSystemSetup).toHaveBeenCalledWith("web", {
      setupToken: "valid-setup-token-123456",
      email: "sysadmin@arden.local",
      fullName: "System Operator",
      password: "StrongPassword!1",
    });
  });

  it("keeps member sign-in on / when organizations already exist while allowing /system/setup to initialize System Admin", async () => {
    api.restoreSession.mockResolvedValue(null);
    api.getSystemSetupStatus.mockResolvedValue({ needsInitialSetup: true, hasOrganizations: true });
    api.restoreSystemSession.mockResolvedValue(null);

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /sign in to your account/i })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /initialize system admin/i }));
    expect(await screen.findByRole("heading", { name: /create the first system admin/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /back to member sign in/i })).toBeTruthy();
  });

  it("redirects /system/setup to System Admin sign-in when initial setup is already completed", async () => {
    window.history.replaceState(null, "", "/system/setup");
    api.restoreSession.mockResolvedValue(null);
    api.getSystemSetupStatus.mockResolvedValue({ needsInitialSetup: false, hasOrganizations: true });
    api.restoreSystemSession.mockResolvedValue(null);

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /system admin sign in/i })).toBeTruthy();
    expect(screen.getByText(/initial system admin setup has already been completed/i)).toBeTruthy();
  });
});
