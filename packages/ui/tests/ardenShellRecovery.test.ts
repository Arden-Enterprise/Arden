// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ArdenShell } from "../src/app/ArdenShell";
import * as apiClient from "../src/shared/api-client";

vi.mock("../src/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/api-client")>();
  return {
    ...actual,
    restoreSession: vi.fn().mockResolvedValue(null),
    currentSession: vi.fn().mockResolvedValue(null),
    getInvitationPreview: vi.fn(),
  };
});

describe("ArdenShell password recovery priority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
    expect(screen.queryByText(/join/i)).toBeNull();
  });
});
