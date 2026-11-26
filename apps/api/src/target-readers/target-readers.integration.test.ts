import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { prepareKnowledgeFixture } from "../db/knowledge-fixture.test-support.js";
import { canRead } from "./policy.js";

// Flow 2 T1.1/T1.3/T1.4 against real PostgreSQL. Cleanup disables user triggers and holds
// SHARE ROW EXCLUSIVE locks until commit. vitest.config.ts runs API files one at a time when
// ARDEN_TEST_DATABASE_URL is set, so this cleanup cannot deadlock with another file's writes.
// Requires a disposable, fully migrated database named arden_test_* ; skipped otherwise.
const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;
const id = () => randomUUID();
const ids = {
  orgA: id(), orgB: id(), scopeA: id(), allMembersA: id(),
  author: id(), reviewer: id(), engineer: id(), outsider: id(), suspended: id(), foreign: id(),
  authorM: id(), reviewerM: id(), engineerM: id(), outsiderM: id(), suspendedM: id(), foreignM: id(),
  sales: id(), engineering: id(), archived: id(), departmentB: id(),
  salesRole: id(), engineeringRole: id(), archivedRole: id(), departmentBRole: id(),
};
const userIds = [ids.author, ids.reviewer, ids.engineer, ids.outsider, ids.suspended, ids.foreign];
const membershipIdsA = [ids.authorM, ids.reviewerM, ids.engineerM, ids.outsiderM, ids.suspendedM];
let fixtureReady = false;

async function asSuperuser<T>(work: (client: PoolClient) => Promise<T>, commit = true): Promise<T> {
  if (!pool) throw new Error("Test database is unavailable");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO arden, public");
    const result = await work(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function asRuntime<T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("Test database is unavailable");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE arden_runtime");
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
      [userId, organizationId]);
    return await work(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Runs `work` as superuser and returns the SQLSTATE it fails with (at statement or commit time). */
async function sqlState(work: (client: PoolClient) => Promise<unknown>): Promise<string | null> {
  try {
    await asSuperuser(async (client) => { await work(client); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); }, false);
    return null;
  } catch (error) {
    return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  }
}


describe.skipIf(!databaseUrl)("Target Readers with real PostgreSQL (migration 0024)", () => {
  beforeAll(async () => {
    if (!pool) throw new Error("ARDEN_TEST_DATABASE_URL was not provided");
    const identity = await pool.query<{ database_name: string; is_superuser: boolean }>(`
      SELECT current_database() AS database_name, r.rolsuper AS is_superuser
        FROM pg_roles r WHERE r.rolname = current_user`);
    if (!identity.rows[0]?.database_name.startsWith("arden_test_")) {
      throw new Error("Refusing integration fixtures outside a database named arden_test_*");
    }
    if (!identity.rows[0]?.is_superuser) throw new Error("The isolated integration database connection must be a superuser for fixture cleanup");
    const migrated = await pool.query(`SELECT 1 FROM public.arden_schema_migrations
      WHERE migration_id = '0024_target_reader_selection'`);
    if (migrated.rowCount !== 1) throw new Error("Apply migration 0024 to the isolated test database first");
    const shareNotifications = await pool.query(`SELECT 1 FROM public.arden_schema_migrations
      WHERE migration_id = '0061_document_share_notifications'`);
    if (shareNotifications.rowCount !== 1) throw new Error("Apply migration 0061 to the isolated test database first");

    await asSuperuser(async (client) => {
      await client.query(`INSERT INTO organization (organization_id, name, slug)
        VALUES ($1, 'Readers A', $2), ($3, 'Readers B', $4)`,
      [ids.orgA, `readers-a-${ids.orgA}`, ids.orgB, `readers-b-${ids.orgB}`]);
      for (const userId of userIds) {
        await client.query(`INSERT INTO user_account (user_id, email, full_name) VALUES ($1, $2, 'Synthetic reader')`,
          [userId, `${userId}@example.test`]);
      }
      await client.query(`INSERT INTO organization_membership (membership_id, organization_id, user_id, status)
        VALUES ($1, $7, $8, 'ACTIVE'), ($2, $7, $9, 'ACTIVE'), ($3, $7, $10, 'ACTIVE'), ($4, $7, $11, 'ACTIVE'),
               ($5, $7, $12, 'SUSPENDED'), ($6, $13, $14, 'ACTIVE')`,
      [ids.authorM, ids.reviewerM, ids.engineerM, ids.outsiderM, ids.suspendedM, ids.foreignM,
        ids.orgA, ids.author, ids.reviewer, ids.engineer, ids.outsider, ids.suspended, ids.orgB, ids.foreign]);
      const departments: Array<[string, string, string, string, string]> = [
        [ids.sales, ids.salesRole, ids.orgA, "SALES", "ACTIVE"],
        [ids.engineering, ids.engineeringRole, ids.orgA, "ENG", "ACTIVE"],
        [ids.archived, ids.archivedRole, ids.orgA, "OLD", "ARCHIVED"],
        [ids.departmentB, ids.departmentBRole, ids.orgB, "B", "ACTIVE"],
      ];
      for (const [departmentId, roleId, organizationId, code, status] of departments) {
        await client.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, $3)`,
          [roleId, organizationId, `READERS_${code}_${roleId.replaceAll("-", "").toUpperCase()}`]);
        await client.query(`INSERT INTO department (department_id, organization_id, code, name, default_role_id, status)
          VALUES ($1, $2, $3, $3, $4, $5)`, [departmentId, organizationId, code, roleId, status]);
      }
      await client.query(`INSERT INTO department_membership (membership_id, department_id, is_primary)
        VALUES ($1, $5, true), ($2, $5, true), ($3, $6, true), ($4, $5, true)`,
      [ids.authorM, ids.reviewerM, ids.engineerM, ids.outsiderM, ids.sales, ids.engineering]);
      await client.query(`INSERT INTO access_scope (access_scope_id, organization_id, scope_type) VALUES ($1, $2, 'ORGANIZATION')`,
        [ids.scopeA, ids.orgA]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, role_id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.authorM, ids.scopeA]);
      // Legacy audience path: every active member passes publication RLS, so Target Readers decide.
      await client.query(`INSERT INTO role (role_id, organization_id, code, name)
        VALUES ($1, $2, 'ALL_MEMBERS', 'Everyone in organization')`, [ids.allMembersA, ids.orgA]);
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PUBLISHED_CONTENT_VIEW'`, [ids.allMembersA]);
      await client.query(`INSERT INTO audience (audience_id, organization_id, kind, name, is_managed, legacy_role_id)
        VALUES ($1, $2, 'ORGANIZATION_ALL', 'Everyone in organization', true, $1)`, [ids.allMembersA, ids.orgA]);
    });
    fixtureReady = true;
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      // repository.integration.test.ts cleans up in parallel and also disables triggers; retry a deadlock victim.
      for (let attempt = 1; fixtureReady; attempt += 1) try {
        await asSuperuser(async (client) => {
          // Session-only trigger bypass: no table locks, so it cannot deadlock with the parallel repository suite.
          await client.query("SET LOCAL session_replication_role = replica");
          const orgs = [ids.orgA, ids.orgB];
          await client.query("DELETE FROM audit_event WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM publication_report WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM governance_inspection WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM arden_notification WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM publication_validity_renewal WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM knowledge_current_publication WHERE organization_id = ANY($1::uuid[])", [orgs]);
          // Change requests reference a published version; remove them before the publications.
          await client.query(`DELETE FROM review_decision WHERE submission_id IN (SELECT submission_id FROM shared_submission
            WHERE organization_id = ANY($1::uuid[]) AND request_type <> 'CONTENT')`, [orgs]);
          await client.query(`DELETE FROM shared_submission WHERE organization_id = ANY($1::uuid[])
            AND request_type <> 'CONTENT'`, [orgs]);
          await client.query(`DELETE FROM published_knowledge_version WHERE submission_id IN
            (SELECT submission_id FROM shared_submission WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query(`DELETE FROM knowledge_index_job WHERE generation_id IN
            (SELECT generation_id FROM knowledge_index_generation WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM knowledge_index_generation WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query(`DELETE FROM review_decision WHERE submission_id IN
            (SELECT submission_id FROM shared_submission WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM shared_submission WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM knowledge_base WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM reviewer_grant WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query(`DELETE FROM shared_draft_version WHERE shared_draft_id IN
            (SELECT shared_draft_id FROM shared_draft WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM shared_draft_audience WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM shared_draft WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM selected_reader WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM reader_selection WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM audience WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])", [membershipIdsA]);
          await client.query(`DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])`, [membershipIdsA]);
          await client.query("DELETE FROM organization_membership WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM department WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM role_permission WHERE role_id = $1", [ids.allMembersA]);
          await client.query("DELETE FROM role WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM access_scope WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM organization WHERE organization_id = ANY($1::uuid[])", [orgs]);
        });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "40P01" || attempt >= 3) throw error;
      }
    } finally {
      await pool.end();
    }
  });

  describe("T1.1 schema", () => {
    const insertSelection = (client: PoolClient, mode: string, departmentId: string | null, organizationId = ids.orgA) =>
      client.query<{ selection_id: string }>(`INSERT INTO reader_selection (organization_id, reader_mode, department_id)
        VALUES ($1, $2, $3) RETURNING selection_id`, [organizationId, mode, departmentId]).then(r => r.rows[0]!.selection_id);
    const addReader = (client: PoolClient, selectionId: string, membershipId: string, ordinal: number, organizationId = ids.orgA) =>
      client.query(`INSERT INTO selected_reader (selection_id, organization_id, membership_id, ordinal)
        VALUES ($1, $2, $3, $4)`, [selectionId, organizationId, membershipId, ordinal]);

    it("blocks DEPARTMENT without department_id and a department with another mode (CHECK)", async () => {
      await expect(sqlState((client) => insertSelection(client, "DEPARTMENT", null))).resolves.toBe("23514");
      await expect(sqlState((client) => insertSelection(client, "ORGANIZATION", ids.sales))).resolves.toBe("23514");
      await expect(sqlState((client) => insertSelection(client, "EVERYONE", null))).resolves.toBe("23514");
      await expect(sqlState((client) => insertSelection(client, "DEPARTMENT", ids.sales))).resolves.toBeNull();
    });

    it("enforces UNIQUE (selection_id, membership_id) and the 2-100 reader count at commit", async () => {
      await expect(sqlState(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
        await addReader(client, selectionId, ids.authorM, 2);
      })).resolves.toBe("23505");
      await expect(sqlState(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
      })).resolves.toBe("23514");
      await expect(sqlState(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
        await addReader(client, selectionId, ids.engineerM, 2);
      })).resolves.toBeNull();
    });

    it("rejects archived departments, suspended or foreign readers, and changes to a saved selection", async () => {
      await expect(sqlState((client) => insertSelection(client, "DEPARTMENT", ids.archived))).resolves.toBe("23514");
      // The validation trigger rejects another organization's department/member before the composite FK would.
      await expect(sqlState((client) => insertSelection(client, "DEPARTMENT", ids.departmentB))).resolves.toBe("23514");
      await expect(sqlState(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
        await addReader(client, selectionId, ids.suspendedM, 2);
      })).resolves.toBe("23514");
      await expect(sqlState(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
        await addReader(client, selectionId, ids.foreignM, 2);
      })).resolves.toBe("23514");
      const saved = await asSuperuser(async (client) => {
        const selectionId = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, selectionId, ids.authorM, 1);
        await addReader(client, selectionId, ids.engineerM, 2);
        return selectionId;
      });
      await expect(sqlState((client) => addReader(client, saved, ids.outsiderM, 3))).resolves.toBe("55000");
      await expect(sqlState((client) => client.query(`UPDATE reader_selection SET reader_mode = 'ORGANIZATION'
        WHERE selection_id = $1`, [saved]))).resolves.toBe("55000");
      await expect(sqlState((client) => client.query(`DELETE FROM selected_reader WHERE selection_id = $1`, [saved])))
        .resolves.toBe("55000");
    });

    it("keeps another organization's selections invisible and unwritable to the runtime role (RLS)", async () => {
      const [selectionA, selectionB] = await asSuperuser(async (client) => {
        const a = await insertSelection(client, "SELECTED_MEMBERS", null);
        await addReader(client, a, ids.authorM, 1);
        await addReader(client, a, ids.engineerM, 2);
        const b = await insertSelection(client, "DEPARTMENT", ids.departmentB, ids.orgB);
        return [a, b];
      });
      const fromB = await asRuntime(ids.foreign, ids.orgB, async (client) => ({
        selections: (await client.query(`SELECT selection_id FROM reader_selection WHERE selection_id = ANY($1::uuid[])`,
          [[selectionA, selectionB]])).rows.map(row => row.selection_id),
        readers: (await client.query(`SELECT 1 FROM selected_reader WHERE selection_id = $1`, [selectionA])).rowCount,
        facts: (await client.query(`SELECT * FROM reader_selection_member_facts($1::uuid[])`, [[ids.authorM]])).rowCount,
      }));
      expect(fromB).toEqual({ selections: [selectionB], readers: 0, facts: 0 });
      // Pretending to be in organization A while being a member of B does not help.
      const spoofed = await asRuntime(ids.foreign, ids.orgA, async (client) =>
        (await client.query(`SELECT 1 FROM reader_selection WHERE selection_id = $1`, [selectionA])).rowCount);
      expect(spoofed).toBe(0);
      await expect(asRuntime(ids.foreign, ids.orgB, (client) => client.query(`INSERT INTO reader_selection
        (organization_id, reader_mode) VALUES ($1, 'ORGANIZATION')`, [ids.orgA]))).rejects.toMatchObject({ code: "42501" });
      const fromA = await asRuntime(ids.outsider, ids.orgA, async (client) =>
        (await client.query(`SELECT 1 FROM selected_reader WHERE selection_id = $1`, [selectionA])).rowCount);
      expect(fromA).toBe(2);
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(`UPDATE reader_selection
        SET revision = 2 WHERE selection_id = $1`, [selectionA]))).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("T1.4 draft save, submit freeze and the T1.3 reader actor", () => {
    it("validates, saves, reads back and freezes readers at submit", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const created = await repository.createNewKnowledgeDraft(ids.author, ids.orgA, {
        actorMembershipId: ids.authorM, title: "Department-only runbook", classification: "INTERNAL",
        idempotencyKey: randomUUID(), requestId: "readers-create",
        content: { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: "c".repeat(64) },
      });
      expect(created.kind).toBe("created");
      if (created.kind !== "created") return;
      const draftId = created.draft.id;
      await prepareKnowledgeFixture(pool!, ids.orgA, draftId, [ids.authorM, ids.engineerM], false);
      const save = (version: number, targetReaders: Parameters<ArdenRepository["updateKnowledgeDraft"]>[4]["targetReaders"]) =>
        repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, version, { targetReaders }, null, "readers-save");

      for (const [targetReaders, field] of [
        [{ mode: "SELECTED_MEMBERS" as const, memberIds: [ids.engineerM] }, "targetReaders.memberIds"],
        [{ mode: "SELECTED_MEMBERS" as const, memberIds: Array.from({ length: 101 }, () => randomUUID()) }, "targetReaders.memberIds"],
        [{ mode: "SELECTED_MEMBERS" as const, memberIds: [ids.engineerM, ids.suspendedM] }, "targetReaders.memberIds"],
        [{ mode: "SELECTED_MEMBERS" as const, memberIds: [ids.engineerM, ids.foreignM] }, "targetReaders.memberIds"],
        [{ mode: "DEPARTMENT" as const, departmentId: ids.archived }, "targetReaders.departmentId"],
        [{ mode: "DEPARTMENT" as const, departmentId: ids.departmentB }, "targetReaders.departmentId"],
      ] as const) {
        await expect(save(1, targetReaders)).resolves.toMatchObject({ kind: "invalid-target-readers", field });
      }
      const selected = { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: [ids.outsiderM, ids.engineerM] };
      await expect(save(1, selected)).resolves.toMatchObject({ kind: "updated", draft: { targetReaders: selected } });
      await expect(repository.getKnowledgeDraft(ids.author, ids.orgA, draftId))
        .resolves.toMatchObject({ targetReaders: selected, currentVersion: 2 });

      const configured = await repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, 2, {
        responsibleDepartmentId: ids.sales, targetScopeType: "ORGANIZATION", audienceRoleIds: [ids.allMembersA],
        targetReaders: { mode: "DEPARTMENT", departmentId: ids.engineering },
      }, null, "readers-configure");
      const department = { mode: "DEPARTMENT", departmentId: ids.engineering, memberIds: [] };
      expect(configured).toMatchObject({ kind: "updated", draft: { targetReaders: department } });
      if (configured.kind !== "updated") return;

      const submitted = await repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 3, randomUUID(), "readers-submit");
      expect(submitted).toMatchObject({ kind: "submitted", submission: { proposedTargetReaders: department } });
      if (submitted.kind !== "submitted") return;
      // Drafts stay editable while a snapshot is pending (decision 0011); the submitted readers do not change.
      await expect(save(3, { mode: "ORGANIZATION" })).resolves.toMatchObject({ kind: "updated",
        draft: { targetReaders: { mode: "ORGANIZATION" } } });
      const pending = await repository.listKnowledgeSubmissions(ids.author, ids.orgA);
      expect(pending?.find((item) => item.id === submitted.submission.id)?.proposedTargetReaders).toEqual(department);
      await expect(sqlState((client) => client.query(`UPDATE shared_submission SET proposed_selection_id = NULL
        WHERE submission_id = $1`, [submitted.submission.id]))).resolves.toBe("55000");
      // Approved readers are recorded only by an approval decision, and only once (0025).
      await expect(sqlState(async (client) => {
        await client.query(`UPDATE shared_submission SET approved_selection_id = proposed_selection_id
          WHERE submission_id = $1`, [submitted.submission.id]);
        await client.query(`UPDATE shared_submission SET approved_selection_id = NULL
          WHERE submission_id = $1`, [submitted.submission.id]);
      })).resolves.toBe("55000");
    });

    it("resolves the reader actor from active membership and current departments only", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await expect(repository.getTargetReaderActor(ids.engineer, ids.orgA)).resolves.toEqual({
        membershipId: ids.engineerM, organizationId: ids.orgA, status: "ACTIVE", departmentIds: [ids.engineering] });
      await expect(repository.getTargetReaderActor(ids.suspended, ids.orgA)).resolves.toMatchObject({ status: "SUSPENDED" });
      await expect(repository.getTargetReaderActor(ids.foreign, ids.orgA)).resolves.toBeNull();
      const actor = await repository.getTargetReaderActor(ids.outsider, ids.orgA);
      expect(canRead(actor, { organizationId: ids.orgA,
        readers: { mode: "DEPARTMENT", departmentId: ids.engineering, memberIds: [] } })).toBe(false);
    });
  });

  const createDraft = async (userId: string, organizationId: string, membershipId: string, title: string) => {
    if (!repository) throw new Error("Test database is unavailable");
    const created = await repository.createNewKnowledgeDraft(userId, organizationId, {
      actorMembershipId: membershipId, title, classification: "INTERNAL",
      idempotencyKey: randomUUID(), requestId: "flow2-create",
      content: { sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain", contentHash: "d".repeat(64) },
    });
    if (created.kind !== "created") throw new Error(`Draft fixture failed: ${created.kind}`);
    return created.draft.id;
  };

  /** A pending submission with canonical intake fields and the fixture's legacy review projection. */
  const submitLegacyDraft = async (title: string) => {
    if (!repository) throw new Error("Test database is unavailable");
    const draftId = await createDraft(ids.author, ids.orgA, ids.authorM, title);
    const configured = await repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, 1, {
      responsibleDepartmentId: ids.sales, targetScopeType: "ORGANIZATION", audienceRoleIds: [ids.allMembersA],
    }, null, "flow2-configure");
    if (configured.kind !== "updated") throw new Error(`Configure fixture failed: ${configured.kind}`);
    await prepareKnowledgeFixture(pool!, ids.orgA, draftId, [ids.authorM, ids.engineerM]);
    const submitted = await repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 2, randomUUID(), "flow2-submit");
    if (submitted.kind !== "submitted") throw new Error(`Submit fixture failed: ${submitted.kind}`);
    return { draftId, submissionId: submitted.submission.id };
  };

  describe("T3.1 categories, document metadata and relationships (migration 0027)", () => {
    it("gives a new organization the five default categories, including one created by the runtime role", async () => {
      const organizationId = id();
      const codes = await asRuntime(ids.outsider, "", async (client) => {
        await client.query("SELECT set_config('arden.organization_id', '', true)");
        await client.query(`INSERT INTO organization (organization_id, name, slug, created_by_user_id)
          VALUES ($1, 'Category fixture', $2, $3)`, [organizationId, `category-${organizationId}`, ids.outsider]);
        await client.query("RESET ROLE");
        return (await client.query<{ code: string; is_default: boolean }>(`SELECT code, is_default
          FROM document_category WHERE organization_id = $1 ORDER BY sort_order`, [organizationId])).rows;
      });
      expect(codes).toEqual([
        { code: "POLICY", is_default: false }, { code: "PROCEDURE", is_default: false },
        { code: "GUIDE", is_default: false }, { code: "REFERENCE", is_default: false },
        { code: "GENERAL", is_default: true }]);
      const fixtureOrganizations = await asSuperuser((client) => client.query<{ organization_id: string; categories: string }>(`
        SELECT o.organization_id, count(c.category_id)::text AS categories FROM organization o
          LEFT JOIN document_category c ON c.organization_id = o.organization_id
         WHERE o.organization_id = ANY($1::uuid[]) GROUP BY o.organization_id`, [[ids.orgA, ids.orgB]]));
      expect(fixtureOrganizations.rows.map((row) => row.categories)).toEqual(["5", "5"]);
    });

    it("leaves no document that existed before 0027 without a category", async () => {
      const missing = await asSuperuser((client) => client.query(`SELECT d.shared_draft_id FROM shared_draft d
        JOIN public.arden_schema_migrations m ON m.migration_id = '0027_document_category_relationships'
       WHERE d.created_at < m.applied_at AND d.category_id IS NULL`));
      expect(missing.rowCount).toBe(0);
    });

    it("lets members read only their organization's categories and validates keywords", async () => {
      const visible = await asRuntime(ids.engineer, ids.orgA, (client) => client.query<{ organization_id: string }>(
        "SELECT DISTINCT organization_id FROM document_category"));
      expect(visible.rows).toEqual([{ organization_id: ids.orgA }]);
      await expect(asRuntime(ids.engineer, ids.orgB, (client) => client.query("SELECT 1 FROM document_category")))
        .resolves.toMatchObject({ rowCount: 0 });
      const draftId = await createDraft(ids.author, ids.orgA, ids.authorM, "Keyword fixture");
      for (const keywords of [["  padded"], ["dup", "DUP"], [""], Array.from({ length: 21 }, (_, n) => `k${n}`)]) {
        await expect(sqlState((client) => client.query("UPDATE shared_draft SET keywords = $2 WHERE shared_draft_id = $1",
          [draftId, keywords]))).resolves.toBe("23514");
      }
      await expect(sqlState((client) => client.query(`UPDATE shared_draft SET keywords = $2,
        category_id = (SELECT category_id FROM document_category WHERE organization_id = $3 AND code = 'POLICY')
        WHERE shared_draft_id = $1`, [draftId, ["onboarding", "VPN"], ids.orgA]))).resolves.toBeNull();
      await expect(sqlState((client) => client.query(`UPDATE shared_draft SET
        category_id = (SELECT category_id FROM document_category WHERE organization_id = $2 AND code = 'POLICY')
        WHERE shared_draft_id = $1`, [draftId, ids.orgB]))).resolves.toBe("23503");
    });

    it("links documents of one organization only, and only by the source document's author", async () => {
      const source = await createDraft(ids.author, ids.orgA, ids.authorM, "Link source");
      const target = await createDraft(ids.author, ids.orgA, ids.authorM, "Link target");
      const foreign = await createDraft(ids.foreign, ids.orgB, ids.foreignM, "Foreign target");
      const link = (client: PoolClient, organizationId: string, to: string, by = ids.authorM) => client.query(`
        INSERT INTO document_relationship (organization_id, source_document_id, target_document_id, created_by_membership_id)
        VALUES ($1, $2, $3, $4)`, [organizationId, source, to, by]);
      await expect(sqlState((client) => link(client, ids.orgA, foreign))).resolves.toBe("23503");
      await expect(sqlState((client) => link(client, ids.orgB, foreign, ids.foreignM))).resolves.toBe("23503");
      await expect(sqlState((client) => link(client, ids.orgA, source))).resolves.toBe("23514");
      await expect(asRuntime(ids.outsider, ids.orgA, (client) => link(client, ids.orgA, target, ids.outsiderM)))
        .rejects.toMatchObject({ code: "42501" });
      await expect(asRuntime(ids.author, ids.orgA, async (client) => {
        await link(client, ids.orgA, target);
        return (await client.query("SELECT target_document_id FROM document_relationship WHERE source_document_id = $1",
          [source])).rows;
      })).resolves.toEqual([{ target_document_id: target }]);
    });
  });

  describe("T1.2 legacy audiences to Target Readers (migration 0028)", () => {
    const groupRole = id();
    const emptyRole = id();
    const scopes = { sales: id(), engineering: id() };
    const fixturePublications: string[] = [];

    /** A legacy current publication (readers NULL). Only the columns the backfill reads are meaningful. */
    const legacyPublication = (scope: "ORGANIZATION" | "DEPARTMENT", departmentId: string | null, roleIds: string[]) =>
      asSuperuser(async (client) => {
        const draftId = id();
        const versionId = id();
        // validate_current_publication re-checks the pointer against its knowledge base on every update.
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope_type, department_id) VALUES ($1, 'Legacy fixture ' || $4, $2, $3)
          RETURNING knowledge_base_id`, [ids.orgA, scope, departmentId, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_knowledge_version (published_version_id, submission_id, knowledge_base_id,
            title, version_no, content_uri, content_hash, shared_draft_id, classification, responsible_department_id,
            audience_role_ids, valid_from)
          VALUES ($1, $2, $3, 'Legacy publication', 1, 'arden-private-object://legacy', $4, $5, 'INTERNAL', $6, $7::uuid[], now())`,
        [versionId, id(), knowledgeBase.rows[0]?.knowledge_base_id, "e".repeat(64), draftId, ids.sales, roleIds]);
        await client.query(`INSERT INTO knowledge_current_publication (shared_draft_id, organization_id, published_version_id,
            audience_role_ids, target_scope_type, target_department_id, valid_from)
          VALUES ($1, $2, $3, $4::uuid[], $5, $6, now())`, [draftId, ids.orgA, versionId, roleIds, scope, departmentId]);
        fixturePublications.push(versionId);
        return draftId;
      });

    const report = (apply: boolean) => asSuperuser((client) => client.query<{ shared_draft_id: string; outcome: string;
      reader_mode: string | null; audience_readers: number; target_readers: number; wider_readers: number }>(
      "SELECT * FROM migrate_publication_readers($1, $2)", [apply, ids.orgA]));

    beforeAll(async () => {
      if (!fixtureReady) return;
      await asSuperuser(async (client) => {
        await client.query(`INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $3, $4, 'Group'), ($2, $3, $5, 'Empty')`,
          [groupRole, emptyRole, ids.orgA, `GROUP_${groupRole.slice(0, 8).toUpperCase()}`, `EMPTY_${emptyRole.slice(0, 8).toUpperCase()}`]);
        await client.query(`INSERT INTO role_permission (role_id, permission_id)
          SELECT role_id, permission_id FROM unnest($1::uuid[]) AS role_id
            CROSS JOIN permission WHERE code = 'PUBLISHED_CONTENT_VIEW'`,
        [[groupRole, emptyRole, ids.salesRole, ids.engineeringRole]]);
        await client.query(`INSERT INTO access_scope (access_scope_id, organization_id, scope_type, department_id)
          VALUES ($1, $3, 'DEPARTMENT', $4), ($2, $3, 'DEPARTMENT', $5)`,
        [scopes.sales, scopes.engineering, ids.orgA, ids.sales, ids.engineering]);
        // Sales readers: author and reviewer hold the department role; outsider is in Sales but does not.
        await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
          VALUES ($1, $4, $6), ($2, $4, $6), ($3, $5, $7), ($3, $8, $9)`,
        [ids.authorM, ids.reviewerM, ids.engineerM, ids.salesRole, ids.engineeringRole, scopes.sales, scopes.engineering,
          groupRole, ids.scopeA]);
      });
    });

    afterAll(async () => {
      if (!fixtureReady) return;
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM knowledge_current_publication WHERE published_version_id = ANY($1::uuid[])", [fixturePublications]);
        await client.query("DELETE FROM published_knowledge_version WHERE published_version_id = ANY($1::uuid[])", [fixturePublications]);
        await client.query("DELETE FROM role_assignment WHERE role_id = ANY($1::uuid[])", [[groupRole, ids.salesRole, ids.engineeringRole]]);
        await client.query("DELETE FROM role_permission WHERE role_id = ANY($1::uuid[])",
          [[groupRole, emptyRole, ids.salesRole, ids.engineeringRole]]);
        await client.query("DELETE FROM access_scope WHERE access_scope_id = ANY($1::uuid[])", [[scopes.sales, scopes.engineering]]);
      });
    });

    it("maps every publication without widening its readers and reports before/after counts", async () => {
      const organizationWide = await legacyPublication("ORGANIZATION", null, [ids.allMembersA]);
      const engineering = await legacyPublication("DEPARTMENT", ids.engineering, [ids.engineeringRole]);
      const partialSales = await legacyPublication("DEPARTMENT", ids.sales, [ids.salesRole]);
      const oneMemberGroup = await legacyPublication("ORGANIZATION", null, [groupRole]);
      const nobody = await legacyPublication("ORGANIZATION", null, [emptyRole]);
      const expected = {
        [organizationWide]: { reader_mode: "ORGANIZATION", audience_readers: 4, target_readers: 4 },
        [engineering]: { reader_mode: "DEPARTMENT", audience_readers: 1, target_readers: 1 },
        // Outsider is in Sales without the role today, so DEPARTMENT would widen: keep the exact readers.
        [partialSales]: { reader_mode: "SELECTED_MEMBERS", audience_readers: 2, target_readers: 2 },
        [oneMemberGroup]: { reader_mode: null, audience_readers: 1, target_readers: 0 },
        [nobody]: { reader_mode: null, audience_readers: 0, target_readers: 0 },
      };
      const rows = (result: Awaited<ReturnType<typeof report>>) =>
        Object.fromEntries(result.rows.filter((row) => row.shared_draft_id in expected).map((row) => [row.shared_draft_id, row]));

      const dryRun = rows(await report(false));
      for (const [draftId, row] of Object.entries(expected)) {
        expect(dryRun[draftId]).toMatchObject({ ...row, wider_readers: 0,
          outcome: row.reader_mode ? "WOULD_MAP" : "UNMAPPED" });
      }
      const unchanged = await asSuperuser((client) => client.query(`SELECT 1 FROM knowledge_current_publication
        WHERE shared_draft_id = ANY($1::uuid[]) AND reader_selection_id IS NOT NULL`, [Object.keys(expected)]));
      expect(unchanged.rowCount).toBe(0);

      const applied = rows(await report(true));
      for (const [draftId, row] of Object.entries(expected)) {
        expect(applied[draftId]).toMatchObject({ ...row, wider_readers: 0, outcome: row.reader_mode ? "MAPPED" : "UNMAPPED" });
      }
      const after = rows(await report(false));
      for (const [draftId, row] of Object.entries(expected)) {
        expect(after[draftId]).toMatchObject({ ...row, wider_readers: 0, outcome: row.reader_mode ? "ALREADY_SET" : "UNMAPPED" });
      }
      const stored = await asSuperuser((client) => client.query<{ shared_draft_id: string; members: string[] }>(`
        SELECT cp.shared_draft_id, ARRAY(SELECT sr.membership_id::text FROM selected_reader sr
                 WHERE sr.selection_id = cp.reader_selection_id ORDER BY sr.membership_id) AS members
          FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
                                             AND pv.reader_selection_id = cp.reader_selection_id
         WHERE cp.shared_draft_id = $1`, [partialSales]));
      expect(stored.rows[0]?.members).toEqual([ids.authorM, ids.reviewerM].sort());
      // Effective access only narrows: the outsider never had the Sales role and still cannot read it.
      const outsiderView = await asRuntime(ids.outsider, ids.orgA, (client) => client.query(
        "SELECT shared_draft_id FROM knowledge_current_publication WHERE shared_draft_id = ANY($1::uuid[])",
        [[organizationWide, partialSales]]));
      expect(outsiderView.rows).toEqual([{ shared_draft_id: organizationWide }]);

      // After cutover the frozen selection, not a legacy role assignment, is authoritative.
      const selectedView = () => asRuntime(ids.author, ids.orgA, (client) => client.query(
        "SELECT shared_draft_id FROM knowledge_current_publication WHERE shared_draft_id = $1", [partialSales]));
      expect((await selectedView()).rows).toEqual([{ shared_draft_id: partialSales }]);
      try {
        const revoked = await asSuperuser((client) => client.query(`UPDATE role_assignment SET status = 'REVOKED'
          WHERE membership_id = $1 AND role_id = $2 AND access_scope_id = $3`,
        [ids.authorM, ids.salesRole, scopes.sales]));
        expect(revoked.rowCount).toBe(1);
        const legacyReaders = await asSuperuser((client) => client.query<{ membership_id: string }>(`
          SELECT audience_reader_memberships($1, $2::uuid[], 'DEPARTMENT', $3) AS membership_id`,
        [ids.orgA, [ids.salesRole], ids.sales]));
        expect(legacyReaders.rows.map((row) => row.membership_id)).not.toContain(ids.authorM);
        expect((await selectedView()).rows).toEqual([{ shared_draft_id: partialSales }]);
        const denied = await asRuntime(ids.outsider, ids.orgA, (client) => client.query(
          "SELECT shared_draft_id FROM knowledge_current_publication WHERE shared_draft_id = $1", [partialSales]));
        expect(denied.rows).toEqual([]);
      } finally {
        await asSuperuser((client) => client.query(`UPDATE role_assignment SET status = 'ACTIVE'
          WHERE membership_id = $1 AND role_id = $2 AND access_scope_id = $3`,
        [ids.authorM, ids.salesRole, scopes.sales]));
      }
    });

    it("runs only for the trusted operator role", async () => {
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query("SELECT * FROM migrate_publication_readers(false)")))
        .rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("T5.1 withdraw a pending submission (migration 0029)", () => {
    it("withdraws only the author's pending submission, once, and refuses a decided one", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, submissionId } = await submitLegacyDraft("Withdrawal fixture");
      await expect(repository.withdrawKnowledgeSubmission(ids.outsider, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawKnowledgeSubmission(ids.foreign, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toMatchObject({ kind: "withdrawn", submission: { id: submissionId, status: "WITHDRAWN" } });
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toMatchObject({ kind: "replayed", submission: { status: "WITHDRAWN" } });
      const evidence = await asSuperuser((client) => client.query<{ pending: string; audits: string }>(`
        SELECT (SELECT count(*) FROM shared_submission WHERE shared_draft_id = $1 AND status = 'PENDING_REVIEW')::text AS pending,
               (SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_SUBMISSION_WITHDRAWN'
                  AND details_json->>'submissionId' = $2)::text AS audits`, [draftId, submissionId]));
      expect(evidence.rows[0]).toEqual({ pending: "0", audits: "1" });
      // A withdrawal is final, even for the database owner.
      await expect(sqlState((client) => client.query(`UPDATE shared_submission SET status = 'PENDING_REVIEW'
        WHERE submission_id = $1`, [submissionId]))).resolves.toBe("55000");
    });

    it("returns a conflict for an approved submission and blocks a direct runtime withdrawal by others", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const approved = await submitLegacyDraft("Approved fixture");
      await asSuperuser((client) => client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'PREPARING',
        approved_selection_id = proposed_selection_id
        WHERE submission_id = $1`, [approved.submissionId]));
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, approved.submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "conflict" });
      await expect(sqlState((client) => client.query(`UPDATE shared_submission SET status = 'WITHDRAWN', publication_state = 'NONE'
        WHERE submission_id = $1`, [approved.submissionId]))).resolves.toBe("55000");

      const pending = await submitLegacyDraft("Pending fixture");
      const changed = await asRuntime(ids.reviewer, ids.orgA, (client) => client.query(`UPDATE shared_submission
        SET status = 'WITHDRAWN' WHERE submission_id = $1`, [pending.submissionId]));
      expect(changed.rowCount).toBe(0);
    });
  });

  describe("T6.1 reader-change and withdrawal requests (migrations 0034–0035)", () => {
    /** Publishes a real approved submission by pointing the current publication at it (no index pipeline). */
    const publish = async (title: string) => {
      const { draftId, submissionId } = await submitLegacyDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_selection_id = proposed_selection_id WHERE submission_id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope_type) VALUES ($1, 'Change fixture ' || $2, 'ORGANIZATION')
          RETURNING knowledge_base_id`, [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_knowledge_version (published_version_id, submission_id, knowledge_base_id,
            title, version_no, content_uri, content_hash, shared_draft_id, classification, responsible_department_id,
            audience_role_ids, valid_from, reader_selection_id)
          SELECT $1, s.submission_id, $3, s.title, 1, s.content_uri, s.content_hash, s.shared_draft_id, s.classification,
                 s.responsible_department_id, s.audience_role_ids, now(), s.approved_selection_id
            FROM shared_submission s WHERE s.submission_id = $2`,
        [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
        await client.query(`INSERT INTO knowledge_current_publication (shared_draft_id, organization_id, published_version_id,
            audience_role_ids, target_scope_type, valid_from, reader_selection_id)
          SELECT pv.shared_draft_id, $2, pv.published_version_id, pv.audience_role_ids, 'ORGANIZATION', pv.valid_from,
                 pv.reader_selection_id FROM published_knowledge_version pv WHERE pv.published_version_id = $1`,
        [versionId, ids.orgA]);
      });
      return { draftId, submissionId, versionId };
    };
    const currentPointer = (draftId: string) => asSuperuser(async (client) => (await client.query(
      "SELECT published_version_id, reader_selection_id FROM knowledge_current_publication WHERE shared_draft_id = $1",
      [draftId])).rows[0]);
    const ask = (draftId: string, input: Omit<Parameters<ArdenRepository["requestPublicationChange"]>[3], "idempotencyKey">,
      key = randomUUID(), userId = ids.author) =>
      repository!.requestPublicationChange(userId, ids.orgA, draftId, { ...input, idempotencyKey: key }, "change-request");

    it("records a withdrawal request without changing the publication and lists it with its type", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publish("Published for withdrawal");
      const before = await currentPointer(draftId);
      const unpublished = await createDraft(ids.author, ids.orgA, ids.authorM, "Never published");
      await expect(ask(unpublished, { type: "WITHDRAWAL", reason: "Outdated" })).resolves.toEqual({ kind: "not-published" });
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "Outdated" }, randomUUID(), ids.outsider))
        .resolves.toEqual({ kind: "not-found" });
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "  " })).resolves.toMatchObject({ kind: "invalid-request" });
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "Outdated", targetReaders: { mode: "ORGANIZATION" } }))
        .resolves.toMatchObject({ kind: "invalid-request" });

      const key = randomUUID();
      const requested = await ask(draftId, { type: "WITHDRAWAL", reason: " The policy was replaced " }, key);
      expect(requested).toMatchObject({ kind: "requested", submission: { status: "PENDING_REVIEW",
        requestType: "WITHDRAWAL", requestReason: "The policy was replaced", proposedTargetReaders: null } });
      if (requested.kind !== "requested") return;
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "The policy was replaced" }, key))
        .resolves.toMatchObject({ kind: "replayed", submission: { id: requested.submission.id } });
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "Again" })).resolves.toEqual({ kind: "conflict" });
      await expect(currentPointer(draftId)).resolves.toEqual(before);
      const stored = await asSuperuser((client) => client.query(`SELECT target_published_version_id FROM shared_submission
        WHERE submission_id = $1`, [requested.submission.id]));
      expect(stored.rows[0]).toEqual({ target_published_version_id: versionId });

      // The author is an Organization Admin here, so their own request is in their queue.
      const queue = await repository.listAssignedReviews(ids.author, ids.orgA);
      expect(queue?.find((item) => item.submissionId === requested.submission.id)).toMatchObject({ requestType: "WITHDRAWAL" });
      const submission = requested.submission;
      await expect(repository.decideReview(ids.author, ids.orgA, submission.id, "REJECT", submission.snapshotVersionId,
        submission.contentHash, "Keep it published", randomUUID(), "change-reject"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "REJECTED", requestType: "WITHDRAWAL" } });
      await expect(currentPointer(draftId)).resolves.toEqual(before);
    });

    it("records a reader-change request with valid new readers and keeps the current readers", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId } = await publish("Published for reader change");
      const before = await currentPointer(draftId);
      await expect(ask(draftId, { type: "READER_CHANGE", reason: "Narrow it" })).resolves.toMatchObject({ kind: "invalid-request" });
      await expect(ask(draftId, { type: "READER_CHANGE", reason: "Narrow it",
        targetReaders: { mode: "SELECTED_MEMBERS", memberIds: [ids.engineerM] } }))
        .resolves.toMatchObject({ kind: "invalid-target-readers", field: "targetReaders.memberIds" });
      const readers = { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: [ids.engineerM, ids.outsiderM] };
      const requested = await ask(draftId, { type: "READER_CHANGE", reason: "Only the rollout team", targetReaders: readers });
      expect(requested).toMatchObject({ kind: "requested", submission: { requestType: "READER_CHANGE",
        proposedTargetReaders: readers, approvedTargetReaders: null } });
      await expect(currentPointer(draftId)).resolves.toEqual(before);
      // The author may still withdraw the pending request (T5.1).
      if (requested.kind !== "requested") return;
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, requested.submission.id, "change-withdraw"))
        .resolves.toMatchObject({ kind: "withdrawn" });
    });

    it("T6.2: an approved withdrawal removes the document at once and republishing needs a new submission", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, submissionId, versionId } = await publish("Published then withdrawn");
      const requested = await ask(draftId, { type: "WITHDRAWAL", reason: "Superseded by the new handbook" });
      if (requested.kind !== "requested") throw new Error("Request failed");
      const visible = async (userId: string) => (await asRuntime(userId, ids.orgA, (client) => client.query(
        "SELECT 1 FROM knowledge_current_publication WHERE shared_draft_id = $1", [draftId]))).rowCount;
      expect(await visible(ids.engineer)).toBe(1);

      const approved = await repository.decideReview(ids.author, ids.orgA, requested.submission.id, "APPROVE",
        requested.submission.snapshotVersionId, requested.submission.contentHash, null, randomUUID(), "withdraw-approve");
      expect(approved).toMatchObject({ kind: "decided", submission: { status: "APPROVED", requestType: "WITHDRAWAL",
        publicationState: "NONE" } });
      // On the next request: no current pointer, so no library entry, detail, Ask Arden source or citation.
      await expect(currentPointer(draftId)).resolves.toBeUndefined();
      expect(await visible(ids.engineer)).toBe(0);
      const library = await repository.listPublishedKnowledge(ids.engineer, ids.orgA);
      expect(library?.some((item) => item.id === versionId)).toBe(false);
      await expect(repository.getPublishedKnowledge(ids.engineer, ids.orgA, versionId)).resolves.toBeNull();
      const released = await asSuperuser((client) => client.query(
        "SELECT publication_state FROM shared_submission WHERE submission_id = $1", [submissionId]));
      expect(released.rows[0]).toEqual({ publication_state: "WITHDRAWN" });
      const audit = await asSuperuser((client) => client.query(`SELECT details_json->>'requestType' AS type FROM audit_event
        WHERE event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND details_json->>'submissionId' = $1`, [requested.submission.id]));
      expect(audit.rows).toEqual([{ type: "WITHDRAWAL" }]);

      // No restore: the approved request cannot be applied again, and a new request needs a publication.
      await expect(sqlState((client) => client.query("SELECT apply_publication_change($1)", [requested.submission.id])))
        .resolves.toBe("55000");
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "Again" })).resolves.toEqual({ kind: "not-published" });
      // Publishing again is a new content submission of a new version.
      const edited = await repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, 2, { title: "Published again" },
        null, "republish-edit");
      // A new business version with a Change Note, set like prepareKnowledgeFixture (this fixture keeps its audiences).
      await asSuperuser((client) => client.query(`UPDATE shared_draft SET management = management
        || jsonb_build_object('version', '2.0', 'changeNote', 'Republished after review') WHERE shared_draft_id = $1`, [draftId]));
      if (edited.kind !== "updated") throw new Error("Edit failed");
      await expect(repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 3, randomUUID(), "republish"))
        .resolves.toMatchObject({ kind: "submitted", submission: { requestType: "CONTENT", status: "PENDING_REVIEW" } });
    });

    it("T6.2: an approved reader change applies the approved readers to the current publication", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publish("Published then narrowed");
      const activationNotifications = await asSuperuser((client) => client.query(`
        SELECT notification_id FROM arden_notification
         WHERE organization_id = $1 AND event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
           AND resource_id = $2`, [ids.orgA, versionId]));
      expect(activationNotifications.rows).toEqual([]);
      const before = await currentPointer(draftId);
      const readers = { mode: "SELECTED_MEMBERS" as const, departmentId: null,
        memberIds: [ids.engineerM, ids.outsiderM, ids.authorM].sort() };
      const requested = await ask(draftId, { type: "READER_CHANGE", reason: "Only the rollout team", targetReaders: readers });
      if (requested.kind !== "requested") throw new Error("Request failed");
      const decided = await repository.decideReview(ids.author, ids.orgA, requested.submission.id, "APPROVE",
        requested.submission.snapshotVersionId, requested.submission.contentHash, null, randomUUID(), "readers-approve");
      expect(decided).toMatchObject({ kind: "decided", submission: { approvedTargetReaders: readers } });
      const after = await currentPointer(draftId);
      expect(after?.published_version_id).toBe(before?.published_version_id);
      expect(after?.reader_selection_id).not.toBe(before?.reader_selection_id);
      const personalShareNotifications = await asSuperuser((client) => client.query<{
        event_type: string; recipient_membership_id: string; publication_title: string; shared_by_name: string; has_outbox: boolean;
      }>(`SELECT n.event_type, n.recipient_membership_id, n.publication_title, n.shared_by_name,
                  EXISTS (SELECT 1 FROM arden_notification_outbox o WHERE o.notification_id = n.notification_id) AS has_outbox
            FROM arden_notification n
           WHERE n.organization_id = $1 AND n.event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
             AND n.resource_type = 'PUBLICATION' AND n.resource_id = $2
           ORDER BY n.recipient_membership_id`, [ids.orgA, versionId]));
      expect(personalShareNotifications.rows).toHaveLength(2);
      expect(personalShareNotifications.rows).toEqual(expect.arrayContaining([
        { event_type: "DOCUMENT_SHARED_PERSONAL", recipient_membership_id: ids.engineerM,
          publication_title: "Published then narrowed", shared_by_name: "Synthetic reader", has_outbox: true },
        { event_type: "DOCUMENT_SHARED_PERSONAL", recipient_membership_id: ids.outsiderM,
          publication_title: "Published then narrowed", shared_by_name: "Synthetic reader", has_outbox: true },
      ]));
      // The version and content stay; only the readers changed, effective on the next request.
      const see = async (userId: string) => (await repository.getPublishedKnowledge(userId, ids.orgA, versionId))?.id ?? null;
      await expect(see(ids.engineer)).resolves.toBe(versionId);
      await expect(see(ids.reviewer)).resolves.toBeNull();
      const library = await repository.listPublishedKnowledge(ids.engineer, ids.orgA);
      expect(library?.find((item) => item.id === versionId)?.targetReaders).toMatchObject({ mode: "SELECTED_MEMBERS" });

      // A later approval removes the engineer. Replaying the older approved request must not restore them,
      // even when called directly by the original Organization Admin through the runtime role.
      const narrower = await ask(draftId, { type: "READER_CHANGE", reason: "Restrict the rollout",
        targetReaders: { mode: "SELECTED_MEMBERS", memberIds: [ids.outsiderM, ids.authorM] } });
      if (narrower.kind !== "requested") throw new Error("Request failed");
      await expect(repository.decideReview(ids.author, ids.orgA, narrower.submission.id, "APPROVE",
        narrower.submission.snapshotVersionId, narrower.submission.contentHash, null, randomUUID(), "readers-narrow"))
        .resolves.toMatchObject({ kind: "decided" });
      const afterNarrowingNotifications = await asSuperuser((client) => client.query<{
        event_type: string; recipient_membership_id: string;
      }>(`
        SELECT event_type, recipient_membership_id FROM arden_notification
         WHERE organization_id = $1 AND event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
           AND resource_type = 'PUBLICATION' AND resource_id = $2
         ORDER BY recipient_membership_id`, [ids.orgA, versionId]));
      expect(afterNarrowingNotifications.rows).toHaveLength(3);
      expect(afterNarrowingNotifications.rows.every(row => row.event_type === "DOCUMENT_SHARED_PERSONAL")).toBe(true);
      expect(afterNarrowingNotifications.rows.map(row => row.recipient_membership_id).sort())
        .toEqual([ids.engineerM, ids.outsiderM, ids.outsiderM].sort());
      await expect(see(ids.engineer)).resolves.toBeNull();
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(
        "SELECT apply_publication_change($1)", [requested.submission.id])))
        .rejects.toMatchObject({ code: "55000" });
      await expect(see(ids.engineer)).resolves.toBeNull();
    });

    it("emits a group-share event for the approved department reader selection", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publish("Published for group share");
      await asSuperuser(async (client) => {
        const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_selection
          (organization_id, reader_mode) VALUES ($1, 'ORGANIZATION') RETURNING selection_id`, [ids.orgA]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE published_knowledge_version SET reader_selection_id = $2 WHERE published_version_id = $1",
          [versionId, selection.rows[0]!.selection_id]);
        await client.query("UPDATE knowledge_current_publication SET reader_selection_id = $2 WHERE published_version_id = $1",
          [versionId, selection.rows[0]!.selection_id]);
      });
      const requested = await ask(draftId, { type: "READER_CHANGE", reason: "Share with Sales",
        targetReaders: { mode: "DEPARTMENT", departmentId: ids.sales } });
      if (requested.kind !== "requested") throw new Error("Request failed");
      await expect(repository.decideReview(ids.author, ids.orgA, requested.submission.id, "APPROVE",
        requested.submission.snapshotVersionId, requested.submission.contentHash, null, randomUUID(), "group-share-approve"))
        .resolves.toMatchObject({ kind: "decided", submission: { approvedTargetReaders: { mode: "DEPARTMENT", departmentId: ids.sales } } });
      const groupNotifications = await asSuperuser((client) => client.query<{
        event_type: string; recipient_membership_id: string; publication_title: string; shared_by_name: string;
      }>(`SELECT event_type, recipient_membership_id, publication_title, shared_by_name FROM arden_notification
           WHERE organization_id = $1 AND resource_id = $2
           ORDER BY recipient_membership_id`, [ids.orgA, versionId]));
      expect(groupNotifications.rows).toHaveLength(2);
      expect(groupNotifications.rows).toEqual(expect.arrayContaining([
        { event_type: "DOCUMENT_SHARED_GROUP", recipient_membership_id: ids.reviewerM,
          publication_title: "Published for group share", shared_by_name: "Synthetic reader" },
        { event_type: "DOCUMENT_SHARED_GROUP", recipient_membership_id: ids.outsiderM,
          publication_title: "Published for group share", shared_by_name: "Synthetic reader" },
      ]));
    });

    it("T6.2: refuses to approve a request whose publication is no longer current", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId } = await publish("Published then replaced");
      const requested = await ask(draftId, { type: "WITHDRAWAL", reason: "Outdated" });
      if (requested.kind !== "requested") throw new Error("Request failed");
      // Simulate the pointer leaving the requested version (for example an Org Admin emergency withdrawal).
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM knowledge_current_publication WHERE shared_draft_id = $1", [draftId]);
      });
      await expect(repository.decideReview(ids.author, ids.orgA, requested.submission.id, "APPROVE",
        requested.submission.snapshotVersionId, requested.submission.contentHash, null, randomUUID(), "stale-approve"))
        .resolves.toEqual({ kind: "denied", reason: "PUBLICATION_CHANGED" });
      await expect(repository.decideReview(ids.author, ids.orgA, requested.submission.id, "REJECT",
        requested.submission.snapshotVersionId, requested.submission.contentHash, "Already gone", randomUUID(), "stale-reject"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "REJECTED" } });
    });

    it("refuses a change request that does not repeat the current publication", async () => {
      const { draftId, submissionId } = await publish("Published for integrity");
      await expect(sqlState((client) => client.query(`INSERT INTO shared_submission (organization_id, shared_draft_id,
          shared_draft_version_id, snapshot_version_no, submitted_by_membership_id, target_scope_type, responsible_department_id,
          title, classification, audience_role_ids, policy_version, content_uri, mime_type, content_hash, submit_request_id,
          request_type, request_reason, target_published_version_id)
        SELECT organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no, $2, target_scope_type,
               responsible_department_id, title, classification, audience_role_ids, 1, content_uri, mime_type, content_hash,
               gen_random_uuid(), 'WITHDRAWAL', 'Not the author', (SELECT published_version_id FROM knowledge_current_publication
                 WHERE shared_draft_id = $3)
          FROM shared_submission WHERE submission_id = $1`, [submissionId, ids.reviewerM, draftId]))).resolves.toBe("23514");
    });
  });

  describe("T6.3 retry a failed preparation (migration 0036)", () => {
    /** An approved content submission with the generation and job the approval trigger creates (0019). */
    const prepare = async (title: string) => {
      const { draftId, submissionId } = await submitLegacyDraft(title);
      return asSuperuser(async (client) => {
        await client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'PREPARING',
            approved_selection_id = proposed_selection_id WHERE submission_id = $1`, [submissionId]);
        const generation = await client.query<{ generation_id: string }>(`INSERT INTO knowledge_index_generation
            (organization_id, submission_id, shared_draft_id, snapshot_version_id, snapshot_content_hash)
          SELECT organization_id, submission_id, shared_draft_id, shared_draft_version_id, content_hash
            FROM shared_submission WHERE submission_id = $1 RETURNING generation_id`, [submissionId]);
        const job = await client.query<{ job_id: string; max_attempts: number }>(`INSERT INTO knowledge_index_job
            (generation_id) VALUES ($1) RETURNING job_id, max_attempts`, [generation.rows[0]?.generation_id]);
        return { draftId, submissionId, jobId: job.rows[0]!.job_id, maxAttempts: job.rows[0]!.max_attempts };
      });
    };
    /** What the worker does after an attempt fails: fail_knowledge_index_job under its own lease. */
    const failAttempt = (jobId: string, attempt: number, code: string, retryable: boolean) => asSuperuser(async (client) => {
      const worker = randomUUID();
      await client.query(`UPDATE knowledge_index_job SET status = 'RUNNING', attempt_count = $2, lease_owner = $3,
          lease_expires_at = now() + interval '5 minutes' WHERE job_id = $1`, [jobId, attempt, worker]);
      return (await client.query<{ status: string }>("SELECT fail_knowledge_index_job($1, $2, $3, $4) AS status",
        [jobId, worker, code, retryable])).rows[0]?.status;
    });
    const state = (submissionId: string) => asSuperuser(async (client) => (await client.query<{
      publication_state: string; publication_failure_code: string | null; generation: string; job: string;
      attempt_count: number; audits: string }>(`
      SELECT s.publication_state, s.publication_failure_code, g.status AS generation, j.status AS job, j.attempt_count,
             (SELECT count(*) FROM audit_event a WHERE a.event_type = 'KNOWLEDGE_PUBLICATION_RETRIED'
                AND a.details_json->>'submissionId' = s.submission_id::text)::text AS audits
        FROM shared_submission s JOIN knowledge_index_generation g USING (submission_id)
        JOIN knowledge_index_job j USING (generation_id) WHERE s.submission_id = $1`, [submissionId])).rows[0]);
    const failure = async (submissionId: string) => (await repository!.listKnowledgeSubmissions(ids.author, ids.orgA))
      ?.find((submission) => submission.id === submissionId)?.publicationFailure;

    it("retries automatically with a longer backoff, then lets only the author retry a temporary failure", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { submissionId, jobId, maxAttempts } = await prepare("Temporary failure");
      expect(maxAttempts).toBe(6);
      await expect(failAttempt(jobId, 1, "AI_SERVICE_UNAVAILABLE", true)).resolves.toBe("PENDING");
      const delay = await asSuperuser(async (client) => (await client.query<{ seconds: number }>(
        "SELECT extract(epoch FROM available_at - now())::float AS seconds FROM knowledge_index_job WHERE job_id = $1",
        [jobId])).rows[0]?.seconds ?? 0);
      expect(delay).toBeGreaterThan(20);
      expect(delay).toBeLessThanOrEqual(30);
      expect(await failure(submissionId)).toBeNull();

      await expect(failAttempt(jobId, 6, "AI_SERVICE_HTTP_503", true)).resolves.toBe("FAILED");
      await expect(state(submissionId)).resolves.toMatchObject({ publication_state: "FAILED",
        publication_failure_code: "AI_SERVICE_HTTP_503", generation: "FAILED", job: "FAILED" });
      expect(await failure(submissionId)).toBe("TEMPORARY");

      await expect(repository.retryKnowledgePublication(ids.outsider, ids.orgA, submissionId)).resolves.toEqual({ kind: "not-found" });
      await expect(repository.retryKnowledgePublication(ids.reviewer, ids.orgA, submissionId)).resolves.toEqual({ kind: "not-found" });
      await expect(repository.retryKnowledgePublication(ids.foreign, ids.orgB, submissionId)).resolves.toEqual({ kind: "not-found" });
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, submissionId)).resolves.toMatchObject({
        kind: "preparing", submission: { id: submissionId, status: "APPROVED", publicationState: "PREPARING", publicationFailure: null } });
      await expect(state(submissionId)).resolves.toMatchObject({ publication_state: "PREPARING",
        publication_failure_code: null, generation: "PENDING", job: "PENDING", attempt_count: 0, audits: "1" });
      // A repeat while preparing again is a no-op with no second audit event.
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, submissionId)).resolves.toMatchObject({ kind: "preparing" });
      await expect(state(submissionId)).resolves.toMatchObject({ audits: "1" });

      // The runtime cannot write the failure code or restart preparation itself.
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(
        "UPDATE shared_submission SET publication_failure_code = 'AI_SERVICE_UNAVAILABLE' WHERE submission_id = $1",
        [submissionId]))).rejects.toMatchObject({ code: "42501" });
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(
        "UPDATE knowledge_index_job SET status = 'PENDING' WHERE job_id = $1", [jobId]))).rejects.toMatchObject({ code: "42501" });
    });

    it("refuses content and system failures, a pending submission and an already published snapshot", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const content = await prepare("Content failure");
      await expect(failAttempt(content.jobId, 1, "AI_SERVICE_HTTP_415", false)).resolves.toBe("FAILED");
      expect(await failure(content.submissionId)).toBe("CONTENT");
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, content.submissionId))
        .resolves.toEqual({ kind: "not-retryable" });

      const integrity = await prepare("Integrity failure");
      await expect(failAttempt(integrity.jobId, 1, "SNAPSHOT_INTEGRITY_FAILURE", false)).resolves.toBe("FAILED");
      expect(await failure(integrity.submissionId)).toBe("SYSTEM");
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, integrity.submissionId))
        .resolves.toEqual({ kind: "not-retryable" });
      await expect(state(integrity.submissionId)).resolves.toMatchObject({ publication_state: "FAILED", audits: "0" });

      const pending = await submitLegacyDraft("Still pending");
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, pending.submissionId))
        .resolves.toEqual({ kind: "not-failed" });

      // The 0021 high-water mark: once this snapshot (or a newer one) of the document has a published version,
      // preparing it again could never make it current.
      const stale = await prepare("Already published");
      await expect(failAttempt(stale.jobId, 1, "AI_SERVICE_UNAVAILABLE", false)).resolves.toBe("FAILED");
      await asSuperuser(async (client) => {
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope_type) VALUES ($1, 'Retry fixture ' || $2, 'ORGANIZATION')
          RETURNING knowledge_base_id`, [ids.orgA, stale.draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_knowledge_version (published_version_id, submission_id, knowledge_base_id,
            title, version_no, content_uri, content_hash, shared_draft_id, classification, responsible_department_id,
            audience_role_ids, valid_from, reader_selection_id)
          SELECT gen_random_uuid(), s.submission_id, $2, s.title, 1, s.content_uri, s.content_hash, s.shared_draft_id,
                 s.classification, s.responsible_department_id, s.audience_role_ids, now(), s.approved_selection_id
            FROM shared_submission s WHERE s.submission_id = $1`, [stale.submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
      });
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, stale.submissionId))
        .resolves.toEqual({ kind: "superseded" });
    });

    it("records the failure code when the final lease expires without a worker", async () => {
      const { submissionId, jobId } = await prepare("Lease exhausted");
      await asSuperuser(async (client) => {
        await client.query(`UPDATE knowledge_index_job SET status = 'RUNNING', attempt_count = max_attempts,
            lease_owner = gen_random_uuid(), lease_expires_at = now() - interval '1 second' WHERE job_id = $1`, [jobId]);
        await client.query("SELECT * FROM claim_knowledge_index_job(gen_random_uuid(), 60)");
        const row = (await client.query<{ publication_state: string; publication_failure_code: string }>(
          "SELECT publication_state, publication_failure_code FROM shared_submission WHERE submission_id = $1",
          [submissionId])).rows[0];
        expect(row).toEqual({ publication_state: "FAILED", publication_failure_code: "INDEXING_LEASE_EXHAUSTED" });
      }, false);
    });
  });

  describe("decision 0023 governance (migration 0037)", () => {
    /** A current publication readable by the selected author and engineer, responsible department Sales. */
    const publishSelected = async (title: string) => {
      const { draftId, submissionId } = await submitLegacyDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_selection_id = proposed_selection_id WHERE submission_id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope_type) VALUES ($1, 'Governance ' || $2, 'ORGANIZATION') RETURNING knowledge_base_id`,
        [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_knowledge_version (published_version_id, submission_id, knowledge_base_id,
            title, version_no, content_uri, content_hash, shared_draft_id, classification, responsible_department_id,
            audience_role_ids, valid_from, reader_selection_id)
          SELECT $1, s.submission_id, $3, s.title, 1, s.content_uri, s.content_hash, s.shared_draft_id, s.classification,
                 s.responsible_department_id, s.audience_role_ids, now(), s.approved_selection_id
            FROM shared_submission s WHERE s.submission_id = $2`, [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
        await client.query(`INSERT INTO knowledge_current_publication (shared_draft_id, organization_id, published_version_id,
            audience_role_ids, target_scope_type, valid_from, reader_selection_id)
          SELECT pv.shared_draft_id, $2, pv.published_version_id, pv.audience_role_ids, 'ORGANIZATION', pv.valid_from,
                 pv.reader_selection_id FROM published_knowledge_version pv WHERE pv.published_version_id = $1`, [versionId, ids.orgA]);
      });
      return { draftId, submissionId, versionId };
    };
    // Grants created by a test are revoked after it even when an assertion fails, so the next test can
    // create the same grant without hitting uq_active_reviewer_grant_exact.
    const createdGrants: string[] = [];
    afterEach(async () => {
      const pending = createdGrants.splice(0);
      if (pending.length) await asSuperuser((client) => client.query(
        "UPDATE reviewer_grant SET status = 'INACTIVE' WHERE reviewer_grant_id = ANY($1::uuid[])", [pending]));
    });
    const grant = (membershipId: string, scope: "DEPARTMENT" | "ORGANIZATION", departmentId: string | null) =>
      asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_membership_id, scope,
          department_id, granted_by_membership_id, classifications, level) VALUES ($1, $2, $3, $4, $5, ARRAY['INTERNAL'], 'STANDARD')
        RETURNING reviewer_grant_id`, [ids.orgA, membershipId, scope, departmentId, ids.authorM]))
        .then((result) => { const grantId = result.rows[0]!.reviewer_grant_id as string; createdGrants.push(grantId); return grantId; });
    const audits = (eventType: string, documentId: string) => asSuperuser(async (client) => (await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_event WHERE event_type = $1 AND details_json->>'documentId' = $2",
      [eventType, documentId])).rows[0]?.count);

    it("lists metadata only to an Organization Admin and serves a live, audited inspection", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publishSelected("Governed salary sheet");
      const catalog = await repository.listGovernancePublications(ids.author, ids.orgA);
      expect(catalog?.find((item) => item.documentId === draftId)).toMatchObject({ publishedVersionId: versionId,
        title: "Governed salary sheet", readerMode: "SELECTED_MEMBERS", responsibleDepartmentId: ids.sales, openReports: 0 });
      await expect(repository.listGovernancePublications(ids.reviewer, ids.orgA)).resolves.toBeNull();
      await expect(repository.listGovernancePublications(ids.foreign, ids.orgB)).resolves.toBeNull();

      await expect(repository.openGovernanceInspection(ids.author, ids.orgA, draftId, " ")).resolves.toEqual({ kind: "invalid-reason" });
      await expect(repository.openGovernanceInspection(ids.reviewer, ids.orgA, draftId, "Curious"))
        .resolves.toEqual({ kind: "not-admin" });
      await expect(repository.openGovernanceInspection(ids.author, ids.orgA, id(), "Reported")).resolves.toEqual({ kind: "not-found" });
      const opened = await repository.openGovernanceInspection(ids.author, ids.orgA, draftId, "  Reported salary data  ");
      if (opened.kind !== "opened") throw new Error(`Inspection was not opened: ${opened.kind}`);
      await expect(audits("KNOWLEDGE_GOVERNANCE_INSPECTION_OPENED", draftId)).resolves.toBe("1");

      const used = await repository.useGovernanceInspection(ids.author, ids.orgA, opened.inspectionId);
      expect(used).toMatchObject({ documentId: draftId, publishedVersionId: versionId, readerMode: "SELECTED_MEMBERS",
        reason: "Reported salary data" });
      expect(used?.readerNames).toHaveLength(2);
      await expect(repository.useGovernanceInspection(ids.reviewer, ids.orgA, opened.inspectionId)).resolves.toBeNull();
      // Runtime has no direct access to inspections.
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query("SELECT * FROM governance_inspection")))
        .rejects.toMatchObject({ code: "42501" });

      // 15 minutes idle, or 2 hours in total, ends the inspection.
      await asSuperuser((client) => client.query(
        "UPDATE governance_inspection SET last_used_at = now() - interval '16 minutes', opened_at = now() - interval '20 minutes', expires_at = now() + interval '100 minutes' WHERE inspection_id = $1",
        [opened.inspectionId]));
      await expect(repository.useGovernanceInspection(ids.author, ids.orgA, opened.inspectionId)).resolves.toBeNull();
      const second = await repository.openGovernanceInspection(ids.author, ids.orgA, draftId, "Second look");
      if (second.kind !== "opened") throw new Error("Second inspection was not opened");
      await asSuperuser((client) => client.query(
        "UPDATE governance_inspection SET opened_at = now() - interval '121 minutes', expires_at = now() - interval '1 minute', last_used_at = now() - interval '1 minute' WHERE inspection_id = $1",
        [second.inspectionId]));
      await expect(repository.useGovernanceInspection(ids.author, ids.orgA, second.inspectionId)).resolves.toBeNull();
    });

    it("keeps responsible review read-only and permits only Admin direct withdrawal", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, submissionId } = await publishSelected("Responsible review");
      await expect(repository.getResponsiblePublicationView(ids.reviewer, ids.orgA, draftId)).resolves.toBeNull();
      await grant(ids.reviewerM, "DEPARTMENT", ids.engineering);
      await expect(repository.getResponsiblePublicationView(ids.reviewer, ids.orgA, draftId)).resolves.toBeNull();
      await grant(ids.reviewerM, "DEPARTMENT", ids.sales);
      await expect(repository.getResponsiblePublicationView(ids.reviewer, ids.orgA, draftId))
        .resolves.toMatchObject({ documentId: draftId, readerMode: "SELECTED_MEMBERS" });
      await expect(repository.getResponsiblePublicationView(ids.engineer, ids.orgA, draftId)).resolves.toBeNull();

      await expect(repository.withdrawPublicationDirectly(ids.engineer, ids.orgA, draftId, "Wrong")).resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "")).resolves.toEqual({ kind: "invalid-reason" });
      await expect(repository.withdrawPublicationDirectly(ids.reviewer, ids.orgA, draftId, "Figures are wrong"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawPublicationDirectly(ids.foreign, ids.orgA, draftId, "Wrong organization"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgB, draftId, "Foreign document"))
        .resolves.toEqual({ kind: "not-found" });
      const spoofed = await asRuntime(ids.reviewer, ids.orgA, async (client) => {
        await client.query("SELECT set_config('arden.org_admin', 'true', true)");
        return client.query("SELECT withdraw_publication_directly($1, 'Spoofed Admin') AS outcome", [draftId]);
      });
      expect(spoofed.rows[0]?.outcome).toBe("NOT_FOUND");
      await expect(audits("KNOWLEDGE_PUBLICATION_WITHDRAWN", draftId)).resolves.toBe("0");
      expect((await asSuperuser(client => client.query(
        "SELECT 1 FROM knowledge_current_publication WHERE shared_draft_id = $1", [draftId]))).rowCount).toBe(1);

      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Figures are wrong"))
        .resolves.toEqual({ kind: "withdrawn" });
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Again")).resolves.toEqual({ kind: "not-found" });
      const pointer = await asSuperuser((client) => client.query(
        "SELECT 1 FROM knowledge_current_publication WHERE shared_draft_id = $1", [draftId]));
      expect(pointer.rowCount).toBe(0);
      const authored = (await repository.listKnowledgeSubmissions(ids.author, ids.orgA))?.find((item) => item.id === submissionId);
      expect(authored).toMatchObject({ publicationState: "WITHDRAWN", withdrawal: { by: "ORGANIZATION_ADMIN", reason: "Figures are wrong" } });
      await expect(audits("KNOWLEDGE_PUBLICATION_WITHDRAWN", draftId)).resolves.toBe("1");

      // An Organization Admin may withdraw any current publication.
      const other = await publishSelected("Admin withdrawal");
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, other.draftId, "Legal hold"))
        .resolves.toEqual({ kind: "withdrawn" });
      expect((await repository.listKnowledgeSubmissions(ids.author, ids.orgA))?.find((item) => item.id === other.submissionId)
        ?.withdrawal).toMatchObject({ by: "ORGANIZATION_ADMIN", reason: "Legal hold" });
    });

    it("records Admin provenance when the actor also holds the responsible reviewer grant", async () => {
      const { draftId, submissionId } = await publishSelected("Dual authority");
      await grant(ids.reviewerM, "DEPARTMENT", ids.sales);
      // Both the temporary Admin role and withdrawal are rolled back, even if an assertion fails.
      await asSuperuser(async (client) => {
        await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
          SELECT $1, role_id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.reviewerM, ids.scopeA]);
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
          [ids.reviewer, ids.orgA]);
        const result = await client.query("SELECT withdraw_publication_directly($1, 'Admin decision') AS outcome", [draftId]);
        expect(result.rows[0]?.outcome).toBe("WITHDRAWN");
        await client.query("RESET ROLE");
        const provenance = await client.query("SELECT withdrawn_by FROM shared_submission WHERE submission_id = $1", [submissionId]);
        expect(provenance.rows[0]?.withdrawn_by).toBe("ORGANIZATION_ADMIN");
        const audit = await client.query(`SELECT details_json->>'withdrawnBy' AS withdrawn_by FROM audit_event
          WHERE event_type = 'KNOWLEDGE_PUBLICATION_WITHDRAWN' AND details_json->>'documentId' = $1`, [draftId]);
        expect(audit.rows).toEqual([{ withdrawn_by: "ORGANIZATION_ADMIN" }]);
      }, false);
    });

    it("uses Organization grants, not Department grants, for an organization-wide publication", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publishSelected("Organization-wide");
      await asSuperuser(async (client) => {
        const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_selection (organization_id, reader_mode)
          VALUES ($1, 'ORGANIZATION') RETURNING selection_id`, [ids.orgA]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE published_knowledge_version SET reader_selection_id = $2 WHERE published_version_id = $1",
          [versionId, selection.rows[0]!.selection_id]);
        await client.query("UPDATE knowledge_current_publication SET reader_selection_id = $2 WHERE shared_draft_id = $1",
          [draftId, selection.rows[0]!.selection_id]);
      });
      await grant(ids.reviewerM, "DEPARTMENT", ids.sales);
      await expect(repository.getResponsiblePublicationView(ids.reviewer, ids.orgA, draftId)).resolves.toBeNull();
      await grant(ids.reviewerM, "ORGANIZATION", null);
      await expect(repository.getResponsiblePublicationView(ids.reviewer, ids.orgA, draftId))
        .resolves.toMatchObject({ readerMode: "ORGANIZATION" });
      await expect(repository.withdrawPublicationDirectly(ids.reviewer, ids.orgA, draftId, "Organization reviewer"))
        .resolves.toEqual({ kind: "not-found" });
    });

    it("lets only a reader report once, shows reports to responsible people and closes them on withdrawal", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publishSelected("Reported document");
      await expect(repository.reportPublicationProblem(ids.outsider, ids.orgA, draftId, versionId, "Leak"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "Wrong salary column"))
        .resolves.toMatchObject({ kind: "reported" });
      await expect(repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "Still wrong"))
        .resolves.toEqual({ kind: "duplicate" });
      await expect(asRuntime(ids.engineer, ids.orgA, (client) => client.query("SELECT * FROM publication_report")))
        .rejects.toMatchObject({ code: "42501" });

      const mine = (reports: Awaited<ReturnType<ArdenRepository["listPublicationReports"]>>) =>
        reports?.filter((report) => report.documentId === draftId) ?? [];
      expect(mine(await repository.listPublicationReports(ids.outsider, ids.orgA))).toHaveLength(0);
      expect(mine(await repository.listPublicationReports(ids.author, ids.orgA))).toHaveLength(1);
      await grant(ids.reviewerM, "DEPARTMENT", ids.sales);
      const [report] = mine(await repository.listPublicationReports(ids.reviewer, ids.orgA));
      expect(report).toMatchObject({ message: "Wrong salary column", stillCurrent: true, canView: true });
      await expect(repository.dismissPublicationReport(ids.outsider, ids.orgA, report!.id)).resolves.toBe(false);
      await expect(repository.dismissPublicationReport(ids.reviewer, ids.orgA, report!.id)).resolves.toBe(true);
      expect(mine(await repository.listPublicationReports(ids.reviewer, ids.orgA))).toHaveLength(0);

      await expect(repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "New issue"))
        .resolves.toMatchObject({ kind: "reported" });
      await expect(repository.withdrawPublicationDirectly(ids.reviewer, ids.orgA, draftId, "Confirmed"))
        .resolves.toEqual({ kind: "not-found" });
      expect(mine(await repository.listPublicationReports(ids.author, ids.orgA))).toHaveLength(1);
      await expect(audits("KNOWLEDGE_PUBLICATION_WITHDRAWN", draftId)).resolves.toBe("0");
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Confirmed"))
        .resolves.toEqual({ kind: "withdrawn" });
      expect(mine(await repository.listPublicationReports(ids.author, ids.orgA))).toHaveLength(0);
    });
  });

  describe("decision 0032 expired visibility and renewal (migration 0068)", () => {
    const createdGrants: string[] = [];
    afterEach(async () => {
      const pending = createdGrants.splice(0);
      if (pending.length) await asSuperuser((client) => client.query(
        "UPDATE reviewer_grant SET status = 'INACTIVE' WHERE reviewer_grant_id = ANY($1::uuid[])", [pending]));
    });
    const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const departmentGrant = () => asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id,
        reviewer_membership_id, scope, department_id, granted_by_membership_id, classifications, level)
      VALUES ($1, $2, 'DEPARTMENT', $3, $4, ARRAY['INTERNAL'], 'STANDARD') RETURNING reviewer_grant_id`,
    [ids.orgA, ids.reviewerM, ids.sales, ids.authorM])).then((result) => { createdGrants.push(result.rows[0]!.reviewer_grant_id); });
    /** A current, indexed publication (readers: author and engineer) whose frozen Valid until is `expires`. */
    const publish = async (title: string, expires: string | null) => {
      const { draftId, submissionId } = await submitLegacyDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_selection_id = proposed_selection_id WHERE submission_id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope_type) VALUES ($1, 'Renewal fixture ' || $2, 'ORGANIZATION')
          RETURNING knowledge_base_id`, [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_knowledge_version (published_version_id, submission_id, knowledge_base_id,
            title, version_no, content_uri, content_hash, shared_draft_id, classification, responsible_department_id,
            audience_role_ids, valid_from, reader_selection_id, index_status, management)
          SELECT $1, s.submission_id, $3, s.title, 1, s.content_uri, s.content_hash, s.shared_draft_id, s.classification,
                 s.responsible_department_id, s.audience_role_ids, now() - interval '1 day', s.approved_selection_id, 'INDEXED',
                 jsonb_build_object('type', 'Guide', 'version', '1.0', 'expirationDate', $4::text, 'changeNote', '')
            FROM shared_submission s WHERE s.submission_id = $2`,
        [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id, expires]);
        await client.query(`UPDATE published_knowledge_version SET published_at = now() - interval '1 day'
          WHERE published_version_id = $1`, [versionId]);
        await client.query(`INSERT INTO knowledge_current_publication (shared_draft_id, organization_id, published_version_id,
            audience_role_ids, target_scope_type, valid_from, reader_selection_id)
          SELECT pv.shared_draft_id, $2, pv.published_version_id, pv.audience_role_ids, 'ORGANIZATION', pv.valid_from,
                 pv.reader_selection_id FROM published_knowledge_version pv WHERE pv.published_version_id = $1`,
        [versionId, ids.orgA]);
      });
      return { draftId, versionId };
    };
    const renew = (userId: string, draftId: string, expirationDate: string | null, key = randomUUID()) =>
      repository!.requestPublicationRenewal(userId, ids.orgA, draftId, { expirationDate, reason: "Checked again", idempotencyKey: key }, "renewal");
    const listedFor = async (userId: string) => (await repository!.listPublishedKnowledge(userId, ids.orgA) ?? []).map((item) => item.draftId);
    const pointer = (draftId: string) => asSuperuser(async (client) => (await client.query(
      "SELECT published_version_id FROM knowledge_current_publication WHERE shared_draft_id = $1", [draftId])).rows[0]);
    const count = (sql: string, values: unknown[]) => asSuperuser(async (client) =>
      Number((await client.query<{ count: string }>(sql, values)).rows[0]?.count));

    it("hides an expired publication from readers and AI without withdrawing it; responsible people still see it", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await departmentGrant();
      const expired = await publish("Expired policy", utcDay(-1));
      const lastDay = await publish("Expires today", utcDay(0));
      expect(await listedFor(ids.engineer)).toContain(lastDay.draftId);
      expect(await listedFor(ids.engineer)).not.toContain(expired.draftId);
      await expect(repository.getPublishedKnowledge(ids.engineer, ids.orgA, expired.versionId))
        .resolves.toMatchObject({ expired: true, management: { expirationDate: utcDay(-1) } });
      const eligible = await asRuntime(ids.engineer, ids.orgA, async (client) => (await client.query<{ id: string }>(
        "SELECT eligible_ai_publications() AS id")).rows.map((row) => row.id));
      expect(eligible).toContain(lastDay.versionId);
      expect(eligible).not.toContain(expired.versionId);
      await expect(pointer(expired.draftId)).resolves.toEqual({ published_version_id: expired.versionId });
      await expect(count(`SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_PUBLICATION_WITHDRAWN'
        AND details_json->>'documentId' = $1`, [expired.draftId])).resolves.toBe(0);
      const authorState = await repository.listPublicationRenewalState(ids.author, ids.orgA);
      expect(authorState?.find((item) => item.documentId === expired.draftId)).toMatchObject({ isAuthor: true,
        expirationDate: utcDay(-1), canRenew: true, renewalPending: false, authorActive: true });
      const reviewerState = await repository.listPublicationRenewalState(ids.reviewer, ids.orgA);
      expect(reviewerState?.find((item) => item.documentId === expired.draftId)).toMatchObject({ isAuthor: false, canRenew: true });
      expect((await repository.listPublicationRenewalState(ids.outsider, ids.orgA))?.map((item) => item.documentId))
        .not.toContain(expired.draftId);
      // Home AUTHOR column: the active author's display name only.
      const home = await repository.listPublishedKnowledge(ids.engineer, ids.orgA);
      expect(home?.find((item) => item.draftId === lastDay.draftId)?.authorName).toBe("Synthetic reader");
    });

    /** The reviewer holds both scopes so the frozen legacy breadth of these fixtures is covered either way. */
    const reviewerGrants = async () => { await departmentGrant(); await organizationGrant(); };
    const organizationGrant = async () => {
      await asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_membership_id, scope,
          department_id, granted_by_membership_id, classifications, level)
        VALUES ($1, $2, 'ORGANIZATION', NULL, $3, ARRAY['INTERNAL'], 'STANDARD') RETURNING reviewer_grant_id`,
      [ids.orgA, ids.reviewerM, ids.authorM])).then((result) => { createdGrants.push(result.rows[0]!.reviewer_grant_id); });
    };
    const decideAs = (userId: string, submission: { id: string; snapshotVersionId: string; contentHash: string },
      action: "APPROVE" | "REJECT", comment: string | null = null) => repository!.decideReview(userId, ids.orgA, submission.id,
      action, submission.snapshotVersionId, submission.contentHash, comment, randomUUID(), "renewal-decision");
    const decisionAudit = (submissionId: string) => asSuperuser(async (client) => (await client.query<{ details: Record<string, unknown> }>(
      `SELECT details_json AS details FROM audit_event WHERE event_type = 'KNOWLEDGE_REVIEW_DECIDED'
        AND details_json->>'submissionId' = $1`, [submissionId])).rows.map((row) => row.details));

    it("lets a responsible reviewer renew on the author's behalf and shows it again only after approval", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const { draftId, versionId } = await publish("Expired runbook", utcDay(-2));
      await expect(renew(ids.outsider, draftId, utcDay(90))).resolves.toEqual({ kind: "not-found" });
      await expect(renew(ids.reviewer, draftId, utcDay(0))).resolves.toEqual({ kind: "invalid-date" });
      const requested = await renew(ids.reviewer, draftId, utcDay(90));
      expect(requested).toMatchObject({ kind: "requested", submission: { requestType: "RENEWAL", status: "PENDING_REVIEW",
        renewal: { expirationDate: utcDay(90), onBehalfOfAuthor: true } } });
      if (requested.kind !== "requested") return;
      await expect(renew(ids.author, draftId, null)).resolves.toEqual({ kind: "pending" });
      await expect(count(`SELECT count(*) FROM arden_notification WHERE recipient_membership_id = $1
        AND event_type = 'PUBLICATION_RENEWAL_ON_BEHALF' AND resource_id = $2 AND request_reason = 'Checked again'
        AND shared_by_name = 'Synthetic reader'`, [ids.authorM, draftId])).resolves.toBe(1);
      await expect(count(`SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_CHANGE_REQUESTED'
        AND details_json->>'submissionId' = $1 AND details_json->>'onBehalfOfAuthor' = 'true'
        AND details_json->>'requestedBy' = $2`, [requested.submission.id, ids.reviewerM])).resolves.toBe(1);
      // The author sees the request to decide it.
      const authorState = (await repository.listPublicationRenewalState(ids.author, ids.orgA))?.find((item) => item.documentId === draftId);
      expect(authorState?.pending).toMatchObject({ submissionId: requested.submission.id, onBehalfOfAuthor: true,
        requestedByName: "Synthetic reader", reason: "Checked again", expirationDate: utcDay(90), canDecide: true });
      expect(await listedFor(ids.engineer)).not.toContain(draftId);
      // Already expired: the author's window is closed, so the requester may decide at once (decision 0033).
      await expect(decideAs(ids.engineer, requested.submission, "APPROVE")).resolves.toMatchObject({ kind: "not-found" });
      await expect(decideAs(ids.reviewer, requested.submission, "APPROVE"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      expect(await decisionAudit(requested.submission.id)).toEqual([expect.objectContaining({ selfApproved: true })]);
      await expect(pointer(draftId)).resolves.toEqual({ published_version_id: versionId });
      expect(await listedFor(ids.engineer)).toContain(draftId);
      await expect(repository.getPublishedKnowledge(ids.engineer, ids.orgA, versionId))
        .resolves.toMatchObject({ expired: false, management: { expirationDate: utcDay(90) } });
      await expect(count(`SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_PUBLICATION_RENEWED'
        AND details_json->>'documentId' = $1 AND details_json->>'onBehalfOfAuthor' = 'true'`, [draftId])).resolves.toBe(1);
    });

    it("gives the active author the first decision on an on-behalf renewal; rejection is final", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const rejected = await publish("Author rejects", utcDay(5));
      const asked = await renew(ids.reviewer, rejected.draftId, utcDay(120));
      if (asked.kind !== "requested") throw new Error(`Renewal fixture failed: ${asked.kind}`);
      // During the window only the author decides: reviewers, including the requester, are refused (DB and API).
      await expect(decideAs(ids.reviewer, asked.submission, "APPROVE"))
        .resolves.toEqual({ kind: "denied", reason: "AUTHOR_DECISION_WINDOW" });
      await expect(sqlState((client) => client.query(`INSERT INTO review_decision (submission_id, reviewer_membership_id,
          decision, flow2, decision_request_id, snapshot_version_id, content_hash)
        SELECT submission_id, submitted_by_membership_id, 'APPROVED', true, gen_random_uuid(), shared_draft_version_id, content_hash
          FROM shared_submission WHERE submission_id = $1`, [asked.submission.id]))).resolves.toBe("AR032");
      await expect(decideAs(ids.author, asked.submission, "REJECT")).resolves.toEqual({ kind: "denied", reason: "COMMENT_REQUIRED" });
      await expect(decideAs(ids.author, asked.submission, "REJECT", "Not needed any more"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "REJECTED", requestType: "RENEWAL" } });
      expect(await decisionAudit(asked.submission.id)).toEqual([expect.objectContaining({ decidedAs: "AUTHOR", selfApproved: false })]);
      // Final: nobody can override the author's rejection.
      expect(["conflict", "not-found"]).toContain((await decideAs(ids.reviewer, asked.submission, "APPROVE")).kind);
      expect(await decisionAudit(asked.submission.id)).toHaveLength(1);
      await expect(repository.getPublishedKnowledge(ids.engineer, ids.orgA, rejected.versionId))
        .resolves.toMatchObject({ management: { expirationDate: utcDay(5) } });

      const approved = await publish("Author approves", utcDay(6));
      const second = await renew(ids.reviewer, approved.draftId, null);
      if (second.kind !== "requested") throw new Error(`Renewal fixture failed: ${second.kind}`);
      await expect(decideAs(ids.author, second.submission, "APPROVE"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      await expect(repository.getPublishedKnowledge(ids.engineer, ids.orgA, approved.versionId))
        .resolves.toMatchObject({ management: { expirationDate: null } });

      // After the 3-day window the reviewers decide, and the requester may approve their own request.
      const late = await publish("Author silent", utcDay(6));
      const third = await renew(ids.reviewer, late.draftId, utcDay(200));
      if (third.kind !== "requested") throw new Error(`Renewal fixture failed: ${third.kind}`);
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`UPDATE shared_submission SET submitted_at = now() - interval '4 days',
            author_decides_until = now() - interval '1 day' WHERE submission_id = $1`,
          [third.submission.id]);
      });
      await expect(decideAs(ids.reviewer, third.submission, "APPROVE"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      expect(await decisionAudit(third.submission.id)).toEqual([expect.objectContaining({ selfApproved: true })]);
    });

    it("applies the 7-day on-behalf window, keeps Admin self-approval and lets reviewers decide at once for an inactive author", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const later = await publish("Renew later", utcDay(20));
      await expect(renew(ids.reviewer, later.draftId, utcDay(200))).resolves.toEqual({ kind: "not-yet" });
      const own = await renew(ids.author, later.draftId, null);
      expect(own).toMatchObject({ kind: "requested", submission: { renewal: { expirationDate: null, onBehalfOfAuthor: false } } });
      if (own.kind !== "requested") return;
      // The author is an Organization Admin here; Admin authority, including self-approval, is unchanged.
      await expect(decideAs(ids.author, own.submission, "APPROVE"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      expect(await decisionAudit(own.submission.id)).toEqual([expect.objectContaining({ selfApproved: true })]);

      const inactive = await publish("Author left", utcDay(25));
      await asSuperuser((client) => client.query("UPDATE organization_membership SET status = 'SUSPENDED' WHERE membership_id = $1", [ids.authorM]));
      try {
        const asked = await renew(ids.reviewer, inactive.draftId, utcDay(400));
        expect(asked).toMatchObject({ kind: "requested", submission: { renewal: { onBehalfOfAuthor: true } } });
        await expect(count(`SELECT count(*) FROM arden_notification WHERE event_type = 'PUBLICATION_RENEWAL_ON_BEHALF'
          AND resource_id = $1`, [inactive.draftId])).resolves.toBe(0);
        if (asked.kind !== "requested") return;
        await expect(decideAs(ids.reviewer, asked.submission, "APPROVE"))
          .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      } finally {
        await asSuperuser((client) => client.query("UPDATE organization_membership SET status = 'ACTIVE' WHERE membership_id = $1", [ids.authorM]));
      }
    });

    it("lets a responsible reviewer who is not a reader approve a reader change without becoming a reader", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const ask = (draftId: string, input: Omit<Parameters<ArdenRepository["requestPublicationChange"]>[3], "idempotencyKey">) =>
        repository!.requestPublicationChange(ids.author, ids.orgA, draftId, { ...input, idempotencyKey: randomUUID() }, "change-request");
      const readable = async (userId: string, versionId: string) => Boolean(await repository!.getPublishedKnowledge(userId, ids.orgA, versionId));
      // Readers are the selected members author + engineer; the department reviewer is not one of them.
      const changed = await publish("Reader change by a non-reader reviewer", null);
      expect(await listedFor(ids.reviewer)).not.toContain(changed.draftId);
      const readers = { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: [ids.engineerM, ids.outsiderM] };
      const readerChange = await ask(changed.draftId, { type: "READER_CHANGE", reason: "Rollout team only", targetReaders: readers });
      if (readerChange.kind !== "requested") throw new Error(`Change fixture failed: ${readerChange.kind}`);
      const approvedChange = await decideAs(ids.reviewer, readerChange.submission, "APPROVE");
      expect(approvedChange.kind === "denied" ? approvedChange.reason : approvedChange.kind).toBe("decided");
      expect(approvedChange).toMatchObject({ submission: { status: "APPROVED", requestType: "READER_CHANGE" } });
      // The reviewer is still not a reader; the newly selected outsider is.
      expect(await listedFor(ids.reviewer)).not.toContain(changed.draftId);
      await expect(readable(ids.reviewer, changed.versionId)).resolves.toBe(false);
      expect(await listedFor(ids.outsider)).toContain(changed.draftId);
      const eligible = await asRuntime(ids.reviewer, ids.orgA, async (client) => (await client.query<{ id: string }>(
        "SELECT eligible_ai_publications() AS id")).rows.map((row) => row.id));
      expect(eligible).not.toContain(changed.versionId);
    });

    it("lets a responsible reviewer who is not a reader approve a withdrawal, which removes the current pointer", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const ask = (draftId: string, input: Omit<Parameters<ArdenRepository["requestPublicationChange"]>[3], "idempotencyKey">) =>
        repository!.requestPublicationChange(ids.author, ids.orgA, draftId, { ...input, idempotencyKey: randomUUID() }, "change-request");
      const readable = async (userId: string, versionId: string) => Boolean(await repository!.getPublishedKnowledge(userId, ids.orgA, versionId));
      const withdrawn = await publish("Withdrawal by a non-reader reviewer", null);
      expect(await listedFor(ids.reviewer)).not.toContain(withdrawn.draftId);
      await expect(readable(ids.engineer, withdrawn.versionId)).resolves.toBe(true);
      const withdrawal = await ask(withdrawn.draftId, { type: "WITHDRAWAL", reason: "Replaced" });
      if (withdrawal.kind !== "requested") throw new Error(`Withdrawal fixture failed: ${withdrawal.kind}`);
      const approvedWithdrawal = await decideAs(ids.reviewer, withdrawal.submission, "APPROVE");
      expect(approvedWithdrawal.kind === "denied" ? approvedWithdrawal.reason : approvedWithdrawal.kind).toBe("decided");
      expect(approvedWithdrawal).toMatchObject({ submission: { status: "APPROVED", requestType: "WITHDRAWAL" } });
      await expect(pointer(withdrawn.draftId)).resolves.toBeUndefined();
      await expect(readable(ids.reviewer, withdrawn.versionId)).resolves.toBe(false);
      await expect(readable(ids.engineer, withdrawn.versionId)).resolves.toBe(false);
    });

    it("still refuses a changed target, a withdrawal racing a newer version and a wrong-scope reviewer", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await reviewerGrants();
      const ask = (draftId: string, input: Omit<Parameters<ArdenRepository["requestPublicationChange"]>[3], "idempotencyKey">) =>
        repository!.requestPublicationChange(ids.author, ids.orgA, draftId, { ...input, idempotencyKey: randomUUID() }, "change-request");
      const gone = await publish("Target no longer current", null);
      const late = await ask(gone.draftId, { type: "WITHDRAWAL", reason: "Too late" });
      if (late.kind !== "requested") throw new Error(`Withdrawal fixture failed: ${late.kind}`);
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM knowledge_current_publication WHERE shared_draft_id = $1", [gone.draftId]);
      });
      await expect(decideAs(ids.reviewer, late.submission, "APPROVE")).resolves.toEqual({ kind: "denied", reason: "PUBLICATION_CHANGED" });

      const racing = await publish("Newer version preparing", null);
      const race = await ask(racing.draftId, { type: "WITHDRAWAL", reason: "Race" });
      if (race.kind !== "requested") throw new Error(`Withdrawal fixture failed: ${race.kind}`);
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        // A newer approved content version of the same document, still being prepared.
        const version = await client.query<{ id: string }>(`INSERT INTO shared_draft_version
          SELECT (jsonb_populate_record(NULL::shared_draft_version, to_jsonb(v)
                   || jsonb_build_object('shared_draft_version_id', gen_random_uuid(), 'version_no', v.version_no + 100))).*
            FROM shared_draft_version v WHERE v.shared_draft_version_id = $1
          RETURNING shared_draft_version_id AS id`, [race.submission.snapshotVersionId]);
        await client.query(`INSERT INTO shared_submission (organization_id, shared_draft_id, shared_draft_version_id,
            snapshot_version_no, submitted_by_membership_id, target_scope_type, responsible_department_id, title,
            classification, audience_role_ids, policy_version, review_rule, content_uri, mime_type, content_hash,
            submit_request_id, status, publication_state)
          SELECT organization_id, shared_draft_id, $2, snapshot_version_no + 100, submitted_by_membership_id, target_scope_type,
                 responsible_department_id, title, classification, audience_role_ids, policy_version, review_rule, content_uri,
                 mime_type, content_hash, gen_random_uuid(), 'APPROVED', 'PREPARING'
            FROM shared_submission WHERE submission_id = $1`, [race.submission.id, version.rows[0]!.id]);
      });
      await expect(decideAs(ids.reviewer, race.submission, "APPROVE")).resolves.toEqual({ kind: "denied", reason: "PUBLICATION_CHANGED" });

      // An Engineering reviewer does not cover this Sales document, reader or not.
      await asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_membership_id, scope,
          department_id, granted_by_membership_id, classifications, level)
        VALUES ($1, $2, 'DEPARTMENT', $3, $4, ARRAY['INTERNAL'], 'STANDARD') RETURNING reviewer_grant_id`,
      [ids.orgA, ids.outsiderM, ids.engineering, ids.authorM])).then((result) => { createdGrants.push(result.rows[0]!.reviewer_grant_id); });
      const scoped = await publish("Wrong-scope reviewer", null);
      const scopedRequest = await ask(scoped.draftId, { type: "WITHDRAWAL", reason: "Wrong scope" });
      if (scopedRequest.kind !== "requested") throw new Error(`Withdrawal fixture failed: ${scopedRequest.kind}`);
      const refused = await decideAs(ids.outsider, scopedRequest.submission, "APPROVE");
      expect(refused.kind === "not-found" || (refused.kind === "denied" && refused.reason === "NOT_AUTHORIZED")).toBe(true);
      await expect(pointer(scoped.draftId)).resolves.toEqual({ published_version_id: scoped.versionId });
    });

    it("lets a reviewer approve their own submission only with a matching current grant (decision 0033)", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const draftId = await createDraft(ids.reviewer, ids.orgA, ids.reviewerM, "Reviewer's own guide");
      const configured = await repository.updateKnowledgeDraft(ids.reviewer, ids.orgA, draftId, 1, {
        responsibleDepartmentId: ids.sales, targetScopeType: "ORGANIZATION", audienceRoleIds: [ids.allMembersA],
      }, null, "self-configure");
      if (configured.kind !== "updated") throw new Error(`Configure fixture failed: ${configured.kind}`);
      await prepareKnowledgeFixture(pool!, ids.orgA, draftId, [ids.reviewerM, ids.engineerM]);
      const submitted = await repository.submitKnowledgeDraft(ids.reviewer, ids.orgA, draftId, 2, randomUUID(), "self-submit");
      if (submitted.kind !== "submitted") throw new Error(`Submit fixture failed: ${submitted.kind}`);
      const own = submitted.submission;
      // A Department grant does not cover this organization-wide snapshot, even for its own author.
      await departmentGrant();
      expect((await repository.listAssignedReviews(ids.reviewer, ids.orgA))?.map((item) => item.submissionId)).not.toContain(own.id);
      await expect(decideAs(ids.reviewer, own, "APPROVE")).resolves.toEqual({ kind: "denied", reason: "NOT_AUTHORIZED" });
      await organizationGrant();
      expect((await repository.listAssignedReviews(ids.reviewer, ids.orgA))?.map((item) => item.submissionId)).toContain(own.id);
      await expect(decideAs(ids.reviewer, own, "APPROVE"))
        .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED", publicationState: "PREPARING" } });
      expect(await decisionAudit(own.id)).toEqual([expect.objectContaining({ selfApproved: true, decision: "APPROVED" })]);
    });

    it("writes each 30/7-day reminder once and never for a document with no expiry", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await departmentGrant();
      const soon = await publish("Expires soon", utcDay(5));
      const month = await publish("Expires in a month", utcDay(28));
      const never = await publish("No expiry", null);
      await repository.enqueuePublicationExpiryReminders();
      await expect(repository.enqueuePublicationExpiryReminders()).resolves.toBe(0);
      const notices = (draftId: string) => asSuperuser(async (client) => (await client.query<{ recipient: string; key: string }>(
        `SELECT recipient_membership_id AS recipient, event_key AS key FROM arden_notification
          WHERE event_type = 'PUBLICATION_EXPIRING' AND resource_id = $1 ORDER BY event_key`, [draftId])).rows);
      expect(await notices(soon.draftId)).toEqual([
        { recipient: ids.authorM, key: `expiry:${soon.versionId}:${utcDay(5)}:30` },
        { recipient: ids.reviewerM, key: `expiry:${soon.versionId}:${utcDay(5)}:7` }]);
      expect(await notices(month.draftId)).toEqual([{ recipient: ids.authorM, key: `expiry:${month.versionId}:${utcDay(28)}:30` }]);
      expect(await notices(never.draftId)).toEqual([]);
      await expect(count(`SELECT count(*) FROM arden_notification_outbox o JOIN arden_notification n USING (notification_id)
        WHERE n.resource_id = $1`, [soon.draftId])).resolves.toBe(2);
    });

    it("refuses to delete a department that still owns current publications", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await publish("Owned by sales", null);
      await expect(repository.deleteDepartment(ids.author, ids.orgA, ids.sales, "delete-department"))
        .resolves.toMatchObject({ success: false, errorReason: "OWNS_PUBLICATIONS" });
      await expect(count("SELECT count(*) FROM department WHERE department_id = $1 AND status = 'ACTIVE'", [ids.sales])).resolves.toBe(1);
    });
  });
});
