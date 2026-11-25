import { apiRequest } from "./api-client";
import type { Platform } from "./types";

/** Decision 0034 (spec F03-SHR): unreviewed, view-only sharing of a private item with named members. */
export type DirectShareSettings = { enabled: boolean; recipientLimit: number };
export type DirectShareRecipient = { shareId: string; membershipId: string; name: string; email: string | null;
  /** False when the person is no longer an active member; the share then gives no access. */
  active: boolean; sharedAt: string };
export type ItemShares = DirectShareSettings & { recipients: DirectShareRecipient[] };
export type SharedItemSummary = { id: string; title: string; kind: "note" | "pdf"; ownerName: string;
  sharedAt: string; updatedAt: string; reviewed: false };
export type SharedItem = SharedItemSummary & { version: number; body: string };

const organization = (organizationId: string) => `/api/v1/organizations/${organizationId}`;
const shares = (organizationId: string, itemId: string) => `${organization(organizationId)}/private-workspace/drafts/${itemId}/shares`;

export function listItemShares(platform: Platform, organizationId: string, itemId: string): Promise<ItemShares> {
  return apiRequest<ItemShares>(platform, shares(organizationId, itemId));
}

export function shareItem(platform: Platform, organizationId: string, itemId: string, recipientMembershipIds: string[]): Promise<ItemShares> {
  return apiRequest<ItemShares>(platform, shares(organizationId, itemId),
    { method: "POST", body: JSON.stringify({ recipientMembershipIds }) });
}

/** Revokes one share, or every share of the item when `shareId` is null. */
export function revokeItemShare(platform: Platform, organizationId: string, itemId: string, shareId: string | null): Promise<ItemShares> {
  return apiRequest<ItemShares>(platform, `${shares(organizationId, itemId)}/${shareId ? `${shareId}/revoke` : "revoke-all"}`, { method: "POST" });
}

export async function listSharedWithMe(platform: Platform, organizationId: string): Promise<SharedItemSummary[]> {
  return (await apiRequest<{ items: SharedItemSummary[] }>(platform, `${organization(organizationId)}/shared-with-me`)).items;
}

export function loadSharedItem(platform: Platform, organizationId: string, itemId: string): Promise<SharedItem> {
  return apiRequest<SharedItem>(platform, `${organization(organizationId)}/shared-with-me/${itemId}`);
}

export async function loadSharedPdf(platform: Platform, organizationId: string, itemId: string): Promise<string> {
  return (await apiRequest<{ pdfBase64: string }>(platform, `${organization(organizationId)}/shared-with-me/${itemId}/pdf`)).pdfBase64;
}

export function loadDirectSharing(platform: Platform, organizationId: string): Promise<DirectShareSettings> {
  return apiRequest<DirectShareSettings>(platform, `${organization(organizationId)}/direct-sharing`);
}

/** Organization Admin only. */
export function saveDirectSharing(platform: Platform, organizationId: string, settings: DirectShareSettings): Promise<DirectShareSettings> {
  return apiRequest<DirectShareSettings>(platform, `${organization(organizationId)}/direct-sharing`,
    { method: "PUT", body: JSON.stringify(settings) });
}
