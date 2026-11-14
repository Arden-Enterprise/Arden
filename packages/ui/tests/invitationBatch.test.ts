import { describe, expect, it, vi } from "vitest";
import { ApiError, type OrganizationAdministration } from "../src/shared/api-client";
import { MAX_INVITATIONS_PER_BATCH, planInvitationBatch, sendInvitationBatch } from "../src/organization/invitationBatch";

const administration: Pick<OrganizationAdministration, "members" | "invitations"> = {
  members: [{ id: "member-1", email: "member@example.com", name: "Member", status: "ACTIVE", departmentId: null, isOrganizationAdmin: false, roleIds: [], roleNames: [] }],
  invitations: [{ id: "invite-1", email: "pending@example.com", departmentId: null, status: "PENDING", expiresAt: "2026-11-10T00:00:00.000Z" },
    { id: "invite-2", email: "expired@example.com", departmentId: null, status: "PENDING", expiresAt: "2026-11-01T00:00:00.000Z" }],
};

describe("invitation batch planning", () => {
  it("normalizes and deduplicates pasted addresses, then marks existing and invalid entries", () => {
    const plan = planInvitationBatch(" New@Example.com, SECOND@example.com;new@example.com\nmember@example.com pending@example.com expired@example.com bad@", administration, Date.parse("2026-11-07T00:00:00.000Z"));
    expect(plan.duplicateCount).toBe(1);
    expect(plan.candidates).toEqual([
      { email: "new@example.com", status: "ready" },
      { email: "second@example.com", status: "ready" },
      { email: "member@example.com", status: "member" },
      { email: "pending@example.com", status: "pending" },
      { email: "expired@example.com", status: "ready" },
      { email: "bad@", status: "invalid" },
    ]);
  });

  it("marks an oversized email invalid and blocks batches above the unique-address limit", () => {
    const oversized = `${"a".repeat(315)}@example.com`;
    expect(planInvitationBatch(oversized, administration, 0).candidates[0]?.status).toBe("invalid");
    const addresses = Array.from({ length: MAX_INVITATIONS_PER_BATCH + 1 }, (_, index) => `person${index}@example.com`).join(",");
    expect(planInvitationBatch(addresses, administration, 0).overLimit).toBe(true);
  });
});

describe("invitation batch delivery", () => {
  it("sends sequentially and continues after a saved invitation whose email failed", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ deliveryMode: "email" })
      .mockRejectedValueOnce(new ApiError(502, "The invitation was saved but its email was not delivered.", "INVITATION_DELIVERY_FAILED"))
      .mockResolvedValueOnce({ deliveryMode: "local-test-no-email" });
    const progress = vi.fn();
    const results = await sendInvitationBatch(["one@example.com", "two@example.com", "three@example.com"], send, progress);
    expect(send.mock.calls.map(([email]) => email)).toEqual(["one@example.com", "two@example.com", "three@example.com"]);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(results.map((result) => result.status)).toEqual(["sent", "delivery-failed", "saved-locally"]);
  });

  it("continues past a concurrent pending invitation but stops after an authorization failure", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, "A pending invitation already exists for this email.", "INVITATION_CONFLICT"))
      .mockRejectedValueOnce(new ApiError(403, "Verify your account email before inviting a member.", "VERIFIED_EMAIL_REQUIRED"));
    const results = await sendInvitationBatch(["one@example.com", "two@example.com", "three@example.com"], send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.status)).toEqual(["conflict", "blocked", "not-sent"]);
    expect(results[1]?.message).toContain("Verify your account email");
  });

  it("stops after an uncertain network result so no later address is sent blindly", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("network unavailable"));
    const results = await sendInvitationBatch(["one@example.com", "two@example.com"], send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status)).toEqual(["unconfirmed", "not-sent"]);
  });

  it("does not claim delivery from an incomplete API response", async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: "pending" });
    const results = await sendInvitationBatch(["one@example.com", "two@example.com"], send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status)).toEqual(["unconfirmed", "not-sent"]);
  });
});
