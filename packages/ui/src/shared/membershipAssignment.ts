import type { OrganizationMembership } from "./api-client";

/** Department assignment controls onboarding state; private-note permission is independent. */
export function needsDepartmentAssignment(membership: OrganizationMembership): boolean {
  return membership.status === "active"
    && !membership.departmentId
    && !membership.roleCodes.includes("ORG_ADMIN");
}

export function membershipAccessDescription(membership: OrganizationMembership): string {
  const department = membership.departmentName ? `${membership.departmentName} · ` : "";
  const role = membership.roleCodes.includes("ORG_ADMIN") ? "Organization Admin" : "Member";
  return `${department}${role}`;
}
