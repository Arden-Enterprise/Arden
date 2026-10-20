import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { validAudienceGroupName } from "./policy.js";

export type AudienceGroupMember = {
  id: string;
  membershipId: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  validFrom: string;
  validUntil: string | null;
};
export type AudienceGroup = {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  version: number;
  members: AudienceGroupMember[];
};
export type AudienceGroupWrite = { name: string; description: string };
export type AudienceGroupErrorCode =
  | "AUDIENCE_GROUP_UNAVAILABLE"
  | "AUDIENCE_GROUP_CONFLICT"
  | "AUDIENCE_GROUP_INVALID"
  | "AUDIENCE_GROUP_IN_USE";

export class AudienceGroupError extends Error {
  constructor(readonly code: AudienceGroupErrorCode) { super(code); }
}
export interface AudienceGroupStore {
  list(userId: string, organizationId: string): Promise<AudienceGroup[]>;
  get(userId: string, organizationId: string, audienceGroupId: string): Promise<AudienceGroup>;
  create(userId: string, organizationId: string, input: AudienceGroupWrite, requestId: string): Promise<AudienceGroup>;
  update(userId: string, organizationId: string, audienceGroupId: string, version: number,
    input: AudienceGroupWrite, requestId: string): Promise<AudienceGroup>;
  addMember(userId: string, organizationId: string, audienceGroupId: string,
    membershipId: string, requestId: string): Promise<AudienceGroup>;
  removeMember(userId: string, organizationId: string, audienceGroupId: string,
    groupMembershipId: string, requestId: string): Promise<AudienceGroup>;
  deactivate(userId: string, organizationId: string, audienceGroupId: string,
    version: number, requestId: string): Promise<AudienceGroup>;
}

type AdminTransaction = <T>(userId: string, organizationId: string,
  work: (client: PoolClient, actorMembershipId: string) => Promise<T>) => Promise<T | null>;

const groupSelect = `SELECT a.audience_id AS id, a.name, a.description, a.status,
  a.configuration_version AS version,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', agm.audience_group_membership_id,
    'membershipId', agm.membership_id,
    'status', agm.status,
    'validFrom', agm.valid_from,
    'validUntil', agm.valid_until)
    ORDER BY agm.assigned_at, agm.audience_group_membership_id)
    FROM audience_group_membership agm
    WHERE agm.audience_id = a.audience_id), '[]'::jsonb) AS members
  FROM audience a
 WHERE a.organization_id = $1 AND a.kind = 'GROUP' AND NOT a.is_managed`;

export class PgAudienceGroupStore implements AudienceGroupStore {
  constructor(private readonly withAdmin: AdminTransaction) {}

  private async transaction<T>(userId: string, organizationId: string,
    work: (client: PoolClient, actorMembershipId: string) => Promise<T>): Promise<T> {
    const result = await this.withAdmin(userId, organizationId, async (client, actor) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`arden:audience-groups:${organizationId}`]);
      return work(client, actor);
    });
    if (result === null) throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
    return result;
  }

  private validate(input: AudienceGroupWrite) {
    if (!validAudienceGroupName(input.name) || input.description.length > 300) {
      throw new AudienceGroupError("AUDIENCE_GROUP_INVALID");
    }
  }

  private async read(client: PoolClient, organizationId: string, audienceGroupId: string): Promise<AudienceGroup> {
    const result = await client.query<AudienceGroup>(`${groupSelect} AND a.audience_id = $2`,
      [organizationId, audienceGroupId]);
    if (!result.rows[0]) throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
    return result.rows[0];
  }

  private async audit(client: PoolClient, organizationId: string, actorMembershipId: string,
    eventType: string, details: object) {
    await client.query(`INSERT INTO audit_event(
        organization_id, actor_membership_id, event_type, outcome, details_json)
      VALUES ($1, $2, $3, 'SUCCESS', $4::jsonb)`,
    [organizationId, actorMembershipId, eventType, JSON.stringify(details)]);
  }

  async list(userId: string, organizationId: string) {
    return this.transaction(userId, organizationId, async client =>
      (await client.query<AudienceGroup>(`${groupSelect} ORDER BY a.name, a.audience_id`,
        [organizationId])).rows);
  }

  async get(userId: string, organizationId: string, audienceGroupId: string) {
    return this.transaction(userId, organizationId,
      client => this.read(client, organizationId, audienceGroupId));
  }

  async create(userId: string, organizationId: string, input: AudienceGroupWrite, requestId: string) {
    this.validate(input);
    return this.transaction(userId, organizationId, async (client, actorMembershipId) => {
      const id = randomUUID();
      const name = input.name.normalize("NFKC").trim();
      try {
        // The role row is a temporary compatibility projection for migrations 0001-0016.
        await client.query(`INSERT INTO role(role_id, organization_id, code, name, description, is_system)
          VALUES ($1, $2, $3, $4, $5, false)`,
        [id, organizationId, `AUDIENCE_${id.replaceAll("-", "").toUpperCase()}`, name, input.description]);
        await client.query(`INSERT INTO role_permission(role_id, permission_id)
          SELECT $1, permission_id FROM permission
           WHERE code = 'PUBLISHED_CONTENT_VIEW' AND status = 'ACTIVE'`, [id]);
        await client.query(`INSERT INTO audience(
            audience_id, organization_id, kind, name, description, is_managed,
            created_by_membership_id, legacy_role_id)
          VALUES ($1, $2, 'GROUP', $3, $4, false, $5, $1)`,
        [id, organizationId, name, input.description, actorMembershipId]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
        }
        throw error;
      }
      await this.audit(client, organizationId, actorMembershipId, "AUDIENCE_GROUP_CREATED",
        { audienceGroupId: id, requestId });
      return this.read(client, organizationId, id);
    });
  }

  async update(userId: string, organizationId: string, audienceGroupId: string, version: number,
    input: AudienceGroupWrite, requestId: string) {
    this.validate(input);
    return this.transaction(userId, organizationId, async (client, actorMembershipId) => {
      const current = await this.read(client, organizationId, audienceGroupId);
      if (current.version !== version) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
      if (current.status !== "ACTIVE") throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
      const name = input.name.normalize("NFKC").trim();
      try {
        const changed = await client.query(`UPDATE audience
          SET name = $3, description = $4, configuration_version = configuration_version + 1,
              updated_at = now()
          WHERE audience_id = $1 AND organization_id = $2 AND kind = 'GROUP'
            AND configuration_version = $5`,
        [audienceGroupId, organizationId, name, input.description, version]);
        if (!changed.rowCount) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
        await client.query("UPDATE role SET name = $2, description = $3 WHERE role_id = $1",
          [audienceGroupId, name, input.description]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
        }
        throw error;
      }
      await this.audit(client, organizationId, actorMembershipId, "AUDIENCE_GROUP_UPDATED",
        { audienceGroupId, previousVersion: version, requestId });
      return this.read(client, organizationId, audienceGroupId);
    });
  }

  async addMember(userId: string, organizationId: string, audienceGroupId: string,
    membershipId: string, requestId: string) {
    return this.transaction(userId, organizationId, async (client, actorMembershipId) => {
      const group = await this.read(client, organizationId, audienceGroupId);
      if (group.status !== "ACTIVE") throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
      const member = await client.query(`SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        WHERE om.membership_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`,
      [membershipId, organizationId]);
      if (!member.rowCount) throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
      let groupMembershipId: string;
      try {
        const inserted = await client.query<{ id: string }>(`INSERT INTO audience_group_membership(
            audience_id, organization_id, membership_id, assigned_by_membership_id)
          VALUES ($1, $2, $3, $4)
          RETURNING audience_group_membership_id AS id`,
        [audienceGroupId, organizationId, membershipId, actorMembershipId]);
        groupMembershipId = inserted.rows[0]?.id ?? "";
        if (!groupMembershipId) throw new Error("Audience group membership insert returned no id");
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
        }
        throw error;
      }
      // Compatibility grants cover organization scope and each current department.
      await client.query(`INSERT INTO role_assignment(membership_id, role_id, access_scope_id)
        SELECT $1, $2, s.access_scope_id FROM access_scope s
         WHERE s.organization_id = $3 AND s.status = 'ACTIVE'
           AND (s.scope_type = 'ORGANIZATION' OR EXISTS (
             SELECT 1 FROM department_membership dm
              WHERE dm.membership_id = $1 AND dm.department_id = s.department_id
                AND dm.status = 'ACTIVE'))
        ON CONFLICT DO NOTHING`, [membershipId, audienceGroupId, organizationId]);
      await client.query(`UPDATE audience SET configuration_version = configuration_version + 1,
        updated_at = now() WHERE audience_id = $1`, [audienceGroupId]);
      await this.audit(client, organizationId, actorMembershipId, "AUDIENCE_GROUP_MEMBER_ADDED",
        { audienceGroupId, groupMembershipId, membershipId, requestId });
      return this.read(client, organizationId, audienceGroupId);
    });
  }

  async removeMember(userId: string, organizationId: string, audienceGroupId: string,
    groupMembershipId: string, requestId: string) {
    return this.transaction(userId, organizationId, async (client, actorMembershipId) => {
      await this.read(client, organizationId, audienceGroupId);
      const changed = await client.query<{ membership_id: string }>(`UPDATE audience_group_membership
        SET status = 'REVOKED', revoked_at = now()
        WHERE audience_group_membership_id = $1 AND audience_id = $2
          AND organization_id = $3 AND status = 'ACTIVE'
        RETURNING membership_id`, [groupMembershipId, audienceGroupId, organizationId]);
      const membershipId = changed.rows[0]?.membership_id;
      if (!membershipId) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
      await client.query(`UPDATE role_assignment SET status = 'REVOKED'
        WHERE membership_id = $1 AND role_id = $2 AND status = 'ACTIVE'`,
      [membershipId, audienceGroupId]);
      await client.query(`UPDATE audience SET configuration_version = configuration_version + 1,
        updated_at = now() WHERE audience_id = $1`, [audienceGroupId]);
      await this.audit(client, organizationId, actorMembershipId, "AUDIENCE_GROUP_MEMBER_REMOVED",
        { audienceGroupId, groupMembershipId, membershipId, requestId });
      return this.read(client, organizationId, audienceGroupId);
    });
  }

  async deactivate(userId: string, organizationId: string, audienceGroupId: string,
    version: number, requestId: string) {
    return this.transaction(userId, organizationId, async (client, actorMembershipId) => {
      const group = await this.read(client, organizationId, audienceGroupId);
      if (group.version !== version || group.status !== "ACTIVE") {
        throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
      }
      const references = await client.query(`SELECT 1 FROM knowledge_current_publication
        WHERE organization_id = $1 AND $2::uuid = ANY(audience_role_ids)
        UNION ALL SELECT 1 FROM shared_submission
        WHERE organization_id = $1 AND status = 'PENDING_REVIEW'
          AND $2::uuid = ANY(audience_role_ids)`, [organizationId, audienceGroupId]);
      if (references.rowCount) throw new AudienceGroupError("AUDIENCE_GROUP_IN_USE");
      await client.query(`UPDATE audience SET status = 'INACTIVE',
        configuration_version = configuration_version + 1, updated_at = now()
        WHERE audience_id = $1 AND organization_id = $2`, [audienceGroupId, organizationId]);
      await client.query("UPDATE role SET status = 'INACTIVE' WHERE role_id = $1", [audienceGroupId]);
      await this.audit(client, organizationId, actorMembershipId, "AUDIENCE_GROUP_DEACTIVATED",
        { audienceGroupId, previousVersion: version, requestId });
      return this.read(client, organizationId, audienceGroupId);
    });
  }
}
