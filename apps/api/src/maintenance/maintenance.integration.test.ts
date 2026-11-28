import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { MaintenanceCaseService } from "./case-service.js";
import { MaintenanceError } from "./contracts.js";

// Requires a disposable, fully migrated arden_test_* database reached by its owner login (CI's
// ARDEN_TEST_DATABASE_URL). The service runs through a restricted login created for this file only.
const adminUrl = process.env.ARDEN_TEST_DATABASE_URL;
const runtimeLogin = `arden_test_maintenance_${randomUUID().replaceAll("-", "")}`;
const runtimePassword = randomUUID();
let runtimeRoleCreated = false;
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const department = "33333333-3333-4333-8333-333333333311";
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const readerSelectionId = "55555555-5555-4555-8555-555555555555";
const reporter = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const author = { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", membershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
const reviewer = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", membershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const rival = { userId: "12121212-1212-4212-8212-121212121212", membershipId: "13131313-1313-4313-8313-131313131313" };
const admin = { userId: "14141414-1414-4414-8414-141414141414", membershipId: "15151515-1515-4515-8515-151515151515" };
const next = { userId: "16161616-1616-4616-8616-161616161616", membershipId: "17171717-1717-4717-8717-171717171717" };
const outsider = { userId: "23232323-2323-4232-8232-232323232323", membershipId: "24242424-2424-4242-8242-242424242424" };
const hash = "ab".repeat(32);

let pool: Pool | null = null;
const adminPool = adminUrl ? new Pool({ connectionString: adminUrl, max: 1 }) : null;

async function assertDisposable(target: Pool, label: string) {
  const identity = await target.query<{ database_name: string; superuser: boolean; bypass: boolean }>(`
    SELECT current_database() AS database_name, r.rolsuper AS superuser, r.rolbypassrls AS bypass
      FROM pg_roles r WHERE r.rolname = current_user`);
  const row = identity.rows[0];
  if (!row || !/^arden_test_[a-z0-9_]+$/.test(row.database_name)) {
    throw new Error(`${label} must use a disposable arden_test_* database`);
  }
  return row;
}

async function seed(target: Pool) {
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query(`DELETE FROM notification_outbox WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM notification WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM case_event WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM case_intake_key WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM maintenance_case WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM current_publication WHERE organization_id = ANY($1::uuid[])`, [[org, otherOrg]]);
    await client.query(`DELETE FROM published_version WHERE id = $1`, [versionId]);
    await client.query(`DELETE FROM review_submission WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM working_version WHERE document_id = $1`, [documentId]);
    await client.query(`DELETE FROM company_document WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM reader_policy WHERE id = $1`, [readerSelectionId]);
    await client.query(`DELETE FROM knowledge_base WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM reviewer_grant WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])`,
      [[reporter.membershipId, author.membershipId, reviewer.membershipId, rival.membershipId, admin.membershipId, next.membershipId, outsider.membershipId]]);
    await client.query(`DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])`, [[author.membershipId]]);
    await client.query(`DELETE FROM role_permission WHERE role_id IN (SELECT id AS role_id FROM role WHERE organization_id = $1)`, [org]);
    await client.query(`DELETE FROM role WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM access_scope WHERE organization_id = ANY($1::uuid[])`, [[org, otherOrg]]);
    await client.query(`DELETE FROM membership WHERE organization_id = ANY($1::uuid[])`, [[org, otherOrg]]);
    await client.query(`DELETE FROM department WHERE organization_id = $1`, [org]);
    await client.query(`DELETE FROM organization WHERE id = ANY($1::uuid[])`, [[org, otherOrg]]);
    await client.query(`DELETE FROM account WHERE id = ANY($1::uuid[])`,
      [[reporter.userId, author.userId, reviewer.userId, rival.userId, admin.userId, next.userId, outsider.userId]]);

    await client.query(`INSERT INTO organization (id, name, slug) VALUES
      ($1, 'Flow 4 disposable', 'flow4-disposable'), ($2, 'Flow 4 other', 'flow4-other')`, [org, otherOrg]);
    await client.query(`INSERT INTO account (id, email, full_name) VALUES
      ($1, 'flow4-reporter@example.test', 'Synthetic Reporter'),
      ($2, 'flow4-author@example.test', 'Synthetic Author'),
      ($3, 'flow4-reviewer@example.test', 'Synthetic Reviewer'),
      ($4, 'flow4-rival@example.test', 'Synthetic Rival'),
      ($5, 'flow4-admin@example.test', 'Synthetic Admin'),
      ($6, 'flow4-next@example.test', 'Synthetic Next'),
      ($7, 'flow4-outsider@example.test', 'Synthetic Outsider')`,
    [reporter.userId, author.userId, reviewer.userId, rival.userId, admin.userId, next.userId, outsider.userId]);
    await client.query(`INSERT INTO membership (id, organization_id, account_id) VALUES
      ($1, $8, $9), ($2, $8, $10), ($3, $8, $11), ($4, $8, $12), ($5, $8, $13), ($6, $8, $14), ($7, $15, $16)`,
    [reporter.membershipId, author.membershipId, reviewer.membershipId, rival.membershipId, admin.membershipId, next.membershipId,
      outsider.membershipId, org, reporter.userId, author.userId, reviewer.userId, rival.userId, admin.userId, next.userId,
      otherOrg, outsider.userId]);
    await client.query(`INSERT INTO reader_policy (id, organization_id, mode)
      VALUES ($1, $2, 'ORGANIZATION')`, [readerSelectionId, org]);
    const departmentRole = await client.query<{ role_id: string }>(`INSERT INTO role (organization_id, code, name, is_system)
      VALUES ($1, 'DEPT_DEFAULT_FLOW4', 'Support Member', false) RETURNING id AS role_id`, [org]);
    await client.query(`INSERT INTO department (id, organization_id, code, name, default_role_id)
      VALUES ($1, $2, 'SUPPORT', 'Support', $3)`, [department, org, departmentRole.rows[0]?.role_id]);
    await client.query(`INSERT INTO department_membership (membership_id, department_id, is_primary, status)
      VALUES ($1, $2, true, 'ACTIVE')`, [author.membershipId, department]);
    const scope = await client.query<{ access_scope_id: string }>(`INSERT INTO access_scope (organization_id, scope)
      VALUES ($1, 'ORGANIZATION') RETURNING id AS access_scope_id`, [org]);
    await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
      SELECT $1, id, $2 FROM role WHERE organization_id IS NULL AND code = 'ORG_ADMIN' AND is_system`,
    [admin.membershipId, scope.rows[0]?.access_scope_id]);
    await client.query(`INSERT INTO reviewer_grant (organization_id, reviewer_id, granted_by_id,
        classifications, scope)
      VALUES ($1, $2, $5, ARRAY['INTERNAL'], 'ORGANIZATION'),
             ($1, $3, $5, ARRAY['INTERNAL'], 'ORGANIZATION'),
             ($1, $4, $5, ARRAY['INTERNAL'], 'ORGANIZATION')`,
    [org, reviewer.membershipId, rival.membershipId, next.membershipId, admin.membershipId]);
    await client.query(`INSERT INTO company_document (id, organization_id, author_id, title,
        classification, current_version_no, owner_department_id, target_scope)
      VALUES ($1, $2, $3, 'IT Support Guide', 'INTERNAL', 1, $4, 'ORGANIZATION')`,
    [documentId, org, author.membershipId, department]);
    const draftVersion = await client.query<{ shared_draft_version_id: string }>(`INSERT INTO working_version
        (document_id, version_no, file_uri, mime_type, content_hash)
      VALUES ($1, 3, 'arden-private-object://flow4-v3', 'text/plain', $2) RETURNING id AS shared_draft_version_id`,
    [documentId, hash]);
    const submission = await client.query<{ submission_id: string }>(`INSERT INTO review_submission (
        private_version_id, working_version_id, submitted_by_id, target_scope, status,
        organization_id, document_id, snapshot_version_no, owner_department_id, title, classification,
        policy_version, file_uri, mime_type, content_hash, submit_request_id,
        publication_state, review_rule, request_type, proposed_reader_policy_id, approved_reader_policy_id)
      VALUES (NULL, $1, $2, 'ORGANIZATION', 'APPROVED', $3, $4, 3, $5, 'IT Support Guide', 'INTERNAL',
        1, 'arden-private-object://flow4-v3', 'text/plain', $6, $7, 'ACTIVE', 'GRANT_SCOPE', 'CONTENT', $8, $8)
      RETURNING id AS submission_id`,
    [draftVersion.rows[0]?.shared_draft_version_id, author.membershipId, org, documentId, department, hash, randomUUID(),
      readerSelectionId]);
    const knowledgeBase = await client.query<{ knowledge_base_id: string }>(`INSERT INTO knowledge_base
        (organization_id, name, scope) VALUES ($1, 'Flow 4 guide', 'ORGANIZATION') RETURNING id AS knowledge_base_id`, [org]);
    await client.query(`INSERT INTO published_version (id, review_submission_id, knowledge_base_id,
        title, version_no, file_uri, content_hash, document_id, classification, owner_department_id,
        valid_from, author_id, reader_policy_id)
      VALUES ($1, $2, $3, 'IT Support Guide', 3, 'arden-private-object://flow4-v3', $4, $5, 'INTERNAL', $6, now(), $7, $8)`,
    [versionId, submission.rows[0]?.submission_id, knowledgeBase.rows[0]?.knowledge_base_id, hash, documentId, department,
      author.membershipId, readerSelectionId]);
    await client.query(`INSERT INTO current_publication (document_id, organization_id, published_version_id,
        target_scope, valid_from, reader_policy_id)
      VALUES ($1, $2, $3, 'ORGANIZATION', now(), $4)`, [documentId, org, versionId, readerSelectionId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!adminUrl)("maintenance manual path on disposable PostgreSQL", () => {
  let service: MaintenanceCaseService;

  beforeAll(async () => {
    if (!adminPool) throw new Error("ARDEN_TEST_DATABASE_URL was not provided");
    const owner = await assertDisposable(adminPool, "ARDEN_TEST_DATABASE_URL");
    if (!owner.superuser) throw new Error("Fixture setup needs the owner connection on the disposable target");
    // Identifier and password are generated UUIDs, never caller input; the role exists only on this target.
    await adminPool.query(`CREATE ROLE ${runtimeLogin} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    runtimeRoleCreated = true;
    await adminPool.query(`GRANT arden_runtime TO ${runtimeLogin}`);
    const runtimeUrl = new URL(adminUrl!);
    runtimeUrl.username = runtimeLogin;
    runtimeUrl.password = runtimePassword;
    pool = new Pool({ connectionString: runtimeUrl.href, max: 6, connectionTimeoutMillis: 5000 });
    const runtime = await assertDisposable(pool, "the restricted runtime login");
    if (runtime.superuser || runtime.bypass) throw new Error("The maintenance check connection must be the restricted API login");
    service = new MaintenanceCaseService(new ArdenRepository(pool).maintenance);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      const role = await client.query<{ actor: string }>("SELECT current_user AS actor");
      await client.query("ROLLBACK");
      if (role.rows[0]?.actor !== "arden_runtime") throw new Error("The API login cannot assume arden_runtime");
    } finally {
      client.release();
    }
    await seed(adminPool);
  });

  afterAll(async () => {
    await pool?.end();
    if (runtimeRoleCreated) await adminPool?.query(`DROP ROLE IF EXISTS ${runtimeLogin}`);
    await adminPool?.end();
  });

  it("pages migrated Closed reports across tied timestamps without exposing another member's history", async () => {
    await adminPool!.query(`WITH cases AS (
      INSERT INTO arden.maintenance_case (organization_id, origin, reporter_id, document_id,
        published_version_id, content_hash, title, description, review_department_id, classification, author_id,
        assignee_id, reporter_status, outcome, reporter_explanation, first_claimed_at, created_at, resolved_at)
      SELECT $1, 'READER_REPORT', $4, $2, $3, $6, 'IT Support Guide', 'Closed ' || n, $7, 'INTERNAL', $8,
        $5, 'Resolved', 'NO_CHANGE_NEEDED', 'Historical disposition.', '2026-01-02 UTC', '2026-01-01 UTC', '2026-01-02 UTC'
        FROM generate_series(1, 205) n RETURNING id AS case_id
    ), imports AS (
      INSERT INTO arden.case_event (organization_id, case_id, sequence, actor_id,
        event_type, visibility, message, occurred_at, source_report_id)
      SELECT $1, case_id, 1, $4, 'IMPORTED', 'PUBLIC', 'Imported from an existing report.', '2026-01-01 UTC', case_id
        FROM cases
    )
    INSERT INTO arden.case_event (id, organization_id, case_id, sequence,
      actor_id, event_type, visibility, message, occurred_at)
    SELECT case_id, $1, case_id, 2, $5, 'RESOLVED', 'PUBLIC', 'The historical report was dismissed.', '2026-01-02 UTC'
      FROM cases`, [org, documentId, versionId, reporter.membershipId, admin.membershipId, hash, department, author.membershipId]);
    const repository = new ArdenRepository(pool!);
    const first = await repository.listClosedPublicationReports(admin.userId, org, null);
    expect(first?.items).toHaveLength(200);
    expect(first?.nextCursor).toBe(first?.items.at(-1)?.id);
    const second = await repository.listClosedPublicationReports(admin.userId, org, first!.nextCursor);
    expect(second?.items).toHaveLength(5);
    expect(second?.nextCursor).toBeNull();
    expect(new Set([...first!.items, ...second!.items].map((item) => item.id)).size).toBe(205);
    expect(second?.items.every((item) => item.resolution === "DISMISSED" && !item.canView)).toBe(true);
    await expect(repository.listClosedPublicationReports(reporter.userId, org, first!.nextCursor))
      .resolves.toEqual({ items: [], nextCursor: null });
    await expect(repository.listClosedPublicationReports(outsider.userId, otherOrg, first!.nextCursor))
      .resolves.toEqual({ items: [], nextCursor: null });
  });

  it("keeps one open case for the legacy endpoint after migration", async () => {
    const message = "The legacy guidance needs a check.";
    const submit = (text: string) => service.acceptLegacyReport(next.userId, org,
      { documentId, publishedVersionId: versionId, message: text });
    const existing = await submit(message);
    await expect(submit(message)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.importOpenReports(admin.userId, org)).resolves.toEqual({ imported: [], retained: [], held: [] });

    const close = async (caseId: string) => {
      const claimed = await service.claimCase(reviewer.userId, org, caseId, 1, randomUUID());
      if (claimed.kind !== "assigned") throw new Error("expected the reviewer to claim the case");
      return service.decideNoChange(reviewer.userId, org, caseId, claimed.revision,
        "The guidance is still correct.", "Checked the exact version.", randomUUID());
    };
    await close(existing.caseId);

    const concurrent = await Promise.allSettled([submit(message), submit("Another wording for the same document.")]);
    expect(concurrent.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const winner = concurrent.find((item) => item.status === "fulfilled")?.value;
    const rejected = concurrent.find((item) => item.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
    if (winner?.kind !== "reporter") throw new Error("expected one visible new report");

    await close(winner.caseId);
    const repeat = await submit(winner.description);
    expect(repeat).toMatchObject({ reporterStatus: "Submitted" });
    expect(repeat.caseId).not.toBe(winner.caseId);
  }, 30_000);

  it("proves report, one claim, reassignment, no change, and hidden history", async () => {
    const reportKey = randomUUID();
    const input = { origin: "READER_REPORT" as const, documentId, publishedVersionId: versionId, description: "Step 3 is wrong." };
    const created = await service.createCase(reporter.userId, org, input, reportKey);
    const replay = await service.createCase(reporter.userId, org, input, reportKey);
    expect(replay).toMatchObject({ caseId: created.caseId, kind: "reporter" });
    const notices = await adminPool!.query<{ recipient: string }>(`
      SELECT recipient_id AS recipient FROM arden.notification
       WHERE resource_id = $1 AND event_type = 'MAINTENANCE_CASE_UPDATED' AND event_key = $2`,
    [created.caseId, `maintenance:submitted:${created.caseId}`]);
    expect(notices.rows.map(({ recipient }) => recipient).sort())
      .toEqual([reviewer.membershipId, rival.membershipId, next.membershipId].sort());
    await expect(service.listCases(reviewer.userId, org, "queue"))
      .resolves.toContainEqual(expect.objectContaining({ caseId: created.caseId, unread: true }));
    const before = await adminPool!.query<{ cases: string; events: string }>(`
      SELECT count(*)::text AS cases, (SELECT count(*) FROM arden.case_event WHERE organization_id = $1)::text AS events
        FROM arden.maintenance_case WHERE organization_id = $1`, [org]);

    await expect(service.createCase(outsider.userId, otherOrg, input, randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.getCase(outsider.userId, otherOrg, created.caseId)).rejects.toBeInstanceOf(MaintenanceError);
    await expect(service.claimCase(author.userId, org, created.caseId, 1, randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    const raced = await Promise.allSettled([
      service.claimCase(reviewer.userId, org, created.caseId, 1, randomUUID()),
      service.claimCase(rival.userId, org, created.caseId, 1, randomUUID()),
    ]);
    const won = raced.find((result) => result.status === "fulfilled");
    const lost = raced.find((result) => result.status === "rejected");
    if (!won || won.status !== "fulfilled" || !lost || lost.status !== "rejected") throw new Error("expected exactly one claim to win");
    const winner = won.value;
    expect(winner).toMatchObject({ kind: "assigned", reporterStatus: "In Progress" });
    expect([reviewer.membershipId, rival.membershipId]).toContain(winner.kind === "assigned" ? winner.assigneeMembershipId : "");
    expect(lost.reason).toMatchObject({ code: expect.stringMatching(/^(CONFLICT|STALE)$/) });
    const afterRace = await adminPool!.query<{ cases: string; events: string }>(`
      SELECT count(*)::text AS cases, (SELECT count(*) FROM arden.case_event WHERE organization_id = $1)::text AS events
        FROM arden.maintenance_case WHERE organization_id = $1`, [org]);
    expect(afterRace.rows[0]?.cases).toBe(before.rows[0]?.cases);
    expect(Number(afterRace.rows[0]?.events)).toBeGreaterThan(Number(before.rows[0]?.events));

    if (winner.kind !== "assigned") throw new Error("expected the claim winner to see the assigned case");
    await expect(service.listEligibleReviewers(reporter.userId, org, created.caseId)).rejects.toMatchObject({ code: "DENIED" });
    const choices = await service.listEligibleReviewers(admin.userId, org, created.caseId);
    expect(choices).toContainEqual({ membershipId: next.membershipId, displayName: "Synthetic Next" });
    expect(choices.some((item) => item.membershipId === author.membershipId)).toBe(false);
    const former = winner.assigneeMembershipId === reviewer.membershipId ? reviewer : rival;
    const moved = await service.reassignCase(admin.userId, org, created.caseId, winner.revision, next.membershipId, "Coverage changed.", randomUUID());
    if (moved.kind !== "assigned") throw new Error("expected the admin to see the reassigned case");
    await expect(service.decideNoChange(former.userId, org, created.caseId, winner.revision,
      "Nothing to change.", "Former reviewer note.", randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    await expect(service.decideNoChange(next.userId, org, created.caseId, winner.revision,
      "Nothing to change.", "Stale note.", randomUUID())).rejects.toMatchObject({ code: "STALE" });
    const resolved = await service.decideNoChange(next.userId, org, created.caseId, moved.revision,
      "The published step is still correct.", "Checked the source note.", randomUUID());
    expect(resolved).toMatchObject({ reporterStatus: "Resolved" });
    const reporterHistory = await service.listHistory(reporter.userId, org, created.caseId, null);
    expect(reporterHistory.items.map((item) => item.message)).toContain("The published step is still correct.");
    expect(reporterHistory.items.map((item) => item.message)).not.toContain("Checked the source note.");
    const firstPage = await service.listHistory(next.userId, org, created.caseId, null);
    expect(firstPage.items.length).toBeGreaterThan(0);

    await adminPool!.query(`DELETE FROM arden.current_publication WHERE document_id = $1`, [documentId]);
    const hidden = await service.getCase(reporter.userId, org, created.caseId);
    expect(hidden).toEqual({ kind: "minimal", caseId: created.caseId, reporterStatus: "Resolved", unread: false });
    await expect(service.listHistory(reporter.userId, org, created.caseId, null)).resolves.toEqual({ items: [], nextCursor: null });
  }, 30_000);
});
