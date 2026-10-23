import { describe, expect, it } from "vitest";
import { countInvitations, invitationState, visibleInvitations } from "../src/organization/invitationStatus";

const now = Date.parse("2026-10-23T12:00:00Z");
const invitation = (status: string, expiresAt: string, id = status) => ({ id, status, expiresAt });

describe("invitation status for the admin island list", () => {
  it("treats a pending invitation past expiry as expired", () => {
    expect(invitationState(invitation("PENDING", "2026-10-24T00:00:00Z"), now)).toBe("PENDING");
    expect(invitationState(invitation("PENDING", "2026-10-22T00:00:00Z"), now)).toBe("EXPIRED");
  });

  it("keeps server outcomes and maps unknown statuses to revoked", () => {
    expect(invitationState(invitation("ACCEPTED", "2026-10-01T00:00:00Z"), now)).toBe("ACCEPTED");
    expect(invitationState(invitation("EXPIRED", "2026-10-30T00:00:00Z"), now)).toBe("EXPIRED");
    expect(invitationState(invitation("REVOKED", "2026-10-30T00:00:00Z"), now)).toBe("REVOKED");
  });

  it("counts every invitation once and orders actionable ones first", () => {
    const items = [invitation("REVOKED", "2026-10-30T00:00:00Z", "r"), invitation("PENDING", "2026-10-20T00:00:00Z", "late"),
      invitation("ACCEPTED", "2026-10-01T00:00:00Z", "a"), invitation("PENDING", "2026-10-30T00:00:00Z", "p")];
    expect(countInvitations(items, now)).toEqual({ ALL: 4, PENDING: 1, ACCEPTED: 1, EXPIRED: 1, REVOKED: 1 });
    expect(visibleInvitations(items, "ALL", now).map((item) => item.id)).toEqual(["p", "a", "late", "r"]);
    expect(visibleInvitations(items, "EXPIRED", now).map((item) => item.id)).toEqual(["late"]);
  });
});
