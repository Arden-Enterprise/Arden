// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArdenShell } from "../src/app/ArdenShell";
import * as apiClient from "../src/shared/api-client";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    restoreSession: vi.fn(),
    apiRequest: vi.fn(),
  };
});

vi.mock("../src/organization/OrganizationAdminPage", async () => {
  const { createElement: element } = await import("react");
  return {
    OrganizationAdminPage: ({ onSendingInvitationsChange }: { onSendingInvitationsChange: (sending: boolean) => void }) =>
      element("main", null,
        element("p", null, "Batch in progress"),
        element("button", { onClick: () => onSendingInvitationsChange(true) }, "Start batch"),
        element("button", { onClick: () => onSendingInvitationsChange(false) }, "Finish batch")),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.restoreSession).mockResolvedValue({
    actor: { id: "user-1", email: "admin@example.com", fullName: "Admin" },
    account: { passwordSetupRequired: false },
    memberships: [{ organization: { id: "org-1", name: "Test Org" }, status: "active", departmentId: "dept-1", roleCodes: ["ORG_ADMIN"], canUsePrivateWorkspace: true }],
  });
  vi.mocked(apiClient.apiRequest).mockResolvedValue({ items: [], nextCursor: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ArdenShell invitation batch navigation", () => {
  it("keeps the administrator on the result page until sending finishes", async () => {
    render(createElement(ArdenShell, { platform: "web" }));
    fireEvent.click(await screen.findByRole("button", { name: "Administration" }));
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Private Notes" })[0]);
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    const unloadWhileSending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadWhileSending);
    expect(unloadWhileSending.defaultPrevented).toBe(true);
    fireEvent.click(document.querySelector(".sidebar-member") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(screen.getByText("Batch in progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish batch" }));
    const unloadAfterSending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadAfterSending);
    expect(unloadAfterSending.defaultPrevented).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Private Notes" })[0]);
    await waitFor(() => expect(screen.queryByText("Batch in progress")).toBeNull());
  });
});
