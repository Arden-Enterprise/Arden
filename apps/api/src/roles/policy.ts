export const configurableRolePermissions = ["PUBLISHED_CONTENT_VIEW"] as const;
export type RolePermission = typeof configurableRolePermissions[number];
export type RoleScope =
  | { type: "ORGANIZATION"; departmentId: null }
  | { type: "DEPARTMENT"; departmentId: string };

export function isRolePermission(value: unknown): value is RolePermission {
  return value === "PUBLISHED_CONTENT_VIEW";
}

export function matchingRoleScope(assignment: RoleScope, publication: RoleScope): boolean {
  if (assignment.type !== publication.type) return false;
  if (publication.type === "ORGANIZATION") return assignment.departmentId === null && publication.departmentId === null;
  return Boolean(publication.departmentId) && assignment.departmentId === publication.departmentId;
}

export function validCustomRoleName(name: string): boolean {
  const normalized = name.normalize("NFKC").trim();
  return normalized.length > 0 && normalized.length <= 80
    && !/^(org[\s_-]*admin|organization[\s_-]*admin)$/i.test(normalized);
}

export function canUseOwnerPrivateWorkspace(input: {
  actorMembershipId: string | null;
  ownerMembershipId: string;
  actorOrganizationId: string;
  resourceOrganizationId: string;
  accountActive: boolean;
  organizationActive: boolean;
  membershipActive: boolean;
}): boolean {
  return input.accountActive && input.organizationActive && input.membershipActive
    && input.actorMembershipId !== null && input.actorMembershipId === input.ownerMembershipId
    && input.actorOrganizationId === input.resourceOrganizationId;
}
