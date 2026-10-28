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
  readerAudience: randomUUID(),
};
const roleCodes = [`ARDEN_TEST_OWNER_${ids.owner.replaceAll("-", "").toUpperCase()}`, `ARDEN_TEST_MANAGER_${ids.manager.replaceAll("-", "").toUpperCase()}`];
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
         '0015_org_admin_member_profiles', '0016_fix_flow2_cross_actor_validation',
         '0017_audience_and_instance_admin_foundation')`);
    if (migration.rows[0]?.count !== "5") throw new Error("Apply the current schema migrations to the isolated test database first");

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
          await client.query("ALTER TABLE shared_submission DISABLE TRIGGER USER");
          await client.query("ALTER TABLE review_decision DISABLE TRIGGER USER");
          await client.query("ALTER TABLE published_knowledge_version DISABLE TRIGGER USER");
          await client.query("ALTER TABLE knowledge_current_publication DISABLE TRIGGER USER");
          await client.query("DELETE FROM audit_event WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_current_publication WHERE organization_id = $1", [ids.organization]);
          await client.query(`DELETE FROM published_knowledge_version
            WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)`, [ids.organization]);
          await client.query(`DELETE FROM review_decision
            WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)`, [ids.organization]);
          await client.query("DELETE FROM shared_submission WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM knowledge_base WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM reviewer_grant WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id IN (SELECT shared_draft_id FROM shared_draft WHERE author_membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM shared_draft WHERE author_membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM draft_version WHERE draft_id IN (SELECT d.draft_id FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id WHERE w.membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM draft_document WHERE workspace_id IN (SELECT workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM private_workspace WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM audience_group_membership WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM audience WHERE organization_id = $1", [ids.organization]);
          await client.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM role_permission WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole, ids.readerAudience]]);
          await client.query("DELETE FROM organization_membership WHERE membership_id = ANY($1::uuid[])", [[ids.ownerMembership, ids.managerMembership]]);
          await client.query("DELETE FROM department WHERE department_id = $1", [ids.department]);
          await client.query("DELETE FROM role WHERE role_id = ANY($1::uuid[])", [[ids.ownerRole, ids.managerRole, ids.readerAudience]]);
          await client.query("DELETE FROM access_scope WHERE access_scope_id = $1", [ids.organizationScope]);
          await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [[ids.owner, ids.manager]]);
          await client.query("DELETE FROM organization WHERE organization_id = $1", [ids.organization]);
          await client.query("ALTER TABLE draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_draft_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE shared_submission ENABLE TRIGGER USER");
          await client.query("ALTER TABLE review_decision ENABLE TRIGGER USER");
          await client.query("ALTER TABLE published_knowledge_version ENABLE TRIGGER USER");
          await client.query("ALTER TABLE knowledge_current_publication ENABLE TRIGGER USER");
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
    const audit = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM arden.audit_event WHERE organization_id = $1 AND event_type LIKE 'PRIVATE_DRAFT_%'`, [ids.organization]);
    expect(audit.rows[0]?.count).toBe("3");
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

  it("approves and publishes a different member's exact snapshot under the runtime RLS role", async () => {
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
      responsibleDepartmentId: ids.department,
      targetScopeType: "ORGANIZATION",
      audienceRoleIds: [ids.readerAudience],
    }, null, "integration-flow2-configure");
    expect(configured).toMatchObject({ kind: "updated", draft: { currentVersion: 2 } });
    if (configured.kind !== "updated") return;

    const submitted = await repository.submitKnowledgeDraft(ids.owner, ids.organization,
      created.draft.id, configured.draft.currentVersion, randomUUID(), "integration-flow2-submit");
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    const grant = await repository.createReviewerGrant(ids.owner, ids.organization, {
      reviewerMembershipId: ids.managerMembership,
      departmentId: ids.department,
      classifications: ["INTERNAL"],
      level: "STANDARD",
      teamTag: null,
      projectTag: null,
      validUntil: null,
    }, "integration-flow2-reviewer-grant");
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
      submission: { status: "APPROVED", publishedVersionId: expect.any(String) },
    });

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
      SELECT event_type, count(*)::text AS count FROM arden.audit_event
       WHERE organization_id = $1 AND event_type IN ('KNOWLEDGE_REVIEW_DECIDED', 'KNOWLEDGE_AUTO_PUBLISHED')
       GROUP BY event_type ORDER BY event_type`, [ids.organization]);
    expect(evidence.rows).toEqual([
      { event_type: "KNOWLEDGE_AUTO_PUBLISHED", count: "1" },
      { event_type: "KNOWLEDGE_REVIEW_DECIDED", count: "1" },
    ]);
  });
});
