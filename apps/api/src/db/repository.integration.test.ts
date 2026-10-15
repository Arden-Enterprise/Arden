import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "./repository.js";

const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const ids = {
  organization: randomUUID(),
  owner: randomUUID(),
  manager: randomUUID(),
  ownerRole: randomUUID(),
  managerRole: randomUUID(),
  organizationScope: randomUUID(),
  ownerMembership: randomUUID(),
  managerMembership: randomUUID(),
  department: randomUUID(),
};
const roleCodes = [`ARDEN_TEST_OWNER_${ids.owner.replaceAll("-", "")}`, `ARDEN_TEST_MANAGER_${ids.manager.replaceAll("-", "")}`];
const repository = pool ? new ArdenRepository(pool) : null;
let fixtureReady = false;

describe.skipIf(!databaseUrl)("ArdenRepository with real PostgreSQL RLS", () => {
  beforeAll(async () => {
    if (!pool) throw new Error("ARDEN_TEST_DATABASE_URL was not provided");
    const identity = await pool.query<{ database_name: string; is_superuser: boolean }>(`
      SELECT current_database() AS database_name, r.rolsuper AS is_superuser
        FROM pg_roles r WHERE r.rolname = current_user`);
    if (!identity.rows[0]?.database_name.startsWith("arden_test_")) {
      throw new Error("Refusing integration fixtures outside a database named arden_test_*");
    }
    if (!identity.rows[0]?.is_superuser) throw new Error("The isolated integration database connection must be a superuser for fixture cleanup");
    const migration = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM public.arden_schema_migrations
       WHERE migration_id IN ('0001_initial_schema', '0008_enable_private_shared_draft_creation',
         '0015_org_admin_member_profiles')`);
    if (migration.rows[0]?.count !== "3") throw new Error("Apply the current schema migrations to the isolated test database first");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`INSERT INTO organization (organization_id, name, slug) VALUES ($1, 'Arden Integration Test', $2)`, [ids.organization, `arden-test-${ids.organization}`]);
      await client.query(`INSERT INTO user_account (user_id, email, full_name) VALUES ($1, $2, 'Synthetic Owner'), ($3, $4, 'Synthetic Manager')`, [ids.owner, `${ids.owner}@example.test`, ids.manager, `${ids.manager}@example.test`]);
      await client.query(`INSERT INTO organization_membership (membership_id, organization_id, user_id) VALUES ($1, $2, $3), ($4, $2, $5)`, [ids.ownerMembership, ids.organization, ids.owner, ids.managerMembership, ids.manager]);
      await client.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, 'Synthetic private-note owner'), ($4, $2, $5, 'Synthetic manager')`, [ids.ownerRole, ids.organization, roleCodes[0], ids.managerRole, roleCodes[1]]);
      await client.query(`INSERT INTO department (department_id, organization_id, code, name, default_role_id)
        VALUES ($1, $2, 'TEST', 'Synthetic department', $3)`, [ids.department, ids.organization, ids.ownerRole]);
      await client.query(`INSERT INTO access_scope (access_scope_id, organization_id, scope_type) VALUES ($1, $2, 'ORGANIZATION')`, [ids.organizationScope, ids.organization]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id) VALUES ($1, $2, $3), ($4, $5, $3)`, [ids.ownerMembership, ids.ownerRole, ids.organizationScope, ids.managerMembership, ids.managerRole]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, role_id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.ownerMembership, ids.organizationScope]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code IN ('PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')`, [ids.ownerRole]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PRIVATE_WORKSPACE_READ'`, [ids.managerRole]);
      await client.query("COMMIT");
      fixtureReady = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (fixtureReady) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL search_path TO arden, public");
          await client.query("ALTER TABLE audit_event DISABLE TRIGGER USER");
          await client.query("ALTER TABLE draft_version DISABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_draft_version DISABLE TRIGGER USER");
          await client.query("DELETE FROM audit_event WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM reviewer_grant WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id IN (SELECT shared_draft_id FROM shared_draft WHERE author_membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM shared_draft WHERE author_membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM draft_version WHERE draft_id IN (SELECT d.draft_id FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id WHERE w.membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM draft_document WHERE workspace_id IN (SELECT workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM private_workspace WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM role_permission WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole]]);
          await client.query("DELETE FROM organization_membership WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM department WHERE department_id = $1", [ids.department]);
          await client.query("DELETE FROM role WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole]]);
          await client.query("DELETE FROM access_scope WHERE access_scope_id = $1", [ids.organizationScope]);
          await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [[ids.owner, ids.manager]]);
          await client.query("DELETE FROM organization WHERE organization_id = $1", [ids.organization]);
          await client.query("ALTER TABLE draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE audit_event ENABLE TRIGGER USER");
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });

  it("scopes owner writes, manager reads, conflicts, and audit records through RLS", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    await expect(repository.requireActiveMembership(ids.owner, ids.organization)).resolves.toEqual({
      membershipId: ids.ownerMembership, organizationId: ids.organization, userId: ids.owner,
    });
    await expect(repository.requireActiveMembership(ids.owner, randomUUID())).resolves.toBeNull();
    await expect(repository.requireActiveMembership(ids.manager, ids.organization)).resolves.toEqual({
      membershipId: ids.managerMembership, organizationId: ids.organization, userId: ids.manager,
    });
    await expect(repository.listMemberships(ids.owner)).resolves.toHaveLength(1);
    const created = await repository.createDraft(ids.owner, ids.organization, { title: "Private", body: "Sensitive text" }, {
      sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: "a".repeat(64),
    }, "integration-create");
    expect(created).not.toBeNull();
    if (!created) return;

    await expect(repository.getDraft(ids.owner, ids.organization, created.id)).resolves.toMatchObject({ title: "Private" });
    await expect(repository.getDraft(ids.manager, ids.organization, created.id)).resolves.toBeNull();
    await expect(repository.listDrafts(ids.manager, ids.organization, 10, null)).resolves.toMatchObject({ items: [] });
    await expect(repository.canCreateDraft(ids.manager, ids.organization)).resolves.toBe(false);
    await expect(repository.updateDraft(ids.owner, ids.organization, created.id, 0, { title: "Stale" }, null, "integration-stale"))
      .resolves.toEqual({ kind: "conflict", currentVersion: 1 });

    const updated = await repository.updateDraft(ids.owner, ids.organization, created.id, 1, { title: "Updated" }, null, "integration-update");
    expect(updated).toMatchObject({ kind: "updated", draft: { title: "Updated", currentVersion: 2 } });
    const concurrentUpdates = await Promise.all([
      repository.updateDraft(ids.owner, ids.organization, created.id, 2, { title: "Concurrent A" }, null, "integration-concurrent-a"),
      repository.updateDraft(ids.owner, ids.organization, created.id, 2, { title: "Concurrent B" }, null, "integration-concurrent-b"),
    ]);
    expect(concurrentUpdates.filter((result) => result.kind === "updated")).toHaveLength(1);
    expect(concurrentUpdates.filter((result) => result.kind === "conflict")).toEqual([{ kind: "conflict", currentVersion: 3 }]);
    await expect(repository.getDraft(ids.owner, ids.organization, created.id)).resolves.toMatchObject({ currentVersion: 3 });
    const audit = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.audit_event WHERE organization_id = $1 AND event_type LIKE 'PRIVATE_DRAFT_%'`, [ids.organization]);
    expect(audit.rows[0]?.count).toBe("3");
    const connectionContext = await pool.query<{ role_name: string; actor_id: string | null }>(`SELECT current_user AS role_name, current_setting('arden.actor_id', true) AS actor_id`);
    expect(connectionContext.rows[0]?.role_name).not.toBe("arden_runtime");
    expect([null, ""]).toContain(connectionContext.rows[0]?.actor_id);
  });

  it("copies only an authorized private version and keeps shared rows invisible to another member", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const privateDraft = await repository.createDraft(ids.owner, ids.organization, { title: "Author-only original", body: "Private" }, {
      sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: "b".repeat(64),
    }, "shared-test-private-create");
    expect(privateDraft).not.toBeNull();
    if (!privateDraft) return;
    const source = await repository.getPrivateContributionSource(ids.owner, ids.organization, privateDraft.versionId);
    expect(source).toMatchObject({ ownerMembershipId: ids.ownerMembership, organizationId: ids.organization });
    expect(await repository.getPrivateContributionSource(ids.manager, ids.organization, privateDraft.versionId)).toBeNull();
    expect(await repository.getPrivateContributionSource(ids.owner, randomUUID(), privateDraft.versionId)).toBeNull();
    if (!source) return;

    const input = {
      actorMembershipId: ids.ownerMembership,
      sourceVersionId: source.versionId,
      classification: "INTERNAL" as const,
      idempotencyKey: randomUUID(),
      expectedSource: source,
      copiedContent: { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: source.contentHash },
      requestId: "integration-shared-create",
    };
    const created = await repository.createKnowledgeDraft(ids.owner, ids.organization, input);
    expect(created).toMatchObject({ kind: "created", draft: { currentVersion: 1, sourcePrivateVersionId: source.versionId } });
    if (created.kind !== "created") return;
    expect(created.draft.sourceUri).not.toBe(source.sourceUri);
    expect(await repository.createKnowledgeDraft(ids.owner, ids.organization, {
      ...input, copiedContent: { ...input.copiedContent, sourceUri: `arden-private-object://${randomUUID()}` },
    })).toMatchObject({ kind: "replayed", draft: { id: created.draft.id } });
    expect(await repository.createKnowledgeDraft(ids.owner, ids.organization, {
      ...input, classification: "CONFIDENTIAL", copiedContent: { ...input.copiedContent, sourceUri: `arden-private-object://${randomUUID()}` },
    })).toEqual({ kind: "idempotency-conflict" });
    expect(await repository.createKnowledgeDraft(ids.manager, ids.organization, {
      ...input, actorMembershipId: ids.managerMembership, idempotencyKey: randomUUID(),
    })).toEqual({ kind: "unavailable" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [ids.manager, ids.organization]);
      const hidden = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM shared_draft WHERE shared_draft_id = $1", [created.draft.id]);
      const hiddenVersion = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM shared_draft_version WHERE shared_draft_id = $1", [created.draft.id]);
      expect(hidden.rows[0]?.count).toBe("0");
      expect(hiddenVersion.rows[0]?.count).toBe("0");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const audit = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM arden.audit_event WHERE organization_id = $1 AND event_type = 'SHARED_DRAFT_CREATED'", [ids.organization]);
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("shows invited members to their Org Admin and permits a reviewer grant without exposing profiles to other actors", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");

    const administration = await repository.getOrganizationAdministration(ids.owner, ids.organization);
    expect(administration?.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.ownerMembership }),
      expect.objectContaining({ id: ids.managerMembership, name: "Synthetic Manager" }),
    ]));
    await expect(repository.getOrganizationAdministration(ids.manager, ids.organization)).resolves.toBeNull();
    await expect(repository.getOrganizationAdministration(ids.owner, randomUUID())).resolves.toBeNull();

    const grant = await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.managerMembership,
      departmentId: ids.department,
      classifications: ["INTERNAL"],
      level: "STANDARD",
      teamTag: null,
      projectTag: null,
      validUntil: null,
    }, "integration-reviewer-grant");
    expect(grant).toMatchObject({ reviewerMembershipId: ids.managerMembership, status: "ACTIVE" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [ids.manager, ids.organization]);
      const memberView = await client.query<{ user_id: string }>("SELECT user_id FROM user_account WHERE user_id = $1", [ids.owner]);
      expect(memberView.rows).toHaveLength(0);

      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true), set_config('arden.org_admin', 'true', true)",
        [ids.owner, randomUUID()]);
      const otherOrgView = await client.query<{ user_id: string }>("SELECT user_id FROM user_account WHERE user_id = $1", [ids.manager]);
      expect(otherOrgView.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
