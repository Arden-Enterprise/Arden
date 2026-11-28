import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { prepareKnowledgeFixture } from "../db/knowledge-fixture.test-support.js";
import { canRead } from "./policy.js";
import { MaintenanceCaseService } from "../maintenance/case-service.js";

// Flow 2 T1.1/T1.3/T1.4 against real PostgreSQL. Cleanup disables user triggers and holds
// SHARE ROW EXCLUSIVE locks until commit. vitest.config.ts runs API files one at a time when
// ARDEN_TEST_DATABASE_URL is set, so this cleanup cannot deadlock with another file's writes.
// Requires a disposable, fully migrated database named arden_test_* ; skipped otherwise.
const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;
const id = () => randomUUID();
const ids = {
  orgA: id(), orgB: id(), scopeA: id(),
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
      await client.query(`INSERT INTO organization (id, name, slug)
        VALUES ($1, 'Readers A', $2), ($3, 'Readers B', $4)`,
      [ids.orgA, `readers-a-${ids.orgA}`, ids.orgB, `readers-b-${ids.orgB}`]);
      for (const userId of userIds) {
        await client.query(`INSERT INTO account (id, email, full_name) VALUES ($1, $2, 'Synthetic reader')`,
          [userId, `${userId}@example.test`]);
      }
      await client.query(`INSERT INTO membership (id, organization_id, account_id, status)
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
        await client.query(`INSERT INTO role (id, organization_id, code, name) VALUES ($1, $2, $3, $3)`,
          [roleId, organizationId, `READERS_${code}_${roleId.replaceAll("-", "").toUpperCase()}`]);
        await client.query(`INSERT INTO department (id, organization_id, code, name, default_role_id, status)
          VALUES ($1, $2, $3, $3, $4, $5)`, [departmentId, organizationId, code, roleId, status]);
      }
      await client.query(`INSERT INTO department_membership (membership_id, department_id, is_primary)
        VALUES ($1, $5, true), ($2, $5, true), ($3, $6, true), ($4, $5, true)`,
      [ids.authorM, ids.reviewerM, ids.engineerM, ids.outsiderM, ids.sales, ids.engineering]);
      await client.query(`INSERT INTO access_scope (id, organization_id, scope) VALUES ($1, $2, 'ORGANIZATION')`,
        [ids.scopeA, ids.orgA]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.authorM, ids.scopeA]);
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
          await client.query("DELETE FROM case_event WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM case_intake_key WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM maintenance_case WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM inspection WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM notification WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM relationship_request_key WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM document_relationship WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM publication_renewal WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM current_publication WHERE organization_id = ANY($1::uuid[])", [orgs]);
          // Change requests reference a published version; remove them before the publications.
          await client.query(`DELETE FROM review_decision WHERE review_submission_id IN (SELECT id AS submission_id FROM review_submission
            WHERE organization_id = ANY($1::uuid[]) AND request_type <> 'CONTENT')`, [orgs]);
          await client.query(`DELETE FROM review_submission WHERE organization_id = ANY($1::uuid[])
            AND request_type <> 'CONTENT'`, [orgs]);
          await client.query(`DELETE FROM published_version WHERE review_submission_id IN
            (SELECT id AS submission_id FROM review_submission WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM index_generation WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query(`DELETE FROM review_decision WHERE review_submission_id IN
            (SELECT id AS submission_id FROM review_submission WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM review_submission WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM knowledge_base WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM reviewer_grant WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query(`DELETE FROM working_version WHERE document_id IN
            (SELECT id AS shared_draft_id FROM company_document WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
          await client.query("DELETE FROM company_document WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM policy_reader WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM reader_policy WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])", [membershipIdsA]);
          await client.query(`DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])`, [membershipIdsA]);
          await client.query("DELETE FROM membership WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM department WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM role WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM access_scope WHERE organization_id = ANY($1::uuid[])", [orgs]);
          await client.query("DELETE FROM account WHERE id = ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM organization WHERE id = ANY($1::uuid[])", [orgs]);
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
      client.query<{ selection_id: string }>(`INSERT INTO reader_policy (organization_id, mode, department_id)
        VALUES ($1, $2, $3) RETURNING id AS selection_id`, [organizationId, mode, departmentId]).then(r => r.rows[0]!.selection_id);
    const addReader = (client: PoolClient, selectionId: string, membershipId: string, ordinal: number, organizationId = ids.orgA) =>
      client.query(`INSERT INTO policy_reader (reader_policy_id, organization_id, membership_id, position)
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
      await expect(sqlState((client) => client.query(`UPDATE reader_policy SET mode = 'ORGANIZATION'
        WHERE id = $1`, [saved]))).resolves.toBe("55000");
      await expect(sqlState((client) => client.query(`DELETE FROM policy_reader WHERE reader_policy_id = $1`, [saved])))
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
        selections: (await client.query(`SELECT id AS selection_id FROM reader_policy WHERE id = ANY($1::uuid[])`,
          [[selectionA, selectionB]])).rows.map(row => row.selection_id),
        readers: (await client.query(`SELECT 1 FROM policy_reader WHERE reader_policy_id = $1`, [selectionA])).rowCount,
        facts: (await client.query(`SELECT * FROM reader_selection_member_facts($1::uuid[])`, [[ids.authorM]])).rowCount,
      }));
      expect(fromB).toEqual({ selections: [selectionB], readers: 0, facts: 0 });
      // Pretending to be in organization A while being a member of B does not help.
      const spoofed = await asRuntime(ids.foreign, ids.orgA, async (client) =>
        (await client.query(`SELECT 1 FROM reader_policy WHERE id = $1`, [selectionA])).rowCount);
      expect(spoofed).toBe(0);
      await expect(asRuntime(ids.foreign, ids.orgB, (client) => client.query(`INSERT INTO reader_policy
        (organization_id, mode) VALUES ($1, 'ORGANIZATION')`, [ids.orgA]))).rejects.toMatchObject({ code: "42501" });
      const fromA = await asRuntime(ids.outsider, ids.orgA, async (client) =>
        (await client.query(`SELECT 1 FROM policy_reader WHERE reader_policy_id = $1`, [selectionA])).rowCount);
      expect(fromA).toBe(2);
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(`UPDATE reader_policy
        SET revision = 2 WHERE id = $1`, [selectionA]))).rejects.toMatchObject({ code: "42501" });
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
        responsibleDepartmentId: ids.sales,
        targetReaders: { mode: "DEPARTMENT", departmentId: ids.engineering },
      }, null, "readers-configure");
      const department = { mode: "DEPARTMENT", departmentId: ids.engineering, memberIds: [] };
      expect(configured).toMatchObject({ kind: "updated", draft: { targetReaders: department } });
      if (configured.kind !== "updated") return;

      const submitted = await repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 3, randomUUID(), "readers-submit");
      expect(submitted).toMatchObject({ kind: "submitted", submission: { proposedTargetReaders: department } });
      if (submitted.kind !== "submitted") return;
      const routing = await asSuperuser((client) => client.query(`SELECT target_scope AS target_scope_type, owner_department_id AS responsible_department_id
        FROM review_submission WHERE id = $1`, [submitted.submission.id]));
      expect(routing.rows).toEqual([{ target_scope_type: "DEPARTMENT", responsible_department_id: ids.sales }]);
      // Drafts stay editable while a snapshot is pending (decision 0011); the submitted readers do not change.
      await expect(save(3, { mode: "ORGANIZATION" })).resolves.toMatchObject({ kind: "updated",
        draft: { targetReaders: { mode: "ORGANIZATION" } } });
      const pending = await repository.listKnowledgeSubmissions(ids.author, ids.orgA);
      expect(pending?.find((item) => item.id === submitted.submission.id)?.proposedTargetReaders).toEqual(department);
      await expect(sqlState((client) => client.query(`UPDATE review_submission SET proposed_reader_policy_id = NULL
        WHERE id = $1`, [submitted.submission.id]))).resolves.toBe("55000");
      // Approved readers are recorded only by an approval decision, and only once (0025).
      await expect(sqlState(async (client) => {
        await client.query(`UPDATE review_submission SET approved_reader_policy_id = proposed_reader_policy_id
          WHERE id = $1`, [submitted.submission.id]);
        await client.query(`UPDATE review_submission SET approved_reader_policy_id = NULL
          WHERE id = $1`, [submitted.submission.id]);
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

  /** A pending submission restricted to the author and engineer. */
  const submitSelectedDraft = async (title: string) => {
    if (!repository) throw new Error("Test database is unavailable");
    const draftId = await createDraft(ids.author, ids.orgA, ids.authorM, title);
    const configured = await repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, 1, {
      responsibleDepartmentId: ids.sales,
    }, null, "flow2-configure");
    if (configured.kind !== "updated") throw new Error(`Configure fixture failed: ${configured.kind}`);
    await prepareKnowledgeFixture(pool!, ids.orgA, draftId, [ids.authorM, ids.engineerM]);
    const submitted = await repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 2, randomUUID(), "flow2-submit");
    if (submitted.kind !== "submitted") throw new Error(`Submit fixture failed: ${submitted.kind}`);
    return { draftId, submissionId: submitted.submission.id };
  };

  describe("Document metadata and relationships", () => {
    it("creates an organization without the retired category catalog and validates keywords", async () => {
      const organizationId = id();
      await asRuntime(ids.outsider, "", (client) => client.query(`INSERT INTO organization
        (id, name, slug, created_by_account_id)
        VALUES ($1, 'Metadata fixture', $2, $3)`, [organizationId, `metadata-${organizationId}`, ids.outsider]));
      const catalogs = await asSuperuser((client) => client.query(`SELECT
        to_regclass('arden.document_category') AS category, to_regclass('arden.authorization_policy') AS policy`));
      expect(catalogs.rows).toEqual([{ category: null, policy: null }]);
      const draftId = await createDraft(ids.author, ids.orgA, ids.authorM, "Keyword fixture");
      for (const keywords of [["  padded"], ["dup", "DUP"], [""], Array.from({ length: 21 }, (_, n) => `k${n}`)]) {
        await expect(sqlState((client) => client.query("UPDATE company_document SET keywords = $2 WHERE id = $1",
          [draftId, keywords]))).resolves.toBe("23514");
      }
      await expect(sqlState((client) => client.query("UPDATE company_document SET keywords = $2 WHERE id = $1",
        [draftId, ["onboarding", "VPN"]]))).resolves.toBeNull();
    });

    it("links published documents of one organization only, enforces dual-endpoint RLS, and allows ghost-edge cleanup (0072)", async () => {
      const publishDraftForLink = async (
        draftId: string,
        title: string,
        options: {
          readerMode?: "ORGANIZATION" | "SELECTED_MEMBERS";
          selectedMembers?: string[];
          expirationDate?: string | null;
        } = {},
      ) => {
        const versionId = id();
        const submissionId = id();
        const draftVersionId = id();
        const selectionId = id();
        await asSuperuser(async (client) => {
          await client.query(
            `INSERT INTO reader_policy (id, organization_id, mode, department_id)
             VALUES ($1, $2, $3, NULL)`,
            [selectionId, ids.orgA, options.readerMode ?? "ORGANIZATION"],
          );
          if (options.readerMode === "SELECTED_MEMBERS") {
            const members = options.selectedMembers ?? [ids.authorM, ids.engineerM];
            for (let i = 0; i < members.length; i += 1) {
              await client.query(
                `INSERT INTO policy_reader (reader_policy_id, organization_id, membership_id, position)
                 VALUES ($1, $2, $3, $4)`,
                [selectionId, ids.orgA, members[i], i + 1],
              );
            }
          }
          const kb = await client.query<{ knowledge_base_id: string }>(
            `INSERT INTO knowledge_base (organization_id, name, scope)
             VALUES ($1, 'Link fixture ' || $2, 'ORGANIZATION')
             RETURNING id AS knowledge_base_id`,
            [ids.orgA, draftId],
          );
          const management = options.expirationDate !== undefined
            ? JSON.stringify({
              type: "Guide",
              version: "1.0",
              expirationDate: options.expirationDate,
              changeNote: "",
            })
            : null;
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            `INSERT INTO working_version (id, document_id, version_no, file_uri, mime_type, content_hash)
             VALUES ($1, $2, 2, $3, 'text/plain', $4)`,
            [draftVersionId, draftId, `arden-private-object://${draftId}`, "d".repeat(64)],
          );
          await client.query(
            `INSERT INTO review_submission (
               id, organization_id, document_id, working_version_id, snapshot_version_no,
               submitted_by_id, target_scope, target_department_id, owner_department_id,
               title, classification, policy_version, review_rule, file_uri, mime_type,
               content_hash, status, publication_state, submit_request_id, proposed_reader_policy_id, approved_reader_policy_id, metadata
             ) VALUES (
               $1, $2, $3, $4, 2, $5, 'ORGANIZATION', NULL, $6, $7, 'INTERNAL', 1, 'GRANT_SCOPE',
               $8, 'text/plain', $9, 'APPROVED', 'ACTIVE', gen_random_uuid(), $10, $10, $11::jsonb
             )`,
            [
              submissionId, ids.orgA, draftId, draftVersionId, ids.authorM, ids.sales, title,
              `arden-private-object://${draftId}`, "d".repeat(64), selectionId, management,
            ],
          );
          await client.query(
            `INSERT INTO published_version (
               id, review_submission_id, knowledge_base_id, published_by_id,
               title, version_no, file_uri, content_hash, index_status, published_at,
               document_id, classification, owner_department_id,
               valid_from, reader_policy_id, metadata, author_id
             ) VALUES (
               $1, $2, $3, NULL, $5, 1, $6, $7, 'INDEXED', now(), $8, 'INTERNAL', $9,
               now(), $10, $11::jsonb, $4
             )`,
            [
              versionId, submissionId, kb.rows[0]!.knowledge_base_id, ids.authorM, title,
              `arden-private-object://${draftId}`, "d".repeat(64), draftId, ids.sales,
              selectionId, management,
            ],
          );
          await client.query(
            `INSERT INTO current_publication (
               document_id, organization_id, published_version_id,
               target_scope, target_department_id, valid_from, reader_policy_id
             ) VALUES ($1, $2, $3, 'ORGANIZATION', NULL, now(), $4)`,
            [draftId, ids.orgA, versionId, selectionId],
          );
        });
        return { versionId, selectionId };
      };

      const source = await createDraft(ids.author, ids.orgA, ids.authorM, "Link source");
      const target = await createDraft(ids.author, ids.orgA, ids.authorM, "Link target");
      const restrictedTarget = await createDraft(ids.author, ids.orgA, ids.authorM, "Restricted link target");
      const expiredTarget = await createDraft(ids.author, ids.orgA, ids.authorM, "Expired link target");
      const foreign = await createDraft(ids.foreign, ids.orgB, ids.foreignM, "Foreign target");
      const link = (client: PoolClient, organizationId: string, to: string, by = ids.authorM) => client.query(`
        INSERT INTO document_relationship (organization_id, source_document_id, target_document_id, created_by_id)
        VALUES ($1, $2, $3, $4)`, [organizationId, source, to, by]);

      // Cross-org and self-link structural constraints stay enforced at schema level.
      await expect(sqlState((client) => link(client, ids.orgA, foreign))).resolves.toBe("23503");
      await expect(sqlState((client) => link(client, ids.orgB, foreign, ids.foreignM))).resolves.toBe("23503");
      await expect(sqlState((client) => link(client, ids.orgA, source))).resolves.toBe("23514");

      // Under 0072, unpublished drafts cannot be linked at runtime even by their author.
      await expect(asRuntime(ids.author, ids.orgA, (client) => link(client, ids.orgA, target)))
        .rejects.toMatchObject({ code: "42501" });

      // Publish source (org-readable), target (author + engineer only), restrictedTarget (engineer + outsider only), and expiredTarget.
      await publishDraftForLink(source, "Link source", { readerMode: "ORGANIZATION" });
      const publishedTarget = await publishDraftForLink(target, "Link target", {
        readerMode: "SELECTED_MEMBERS",
        selectedMembers: [ids.authorM, ids.engineerM],
      });
      await publishDraftForLink(restrictedTarget, "Restricted link target", {
        readerMode: "SELECTED_MEMBERS",
        selectedMembers: [ids.engineerM, ids.outsiderM],
      });
      await publishDraftForLink(expiredTarget, "Expired link target", {
        readerMode: "ORGANIZATION",
        expirationDate: "2020-01-01",
      });

      // Outsider (not author or org admin) is rejected.
      await expect(asRuntime(ids.outsider, ids.orgA, (client) => link(client, ids.orgA, target, ids.outsiderM)))
        .rejects.toMatchObject({ code: "42501" });
      // Author/admin cannot link to an unreadable restricted target or an expired target.
      await expect(asRuntime(ids.author, ids.orgA, (client) => link(client, ids.orgA, restrictedTarget)))
        .rejects.toMatchObject({ code: "42501" });
      await expect(asRuntime(ids.author, ids.orgA, (client) => link(client, ids.orgA, expiredTarget)))
        .rejects.toMatchObject({ code: "42501" });

      // Author can link published source -> readable published target; commit so other actors can test SELECT/ghost-delete.
      const createdRelationshipId = await asSuperuser(async (client) => {
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
          [ids.author, ids.orgA]);
        const inserted = await client.query<{ relationship_id: string; target_document_id: string }>(`
          INSERT INTO document_relationship (organization_id, source_document_id, target_document_id, created_by_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id AS relationship_id, target_document_id`, [ids.orgA, source, target, ids.authorM]);
        expect(inserted.rows[0]?.target_document_id).toBe(target);
        const visible = await client.query("SELECT target_document_id FROM document_relationship WHERE source_document_id = $1", [source]);
        expect(visible.rows).toEqual([{ target_document_id: target }]);
        return inserted.rows[0]!.relationship_id;
      });

      // Dual-endpoint SELECT RLS: engineer (reader of both) sees the edge; outsider (cannot read target) sees 0 rows.
      await expect(asRuntime(ids.engineer, ids.orgA, (client) =>
        client.query("SELECT target_document_id FROM document_relationship WHERE source_document_id = $1", [source])))
        .resolves.toMatchObject({ rows: [{ target_document_id: target }] });
      await expect(asRuntime(ids.outsider, ids.orgA, (client) =>
        client.query("SELECT target_document_id FROM document_relationship WHERE source_document_id = $1", [source])))
        .resolves.toMatchObject({ rowCount: 0 });

      // Expire the target: SELECT now hides the ghost edge from everyone, but the source author can still clean it up.
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(
          `UPDATE published_version
              SET metadata = jsonb_build_object('type', 'Guide', 'version', '1.0', 'expirationDate', '2020-01-01', 'changeNote', '')
            WHERE id = $1`,
          [publishedTarget.versionId],
        );
      });
      await expect(asRuntime(ids.author, ids.orgA, (client) =>
        client.query("SELECT 1 FROM document_relationship WHERE id = $1", [createdRelationshipId])))
        .resolves.toMatchObject({ rowCount: 0 });
      await expect(asRuntime(ids.outsider, ids.orgA, (client) =>
        client.query("SELECT * FROM remove_governed_document_relationship($1, $2)", [source, createdRelationshipId])))
        .resolves.toMatchObject({ rowCount: 0 });
      await expect(asRuntime(ids.author, ids.orgA, (client) =>
        client.query("SELECT relationship_id, target_document_id FROM remove_governed_document_relationship($1, $2)",
          [source, createdRelationshipId])))
        .resolves.toMatchObject({ rows: [{ relationship_id: createdRelationshipId, target_document_id: target }] });
    });
  });

  it("runs Target Readers with the retired tables and Audience helper removed", async () => {
    const inventory = await asSuperuser((client) => client.query(`SELECT
      to_regclass('arden.audience') AS catalog,
      to_regclass('arden.audience_group_membership') AS memberships,
      to_regclass('arden.shared_draft_audience') AS draft_audiences,
      to_regprocedure('arden.actor_in_publication_audience(uuid,uuid[],text,uuid)') AS authorization`));
    expect(inventory.rows).toEqual([{ catalog: null, memberships: null, draft_audiences: null, authorization: null }]);
  });

  describe("T5.1 withdraw a pending submission (migration 0029)", () => {
    it("withdraws only the author's pending submission, once, and refuses a decided one", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, submissionId } = await submitSelectedDraft("Withdrawal fixture");
      await expect(repository.withdrawKnowledgeSubmission(ids.outsider, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawKnowledgeSubmission(ids.foreign, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toMatchObject({ kind: "withdrawn", submission: { id: submissionId, status: "WITHDRAWN" } });
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, submissionId, "flow2-withdraw"))
        .resolves.toMatchObject({ kind: "replayed", submission: { status: "WITHDRAWN" } });
      const evidence = await asSuperuser((client) => client.query<{ pending: string; audits: string }>(`
        SELECT (SELECT count(*) FROM review_submission WHERE document_id = $1 AND status = 'PENDING_REVIEW')::text AS pending,
               (SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_SUBMISSION_WITHDRAWN'
                  AND details->>'submissionId' = $2)::text AS audits`, [draftId, submissionId]));
      expect(evidence.rows[0]).toEqual({ pending: "0", audits: "1" });
      // A withdrawal is final, even for the database owner.
      await expect(sqlState((client) => client.query(`UPDATE review_submission SET status = 'PENDING_REVIEW'
        WHERE id = $1`, [submissionId]))).resolves.toBe("55000");
    });

    it("returns a conflict for an approved submission and blocks a direct runtime withdrawal by others", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const approved = await submitSelectedDraft("Approved fixture");
      await asSuperuser((client) => client.query(`UPDATE review_submission SET status = 'APPROVED', publication_state = 'PREPARING',
        approved_reader_policy_id = proposed_reader_policy_id
        WHERE id = $1`, [approved.submissionId]));
      await expect(repository.withdrawKnowledgeSubmission(ids.author, ids.orgA, approved.submissionId, "flow2-withdraw"))
        .resolves.toEqual({ kind: "conflict" });
      await expect(sqlState((client) => client.query(`UPDATE review_submission SET status = 'WITHDRAWN', publication_state = 'NONE'
        WHERE id = $1`, [approved.submissionId]))).resolves.toBe("55000");

      const pending = await submitSelectedDraft("Pending fixture");
      const changed = await asRuntime(ids.reviewer, ids.orgA, (client) => client.query(`UPDATE review_submission
        SET status = 'WITHDRAWN' WHERE id = $1`, [pending.submissionId]));
      expect(changed.rowCount).toBe(0);
    });
  });

  describe("T6.1 reader-change and withdrawal requests (migrations 0034–0035)", () => {
    /** Publishes a real approved submission by pointing the current publication at it (no index pipeline). */
    const publish = async (title: string) => {
      const { draftId, submissionId } = await submitSelectedDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE review_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_reader_policy_id = proposed_reader_policy_id WHERE id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope) VALUES ($1, 'Change fixture ' || $2, 'ORGANIZATION')
          RETURNING id AS knowledge_base_id`, [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_version (id, review_submission_id, knowledge_base_id,
            title, version_no, file_uri, content_hash, document_id, classification, owner_department_id,
            valid_from, reader_policy_id)
          SELECT $1, s.id, $3, s.title, 1, s.file_uri, s.content_hash, s.document_id, s.classification,
                 s.owner_department_id, now(), s.approved_reader_policy_id
            FROM review_submission s WHERE s.id = $2`,
        [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
        await client.query(`INSERT INTO current_publication (document_id, organization_id, published_version_id,
            target_scope, valid_from, reader_policy_id)
          SELECT pv.document_id, $2, pv.id, 'ORGANIZATION', pv.valid_from,
                 pv.reader_policy_id FROM published_version pv WHERE pv.id = $1`,
        [versionId, ids.orgA]);
      });
      return { draftId, submissionId, versionId };
    };
    const currentPointer = (draftId: string) => asSuperuser(async (client) => (await client.query(
      "SELECT published_version_id, reader_policy_id AS reader_selection_id FROM current_publication WHERE document_id = $1",
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
      const stored = await asSuperuser((client) => client.query(`SELECT target_published_version_id FROM review_submission
        WHERE id = $1`, [requested.submission.id]));
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
        "SELECT 1 FROM current_publication WHERE document_id = $1", [draftId]))).rowCount;
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
        "SELECT publication_state FROM review_submission WHERE id = $1", [submissionId]));
      expect(released.rows[0]).toEqual({ publication_state: "WITHDRAWN" });
      const audit = await asSuperuser((client) => client.query(`SELECT details->>'requestType' AS type FROM audit_event
        WHERE event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND details->>'submissionId' = $1`, [requested.submission.id]));
      expect(audit.rows).toEqual([{ type: "WITHDRAWAL" }]);

      // No restore: the approved request cannot be applied again, and a new request needs a publication.
      await expect(sqlState((client) => client.query("SELECT apply_publication_change($1)", [requested.submission.id])))
        .resolves.toBe("55000");
      await expect(ask(draftId, { type: "WITHDRAWAL", reason: "Again" })).resolves.toEqual({ kind: "not-published" });
      // Publishing again is a new content submission of a new version.
      const edited = await repository.updateKnowledgeDraft(ids.author, ids.orgA, draftId, 2, { title: "Published again" },
        null, "republish-edit");
      // A new business version with a Change Note, set like prepareKnowledgeFixture (this fixture uses a prepared reader selection).
      await asSuperuser((client) => client.query(`UPDATE company_document SET metadata = metadata
        || jsonb_build_object('version', '2.0', 'changeNote', 'Republished after review') WHERE id = $1`, [draftId]));
      if (edited.kind !== "updated") throw new Error("Edit failed");
      await expect(repository.submitKnowledgeDraft(ids.author, ids.orgA, draftId, 3, randomUUID(), "republish"))
        .resolves.toMatchObject({ kind: "submitted", submission: { requestType: "CONTENT", status: "PENDING_REVIEW" } });
    });

    it("T6.2: an approved reader change applies the approved readers to the current publication", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publish("Published then narrowed");
      const activationNotifications = await asSuperuser((client) => client.query(`
        SELECT id AS notification_id FROM notification
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
      }>(`SELECT n.event_type, n.recipient_id AS recipient_membership_id, n.publication_title, n.shared_by_name,
                  EXISTS (SELECT 1 FROM notification_outbox o WHERE o.notification_id = n.id) AS has_outbox
            FROM notification n
           WHERE n.organization_id = $1 AND n.event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
             AND n.resource_type = 'PUBLICATION' AND n.resource_id = $2
           ORDER BY n.recipient_id`, [ids.orgA, versionId]));
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
        SELECT event_type, recipient_id AS recipient_membership_id FROM notification
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
        const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_policy
          (organization_id, mode) VALUES ($1, 'ORGANIZATION') RETURNING id AS selection_id`, [ids.orgA]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE published_version SET reader_policy_id = $2 WHERE id = $1",
          [versionId, selection.rows[0]!.selection_id]);
        await client.query("UPDATE current_publication SET reader_policy_id = $2 WHERE published_version_id = $1",
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
      }>(`SELECT event_type, recipient_id AS recipient_membership_id, publication_title, shared_by_name FROM notification
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
        await client.query("DELETE FROM current_publication WHERE document_id = $1", [draftId]);
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
      await expect(sqlState((client) => client.query(`INSERT INTO review_submission (organization_id, document_id,
          working_version_id, snapshot_version_no, submitted_by_id, target_scope, owner_department_id,
          title, classification, policy_version, file_uri, mime_type, content_hash, submit_request_id,
          request_type, request_reason, target_published_version_id)
        SELECT organization_id, document_id, working_version_id, snapshot_version_no, $2, target_scope,
               owner_department_id, title, classification, 1, file_uri, mime_type, content_hash,
               gen_random_uuid(), 'WITHDRAWAL', 'Not the author', (SELECT published_version_id FROM current_publication
                 WHERE document_id = $3)
          FROM review_submission WHERE id = $1`, [submissionId, ids.reviewerM, draftId]))).resolves.toBe("23514");
    });
  });

  describe("T6.3 retry a failed preparation (migration 0036)", () => {
    /** An approved content submission with the generation and job the approval trigger creates (0019). */
    const prepare = async (title: string) => {
      const { draftId, submissionId } = await submitSelectedDraft(title);
      return asSuperuser(async (client) => {
        await client.query(`UPDATE review_submission SET status = 'APPROVED', publication_state = 'PREPARING',
            approved_reader_policy_id = proposed_reader_policy_id WHERE id = $1`, [submissionId]);
        const job = await client.query<{ job_id: string; max_attempts: number }>(`INSERT INTO index_generation
            (organization_id, review_submission_id, document_id, snapshot_version_id, snapshot_content_hash,
             job_id, job_status, attempt_count, max_attempts, available_at, job_created_at, job_updated_at)
          SELECT organization_id, id, document_id, working_version_id, content_hash,
                 gen_random_uuid(), 'PENDING', 0, 6, now(), now(), now()
            FROM review_submission WHERE id = $1 RETURNING job_id, max_attempts`, [submissionId]);
        return { draftId, submissionId, jobId: job.rows[0]!.job_id, maxAttempts: job.rows[0]!.max_attempts };
      });
    };
    /** What the worker does after an attempt fails: fail_knowledge_index_job under its own lease. */
    const failAttempt = (jobId: string, attempt: number, code: string, retryable: boolean) => asSuperuser(async (client) => {
      const worker = randomUUID();
      await client.query(`UPDATE index_generation SET status = 'PROCESSING', job_status = 'RUNNING',
          attempt_count = $2, lease_owner_id = $3,
          lease_expires_at = now() + interval '5 minutes' WHERE job_id = $1`, [jobId, attempt, worker]);
      return (await client.query<{ status: string }>("SELECT fail_knowledge_index_job($1, $2, $3, $4) AS status",
        [jobId, worker, code, retryable])).rows[0]?.status;
    });
    const state = (submissionId: string) => asSuperuser(async (client) => (await client.query<{
      publication_state: string; publication_failure_code: string | null; generation: string; job: string;
      attempt_count: number; audits: string }>(`
      SELECT s.publication_state, s.publication_failure_code, g.status AS generation, g.job_status AS job, g.attempt_count,
             (SELECT count(*) FROM audit_event a WHERE a.event_type = 'KNOWLEDGE_PUBLICATION_RETRIED'
                AND a.details->>'submissionId' = s.id::text)::text AS audits
        FROM review_submission s JOIN index_generation g ON s.id = g.review_submission_id
        WHERE s.id = $1`, [submissionId])).rows[0]);
    const failure = async (submissionId: string) => (await repository!.listKnowledgeSubmissions(ids.author, ids.orgA))
      ?.find((submission) => submission.id === submissionId)?.publicationFailure;

    it("retries automatically with a longer backoff, then lets only the author retry a temporary failure", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { submissionId, jobId, maxAttempts } = await prepare("Temporary failure");
      expect(maxAttempts).toBe(6);
      await expect(failAttempt(jobId, 1, "AI_SERVICE_UNAVAILABLE", true)).resolves.toBe("PENDING");
      const delay = await asSuperuser(async (client) => (await client.query<{ seconds: number }>(
        "SELECT extract(epoch FROM available_at - now())::float AS seconds FROM index_generation WHERE job_id = $1",
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
        "UPDATE review_submission SET publication_failure_code = 'AI_SERVICE_UNAVAILABLE' WHERE id = $1",
        [submissionId]))).rejects.toMatchObject({ code: "42501" });
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(
        "UPDATE index_generation SET job_status = 'PENDING' WHERE job_id = $1", [jobId])))
        .rejects.toMatchObject({ code: "42501" });
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query(
        "SELECT job_status FROM index_generation"))).rejects.toMatchObject({ code: "42501" });
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

      const pending = await submitSelectedDraft("Still pending");
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, pending.submissionId))
        .resolves.toEqual({ kind: "not-failed" });

      // The 0021 high-water mark: once this snapshot (or a newer one) of the document has a published version,
      // preparing it again could never make it current.
      const stale = await prepare("Already published");
      await expect(failAttempt(stale.jobId, 1, "AI_SERVICE_UNAVAILABLE", false)).resolves.toBe("FAILED");
      await asSuperuser(async (client) => {
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope) VALUES ($1, 'Retry fixture ' || $2, 'ORGANIZATION')
          RETURNING id AS knowledge_base_id`, [ids.orgA, stale.draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_version (id, review_submission_id, knowledge_base_id,
            title, version_no, file_uri, content_hash, document_id, classification, owner_department_id,
            valid_from, reader_policy_id)
          SELECT gen_random_uuid(), s.id, $2, s.title, 1, s.file_uri, s.content_hash, s.document_id,
                 s.classification, s.owner_department_id, now(), s.approved_reader_policy_id
            FROM review_submission s WHERE s.id = $1`, [stale.submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
      });
      await expect(repository.retryKnowledgePublication(ids.author, ids.orgA, stale.submissionId))
        .resolves.toEqual({ kind: "superseded" });
    });

    it("records the failure code when the final lease expires without a worker", async () => {
      const { submissionId, jobId } = await prepare("Lease exhausted");
      await asSuperuser(async (client) => {
        await client.query(`UPDATE index_generation SET status = 'PROCESSING', job_status = 'RUNNING',
            attempt_count = max_attempts, lease_owner_id = gen_random_uuid(),
            lease_expires_at = now() - interval '1 second' WHERE job_id = $1`, [jobId]);
        await client.query("SELECT * FROM claim_knowledge_index_job(gen_random_uuid(), 60)");
        const row = (await client.query<{ publication_state: string; publication_failure_code: string }>(
          "SELECT publication_state, publication_failure_code FROM review_submission WHERE id = $1",
          [submissionId])).rows[0];
        expect(row).toEqual({ publication_state: "FAILED", publication_failure_code: "INDEXING_LEASE_EXHAUSTED" });
      }, false);
    });
  });

  describe("decision 0023 governance (migration 0037)", () => {
    /** A current publication readable by the selected author and engineer, responsible department Sales. */
    const publishSelected = async (title: string) => {
      const { draftId, submissionId } = await submitSelectedDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE review_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_reader_policy_id = proposed_reader_policy_id WHERE id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope) VALUES ($1, 'Governance ' || $2, 'ORGANIZATION') RETURNING id AS knowledge_base_id`,
        [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_version (id, review_submission_id, knowledge_base_id,
            title, version_no, file_uri, content_hash, document_id, classification, owner_department_id,
            valid_from, reader_policy_id, author_id)
          SELECT $1, s.id, $3, s.title, 1, s.file_uri, s.content_hash, s.document_id, s.classification,
                 s.owner_department_id, now(), s.approved_reader_policy_id, s.submitted_by_id
            FROM review_submission s WHERE s.id = $2`, [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id]);
        await client.query(`INSERT INTO current_publication (document_id, organization_id, published_version_id,
            target_scope, valid_from, reader_policy_id)
          SELECT pv.document_id, $2, pv.id, 'ORGANIZATION', pv.valid_from,
                 pv.reader_policy_id FROM published_version pv WHERE pv.id = $1`, [versionId, ids.orgA]);
      });
      return { draftId, submissionId, versionId };
    };
    // Grants created by a test are revoked after it even when an assertion fails, so the next test can
    // create the same grant without hitting uq_active_reviewer_grant_exact.
    const createdGrants: string[] = [];
    afterEach(async () => {
      const pending = createdGrants.splice(0);
      if (pending.length) await asSuperuser((client) => client.query(
        "UPDATE reviewer_grant SET status = 'INACTIVE' WHERE id = ANY($1::uuid[])", [pending]));
    });
    const grant = (membershipId: string, scope: "DEPARTMENT" | "ORGANIZATION", departmentId: string | null) =>
      asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_id, scope,
          department_id, granted_by_id, classifications, level) VALUES ($1, $2, $3, $4, $5, ARRAY['INTERNAL'], 'STANDARD')
        RETURNING id AS reviewer_grant_id`, [ids.orgA, membershipId, scope, departmentId, ids.authorM]))
        .then((result) => { const grantId = result.rows[0]!.reviewer_grant_id as string; createdGrants.push(grantId); return grantId; });
    const audits = (eventType: string, documentId: string) => asSuperuser(async (client) => (await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_event WHERE event_type = $1 AND details->>'documentId' = $2",
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
      await expect(asRuntime(ids.author, ids.orgA, (client) => client.query("SELECT * FROM inspection")))
        .rejects.toMatchObject({ code: "42501" });

      // 15 minutes idle, or 2 hours in total, ends the inspection.
      await asSuperuser((client) => client.query(
        "UPDATE inspection SET last_used_at = now() - interval '16 minutes', opened_at = now() - interval '20 minutes', expires_at = now() + interval '100 minutes' WHERE id = $1",
        [opened.inspectionId]));
      await expect(repository.useGovernanceInspection(ids.author, ids.orgA, opened.inspectionId)).resolves.toBeNull();
      const second = await repository.openGovernanceInspection(ids.author, ids.orgA, draftId, "Second look");
      if (second.kind !== "opened") throw new Error("Second inspection was not opened");
      await asSuperuser((client) => client.query(
        "UPDATE inspection SET opened_at = now() - interval '121 minutes', expires_at = now() - interval '1 minute', last_used_at = now() - interval '1 minute' WHERE id = $1",
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
        "SELECT 1 FROM current_publication WHERE document_id = $1", [draftId]))).rowCount).toBe(1);

      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Figures are wrong"))
        .resolves.toEqual({ kind: "withdrawn" });
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Again")).resolves.toEqual({ kind: "not-found" });
      const pointer = await asSuperuser((client) => client.query(
        "SELECT 1 FROM current_publication WHERE document_id = $1", [draftId]));
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
          SELECT $1, id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.reviewerM, ids.scopeA]);
        await client.query("SET LOCAL ROLE arden_runtime");
        await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
          [ids.reviewer, ids.orgA]);
        const result = await client.query("SELECT withdraw_publication_directly($1, 'Admin decision') AS outcome", [draftId]);
        expect(result.rows[0]?.outcome).toBe("WITHDRAWN");
        await client.query("RESET ROLE");
        const provenance = await client.query("SELECT withdrawn_by_role AS withdrawn_by FROM review_submission WHERE id = $1", [submissionId]);
        expect(provenance.rows[0]?.withdrawn_by).toBe("ORGANIZATION_ADMIN");
        const audit = await client.query(`SELECT details->>'withdrawnBy' AS withdrawn_by FROM audit_event
          WHERE event_type = 'KNOWLEDGE_PUBLICATION_WITHDRAWN' AND details->>'documentId' = $1`, [draftId]);
        expect(audit.rows).toEqual([{ withdrawn_by: "ORGANIZATION_ADMIN" }]);
      }, false);
    });

    it("uses Organization grants, not Department grants, for an organization-wide publication", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publishSelected("Organization-wide");
      await asSuperuser(async (client) => {
        const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_policy (organization_id, mode)
          VALUES ($1, 'ORGANIZATION') RETURNING id AS selection_id`, [ids.orgA]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE published_version SET reader_policy_id = $2 WHERE id = $1",
          [versionId, selection.rows[0]!.selection_id]);
        await client.query("UPDATE current_publication SET reader_policy_id = $2 WHERE document_id = $1",
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

    it("accepts one report from an authorized reader and keeps it pinned after withdrawal", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      const { draftId, versionId } = await publishSelected("Reported document");
      await grant(ids.reviewerM, "DEPARTMENT", ids.sales);
      const service = new MaintenanceCaseService(repository.maintenance);
      await expect(repository.reportPublicationProblem(ids.outsider, ids.orgA, draftId, versionId, "Denied"))
        .resolves.toEqual({ kind: "not-found" });
      const report = await repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "Wrong figure");
      expect(report.kind).toBe("reported");
      if (report.kind !== "reported") throw new Error("Expected a maintenance case");
      await expect(repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "Still wrong"))
        .resolves.toEqual({ kind: "duplicate" });
      await expect(service.listCases(ids.outsider, ids.orgA, "queue"))
        .resolves.not.toContainEqual(expect.objectContaining({ caseId: report.reportId }));
      await expect(service.listCases(ids.reviewer, ids.orgA, "queue"))
        .resolves.toContainEqual(expect.objectContaining({ caseId: report.reportId }));
      await expect(repository.withdrawPublicationDirectly(ids.reviewer, ids.orgA, draftId, "Confirmed"))
        .resolves.toEqual({ kind: "not-found" });
      await expect(audits("KNOWLEDGE_PUBLICATION_WITHDRAWN", draftId)).resolves.toBe("0");
      await expect(repository.withdrawPublicationDirectly(ids.author, ids.orgA, draftId, "Confirmed"))
        .resolves.toEqual({ kind: "withdrawn" });
      await expect(service.listCases(ids.engineer, ids.orgA, "mine"))
        .resolves.toContainEqual({ caseId: report.reportId, kind: "minimal", reporterStatus: "Submitted", unread: false });
      await expect(service.listCases(ids.reviewer, ids.orgA, "queue"))
        .resolves.toContainEqual(expect.objectContaining({ caseId: report.reportId, kind: "queue" }));
      await expect(asSuperuser(client => client.query(
        "SELECT published_version_id FROM maintenance_case WHERE id = $1", [report.reportId])))
        .resolves.toMatchObject({ rows: [{ published_version_id: versionId }] });
      await expect(repository.reportPublicationProblem(ids.engineer, ids.orgA, draftId, versionId, "After withdrawal"))
        .resolves.toEqual({ kind: "not-found" });
    });

  });

  describe("decision 0032 expired visibility and renewal (migration 0068)", () => {
    const createdGrants: string[] = [];
    afterEach(async () => {
      const pending = createdGrants.splice(0);
      if (pending.length) await asSuperuser((client) => client.query(
        "UPDATE reviewer_grant SET status = 'INACTIVE' WHERE id = ANY($1::uuid[])", [pending]));
    });
    const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const departmentGrant = () => asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id,
        reviewer_id, scope, department_id, granted_by_id, classifications, level)
      VALUES ($1, $2, 'DEPARTMENT', $3, $4, ARRAY['INTERNAL'], 'STANDARD') RETURNING id AS reviewer_grant_id`,
    [ids.orgA, ids.reviewerM, ids.sales, ids.authorM])).then((result) => { createdGrants.push(result.rows[0]!.reviewer_grant_id); });
    /** A current, indexed publication (readers: author and engineer) whose frozen Valid until is `expires`. */
    const publish = async (title: string, expires: string | null) => {
      const { draftId, submissionId } = await submitSelectedDraft(title);
      const versionId = id();
      await asSuperuser(async (client) => {
        await client.query(`UPDATE review_submission SET status = 'APPROVED', publication_state = 'ACTIVE',
            approved_reader_policy_id = proposed_reader_policy_id WHERE id = $1`, [submissionId]);
        const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
            (organization_id, name, scope) VALUES ($1, 'Renewal fixture ' || $2, 'ORGANIZATION')
          RETURNING id AS knowledge_base_id`, [ids.orgA, draftId]);
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`INSERT INTO published_version (id, review_submission_id, knowledge_base_id,
            title, version_no, file_uri, content_hash, document_id, classification, owner_department_id,
            valid_from, reader_policy_id, index_status, metadata)
          SELECT $1, s.id, $3, s.title, 1, s.file_uri, s.content_hash, s.document_id, s.classification,
                 s.owner_department_id, now() - interval '1 day', s.approved_reader_policy_id, 'INDEXED',
                 jsonb_build_object('type', 'Guide', 'version', '1.0', 'expirationDate', $4::text, 'changeNote', '')
            FROM review_submission s WHERE s.id = $2`,
        [versionId, submissionId, knowledgeBase.rows[0]?.knowledge_base_id, expires]);
        await client.query(`UPDATE published_version SET published_at = now() - interval '1 day'
          WHERE id = $1`, [versionId]);
        await client.query(`INSERT INTO current_publication (document_id, organization_id, published_version_id,
            target_scope, valid_from, reader_policy_id)
          SELECT pv.document_id, $2, pv.id, 'ORGANIZATION', pv.valid_from,
                 pv.reader_policy_id FROM published_version pv WHERE pv.id = $1`,
        [versionId, ids.orgA]);
      });
      return { draftId, versionId };
    };
    const renew = (userId: string, draftId: string, expirationDate: string | null, key = randomUUID()) =>
      repository!.requestPublicationRenewal(userId, ids.orgA, draftId, { expirationDate, reason: "Checked again", idempotencyKey: key }, "renewal");
    const listedFor = async (userId: string) => (await repository!.listPublishedKnowledge(userId, ids.orgA) ?? []).map((item) => item.draftId);
    const pointer = (draftId: string) => asSuperuser(async (client) => (await client.query(
      "SELECT published_version_id FROM current_publication WHERE document_id = $1", [draftId])).rows[0]);
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
        AND details->>'documentId' = $1`, [expired.draftId])).resolves.toBe(0);
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
      await asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_id, scope,
          department_id, granted_by_id, classifications, level)
        VALUES ($1, $2, 'ORGANIZATION', NULL, $3, ARRAY['INTERNAL'], 'STANDARD') RETURNING id AS reviewer_grant_id`,
      [ids.orgA, ids.reviewerM, ids.authorM])).then((result) => { createdGrants.push(result.rows[0]!.reviewer_grant_id); });
    };
    const decideAs = (userId: string, submission: { id: string; snapshotVersionId: string; contentHash: string },
      action: "APPROVE" | "REJECT", comment: string | null = null) => repository!.decideReview(userId, ids.orgA, submission.id,
      action, submission.snapshotVersionId, submission.contentHash, comment, randomUUID(), "renewal-decision");
    const decisionAudit = (submissionId: string) => asSuperuser(async (client) => (await client.query<{ details: Record<string, unknown> }>(
      `SELECT details AS details FROM audit_event WHERE event_type = 'KNOWLEDGE_REVIEW_DECIDED'
        AND details->>'submissionId' = $1`, [submissionId])).rows.map((row) => row.details));

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
      await expect(count(`SELECT count(*) FROM notification WHERE recipient_id = $1
        AND event_type = 'PUBLICATION_RENEWAL_ON_BEHALF' AND resource_id = $2 AND request_reason = 'Checked again'
        AND shared_by_name = 'Synthetic reader'`, [ids.authorM, draftId])).resolves.toBe(1);
      await expect(count(`SELECT count(*) FROM audit_event WHERE event_type = 'KNOWLEDGE_CHANGE_REQUESTED'
        AND details->>'submissionId' = $1 AND details->>'onBehalfOfAuthor' = 'true'
        AND details->>'requestedBy' = $2`, [requested.submission.id, ids.reviewerM])).resolves.toBe(1);
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
        AND details->>'documentId' = $1 AND details->>'onBehalfOfAuthor' = 'true'`, [draftId])).resolves.toBe(1);
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
      await expect(sqlState((client) => client.query(`INSERT INTO review_decision (review_submission_id, reviewer_id,
          decision, is_snapshot_review, decision_request_id, working_version_id, content_hash)
        SELECT id, submitted_by_id, 'APPROVED', true, gen_random_uuid(), working_version_id, content_hash
          FROM review_submission WHERE id = $1`, [asked.submission.id]))).resolves.toBe("AR032");
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
        await client.query(`UPDATE review_submission SET submitted_at = now() - interval '4 days',
            author_response_deadline = now() - interval '1 day' WHERE id = $1`,
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
      await asSuperuser((client) => client.query("UPDATE membership SET status = 'SUSPENDED' WHERE id = $1", [ids.authorM]));
      try {
        const asked = await renew(ids.reviewer, inactive.draftId, utcDay(400));
        expect(asked).toMatchObject({ kind: "requested", submission: { renewal: { onBehalfOfAuthor: true } } });
        await expect(count(`SELECT count(*) FROM notification WHERE event_type = 'PUBLICATION_RENEWAL_ON_BEHALF'
          AND resource_id = $1`, [inactive.draftId])).resolves.toBe(0);
        if (asked.kind !== "requested") return;
        await expect(decideAs(ids.reviewer, asked.submission, "APPROVE"))
          .resolves.toMatchObject({ kind: "decided", submission: { status: "APPROVED" } });
      } finally {
        await asSuperuser((client) => client.query("UPDATE membership SET status = 'ACTIVE' WHERE id = $1", [ids.authorM]));
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
        await client.query("DELETE FROM current_publication WHERE document_id = $1", [gone.draftId]);
      });
      await expect(decideAs(ids.reviewer, late.submission, "APPROVE")).resolves.toEqual({ kind: "denied", reason: "PUBLICATION_CHANGED" });

      const racing = await publish("Newer version preparing", null);
      const race = await ask(racing.draftId, { type: "WITHDRAWAL", reason: "Race" });
      if (race.kind !== "requested") throw new Error(`Withdrawal fixture failed: ${race.kind}`);
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        // A newer approved content version of the same document, still being prepared.
        const version = await client.query<{ id: string }>(`INSERT INTO working_version
          (document_id, version_no, file_uri, mime_type, content_hash, size_bytes)
          SELECT document_id, version_no + 100, file_uri, mime_type, content_hash, size_bytes
            FROM working_version WHERE id = $1
          RETURNING id`, [race.submission.snapshotVersionId]);
        await client.query(`INSERT INTO review_submission (organization_id, document_id, working_version_id,
            snapshot_version_no, submitted_by_id, target_scope, target_department_id, owner_department_id, title,
            classification, policy_version, review_rule, file_uri, mime_type, content_hash,
            submit_request_id, status, publication_state, proposed_reader_policy_id, approved_reader_policy_id)
          SELECT s.organization_id, s.document_id, $2, s.snapshot_version_no + 100,
                 s.submitted_by_id, s.target_scope, s.target_department_id, s.owner_department_id, s.title,
                 s.classification, s.policy_version, s.review_rule, s.file_uri,
                 s.mime_type, s.content_hash, gen_random_uuid(), 'APPROVED', 'PREPARING', pv.reader_policy_id,
                 pv.reader_policy_id
            FROM review_submission s JOIN published_version pv ON pv.id = s.target_published_version_id
            WHERE s.id = $1`, [race.submission.id, version.rows[0]!.id]);
      });
      await expect(decideAs(ids.reviewer, race.submission, "APPROVE")).resolves.toEqual({ kind: "denied", reason: "PUBLICATION_CHANGED" });

      // An Engineering reviewer does not cover this Sales document, reader or not.
      await asSuperuser((client) => client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_id, scope,
          department_id, granted_by_id, classifications, level)
        VALUES ($1, $2, 'DEPARTMENT', $3, $4, ARRAY['INTERNAL'], 'STANDARD') RETURNING id AS reviewer_grant_id`,
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
        responsibleDepartmentId: ids.sales,
        targetReaders: { mode: "ORGANIZATION" },
      }, null, "self-configure");
      if (configured.kind !== "updated") throw new Error(`Configure fixture failed: ${configured.kind}`);
      await prepareKnowledgeFixture(pool!, ids.orgA, draftId, [], false);
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
        `SELECT recipient_id AS recipient, event_key AS key FROM notification
          WHERE event_type = 'PUBLICATION_EXPIRING' AND resource_id = $1 ORDER BY event_key`, [draftId])).rows);
      expect(await notices(soon.draftId)).toEqual([
        { recipient: ids.authorM, key: `expiry:${soon.versionId}:${utcDay(5)}:30` },
        { recipient: ids.reviewerM, key: `expiry:${soon.versionId}:${utcDay(5)}:7` }]);
      expect(await notices(month.draftId)).toEqual([{ recipient: ids.authorM, key: `expiry:${month.versionId}:${utcDay(28)}:30` }]);
      expect(await notices(never.draftId)).toEqual([]);
      await expect(count(`SELECT count(*) FROM notification_outbox o JOIN notification n ON o.notification_id = n.id
        WHERE n.resource_id = $1`, [soon.draftId])).resolves.toBe(2);
    });

    it("refuses to delete a department that still owns current publications", async () => {
      if (!repository) throw new Error("Test database is unavailable");
      await publish("Owned by sales", null);
      await expect(repository.deleteDepartment(ids.author, ids.orgA, ids.sales, "delete-department"))
        .resolves.toMatchObject({ success: false, errorReason: "OWNS_PUBLICATIONS" });
      await expect(count("SELECT count(*) FROM department WHERE id = $1 AND status = 'ACTIVE'", [ids.sales])).resolves.toBe(1);
    });
  });
});
