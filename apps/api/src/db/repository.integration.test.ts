import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository, ReviewerGrantConflictError } from "./repository.js";
import { prepareKnowledgeFixture, submitLegacyKnowledgeFixture } from "./knowledge-fixture.test-support.js";
import { registerKnowledgeCatalogVerification } from "../knowledge/catalog.integration.verification.js";
import { registerGovernedAnsweringVerification } from "../answers/governed.integration.verification.js";
import { PgIndexGenerationStore } from "../indexing/store.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import { canRead, type TargetReadersInput } from "../target-readers/policy.js";
import { NotificationOutboxWorker } from "../notifications/outbox.js";

const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const ids = {
  organization: randomUUID(),
  owner: randomUUID(),
  manager: randomUUID(),
  organizationReviewer: randomUUID(),
  ownerRole: randomUUID(),
  managerRole: randomUUID(),
  organizationScope: randomUUID(),
  ownerMembership: randomUUID(),
  managerMembership: randomUUID(),
  organizationReviewerMembership: randomUUID(),
  department: randomUUID(),
  organizationAudience: randomUUID(),
  readerAudience: randomUUID(),
  secondDepartment: randomUUID(),
  secondDepartmentRole: randomUUID(),
};
/** Extra members created by the Target Readers review test (T2.1). */
const readerFixtures = Array.from({ length: 10 }, () => ({ userId: randomUUID(), membershipId: randomUUID() }));
const roleCodes = [
  `ARDEN_TEST_OWNER_${ids.owner.replaceAll("-", "").toUpperCase()}`,
  `ARDEN_TEST_MANAGER_${ids.manager.replaceAll("-", "").toUpperCase()}`,
];
const repository = pool ? new ArdenRepository(pool) : null;
let fixtureReady = false;
let indexPool: Pool | null = null;
const indexLogin = `arden_test_indexer_${ids.owner.replaceAll("-", "")}`;
const indexPassword = randomUUID();
let notificationPool: Pool | null = null;
const notificationLogin = `arden_test_notifier_${ids.owner.replaceAll("-", "")}`;
const notificationPassword = randomUUID();

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
         '0015_org_admin_member_profiles', '0016_fix_flow2_cross_actor_validation',
         '0017_audience_and_instance_admin_foundation',
          '0018_flow3_contract_and_test_content_reset',
          '0019_flow3_durable_index_generations', '0020_permission_aware_answer_sources',
          '0021_monotonic_publication_activation', '0022_organization_reviewer_grants',
          '0024_target_reader_selection', '0025_review_approved_readers', '0026_review_list_authors',
          '0027_document_category_relationships', '0028_audience_to_target_readers',
          '0029_withdraw_pending_submission', '0031_deduplicate_reviewer_grants',
          '0032_governed_ai_sources_and_conversations', '0033_reader_directory_email',
          '0034_publication_change_requests', '0035_apply_publication_change_requests',
          '0036_publication_preparation_retry', '0037_publication_governance',
          '0038_admin_only_direct_withdrawal', '0039_in_app_notifications', '0040_flat_collection_placement',
          '0041_verified_legacy_metadata_repair', '0042_remove_knowledge_topics',
          '0061_document_share_notifications', '0062_private_notes_organization_and_trash',
          '0064_private_notes_order_and_archive', '0065_private_note_live_version', '0066_ai_turn_feedback',
          '0067_private_ai_feedback', '0068_expired_document_renewal')`);
    if (migration.rows[0]?.count !== "35") throw new Error("Apply the current schema migrations to the isolated test database first");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`INSERT INTO organization (organization_id, name, slug) VALUES ($1, 'Arden Integration Test', $2)`, [ids.organization, `arden-test-${ids.organization}`]);
      await client.query(`INSERT INTO user_account (user_id, email, full_name)
        VALUES ($1, $2, 'Synthetic Owner'), ($3, $4, 'Synthetic Manager'),
          ($5, $6, 'Synthetic Organization Reviewer')`,
      [ids.owner, `${ids.owner}@example.test`, ids.manager, `${ids.manager}@example.test`,
        ids.organizationReviewer, `${ids.organizationReviewer}@example.test`]);
      await client.query(`INSERT INTO organization_membership (membership_id, organization_id, user_id)
        VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7)`,
      [ids.ownerMembership, ids.organization, ids.owner, ids.managerMembership, ids.manager,
        ids.organizationReviewerMembership, ids.organizationReviewer]);
      // The custom member role has "Administrator" in its display name, but is not the protected ORG_ADMIN capability.
      await client.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, 'Synthetic private-note owner'), ($4, $2, $5, 'Department Administrator')`, [ids.ownerRole, ids.organization, roleCodes[0], ids.managerRole, roleCodes[1]]);
      await client.query(`INSERT INTO department (department_id, organization_id, code, name, default_role_id)
        VALUES ($1, $2, 'TEST', 'Synthetic department', $3)`, [ids.department, ids.organization, ids.ownerRole]);
      await client.query(`INSERT INTO department_membership
        (membership_id, department_id, is_primary)
        VALUES ($1, $2, true), ($3, $2, true)`,
      [ids.ownerMembership, ids.department, ids.managerMembership]);
      // Managed audiences also need the bounded legacy role projection until schema contraction.
      await client.query(`INSERT INTO role (role_id, organization_id, code, name)
        VALUES ($1, $2, 'ALL_MEMBERS', 'Everyone in organization')`,
      [ids.organizationAudience, ids.organization]);
      await client.query(`INSERT INTO audience
        (audience_id, organization_id, kind, name, department_id, is_managed, legacy_role_id)
        VALUES ($1, $2, 'DEPARTMENT_ALL', 'Synthetic department', $3, true, $1)`,
      [ids.ownerRole, ids.organization, ids.department]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PUBLISHED_CONTENT_VIEW'`,
      [ids.organizationAudience]);
      await client.query(`INSERT INTO audience
        (audience_id, organization_id, kind, name, is_managed, legacy_role_id)
        VALUES ($1, $2, 'ORGANIZATION_ALL', 'Everyone in organization', true, $1)`,
      [ids.organizationAudience, ids.organization]);
      await client.query(`INSERT INTO access_scope (access_scope_id, organization_id, scope_type) VALUES ($1, $2, 'ORGANIZATION')`, [ids.organizationScope, ids.organization]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id) VALUES ($1, $2, $3), ($4, $5, $3)`, [ids.ownerMembership, ids.ownerRole, ids.organizationScope, ids.managerMembership, ids.managerRole]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, role_id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.ownerMembership, ids.organizationScope]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE', 'PUBLISHED_CONTENT_VIEW')`, [ids.ownerRole]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PRIVATE_WORKSPACE_READ'`, [ids.managerRole]);
      // Canonical audience with the bounded role projection required by legacy snapshot FKs.
      // A post-0017 fixture cannot rely on the migration's one-time role backfill.
      await client.query(`INSERT INTO role(role_id, organization_id, code, name)
        VALUES ($1, $2, $3, 'Synthetic readers')`,
      [ids.readerAudience, ids.organization, `AUDIENCE_${ids.readerAudience.replaceAll("-", "").toUpperCase()}`]);
      await client.query(`INSERT INTO role_permission(role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PUBLISHED_CONTENT_VIEW'`, [ids.readerAudience]);
      await client.query(`INSERT INTO audience(audience_id, organization_id, kind, name, is_managed,
        created_by_membership_id, legacy_role_id) VALUES ($1, $2, 'GROUP', 'Synthetic readers', false, $3, $1)`,
      [ids.readerAudience, ids.organization, ids.ownerMembership]);
      await client.query(`INSERT INTO audience_group_membership(audience_id, organization_id, membership_id,
        assigned_by_membership_id) VALUES ($1, $2, $3, $3)`,
      [ids.readerAudience, ids.organization, ids.ownerMembership]);
      await client.query(`INSERT INTO role_assignment(membership_id, role_id, access_scope_id) VALUES ($1, $2, $3)`,
        [ids.ownerMembership, ids.readerAudience, ids.organizationScope]);
      // Identifiers/password are generated UUIDs, never caller input. This role
      // belongs only to this already verified disposable test target.
      await client.query(`CREATE ROLE ${indexLogin} LOGIN PASSWORD '${indexPassword}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
      await client.query(`GRANT arden_indexer TO ${indexLogin}`);
      await client.query(`CREATE ROLE ${notificationLogin} LOGIN PASSWORD '${notificationPassword}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
      await client.query(`GRANT arden_notification_worker TO ${notificationLogin}`);
      await client.query("COMMIT");
      fixtureReady = true;
      const workerUrl = new URL(databaseUrl!);
      workerUrl.username = indexLogin;
      workerUrl.password = indexPassword;
      indexPool = new Pool({ connectionString: workerUrl.href, max: 2, connectionTimeoutMillis: 5000 });
      const notificationUrl = new URL(databaseUrl!);
      notificationUrl.username = notificationLogin;
      notificationUrl.password = notificationPassword;
      notificationPool = new Pool({ connectionString: notificationUrl.href, max: 2, connectionTimeoutMillis: 5000 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  // Trigger cleanup locks the same tables as target-readers.integration.test.ts.
  // The API Vitest config keeps these files from running together on one database.
  afterAll(async () => {
    if (!pool) return;
    try {
      await indexPool?.end();
      await notificationPool?.end();
      if (fixtureReady) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL search_path TO arden, public");
          await client.query("ALTER TABLE audit_event DISABLE TRIGGER USER");
          await client.query("ALTER TABLE draft_version DISABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_draft_version DISABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_submission DISABLE TRIGGER USER");
          await client.query("ALTER TABLE review_decision DISABLE TRIGGER USER");
          await client.query("ALTER TABLE published_knowledge_version DISABLE TRIGGER USER");
          await client.query("ALTER TABLE knowledge_current_publication DISABLE TRIGGER USER");
          await client.query("ALTER TABLE reader_selection DISABLE TRIGGER USER");
          await client.query("ALTER TABLE selected_reader DISABLE TRIGGER USER");
          await client.query("DELETE FROM audit_event WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_collection_document WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_collection WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_current_publication WHERE organization_id = $1", [ids.organization]);
          await client.query(`DELETE FROM published_knowledge_version
            WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)`, [ids.organization]);
          await client.query(`DELETE FROM knowledge_index_job WHERE generation_id IN
            (SELECT generation_id FROM knowledge_index_generation WHERE organization_id = $1)`, [ids.organization]);
          await client.query("DELETE FROM knowledge_index_generation WHERE organization_id = $1", [ids.organization]);
          await client.query(`DELETE FROM review_decision
            WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)`, [ids.organization]);
          await client.query("DELETE FROM shared_submission WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_base WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM reviewer_grant WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id IN (SELECT shared_draft_id FROM shared_draft WHERE author_membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM shared_draft WHERE author_membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM selected_reader WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM reader_selection WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM private_item_share WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM organization_direct_share_setting WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM draft_version WHERE draft_id IN (SELECT d.draft_id FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id WHERE w.membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM draft_document WHERE workspace_id IN (SELECT workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM private_collection WHERE workspace_id IN (SELECT workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM private_workspace WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM audience_group_membership WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM audience WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])",
            [[ids.ownerMembership, ids.managerMembership, ...readerFixtures.map((reader) => reader.membershipId)]]);
          await client.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM role_permission WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole, ids.readerAudience, ids.organizationAudience, ids.secondDepartmentRole]]);
          await client.query("DELETE FROM organization_membership WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership, ids.organizationReviewerMembership, ...readerFixtures.map((reader) => reader.membershipId)]]);
          await client.query("DELETE FROM department WHERE department_id = ANY($1::uuid[])", [[ids.department, ids.secondDepartment]]);
          await client.query("DELETE FROM role WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole, ids.readerAudience, ids.organizationAudience, ids.secondDepartmentRole]]);
          await client.query("DELETE FROM access_scope WHERE access_scope_id = $1", [ids.organizationScope]);
          await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])",
            [[ids.owner, ids.manager, ids.organizationReviewer, ...readerFixtures.map((reader) => reader.userId)]]);
          await client.query("DELETE FROM organization WHERE organization_id = $1", [ids.organization]);
          await client.query(`DROP ROLE ${indexLogin}`);
          await client.query(`DROP ROLE ${notificationLogin}`);
          await client.query("ALTER TABLE draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_submission ENABLE TRIGGER USER");
          await client.query("ALTER TABLE review_decision ENABLE TRIGGER USER");
          await client.query("ALTER TABLE published_knowledge_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE knowledge_current_publication ENABLE TRIGGER USER");
          await client.query("ALTER TABLE audit_event ENABLE TRIGGER USER");
          await client.query("ALTER TABLE reader_selection ENABLE TRIGGER USER");
          await client.query("ALTER TABLE selected_reader ENABLE TRIGGER USER");
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
  }, 30_000);

  it("uses a non-superuser worker login without API private-content access", async () => {
    if (!indexPool) throw new Error("Worker fixture is unavailable");
    const identity = await indexPool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(identity.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    await expect(indexPool.query("SELECT * FROM arden.draft_document LIMIT 1")).rejects.toMatchObject({ code: "42501" });
    await expect(new PgIndexGenerationStore(indexPool).claim(randomUUID(), 300)).resolves.toBeNull();
  });

  it("isolates notification outbox access to its dedicated non-bypass worker login", async () => {
    if (!notificationPool || !pool) throw new Error("Notification worker fixture is unavailable");
    const identity = await notificationPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(identity.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    await expect(notificationPool.query("SELECT 1 FROM arden.arden_notification_outbox LIMIT 0"))
      .rejects.toMatchObject({ code: "42501" });

    const workerClient = await notificationPool.connect();
    try {
      await workerClient.query("BEGIN");
      await workerClient.query("SET LOCAL ROLE arden_notification_worker");
      await expect(workerClient.query("SELECT 1 FROM arden.arden_notification_outbox LIMIT 0")).resolves.toBeTruthy();
      await expect(workerClient.query(`SELECT notification_id, organization_id, recipient_membership_id
        FROM arden.arden_notification LIMIT 0`)).resolves.toBeTruthy();
      await workerClient.query("SAVEPOINT deny_share_metadata_read");
      await expect(workerClient.query(`SELECT publication_title, shared_by_name
        FROM arden.arden_notification LIMIT 0`)).rejects.toMatchObject({ code: "42501" });
      await workerClient.query("ROLLBACK TO SAVEPOINT deny_share_metadata_read");
      await workerClient.query("SAVEPOINT deny_private_content_read");
      await expect(workerClient.query("SELECT 1 FROM arden.shared_submission LIMIT 0"))
        .rejects.toMatchObject({ code: "42501" });
      await workerClient.query("ROLLBACK TO SAVEPOINT deny_private_content_read");
      await workerClient.query("SAVEPOINT deny_outbox_identity_update");
      await expect(workerClient.query("UPDATE arden.arden_notification_outbox SET organization_id = $1 WHERE false",
        [ids.organization])).rejects.toMatchObject({ code: "42501" });
      await workerClient.query("ROLLBACK TO SAVEPOINT deny_outbox_identity_update");
    } finally {
      await workerClient.query("ROLLBACK").catch(() => undefined);
      workerClient.release();
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await expect(client.query("SELECT 1 FROM arden.arden_notification_outbox LIMIT 0"))
        .rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces owner-only drafts, member creation, conflicts, and audit records through RLS", async () => {
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
    await expect(repository.getDraft(ids.owner, ids.organization, created.id, { forQuestion: true })).resolves.toMatchObject({ currentVersion: 1 });
    await expect(repository.getDraft(ids.owner, randomUUID(), created.id, { forQuestion: true })).resolves.toBeNull();
    await expect(repository.getDraft(ids.manager, ids.organization, created.id, { forQuestion: true })).resolves.toBeNull();
    await expect(repository.listDrafts(ids.manager, ids.organization, 10, null)).resolves.toMatchObject({ items: [] });
    // Decision0010 makes private-workspace creation an active Member capability.
    // It never gives the Member access to somebody else's private originals.
    await expect(repository.canCreateDraft(ids.manager, ids.organization)).resolves.toBe(true);
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
    // Decision 0035: creating and saving a private note are routine owner-only actions and are not audited.
    const audit = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.audit_event WHERE organization_id = $1 AND event_type LIKE 'PRIVATE_DRAFT_%'`, [ids.organization]);
    expect(audit.rows[0]?.count).toBe("0");
    const connectionContext = await pool.query<{ role_name: string; actor_id: string | null }>(`SELECT current_user AS role_name, current_setting('arden.actor_id', true) AS actor_id`);
    expect(connectionContext.rows[0]?.role_name).not.toBe("arden_runtime");
    expect([null, ""]).toContain(connectionContext.rows[0]?.actor_id);
    const managerPrivate = await repository.createDraft(ids.manager, ids.organization, { title: "Manager private", body: "Separate" }, {
      sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: "d".repeat(64),
    }, "integration-manager-private");
    expect(managerPrivate).not.toBeNull();
    if (managerPrivate) {
      await expect(repository.getDraft(ids.manager, ids.organization, managerPrivate.id)).resolves.toMatchObject({ title: "Manager private" });
      await expect(repository.getDraft(ids.owner, ids.organization, managerPrivate.id)).resolves.toBeNull();
    }
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
    const firstVersion = await repository.listKnowledgeDraftVersions(ids.owner, ids.organization, created.draft.id);
    expect(firstVersion).toMatchObject([{ id: created.draft.versionId, version: 1 }]);
    await expect(repository.listKnowledgeDraftVersions(ids.manager, ids.organization, created.draft.id)).resolves.toBeNull();
    await expect(repository.getKnowledgeDraftVersion(ids.manager, ids.organization,
      created.draft.id, created.draft.versionId)).resolves.toBeNull();
    const revisedDraft = await repository.updateKnowledgeDraft(ids.owner, ids.organization,
      created.draft.id, 1, { title: "Revised review notes" }, null, "integration-version-history-update");
    expect(revisedDraft.kind).toBe("updated");
    const versions = await repository.listKnowledgeDraftVersions(ids.owner, ids.organization, created.draft.id);
    expect(versions?.map((version) => version.version)).toEqual([2, 1]);
    expect(await repository.getKnowledgeDraftVersion(ids.owner, ids.organization,
      created.draft.id, created.draft.versionId)).toMatchObject({ version: 1, contentHash: created.draft.contentHash });
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
      expect.objectContaining({ id: ids.ownerMembership, isOrganizationAdmin: true }),
      expect.objectContaining({ id: ids.managerMembership, name: "Synthetic Manager", isOrganizationAdmin: false, roleNames: expect.arrayContaining(["Department Administrator"]) }),
    ]));
    await expect(repository.getOrganizationAdministration(ids.manager, ids.organization)).resolves.toBeNull();
    await expect(repository.getOrganizationAdministration(ids.owner, randomUUID())).resolves.toBeNull();

    const grant = await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.managerMembership,
      scope: "DEPARTMENT",
      departmentId: ids.department,
      classifications: ["INTERNAL"],
      level: "STANDARD",
      teamTag: null,
      projectTag: null,
      validUntil: null,
    }, "integration-reviewer-grant");
    expect(grant).toMatchObject({ reviewerMembershipId: ids.managerMembership, status: "ACTIVE" });
    const grantInput = {
      reviewerMembershipId: ids.managerMembership, scope: "DEPARTMENT" as const,
      departmentId: ids.department, classifications: ["INTERNAL" as const],
      level: "STANDARD" as const, teamTag: null, projectTag: null, validUntil: null,
    };
    await expect(repository.createReviewerGrant(ids.owner, ids.organization, grantInput,
      "integration-duplicate-grant")).rejects.toBeInstanceOf(ReviewerGrantConflictError);
    const tagged = { ...grantInput, teamTag: "operations" };
    const concurrent = await Promise.allSettled([
      repository.createReviewerGrant(ids.owner, ids.organization, tagged, "integration-tagged-grant-a"),
      repository.createReviewerGrant(ids.owner, ids.organization, tagged, "integration-tagged-grant-b"),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected" && result.reason instanceof ReviewerGrantConflictError)).toHaveLength(1);

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

  it("rejects adding an active member without a primary department to a reader group", async () => {
    if (!repository) throw new Error("Test database is unavailable");
    await expect(repository.audienceGroups.addMember(ids.owner, ids.organization, ids.readerAudience,
      ids.organizationReviewerMembership, "unassigned-reader-group-test"))
      .rejects.toMatchObject({ code: "AUDIENCE_GROUP_UNAVAILABLE" });
    const groups = await repository.audienceGroups.list(ids.owner, ids.organization);
    expect(groups.find(group => group.id === ids.readerAudience)?.members
      .some(member => member.membershipId === ids.organizationReviewerMembership && member.status === "ACTIVE"))
      .toBe(false);
  });

  it("keeps organization and department reviewer scopes disjoint and exposes grant availability", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");

    await expect(repository.getKnowledgeOptions(ids.owner, ids.organization))
      .resolves.toMatchObject({ organizationReviewerAvailable: false });
    // Reviews is offered to Organization Admins and to members with an active reviewer grant only.
    const canReview = async (userId: string) => (await repository.listMemberships(userId))
      .find((membership) => membership.organizationId === ids.organization)?.canReview;
    await expect(canReview(ids.owner)).resolves.toBe(true);
    await expect(canReview(ids.organizationReviewer)).resolves.toBe(false);

    const grant = await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.organizationReviewerMembership,
      scope: "ORGANIZATION",
      departmentId: null,
      classifications: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
      teamTag: null,
      projectTag: null,
      validUntil: null,
    }, "integration-organization-reviewer-grant");
    expect(grant).toMatchObject({
      scope: "ORGANIZATION",
      departmentId: null,
      level: "STANDARD",
      status: "ACTIVE",
    });
    if (!grant) throw new Error("Reviewer grant was not created");
    await expect(canReview(ids.organizationReviewer)).resolves.toBe(true);
    if (!pool || !notificationPool || !repository.notifications) throw new Error("Notification store or worker is unavailable");
    const grantNotification = await pool.query<{ notification_id: string; event_type: string }>(`
      SELECT notification_id, event_type FROM arden.arden_notification
      WHERE organization_id = $1 AND recipient_membership_id = $2 AND resource_id = $3
        AND event_type = 'REVIEWER_GRANT_CREATED'`, [ids.organization, ids.organizationReviewerMembership, grant.id]);
    expect(grantNotification.rows).toHaveLength(1);

    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query("SET LOCAL ROLE arden_runtime");
      await rollbackClient.query("SET LOCAL search_path TO arden, public");
      await rollbackClient.query(`SELECT set_config('arden.actor_id', $1, true),
        set_config('arden.organization_id', $2, true), set_config('arden.org_admin', 'true', true)`,
      [ids.owner, ids.organization]);
      await rollbackClient.query("UPDATE reviewer_grant SET status = 'INACTIVE' WHERE reviewer_grant_id = $1", [grant.id]);
      await rollbackClient.query("RESET ROLE");
      const rolledBackEvent = await rollbackClient.query<{ count: string }>(`SELECT count(*)::text AS count
        FROM arden.arden_notification WHERE recipient_membership_id = $1 AND resource_id = $2
          AND event_type = 'REVIEWER_GRANT_REVOKED'`, [ids.organizationReviewerMembership, grant.id]);
      expect(rolledBackEvent.rows[0]?.count).toBe("1");
      await rollbackClient.query("ROLLBACK");
    } finally {
      await rollbackClient.query("ROLLBACK").catch(() => undefined);
      rollbackClient.release();
    }
    const committedRevocations = await pool.query<{ count: string }>(`SELECT count(*)::text AS count
      FROM arden.arden_notification WHERE recipient_membership_id = $1 AND resource_id = $2
        AND event_type = 'REVIEWER_GRANT_REVOKED'`, [ids.organizationReviewerMembership, grant.id]);
    expect(committedRevocations.rows[0]?.count).toBe("0");

    const targetNotificationId = grantNotification.rows[0]!.notification_id;
    const deliveredIds: string[] = [];
    let deliveryAttempts = 0;
    const worker = new NotificationOutboxWorker(randomUUID(), notificationPool, {
      endpoint: "https://realtime.example.test/realtime/v1", apiKey: "publishable-key-value",
      signingKey: new TextEncoder().encode("ab".repeat(32)), namespace: "test-slot",
    }, { info: () => undefined, warn: () => undefined, error: () => undefined }, async (_configuration, event) => {
      if (event.notificationId !== targetNotificationId) return;
      deliveredIds.push(event.notificationId);
      if (deliveryAttempts++ === 0) throw new Error("REALTIME_HTTP_503");
    });
    await pool.query(`UPDATE arden.arden_notification_outbox
      SET status = 'SENT', delivered_at = now()
      WHERE organization_id = $1 AND notification_id <> $2 AND status = 'PENDING'`,
    [ids.organization, targetNotificationId]);
    await pool.query(`UPDATE arden.arden_notification_outbox SET available_at = '-infinity'::timestamptz
      WHERE notification_id = $1 AND status = 'PENDING'`, [targetNotificationId]);
    await expect(worker.runOnce()).resolves.toBe(true);
    const retrying = await pool.query<{ status: string; attempt_count: number; last_error_code: string }>(`
      SELECT status, attempt_count, last_error_code FROM arden.arden_notification_outbox
       WHERE notification_id = $1`, [targetNotificationId]);
    expect(retrying.rows[0]).toMatchObject({ status: "PENDING", attempt_count: 1, last_error_code: "REALTIME_HTTP_503" });
    await pool.query(`UPDATE arden.arden_notification_outbox SET available_at = '-infinity'::timestamptz
      WHERE notification_id = $1`, [targetNotificationId]);
    await expect(worker.runOnce()).resolves.toBe(true);
    const delivered = await pool.query<{ status: string; attempt_count: number }>(`
      SELECT status, attempt_count FROM arden.arden_notification_outbox WHERE notification_id = $1`,
    [targetNotificationId]);
    expect(delivered.rows[0]).toEqual({ status: "SENT", attempt_count: 2 });
    expect(deliveredIds).toEqual([targetNotificationId, targetNotificationId]);

    await pool.query(`UPDATE arden.arden_notification_outbox
      SET status = 'PENDING', attempt_count = 7, available_at = now(), delivered_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
      WHERE notification_id = $1`, [targetNotificationId]);
    await pool.query(`UPDATE arden.arden_notification_outbox SET available_at = '-infinity'::timestamptz
      WHERE notification_id = $1`, [targetNotificationId]);
    const exhausted = new NotificationOutboxWorker(randomUUID(), notificationPool, {
      endpoint: "https://realtime.example.test/realtime/v1", apiKey: "publishable-key-value",
      signingKey: new TextEncoder().encode("ab".repeat(32)), namespace: "test-slot",
    }, { info: () => undefined, warn: () => undefined, error: () => undefined }, async () => {
      throw new Error("REALTIME_HTTP_503");
    });
    await expect(exhausted.runOnce()).resolves.toBe(true);
    const failed = await pool.query<{ status: string; attempt_count: number; last_error_code: string }>(`
      SELECT status, attempt_count, last_error_code FROM arden.arden_notification_outbox
       WHERE notification_id = $1`, [targetNotificationId]);
    expect(failed.rows[0]).toEqual({ status: "FAILED", attempt_count: 8, last_error_code: "REALTIME_HTTP_503" });

    const reviewerInbox = await repository.notifications.list(ids.organizationReviewer, ids.organization, {
      cursor: null, unreadOnly: false, limit: 50, visibleReviewIds: [],
    });
    expect(reviewerInbox?.items).toContainEqual(expect.objectContaining({ type: "REVIEWER_GRANT_CREATED",
      resourceId: grant.id, readAt: null }));
    const ownerInbox = await repository.notifications.list(ids.owner, ids.organization, {
      cursor: null, unreadOnly: false, limit: 50, visibleReviewIds: [],
    });
    expect(ownerInbox?.items).not.toContainEqual(expect.objectContaining({ resourceId: grant.id }));
    await expect(repository.notifications.list(ids.owner, randomUUID(), {
      cursor: null, unreadOnly: false, limit: 50, visibleReviewIds: [],
    })).resolves.toBeNull();
    await expect(repository.getKnowledgeOptions(ids.owner, ids.organization))
      .resolves.toMatchObject({ organizationReviewerAvailable: true });

    const submit = async (title: string, audienceId: string) => {
      const created = await repository.createNewKnowledgeDraft(ids.owner, ids.organization, {
        actorMembershipId: ids.ownerMembership,
        title,
        classification: "INTERNAL",
        idempotencyKey: randomUUID(),
        content: {
          sourceUri: `arden-private-object://${randomUUID()}`,
          mimeType: "text/plain",
          contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        },
        requestId: `integration-${title}-create`,
      });
      expect(created.kind).toBe("created");
      if (created.kind !== "created") throw new Error("Knowledge draft was not created");
      await prepareKnowledgeFixture(pool, ids.organization, created.draft.id, [ids.ownerMembership, ids.organizationReviewerMembership]);
      const configured = await repository.updateKnowledgeDraft(ids.owner, ids.organization,
        created.draft.id, created.draft.currentVersion, {
          responsibleDepartmentId: ids.department,
          targetScopeType: "ORGANIZATION",
          audienceRoleIds: [audienceId],
        }, null, `integration-${title}-configure`);
      expect(configured.kind).toBe("updated");
      if (configured.kind !== "updated") throw new Error("Knowledge draft was not configured");
      const submitted = await repository.submitKnowledgeDraft(ids.owner, ids.organization,
        created.draft.id, configured.draft.currentVersion, randomUUID(),
        `integration-${title}-submit`);
      expect(submitted.kind).toBe("submitted");
      if (submitted.kind !== "submitted") throw new Error("Knowledge draft was not submitted");
      return submitted.submission;
    };

    const limited = await submit("limited-scope", ids.readerAudience);
    const organizationWide = await submit("organization-scope", ids.organizationAudience);
    const reviewResourceIds = await repository.notifications.listReviewRequestResourceIds(
      ids.organizationReviewer, ids.organization, false);
    expect(reviewResourceIds).not.toBeNull();
    expect(reviewResourceIds).toContain(organizationWide.id);
    expect(reviewResourceIds).not.toContain(limited.id);
    const targetedReviewCandidates = [...Array.from({ length: 100 }, () => randomUUID()), ...(reviewResourceIds ?? [])];
    const notificationReviews = await repository.listAssignedReviewsForSubmissions(
      ids.organizationReviewer, ids.organization, targetedReviewCandidates);
    expect(notificationReviews?.map(item => item.submissionId)).toContain(organizationWide.id);
    expect(notificationReviews?.map(item => item.submissionId)).not.toContain(limited.id);
    const assigned = await repository.listAssignedReviews(ids.organizationReviewer,
      ids.organization);
    expect(assigned).not.toBeNull();
    const assignedIds = assigned?.map(item => item.submissionId) ?? [];
    expect(assignedIds).toContain(organizationWide.id);
    expect(assignedIds).not.toContain(limited.id);
    await expect(repository.decideReview(ids.organizationReviewer, ids.organization, limited.id,
      "REJECT", limited.snapshotVersionId, limited.contentHash, "Wrong reviewer scope",
      randomUUID(), "integration-organization-reviewer-limited-denied"))
      .resolves.toEqual({ kind: "denied", reason: "NOT_AUTHORIZED" });
    await expect(pool.query(
      "SELECT status FROM arden.shared_submission WHERE submission_id = $1", [limited.id]))
      .resolves.toMatchObject({ rows: [{ status: "PENDING_REVIEW" }] });
    await expect(pool.query(
      "SELECT count(*)::text AS count FROM arden.review_decision WHERE submission_id = $1", [limited.id]))
      .resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(repository.decideReview(ids.organizationReviewer, ids.organization,
      organizationWide.id, "REJECT", organizationWide.snapshotVersionId,
      organizationWide.contentHash, "Organization review completed", randomUUID(),
      "integration-organization-reviewer-decide"))
      .resolves.toMatchObject({ kind: "decided", submission: { status: "REJECTED" } });

    const newRules = await pool.query<{ submission_id: string; review_rule: string }>(`
      SELECT submission_id, review_rule FROM arden.shared_submission
       WHERE submission_id = ANY($1::uuid[]) ORDER BY submission_id`,
    [[limited.id, organizationWide.id]]);
    expect(newRules.rows).toEqual(expect.arrayContaining([
      { submission_id: limited.id, review_rule: "GRANT_SCOPE" },
      { submission_id: organizationWide.id, review_rule: "GRANT_SCOPE" },
    ]));

    const legacy = await submit("legacy-organization-scope", ids.organizationAudience);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("ALTER TABLE shared_submission DISABLE TRIGGER trg_protect_flow2_submission_snapshot");
      await client.query("UPDATE shared_submission SET review_rule = 'LEGACY' WHERE submission_id = $1",
        [legacy.id]);
      await client.query("ALTER TABLE shared_submission ENABLE TRIGGER trg_protect_flow2_submission_snapshot");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const specialist = await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.managerMembership,
      scope: "DEPARTMENT",
      departmentId: ids.department,
      classifications: ["INTERNAL"],
      level: "SPECIALIST",
      teamTag: null,
      projectTag: null,
      validUntil: null,
    }, "integration-legacy-specialist-grant");
    expect(specialist).toMatchObject({ scope: "DEPARTMENT", level: "SPECIALIST" });
    const legacyQueue = await repository.listAssignedReviews(ids.manager, ids.organization);
    expect(legacyQueue).not.toBeNull();
    expect(legacyQueue?.map(item => item.submissionId) ?? []).toContain(legacy.id);
    const olderOwnedSubmissions = [...Array.from({ length: 100 }, () => randomUUID()), legacy.id];
    await expect(repository.listOwnedKnowledgeSubmissionIds(ids.owner, ids.organization, olderOwnedSubmissions))
      .resolves.toContain(legacy.id);
    await expect(repository.listOwnedKnowledgeSubmissionIds(ids.manager, ids.organization, [legacy.id]))
      .resolves.toEqual([]);
    await expect(pool.query<{ review_rule: string }>(
      "SELECT review_rule FROM arden.shared_submission WHERE submission_id = $1", [legacy.id]))
      .resolves.toMatchObject({ rows: [{ review_rule: "LEGACY" }] });
  });

  it("durably enqueues and atomically activates a different member's approved snapshot", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");

    const contentHash = "c".repeat(64);
    const created = await repository.createNewKnowledgeDraft(ids.owner, ids.organization, {
      actorMembershipId: ids.ownerMembership,
      title: "Cross-actor publication regression",
      classification: "INTERNAL",
      idempotencyKey: randomUUID(),
      content: {
        sourceUri: `arden-private-object://${randomUUID()}`,
        mimeType: "text/plain",
        contentHash,
      },
      requestId: "integration-flow2-create",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const configured = await repository.updateKnowledgeDraft(ids.owner, ids.organization, created.draft.id, 1, {
      // Legacy audience/reviewer fixture, upgraded with explicit reader metadata.
      responsibleDepartmentId: ids.department,
      targetScopeType: "ORGANIZATION",
      audienceRoleIds: [ids.readerAudience],
    }, null, "integration-flow2-configure");
    expect(configured).toMatchObject({ kind: "updated", draft: { currentVersion: 2 } });
    if (configured.kind !== "updated") return;

    await prepareKnowledgeFixture(pool, ids.organization, created.draft.id, [ids.ownerMembership, ids.organizationReviewerMembership]);

    const submitted = await repository.submitKnowledgeDraft(ids.owner, ids.organization,
      created.draft.id, configured.draft.currentVersion, randomUUID(), "integration-flow2-submit");
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    const grantInput = {
      reviewerMembershipId: ids.managerMembership,
      scope: "DEPARTMENT" as const,
      departmentId: ids.department,
      classifications: ["INTERNAL" as const],
      level: "STANDARD" as const,
      teamTag: null,
      projectTag: null,
      validUntil: null,
    };
    const existingGrant = (await repository.listReviewerGrants(ids.owner, ids.organization))?.find((item) =>
      item.reviewerMembershipId === ids.managerMembership && item.scope === "DEPARTMENT"
      && item.departmentId === ids.department && item.level === "STANDARD" && item.status === "ACTIVE"
      && item.teamTag === null && item.projectTag === null && item.validUntil === null
      && item.classifications.length === 1 && item.classifications[0] === "INTERNAL");
    const grant = existingGrant ?? await repository.createReviewerGrant(ids.owner, ids.organization,
      grantInput, "integration-flow2-reviewer-grant");
    expect(grant).not.toBeNull();

    const assigned = await repository.listAssignedReviews(ids.manager, ids.organization);
    expect(assigned).toEqual(expect.arrayContaining([
      expect.objectContaining({ submissionId: submitted.submission.id, snapshotId: submitted.submission.snapshotVersionId }),
    ]));

    const decisionKey = randomUUID();
    const decided = await repository.decideReview(ids.manager, ids.organization, submitted.submission.id,
      "APPROVE", submitted.submission.snapshotVersionId, submitted.submission.contentHash,
      null, decisionKey, "integration-flow2-approve");
    expect(decided).toMatchObject({
      kind: "decided",
      submission: { status: "APPROVED", publicationState: "PREPARING", publishedVersionId: null },
    });

    const beforeActivation = await repository.listPublishedKnowledge(ids.owner, ids.organization);
    expect(beforeActivation).toEqual([]);
    const workerId = randomUUID();
    if (!indexPool) throw new Error("Worker fixture is unavailable");
    const generationStore = new PgIndexGenerationStore(indexPool);
    const job = await generationStore.claim(workerId, 90);
    expect(job).toMatchObject({
      organizationId: ids.organization,
      submissionId: submitted.submission.id,
      snapshotVersionId: submitted.submission.snapshotVersionId,
      snapshotContentHash: contentHash,
      attemptCount: 1,
    });
    if (!job) return;
    const manifest: IndexGenerationManifest = {
      contractVersion: 1,
      jobId: job.jobId,
      generationId: job.generationId,
      snapshotVersionId: job.snapshotVersionId,
      snapshotContentHash: job.snapshotContentHash,
      compilerVersion: "semantic-markdown-v1",
      chunkingVersion: "langchain-section-token-v1",
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 1536,
      markdownContentHash: "d".repeat(64),
      chunksDigest: "e".repeat(64),
      chunks: [{ chunkId: "f".repeat(64), ordinal: 0, contentHash: "1".repeat(64),
        startOffset: 0, endOffset: 10, sourceBlockIds: ["body"], parentSectionBlockId: null }],
    };
    await expect(generationStore.complete(job, workerId, manifest)).resolves.toMatch(/^[0-9a-f-]{36}$/);

    await expect(repository.decideReview(ids.manager, ids.organization, submitted.submission.id,
      "APPROVE", submitted.submission.snapshotVersionId, submitted.submission.contentHash,
      null, decisionKey, "integration-flow2-approve-replay"))
      .resolves.toMatchObject({ kind: "replayed", submission: { status: "APPROVED" } });

    const published = await repository.listPublishedKnowledge(ids.owner, ids.organization);
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        draftId: created.draft.id,
        title: "Cross-actor publication regression",
        contentHash,
      }),
    ]));
    await expect(repository.listPublishedKnowledge(ids.manager, ids.organization)).resolves.toEqual([]);

    const evidence = await pool.query<{ event_type: string; count: string }>(`
      SELECT a.event_type, count(*)::text AS count FROM arden.audit_event a
      JOIN arden.review_decision rd ON rd.review_decision_id = a.review_decision_id
       WHERE a.organization_id = $1 AND rd.submission_id = $2
         AND a.event_type IN ('KNOWLEDGE_REVIEW_DECIDED', 'KNOWLEDGE_INDEX_ACTIVATED')
       GROUP BY a.event_type ORDER BY a.event_type`, [ids.organization, submitted.submission.id]);
    expect(evidence.rows).toEqual([
      { event_type: "KNOWLEDGE_INDEX_ACTIVATED", count: "1" },
      { event_type: "KNOWLEDGE_REVIEW_DECIDED", count: "1" },
    ]);

    const revised = await repository.updateKnowledgeDraft(ids.owner, ids.organization,
      created.draft.id, configured.draft.currentVersion, { title: "Replacement candidate",
        management: { type: "Guide", version: "2.0", expirationDate: null, changeNote: "Updated guidance." } }, null,
      "integration-flow3-revise");
    expect(revised).toMatchObject({ kind: "updated", draft: { currentVersion: 3 } });
    if (revised.kind !== "updated") return;
    const replacement = await repository.submitKnowledgeDraft(ids.owner, ids.organization,
      created.draft.id, revised.draft.currentVersion, randomUUID(), "integration-flow3-resubmit");
    expect(replacement.kind).toBe("submitted");
    if (replacement.kind !== "submitted") return;
    await expect(repository.decideReview(ids.manager, ids.organization, replacement.submission.id,
      "APPROVE", replacement.submission.snapshotVersionId, replacement.submission.contentHash,
      null, randomUUID(), "integration-flow3-reapprove"))
      .resolves.toMatchObject({ kind: "decided", submission: { publicationState: "PREPARING" } });

    const failedJob = await generationStore.claim(workerId, 90);
    expect(failedJob).toMatchObject({ submissionId: replacement.submission.id, attemptCount: 1 });
    if (!failedJob) return;
    await expect(generationStore.fail(failedJob, workerId, "AI_SERVICE_UNAVAILABLE", true))
      .resolves.toBe("PENDING");
    await pool.query("UPDATE arden.knowledge_index_job SET available_at = now() WHERE job_id = $1", [failedJob.jobId]);
    const retry = await generationStore.claim(workerId, 90);
    expect(retry).toMatchObject({ jobId: failedJob.jobId, attemptCount: 2 });
    if (!retry) return;
    await expect(generationStore.fail(retry, workerId, "INVALID_INDEX_MANIFEST", false))
      .resolves.toBe("FAILED");

    const submissions = await repository.listKnowledgeSubmissions(ids.owner, ids.organization);
    expect(submissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: replacement.submission.id, publicationState: "FAILED" }),
    ]));
    const stillPublished = await repository.listPublishedKnowledge(ids.owner, ids.organization);
    expect(stillPublished).toHaveLength(1);
    expect(stillPublished?.[0]).toMatchObject({ title: "Cross-actor publication regression" });

    let draftVersion = revised.draft.currentVersion;
    const candidate = async (title: string) => {
      const update = await repository.updateKnowledgeDraft(ids.owner, ids.organization,
        created.draft.id, draftVersion, { title }, null, "ordering-update");
      if (update.kind !== "updated") throw new Error("Expected candidate edit");
      draftVersion = update.draft.currentVersion;
      const submission = await repository.submitKnowledgeDraft(ids.owner, ids.organization,
        created.draft.id, draftVersion, randomUUID(), "ordering-submit");
      if (submission.kind !== "submitted") throw new Error("Expected candidate submission");
      const decision = await repository.decideReview(ids.manager, ids.organization, submission.submission.id,
        "APPROVE", submission.submission.snapshotVersionId, submission.submission.contentHash,
        null, randomUUID(), "ordering-approve");
      expect(decision.kind).toBe("decided");
      const claimed = await generationStore.claim(workerId, 300);
      if (!claimed || claimed.submissionId !== submission.submission.id) throw new Error("Expected exact candidate job");
      return claimed;
    };
    const older = await candidate("Older approved candidate");
    const newer = await candidate("Newest active publication");
    const completedManifest = (job: typeof older): IndexGenerationManifest => ({ ...manifest,
      jobId: job.jobId, generationId: job.generationId, snapshotVersionId: job.snapshotVersionId,
      snapshotContentHash: job.snapshotContentHash });
    await generationStore.complete(newer, workerId, completedManifest(newer));
    await expect(generationStore.complete(older, workerId, completedManifest(older)))
      .rejects.toMatchObject({ code: "INDEX_GENERATION_SUPERSEDED" });
    await expect(generationStore.fail(older, workerId, "INDEX_GENERATION_SUPERSEDED", false)).resolves.toBe("FAILED");
    const completedSubmissions = await repository.listKnowledgeSubmissions(ids.owner, ids.organization);
    expect(completedSubmissions?.find((item) => item.id === older.submissionId)?.publicationState)
      .toBe("SUPERSEDED");
    expect(completedSubmissions?.filter((item) => item.publicationState === "ACTIVE").map((item) => item.id))
      .toEqual([newer.submissionId]);
    const legacyAccess = await pool.query("SELECT has_function_privilege('arden_indexer', 'arden.complete_knowledge_index_job_unordered_v1(uuid, uuid, jsonb)', 'EXECUTE') AS allowed");
    expect(legacyAccess.rows).toEqual([{ allowed: false }]);
    await expect(repository.listPublishedKnowledge(ids.owner, ids.organization)).resolves.toEqual([
      expect.objectContaining({ title: "Newest active publication" }),
    ]);
    const sources = await repository.listAuthorizedAiSources(ids.owner, ids.organization, [newer.generationId], [manifest.chunks[0].chunkId]);
    expect(sources).toEqual([expect.objectContaining({ generationId: newer.generationId, chunks: manifest.chunks })]);
    await expect(repository.listAuthorizedAiSources(ids.owner, ids.organization, [older.generationId])).resolves.toEqual([]);

    // The upgraded current workflow preserves the explicit approved readers.
    const ownerActor = await repository.getTargetReaderActor(ids.owner, ids.organization);
    expect(ownerActor).toEqual({ membershipId: ids.ownerMembership, organizationId: ids.organization,
      status: "ACTIVE", departmentIds: [ids.department] });
    const legacy = await repository.listPublishedKnowledge(ids.owner, ids.organization);
    expect(legacy).toEqual([expect.objectContaining({ title: "Newest active publication", targetReaders: expect.objectContaining({ mode: "SELECTED_MEMBERS" }) })]);
    expect(canRead(ownerActor, { organizationId: ids.organization, readers: legacy![0]!.targetReaders })).toBe(true);
  }, 15_000);

  it("approves, narrows and enforces Target Readers through review and activation (T2.1)", async () => {
    if (!repository || !pool || !indexPool) throw new Error("Test database is unavailable");
    const superuser = async <T>(work: (client: import("pg").PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL search_path TO arden, public");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    const sqlState = (work: (client: import("pg").PoolClient) => Promise<unknown>) =>
      superuser(work).then(() => null, (error: { code?: string }) => error.code ?? "unknown");

    // Ten extra readers: r[0..4] in the fixture department, r[5..9] in a second department.
    await superuser(async (client) => {
      await client.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, 'Second department')`,
        [ids.secondDepartmentRole, ids.organization, `ARDEN_TEST_SECOND_${ids.secondDepartmentRole.replaceAll("-", "").toUpperCase()}`]);
      await client.query(`INSERT INTO department (department_id, organization_id, code, name, default_role_id)
        VALUES ($1, $2, 'SECOND', 'Second department', $3)`, [ids.secondDepartment, ids.organization, ids.secondDepartmentRole]);
      for (const [index, reader] of readerFixtures.entries()) {
        await client.query(`INSERT INTO user_account (user_id, email, full_name) VALUES ($1, $2, $3)`,
          [reader.userId, `${reader.userId}@readers.example.test`, `Reader ${index + 1}`]);
        await client.query(`INSERT INTO organization_membership (membership_id, organization_id, user_id) VALUES ($1, $2, $3)`,
          [reader.membershipId, ids.organization, reader.userId]);
        await client.query(`INSERT INTO department_membership (membership_id, department_id, is_primary) VALUES ($1, $2, true)`,
          [reader.membershipId, index < 5 ? ids.department : ids.secondDepartment]);
      }
    });
    const readers = readerFixtures.map((reader) => reader.membershipId);
    // Organization-wide audience: every member passes publication audience RLS, so Target Readers decide.
    expect(await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.organizationReviewerMembership, scope: "ORGANIZATION", departmentId: null,
      classifications: ["INTERNAL"], teamTag: null, projectTag: null, validUntil: null,
    }, "t21-organization-grant")).not.toBeNull();
    expect(await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.managerMembership, scope: "DEPARTMENT", departmentId: ids.department,
      classifications: ["INTERNAL"], level: "SENIOR", teamTag: null, projectTag: null, validUntil: null,
    }, "t21-department-grant")).not.toBeNull();

    const submit = async (title: string, targetReaders: TargetReadersInput | null) => {
      const created = await repository.createNewKnowledgeDraft(ids.owner, ids.organization, {
        actorMembershipId: ids.ownerMembership, title, classification: "INTERNAL", idempotencyKey: randomUUID(),
        content: { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain",
          contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0") }, requestId: `t21-${title}-create`,
      });
      if (created.kind !== "created") throw new Error("Draft was not created");
      await prepareKnowledgeFixture(pool, ids.organization, created.draft.id, [ids.ownerMembership, ids.organizationReviewerMembership], targetReaders !== null);
      const configured = await repository.updateKnowledgeDraft(ids.owner, ids.organization, created.draft.id, 1, {
        responsibleDepartmentId: ids.department, targetScopeType: "ORGANIZATION", audienceRoleIds: [ids.organizationAudience],
        ...(targetReaders ? { targetReaders } : {}),
      }, null, `t21-${title}-configure`);
      if (configured.kind !== "updated") throw new Error(`Draft was not configured: ${configured.kind}`);
      const legacyId = targetReaders === null ? await submitLegacyKnowledgeFixture(pool, ids.organization, created.draft.id) : null;
      const submitted = legacyId ? { kind: "submitted" as const, submission: (await repository.listKnowledgeSubmissions(ids.owner, ids.organization))!.find(item => item.id === legacyId)! }
        : await repository.submitKnowledgeDraft(ids.owner, ids.organization, created.draft.id, 2,
          randomUUID(), `t21-${title}-submit`);
      if (submitted.kind !== "submitted") throw new Error("Draft was not submitted");
      const submission = submitted.submission;
      const requestRecipients = await pool.query<{ recipient_membership_id: string }>(`
        SELECT recipient_membership_id FROM arden.arden_notification
         WHERE organization_id = $1 AND resource_id = $2 AND event_type = 'REVIEW_REQUESTED'`,
      [ids.organization, submission.id]);
      expect(requestRecipients.rows.map(row => row.recipient_membership_id)).toContain(ids.organizationReviewerMembership);
      const legacyDepartmentRequest = requestRecipients.rows.some(row => row.recipient_membership_id === ids.managerMembership);
      expect(legacyDepartmentRequest).toBe(legacyId !== null);
      const decide = (approvedReaders?: TargetReadersInput, key = randomUUID(), action: "APPROVE" | "REJECT" = "APPROVE") =>
        repository.decideReview(ids.organizationReviewer, ids.organization, submission.id, action,
          submission.snapshotVersionId, submission.contentHash, action === "REJECT" ? "Clarify" : null, key,
          `t21-${title}-decide`, approvedReaders);
      return { draftId: created.draft.id, submission, decide };
    };
    const selections = (submissionId: string) => superuser((client) => client.query<{
      proposed_selection_id: string; approved_selection_id: string | null; status: string;
      proposed_mode: string; approved_mode: string | null; approved_department_id: string | null;
      decisions: string; audits: string }>(`
      SELECT s.proposed_selection_id, s.approved_selection_id, s.status,
             p.reader_mode AS proposed_mode, a.reader_mode AS approved_mode, a.department_id AS approved_department_id,
             (SELECT count(*) FROM review_decision rd WHERE rd.submission_id = s.submission_id)::text AS decisions,
             (SELECT count(*) FROM audit_event ae WHERE ae.event_type = 'KNOWLEDGE_REVIEW_DECIDED'
                AND ae.details_json->>'submissionId' = s.submission_id::text)::text AS audits
        FROM shared_submission s
        JOIN reader_selection p ON p.selection_id = s.proposed_selection_id
        LEFT JOIN reader_selection a ON a.selection_id = s.approved_selection_id
       WHERE s.submission_id = $1`, [submissionId]).then((result) => result.rows[0]!));

    // 1. Proposed Department → Organization is widening: nothing is recorded.
    const department = await submit("t21-department", { mode: "DEPARTMENT", departmentId: ids.department });
    await expect(department.decide({ mode: "ORGANIZATION" })).resolves.toEqual({ kind: "denied", reason: "READERS_WIDENED" });
    await expect(selections(department.submission.id)).resolves.toMatchObject({
      status: "PENDING_REVIEW", approved_selection_id: null, decisions: "0", audits: "0" });
    // Department d → members currently in d is narrowing; a member of another department is not.
    await expect(department.decide({ mode: "SELECTED_MEMBERS", memberIds: [readers[0]!, readers[5]!] }))
      .resolves.toEqual({ kind: "denied", reason: "READERS_WIDENED" });

    // 9. The authorized reviewer sees the proposed readers with names; a plain member does not get the review.
    const listed = await submit("t21-listed", { mode: "SELECTED_MEMBERS", memberIds: readers });
    const detail = await repository.getAssignedReview(ids.organizationReviewer, ids.organization, listed.submission.id);
    expect(detail?.proposedReaders).toEqual({ mode: "SELECTED_MEMBERS", department: null,
      members: readers.map((membershipId, index) => ({ membershipId, displayName: `Reader ${index + 1}` })) });
    await expect(repository.getAssignedReview(readerFixtures[0]!.userId, ids.organization, listed.submission.id)).resolves.toBeNull();
    const directory = await superuser(async (client) => {
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
        [readerFixtures[0]!.userId, ids.organization]);
      return (await client.query(`SELECT * FROM submission_proposed_reader_directory($1)`, [listed.submission.id])).rowCount;
    });
    expect(directory).toBe(0);

    // 3. Proposed 10 → 5 of them plus an outsider is widening; 5 of them is narrowing.
    await expect(listed.decide({ mode: "SELECTED_MEMBERS", memberIds: [...readers.slice(0, 5), ids.managerMembership] }))
      .resolves.toEqual({ kind: "denied", reason: "READERS_WIDENED" });
    const narrowKey = randomUUID();
    const narrowedReaders = { mode: "SELECTED_MEMBERS" as const, memberIds: readers.slice(0, 5) };
    await expect(listed.decide(narrowedReaders, narrowKey)).resolves.toMatchObject({ kind: "decided",
      submission: { status: "APPROVED", approvedTargetReaders: { mode: "SELECTED_MEMBERS", memberIds: readers.slice(0, 5) } } });
    // 6. Same key and same readers (any order) replays; different readers conflict.
    await expect(listed.decide({ mode: "SELECTED_MEMBERS", memberIds: [...readers.slice(0, 5)].reverse() }, narrowKey))
      .resolves.toMatchObject({ kind: "replayed" });
    await expect(listed.decide({ mode: "SELECTED_MEMBERS", memberIds: readers.slice(0, 4) }, narrowKey))
      .resolves.toEqual({ kind: "conflict" });
    const narrowedAudit = await superuser((client) => client.query<{ details_json: Record<string, unknown> }>(`
      SELECT details_json FROM audit_event WHERE event_type = 'KNOWLEDGE_REVIEW_DECIDED'
         AND details_json->>'submissionId' = $1`, [listed.submission.id]));
    expect(narrowedAudit.rows[0]?.details_json).toMatchObject({ narrowed: true,
      proposedReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberCount: 10 },
      approvedReaders: { mode: "SELECTED_MEMBERS", departmentId: null, memberCount: 5 } });

    // 2. Proposed Organization → a Department is a new DEPARTMENT row; the proposal is unchanged.
    const organization = await submit("t21-organization", { mode: "ORGANIZATION" });
    await expect(organization.decide({ mode: "DEPARTMENT", departmentId: ids.secondDepartment })).resolves.toMatchObject({ kind: "decided" });
    const organizationRows = await selections(organization.submission.id);
    expect(organizationRows).toMatchObject({ status: "APPROVED", proposed_mode: "ORGANIZATION",
      approved_mode: "DEPARTMENT", approved_department_id: ids.secondDepartment, decisions: "1", audits: "1" });
    expect(organizationRows.approved_selection_id).not.toBe(organizationRows.proposed_selection_id);

    // 4. No readers → A equals P, stored as its own row.
    const asProposed = await submit("t21-as-proposed", { mode: "SELECTED_MEMBERS", memberIds: readers.slice(5, 7) });
    await expect(asProposed.decide()).resolves.toMatchObject({ kind: "decided",
      submission: { approvedTargetReaders: { mode: "SELECTED_MEMBERS", memberIds: readers.slice(5, 7) } } });
    const asProposedRows = await selections(asProposed.submission.id);
    expect(asProposedRows.approved_selection_id).not.toBe(asProposedRows.proposed_selection_id);

    // 7. A legacy audience submission approves as before and refuses approved readers.
    const legacy = await submit("t21-legacy", null);
    await expect(legacy.decide({ mode: "ORGANIZATION" })).resolves.toEqual({ kind: "denied", reason: "READERS_NOT_SUPPORTED" });
    await expect(legacy.decide()).resolves.toMatchObject({ kind: "decided",
      submission: { status: "APPROVED", proposedTargetReaders: null, approvedTargetReaders: null } });

    // 8. Referenced selections are immutable and approved readers are recorded once.
    await expect(sqlState((client) => client.query(`UPDATE reader_selection SET revision = revision + 1
      WHERE selection_id = $1`, [organizationRows.approved_selection_id]))).resolves.toBe("55000");
    await expect(sqlState((client) => client.query(`UPDATE shared_submission SET approved_selection_id = proposed_selection_id
      WHERE submission_id = $1`, [organization.submission.id]))).resolves.toBe("55000");

    // REV-02: the reviewer's queue carries version and author; their decided submissions form the history.
    const queue = await repository.listAssignedReviews(ids.organizationReviewer, ids.organization);
    expect(queue?.find((item) => item.submissionId === department.submission.id))
      .toMatchObject({ versionNo: 2, authorName: "Synthetic Owner" });
    const history = await repository.listDecidedReviews(ids.organizationReviewer, ids.organization);
    expect(history?.find((item) => item.submissionId === listed.submission.id))
      .toMatchObject({ decision: "APPROVED", versionNo: 2, authorName: "Synthetic Owner" });
    await expect(repository.listDecidedReviews(readerFixtures[0]!.userId, ids.organization)).resolves.toEqual([]);
    const authorsForMember = await superuser(async (client) => {
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
        [readerFixtures[0]!.userId, ids.organization]);
      return (await client.query(`SELECT * FROM review_submission_authors($1::uuid[])`,
        [[department.submission.id, listed.submission.id]])).rowCount;
    });
    expect(authorsForMember).toBe(0);

    // A reader from the second department may read this publication, but may not
    // select its owning department when authoring their own draft.
    const crossDepartment = await submit("Owner name across departments", { mode: "ORGANIZATION" });
    await expect(crossDepartment.decide()).resolves.toMatchObject({ kind: "decided" });

    // 5. Activate every queued generation; the narrowed publication admits A only, in RLS and in the API policy.
    const store = new PgIndexGenerationStore(indexPool);
    const workerId = randomUUID();
    for (let claimed = await store.claim(workerId, 90); claimed; claimed = await store.claim(workerId, 90)) {
      await store.complete(claimed, workerId, {
        contractVersion: 1, jobId: claimed.jobId, generationId: claimed.generationId,
        snapshotVersionId: claimed.snapshotVersionId, snapshotContentHash: claimed.snapshotContentHash,
        compilerVersion: "semantic-markdown-v1", chunkingVersion: "langchain-section-token-v1",
        embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
        markdownContentHash: "d".repeat(64), chunksDigest: "e".repeat(64),
        chunks: [{ chunkId: "f".repeat(64), ordinal: 0, contentHash: "1".repeat(64),
          startOffset: 0, endOffset: 10, sourceBlockIds: ["body"], parentSectionBlockId: null }],
      });
    }
    const publicationReaders = await superuser((client) => client.query<{ pv: string | null; cp: string | null }>(`
      SELECT pv.reader_selection_id AS pv, cp.reader_selection_id AS cp
        FROM published_knowledge_version pv JOIN knowledge_current_publication cp USING (published_version_id)
       WHERE pv.submission_id = $1`, [listed.submission.id]));
    const listedRows = await selections(listed.submission.id);
    expect(publicationReaders.rows).toEqual([{ pv: listedRows.approved_selection_id, cp: listedRows.approved_selection_id }]);

    const sharedPublication = await superuser((client) => client.query<{ id: string }>(`
      SELECT pv.published_version_id AS id FROM published_knowledge_version pv
      JOIN knowledge_current_publication cp USING (published_version_id)
      WHERE pv.submission_id = $1`, [listed.submission.id]));
    const sharedPublicationId = sharedPublication.rows[0]?.id;
    if (!sharedPublicationId) throw new Error("Expected the selected-reader publication to be current");
    const activationShareNotifications = await pool.query(`
      SELECT notification_id FROM arden.arden_notification
       WHERE organization_id = $1 AND resource_type = 'PUBLICATION' AND resource_id = $2
         AND event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')`, [ids.organization, sharedPublicationId]);
    expect(activationShareNotifications.rows).toEqual([]);
    await expect(repository.listReadableCurrentPublicationIds(readerFixtures[0]!.userId, ids.organization, [sharedPublicationId]))
      .resolves.toEqual([sharedPublicationId]);
    await expect(repository.listReadableCurrentPublicationIds(readerFixtures[5]!.userId, ids.organization, [sharedPublicationId]))
      .resolves.toEqual([]);

    const departmentPublication = await superuser((client) => client.query<{ id: string }>(`
      SELECT pv.published_version_id AS id FROM published_knowledge_version pv
      JOIN knowledge_current_publication cp USING (published_version_id)
      WHERE pv.submission_id = $1`, [organization.submission.id]));
    const legacyPublication = await superuser((client) => client.query<{ id: string }>(`
      SELECT pv.published_version_id AS id FROM published_knowledge_version pv
      JOIN knowledge_current_publication cp USING (published_version_id)
      WHERE pv.submission_id = $1`, [legacy.submission.id]));
    const activationShareEvents = await pool.query(`
      SELECT notification_id FROM arden.arden_notification
       WHERE organization_id = $1 AND resource_type = 'PUBLICATION'
         AND event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
         AND resource_id = ANY($2::uuid[])`, [ids.organization,
      [sharedPublicationId, departmentPublication.rows[0]?.id, legacyPublication.rows[0]?.id]]);
    expect(activationShareEvents.rows).toEqual([]);

    for (const [userId, readable] of [[readerFixtures[0]!.userId, true], [readerFixtures[5]!.userId, false],
      [ids.owner, false]] as const) {
      const actor = await repository.getTargetReaderActor(userId, ids.organization);
      const library = (await repository.listPublishedKnowledge(userId, ids.organization)) ?? [];
      const sources = (await repository.listAuthorizedAiSources(userId, ids.organization)) ?? [];
      const visible = library.filter((item) => item.draftId === listed.draftId);
      expect(visible.map((item) => item.draftId)).toEqual(readable ? [listed.draftId] : []);
      expect(visible.every((item) => canRead(actor, { organizationId: ids.organization, readers: item.targetReaders }))).toBe(true);
      expect(sources.some((source) => source.draftId === listed.draftId)).toBe(readable);
      const detailRead = await repository.getPublishedKnowledge(userId, ids.organization,
        (await superuser((client) => client.query<{ id: string }>(`SELECT published_version_id AS id
          FROM published_knowledge_version WHERE submission_id = $1`, [listed.submission.id]))).rows[0]!.id);
      expect(detailRead !== null).toBe(readable);
    }

    const crossReader = readerFixtures[5]!.userId;
    const choices = await repository.getKnowledgeOptions(crossReader, ids.organization);
    expect(choices?.departments.map((item) => item.id)).toEqual([ids.secondDepartment]);
    const crossPublication = (await repository.listPublishedKnowledge(crossReader, ids.organization))
      ?.find((item) => item.draftId === crossDepartment.draftId);
    expect(crossPublication).toMatchObject({ responsibleDepartmentId: ids.department,
      responsibleDepartmentName: "Synthetic department" });
    if (!crossPublication) throw new Error("Cross-department publication missing");
    await expect(repository.getPublishedKnowledge(crossReader, ids.organization, crossPublication.id))
      .resolves.toMatchObject({ responsibleDepartmentName: "Synthetic department" });
    await expect(repository.getPublishedKnowledge(crossReader, randomUUID(), crossPublication.id)).resolves.toBeNull();
  }, 30_000);

  it("keeps collections, favorites and trash owner-only and purges expired trash into tombstones (decision 0029)", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const store = repository.privateOrganization;
    const content = () => ({ sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: "e".repeat(64) });
    const parent = await store.createCollection(ids.owner, ids.organization, { title: "Owner parent", parentId: null }, "org-create-parent");
    const child = await store.createCollection(ids.owner, ids.organization, { title: "Owner child", parentId: parent!.id }, "org-create-child");
    expect(child).toMatchObject({ parentId: parent!.id });
    const note = await repository.createDraft(ids.owner, ids.organization,
      { title: "Organized", body: "Body", collectionId: child!.id }, content(), "org-create-note");
    expect(note).toMatchObject({ collectionId: child!.id });

    // F03-ORG-AC1: another active member and the Org Admin context see and change nothing.
    await expect(store.listCollections(ids.manager, ids.organization)).resolves.toEqual([]);
    await expect(store.updateCollection(ids.manager, ids.organization, parent!.id, { title: "Taken" }, "org-steal"))
      .resolves.toEqual({ kind: "not-found" });
    await expect(store.moveNote(ids.manager, ids.organization, note!.id, null, null)).resolves.toBeNull();
    await expect(store.trashCollection(ids.manager, ids.organization, parent!.id, "org-steal-trash")).resolves.toBeNull();
    await expect(repository.createDraft(ids.manager, ids.organization,
      { title: "Planted", body: "x", collectionId: child!.id }, content(), "org-plant")).resolves.toBeNull();
    // A direct runtime write cannot attach another owner's collection as a parent.
    const managerCollection = await store.createCollection(ids.manager, ids.organization, { title: "Manager", parentId: null }, "org-manager");
    await expect(store.createCollection(ids.manager, ids.organization, { title: "Cross", parentId: parent!.id }, "org-cross"))
      .resolves.toBeNull();

    // F03-ORG-AC2: cycles are rejected by the API check and by the database trigger.
    await expect(store.updateCollection(ids.owner, ids.organization, parent!.id, { parentId: child!.id }, "org-cycle"))
      .resolves.toEqual({ kind: "cycle" });
    const runtime = async <T>(userId: string, work: (client: import("pg").PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SET LOCAL search_path TO arden, public");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [userId, ids.organization]);
        return await work(client);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    await expect(runtime(ids.owner, (client) => client.query(
      "UPDATE private_collection SET parent_collection_id = $2 WHERE collection_id = $1", [parent!.id, child!.id])))
      .rejects.toMatchObject({ code: "23514" });
    await expect(runtime(ids.manager, async (client) => (await client.query(
      "SELECT 1 FROM private_collection WHERE collection_id = ANY($1::uuid[])", [[parent!.id, child!.id]])).rowCount)).resolves.toBe(0);
    await expect(runtime(ids.manager, (client) => client.query(
      "UPDATE private_collection SET parent_collection_id = $2 WHERE collection_id = $1", [managerCollection!.id, parent!.id])))
      .rejects.toMatchObject({ code: "23503" });

    // F03-ORG-AC3/AC4: favorites and duplicate.
    await expect(store.setNoteFavorite(ids.owner, ids.organization, note!.id, true)).resolves.toMatchObject({ favoritedAt: expect.any(Date) });
    const source = await store.getNoteSource(ids.owner, ids.organization, note!.id);
    const duplicate = await store.duplicateNote(ids.owner, ids.organization, source!, "Organized (copy)", content(), "org-dup");
    expect(duplicate).toMatchObject({ title: "Organized (copy)", collectionId: child!.id, favoritedAt: null, currentVersion: 1 });

    // F03-ORG-AC5: trash hides the subtree from reads, updates and contribution; restore returns it.
    const entry = await store.trashCollection(ids.owner, ids.organization, child!.id, "org-trash");
    expect(entry).toMatchObject({ kind: "collection", id: child!.id, fromCollectionTitle: "Owner parent", itemCount: 3 });
    await expect(repository.getDraft(ids.owner, ids.organization, note!.id)).resolves.toBeNull();
    await expect(repository.canUpdateDraft(ids.owner, ids.organization, note!.id)).resolves.toBe(false);
    await expect(repository.updateDraft(ids.owner, ids.organization, note!.id, 1, { title: "x" }, null, "org-edit-trashed"))
      .resolves.toEqual({ kind: "not-found" });
    await expect(repository.getPrivateContributionSource(ids.owner, ids.organization, note!.versionId)).resolves.toBeNull();
    expect((await repository.listDrafts(ids.owner, ids.organization, 100, null))?.items.some((item) => item.id === note!.id)).toBe(false);
    await expect(store.trashNote(ids.owner, ids.organization, note!.id, "org-trash-again")).resolves.toBeNull();
    await expect(store.listTrash(ids.manager, ids.organization)).resolves.toEqual([]);
    await expect(store.restoreTrash(ids.manager, ids.organization, entry!.batchId, "org-restore-steal")).resolves.toBeNull();
    await expect(store.trashCollection(ids.owner, ids.organization, parent!.id, "org-trash-parent")).resolves.toMatchObject({ itemCount: 1 });
    const restored = await store.restoreTrash(ids.owner, ids.organization, entry!.batchId, "org-restore");
    expect(restored?.collections).toEqual([expect.objectContaining({ id: child!.id, parentId: null })]);
    expect(restored?.notes.map((item) => item.id).sort()).toEqual([note!.id, duplicate!.id].sort());

    // F03-ORG-AC6: the retention context sees only trash older than 30 days and leaves tombstones.
    const expired = await store.trashCollection(ids.owner, ids.organization, child!.id, "org-trash-expire");
    const beforeRetention = await repository.privateTrashRetention.purgeExpired(new Date(), 100);
    expect(beforeRetention.purgedBatches).toBe(0);
    await pool.query(`UPDATE arden.draft_document SET trashed_at = trashed_at - interval '31 days' WHERE trash_batch_id = $1`, [expired!.batchId]);
    await pool.query(`UPDATE arden.private_collection SET trashed_at = trashed_at - interval '31 days' WHERE trash_batch_id = $1`, [expired!.batchId]);
    const purged = await repository.privateTrashRetention.purgeExpired(new Date(), 100);
    expect(purged.purgedBatches).toBe(1);
    expect(purged.content.map((item) => item.draftId)).toEqual(expect.arrayContaining([note!.id, duplicate!.id]));
    await repository.privateTrashRetention.markContentErased(purged.content.map((item) => item.draftId));
    const tombstones = await pool.query<{ status: string; title: string; content_purged_at: Date | null }>(`SELECT status, title, content_purged_at
      FROM arden.draft_document WHERE draft_id = ANY($1::uuid[])`, [[note!.id, duplicate!.id]]);
    expect(tombstones.rows).toEqual([
      expect.objectContaining({ status: "PURGED", title: "", content_purged_at: expect.any(Date) }),
      expect.objectContaining({ status: "PURGED", title: "", content_purged_at: expect.any(Date) }),
    ]);
    const versions = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.draft_version WHERE draft_id = $1`, [note!.id]);
    expect(versions.rows[0]?.count).toBe("1");
    await expect(store.listTrash(ids.owner, ids.organization)).resolves.toEqual([expect.objectContaining({ kind: "collection", id: parent!.id })]);
    await expect(store.restoreTrash(ids.owner, ids.organization, expired!.batchId, "org-restore-purged")).resolves.toBeNull();
    // Decision 0035: collections, trash and restore are routine owner-only actions and are not audited.
    const routine = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.audit_event
      WHERE organization_id = $1 AND event_type IN ('PRIVATE_COLLECTION_CREATED', 'PRIVATE_COLLECTION_UPDATED',
        'PRIVATE_ITEM_TRASHED', 'PRIVATE_ITEM_RESTORED', 'PRIVATE_DRAFT_DUPLICATED')`, [ids.organization]);
    expect(routine.rows[0]?.count).toBe("0");

    // Owner purge of the remaining parent batch: permanent deletion stays audited, without titles.
    const parentBatch = (await store.listTrash(ids.owner, ids.organization))![0]!.batchId;
    await expect(store.purgeTrash(ids.manager, ids.organization, parentBatch, "org-purge-steal")).resolves.toBeNull();
    await expect(store.purgeTrash(ids.owner, ids.organization, parentBatch, "org-purge")).resolves.toEqual([]);
    await expect(store.listCollections(ids.owner, ids.organization)).resolves.toEqual([]);
    const purgeAudit = await pool.query<{ details_json: unknown }>(`SELECT details_json FROM arden.audit_event
      WHERE organization_id = $1 AND event_type = 'PRIVATE_ITEM_PURGED'`, [ids.organization]);
    expect(purgeAudit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(purgeAudit.rows)).not.toMatch(/Owner parent|Owner child|Organized/);
  }, 30_000);

  it("orders and archives notes owner-only without moving their saved time (spec F03-ARR)", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const store = repository.privateOrganization;
    const content = () => ({ sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: "f".repeat(64) });
    const shelf = await store.createCollection(ids.owner, ids.organization, { title: "Arrange shelf", parentId: null }, "arr-shelf");
    const make = (title: string) => repository!.createDraft(ids.owner, ids.organization,
      { title, body: title, collectionId: shelf!.id }, content(), `arr-${title}`);
    const first = await make("First");
    const second = await make("Second");
    const third = await make("Third");
    const savedAt = async (id: string) => (await pool!.query<{ updated_at: Date }>(
      "SELECT updated_at FROM arden.draft_document WHERE draft_id = $1", [id])).rows[0]!.updated_at.toISOString();
    const order = async () => (await pool!.query<{ title: string; sort_position: number | null }>(`SELECT title, sort_position
      FROM arden.draft_document WHERE collection_id = $1 AND status = 'ACTIVE' AND trashed_at IS NULL AND archived_at IS NULL
      ORDER BY sort_position ASC NULLS FIRST, created_at DESC, draft_id DESC`, [shelf!.id])).rows.map((row) => [row.title, row.sort_position]);
    const firstSaved = await savedAt(first!.id);
    const thirdSaved = await savedAt(third!.id);

    // F03-ARR-AC1: unplaced notes are newest first; placing one renumbers the container from 1.
    expect(await order()).toEqual([["Third", null], ["Second", null], ["First", null]]);
    await expect(store.moveNote(ids.owner, ids.organization, first!.id, shelf!.id, 0)).resolves.toMatchObject({ position: 1, collectionId: shelf!.id });
    expect(await order()).toEqual([["First", 1], ["Third", 2], ["Second", 3]]);
    await expect(store.moveNote(ids.owner, ids.organization, first!.id, shelf!.id, 99)).resolves.toMatchObject({ position: 3 });
    expect(await order()).toEqual([["Third", 1], ["Second", 2], ["First", 3]]);
    expect(await savedAt(first!.id)).toBe(firstSaved);
    await expect(repository.listDrafts(ids.owner, ids.organization, 100, null)).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: first!.id, position: 3 })]) });

    // F03-ARR-AC4: another member cannot place, archive or see archived notes; RLS hides the rows.
    await expect(store.moveNote(ids.manager, ids.organization, second!.id, null, 0)).resolves.toBeNull();
    await expect(store.setNoteArchived(ids.manager, ids.organization, second!.id, true, "arr-steal")).resolves.toBeNull();

    // F03-ARR-AC3: archive hides the note from the list without touching its saved time.
    const archived = await store.setNoteArchived(ids.owner, ids.organization, third!.id, true, "arr-archive");
    expect(archived).toMatchObject({ id: third!.id, archivedAt: expect.any(Date) });
    await expect(repository.getDraft(ids.owner, ids.organization, third!.id, { forQuestion: true })).resolves.toBeNull();
    expect(await savedAt(third!.id)).toBe(thirdSaved);
    const listed = await repository.listDrafts(ids.owner, ids.organization, 100, null);
    expect(listed!.items.map((item) => item.id)).not.toContain(third!.id);
    await expect(store.setNoteFavorite(ids.owner, ids.organization, third!.id, true)).resolves.toBeNull();
    await expect(store.listArchived(ids.owner, ids.organization)).resolves.toEqual({ hasMore: false, items: [
      expect.objectContaining({ id: third!.id, title: "Third", collectionId: shelf!.id, collectionTitle: "Arrange shelf" })] });
    await expect(store.listArchived(ids.manager, ids.organization)).resolves.toEqual({ hasMore: false, items: [] });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [ids.manager, ids.organization]);
      expect((await client.query("SELECT 1 FROM draft_document WHERE draft_id = $1", [third!.id])).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // Trashing and purging its collection leaves the archived note archived; Unarchive then returns it to the root.
    const batch = await store.trashCollection(ids.owner, ids.organization, shelf!.id, "arr-trash");
    expect(batch!.itemCount).toBe(3);
    await store.purgeTrash(ids.owner, ids.organization, batch!.batchId, "arr-purge");
    await expect(store.listArchived(ids.owner, ids.organization)).resolves.toMatchObject({ items: [
      expect.objectContaining({ id: third!.id, collectionId: null, collectionTitle: null })] });
    await expect(store.setNoteArchived(ids.owner, ids.organization, third!.id, false, "arr-unarchive"))
      .resolves.toMatchObject({ collectionId: null, position: null, archivedAt: null });

    // An archived note can never also be in trash; moving it to trash clears the flag.
    await expect(pool.query(`UPDATE arden.draft_document SET archived_at = now(), trashed_at = now(), trash_batch_id = gen_random_uuid()
      WHERE draft_id = $1`, [third!.id])).rejects.toMatchObject({ code: "23514" });
    await store.setNoteArchived(ids.owner, ids.organization, third!.id, true, "arr-archive-again");
    await expect(store.trashNote(ids.owner, ids.organization, third!.id, "arr-trash-archived")).resolves.toMatchObject({ kind: "note" });
    const row = await pool.query<{ archived_at: Date | null; trashed_at: Date | null }>(
      "SELECT archived_at, trashed_at FROM arden.draft_document WHERE draft_id = $1", [third!.id]);
    expect(row.rows[0]).toMatchObject({ archived_at: null, trashed_at: expect.any(Date) });
    const audit = await pool.query<{ details_json: unknown }>(`SELECT details_json FROM arden.audit_event
      WHERE organization_id = $1 AND event_type IN ('PRIVATE_DRAFT_ARCHIVED', 'PRIVATE_DRAFT_UNARCHIVED')`, [ids.organization]);
    // Decision 0035: archiving is a routine owner-only action and is not audited.
    expect(audit.rows).toHaveLength(0);
  }, 30_000);

  it("overwrites a note's open version, seals it on contribution and keeps sealed versions immutable (decision 0031)", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const object = (hash: string) => ({ sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: hash.repeat(64) });
    const first = object("1");
    const note = await repository.createDraft(ids.owner, ids.organization, { title: "Live note", body: "one" }, first, "live-create");
    const versions = async () => (await pool!.query<{ draft_version_id: string; version_no: number; source_uri: string; sealed: boolean }>(
      `SELECT draft_version_id, version_no, source_uri, sealed_at IS NOT NULL AS sealed FROM arden.draft_version
        WHERE draft_id = $1 ORDER BY version_no`, [note!.id])).rows;

    // Saves overwrite the single open version; only the replaced object is reported for erasure.
    const second = object("2");
    const saved = await repository.updateDraft(ids.owner, ids.organization, note!.id, 1, { body: "two" }, second, "live-save-1");
    expect(saved).toMatchObject({ kind: "updated", draft: { currentVersion: 2, versionId: note!.versionId, sourceUri: second.sourceUri },
      replacedSourceUris: [first.sourceUri] });
    const renamed = await repository.updateDraft(ids.owner, ids.organization, note!.id, 2, { title: "Live note renamed" }, null, "live-rename");
    expect(renamed).toMatchObject({ kind: "updated", draft: { currentVersion: 3, versionId: note!.versionId }, replacedSourceUris: [] });
    expect(await versions()).toEqual([{ draft_version_id: note!.versionId, version_no: 3, source_uri: second.sourceUri, sealed: false }]);
    await expect(repository.updateDraft(ids.owner, ids.organization, note!.id, 2, { body: "stale" }, object("9"), "live-stale"))
      .resolves.toEqual({ kind: "conflict", currentVersion: 3 });

    // Contributing seals the exact version; the next save starts a new open version and keeps the sealed object.
    const source = await repository.getPrivateContributionSource(ids.owner, ids.organization, note!.versionId);
    const contributed = await repository.createKnowledgeDraft(ids.owner, ids.organization, {
      actorMembershipId: ids.ownerMembership, sourceVersionId: note!.versionId, classification: "INTERNAL", idempotencyKey: randomUUID(),
      expectedSource: source!, copiedContent: object("2"), requestId: "live-contribute",
    });
    expect(contributed.kind).toBe("created");
    expect((await versions())[0]).toMatchObject({ sealed: true });
    const third = object("3");
    const afterContribution = await repository.updateDraft(ids.owner, ids.organization, note!.id, 3, { body: "three" }, third, "live-save-2");
    expect(afterContribution).toMatchObject({ kind: "updated", draft: { currentVersion: 4 }, replacedSourceUris: [] });
    if (afterContribution.kind !== "updated") return;
    expect(afterContribution.draft.versionId).not.toBe(note!.versionId);
    expect(await versions()).toEqual([
      { draft_version_id: note!.versionId, version_no: 3, source_uri: second.sourceUri, sealed: true },
      { draft_version_id: afterContribution.draft.versionId, version_no: 4, source_uri: third.sourceUri, sealed: false },
    ]);

    // The database itself refuses to change a sealed or contributed version, to delete any version, or to move back a number.
    const runtime = async (sql: string, values: unknown[]) => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SET LOCAL search_path TO arden, public");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [ids.owner, ids.organization]);
        return await client.query(sql, values);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    await expect(runtime("UPDATE draft_version SET content_hash = $2 WHERE draft_version_id = $1", [note!.versionId, "7".repeat(64)]))
      .rejects.toMatchObject({ code: "55000" });
    await expect(pool.query("UPDATE arden.draft_version SET sealed_at = NULL WHERE draft_version_id = $1", [note!.versionId]))
      .rejects.toMatchObject({ code: "55000" });
    await expect(runtime("UPDATE draft_version SET version_no = 1 WHERE draft_version_id = $1", [afterContribution.draft.versionId]))
      .rejects.toMatchObject({ code: "55000" });
    await expect(runtime("UPDATE draft_version SET draft_id = draft_id, created_by_membership_id = $2 WHERE draft_version_id = $1",
      [afterContribution.draft.versionId, ids.managerMembership])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("DELETE FROM arden.draft_version WHERE draft_version_id = $1", [afterContribution.draft.versionId]))
      .rejects.toMatchObject({ code: "55000" });
    // Another member can neither see nor overwrite the owner's open version.
    await expect(repository.updateDraft(ids.manager, ids.organization, note!.id, 4, { body: "x" }, object("8"), "live-steal"))
      .resolves.toEqual({ kind: "not-found" });
  }, 30_000);

  it("keeps a private PDF item with its extracted text, replaces both and seals them on contribution (decision 0034)", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const hash = (digit: string) => digit.repeat(64);
    const pdfObject = (digit: string, withText: boolean) => ({
      sourceUri: `arden-private-object://${randomUUID()}.pdf`, mimeType: "application/pdf" as const, contentHash: hash(digit),
      text: withText ? { sourceUri: `arden-private-object://${randomUUID()}`, contentHash: hash(digit) } : null,
    });
    const first = pdfObject("a", true);
    const item = await repository.createDraft(ids.owner, ids.organization, { title: "Board minutes", body: "" }, first, "pdf-create");
    await expect(repository.getDraft(ids.owner, ids.organization, item!.id)).resolves.toMatchObject({
      mimeType: "application/pdf", text: first.text });
    // Only the owner reads it; another member, including a manager, sees nothing.
    await expect(repository.getDraft(ids.manager, ids.organization, item!.id)).resolves.toBeNull();

    // A text note and a PDF item never take each other's content; the title still changes.
    const textObject = { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: hash("b") };
    await expect(repository.updateDraft(ids.owner, ids.organization, item!.id, 1, { body: "typed" }, textObject, "pdf-as-text"))
      .resolves.toEqual({ kind: "wrong-kind" });
    await expect(repository.updateDraft(ids.owner, ids.organization, item!.id, 1, { title: "Board minutes 2026" }, null, "pdf-rename"))
      .resolves.toMatchObject({ kind: "updated", draft: { currentVersion: 2, text: first.text }, replacedSourceUris: [] });

    // Replacing the file overwrites the open version and reports both old objects for erasure.
    const second = pdfObject("c", true);
    await expect(repository.updateDraft(ids.owner, ids.organization, item!.id, 2, {}, second, "pdf-replace"))
      .resolves.toMatchObject({ kind: "updated", draft: { currentVersion: 3, sourceUri: second.sourceUri, text: second.text },
        replacedSourceUris: [first.sourceUri, first.text!.sourceUri] });

    // Contribution copies the file into a shared PDF draft and seals the version with its text.
    const source = await repository.getPrivateContributionSource(ids.owner, ids.organization, item!.versionId);
    const contributed = await repository.createKnowledgeDraft(ids.owner, ids.organization, {
      actorMembershipId: ids.ownerMembership, sourceVersionId: item!.versionId, classification: "INTERNAL", idempotencyKey: randomUUID(),
      expectedSource: source!, copiedContent: { ...pdfObject("c", false), text: undefined }, requestId: "pdf-contribute",
    });
    expect(contributed).toMatchObject({ kind: "created", draft: { mimeType: "application/pdf" } });
    const runtime = async (sql: string, values: unknown[]) => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SET LOCAL search_path TO arden, public");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [ids.owner, ids.organization]);
        return await client.query(sql, values);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    await expect(runtime("UPDATE draft_version SET text_source_uri = NULL, text_content_hash = NULL WHERE draft_version_id = $1",
      [item!.versionId])).rejects.toMatchObject({ code: "55000" });
    // Extracted text belongs only to PDF versions.
    const textNote = await repository.createDraft(ids.owner, ids.organization, { title: "Text-only", body: "words" },
      { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: hash("e") }, "pdf-text-note");
    await expect(pool.query(`UPDATE arden.draft_version SET text_source_uri = 'arden-private-object://x', text_content_hash = $2
      WHERE draft_version_id = $1`, [textNote!.versionId, hash("d")])).rejects.toMatchObject({ code: "23514" });

    // Trash and purge report the file and its text object for erasure.
    const store = repository.privateOrganization;
    const batch = await store.trashNote(ids.owner, ids.organization, item!.id, "pdf-trash");
    const purged = await store.purgeTrash(ids.owner, ids.organization, batch!.batchId, "pdf-purge");
    expect(purged).toEqual([{ draftId: item!.id, sourceUris: [second.sourceUri, second.text!.sourceUri].sort() }]);
  }, 30_000);

  it("shares a private item with named members only, without review, and ends access on revoke, trash and leaving (decision 0034)", async () => {
    if (!repository || !pool) throw new Error("Test database is unavailable");
    const shares = repository.directShares;
    const object = (digit: string) => ({ sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain" as const, contentHash: digit.repeat(64) });
    const note = await repository.createDraft(ids.owner, ids.organization, { title: "Onboarding plan", body: "secret" }, object("1"), "share-note");
    const runtime = async (actor: string, sql: string, values: unknown[]) => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SET LOCAL search_path TO arden, public");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [actor, ids.organization]);
        return await client.query(sql, values);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    const notices = async () => (await pool!.query<{ publication_title: string; shared_by_name: string }>(`SELECT publication_title, shared_by_name
      FROM arden.arden_notification WHERE recipient_membership_id = $1 AND event_type = 'DOCUMENT_SHARED_DIRECT' AND resource_id = $2`,
    [ids.managerMembership, note!.id])).rows;
    try {
      // Only active members of the organization other than the owner can be chosen.
      await expect(shares.share(ids.owner, ids.organization, note!.id, [ids.ownerMembership], "share-self"))
        .resolves.toEqual({ kind: "invalid-recipients" });
      await expect(shares.share(ids.owner, ids.organization, note!.id, [randomUUID()], "share-stranger"))
        .resolves.toEqual({ kind: "invalid-recipients" });
      await expect(shares.share(ids.manager, ids.organization, note!.id, [ids.organizationReviewerMembership], "share-not-owner"))
        .resolves.toEqual({ kind: "not-found" });

      const shared = await shares.share(ids.owner, ids.organization, note!.id, [ids.managerMembership], "share-manager");
      expect(shared).toMatchObject({ kind: "shared", added: 1, shares: { settings: { enabled: true, recipientLimit: 10 },
        recipients: [{ membershipId: ids.managerMembership, name: "Synthetic Manager", active: true }] } });
      expect(await notices()).toEqual([{ publication_title: "Onboarding plan", shared_by_name: "Synthetic Owner" }]);
      // Sharing with the same person again adds no grant and no second notice.
      await expect(shares.share(ids.owner, ids.organization, note!.id, [ids.managerMembership], "share-again"))
        .resolves.toMatchObject({ kind: "shared", added: 0 });
      expect(await notices()).toHaveLength(1);

      // The recipient reads the current saved version, read-only; others see nothing.
      await expect(shares.listSharedWithMe(ids.manager, ids.organization)).resolves.toMatchObject([
        { id: note!.id, title: "Onboarding plan", kind: "note", ownerName: "Synthetic Owner" }]);
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toMatchObject({ sourceUri: note!.sourceUri, version: 1 });
      await expect(shares.listSharedWithMe(ids.organizationReviewer, ids.organization)).resolves.toEqual([]);
      await expect(shares.getSharedItem(ids.organizationReviewer, ids.organization, note!.id)).resolves.toBeNull();
      await expect(repository.updateDraft(ids.manager, ids.organization, note!.id, 1, { body: "x" }, object("2"), "share-edit"))
        .resolves.toEqual({ kind: "not-found" });
      expect((await runtime(ids.manager, "UPDATE draft_document SET title = 'taken' WHERE draft_id = $1", [note!.id])).rowCount).toBe(0);
      expect((await runtime(ids.manager, `UPDATE private_item_share SET revoked_at = now(), revoked_by_membership_id = $2
        WHERE draft_id = $1`, [note!.id, ids.managerMembership])).rowCount).toBe(0);
      // Recipients read only the current version, never the owner's other items or collections.
      expect((await runtime(ids.manager, "SELECT draft_id FROM draft_document WHERE workspace_id = (SELECT workspace_id FROM draft_document WHERE draft_id = $1)", [note!.id])).rows)
        .toEqual([{ draft_id: note!.id }]);

      // A later save is what the recipient sees next.
      await repository.updateDraft(ids.owner, ids.organization, note!.id, 1, { body: "updated" }, object("3"), "share-save");
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toMatchObject({ version: 2, contentHash: "3".repeat(64) });

      // Organization Admin settings: the limit counts active recipients, and turning sharing off hides shared items.
      await expect(shares.updateSettings(ids.manager, ids.organization, { enabled: true, recipientLimit: 1 }, "settings-member"))
        .resolves.toBeNull();
      await expect(shares.updateSettings(ids.owner, ids.organization, { enabled: true, recipientLimit: 1 }, "settings-limit"))
        .resolves.toEqual({ enabled: true, recipientLimit: 1 });
      await expect(shares.share(ids.owner, ids.organization, note!.id, [ids.organizationReviewerMembership], "share-over"))
        .resolves.toEqual({ kind: "limit", limit: 1 });
      await shares.updateSettings(ids.owner, ids.organization, { enabled: false, recipientLimit: 1 }, "settings-off");
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toBeNull();
      await expect(shares.share(ids.owner, ids.organization, note!.id, [ids.managerMembership], "share-off"))
        .resolves.toEqual({ kind: "disabled" });
      await shares.updateSettings(ids.owner, ids.organization, { enabled: true, recipientLimit: 10 }, "settings-on");

      // An owner who stops being an active member no longer shares anything.
      await pool.query("UPDATE arden.organization_membership SET status = 'SUSPENDED' WHERE membership_id = $1", [ids.ownerMembership]);
      try {
        await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toBeNull();
      } finally {
        await pool.query("UPDATE arden.organization_membership SET status = 'ACTIVE' WHERE membership_id = $1", [ids.ownerMembership]);
      }
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.not.toBeNull();

      // Revoking ends access at once; sharing again is a new grant with its own notice.
      const managerShare = (await shares.listShares(ids.owner, ids.organization, note!.id))!.recipients[0]!;
      await expect(shares.revoke(ids.owner, ids.organization, note!.id, managerShare.shareId, "revoke-one"))
        .resolves.toMatchObject({ recipients: [] });
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toBeNull();
      await shares.share(ids.owner, ids.organization, note!.id, [ids.managerMembership, ids.organizationReviewerMembership], "share-two");
      expect(await notices()).toHaveLength(2);
      await expect(shares.revoke(ids.owner, ids.organization, note!.id, null, "revoke-all")).resolves.toMatchObject({ recipients: [] });
      await expect(shares.getSharedItem(ids.organizationReviewer, ids.organization, note!.id)).resolves.toBeNull();

      // Moving the item to trash revokes its shares; restoring it does not share it again.
      await shares.share(ids.owner, ids.organization, note!.id, [ids.managerMembership], "share-before-trash");
      const batch = await repository.privateOrganization.trashNote(ids.owner, ids.organization, note!.id, "share-trash");
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toBeNull();
      await repository.privateOrganization.restoreTrash(ids.owner, ids.organization, batch!.batchId, "share-restore");
      await expect(shares.listShares(ids.owner, ids.organization, note!.id)).resolves.toMatchObject({ recipients: [] });
      await expect(shares.getSharedItem(ids.manager, ids.organization, note!.id)).resolves.toBeNull();

      // A share row can only be revoked, once; audit never carries the title.
      await expect(pool.query("UPDATE arden.private_item_share SET recipient_membership_id = $2 WHERE draft_id = $1",
        [note!.id, ids.organizationReviewerMembership])).rejects.toMatchObject({ code: "55000" });
      const audit = await pool.query<{ details_json: unknown }>(`SELECT details_json FROM arden.audit_event
        WHERE organization_id = $1 AND event_type IN ('PRIVATE_ITEM_SHARED', 'PRIVATE_ITEM_SHARE_REVOKED', 'DIRECT_SHARE_SETTINGS_UPDATED')`, [ids.organization]);
      expect(audit.rows.length).toBeGreaterThanOrEqual(8);
      expect(audit.rows).toContainEqual({ details_json: expect.objectContaining({
        draftId: note!.id, revokedCount: 1, reason: "TRASH", requestId: "share-trash",
      }) });
      expect(JSON.stringify(audit.rows)).not.toContain("Onboarding plan");
    } finally {
      await pool.query("DELETE FROM arden.organization_direct_share_setting WHERE organization_id = $1", [ids.organization]);
    }
  }, 60_000);
});

registerKnowledgeCatalogVerification();
registerGovernedAnsweringVerification();
