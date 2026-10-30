// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationLinkPage } from "../src/organization/InvitationLinkPage";
import {
  acceptInvitation,
  getInvitationPreview,
  signIn,
  type CurrentSession,
  type InvitationPreview,
} from "../src/shared/api-client";
import { invitationFeedback } from "../src/organization/invitationFeedback";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    acceptInvitation: vi.fn(),
    getInvitationPreview: vi.fn(),
    signIn: vi.fn(),
  };
});

const invitation: InvitationPreview = {
  organizationName: "Arden Demo",
  email: "member@example.com",
  expiresAt: "2026-11-30T00:00:00Z",
};

const session: CurrentSession = {
  actor: { id: "user-1", email: invitation.email },
  account: { passwordSetupRequired: false },
  memberships: [],
};

beforeEach(() => {
  vi.mocked(getInvitationPreview).mockResolvedValue(invitation);
  vi.mocked(signIn).mockResolvedValue(session);
  vi.mocked(acceptInvitation).mockRejectedValue(new Error("temporary acceptance failure"));
});

describe("invitation page feedback", () => {
  it("returns an acceptance error for the shared signed-in and signed-out page area", () => {
    expect(invitationFeedback("Invitation has expired.", "")).toEqual({
      role: "alert", className: "auth-message", text: "Invitation has expired.",
    });
  });

  it("shows a success message when no error is present", () => {
    expect(invitationFeedback("", "Check your email.")).toEqual({
      role: "status", className: "auth-message is-success", text: "Check your email.",
    });
  });

  it("does not render empty feedback", () => {
    expect(invitationFeedback("", "")).toBeNull();
  });

  it("keeps an acceptance error visible after sign-in and leaves the retry action available", async () => {
    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token",
        onAccepted: vi.fn(),
      }),
    );

    const email = await screen.findByRole("textbox", { name: "Email address" });
    const form = email.closest("form");
    if (!form) throw new Error("Expected the sign-in form to be present");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password" } });
    fireEvent.submit(form);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invitation unavailable for this account.");
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
    expect(acceptInvitation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(2));
  });
});
