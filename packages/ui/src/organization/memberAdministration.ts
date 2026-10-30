import type { OrganizationAdministration } from "../shared/api-client";

type Member = OrganizationAdministration["members"][number];
type Role = OrganizationAdministration["roles"][number];

export function isOrganizationAdminMember(member: Member, roles: Role[]): boolean {
  return Boolean(member.roleNames?.some((name) => {
    const lower = name.toLowerCase();
    return lower === "organization admin" || lower === "org admin" || lower.includes("admin");
  })) || roles.some((role) => role.code === "ORG_ADMIN" && member.roleIds.includes(role.id));
}

export function filterOrganizationMembers(
  members: Member[],
  roles: Role[],
  filters: { query: string; status: string; department: string },
): Member[] {
  return members.filter((member) => {
    const query = filters.query.trim().toLowerCase();
    const isAwaitingAssignment = member.status === "INVITED"
      || (member.status === "ACTIVE" && !member.departmentId && !isOrganizationAdminMember(member, roles));
    const matchesStatus = (() => {
      switch (filters.status) {
        case "ALL": return true;
        case "INVITED": return isAwaitingAssignment;
        case "ACTIVE": return member.status === "ACTIVE" && !isAwaitingAssignment;
        case "INACTIVE": return member.status === "SUSPENDED" || member.status === "LEFT";
        default: return member.status === filters.status;
      }
    })();
    return (!query || `${member.name} ${member.email}`.toLowerCase().includes(query))
      && matchesStatus
      && (filters.department === "ALL" || (member.departmentIds ?? [member.departmentId]).includes(filters.department));
  });
}

export function membersInDepartment(members: Member[], departmentId: string): Member[] {
  return members.filter((member) => (member.departmentIds ?? [member.departmentId]).includes(departmentId));
}
