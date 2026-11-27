// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { InvitationLinkPage } from "../src/organization/InvitationLinkPage";
import {
  acceptInvitation,
  createInvitationAccount,
  currentSession,
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
    createInvitationAccount: vi.fn(),
    currentSession: vi.fn(),
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
  it("asks for a password instead of calling the invitation invalid", async () => {
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token", onAccepted: vi.fn() }));
    const email = await screen.findByRole("textbox", { name: "Email address" });
    fireEvent.submit(email.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe("Enter your password.");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("passes redirectTo when creating account on invitation page", async () => {
    vi.mocked(signUp).mockResolvedValueOnce(undefined);
    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token-abc",
        onAccepted: vi.fn(),
      }),
    );

    await screen.findByText("Join Arden Demo");

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("At least 8 characters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith(
        "web",
        "member@example.com",
        "Secret123!",
        "New User",
        `${window.location.origin}/invite/invite-token-abc`,
      );
    });
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("blocks invitation account setup when a password character requirement is missing", async () => {
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted: vi.fn() }));
    await screen.findByText("Join Arden Demo");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    const password = screen.getByLabelText("Password");
    const form = screen.getByRole("button", { name: "Create account and accept" }).closest("form")!;

    for (const invalidPassword of ["abcdefgh!", "ABCDEFGH!", "Abcdefgh"]) {
      fireEvent.change(password, { target: { value: invalidPassword } });
      fireEvent.submit(form);
      expect(signUp).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("one uppercase letter, one lowercase letter, and one special character");
    }
  });

  it("shows password guidance and keeps the entry after invitation account setup is rejected", async () => {
    vi.mocked(signUp).mockRejectedValueOnce(new ApiError(400, "Account setup could not be completed.", "ACCOUNT_SETUP_UNAVAILABLE"));
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted: vi.fn() }));
    await screen.findByText("Join Arden Demo");

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "ValidPass1!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("password meets the listed requirements");
    expect(password.value).toBe("ValidPass1!");
    expect(screen.getByText("At least 8 characters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("calls acceptInvitation when accepted by authenticated user", async () => {
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
    });
  });

  it("does not mark invitation invalid on transient network error during preview load", async () => {
    vi.mocked(getInvitationPreview).mockRejectedValueOnce(new ApiError(0, "Network failure"));

    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token-abc",
        onAccepted: vi.fn(),
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load invitation details. Please check your connection and try again.");
    expect(screen.queryByText("Invitation expired or invalid")).toBeNull();
  });

  it("marks invitation as invalid when getInvitationPreview returns 404", async () => {
    vi.mocked(getInvitationPreview).mockRejectedValueOnce(new ApiError(404, "Not found"));

    render(
      createElement(InvitationLinkPage, {
        platform: "web",
        token: "invite-token-abc",
        onAccepted: vi.fn(),
      }),
    );

    await screen.findByText("Invitation link unavailable");
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
  });
});

describe("invitation account routing (decision 0038)", () => {
  it("shows only sign-in with the invited address fixed when the account exists", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "existing" });
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token", onAccepted: vi.fn() }));
    const email = await screen.findByRole("textbox", { name: "Email address" }) as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(email.value).toBe(invitation.email);
    expect(screen.getByText("Sign in to your Arden account to accept")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in and accept invitation" })).toBeTruthy();
  });

  it("registers a new invited account without an email field or confirmation step", async () => {
    const onAccepted = vi.fn();
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    vi.mocked(createInvitationAccount).mockResolvedValueOnce({ accepted: true });
    vi.mocked(currentSession).mockResolvedValueOnce(session);
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted }));

    await screen.findByText("Create your Arden account to accept");
    expect(screen.queryByRole("textbox", { name: "Email address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: " New User " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(session));
    expect(createInvitationAccount).toHaveBeenCalledWith("web", "invite-token-abc", "New User", "Secret123!");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("checks the password rules before creating a routed account", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted: vi.fn() }));
    await screen.findByText("Create your Arden account to accept");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "abcdefgh!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("one uppercase letter");
    expect(createInvitationAccount).not.toHaveBeenCalled();
  });

  it("switches to sign-in when the server finds an existing account", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    vi.mocked(createInvitationAccount).mockRejectedValueOnce(new ApiError(409, "exists", "ACCOUNT_ALREADY_EXISTS"));
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted: vi.fn() }));
    await screen.findByText("Create your Arden account to accept");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toBe("An account already exists for this email. Sign in to accept the invitation.");
    expect(screen.getByRole("button", { name: "Sign in and accept invitation" })).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("offers acceptance when the account was created but acceptance did not complete", async () => {
    const onAccepted = vi.fn();
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    vi.mocked(createInvitationAccount).mockResolvedValueOnce({ accepted: false });
    vi.mocked(currentSession).mockResolvedValue(session);
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted }));
    await screen.findByText("Create your Arden account to accept");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    expect((await screen.findByText("Your account is ready. Accept the invitation to continue.")).getAttribute("role")).toBe("status");
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("keeps the combined screen when the server cannot report the account status", async () => {
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token", onAccepted: vi.fn() }));
    const email = await screen.findByRole("textbox", { name: "Email address" }) as HTMLInputElement;
    expect(email.readOnly).toBe(false);
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });
});

describe("invitation account routing after account creation", () => {
  it("stays signed in instead of reporting a failed creation when loading the session fails", async () => {
    const onAccepted = vi.fn();
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    vi.mocked(createInvitationAccount).mockResolvedValueOnce({ accepted: true });
    vi.mocked(currentSession).mockRejectedValueOnce(new ApiError(0, "Connection unavailable."));
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted }));
    await screen.findByText("Create your Arden account to accept");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    expect(await screen.findByText("Your account is ready and you joined the organization. Reload to open your workspace.")).toBeTruthy();
    expect(screen.queryByText(/Couldn.t create account/)).toBeNull();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("explains an unconfirmed account setup outcome without claiming failure", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValueOnce({ ...invitation, accountStatus: "new" });
    vi.mocked(createInvitationAccount).mockRejectedValueOnce(new ApiError(503, "unconfirmed", "ACCOUNT_SETUP_UNCONFIRMED"));
    render(createElement(InvitationLinkPage, { platform: "web", token: "invite-token-abc", onAccepted: vi.fn() }));
    await screen.findByText("Create your Arden account to accept");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret123!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account and accept" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("if your account was created");
  });
});
