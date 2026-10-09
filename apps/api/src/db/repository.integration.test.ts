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
      SELECT count(*)::text AS count FROM public.arden_schema_migrations WHERE migration_id = '0001_initial_schema'`);
    if (migration.rows[0]?.count !== "1") throw new Error("Apply the initial schema migration to the isolated test database first");

    await pool.query("BEGIN");
    try {
      await pool.query("SET LOCAL search_path TO arden, public");
      await pool.query(`INSERT INTO organization (organization_id, name, slug) VALUES ($1, 'Arden Integration Test', $2)`, [ids.organization, `arden-test-${ids.organization}`]);
      await pool.query(`INSERT INTO user_account (user_id, email, full_name) VALUES ($1, $2, 'Synthetic Owner'), ($3, $4, 'Synthetic Manager')`, [ids.owner, `${ids.owner}@example.test`, ids.manager, `${ids.manager}@example.test`]);
      await pool.query(`INSERT INTO organization_membership (membership_id, organization_id, user_id) VALUES ($1, $2, $3), ($4, $2, $5)`, [ids.ownerMembership, ids.organization, ids.owner, ids.managerMembership, ids.manager]);
      await pool.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, 'Synthetic private-note owner'), ($4, $2, $5, 'Synthetic manager')`, [ids.ownerRole, ids.organization, roleCodes[0], ids.managerRole, roleCodes[1]]);
      await pool.query(`INSERT INTO access_scope (access_scope_id, organization_id, scope_type) VALUES ($1, $2, 'ORGANIZATION')`, [ids.organizationScope, ids.organization]);
      await pool.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id) VALUES ($1, $2, $3), ($4, $5, $3)`, [ids.ownerMembership, ids.ownerRole, ids.organizationScope, ids.managerMembership, ids.managerRole]);
      await pool.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code IN ('PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')`, [ids.ownerRole]);
      await pool.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PRIVATE_WORKSPACE_READ'`, [ids.managerRole]);
      await pool.query("COMMIT");
      fixtureReady = true;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (fixtureReady) {
        await pool.query("BEGIN");
        try {
          await pool.query("SET LOCAL search_path TO arden, public");
          await pool.query("ALTER TABLE audit_event DISABLE TRIGGER USER");
          await pool.query("ALTER TABLE draft_version DISABLE TRIGGER USER");
          await pool.query("DELETE FROM audit_event WHERE organization_id = $1", [ids.organization]);
          await pool.query("DELETE FROM draft_version WHERE draft_id IN (SELECT d.draft_id FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id WHERE w.membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await pool.query("DELETE FROM draft_document WHERE workspace_id IN (SELECT workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await pool.query("DELETE FROM private_workspace WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await pool.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await pool.query("DELETE FROM role_permission WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole]]);
          await pool.query("DELETE FROM organization_membership WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await pool.query("DELETE FROM role WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole]]);
          await pool.query("DELETE FROM access_scope WHERE access_scope_id = $1", [ids.organizationScope]);
          await pool.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [[ids.owner, ids.manager]]);
          await pool.query("DELETE FROM organization WHERE organization_id = $1", [ids.organization]);
          await pool.query("ALTER TABLE draft_version ENABLE TRIGGER USER");
          await pool.query("ALTER TABLE audit_event ENABLE TRIGGER USER");
          await pool.query("COMMIT");
        } catch (error) {
          await pool.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await pool.end();
    }
  });

  it("scopes owner writes, manager reads, conflicts, and audit records through RLS", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
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
    const audit = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.audit_event WHERE organization_id = $1`, [ids.organization]);
    expect(audit.rows[0]?.count).toBe("3");
    const connectionContext = await pool.query<{ role_name: string; actor_id: string | null }>(`SELECT current_user AS role_name, current_setting('arden.actor_id', true) AS actor_id`);
    expect(connectionContext.rows[0]?.role_name).not.toBe("arden_runtime");
    expect([null, ""]).toContain(connectionContext.rows[0]?.actor_id);
  });
});
