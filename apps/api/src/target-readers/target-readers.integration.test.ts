import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { prepareKnowledgeFixture } from "../db/knowledge-fixture.test-support.js";
import { canRead } from "./policy.js";

// Flow 2 T1.1/T1.3/T1.4 against real PostgreSQL. This file never approves a submission, so it creates
// no index jobs and cannot race repository.integration.test.ts, which owns the publish/activate path. Requires a disposable, fully migrated
// database named arden_test_* (ARDEN_TEST_DATABASE_URL); skipped otherwise.
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
      if (fixtureReady) {
        await asSuperuser(async (client) => {
          for (const table of ["audit_event", "shared_draft_version", "shared_submission", "review_decision",
            "published_knowledge_version", "knowledge_current_publication", "reader_selection", "selected_reader"]) {
            await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
          }
          const orgs = [ids.orgA, ids.orgB];
          await client.query("DELETE FROM audit_event WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM knowledge_current_publication WHERE organization_id = ANY($1::uuid[])", [orgs]);
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
          await client.query("DELETE FROM knowledge_topic WHERE organization_id = ANY($1::uuid[])", [orgs]);
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
          for (const table of ["audit_event", "shared_draft_version", "shared_submission", "review_decision",
            "published_knowledge_version", "knowledge_current_publication", "reader_selection", "selected_reader"]) {
            await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
          }
        });
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
      await asSuperuser((client) => client.query(`UPDATE shared_submission SET status = 'APPROVED', publication_state = 'PREPARING'
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
});
