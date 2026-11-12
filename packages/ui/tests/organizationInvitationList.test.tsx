// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import type { OrganizationAdministration } from "../src/shared/api-client";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";

const administration: OrganizationAdministration = {
  departments: [],
  roles: [],
  members: [],
  invitations: [
    { id: "pending", email: "pending@example.test", departmentId: null, status: "PENDING", expiresAt: "2099-01-01T00:00:00Z" },
    { id: "accepted", email: "accepted@example.test", departmentId: null, status: "ACCEPTED", expiresAt: "2000-01-01T00:00:00Z" },
    { id: "expired", email: "expired@example.test", departmentId: null, status: "PENDING", expiresAt: "2000-01-01T00:00:00Z" },
    { id: "revoked", email: "revoked@example.test", departmentId: null, status: "REVOKED", expiresAt: "2099-01-01T00:00:00Z" },
  ],
};

let previousScroll: PropertyDescriptor | undefined;
beforeEach(() => {
  previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.spyOn(api, "loadOrganizationAdministration").mockResolvedValue(administration);
  vi.spyOn(api, "listReviewerGrants").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (previousScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", previousScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function openInvitations() {
  render(createElement(OrganizationAdminPage, {
    platform: "web", organizationId: "org", organizationName: "Example", contextOpen: false, onToggleContext: vi.fn(),
  }));
  fireEvent.click(await screen.findByRole("tab", { name: /Invitations/ }));
  await screen.findByRole("searchbox", { name: "Search invitations" });
}

function invitationEmailsInTable(): string[] {
  const table = screen.getByRole("table", { name: "Invitations" });
  return within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

describe("organization invitation list controls", () => {
  it("combines recipient search with effective status filtering and can clear an empty result", async () => {
    await openInvitations();

    fireEvent.click(screen.getByRole("button", { name: /^Expired/ }));
    expect(invitationEmailsInTable()).toEqual([expect.stringContaining("expired@example.test")]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search invitations" }), { target: { value: "revoked@example.test" } });
    expect(screen.getByRole("heading", { name: "No matching invitations" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));

    expect(invitationEmailsInTable()).toHaveLength(4);
    expect(screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sorts by effective invitation status in either direction", async () => {
    await openInvitations();
    expect(invitationEmailsInTable().map((email) => email.trim().split("@")[0])).toEqual(["pending", "accepted", "expired", "revoked"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by status: Pending first" }));
    fireEvent.click(screen.getByRole("option", { name: "Revoked first" }));

    expect(invitationEmailsInTable().map((email) => email.trim().split("@")[0])).toEqual(["revoked", "expired", "accepted", "pending"]);
  });
});
