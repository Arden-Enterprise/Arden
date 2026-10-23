import type { OrganizationAdministration } from "../shared/api-client";

export type InvitationState = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type InvitationFilter = "ALL" | InvitationState;
type Invitation = Pick<OrganizationAdministration["invitations"][number], "status" | "expiresAt">;

/** Filter order, which is also the list order: actionable invitations first. */
export const invitationFilters: InvitationFilter[] = ["ALL", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED"];

/** A pending invitation past its expiry is shown as expired even before the server marks it. */
export function invitationState(invitation: Invitation, now: number): InvitationState {
  if (invitation.status === "PENDING") return new Date(invitation.expiresAt).getTime() > now ? "PENDING" : "EXPIRED";
  return invitation.status === "ACCEPTED" || invitation.status === "EXPIRED" ? invitation.status : "REVOKED";
}

export function countInvitations(invitations: readonly Invitation[], now: number): Record<InvitationFilter, number> {
  const counts: Record<InvitationFilter, number> = { ALL: invitations.length, PENDING: 0, ACCEPTED: 0, EXPIRED: 0, REVOKED: 0 };
  for (const invitation of invitations) counts[invitationState(invitation, now)] += 1;
  return counts;
}

export function visibleInvitations<T extends Invitation>(invitations: readonly T[], filter: InvitationFilter, now: number): T[] {
  return invitations.filter((item) => filter === "ALL" || invitationState(item, now) === filter)
    .sort((left, right) => invitationFilters.indexOf(invitationState(left, now)) - invitationFilters.indexOf(invitationState(right, now)));
}
