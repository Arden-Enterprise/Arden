import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "LEFT";
export type MembershipSummary = {
  organizationId: string;
  organizationName: string;
  status: MembershipStatus;
  roleCodes: string[];
  canUsePrivateWorkspace: boolean;
};

export type PrivateDraft = {
  id: string;
  organizationId: string;
  title: string;
  versionId: string;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DraftListItem = Omit<PrivateDraft, "versionId" | "sourceUri" | "mimeType" | "contentHash">;
export type DraftWrite = { title: string; body: string };
export type DraftPatch = { title?: string; body?: string };
export type OrganizationSetup = { name: string; departmentName: string };
export type CreatedOrganization = { organizationId: string; name: string; departmentId: string; departmentName: string };
export type CreatedInvitation = { invitationId: string; email: string; organizationName: string; expiresAt: Date };
export type OrganizationAdminData = {
  departments: Array<{ id: string; name: string; defaultRoleId: string; defaultRoleName: string }>;
  roles: Array<{ id: string; name: string; code: string; isDefault: boolean }>;
  members: Array<{ id: string; email: string; name: string; status: MembershipStatus; departmentId: string | null; roleIds: string[]; roleNames: string[] }>;
  invitations: Array<{ id: string; email: string; departmentId: string; status: string; expiresAt: Date }>;
};

export interface ArdenDataRepository {
  listMemberships(userId: string): Promise<MembershipSummary[]>;
  createOrganization(userId: string, email: string, fullName: string | null, setup: OrganizationSetup, requestId: string): Promise<CreatedOrganization>;
  createInvitation(userId: string, organizationId: string, departmentId: string, email: string, tokenHash: string, expiresAt: Date, requestId: string): Promise<CreatedInvitation | null>;
  rotateInvitation(userId: string, organizationId: string, invitationId: string, tokenHash: string, requestId: string): Promise<CreatedInvitation | null>;
  revokeInvitation(userId: string, organizationId: string, invitationId: string, requestId: string): Promise<boolean>;
  acceptInvitation(userId: string, email: string, fullName: string | null, emailVerified: boolean, tokenHash: string, requestId: string): Promise<boolean>;
  getOrganizationAdministration(userId: string, organizationId: string): Promise<OrganizationAdminData | null>;
  createDepartment(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean>;
  createOrganizationRole(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean>;
  assignOrganizationRole(userId: string, organizationId: string, membershipId: string, roleId: string, requestId: string): Promise<boolean>;
  changePrimaryDepartment(userId: string, organizationId: string, membershipId: string, departmentId: string, requestId: string): Promise<boolean>;
  listDrafts(userId: string, organizationId: string, limit: number, cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null>;
  getDraft(userId: string, organizationId: string, draftId: string): Promise<PrivateDraft | null>;
  canCreateDraft(userId: string, organizationId: string): Promise<boolean>;
  createDraft(userId: string, organizationId: string, write: DraftWrite, content: StoredContentFields, requestId: string): Promise<PrivateDraft | null>;
  canUpdateDraft(userId: string, organizationId: string, draftId: string): Promise<boolean>;
  updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<{ kind: "not-found" } | { kind: "conflict"; currentVersion: number } | { kind: "updated"; draft: PrivateDraft }>;
}

const membershipPermissionSql = `
  EXISTS (
    SELECT 1 FROM user_account ua
     WHERE ua.user_id = om.user_id AND ua.status = 'ACTIVE'
  ) AND EXISTS (
    SELECT 1
      FROM role_assignment ra
      JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
      JOIN role_permission rp ON rp.role_id = r.role_id
      JOIN permission p ON p.permission_id = rp.permission_id AND p.status = 'ACTIVE'
      JOIN access_scope s ON s.access_scope_id = ra.access_scope_id
                          AND s.organization_id = om.organization_id
                          AND s.status = 'ACTIVE'
     WHERE ra.membership_id = om.membership_id
       AND ra.status = 'ACTIVE'
       AND ra.valid_from <= now()
       AND (ra.valid_until IS NULL OR ra.valid_until > now())
       AND p.code = $3
       AND (
         s.scope_type = 'ORGANIZATION'
         OR EXISTS (
           SELECT 1
             FROM department_membership dm
            WHERE dm.membership_id = om.membership_id
              AND dm.department_id = s.department_id
              AND dm.status = 'ACTIVE'
         )
       )
  )`;

export class ArdenRepository implements ArdenDataRepository {
  constructor(private readonly pool: Pool) {}

  async listMemberships(userId: string): Promise<MembershipSummary[]> {
    return this.withActorContext(userId, null, async (client) => {
    const result = await client.query<{
      organization_id: string;
      organization_name: string;
      status: MembershipStatus;
      role_codes: string[] | null;
      can_use_private_workspace: boolean;
    }>(`
      SELECT o.organization_id,
             o.name AS organization_name,
             om.status,
             COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes,
             (${membershipPermissionSql}) AS can_use_private_workspace
        FROM organization_membership om
        JOIN organization o ON o.organization_id = om.organization_id
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        LEFT JOIN role_assignment ra
          ON ra.membership_id = om.membership_id
         AND ra.status = 'ACTIVE'
         AND ra.valid_from <= now()
         AND (ra.valid_until IS NULL OR ra.valid_until > now())
        LEFT JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
       WHERE om.user_id = $1
       GROUP BY o.organization_id, o.name, om.membership_id, om.status
       ORDER BY o.name, o.organization_id`, [userId, null, "PRIVATE_WORKSPACE_READ"]);

    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      status: row.status,
      roleCodes: row.role_codes ?? [],
      canUsePrivateWorkspace: row.can_use_private_workspace,
    }));
    });
  }

  async createOrganization(userId: string, email: string, fullName: string | null, setup: OrganizationSetup, requestId: string): Promise<CreatedOrganization> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', '', true)", [userId]);
      const profileName = fullName ?? email.split("@", 1)[0] ?? "Arden member";
      await client.query(`
        INSERT INTO user_account (user_id, email, full_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now()`,
      [userId, email, profileName]);
      const organization = await client.query<{ organization_id: string }>(`
        INSERT INTO organization (name, slug, created_by_user_id)
        VALUES ($1, $2, $3)
        RETURNING organization_id`, [setup.name, organizationSlug(setup.name), userId]);
      const organizationId = organization.rows[0]?.organization_id;
      if (!organizationId) throw new Error("Organization creation returned no id");
      await client.query("SELECT set_config('arden.organization_id', $1, true), set_config('arden.org_admin', 'true', true)", [organizationId]);

      const role = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, 'DEPT_DEFAULT_BOOTSTRAP', $2, 'Default role for the initial department', false)
        RETURNING role_id`, [organizationId, `${setup.departmentName} Member`]);
      const roleId = role.rows[0]?.role_id;
      if (!roleId) throw new Error("Default role creation returned no id");
      const department = await client.query<{ department_id: string }>(`
        INSERT INTO department (organization_id, code, name, default_role_id)
        VALUES ($1, 'GENERAL', $2, $3)
        RETURNING department_id`, [organizationId, setup.departmentName, roleId]);
      const departmentId = department.rows[0]?.department_id;
      if (!departmentId) throw new Error("Department creation returned no id");
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                        'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')
        ON CONFLICT DO NOTHING`, [roleId]);
      const departmentScope = await client.query<{ access_scope_id: string }>(`
        INSERT INTO access_scope (organization_id, department_id, scope_type)
        VALUES ($1, $2, 'DEPARTMENT') RETURNING access_scope_id`, [organizationId, departmentId]);
      const organizationScope = await client.query<{ access_scope_id: string }>(`
        INSERT INTO access_scope (organization_id, scope_type)
        VALUES ($1, 'ORGANIZATION') RETURNING access_scope_id`, [organizationId]);
      const membership = await client.query<{ membership_id: string }>(`
        INSERT INTO organization_membership (organization_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE') RETURNING membership_id`, [organizationId, userId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Creator membership creation returned no id");
      await client.query(`
        INSERT INTO department_membership (membership_id, department_id, is_primary, status)
        VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
      await client.query(`
        INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        VALUES ($1, $2, $3), ($1,
          (SELECT role_id FROM role WHERE organization_id IS NULL AND code = 'ORG_ADMIN' AND is_system), $4)`,
      [membershipId, roleId, departmentScope.rows[0]?.access_scope_id, organizationScope.rows[0]?.access_scope_id]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membershipId, JSON.stringify({ departmentId, requestId })]);
      await client.query("COMMIT");
      return { organizationId, name: setup.name, departmentId, departmentName: setup.departmentName };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvitation(userId: string, organizationId: string, departmentId: string, email: string, tokenHash: string, expiresAt: Date, requestId: string): Promise<CreatedInvitation | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      await client.query(`UPDATE organization_invitation SET status = 'EXPIRED'
        WHERE organization_id = $1 AND email = $2 AND status = 'PENDING' AND expires_at <= now()`, [organizationId, email]);
      const target = await client.query<{ organization_name: string }>(`
        SELECT o.name AS organization_name FROM department d
        JOIN organization o ON o.organization_id = d.organization_id
        WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE' AND o.status = 'ACTIVE'`,
      [departmentId, organizationId]);
      const organizationName = target.rows[0]?.organization_name;
      if (!organizationName) return null;
      const invitation = await client.query<{ invitation_id: string; expires_at: Date }>(`
        INSERT INTO organization_invitation
          (organization_id, invited_by_membership_id, department_id, email, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING invitation_id, expires_at`,
      [organizationId, inviterMembershipId, departmentId, email, tokenHash, expiresAt]);
      const created = invitation.rows[0];
      if (!created) throw new Error("Invitation creation returned no row");
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId: created.invitation_id, requestId })]);
      return { invitationId: created.invitation_id, email, organizationName, expiresAt: created.expires_at };
    });
  }

  async rotateInvitation(userId: string, organizationId: string, invitationId: string, tokenHash: string, requestId: string): Promise<CreatedInvitation | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      const invitation = await client.query<{ email: string; organization_name: string; expires_at: Date }>(`
        UPDATE organization_invitation i SET token_hash = $3
          FROM organization o
         WHERE i.invitation_id = $1 AND i.organization_id = $2 AND i.organization_id = o.organization_id
           AND i.status = 'PENDING' AND i.expires_at > now()
        RETURNING i.email, o.name AS organization_name, i.expires_at`, [invitationId, organizationId, tokenHash]);
      const rotated = invitation.rows[0];
      if (!rotated) return null;
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_RESENT', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId, requestId })]);
      return { invitationId, email: rotated.email, organizationName: rotated.organization_name, expiresAt: rotated.expires_at };
    });
  }

  async revokeInvitation(userId: string, organizationId: string, invitationId: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      const result = await client.query(`UPDATE organization_invitation SET status = 'REVOKED', revoked_at = now()
        WHERE invitation_id = $1 AND organization_id = $2 AND status = 'PENDING'`, [invitationId, organizationId]);
      if (result.rowCount !== 1) return false;
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_REVOKED', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId, requestId })]);
      return true;
    })) ?? false;
  }

  async getOrganizationAdministration(userId: string, organizationId: string): Promise<OrganizationAdminData | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client) => {
      const departments = await client.query<{ id: string; name: string; default_role_id: string; default_role_name: string }>(`
        SELECT d.department_id AS id, d.name, r.role_id AS default_role_id, r.name AS default_role_name
          FROM department d JOIN role r ON r.role_id = d.default_role_id
         WHERE d.organization_id = $1 AND d.status = 'ACTIVE' ORDER BY d.name`, [organizationId]);
      const roles = await client.query<{ id: string; name: string; code: string; is_default: boolean }>(`
        SELECT r.role_id AS id, r.name, r.code,
               EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id) AS is_default
          FROM role r WHERE r.organization_id = $1 AND r.status = 'ACTIVE' ORDER BY r.name`, [organizationId]);
      const members = await client.query<{
        id: string; email: string; name: string; status: MembershipStatus; department_id: string | null;
        role_ids: string[] | null; role_names: string[] | null;
      }>(`
        SELECT om.membership_id AS id, ua.email, ua.full_name AS name, om.status,
               max(dm.department_id::text) FILTER (WHERE dm.is_primary AND dm.status = 'ACTIVE')::uuid AS department_id,
               COALESCE(array_agg(DISTINCT r.role_id::text) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_ids,
               COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS role_names
          FROM organization_membership om JOIN user_account ua ON ua.user_id = om.user_id
          LEFT JOIN department_membership dm ON dm.membership_id = om.membership_id AND dm.is_primary AND dm.status = 'ACTIVE'
          LEFT JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
            AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
          LEFT JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
         WHERE om.organization_id = $1 GROUP BY om.membership_id, ua.email, ua.full_name, om.status
         ORDER BY ua.full_name, ua.email`, [organizationId]);
      const invitations = await client.query<{
        id: string; email: string; department_id: string; status: string; expires_at: Date;
      }>(`SELECT invitation_id AS id, email, department_id,
                  CASE WHEN status = 'PENDING' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
                  expires_at
            FROM organization_invitation WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT 200`, [organizationId]);
      return {
        departments: departments.rows.map((row) => ({ id: row.id, name: row.name, defaultRoleId: row.default_role_id, defaultRoleName: row.default_role_name })),
        roles: roles.rows.map((row) => ({ id: row.id, name: row.name, code: row.code, isDefault: row.is_default })),
        members: members.rows.map((row) => ({
          id: row.id, email: row.email, name: row.name, status: row.status, departmentId: row.department_id,
          roleIds: row.role_ids ?? [], roleNames: row.role_names ?? [],
        })),
        invitations: invitations.rows.map((row) => ({ id: row.id, email: row.email, departmentId: row.department_id, status: row.status, expiresAt: row.expires_at })),
      };
    });
  }

  async createDepartment(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      const role = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, $2, $3, $4, false) RETURNING role_id`,
      [organizationId, `DEPT_DEFAULT_${suffix}`, `${name} Member`, `Default role for ${name}`]);
      const roleId = role.rows[0]?.role_id;
      if (!roleId) throw new Error("Department default role creation returned no id");
      const departmentCode = `DEPT_${suffix}`;
      const department = await client.query<{ department_id: string }>(`
        INSERT INTO department (organization_id, code, name, default_role_id)
        VALUES ($1, $2, $3, $4) RETURNING department_id`, [organizationId, departmentCode, name, roleId]);
      const departmentId = department.rows[0]?.department_id;
      if (!departmentId) throw new Error("Department creation returned no id");
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                        'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE') ON CONFLICT DO NOTHING`, [roleId]);
      await client.query(`INSERT INTO access_scope (organization_id, department_id, scope_type) VALUES ($1, $2, 'DEPARTMENT')`, [organizationId, departmentId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'DEPARTMENT_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, actorMembershipId, JSON.stringify({ departmentId, requestId })]);
      return true;
    })) ?? false;
  }

  async createOrganizationRole(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
      const code = `${base || "ROLE"}_${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      const role = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, $2, $3, 'Organization-created audience role', false) RETURNING role_id`, [organizationId, code, name]);
      const roleId = role.rows[0]?.role_id;
      if (!roleId) throw new Error("Organization role creation returned no id");
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE')
        ON CONFLICT DO NOTHING`, [roleId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_ROLE_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, actorMembershipId, JSON.stringify({ roleId, requestId })]);
      return true;
    })) ?? false;
  }

  async assignOrganizationRole(userId: string, organizationId: string, membershipId: string, roleId: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const result = await client.query<{ role_assignment_id: string }>(`
        INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT om.membership_id, r.role_id, s.access_scope_id
          FROM organization_membership om JOIN role r ON r.role_id = $3 AND r.organization_id = $2
            AND r.is_system = false AND r.status = 'ACTIVE'
          JOIN access_scope s ON s.organization_id = $2 AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
         WHERE om.membership_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
        ON CONFLICT DO NOTHING RETURNING role_assignment_id`, [membershipId, organizationId, roleId]);
      if (result.rowCount !== 1) return false;
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, role_assignment_id, event_type, outcome, details_json)
        VALUES ($1, $2, $3, 'ORGANIZATION_ROLE_ASSIGNED', 'SUCCESS', $4::jsonb)`,
      [organizationId, actorMembershipId, result.rows[0]?.role_assignment_id, JSON.stringify({ membershipId, roleId, requestId })]);
      return true;
    })) ?? false;
  }

  async changePrimaryDepartment(userId: string, organizationId: string, membershipId: string, departmentId: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const member = await client.query<{ current_department_id: string | null }>(`
        SELECT max(department_id::text) FILTER (WHERE is_primary AND status = 'ACTIVE')::uuid AS current_department_id
          FROM department_membership WHERE membership_id = $1`, [membershipId]);
      const currentDepartmentId = member.rows[0]?.current_department_id;
      const target = await client.query<{ default_role_id: string; access_scope_id: string }>(`
        SELECT d.default_role_id, s.access_scope_id FROM department d JOIN access_scope s
          ON s.department_id = d.department_id AND s.organization_id = d.organization_id
         AND s.scope_type = 'DEPARTMENT' AND s.status = 'ACTIVE'
         WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE'
           AND EXISTS (SELECT 1 FROM organization_membership om WHERE om.membership_id = $3
                        AND om.organization_id = $2 AND om.status = 'ACTIVE')`, [departmentId, organizationId, membershipId]);
      const assignment = target.rows[0];
      if (!assignment) return false;
      if (currentDepartmentId === departmentId) return true;
      if (currentDepartmentId) {
        await client.query(`UPDATE role_assignment SET status = 'REVOKED'
          WHERE membership_id = $1 AND role_id = (SELECT default_role_id FROM department WHERE department_id = $2)
            AND status = 'ACTIVE'`, [membershipId, currentDepartmentId]);
        await client.query(`UPDATE department_membership SET status = 'REMOVED', removed_at = now()
          WHERE membership_id = $1 AND department_id = $2 AND is_primary AND status = 'ACTIVE'`, [membershipId, currentDepartmentId]);
      }
      await client.query(`INSERT INTO department_membership (membership_id, department_id, is_primary, status)
        VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [membershipId, assignment.default_role_id, assignment.access_scope_id]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'PRIMARY_DEPARTMENT_CHANGED', 'SUCCESS', $3::jsonb)`,
      [organizationId, actorMembershipId, JSON.stringify({ membershipId, departmentId, requestId })]);
      return true;
    })) ?? false;
  }

  async acceptInvitation(userId: string, email: string, fullName: string | null, emailVerified: boolean, tokenHash: string, requestId: string): Promise<boolean> {
    if (!emailVerified || !email || email !== email.trim().toLowerCase()) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', '', true),
                                 set_config('arden.invitation_token_hash', $2, true)`, [userId, tokenHash]);
      const profileName = fullName ?? email.split("@", 1)[0] ?? "Arden member";
      await client.query(`
        INSERT INTO user_account (user_id, email, full_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now()`,
      [userId, email, profileName]);
      const found = await client.query<{ invitation_id: string; organization_id: string; department_id: string; invited_email: string }>(`
        SELECT invitation_id, organization_id, department_id, email AS invited_email
          FROM organization_invitation
         WHERE token_hash = $1 AND status = 'PENDING' AND expires_at > now()
         FOR UPDATE`, [tokenHash]);
      const invitation = found.rows[0];
      if (!invitation || invitation.invited_email !== email) {
        await client.query("ROLLBACK");
        return false;
      }
      const { organization_id: organizationId, department_id: departmentId, invitation_id: invitationId } = invitation;
      await client.query("SELECT set_config('arden.organization_id', $1, true)", [organizationId]);
      const membership = await client.query<{ membership_id: string }>(`
        INSERT INTO organization_membership (organization_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE') RETURNING membership_id`, [organizationId, userId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Invitation membership creation returned no row");
      await client.query(`
        INSERT INTO department_membership (membership_id, department_id, is_primary, status)
        VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
      const defaultRole = await client.query<{ role_id: string; access_scope_id: string }>(`
        SELECT d.default_role_id AS role_id, s.access_scope_id
          FROM department d JOIN access_scope s
            ON s.department_id = d.department_id AND s.organization_id = d.organization_id
           AND s.scope_type = 'DEPARTMENT' AND s.status = 'ACTIVE'
         WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE'`, [departmentId, organizationId]);
      const assignment = defaultRole.rows[0];
      if (!assignment) throw new Error("Invitation department default role is unavailable");
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id) VALUES ($1, $2, $3)`,
        [membershipId, assignment.role_id, assignment.access_scope_id]);
      await client.query(`
        UPDATE organization_invitation SET status = 'ACCEPTED', accepted_by_user_id = $2, accepted_at = now()
         WHERE invitation_id = $1`, [invitationId, userId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_ACCEPTED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membershipId, JSON.stringify({ invitationId, requestId })]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return false;
      throw error;
    } finally {
      client.release();
    }
  }

  private async withOrganizationAdmin<T>(userId: string, organizationId: string, work: (client: PoolClient, membershipId: string) => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [userId, organizationId]);
      const admin = await client.query<{ membership_id: string }>(`
        SELECT om.membership_id FROM organization_membership om
        JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
          AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
        JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
        JOIN access_scope s ON s.access_scope_id = ra.access_scope_id AND s.organization_id = om.organization_id
          AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
      const membershipId = admin.rows[0]?.membership_id;
      if (!membershipId) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("SELECT set_config('arden.org_admin', 'true', true)");
      const result = await work(client, membershipId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDrafts(userId: string, organizationId: string, limit: number, cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const membershipId = await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_READ", client);
    if (!membershipId) return null;

    const result = await client.query<{
      draft_id: string;
      title: string;
      current_version_no: number;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT d.draft_id, d.title, d.current_version_no, d.created_at, d.updated_at
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
       WHERE w.membership_id = $1 AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
         AND ($2::timestamptz IS NULL OR (d.updated_at, d.draft_id) < ($2, $3::uuid))
       ORDER BY d.updated_at DESC, d.draft_id DESC
       LIMIT $4`, [membershipId, cursor?.updatedAt ?? null, cursor?.draftId ?? null, limit + 1]);

    const hasNextPage = result.rows.length > limit;
    const page = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const items = page.map((row) => ({
      id: row.draft_id,
      organizationId,
      title: row.title,
      currentVersion: row.current_version_no,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasNextPage && last ? { updatedAt: last.updated_at.toISOString(), draftId: last.draft_id } : null,
    };
    });
  }

  async getDraft(userId: string, organizationId: string, draftId: string): Promise<PrivateDraft | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const result = await client.query<{
      draft_id: string;
      draft_version_id: string;
      title: string;
      source_uri: string;
      mime_type: string;
      content_hash: string;
      current_version_no: number;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT d.draft_id, v.draft_version_id, d.title, v.source_uri, v.mime_type, v.content_hash,
             d.current_version_no, d.created_at, d.updated_at
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
       WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
         AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
         AND ${membershipPermissionSql}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_READ"]);
    const row = result.rows[0];
    return row ? {
      id: row.draft_id,
      organizationId,
      title: row.title,
      versionId: row.draft_version_id,
      sourceUri: row.source_uri,
      mimeType: row.mime_type,
      contentHash: row.content_hash,
      currentVersion: row.current_version_no,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null;
    });
  }

  async canCreateDraft(userId: string, organizationId: string): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async (client) =>
      Boolean(await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_WRITE", client)));
  }

  async createDraft(userId: string, organizationId: string, write: DraftWrite, content: StoredContentFields, requestId: string): Promise<PrivateDraft | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membershipId = await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_WRITE", client);
      if (!membershipId) return null;

      await client.query(`
        INSERT INTO private_workspace (membership_id, name)
        VALUES ($1, 'Private workspace')
        ON CONFLICT (membership_id) DO NOTHING`, [membershipId]);
      const workspace = await client.query<{ workspace_id: string }>(`
        SELECT workspace_id FROM private_workspace
         WHERE membership_id = $1 AND status = 'ACTIVE'`, [membershipId]);
      const workspaceId = workspace.rows[0]?.workspace_id;
      if (!workspaceId) return null;

      const draft = await client.query<{ draft_id: string; created_at: Date; updated_at: Date }>(`
        INSERT INTO draft_document (workspace_id, title, current_version_no)
        VALUES ($1, $2, 1)
        RETURNING draft_id, created_at, updated_at`, [workspaceId, write.title]);
      const created = draft.rows[0];
      if (!created) throw new Error("Draft insert returned no row");
      const versionResult = await client.query<{ draft_version_id: string }>(`
        INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id)
        VALUES ($1, 1, $2, $3, $4, $5)
        RETURNING draft_version_id`, [created.draft_id, content.sourceUri, content.mimeType, content.contentHash, membershipId]);
      const versionId = versionResult.rows[0]?.draft_version_id;
      if (!versionId) throw new Error("Draft version insert returned no row");
      await this.appendAudit(client, organizationId, membershipId, "PRIVATE_DRAFT_CREATED", created.draft_id, 1, requestId);
      return {
        id: created.draft_id,
        organizationId,
        title: write.title,
        versionId,
        sourceUri: content.sourceUri,
        mimeType: content.mimeType,
        contentHash: content.contentHash,
        currentVersion: 1,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };
    });
  }

  async canUpdateDraft(userId: string, organizationId: string, draftId: string): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const result = await client.query(`
      SELECT 1 FROM draft_document d
      JOIN private_workspace w ON w.workspace_id = d.workspace_id
      JOIN organization_membership om ON om.membership_id = w.membership_id
     WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
       AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
       AND ${membershipPermissionSql}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
    return result.rowCount === 1;
    });
  }

  async updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<{ kind: "not-found" } | { kind: "conflict"; currentVersion: number } | { kind: "updated"; draft: PrivateDraft }> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const currentResult = await client.query<{
        membership_id: string;
        title: string;
        draft_version_id: string;
        source_uri: string;
        mime_type: string;
        content_hash: string;
        current_version_no: number;
        created_at: Date;
        updated_at: Date;
      }>(`
        SELECT om.membership_id, d.title, v.draft_version_id, v.source_uri, v.mime_type, v.content_hash,
               d.current_version_no, d.created_at, d.updated_at
          FROM draft_document d
          JOIN private_workspace w ON w.workspace_id = d.workspace_id
          JOIN organization_membership om ON om.membership_id = w.membership_id
          JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
         WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
           AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
           AND ${membershipPermissionSql}
         FOR UPDATE OF d`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
      const current = currentResult.rows[0];
      if (!current) return { kind: "not-found" };
      if (current.current_version_no !== expectedVersion) return { kind: "conflict", currentVersion: current.current_version_no };

      const version = expectedVersion + 1;
      const title = patch.title ?? current.title;
      const source = content ?? {
        sourceUri: current.source_uri,
        mimeType: current.mime_type,
        contentHash: current.content_hash,
      };
      await client.query(`
        UPDATE draft_document
           SET title = $2, current_version_no = $3, updated_at = now()
         WHERE draft_id = $1`, [draftId, title, version]);
      const versionResult = await client.query<{ draft_version_id: string }>(`
        INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING draft_version_id`, [draftId, version, source.sourceUri, source.mimeType, source.contentHash, current.membership_id]);
      const versionId = versionResult.rows[0]?.draft_version_id;
      if (!versionId) throw new Error("Draft version insert returned no row");
      await this.appendAudit(client, organizationId, current.membership_id, "PRIVATE_DRAFT_UPDATED", draftId, version, requestId);
      const updated = await client.query<{ created_at: Date; updated_at: Date }>(`
        SELECT created_at, updated_at FROM draft_document WHERE draft_id = $1`, [draftId]);
      const timestamps = updated.rows[0];
      if (!timestamps) throw new Error("Updated draft disappeared within transaction");
      return {
        kind: "updated",
        draft: {
          id: draftId,
          organizationId,
          title,
          versionId,
          sourceUri: source.sourceUri,
          mimeType: source.mimeType,
          contentHash: source.contentHash,
          currentVersion: version,
          createdAt: timestamps.created_at,
          updatedAt: timestamps.updated_at,
        },
      };
    });
  }

  private async findMembership(userId: string, organizationId: string, permissionCode: string, client: Pool | PoolClient = this.pool): Promise<string | null> {
    const result = await client.query<{ membership_id: string }>(`
      SELECT om.membership_id
        FROM organization_membership om
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
         AND ${membershipPermissionSql}`, [userId, organizationId, permissionCode]);
    return result.rows[0]?.membership_id ?? null;
  }

  private async appendAudit(client: PoolClient, organizationId: string, membershipId: string, eventType: string, draftId: string, version: number, requestId: string) {
    await client.query(`
      INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
      VALUES ($1, $2, $3, 'SUCCESS', $4::jsonb)`, [organizationId, membershipId, eventType, JSON.stringify({ draftId, version, requestId })]);
  }

  private async withActorContext<T>(userId: string, organizationId: string | null, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [userId, organizationId ?? ""]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export type DraftCursor = { updatedAt: string; draftId: string };
export type StoredContentFields = { sourceUri: string; mimeType: "text/plain"; contentHash: string };

function organizationSlug(name: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return `${base || "organization"}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
