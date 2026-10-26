import type { KnowledgeAudienceOption, KnowledgeScope } from "./audience-options";

export type ReaderChoices = {
  organization: KnowledgeAudienceOption[];
  departments: KnowledgeAudienceOption[];
  groups: KnowledgeAudienceOption[];
};

/**
 * Audiences the reader picker offers. A department audience is offered only for the responsible
 * department (a Department publication targets that department), and a department-bound group only
 * when it belongs to it — the same boundary the editor already enforces when the department changes.
 */
export function readerChoices(audiences: readonly KnowledgeAudienceOption[], responsibleDepartmentId: string | null): ReaderChoices {
  return {
    organization: audiences.filter((audience) => audience.kind === "ORGANIZATION_ALL"),
    departments: audiences.filter((audience) => audience.kind === "DEPARTMENT_ALL" && responsibleDepartmentId !== null
      && audience.departmentId === responsibleDepartmentId),
    groups: audiences.filter((audience) => audience.kind === "GROUP" && (!audience.departmentId || audience.departmentId === responsibleDepartmentId)),
  };
}

/**
 * Adds a reader. The organization audience and a department audience cannot share a publication
 * (each is valid only at its own scope), so adding one replaces the other.
 */
export function addReader(ids: readonly string[], id: string, audiences: readonly KnowledgeAudienceOption[]): string[] {
  if (ids.includes(id)) return [...ids];
  const kind = audiences.find((audience) => audience.id === id)?.kind;
  const conflicting = kind === "ORGANIZATION_ALL" ? "DEPARTMENT_ALL" : kind === "DEPARTMENT_ALL" ? "ORGANIZATION_ALL" : null;
  const kept = conflicting ? ids.filter((existing) => audiences.find((audience) => audience.id === existing)?.kind !== conflicting) : [...ids];
  return [...kept, id];
}

export function removeReader(ids: readonly string[], id: string): string[] {
  return ids.filter((existing) => existing !== id);
}

/**
 * Publication scope implied by the chosen readers: the organization audience means Organization,
 * a department audience means Department. Groups are valid at either scope, so a groups-only
 * selection keeps the current scope (Organization when none is set yet); the author can narrow it
 * to the responsible department explicitly. With no readers the scope is left unchanged.
 */
export function scopeForReaders(ids: readonly string[], audiences: readonly KnowledgeAudienceOption[], current: KnowledgeScope): KnowledgeScope {
  const kinds = ids.map((id) => audiences.find((audience) => audience.id === id)?.kind);
  if (kinds.includes("ORGANIZATION_ALL")) return "ORGANIZATION";
  if (kinds.includes("DEPARTMENT_ALL")) return "DEPARTMENT";
  if (kinds.includes("GROUP")) return current ?? "ORGANIZATION";
  return current;
}

/** True when every chosen reader is a group, the only case where the author picks the scope. */
export function onlyGroupReaders(ids: readonly string[], audiences: readonly KnowledgeAudienceOption[]): boolean {
  return ids.length > 0 && ids.every((id) => audiences.find((audience) => audience.id === id)?.kind === "GROUP");
}

/**
 * The department that owns and reviews a draft, as shown to the author. A server that reports the member's
 * primary department (decision 0014) derives it, so that value wins; an older server still uses the stored choice.
 */
export function ownerDepartment(primaryDepartmentId: string | null | undefined, storedResponsibleDepartmentId: string | null):
  { derived: boolean; departmentId: string | null } {
  return primaryDepartmentId === undefined
    ? { derived: false, departmentId: storedResponsibleDepartmentId }
    : { derived: true, departmentId: primaryDepartmentId };
}
