// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { InvitationLinkPage } from "../src/organization/InvitationLinkPage";
import {
  acceptInvitation,
  getInvitationPreview,
  signIn,
  signUp,
  ApiError,
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
    signUp: vi.fn(),
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
  vi.clearAllMocks();
  vi.mocked(getInvitationPreview).mockResolvedValue(invitation);
  vi.mocked(signIn).mockResolvedValue(session);
  vi.mocked(acceptInvitation).mockRejectedValue(new Error("temporary acceptance failure"));
});

afterEach(cleanup);

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

  it("does not call an invitation unavailable when its acceptance response is lost", async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(new ApiError(0, "Connection unavailable."));
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token", onAccepted: vi.fn() }));
    const email = await screen.findByRole("textbox", { name: "Email address" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password" } });
    fireEvent.submit(email.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn’t confirm invitation acceptance.");
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert").textContent).toBe("Couldn’t confirm invitation acceptance.");
  });
  it("persists invitation token to storage and passes redirectTo when creating account", async () => {
    vi.mocked(signUp).mockResolvedValueOnce(undefined);
    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token-abc",
        onAccepted: vi.fn(),
      }),
    );

    await screen.findByText("Join Arden Demo");
    expect(window.localStorage.getItem("arden_pending_invitation_token")).toBe("invite-token-abc");

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith(
        "web",
        "member@example.com",
        "secret123",
        "New User",
        `${window.location.origin}/invite/invite-token-abc`,
      );
    });
  });

  it("clears pending invitation token from storage when invitation is accepted", async () => {
    window.localStorage.setItem("arden_pending_invitation_token", "invite-token-abc");
    vi.mocked(acceptInvitation).mockResolvedValueOnce(undefined);

    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token-abc",
        authenticated: true,
        session: { actor: { id: "user-1", email: "member@example.com" }, memberships: [], account: { passwordSetupRequired: false } },
        onAccepted: vi.fn(),
      }),
    );

    await screen.findByRole("button", { name: "Accept invitation" });
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("web", "invite-token-abc");
      expect(window.localStorage.getItem("arden_pending_invitation_token")).toBeNull();
    });
  });
});
