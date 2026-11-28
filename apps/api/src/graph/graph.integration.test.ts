import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GRAPH_MAX_DOCUMENTS, type KnowledgeMetadata } from "@arden/domain";
import { ArdenRepository } from "../db/repository.js";
import { GraphProjectionService } from "./graph-service.js";
import { DocumentRelationshipService } from "./relationship-service.js";

// Real PostgreSQL 17 FORCE RLS integration tests for GET /knowledge/graph projection (T-04a)
// and governed dual-endpoint document_relationship RLS + API mutations (T-06 / 0076).
// Requires a disposable, fully migrated database named arden_test_* via ARDEN_TEST_DATABASE_URL;
// skipped honestly otherwise (never faking a database pass).
const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;
const service = repository ? new GraphProjectionService(repository.graph) : null;
const relationshipService = repository ? new DocumentRelationshipService(repository.graphRelationships) : null;

const id = () => randomUUID();
const ids = {
  orgA: id(),
  orgB: id(),
  scopeA: id(),
  admin: id(),
  author: id(),
  engineer: id(),
  reviewer: id(),
  outsider: id(),
  suspended: id(),
  foreign: id(),
  adminM: id(),
  authorM: id(),
  engineerM: id(),
  reviewerM: id(),
  outsiderM: id(),
  suspendedM: id(),
  foreignM: id(),
  sales: id(),
  engineering: id(),
  legal: id(),
  deptB: id(),
  salesRole: id(),
  engineeringRole: id(),
  legalRole: id(),
  deptBRole: id(),
  kbOrgA: id(),
  kbDeptEngA: id(),
  kbOrgB: id(),
  selOrgA: id(),
  selEngA: id(),
  selMembersA: id(),
  selOrgB: id(),
  colHandbook: id(),
  colExpiredOnly: id(),
  colLegacy: id(),
  docOrgPolicy: id(),
  docLegacyUncat: id(),
  docSelectedRestricted: id(),
  docExpired: id(),
  docRenewed: id(),
  docOrgB: id(),
};

const userIds = [ids.admin, ids.author, ids.engineer, ids.reviewer, ids.outsider, ids.suspended, ids.foreign];
const membershipIds = [ids.adminM, ids.authorM, ids.engineerM, ids.reviewerM, ids.outsiderM, ids.suspendedM, ids.foreignM];
const hashOf = (char: string) => char.repeat(64);
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

async function seedPublishedDocument(
  client: PoolClient,
  input: {
    documentId: string;
    organizationId: string;
    authorMembershipId: string;
    ownerDepartmentId: string;
    knowledgeBaseId: string;
    targetScopeType: "ORGANIZATION" | "DEPARTMENT";
    targetDepartmentId: string | null;
    readerSelectionId: string;
    title: string;
    management: KnowledgeMetadata | null;
    publishedAt: Date;
    indexStatus?: "PENDING" | "INDEXED";
    collectionId?: string | null;
  },
) {
  const draftVersionId = id();
  const submissionId = id();
  const publishedVersionId = id();
  const contentHash = hashOf("a");
  const contentUri = `arden-private-object://${input.documentId}`;

  await client.query(`
    INSERT INTO company_document (
      id, organization_id, author_id, title, classification,
      status, owner_department_id, target_scope, current_version_no,
      metadata, reader_policy_id
    ) VALUES ($1, $2, $3, $4, 'INTERNAL', 'ACTIVE', $5, $6, 1, $7::jsonb, $8)`, [
    input.documentId,
    input.organizationId,
    input.authorMembershipId,
    input.title,
    input.ownerDepartmentId,
    input.targetScopeType,
    input.management ? JSON.stringify(input.management) : null,
    input.readerSelectionId,
  ]);

  await client.query(`
    INSERT INTO working_version (
      id, document_id, version_no, file_uri, mime_type, content_hash
    ) VALUES ($1, $2, 1, $3, 'text/plain', $4)`, [
    draftVersionId,
    input.documentId,
    contentUri,
    contentHash,
  ]);

  await client.query(`
    INSERT INTO review_submission (
      id, organization_id, document_id, working_version_id, snapshot_version_no,
      submitted_by_id, target_scope, target_department_id, owner_department_id,
      title, classification, policy_version, review_rule, file_uri, mime_type,
      content_hash, status, publication_state, submit_request_id, proposed_reader_policy_id,
      approved_reader_policy_id, metadata
    ) VALUES (
      $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 'INTERNAL', 1, 'GRANT_SCOPE',
      $10, 'text/plain', $11, 'APPROVED', 'ACTIVE', gen_random_uuid(), $12, $12, $13::jsonb
    )`, [
    submissionId,
    input.organizationId,
    input.documentId,
    draftVersionId,
    input.authorMembershipId,
    input.targetScopeType,
    input.targetDepartmentId,
    input.ownerDepartmentId,
    input.title,
    contentUri,
    contentHash,
    input.readerSelectionId,
    input.management ? JSON.stringify(input.management) : null,
  ]);

  await client.query(`
    INSERT INTO published_version (
      id, review_submission_id, knowledge_base_id, published_by_id,
      title, version_no, file_uri, content_hash, index_status, published_at,
      document_id, classification, owner_department_id,
      valid_from, reader_policy_id, metadata, author_id
    ) VALUES (
      $1, $2, $3, NULL, $5, 1, $6, $7, $8, $9, $10, 'INTERNAL', $11, $9, $12, $13::jsonb, $4
    )`, [
    publishedVersionId,
    submissionId,
    input.knowledgeBaseId,
    input.authorMembershipId,
    input.title,
    contentUri,
    contentHash,
    input.indexStatus ?? "INDEXED",
    input.publishedAt,
    input.documentId,
    input.ownerDepartmentId,
    input.readerSelectionId,
    input.management ? JSON.stringify(input.management) : null,
  ]);

  await client.query(`
    INSERT INTO current_publication (
      document_id, organization_id, published_version_id,
      target_scope, target_department_id, valid_from, reader_policy_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    input.documentId,
    input.organizationId,
    publishedVersionId,
    input.targetScopeType,
    input.targetDepartmentId,
    input.publishedAt,
    input.readerSelectionId,
  ]);

  if (input.collectionId) {
    await client.query(`
      INSERT INTO handbook_placement (document_id, organization_id, handbook_id)
      VALUES ($1, $2, $3)`, [input.documentId, input.organizationId, input.collectionId]);
  }

  return publishedVersionId;
}

describe.skipIf(!databaseUrl)("Knowledge Graph projection with real PostgreSQL (FORCE RLS)", () => {
  beforeAll(async () => {
    if (!pool || !repository) throw new Error("ARDEN_TEST_DATABASE_URL was not provided");
    const identity = await pool.query<{ database_name: string; is_superuser: boolean }>(`
      SELECT current_database() AS database_name, r.rolsuper AS is_superuser
        FROM pg_roles r WHERE r.rolname = current_user`);
    if (!identity.rows[0]?.database_name.startsWith("arden_test_")) {
      throw new Error("Refusing integration fixtures outside a database named arden_test_*");
    }
    if (!identity.rows[0]?.is_superuser) {
      throw new Error("The isolated integration database connection must be a superuser for fixture cleanup");
    }
    const migrated = await pool.query(`
      SELECT migration_id FROM public.arden_schema_migrations
       WHERE migration_id IN ('0068_expired_document_renewal', '0070_private_direct_shares', '0076_graph_document_relationships', '0077_graph_monitor_projection')`);
    if (migrated.rowCount !== 4) {
      throw new Error("Apply migrations through 0077 to the isolated test database first");
    }

    await asSuperuser(async (client) => {
      await client.query(`
        INSERT INTO organization (id, name, slug)
        VALUES ($1, 'Graph Org A', $2), ($3, 'Graph Org B', $4)`,
      [ids.orgA, `graph-a-${ids.orgA}`, ids.orgB, `graph-b-${ids.orgB}`]);

      const users: Array<[string, string]> = [
        [ids.admin, "Graph Admin"],
        [ids.author, "Alice Author"],
        [ids.engineer, "Evan Engineer"],
        [ids.reviewer, "Ria Reviewer"],
        [ids.outsider, "Owen Outsider"],
        [ids.suspended, "Sam Suspended"],
        [ids.foreign, "Faye Foreign"],
      ];
      for (const [userId, fullName] of users) {
        await client.query(`
          INSERT INTO account (id, email, full_name)
          VALUES ($1, $2, $3)`, [userId, `${userId}@example.test`, fullName]);
      }

      const memberships: Array<[string, string, string, "ACTIVE" | "SUSPENDED"]> = [
        [ids.adminM, ids.orgA, ids.admin, "ACTIVE"],
        [ids.authorM, ids.orgA, ids.author, "ACTIVE"],
        [ids.engineerM, ids.orgA, ids.engineer, "ACTIVE"],
        [ids.reviewerM, ids.orgA, ids.reviewer, "ACTIVE"],
        [ids.outsiderM, ids.orgA, ids.outsider, "ACTIVE"],
        [ids.suspendedM, ids.orgA, ids.suspended, "SUSPENDED"],
        [ids.foreignM, ids.orgB, ids.foreign, "ACTIVE"],
      ];
      for (const [membershipId, orgId, userId, status] of memberships) {
        await client.query(`
          INSERT INTO membership (id, organization_id, account_id, status)
          VALUES ($1, $2, $3, $4)`, [membershipId, orgId, userId, status]);
      }

      const departments: Array<[string, string, string, string, string]> = [
        [ids.sales, ids.salesRole, ids.orgA, "SALES", "Sales"],
        [ids.engineering, ids.engineeringRole, ids.orgA, "ENG", "Engineering"],
        [ids.legal, ids.legalRole, ids.orgA, "LEGAL", "Legal"],
        [ids.deptB, ids.deptBRole, ids.orgB, "OPS", "Ops B"],
      ];
      for (const [deptId, roleId, orgId, code, name] of departments) {
        await client.query(`INSERT INTO role (id, organization_id, code, name) VALUES ($1, $2, $3, $4)`,
          [roleId, orgId, `GRAPH_${code}_${roleId.replaceAll("-", "").toUpperCase()}`, name]);
        await client.query(`
          INSERT INTO department (id, organization_id, code, name, default_role_id, status)
          VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`, [deptId, orgId, code, name, roleId]);
      }

      const departmentMemberships: Array<[string, string]> = [
        [ids.adminM, ids.sales],
        [ids.authorM, ids.sales],
        [ids.engineerM, ids.engineering],
        [ids.reviewerM, ids.engineering],
        [ids.outsiderM, ids.sales],
        [ids.foreignM, ids.deptB],
      ];
      for (const [membershipId, departmentId] of departmentMemberships) {
        await client.query(`
          INSERT INTO department_membership (membership_id, department_id, is_primary)
          VALUES ($1, $2, true)`, [membershipId, departmentId]);
      }

      await client.query(`
        INSERT INTO access_scope (id, organization_id, scope)
        VALUES ($1, $2, 'ORGANIZATION')`, [ids.scopeA, ids.orgA]);
      await client.query(`
        INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.adminM, ids.scopeA]);
      await client.query(`
        INSERT INTO reviewer_grant (
          organization_id, reviewer_id, granted_by_id,
          scope, department_id, classifications, level
        ) VALUES ($1, $2, $3, 'DEPARTMENT', $4, ARRAY['INTERNAL'], 'STANDARD')`,
      [ids.orgA, ids.reviewerM, ids.adminM, ids.engineering]);


      await client.query(`
        INSERT INTO knowledge_base (id, organization_id, department_id, name, scope)
        VALUES ($1, $4, NULL, 'Org A KB', 'ORGANIZATION'),
               ($2, $4, $5, 'Eng A KB', 'DEPARTMENT'),
               ($3, $6, NULL, 'Org B KB', 'ORGANIZATION')`,
      [ids.kbOrgA, ids.kbDeptEngA, ids.kbOrgB, ids.orgA, ids.engineering, ids.orgB]);

      await client.query(`
        INSERT INTO reader_policy (id, organization_id, mode, department_id)
        VALUES ($1, $5, 'ORGANIZATION', NULL),
               ($2, $5, 'DEPARTMENT', $6),
               ($3, $5, 'SELECTED_MEMBERS', NULL),
               ($4, $7, 'ORGANIZATION', NULL)`,
      [ids.selOrgA, ids.selEngA, ids.selMembersA, ids.selOrgB, ids.orgA, ids.engineering, ids.orgB]);

      await client.query(`
        INSERT INTO policy_reader (reader_policy_id, organization_id, membership_id, position)
        VALUES ($1, $2, $3, 1), ($1, $2, $4, 2)`,
      [ids.selMembersA, ids.orgA, ids.authorM, ids.engineerM]);

      await client.query(`
        INSERT INTO handbook (id, organization_id, name, description, status, allowed_types)
        VALUES ($1, $4, 'Handbook', 'Company standards', 'ACTIVE', ARRAY['Policy & Standard', 'Guide']),
               ($2, $4, 'Expired Only Folder', 'Should never leak', 'ACTIVE', ARRAY['Policy & Standard']),
               ($3, $4, 'Legacy Unconfigured', 'Legacy null types', 'ACTIVE', NULL)`,
      [ids.colHandbook, ids.colExpiredOnly, ids.colLegacy, ids.orgA]);

      // Bypass publication workflow triggers cleanly only for fixture seeding; runtime queries still run as arden_runtime under FORCE RLS.
      await client.query("SET LOCAL session_replication_role = replica");

      await seedPublishedDocument(client, {
        documentId: ids.docOrgPolicy,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.sales,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgA,
        title: "Security & Access Policy",
        management: { type: "Policy & Standard", version: "2.0", expirationDate: "2099-12-31", changeNote: "" },
        publishedAt: new Date("2026-11-20T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: ids.colHandbook,
      });

      await seedPublishedDocument(client, {
        documentId: ids.docLegacyUncat,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.sales,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgA,
        title: "Legacy Unindexed Runbook",
        management: null,
        publishedAt: new Date("2026-11-19T12:00:00.000Z"),
        indexStatus: "PENDING",
        collectionId: null,
      });

      const selectedRestrictedVersionId = await seedPublishedDocument(client, {
        documentId: ids.docSelectedRestricted,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.engineering,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selMembersA,
        title: "Restricted Selected Members Procedure",
        management: { type: "Procedure", version: "1.0", expirationDate: null, changeNote: "" },
        publishedAt: new Date("2026-11-21T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: null,
      });

      await seedPublishedDocument(client, {
        documentId: ids.docExpired,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.legal,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgA,
        title: "Expired Legal Standard",
        management: { type: "Policy & Standard", version: "1.0", expirationDate: "2020-01-01", changeNote: "" },
        publishedAt: new Date("2026-11-18T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: ids.colExpiredOnly,
      });

      const renewedVersionId = await seedPublishedDocument(client, {
        documentId: ids.docRenewed,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.sales,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgA,
        title: "Renewed Operations Guide",
        management: { type: "Guide", version: "1.0", expirationDate: "2020-01-01", changeNote: "" },
        publishedAt: new Date("2026-11-17T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: null,
      });
      const renewedSubmission = await client.query<{ submission_id: string }>(
        "SELECT review_submission_id AS submission_id FROM published_version WHERE id = $1",
        [renewedVersionId],
      );
      await client.query(`
        INSERT INTO publication_renewal (
          published_version_id, organization_id, document_id, valid_until, review_submission_id
        ) VALUES ($1, $2, $3, '2099-01-01', $4)`,
      [renewedVersionId, ids.orgA, ids.docRenewed, renewedSubmission.rows[0]!.submission_id]);

      // Two open current-version Flow 4 maintenance cases plus one resolved case: the monitor
      // count must be exactly 2 for accountable reviewer/admin roles and null for authors/readers.
      const caseRows: Array<{
        status: "Submitted" | "In Progress" | "Resolved";
        assignee: string | null;
        claimedAt: string | null;
        outcome: string | null;
        explanation: string | null;
        resolvedAt: string | null;
      }> = [
        { status: "Submitted", assignee: null, claimedAt: null, outcome: null, explanation: null, resolvedAt: null },
        {
          status: "In Progress",
          assignee: ids.reviewerM,
          claimedAt: "2026-11-24T12:00:00.000Z",
          outcome: null,
          explanation: null,
          resolvedAt: null,
        },
        {
          status: "Resolved",
          assignee: ids.reviewerM,
          claimedAt: "2026-11-24T12:00:00.000Z",
          outcome: "NO_CHANGE_NEEDED",
          explanation: "Current procedure is accurate.",
          resolvedAt: "2026-11-25T12:00:00.000Z",
        },
      ];
      for (const [index, row] of caseRows.entries()) {
        await client.query(`
          INSERT INTO maintenance_case (
            organization_id, origin, reporter_id, document_id, published_version_id,
            content_hash, title, description, review_department_id, classification, author_id,
            assignee_id, reporter_status, outcome, reporter_explanation, first_claimed_at, resolved_at
          ) VALUES (
            $1, 'REVIEWER_INTAKE', NULL, $2, $3, $4, $5, 'Fixture maintenance detail', $6, 'INTERNAL', $7,
            $8, $9, $10, $11, $12, $13
          )`, [
          ids.orgA,
          ids.docSelectedRestricted,
          selectedRestrictedVersionId,
          hashOf("a"),
          `Fixture case ${index + 1}`,
          ids.engineering,
          ids.authorM,
          row.assignee,
          row.status,
          row.outcome,
          row.explanation,
          row.claimedAt,
          row.resolvedAt,
        ]);
      }

      await seedPublishedDocument(client, {
        documentId: ids.docOrgB,
        organizationId: ids.orgB,
        authorMembershipId: ids.foreignM,
        ownerDepartmentId: ids.deptB,
        knowledgeBaseId: ids.kbOrgB,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgB,
        title: "Foreign Org Document",
        management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
        publishedAt: new Date("2026-11-22T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: null,
      });
    });

    // Seed a Private Note owned by author and directly shared with outsider (must NEVER appear in Knowledge Graph).
    const privateNote = await repository.createDraft(
      ids.author,
      ids.orgA,
      { title: "Private Scratchpad Note", body: "Never public" },
      { sourceUri: `arden-private-object://${id()}`, mimeType: "text/plain", contentHash: hashOf("f") },
      "graph-private-note",
    );
    expect(privateNote).not.toBeNull();
    if (privateNote) {
      await repository.directShares.share(ids.author, ids.orgA, privateNote.id, [ids.outsiderM], "graph-direct-share");
    }

    fixtureReady = true;
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      for (let attempt = 1; fixtureReady; attempt += 1) {
        try {
          await asSuperuser(async (client) => {
            await client.query("SET LOCAL session_replication_role = replica");
            const orgs = [ids.orgA, ids.orgB];
            await client.query("DELETE FROM audit_event WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM notification WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM direct_share WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query(`DELETE FROM private_version WHERE document_id IN (
              SELECT d.id AS draft_id FROM private_document d JOIN private_workspace w ON w.id = d.workspace_id
               WHERE w.membership_id = ANY($1::uuid[]))`, [membershipIds]);
            await client.query(`DELETE FROM private_document WHERE workspace_id IN (
              SELECT id AS workspace_id FROM private_workspace WHERE membership_id = ANY($1::uuid[]))`, [membershipIds]);
            await client.query("DELETE FROM private_workspace WHERE membership_id = ANY($1::uuid[])", [membershipIds]);
            await client.query("DELETE FROM relationship_request_key WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM document_relationship WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM maintenance_case WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM handbook_placement WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM handbook WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM publication_renewal WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM current_publication WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM index_generation WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query(`DELETE FROM published_version WHERE review_submission_id IN (
              SELECT id AS submission_id FROM review_submission WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
            await client.query("DELETE FROM review_submission WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM knowledge_base WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query(`DELETE FROM working_version WHERE document_id IN (
              SELECT id AS shared_draft_id FROM company_document WHERE organization_id = ANY($1::uuid[]))`, [orgs]);
            await client.query("DELETE FROM company_document WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM policy_reader WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM reader_policy WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])", [membershipIds]);
            await client.query("DELETE FROM reviewer_grant WHERE organization_id = ANY($1::uuid[])", [orgs]);
            await client.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [membershipIds]);
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
      }
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("enforces FORCE RLS: hides unselected docs, expired docs, expired-only Org Collections, Private Notes, direct shares, and cross-org actors", async () => {
    if (!service) throw new Error("Graph service is unavailable");

    // Cross-org and suspended actors are denied (null -> 404 RESOURCE_NOT_AVAILABLE).
    await expect(service.getGraph(ids.foreign, ids.orgA, {})).resolves.toBeNull();
    await expect(service.getGraph(ids.suspended, ids.orgA, {})).resolves.toBeNull();
    await expect(service.getGraph(ids.outsider, ids.orgB, {})).resolves.toBeNull();

    // Unselected reader (outsider) sees only unexpired org-readable published docs (including newly published non-indexed legacy doc),
    // zero expired docs, zero empty expired-only Org Collections, zero Legal/Engineering departments, and zero Private Notes / direct shares.
    const outsiderGraph = await service.getGraph(ids.outsider, ids.orgA, {
      monitor: true,
      includeExpired: true,
    });
    expect(outsiderGraph).not.toBeNull();
    expect(outsiderGraph!.capabilities.canUseMonitorMode).toBe(false);
    expect(outsiderGraph!.capabilities.canIncludeExpired).toBe(false);
    expect(outsiderGraph!.appliedMode.monitorActive).toBe(false);
    expect(outsiderGraph!.appliedMode.includeExpiredActive).toBe(false);
    expect(outsiderGraph!.documents.map((doc) => doc.documentId)).toEqual([
      ids.docOrgPolicy,
      ids.docLegacyUncat,
      ids.docRenewed,
    ]);
    expect(outsiderGraph!.departments).toEqual([{ id: ids.sales, name: "Sales" }]);
    expect(outsiderGraph!.collections).toEqual([
      { id: ids.colHandbook, name: "Handbook", allowedTypes: ["Policy & Standard", "Guide"] },
    ]);
    expect(outsiderGraph!.documents.some((doc) => doc.title.includes("Private"))).toBe(false);
    expect(outsiderGraph!.documents.find((doc) => doc.documentId === ids.docOrgPolicy)?.authorDisplayName).toBe("Alice Author");
    expect(outsiderGraph!.documents.find((doc) => doc.documentId === ids.docLegacyUncat)).toMatchObject({
      type: null,
      version: "Version unavailable",
    });

    // Selected reader (engineer) sees docSelectedRestricted + org docs, still zero expired docs / zero expired-only collections.
    const engineerGraph = await service.getGraph(ids.engineer, ids.orgA, {});
    expect(engineerGraph!.documents.map((doc) => doc.documentId)).toEqual([
      ids.docSelectedRestricted,
      ids.docOrgPolicy,
      ids.docLegacyUncat,
      ids.docRenewed,
    ]);
    expect(engineerGraph!.collections.map((c) => c.id)).toEqual([ids.colHandbook]);
    expect(JSON.stringify(engineerGraph)).not.toContain(ids.authorM);
  });

  it("projects role-scoped Monitor rows, renewal dates, and nullable current-version case counts", async () => {
    if (!service) throw new Error("Graph service is unavailable");

    // Capability derivation is active even when Monitor Mode is off: the author still has
    // one expired publication, so the Monitor control must be available in default mode.
    const authorDefault = await service.getGraph(ids.author, ids.orgA, {});
    expect(authorDefault!.capabilities).toMatchObject({ canUseMonitorMode: true, canIncludeExpired: true });
    expect(authorDefault!.appliedMode.monitorActive).toBe(false);
    expect(authorDefault!.documents.some((doc) => doc.documentId === ids.docExpired)).toBe(false);

    const authorMonitor = await service.getGraph(ids.author, ids.orgA, {
      monitor: true,
      includeExpired: true,
    });
    expect(authorMonitor!.appliedMode).toMatchObject({ monitorActive: true, includeExpiredActive: true });
    const expiredByAuthor = authorMonitor!.documents.find((doc) => doc.documentId === ids.docExpired);
    expect(expiredByAuthor).toMatchObject({
      openTarget: "MY_CONTRIBUTIONS",
      validityStatus: "Expired",
      validUntil: "2020-01-01",
      canEditRelationships: false,
      canRenew: true,
      monitorSignals: {
        openMaintenanceCaseCount: null,
        isUnassignedOrgDoc: false,
        requiresAuditedInspection: false,
      },
    });

    // publication_expiration_date() resolves the approved renewal row instead of the frozen
    // original 2020 expiry, so the renewed publication is current and normally readable.
    const renewed = authorMonitor!.documents.find((doc) => doc.documentId === ids.docRenewed);
    expect(renewed).toMatchObject({
      openTarget: "READER",
      validityStatus: "Current",
      validUntil: "2099-01-01",
    });

    // A disjoint non-author reviewer with the exact 0060 department grant receives
    // RESPONSIBLE_VIEW and the exact count of open Flow 4 cases pinned to this current version.
    const reviewerMonitor = await service.getGraph(ids.reviewer, ids.orgA, {
      monitor: true,
      includeExpired: true,
    });
    expect(reviewerMonitor!.capabilities.canUseMonitorMode).toBe(true);
    const restrictedForReviewer = reviewerMonitor!.documents.find((doc) => doc.documentId === ids.docSelectedRestricted);
    expect(restrictedForReviewer).toMatchObject({
      openTarget: "RESPONSIBLE_VIEW",
      authorDisplayName: null,
      canEditRelationships: false,
      monitorSignals: {
        openMaintenanceCaseCount: 2,
        isUnassignedOrgDoc: false,
        requiresAuditedInspection: false,
      },
    });
    expect(restrictedForReviewer!.validityStatus).not.toBe("Expired");

    // Org Admin receives metadata-only audited-inspection routing, including integer zero
    // counts where accountable, but never author names or body/report details for hidden rows.
    const adminMonitor = await service.getGraph(ids.admin, ids.orgA, {
      monitor: true,
      includeExpired: true,
    });
    expect(adminMonitor!.capabilities.canUseMonitorMode).toBe(true);
    const restrictedForAdmin = adminMonitor!.documents.find((doc) => doc.documentId === ids.docSelectedRestricted);
    expect(restrictedForAdmin).toMatchObject({
      openTarget: "ADMIN_INSPECTION",
      authorDisplayName: null,
      canEditRelationships: false,
      monitorSignals: {
        openMaintenanceCaseCount: 2,
        isUnassignedOrgDoc: false,
        requiresAuditedInspection: true,
      },
    });
    const expiredForAdmin = adminMonitor!.documents.find((doc) => doc.documentId === ids.docExpired);
    expect(expiredForAdmin).toMatchObject({
      openTarget: "ADMIN_INSPECTION",
      authorDisplayName: null,
      canEditRelationships: false,
      monitorSignals: {
        openMaintenanceCaseCount: 0,
        requiresAuditedInspection: true,
      },
    });

    const serialized = JSON.stringify(adminMonitor);
    expect(serialized).not.toContain(ids.authorM);
    expect(serialized).not.toContain(ids.reviewerM);
    expect(serialized).not.toContain("Fixture maintenance detail");
    expect(serialized).not.toContain("Current procedure is accurate");
  });

  it("filters ASCII typeCode=POLICY_AND_STANDARD and UNCATEGORIZED cleanly against real PostgreSQL rows", async () => {
    if (!service) throw new Error("Graph service is unavailable");

    const policyOnly = await service.getGraph(ids.outsider, ids.orgA, { typeCode: "POLICY_AND_STANDARD" });
    expect(policyOnly!.documents.map((d) => d.documentId)).toEqual([ids.docOrgPolicy]);
    expect(policyOnly!.documents[0]!.type).toBe("Policy & Standard");

    const uncatOnly = await service.getGraph(ids.outsider, ids.orgA, { typeCode: "UNCATEGORIZED" });
    expect(uncatOnly!.documents.map((d) => d.documentId)).toEqual([ids.docLegacyUncat]);
    expect(uncatOnly!.documents[0]!.type).toBeNull();
    expect(uncatOnly!.documents[0]!.version).toBe("Version unavailable");
  });

  it("enforces 0076 dual-endpoint RLS, drops 0027 policies, binds creator membership, and allows ghost-edge cleanup", async () => {
    if (!service || !relationshipService || !pool) throw new Error("Graph services are unavailable");

    // 1. All three permissive 0027 policies must be gone and replaced by 0076 policies.
    const policies = await asSuperuser((client) => client.query<{ policyname: string }>(`
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'arden'
         AND tablename = 'document_relationship'
       ORDER BY policyname`));
    expect(policies.rows.map((r) => r.policyname)).toEqual([
      "document_relationship_dual_reader_select",
      "document_relationship_governed_delete",
      "document_relationship_governed_insert",
    ]);

    // 2. Org Admin (not author of docOrgPolicy) can create a link between two readable published docs,
    // proving company_document author-only RLS does not block Org Admin authority (re-derived in DB).
    const adminCreateKey = id();
    const adminCreated = await relationshipService.createRelationship(
      ids.admin,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docLegacyUncat, relationshipType: "REFERENCES" },
      adminCreateKey,
    );
    expect(adminCreated.kind).toBe("created");
    if (adminCreated.kind !== "created") return;

    // Replay same key + same payload returns stored 201 edge; mismatched payload returns 409 IDEMPOTENCY_CONFLICT.
    await expect(relationshipService.createRelationship(
      ids.admin,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docLegacyUncat, relationshipType: "REFERENCES" },
      adminCreateKey,
    )).resolves.toEqual({
      kind: "replayed",
      statusCode: 201,
      response: adminCreated.edge,
    });
    await expect(relationshipService.createRelationship(
      ids.admin,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docLegacyUncat, relationshipType: "RELATED" },
      adminCreateKey,
    )).resolves.toEqual({ kind: "idempotency-conflict" });

    // Append-only idempotency ledger blocks UPDATE and DELETE.
    await expect(asSuperuser((client) => client.query(
      "UPDATE relationship_request_key SET http_status = 200 WHERE idempotency_key = $1",
      [adminCreateKey],
    ), false)).rejects.toMatchObject({ code: "55000" });

    // 3. Creator membership spoofing fails with 42501 under arden_runtime.
    await expect(asSuperuser(async (client) => {
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query(
        "SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
        [ids.admin, ids.orgA],
      );
      await client.query(`
        INSERT INTO document_relationship (
          organization_id, source_document_id, target_document_id, type, created_by_id
        ) VALUES ($1, $2, $3, 'RELATED', $4)`,
      [ids.orgA, ids.docOrgPolicy, ids.docLegacyUncat, ids.authorM]);
    }, false)).rejects.toMatchObject({ code: "42501" });

    // 4. Dual-endpoint SELECT RLS: author creates docOrgPolicy -> docSelectedRestricted (author & engineer can read both;
    // outsider and admin cannot read docSelectedRestricted).
    const restrictedLink = await relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docSelectedRestricted, relationshipType: "RELATED" },
      id(),
    );
    expect(restrictedLink.kind).toBe("created");
    if (restrictedLink.kind !== "created") return;

    const engineerGraph = await service.getGraph(ids.engineer, ids.orgA, { includeLinks: true });
    expect(engineerGraph!.relationships.some((e) => e.relationshipId === restrictedLink.edge.relationshipId)).toBe(true);

    const outsiderGraph = await service.getGraph(ids.outsider, ids.orgA, { includeLinks: true });
    expect(outsiderGraph!.relationships.some((e) => e.relationshipId === adminCreated.edge.relationshipId)).toBe(true);
    expect(outsiderGraph!.relationships.some((e) => e.relationshipId === restrictedLink.edge.relationshipId)).toBe(false);

    // 5. Anti-oracle: Admin probing unreadable docSelectedRestricted (even though a RELATED edge exists!) receives uniform 404.
    await expect(relationshipService.createRelationship(
      ids.admin,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docSelectedRestricted, relationshipType: "RELATED" },
      id(),
    )).resolves.toEqual({ kind: "not-available" });
    await expect(relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docExpired, relationshipType: "REFERENCES" },
      id(),
    )).resolves.toEqual({ kind: "not-available" });
    await expect(relationshipService.createRelationship(
      ids.outsider,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docLegacyUncat, relationshipType: "RELATED" },
      id(),
    )).resolves.toEqual({ kind: "not-available" });

    // 6. Symmetric RELATED duplicate returns 409 RELATIONSHIP_EXISTS; SUPERSEDES cycle returns 409 RELATIONSHIP_CYCLE.
    await expect(relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docSelectedRestricted,
      { targetDocumentId: ids.docOrgPolicy, relationshipType: "RELATED" },
      id(),
    )).resolves.toEqual({ kind: "relationship-exists" });

    await expect(relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: ids.docSelectedRestricted, relationshipType: "SUPERSEDES" },
      id(),
    )).resolves.toMatchObject({ kind: "created" });
    await expect(relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docSelectedRestricted,
      { targetDocumentId: ids.docLegacyUncat, relationshipType: "SUPERSEDES" },
      id(),
    )).resolves.toMatchObject({ kind: "created" });
    // Even Admin (who cannot see docSelectedRestricted!) triggers cycle protection when closing docLegacyUncat -> docOrgPolicy!
    await expect(relationshipService.createRelationship(
      ids.admin,
      ids.orgA,
      ids.docLegacyUncat,
      { targetDocumentId: ids.docOrgPolicy, relationshipType: "SUPERSEDES" },
      id(),
    )).resolves.toEqual({ kind: "relationship-cycle" });

    // 7. Ghost-edge cleanup: link docOrgPolicy -> tempTarget, then expire tempTarget so SELECT hides it,
    // and verify author can still remove it + replay REMOVE after deletion.
    const tempTargetId = id();
    const tempVersionId = await asSuperuser(async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      return seedPublishedDocument(client, {
        documentId: tempTargetId,
        organizationId: ids.orgA,
        authorMembershipId: ids.authorM,
        ownerDepartmentId: ids.sales,
        knowledgeBaseId: ids.kbOrgA,
        targetScopeType: "ORGANIZATION",
        targetDepartmentId: null,
        readerSelectionId: ids.selOrgA,
        title: "Temporary Ghost Target",
        management: { type: "Guide", version: "1.0", expirationDate: "2099-12-31", changeNote: "" },
        publishedAt: new Date("2026-11-23T12:00:00.000Z"),
        indexStatus: "INDEXED",
        collectionId: null,
      });
    });

    const ghostEdge = await relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      { targetDocumentId: tempTargetId, relationshipType: "REFERENCES" },
      id(),
    );
    expect(ghostEdge.kind).toBe("created");
    if (ghostEdge.kind !== "created") return;

    await asSuperuser(async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `UPDATE published_version
            SET metadata = jsonb_build_object('type', 'Guide', 'version', '1.0', 'expirationDate', '2020-01-01', 'changeNote', '')
          WHERE id = $1`,
        [tempVersionId],
      );
    });

    // Ghost edge is hidden from SELECT under FORCE RLS.
    const afterExpire = await asSuperuser(async (client) => {
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query(
        "SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
        [ids.author, ids.orgA],
      );
      return (await client.query(
        "SELECT 1 FROM document_relationship WHERE id = $1",
        [ghostEdge.edge.relationshipId],
      )).rowCount;
    }, false);
    expect(afterExpire).toBe(0);

    // Outsider cannot remove ghost edge; author CAN remove it and replay after deletion.
    await expect(relationshipService.removeRelationship(
      ids.outsider,
      ids.orgA,
      ids.docOrgPolicy,
      ghostEdge.edge.relationshipId,
      id(),
    )).resolves.toEqual({ kind: "not-available" });

    const removeKey = id();
    await expect(relationshipService.removeRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      ghostEdge.edge.relationshipId,
      removeKey,
    )).resolves.toEqual({ kind: "removed", statusCode: 200, response: { removed: true } });

    await expect(relationshipService.removeRelationship(
      ids.author,
      ids.orgA,
      ids.docOrgPolicy,
      ghostEdge.edge.relationshipId,
      removeKey,
    )).resolves.toEqual({ kind: "replayed", statusCode: 200, response: { removed: true } });

    // 7b. Tier 1 security regression: a non-reader Org Admin must NOT delete outgoing edges from
    // a restricted SELECTED_MEMBERS source document (no existence oracle; edge remains intact),
    // while the source author CAN remove it.
    const restrictedSourceEdge = await relationshipService.createRelationship(
      ids.author,
      ids.orgA,
      ids.docSelectedRestricted,
      { targetDocumentId: ids.docOrgPolicy, relationshipType: "REFERENCES" },
      id(),
    );
    expect(restrictedSourceEdge.kind).toBe("created");
    if (restrictedSourceEdge.kind !== "created") return;

    await expect(relationshipService.removeRelationship(
      ids.admin,
      ids.orgA,
      ids.docSelectedRestricted,
      restrictedSourceEdge.edge.relationshipId,
      id(),
    )).resolves.toEqual({ kind: "not-available" });

    // Edge must still exist and remain visible to an authorized dual-endpoint reader (engineer).
    const engineerAfterAdminAttempt = await service.getGraph(ids.engineer, ids.orgA, { includeLinks: true });
    expect(
      engineerAfterAdminAttempt!.relationships.some((e) => e.relationshipId === restrictedSourceEdge.edge.relationshipId),
    ).toBe(true);

    // Author of docSelectedRestricted can remove the outgoing edge cleanly.
    await expect(relationshipService.removeRelationship(
      ids.author,
      ids.orgA,
      ids.docSelectedRestricted,
      restrictedSourceEdge.edge.relationshipId,
      id(),
    )).resolves.toEqual({ kind: "removed", statusCode: 200, response: { removed: true } });

    // 8. ADR 0035 audit details contain ONLY IDs and relationshipType (never titles, excerpts, or emails).
    const audits = await asSuperuser((client) => client.query<{
      event_type: string;
      outcome: string;
      details_json: Record<string, unknown>;
    }>(`
      SELECT event_type, outcome, details AS details_json
        FROM audit_event
       WHERE organization_id = $1
         AND event_type IN ('DOCUMENT_RELATIONSHIP_CREATED', 'DOCUMENT_RELATIONSHIP_DELETED')
       ORDER BY occurred_at ASC`, [ids.orgA]));
    expect(audits.rows.some((r) => r.event_type === "DOCUMENT_RELATIONSHIP_CREATED")).toBe(true);
    expect(audits.rows.some((r) => r.event_type === "DOCUMENT_RELATIONSHIP_DELETED")).toBe(true);
    for (const row of audits.rows) {
      expect(row.outcome).toBe("SUCCESS");
      expect(Object.keys(row.details_json).sort()).toEqual([
        "relationshipId",
        "relationshipType",
        "sourceDocumentId",
        "targetDocumentId",
      ]);
      expect(JSON.stringify(row.details_json)).not.toContain("Policy");
      expect(JSON.stringify(row.details_json)).not.toContain("@example.test");
    }
  }, 90_000);

  it("enforces the 500-document cap and guarantees authorized focusDocumentId inclusion beyond 500 without leaking unauthorized targets", async () => {
    if (!service || !pool || !repository) throw new Error("Graph service is unavailable");

    const bulkDocIds: string[] = Array.from({ length: 505 }, () => id());
    const oldestBulkDocId = bulkDocIds[504]!;
    await asSuperuser(async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const baseTime = Date.UTC(2026, 10, 15, 0, 0, 0);
      for (let i = 0; i < bulkDocIds.length; i += 1) {
        await seedPublishedDocument(client, {
          documentId: bulkDocIds[i]!,
          organizationId: ids.orgA,
          authorMembershipId: ids.authorM,
          ownerDepartmentId: ids.sales,
          knowledgeBaseId: ids.kbOrgA,
          targetScopeType: "ORGANIZATION",
          targetDepartmentId: null,
          readerSelectionId: ids.selOrgA,
          title: `Bulk Policy ${i + 1}`,
          management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
          publishedAt: new Date(baseTime - i * 60_000),
          indexStatus: "INDEXED",
          collectionId: null,
        });
      }
    });

    const capped = await service.getGraph(ids.outsider, ids.orgA, {});
    expect(capped!.truncation.limit).toBe(GRAPH_MAX_DOCUMENTS);
    expect(capped!.truncation.returnedCount).toBe(GRAPH_MAX_DOCUMENTS);
    expect(capped!.truncation.truncated).toBe(true);
    expect(capped!.documents.some((d) => d.documentId === oldestBulkDocId)).toBe(false);

    const focused = await service.getGraph(ids.outsider, ids.orgA, { focusDocumentId: oldestBulkDocId });
    expect(focused!.documents).toHaveLength(GRAPH_MAX_DOCUMENTS);
    expect(focused!.truncation.truncated).toBe(true);
    expect(focused!.documents.some((d) => d.documentId === oldestBulkDocId)).toBe(true);

    // Passing an unreadable restricted document as focusDocumentId must never include it.
    const probed = await service.getGraph(ids.outsider, ids.orgA, { focusDocumentId: ids.docSelectedRestricted });
    expect(probed!.documents.some((d) => d.documentId === ids.docSelectedRestricted)).toBe(false);

    const eligibleCount = await asSuperuser(async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`
        INSERT INTO index_generation (
          organization_id, review_submission_id, document_id, snapshot_version_id, snapshot_content_hash,
          status, manifest, completed_at
        ) SELECT organization_id, id, document_id, working_version_id, content_hash,
                 'READY', '{"chunks":[]}'::jsonb, now()
            FROM review_submission
           WHERE organization_id = $1 AND document_id = ANY($2::uuid[])`, [ids.orgA, bulkDocIds]);
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)",
        [ids.outsider, ids.orgA]);
      const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM eligible_ai_publications()");
      return rows[0]!.count;
    });
    expect(eligibleCount).toBeGreaterThan(500);
    const scoped = await repository.listAuthorizedAiSources(ids.outsider, ids.orgA, undefined, undefined, [oldestBulkDocId]);
    expect(scoped?.map(({ draftId }) => draftId)).toEqual([oldestBulkDocId]);
    expect(await repository.listAuthorizedAiSources(ids.foreign, ids.orgA, undefined, undefined, [oldestBulkDocId]))
      .toBeNull();
  }, 90_000);


});
