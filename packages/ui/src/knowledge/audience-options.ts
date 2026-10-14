import type { KnowledgeOptions } from "../shared/api-client";

export type KnowledgeScope = "ORGANIZATION" | "DEPARTMENT" | null;
export type KnowledgeAudienceOption = KnowledgeOptions["audienceRoles"][number];

export function availableAudienceOptions(roles: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): KnowledgeAudienceOption[] {
  return roles.filter((role) => role.kind !== "ALL_MEMBERS" || scope === "ORGANIZATION");
}

export function normalizeAudienceSelection(ids: readonly string[], roles: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): string[] {
  const allowed = new Set(availableAudienceOptions(roles, scope).map((role) => role.id));
  return ids.filter((id) => allowed.has(id));
}

export function validAudienceSelection(ids: readonly string[], roles: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): boolean {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
  const allowed = new Set(availableAudienceOptions(roles, scope).map((role) => role.id));
  return ids.every((id) => allowed.has(id));
}
