// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";
import { ApiError, type OrganizationAdministration } from "../src/shared/api-client";
import * as apiClient from "../src/shared/api-client";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    loadOrganizationAdministration: vi.fn(),
    listReviewerGrants: vi.fn(),
    inviteOrganizationMember: vi.fn(),
  };
});

const administration: OrganizationAdministration = {
  departments: [], roles: [],
  members: [{ id: "member-1", email: "member@example.com", name: "Member", status: "ACTIVE", departmentId: null, isOrganizationAdmin: false, roleIds: [], roleNames: [] }],
  invitations: [{ id: "invite-1", email: "pending@example.com", departmentId: null, status: "PENDING", expiresAt: "2099-01-01T00:00:00.000Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.loadOrganizationAdministration).mockResolvedValue(administration);
  vi.mocked(apiClient.listReviewerGrants).mockResolvedValue([]);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function openInvitationForm(onSendingInvitationsChange?: (sending: boolean) => void) {
  render(createElement(OrganizationAdminPage, {
    platform: "web", organizationId: "org-1", organizationName: "Test Org",
    contextOpen: false, onToggleContext: vi.fn(), onSendingInvitationsChange,
  }));
  fireEvent.click(await screen.findByRole("tab", { name: /Invitations/i }));
  return screen.getByRole("textbox", { name: "Work emails" }) as HTMLTextAreaElement;
}

describe("organization batch invitations", () => {
  it("previews recipients, skips existing and invalid addresses, and reports partial delivery accurately", async () => {
    vi.mocked(apiClient.inviteOrganizationMember)
      .mockResolvedValueOnce({ deliveryMode: "email" })
      .mockRejectedValueOnce(new ApiError(502, "The invitation was saved but its email was not delivered.", "INVITATION_DELIVERY_FAILED"));
    const input = await openInvitationForm();
    fireEvent.change(input, { target: { value: "FIRST@example.com, second@example.com;first@example.com\nmember@example.com pending@example.com bad@" } });
    expect(screen.getByText(/2 ready · 4 skipped/)).toBeTruthy();
    expect(screen.getByText("Already a member")).toBeTruthy();
    expect(screen.getByText("Invitation pending")).toBeTruthy();
    expect(screen.getByText("Invalid email")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invitations" }));

    await waitFor(() => expect(apiClient.inviteOrganizationMember).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.inviteOrganizationMember).mock.calls.map((call) => call[3])).toEqual(["first@example.com", "second@example.com"]);
    await waitFor(() => expect(screen.getByText(/Batch finished: 1 email sent, 0 saved locally, 4 to review/)).toBeTruthy());
    expect(screen.getByText("Saved · email not delivered. Use Resend in the list.")).toBeTruthy();
    expect(input.value).toBe("");
    expect(apiClient.loadOrganizationAdministration).toHaveBeenCalledTimes(2);
  });

  it("blocks an oversized batch and lets the administrator cancel the draft without sending", async () => {
    const input = await openInvitationForm();
    const addresses = Array.from({ length: 21 }, (_, index) => `person${index}@example.com`).join(", ");
    fireEvent.change(input, { target: { value: addresses } });
    expect(screen.getByText(/Enter no more than 20 unique email addresses/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reduce to 20 emails" }));
    expect(apiClient.inviteOrganizationMember).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(input.value).toBe("");
  });

  it("still sends one address through the existing invitation API", async () => {
    vi.mocked(apiClient.inviteOrganizationMember).mockResolvedValue({ deliveryMode: "email" });
    const input = await openInvitationForm();
    fireEvent.change(input, { target: { value: "solo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(apiClient.inviteOrganizationMember).toHaveBeenCalledWith("web", "org-1", null, "solo@example.com"));
    await waitFor(() => expect(screen.getByText(/Batch finished: 1 email sent/)).toBeTruthy());
  });

  it("keeps the draft locked while recipients are sent one at a time", async () => {
    let finishFirst!: (value: { deliveryMode: "email" }) => void;
    const onSending = vi.fn();
    vi.mocked(apiClient.inviteOrganizationMember)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ deliveryMode: "email" });
    const input = await openInvitationForm(onSending);
    fireEvent.change(input, { target: { value: "one@example.com\ntwo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send 2 invitations" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sending 1 of 2…" })).toBeTruthy());
    expect(input.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("tab", { name: /Members/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSending).toHaveBeenCalledWith(true);
    expect(apiClient.inviteOrganizationMember).toHaveBeenCalledTimes(1);
    finishFirst({ deliveryMode: "email" });
    await waitFor(() => expect(apiClient.inviteOrganizationMember).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Batch finished: 2 emails sent/)).toBeTruthy());
    await waitFor(() => expect(onSending).toHaveBeenLastCalledWith(false));
  });
});
