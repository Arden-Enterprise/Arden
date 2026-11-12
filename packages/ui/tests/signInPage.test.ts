// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { SignInPage } from "../src/sign-in/SignInPage";
import * as apiClient from "../src/shared/api-client";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
    resetPasswordWithToken: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
  };
});

function replacePageUrl(path: string): () => void {
  const previous = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.history.replaceState(null, "", path);
  return () => window.history.replaceState(null, "", previous || "/");
}

describe("SignInPage password reset flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("uses fixed verification error copy and clears auth fragments", () => {
    const restoreUrl = replacePageUrl("/?error=verification_failed&error_description=Follow%20a%20malicious%20link");
    const props = { platform: "web" as const, onEnterPreview: vi.fn(), onOpenSetup: vi.fn(), onAuthenticated: vi.fn() };
    try {
      const { unmount } = render(createElement(SignInPage, props));
      expect(screen.getByRole("alert").textContent).toContain("Email confirmation link is invalid");
      expect(screen.queryByText("Follow a malicious link")).toBeNull();
      unmount();
      window.history.replaceState(null, "", "/#access_token=synthetic&refresh_token=synthetic&type=email_change");
      render(createElement(SignInPage, props));
      expect(window.location.hash).toBe("");
      expect(screen.getByRole("alert").textContent).toContain("Your email has been confirmed");
    } finally {
      restoreUrl();
    }
  });

  it("does not render 'Have a reset code?' and transitions directly to reset-password on sending instructions", async () => {
    vi.mocked(apiClient.requestPasswordReset).mockResolvedValue(undefined);

    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "forgot-password",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    // Verify "Have a reset code?" is NOT present
    expect(screen.queryByText(/have a reset code/i)).toBeNull();

    // Type email and submit forgot password form
    const emailInput = screen.getByPlaceholderText("name@company.com") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /send reset instructions/i });
    fireEvent.click(submitButton);

    // Should call requestPasswordReset
    await waitFor(() => {
      expect(apiClient.requestPasswordReset).toHaveBeenCalledWith("web", "test@example.com");
    });

    // Should transition directly to reset-password mode
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /set a new password/i })).toBeTruthy();
    });

    // Verification code input should now be visible
    expect(screen.getByPlaceholderText(/enter code from email/i)).toBeTruthy();

    // The email should remain prefilled
    const resetEmailInput = screen.getByPlaceholderText("name@company.com") as HTMLInputElement;
    expect(resetEmailInput.value).toBe("test@example.com");

    // "Request new code" should be available to switch back if needed
    const requestNewCodeBtn = screen.getByRole("button", { name: /request new code/i });
    expect(requestNewCodeBtn).toBeTruthy();

    // Clicking "Request new code" returns to forgot-password mode
    fireEvent.click(requestNewCodeBtn);
    expect(screen.getByRole("heading", { name: /reset your password/i })).toBeTruthy();
  });

  it("clears reset token and switches to sign-in on successful password update", async () => {
    vi.mocked(apiClient.resetPasswordWithToken).mockResolvedValue(undefined);

    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "reset-password",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const emailInput = screen.getByPlaceholderText("name@company.com");
    const codeInput = screen.getByPlaceholderText(/enter code from email/i);
    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm new password/i);

    fireEvent.change(emailInput, { target: { value: "user@example.test" } });
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.change(passwordInput, { target: { value: "new-valid-password" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "new-valid-password" } });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.resetPasswordWithToken).toHaveBeenCalledWith("web", {
        email: "user@example.test",
        token: "123456",
        newPassword: "new-valid-password",
      });
    });

    // Transitions to sign-in mode with success notice
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in to your account/i })).toBeTruthy();
      expect(screen.getByText(/password updated successfully/i)).toBeTruthy();
    });
  });

  it("shows an error notice and prevents sign-up when email format is invalid", async () => {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "register",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const nameInput = screen.getByPlaceholderText("Your name");
    const emailInput = screen.getByPlaceholderText("name@company.com");
    const passwordInput = screen.getByPlaceholderText(/create a secure password/i);

    fireEvent.change(nameInput, { target: { value: "LGK" } });
    fireEvent.change(emailInput, { target: { value: "123@gmail" } });
    fireEvent.change(passwordInput, { target: { value: "secure-password" } });

    const submitBtn = screen.getByRole("button", { name: /create account/i });
    fireEvent.click(submitBtn);

    expect(apiClient.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid email address.");
  });

  it("shows an error notice and prevents sign-in when email format is invalid", async () => {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "sign-in",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const emailInput = screen.getByPlaceholderText("name@company.com");
    const passwordInput = screen.getByPlaceholderText(/enter your password/i);

    fireEvent.change(emailInput, { target: { value: "123@gmail" } });
    fireEvent.change(passwordInput, { target: { value: "secure-password" } });

    const submitBtn = screen.getByRole("button", { name: /^sign in$/i });
    fireEvent.click(submitBtn);

    expect(apiClient.signIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid email address.");
  });

  it("asks for a password before sign-in and does not apply the registration length rule", () => {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "sign-in",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), { target: { value: "user@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(apiClient.signIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Enter your password.");
  });

  it("asks for a name and rejects each missing account password requirement", () => {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "register",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), { target: { value: "user@example.test" } });
    fireEvent.change(screen.getByPlaceholderText(/create a secure password/i), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(apiClient.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Enter your name.");

    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByPlaceholderText(/create a secure password/i), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(apiClient.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("at least 8 characters");

    for (const invalidPassword of ["abcdefgh!", "Abcdefgh"]) {
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: invalidPassword } });
      fireEvent.click(screen.getByRole("button", { name: /create account/i }));
      expect(apiClient.signUp).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("one uppercase letter, and one special character");
    }
  });

  it("updates all three password checks while typing and lets the user show or hide the entry", () => {
    render(createElement(SignInPage, {
      platform: "web", initialMode: "register", onEnterPreview: vi.fn(), onOpenSetup: vi.fn(), onAuthenticated: vi.fn(),
    }));

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.hasAttribute("maxlength")).toBe(false);
    const minimum = screen.getByText("At least 8 characters").closest("li");
    const uppercase = screen.getByText("At least 1 uppercase letter").closest("li");
    const special = screen.getByText("At least 1 special character").closest("li");
    expect(minimum?.textContent).toContain("Pending:");
    expect(screen.getByRole("status").textContent).toBe("No password entered.");
    fireEvent.change(password, { target: { value: "short" } });
    expect(minimum?.textContent).toContain("Not met:");
    expect(uppercase?.textContent).toContain("Not met:");
    expect(special?.textContent).toContain("Not met:");
    fireEvent.change(password, { target: { value: "eight123" } });
    expect(minimum?.textContent).toContain("Met:");
    expect(uppercase?.textContent).toContain("Not met:");
    expect(special?.textContent).toContain("Not met:");
    fireEvent.change(password, { target: { value: "Eight123!" } });
    expect(uppercase?.textContent).toContain("Met:");
    expect(special?.textContent).toContain("Met:");
    expect(screen.getByRole("status").textContent).toBe("3 of 3 password requirements met.");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
    expect(password.value).toBe("Eight123!");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");
    expect(apiClient.signUp).not.toHaveBeenCalled();
  });

  it("keeps a rejected registration password available to revise without claiming a specific provider rule", async () => {
    vi.mocked(apiClient.signUp)
      .mockRejectedValueOnce(new apiClient.ApiError(400, "Account setup could not be completed.", "ACCOUNT_SETUP_UNAVAILABLE"))
      .mockResolvedValueOnce(undefined);
    render(createElement(SignInPage, {
      platform: "web", initialMode: "register", onEnterPreview: vi.fn(), onOpenSetup: vi.fn(), onAuthenticated: vi.fn(),
    }));

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.test" } });
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "ValidPass1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(apiClient.signUp).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toContain("password meets the listed requirements");
    expect(password.value).toBe("ValidPass1!");

    fireEvent.change(password, { target: { value: "Better-password-123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(apiClient.signUp).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("alert")).textContent).toContain("Check your email to continue.");
  });

  it("clears the registration password when an existing account returns to sign-in", async () => {
    vi.mocked(apiClient.signUp).mockRejectedValueOnce(new apiClient.ApiError(409, "Account already exists.", "ACCOUNT_ALREADY_EXISTS"));
    render(createElement(SignInPage, {
      platform: "web", initialMode: "register", onEnterPreview: vi.fn(), onOpenSetup: vi.fn(), onAuthenticated: vi.fn(),
    }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Valid-password-123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeTruthy());
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("displays success notice when URL contains type=signup from email confirmation", () => {
    const restoreUrl = replacePageUrl("/?type=signup#access_token=token&type=signup");
    try {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "sign-in",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    expect(screen.getByRole("alert").textContent).toContain("Your email has been confirmed successfully!");
    } finally {
      restoreUrl();
    }
  });

  it("displays error notice when URL contains error=verification_failed", () => {
    const restoreUrl = replacePageUrl("/?error=verification_failed");
    try {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "sign-in",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    expect(screen.getByRole("alert").textContent).toContain("Email confirmation link is invalid or has expired.");
    } finally {
      restoreUrl();
    }
  });

  it("shows specific error and blocks submission when reset password is under 8 characters", async () => {
    const restoreUrl = replacePageUrl("/");
    try {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "reset-password",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const emailInput = screen.getByPlaceholderText("name@company.com");
    const codeInput = screen.getByPlaceholderText(/enter code from email/i);
    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm new password/i);

    fireEvent.change(emailInput, { target: { value: "user@example.test" } });
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.change(passwordInput, { target: { value: "short" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "short" } });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    fireEvent.click(submitBtn);

    expect(apiClient.resetPasswordWithToken).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Password must be at least 8 characters long.");
    } finally {
      restoreUrl();
    }
  });

  it("shows specific error and blocks submission when verification code is missing", async () => {
    const restoreUrl = replacePageUrl("/");
    try {
    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "reset-password",
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const emailInput = screen.getByPlaceholderText("name@company.com");
    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm new password/i);

    fireEvent.change(emailInput, { target: { value: "user@example.test" } });
    fireEvent.change(passwordInput, { target: { value: "valid-password-123" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "valid-password-123" } });

    const form = screen.getByRole("button", { name: /update password/i }).closest("form")!;
    fireEvent.submit(form);

    expect(apiClient.resetPasswordWithToken).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter the verification code sent to your email.");
    } finally {
      restoreUrl();
    }
  });
});
