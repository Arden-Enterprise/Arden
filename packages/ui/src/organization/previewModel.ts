export type PrimaryRole = "Employee" | "Manager / Knowledge Reviewer" | "System Admin";
export type Department = { id: string; name: string };
export type OrganizationMember = {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  role: PrimaryRole | "";
  status?: "active" | "pending-assignment" | "suspended";
  roleScope?: "organization" | "department";
};
export type OrganizationInvitation = {
  id: string;
  name: string;
  email: string;
  status: "pending" | "accepted" | "revoked";
  createdAt: number;
  expiresAt: number;
  resendCount: number;
  memberId?: string;
};
export type OrganizationPreview = {
  name: string;
  templateId: string;
  departments: Department[];
  members: OrganizationMember[];
  invitations?: OrganizationInvitation[];
};
export const primaryRoles: PrimaryRole[] = ["Employee", "Manager / Knowledge Reviewer", "System Admin"];
export function isPrimaryRole(value: string): value is PrimaryRole {
  return primaryRoles.some((role) => role === value);
}
export const previewTemplates = [
  { id: "product-operations", name: "Technology SME", description: "A starting structure for product teams and their operating partners.", departments: ["Product Engineering", "Operations", "Security", "Finance & People"] },
  { id: "service-delivery", name: "Professional Services", description: "Delivery teams with clear operating and knowledge responsibilities.", departments: ["Delivery", "Operations", "Sales", "Finance & People"] },
  { id: "manufacturing", name: "Manufacturing SME", description: "Connect production knowledge with quality and supply-chain teams.", departments: ["Production", "Quality", "Supply Chain", "Finance & People"] },
] as const;
export const accessRules = [
  { scope: "Company-wide", audience: "Authorized organization members", detail: "A company-wide publication is available to eligible organization members, regardless of their primary department." },
  { scope: "Department", audience: "Members of the selected department", detail: "Department publications follow their audience. A role label alone does not grant access to another department's documents." },
  { scope: "Private", audience: "Owner only", detail: "Managers and System Admins do not automatically see another member's private notes." },
] as const;
export function createPreviewOrganization(templateId: string = previewTemplates[0].id): OrganizationPreview {
  const template = previewTemplates.find((item) => item.id === templateId) ?? previewTemplates[0];
  const departments = template.departments.map((name, index) => ({ id: `department-${index + 1}`, name }));
  return {
    name: "FPT Digital", templateId: template.id, departments,
    members: [
      { id: "sample-admin", name: "Tuan Le", email: "tuan@fpt-digital.example", departmentId: departments[0].id, role: "System Admin", status: "active", roleScope: "organization" },
      { id: "sample-employee", name: "Lan Nguyen", email: "lan@fpt-digital.example", departmentId: departments[0].id, role: "Employee", status: "active", roleScope: "department" },
      { id: "sample-reviewer", name: "Minh Tran", email: "minh@fpt-digital.example", departmentId: departments[2].id, role: "Manager / Knowledge Reviewer", status: "active", roleScope: "department" },
      { id: "sample-operations-employee", name: "Hoa Bui", email: "hoa@fpt-digital.example", departmentId: departments[1].id, role: "Employee", status: "active", roleScope: "department" },
      { id: "sample-finance-employee", name: "Mai Pham", email: "mai@fpt-digital.example", departmentId: departments[3].id, role: "Employee", status: "active", roleScope: "department" },
      { id: "sample-security-employee", name: "Bao Vu", email: "bao@fpt-digital.example", departmentId: departments[2].id, role: "Employee", status: "active", roleScope: "department" },
    ], invitations: [],
  };
}
export function validateOrganization(organization: OrganizationPreview): string[] {
  const problems: string[] = [];
  const departmentNames = organization.departments.map((item) => item.name.trim().toLowerCase());
  const memberEmails = organization.members.map((item) => item.email.trim().toLowerCase());
  if (!organization.name.trim()) problems.push("Enter an organization name.");
  if (!organization.departments.length) problems.push("Add at least one department.");
  if (departmentNames.some((name) => !name)) problems.push("Name every department.");
  if (new Set(departmentNames).size !== departmentNames.length) problems.push("Department names must be unique.");
  if (organization.members.some((member) => !member.name.trim())) problems.push("Name every member.");
  if (organization.members.some((member) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email.trim()))) problems.push("Give every member a valid email address.");
  if (new Set(memberEmails).size !== memberEmails.length) problems.push("Member email addresses must be unique.");
  const assignedMembers = organization.members.filter((member) => member.status !== "pending-assignment");
  if (assignedMembers.some((member) => !organization.departments.some((department) => department.id === member.departmentId))) problems.push("Assign every active member to an existing department.");
  if (assignedMembers.some((member) => !isPrimaryRole(member.role))) problems.push("Assign every active member a supported system role.");
  if (assignedMembers.some((member) => member.roleScope !== "organization" && member.roleScope !== "department")) problems.push("Assign every active member an explicit role scope.");
  if (organization.members.some((member) => member.role === "System Admin" && member.roleScope === "department")) problems.push("System Admin responsibilities apply to the organization.");
  if (!organization.members.some((member) => member.role === "System Admin" && member.status !== "suspended" && member.status !== "pending-assignment" && member.roleScope === "organization" && organization.departments.some((department) => department.id === member.departmentId))) problems.push("Keep at least one active System Admin.");
  return problems;
}
