import type { KnowledgeOptions } from "../shared/api-client";

export type KnowledgeScope = "ORGANIZATION" | "DEPARTMENT" | null;
export type KnowledgeAudienceOption = KnowledgeOptions["audiences"][number];

export function availableAudienceOptions(audiences: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): KnowledgeAudienceOption[] {
  return audiences.filter(audience => audience.kind === "GROUP"
    || (audience.kind === "ORGANIZATION_ALL" && scope === "ORGANIZATION")
    || (audience.kind === "DEPARTMENT_ALL" && scope === "DEPARTMENT"));
}

export function normalizeAudienceSelection(ids: readonly string[], audiences: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): string[] {
  const allowed = new Set(availableAudienceOptions(audiences, scope).map(audience => audience.id));
  return ids.filter((id) => allowed.has(id));
}

export function validAudienceSelection(ids: readonly string[], audiences: readonly KnowledgeAudienceOption[], scope: KnowledgeScope): boolean {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
  const allowed = new Set(availableAudienceOptions(audiences, scope).map(audience => audience.id));
  return ids.every((id) => allowed.has(id));
}
