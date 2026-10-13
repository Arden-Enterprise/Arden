// UI-only configuration. These values are not server authorization facts.
export const configurablePermissions = [
  { code: "PUBLISHED_CONTENT_VIEW", name: "Read published knowledge", group: "Reading", description: "Read approved documents only when this role matches their audience and the member is in the permitted scope." },
  { code: "SHARED_DRAFT_WRITE", name: "Write shared drafts", group: "Contribution", description: "Create and edit your own shared drafts, including a separate copy of your own private note. Pending submissions stay locked." },
  { code: "SHARED_DRAFT_SUBMIT", name: "Submit for review", group: "Contribution", description: "Send your own saved version for review. A valid department, classification and audience are still required." },
] as const;

export type ConfigurablePermission = typeof configurablePermissions[number]["code"];
export type RoleConfiguration = {
  id: string;
  name: string;
  description: string;
  permissions: ConfigurablePermission[];
  memberIds: string[];
};
export type RoleMember = { id: string; name: string; email: string; active: boolean };

export function toggleRolePermission(role: RoleConfiguration, code: ConfigurablePermission): RoleConfiguration {
  return { ...role, permissions: role.permissions.includes(code)
    ? role.permissions.filter((value) => value !== code) : [...role.permissions, code] };
}

export function toggleRoleMember(role: RoleConfiguration, member: RoleMember): RoleConfiguration {
  // An inactive member can be removed, but cannot be newly assigned even in preview.
  if (!member.active && !role.memberIds.includes(member.id)) return role;
  return { ...role, memberIds: role.memberIds.includes(member.id)
    ? role.memberIds.filter((id) => id !== member.id) : [...role.memberIds, member.id] };
}

export function validateRoleConfigurations(roles: readonly RoleConfiguration[]): string | null {
  const names = roles.map((role) => role.name.trim().toLocaleLowerCase());
  if (names.some((name) => !name)) return "Give every role a name.";
  if (roles.some((role) => role.name.trim().length > 80)) return "Role names must be 80 characters or fewer.";
  if (new Set(names).size !== names.length) return "Use a different name for each role.";
  if (names.includes("org admin") || names.includes("organization admin")) return "Organization Admin is a protected role. Choose another name.";
  return null;
}

export function createSampleRoleConfigurations(): RoleConfiguration[] {
  return [
    { id: "preview-contributor", name: "Contributor", description: "Capture knowledge and submit it for human review.", permissions: ["PUBLISHED_CONTENT_VIEW", "SHARED_DRAFT_WRITE", "SHARED_DRAFT_SUBMIT"], memberIds: [] },
    { id: "preview-reader", name: "Reader", description: "Read knowledge within an assigned audience.", permissions: ["PUBLISHED_CONTENT_VIEW"], memberIds: [] },
  ];
}
