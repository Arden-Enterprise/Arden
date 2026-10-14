import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isRolePermission, validCustomRoleName, type RolePermission, type RoleScope } from "./policy.js";

export type CustomRole = {
  id: string; name: string; description: string; status: "ACTIVE" | "INACTIVE";
  version: number; permissions: RolePermission[];
  assignments: Array<{ id: string; membershipId: string; scope: RoleScope; status: string; validFrom: string; validUntil: string | null }>;
};
export type RoleWrite = { name: string; description: string; permissions: RolePermission[] };
export type RoleErrorCode = "ROLE_UNAVAILABLE" | "ROLE_CONFLICT" | "ROLE_INVALID" | "ROLE_IN_USE";
export class RoleError extends Error {
  constructor(readonly code: RoleErrorCode) { super(code); }
}
export interface CustomRoleStore {
  list(userId: string, organizationId: string): Promise<CustomRole[]>;
  get(userId: string, organizationId: string, roleId: string): Promise<CustomRole>;
  create(userId: string, organizationId: string, input: RoleWrite, requestId: string): Promise<CustomRole>;
  update(userId: string, organizationId: string, roleId: string, version: number, input: RoleWrite, requestId: string): Promise<CustomRole>;
  assign(userId: string, organizationId: string, roleId: string, membershipId: string, scope: RoleScope, requestId: string): Promise<CustomRole>;
  revoke(userId: string, organizationId: string, roleId: string, assignmentId: string, requestId: string): Promise<CustomRole>;
  deactivate(userId: string, organizationId: string, roleId: string, version: number, requestId: string): Promise<CustomRole>;
}
type AdminTransaction = <T>(userId: string, organizationId: string,
  work: (client: PoolClient, actorMembershipId: string) => Promise<T>) => Promise<T | null>;

const manageableRole = `r.organization_id = $1 AND NOT r.is_system
  AND r.code <> 'ALL_MEMBERS'
  AND NOT EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id)
  AND NOT EXISTS (SELECT 1 FROM role_permission rp JOIN permission p USING(permission_id)
    WHERE rp.role_id = r.role_id AND p.code NOT IN
      ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE'))`;
const roleSelect = `SELECT r.role_id AS id, r.name, COALESCE(r.description, '') AS description,
  r.status, r.configuration_version AS version,
  ARRAY(SELECT p.code FROM role_permission rp JOIN permission p USING(permission_id)
    WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW' AND p.status = 'ACTIVE') AS permissions,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ra.role_assignment_id,
    'membershipId', ra.membership_id, 'status', ra.status,
    'scope', jsonb_build_object('type', s.scope_type, 'departmentId', s.department_id),
    'validFrom', ra.valid_from, 'validUntil', ra.valid_until) ORDER BY ra.assigned_at, ra.role_assignment_id)
    FROM role_assignment ra JOIN access_scope s USING(access_scope_id)
    JOIN organization_membership om USING(membership_id)
    WHERE ra.role_id = r.role_id AND s.organization_id = $1 AND om.organization_id = $1), '[]'::jsonb) AS assignments
  FROM role r WHERE ${manageableRole}`;

export class PgCustomRoleStore implements CustomRoleStore {
  constructor(private readonly withAdmin: AdminTransaction) {}
  private async read(client: PoolClient, organizationId: string, roleId: string): Promise<CustomRole> {
    const result = await client.query<CustomRole>(`${roleSelect} AND r.role_id = $2`, [organizationId, roleId]);
    if (!result.rows[0]) throw new RoleError("ROLE_UNAVAILABLE");
    return result.rows[0];
  }
  private async transaction<T>(userId: string, organizationId: string,
    work: (client: PoolClient, actor: string) => Promise<T>): Promise<T> {
    const result = await this.withAdmin(userId, organizationId, async (client, actor) => {
      // Serializes name checks, permission replacement and assignment changes in this organization.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`arden:roles:${organizationId}`]);
      return work(client, actor);
    });
    if (result === null) throw new RoleError("ROLE_UNAVAILABLE");
    return result;
  }
  private validate(input: RoleWrite) {
    if (!validCustomRoleName(input.name) || input.description.length > 300
      || !input.permissions.every(isRolePermission) || new Set(input.permissions).size !== input.permissions.length) {
      throw new RoleError("ROLE_INVALID");
    }
  }
  private async nameAvailable(client: PoolClient, org: string, name: string, exclude: string | null) {
    const existing = await client.query("SELECT 1 FROM role WHERE organization_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND ($3::uuid IS NULL OR role_id <> $3)",
      [org, name, exclude]);
    if (existing.rowCount) throw new RoleError("ROLE_CONFLICT");
  }
  private async audit(client: PoolClient, org: string, actor: string, event: string, details: object) {
    await client.query("INSERT INTO audit_event(organization_id, actor_membership_id, event_type, outcome, details_json) VALUES ($1,$2,$3,'SUCCESS',$4::jsonb)",
      [org, actor, event, JSON.stringify(details)]);
  }
  private async permissions(client: PoolClient, roleId: string, values: RolePermission[]) {
    // Only legacy content grants on a manageable role can be replaced, never protected grants.
    await client.query("DELETE FROM role_permission WHERE role_id = $1", [roleId]);
    if (values.length) {
      const inserted = await client.query("INSERT INTO role_permission(role_id, permission_id) SELECT $1, permission_id FROM permission WHERE code = ANY($2::text[]) AND status = 'ACTIVE'",
        [roleId, values]);
      if (inserted.rowCount !== values.length) throw new RoleError("ROLE_INVALID");
    }
  }
  async list(user: string, org: string) {
    return this.transaction(user, org, async client => (await client.query<CustomRole>(`${roleSelect} ORDER BY r.name, r.role_id`, [org])).rows);
  }
  async get(user: string, org: string, id: string) {
    return this.transaction(user, org, client => this.read(client, org, id));
  }
  async create(user: string, org: string, input: RoleWrite, requestId: string) {
    this.validate(input);
    return this.transaction(user, org, async (client, actor) => {
      await this.nameAvailable(client, org, input.name.normalize("NFKC").trim(), null);
      const id = randomUUID();
      await client.query("INSERT INTO role(role_id, organization_id, code, name, description, is_system) VALUES ($1,$2,$3,$4,$5,false)",
        [id, org, `CUSTOM_${id.replaceAll("-", "").toUpperCase()}`, input.name.normalize("NFKC").trim(), input.description]);
      await this.permissions(client, id, input.permissions);
      await this.audit(client, org, actor, "CUSTOM_ROLE_CREATED", { roleId: id, permissions: input.permissions, requestId });
      return this.read(client, org, id);
    });
  }
  async update(user: string, org: string, id: string, version: number, input: RoleWrite, requestId: string) {
    this.validate(input);
    return this.transaction(user, org, async (client, actor) => {
      const current = await this.read(client, org, id);
      if (current.version !== version) throw new RoleError("ROLE_CONFLICT");
      if (current.status !== "ACTIVE") throw new RoleError("ROLE_UNAVAILABLE");
      await this.nameAvailable(client, org, input.name.normalize("NFKC").trim(), id);
      await this.permissions(client, id, input.permissions);
      await client.query("UPDATE role SET name=$2, description=$3, configuration_version=configuration_version+1 WHERE role_id=$1",
        [id, input.name.normalize("NFKC").trim(), input.description]);
      await this.audit(client, org, actor, "CUSTOM_ROLE_UPDATED", { roleId: id, previousVersion: version,
        beforePermissions: current.permissions, permissions: input.permissions, requestId });
      return this.read(client, org, id);
    });
  }
  async assign(user: string, org: string, id: string, membershipId: string, scope: RoleScope, requestId: string) {
    return this.transaction(user, org, async (client, actor) => {
      const role = await this.read(client, org, id);
      if (role.status !== "ACTIVE") throw new RoleError("ROLE_UNAVAILABLE");
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO role_assignment(membership_id, role_id, access_scope_id)
        SELECT om.membership_id, $3, s.access_scope_id FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN access_scope s ON s.organization_id = om.organization_id AND s.status = 'ACTIVE'
          AND s.scope_type = $4 AND s.department_id IS NOT DISTINCT FROM $5::uuid
        WHERE om.organization_id = $1 AND om.membership_id = $2 AND om.status = 'ACTIVE'
          AND ($4 = 'ORGANIZATION' OR EXISTS (SELECT 1 FROM department_membership dm
            JOIN department d USING(department_id) WHERE dm.membership_id = om.membership_id
              AND dm.department_id = $5 AND dm.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.organization_id = $1))
        ON CONFLICT DO NOTHING RETURNING role_assignment_id AS id`, [org, membershipId, id, scope.type, scope.departmentId]);
      if (!inserted.rowCount) throw new RoleError("ROLE_CONFLICT");
      await client.query("UPDATE role SET configuration_version=configuration_version+1 WHERE role_id=$1", [id]);
      await this.audit(client, org, actor, "CUSTOM_ROLE_ASSIGNED", { roleId: id, assignmentId: inserted.rows[0]?.id, membershipId, scope, requestId });
      return this.read(client, org, id);
    });
  }
  async revoke(user: string, org: string, id: string, assignmentId: string, requestId: string) {
    return this.transaction(user, org, async (client, actor) => {
      await this.read(client, org, id);
      const changed = await client.query("UPDATE role_assignment SET status='REVOKED' WHERE role_id=$1 AND role_assignment_id=$2 AND status='ACTIVE'", [id, assignmentId]);
      if (!changed.rowCount) throw new RoleError("ROLE_CONFLICT");
      await client.query("UPDATE role SET configuration_version=configuration_version+1 WHERE role_id=$1", [id]);
      await this.audit(client, org, actor, "CUSTOM_ROLE_REVOKED", { roleId: id, assignmentId, requestId });
      return this.read(client, org, id);
    });
  }
  async deactivate(user: string, org: string, id: string, version: number, requestId: string) {
    return this.transaction(user, org, async (client, actor) => {
      const role = await this.read(client, org, id);
      if (role.version !== version) throw new RoleError("ROLE_CONFLICT");
      // Do not strand pending reviews/current publications by silently disabling their audience.
      const references = await client.query(`SELECT 1 FROM knowledge_current_publication WHERE organization_id=$1 AND $2::uuid = ANY(audience_role_ids)
        UNION ALL SELECT 1 FROM shared_submission WHERE organization_id=$1 AND status='PENDING_REVIEW' AND $2::uuid=ANY(audience_role_ids)`, [org, id]);
      if (references.rowCount) throw new RoleError("ROLE_IN_USE");
      if (role.status !== "ACTIVE") throw new RoleError("ROLE_CONFLICT");
      await client.query("UPDATE role SET status='INACTIVE', configuration_version=configuration_version+1 WHERE role_id=$1", [id]);
      await this.audit(client, org, actor, "CUSTOM_ROLE_DEACTIVATED", { roleId: id, previousVersion: version, requestId });
      return this.read(client, org, id);
    });
  }
}
