import type { OrganizationAdministration } from "../shared/api-client";

type Member = OrganizationAdministration["members"][number];

export function isOrganizationAdminMember(member: Member): boolean {
  return member.isOrganizationAdmin;
}

export function filterOrganizationMembers(
  members: Member[],
  filters: { query: string; status: string; department: string },
): Member[] {
  return members.filter((member) => {
    const query = filters.query.trim().toLowerCase();
    const isAwaitingAssignment = member.status === "INVITED"
      || (member.status === "ACTIVE" && !member.departmentId && !isOrganizationAdminMember(member));
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

export function departmentDeletionSummary(memberCount: number): string {
  const members = `${memberCount} member${memberCount === 1 ? "" : "s"}`;
  return `Deleting this department will unassign ${members}. Members who still need a department will enter the waiting room; organization administrators remain active.`;
}
