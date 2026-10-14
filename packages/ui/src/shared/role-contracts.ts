export type CustomRoleWrite = { name: string; description: string; permissions: Array<"PUBLISHED_CONTENT_VIEW"> };
export type CustomRoleAssignment = {
  id: string; membershipId: string; status: "ACTIVE" | "REVOKED" | "EXPIRED";
  scope: { type: "ORGANIZATION"; departmentId: null } | { type: "DEPARTMENT"; departmentId: string };
  validFrom: string; validUntil: string | null;
};
export type CustomRoleRecord = CustomRoleWrite & {
  id: string; version: number; status: "ACTIVE" | "INACTIVE"; assignments: CustomRoleAssignment[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Invalid role response.");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Invalid role identifier.");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid assignment timestamp.");
  return value;
}
export function parseCustomRole(value: unknown): CustomRoleRecord {
  const role = record(value);
  if (typeof role.name !== "string" || typeof role.description !== "string"
    || typeof role.version !== "number" || !Number.isSafeInteger(role.version) || role.version <= 0
    || (role.status !== "ACTIVE" && role.status !== "INACTIVE")
    || !Array.isArray(role.permissions) || !Array.isArray(role.assignments)) throw new Error("Invalid role configuration.");
  const permissions: CustomRoleWrite["permissions"] = role.permissions.map((permission: unknown) => {
    if (permission !== "PUBLISHED_CONTENT_VIEW") throw new Error("Unsupported role permission.");
    return permission;
  });
  if (new Set(permissions).size !== permissions.length) throw new Error("Duplicate role permission.");
  const assignments: CustomRoleAssignment[] = role.assignments.map((value: unknown) => {
    const assignment = record(value); const scope = record(assignment.scope);
    if (assignment.status !== "ACTIVE" && assignment.status !== "REVOKED" && assignment.status !== "EXPIRED") throw new Error("Invalid assignment status.");
    const parsedScope = scope.type === "ORGANIZATION" && scope.departmentId === null
      ? { type: "ORGANIZATION" as const, departmentId: null }
      : scope.type === "DEPARTMENT" ? { type: "DEPARTMENT" as const, departmentId: id(scope.departmentId) } : null;
    if (!parsedScope) throw new Error("Invalid assignment scope.");
    return { id: id(assignment.id), membershipId: id(assignment.membershipId), scope: parsedScope,
      status: assignment.status, validFrom: timestamp(assignment.validFrom),
      validUntil: assignment.validUntil === null ? null : timestamp(assignment.validUntil) };
  });
  return { id: id(role.id), name: role.name, description: role.description, status: role.status,
    version: role.version, permissions, assignments };
}
export function parseCustomRoleList(value: unknown): CustomRoleRecord[] {
  const list = record(value);
  if (!Array.isArray(list.items)) throw new Error("Invalid role list.");
  return list.items.map(parseCustomRole);
}
