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
    resetPasswordFromLink: vi.fn(),
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

  it("shows a check-email screen after requesting a reset link and allows another request", async () => {
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

    const emailInput = screen.getByPlaceholderText("name@company.com") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    const submitButton = screen.getByRole("button", { name: /send reset link/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiClient.requestPasswordReset).toHaveBeenCalledWith("web", "test@example.com");
      expect(screen.getByRole("heading", { name: /check your email/i })).toBeTruthy();
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /check your email/i }));
    expect(screen.getByRole("status").textContent).toContain("If an account with this email exists");
    expect(screen.getByRole("status").textContent).toContain("password reset link");
    expect(screen.queryByRole("textbox", { name: /email address/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
    expect(screen.queryByText(/verification code/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /send another link/i }));
    expect(screen.getByRole("heading", { name: /reset your password/i })).toBeTruthy();
    expect((screen.getByPlaceholderText("name@company.com") as HTMLInputElement).value).toBe("test@example.com");
  });

  it("does not claim a link was sent for an invalid email or failed request", async () => {
    render(createElement(SignInPage, {
      platform: "web",
      initialMode: "forgot-password",
      onEnterPreview: vi.fn(),
      onOpenSetup: vi.fn(),
      onAuthenticated: vi.fn(),
    }));

    const emailInput = screen.getByPlaceholderText("name@company.com");
    const submitButton = screen.getByRole("button", { name: /send reset link/i });
    fireEvent.change(emailInput, { target: { value: "invalid-email" } });
    fireEvent.click(submitButton);
    expect(apiClient.requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid email address.");

    vi.mocked(apiClient.requestPasswordReset).mockRejectedValueOnce(new Error("provider unavailable"));
    fireEvent.change(emailInput, { target: { value: "user@example.test" } });
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Password reset could not be requested.");
    });
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
  });

  it("uses only a verified recovery-link session to update the password", async () => {
    vi.mocked(apiClient.resetPasswordFromLink).mockResolvedValue(undefined);

    render(
      createElement(SignInPage, {
        platform: "web",
        initialMode: "reset-password",
        recoveryTokens: { accessToken: "access-recovery", refreshToken: "refresh-recovery" },
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm new password/i);

    expect(screen.queryByText(/verification code/i)).toBeNull();
    expect(screen.queryByText(/email address/i)).toBeNull();
    fireEvent.change(passwordInput, { target: { value: "new-valid-password" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "new-valid-password" } });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.resetPasswordFromLink).toHaveBeenCalledWith("web", {
        accessToken: "access-recovery",
        refreshToken: "refresh-recovery",
        newPassword: "new-valid-password",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in to your account/i })).toBeTruthy();
      expect(screen.getByText(/password updated successfully/i)).toBeTruthy();
    });
  });

  it("keeps the reset form available when the link update fails", async () => {
    vi.mocked(apiClient.resetPasswordFromLink).mockRejectedValueOnce(new Error("session expired"));
    render(createElement(SignInPage, {
      platform: "web",
      initialMode: "reset-password",
      recoveryTokens: { accessToken: "access-recovery", refreshToken: "refresh-recovery" },
      onEnterPreview: vi.fn(),
      onOpenSetup: vi.fn(),
      onAuthenticated: vi.fn(),
    }));

    fireEvent.change(screen.getByPlaceholderText(/enter new password/i), { target: { value: "new-valid-password" } });
    fireEvent.change(screen.getByPlaceholderText(/confirm new password/i), { target: { value: "new-valid-password" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Couldn’t reset password.");
    });
    expect(screen.getByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /request a new link/i })).toBeTruthy();
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

  it("asks for a name and a 6 character password before registration", () => {
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
    expect(screen.getByRole("alert").textContent).toBe("Password must be at least 8 characters long.");
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
        recoveryTokens: { accessToken: "access-recovery", refreshToken: "refresh-recovery" },
        onEnterPreview: vi.fn(),
        onOpenSetup: vi.fn(),
        onAuthenticated: vi.fn(),
      })
    );

    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm new password/i);

    fireEvent.change(passwordInput, { target: { value: "short" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "short" } });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    fireEvent.click(submitBtn);

    expect(apiClient.resetPasswordFromLink).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Password must be at least 8 characters long.");
    } finally {
      restoreUrl();
    }
  });

  it("does not show a password form without a recovery link and offers a new link", () => {
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

    expect(screen.getByRole("heading", { name: /reset link unavailable/i })).toBeTruthy();
    expect(screen.getByText(/invalid or has expired/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
    expect(apiClient.resetPasswordFromLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /request a new link/i }));
    expect(screen.getByRole("heading", { name: /reset your password/i })).toBeTruthy();
    } finally {
      restoreUrl();
    }
  });
});
