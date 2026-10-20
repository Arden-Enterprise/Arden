export type AudienceScope =
  | { type: "ORGANIZATION"; departmentId: null }
  | { type: "DEPARTMENT"; departmentId: string };

export type AudienceKind = "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP";

export function validAudienceGroupName(name: string): boolean {
  const normalized = name.normalize("NFKC").trim();
  return normalized.length > 0 && normalized.length <= 80
    && !/^(org(?:anization)?[\s_-]*admin|system[\s_-]*admin|all[\s_-]*members|everyone(?:[\s_-]*in[\s_-]*(?:the[\s_-]*)?(?:organization|department))?)$/i.test(normalized);
}
export function audienceMatchesScope(input: {
  kind: AudienceKind;
  audienceDepartmentId: string | null;
  publicationScope: AudienceScope;
}): boolean {
  if (input.publicationScope.type === "ORGANIZATION") {
    return input.publicationScope.departmentId === null && input.kind !== "DEPARTMENT_ALL";
  }
  return input.kind !== "ORGANIZATION_ALL"
    && (input.kind !== "DEPARTMENT_ALL"
      || input.audienceDepartmentId === input.publicationScope.departmentId);
}
