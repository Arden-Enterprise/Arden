// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ArdenShell } from "../src/app/ArdenShell";
import { recoveryTokenStorageKey } from "../src/sign-in/recovery-session";
import * as apiClient from "../src/shared/api-client";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    restoreSession: vi.fn().mockResolvedValue(null),
    currentSession: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    getInvitationPreview: vi.fn(),
  };
});

describe("ArdenShell password recovery priority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("prioritizes hash recovery tokens over invite path and mounts in password recovery mode", async () => {
    window.history.replaceState(
      null,
      "",
      "/invite/1111111111111111111111111111111111111111111#access_token=token-123&refresh_token=refresh-456&type=recovery",
    );

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(screen.queryByText(/join/i)).toBeNull();
    expect(window.location.pathname).toBe("/reset-password");
  });

  it("prioritizes query recovery tokens and mounts in password recovery mode", async () => {
    window.history.replaceState(
      null,
      "",
      "/?access_token=token-abc&refresh_token=refresh-xyz&type=recovery",
    );

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(window.location.pathname).toBe("/reset-password");
  });

  it("prioritizes pathname /reset-password over pending invitation session token", async () => {
    window.history.replaceState(null, "", "/reset-password");
    vi.mocked(apiClient.restoreSession).mockResolvedValueOnce({
      actor: { id: "user-1", email: "user@example.test" },
      account: { passwordSetupRequired: false },
      memberships: [],
      pendingInvitationToken: "2222222222222222222222222222222222222222222",
    });

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /reset link unavailable/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
    expect(screen.queryByText(/join/i)).toBeNull();
  });

  it("removes an expired authenticated session when the window regains focus", async () => {
    const expiresAt = Date.now() + 60_000;
    vi.mocked(apiClient.restoreSession).mockResolvedValueOnce({
      actor: { id: "user-1", email: "user@example.test" },
      account: { passwordSetupRequired: false },
      memberships: [],
      sessionExpiresAt: new Date(expiresAt).toISOString(),
    });

    render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: "Create your organization" })).toBeTruthy();
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt);
    fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeTruthy();
    expect(apiClient.signOut).toHaveBeenCalledWith("web");
    clock.mockRestore();
  });

  it("keeps a signed-in member on the reset form when a recovery link is open", async () => {
    window.history.replaceState(null, "", "/#access_token=token-123&refresh_token=refresh-456&type=recovery");
    vi.mocked(apiClient.restoreSession).mockResolvedValueOnce({
      actor: { id: "user-1", email: "user@example.test" },
      account: { passwordSetupRequired: false },
      memberships: [],
    });

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create your organization" })).toBeNull();
  });

  it("restores recovery tokens after the address bar is cleaned", async () => {
    window.history.replaceState(null, "", "/#access_token=token-123&refresh_token=refresh-456&type=recovery");
    const view = render(createElement(ArdenShell, { platform: "web" }));
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(window.location.hash).toBe("");
    view.unmount();
    vi.mocked(apiClient.restoreSession).mockResolvedValueOnce({
      actor: { id: "user-1", email: "user@example.test" },
      account: { passwordSetupRequired: false },
      memberships: [],
    });

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create your organization" })).toBeNull();
  });

  it("drops a stored recovery link after the ten-minute proof", async () => {
    window.sessionStorage.setItem(recoveryTokenStorageKey, JSON.stringify({
      accessToken: "token-123",
      refreshToken: "refresh-456",
      storedAt: Date.now() - 11 * 60 * 1000,
    }));
    window.history.replaceState(null, "", "/reset-password");

    render(createElement(ArdenShell, { platform: "web" }));

    expect(await screen.findByRole("heading", { name: /reset link unavailable/i })).toBeTruthy();
  });
});
