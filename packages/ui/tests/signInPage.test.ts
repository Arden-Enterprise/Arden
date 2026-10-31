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

describe("SignInPage password reset flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

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
});
