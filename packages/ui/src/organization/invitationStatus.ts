import type { OrganizationAdministration } from "../shared/api-client";

export type InvitationState = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type InvitationFilter = "ALL" | InvitationState;
export type InvitationSortOrder = "PENDING_FIRST" | "REVOKED_FIRST";
type InvitationStatusInput = Pick<OrganizationAdministration["invitations"][number], "status" | "expiresAt">;
type SearchableInvitation = InvitationStatusInput & Pick<OrganizationAdministration["invitations"][number], "email">;
const invitationStatusOrder: InvitationState[] = ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"];

/** Filter order matches the default list order: actionable invitations first. */
export const invitationFilters: InvitationFilter[] = ["ALL", "PENDING", "ACCEPTED", "EXPIRED", "REVOKED"];
export const invitationSortOptions: readonly { value: InvitationSortOrder; label: string }[] = [
  { value: "PENDING_FIRST", label: "Pending first" },
  { value: "REVOKED_FIRST", label: "Revoked first" },
];

export function isInvitationSortOrder(value: string): value is InvitationSortOrder {
  return invitationSortOptions.some((option) => option.value === value);
}

/** A pending invitation past its expiry is shown as expired even before the server marks it. */
export function invitationState(invitation: InvitationStatusInput, now: number): InvitationState {
  if (invitation.status === "PENDING") return new Date(invitation.expiresAt).getTime() > now ? "PENDING" : "EXPIRED";
  return invitation.status === "ACCEPTED" || invitation.status === "EXPIRED" ? invitation.status : "REVOKED";
}

export function countInvitations(invitations: readonly InvitationStatusInput[], now: number): Record<InvitationFilter, number> {
  const counts: Record<InvitationFilter, number> = { ALL: invitations.length, PENDING: 0, ACCEPTED: 0, EXPIRED: 0, REVOKED: 0 };
  for (const invitation of invitations) counts[invitationState(invitation, now)] += 1;
  return counts;
}

export function visibleInvitations<T extends SearchableInvitation>(
  invitations: readonly T[],
  filter: InvitationFilter,
  now: number,
  options: { query?: string; sortOrder?: InvitationSortOrder } = {},
): T[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const direction = options.sortOrder === "REVOKED_FIRST" ? -1 : 1;
  return invitations.filter((item) => {
    const matchesEmail = !query || item.email.toLowerCase().includes(query);
    const matchesStatus = filter === "ALL" || invitationState(item, now) === filter;
    return matchesEmail && matchesStatus;
  }).sort((left, right) => {
    const leftRank = invitationStatusOrder.indexOf(invitationState(left, now));
    const rightRank = invitationStatusOrder.indexOf(invitationState(right, now));
    return direction * (leftRank - rightRank);
  });
}
