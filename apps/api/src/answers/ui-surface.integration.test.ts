import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { validateStoredBoundSurface, type KnowledgeMetadata } from "@arden/domain";
import { ArdenRepository } from "../db/repository.js";
import { GraphProjectionService } from "../graph/graph-service.js";
import type { AskArdenClient } from "./ai-client.js";
import { GovernedAnswering } from "./governed-answering.js";
import type { EvidenceReference, GenerationV3Request } from "./governed-contracts.js";

// Real PostgreSQL 17 FORCE RLS integration tests for 0075_ai_turn_ui_surface.sql,
// batched PgSurfaceHydrator, 4-path turn-level revocation, replay hydration, and cursor paging (T-05a).
// Requires a disposable, fully migrated database named arden_test_* via ARDEN_TEST_DATABASE_URL;
// skipped honestly otherwise (never faking a database pass).
const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;

const id = () => randomUUID();
const ids = {
  org: id(),
  scope: id(),
  allMembers: id(),
  dept: id(),
  deptRole: id(),
  kbOrg: id(),
  selOrg: id(),
  selRestricted: id(),
  admin: id(),
  author: id(),
  reader: id(),
  reviewer: id(),
  adminM: id(),
  authorM: id(),
  readerM: id(),
  reviewerM: id(),
  docPrimary: id(),
  docPeer: id(),
  docRestrictedPeer: id(),
};

const userIds = [ids.admin, ids.author, ids.reader, ids.reviewer];
const membershipIds = [ids.adminM, ids.authorM, ids.readerM, ids.reviewerM];
let fixtureReady = false;
let primaryRef: EvidenceReference;
let primaryText = "MFA is required for all production accounts.";
let primaryVersionId = "";
let peerVersionId = "";
let restrictedPeerVersionId = "";

async function asSuperuser<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("Test database is unavailable");
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
}

async function seedIndexedPublication(
  client: PoolClient,
  input: {
    documentId: string;
    title: string;
    readerSelectionId: string;
    management: KnowledgeMetadata;
    text: string;
  },
): Promise<EvidenceReference> {
  const draftVersionId = id();
  const submissionId = id();
  const publishedVersionId = id();
  const generationId = id();
  const contentHash = createHash("sha256").update(input.text).digest("hex");
  const chunkId = createHash("sha256").update(`${generationId}:0`).digest("hex");
  const contentUri = `arden-private-object://${input.documentId}`;
  const chunk = {
    chunkId,
    ordinal: 0,
    contentHash,
    startOffset: 0,
    endOffset: Array.from(input.text).length,
    sourceBlockIds: ["pdf-page-2"],
    parentSectionBlockId: null,
  };
  const manifest = {
    contractVersion: 1,
    jobId: id(),
    generationId,
    snapshotVersionId: draftVersionId,
    snapshotContentHash: contentHash,
    compilerVersion: "semantic-markdown-v1",
    chunkingVersion: "langchain-section-token-v1",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    markdownContentHash: contentHash,
    chunksDigest: createHash("sha256").update(JSON.stringify([chunk])).digest("hex"),
    chunks: [chunk],
  };

  await client.query(`
    INSERT INTO shared_draft (
      shared_draft_id, organization_id, author_membership_id, title, classification,
      status, responsible_department_id, target_scope_type, current_version_no,
      management, draft_selection_id
    ) VALUES ($1, $2, $3, $4, 'INTERNAL', 'ACTIVE', $5, 'ORGANIZATION', 1, $6::jsonb, $7)`, [
    input.documentId,
    ids.org,
    ids.authorM,
    input.title,
    ids.dept,
    JSON.stringify(input.management),
    input.readerSelectionId,
  ]);
  await client.query(`
    INSERT INTO shared_draft_version (
      shared_draft_version_id, shared_draft_id, version_no, content_uri, mime_type, content_hash
    ) VALUES ($1, $2, 1, $3, 'text/plain', $4)`, [draftVersionId, input.documentId, contentUri, contentHash]);
  await client.query(`
    INSERT INTO shared_submission (
      submission_id, organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
      submitted_by_membership_id, target_scope_type, target_department_id, responsible_department_id,
      title, classification, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
      content_hash, status, publication_state, submit_request_id, proposed_selection_id,
      approved_selection_id, management
    ) VALUES (
      $1, $2, $3, $4, 1, $5, 'ORGANIZATION', NULL, $6, $7, 'INTERNAL', $8::uuid[], 1, 'GRANT_SCOPE',
      $9, 'text/plain', $10, 'APPROVED', 'ACTIVE', gen_random_uuid(), $11, $11, $12::jsonb
    )`, [
    submissionId,
    ids.org,
    input.documentId,
    draftVersionId,
    ids.authorM,
    ids.dept,
    input.title,
    [ids.allMembers],
    contentUri,
    contentHash,
    input.readerSelectionId,
    JSON.stringify(input.management),
  ]);
  await client.query(`
    INSERT INTO published_knowledge_version (
      published_version_id, submission_id, knowledge_base_id, published_by_membership_id,
      author_membership_id, title, version_no, content_uri, content_hash, index_status, published_at,
      shared_draft_id, classification, responsible_department_id, audience_role_ids,
      valid_from, reader_selection_id, management
    ) VALUES (
      $1, $2, $3, NULL, $4, $5, 1, $6, $7, 'INDEXED', now() - interval '1 hour', $8, 'INTERNAL', $9,
      $10::uuid[], now() - interval '1 hour', $11, $12::jsonb
    )`, [
    publishedVersionId,
    submissionId,
    ids.kbOrg,
    ids.authorM,
    input.title,
    contentUri,
    contentHash,
    input.documentId,
    ids.dept,
    [ids.allMembers],
    input.readerSelectionId,
    JSON.stringify(input.management),
  ]);
  await client.query(`
    INSERT INTO knowledge_current_publication (
      shared_draft_id, organization_id, published_version_id, audience_role_ids,
      target_scope_type, target_department_id, valid_from, reader_selection_id
    ) VALUES ($1, $2, $3, $4::uuid[], 'ORGANIZATION', NULL, now() - interval '1 hour', $5)`, [
    input.documentId,
    ids.org,
    publishedVersionId,
    [ids.allMembers],
    input.readerSelectionId,
  ]);
  await client.query(`
    INSERT INTO knowledge_index_generation (
      generation_id, organization_id, submission_id, snapshot_version_id, snapshot_content_hash,
      status, manifest_json, shared_draft_id, completed_at
    ) VALUES ($1, $2, $3, $4, $5, 'READY', $6::jsonb, $7, now())`, [
    generationId,
    ids.org,
    submissionId,
    draftVersionId,
    contentHash,
    JSON.stringify(manifest),
    input.documentId,
  ]);

  return {
    generationId,
    publishedVersionId,
    snapshotVersionId: draftVersionId,
    snapshotContentHash: contentHash,
    chunkId,
  };
}

describe.skipIf(!databaseUrl)("UiSurface v3 persistence, hydration & 4-path revocation with real PostgreSQL (FORCE RLS)", () => {
  beforeAll(async () => {
    if (!pool || !repository) throw new Error("ARDEN_TEST_DATABASE_URL was not provided");
    const identity = await pool.query<{ database_name: string; is_superuser: boolean }>(`
      SELECT current_database() AS database_name, r.rolsuper AS is_superuser
        FROM pg_roles r WHERE r.rolname = current_user`);
    if (!identity.rows[0]?.database_name.startsWith("arden_test_") || !identity.rows[0]?.is_superuser) {
      throw new Error("Disposable superuser arden_test_* database required");
    }
    const migrated = await pool.query(`
      SELECT migration_id FROM public.arden_schema_migrations
       WHERE migration_id = '0075_ai_turn_ui_surface'`);
    if (migrated.rowCount !== 1) {
      throw new Error("Apply migration 0075_ai_turn_ui_surface to the isolated test database first");
    }

    await asSuperuser(async (client) => {
      await client.query("INSERT INTO organization (organization_id, name, slug) VALUES ($1, 'UI Surface Org', $2)", [
        ids.org,
        `ui-surface-${ids.org}`,
      ]);
      for (const [uid, name] of [
        [ids.admin, "Org Admin"],
        [ids.author, "Alice Author"],
        [ids.reader, "Rita Reader"],
        [ids.reviewer, "Rex Reviewer"],
      ] as const) {
        await client.query("INSERT INTO user_account (user_id, email, full_name) VALUES ($1, $2, $3)", [
          uid,
          `${uid}@example.test`,
          name,
        ]);
      }
      await client.query(`
        INSERT INTO organization_membership (membership_id, organization_id, user_id, status)
        VALUES ($1,$5,$6,'ACTIVE'), ($2,$5,$7,'ACTIVE'), ($3,$5,$8,'ACTIVE'), ($4,$5,$9,'ACTIVE')`, [
        ids.adminM, ids.authorM, ids.readerM, ids.reviewerM,
        ids.org, ids.admin, ids.author, ids.reader, ids.reviewer,
      ]);
      await client.query("INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, $3, 'Security')", [
        ids.deptRole, ids.org, `SEC_${ids.deptRole.replaceAll("-", "").toUpperCase()}`,
      ]);
      await client.query(`
        INSERT INTO department (department_id, organization_id, code, name, default_role_id, status)
        VALUES ($1, $2, 'SEC', 'Security', $3, 'ACTIVE')`, [ids.dept, ids.org, ids.deptRole]);
      await client.query(`
        INSERT INTO department_membership (membership_id, department_id, is_primary)
        VALUES ($1,$5,true), ($2,$5,true), ($3,$5,true), ($4,$5,true)`, [
        ids.adminM, ids.authorM, ids.readerM, ids.reviewerM, ids.dept,
      ]);
      await client.query("INSERT INTO access_scope (access_scope_id, organization_id, scope_type) VALUES ($1, $2, 'ORGANIZATION')", [
        ids.scope, ids.org,
      ]);
      await client.query(`
        INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, role_id, $2 FROM role WHERE code = 'ORG_ADMIN' AND is_system`, [ids.adminM, ids.scope]);
      await client.query(`
        INSERT INTO reviewer_grant (
          organization_id, reviewer_membership_id, scope, department_id, granted_by_membership_id,
          classifications, level, status
        ) VALUES ($1, $2, 'ORGANIZATION', NULL, $3, ARRAY['INTERNAL', 'CONFIDENTIAL'], 'STANDARD', 'ACTIVE')`, [
        ids.org, ids.reviewerM, ids.adminM,
      ]);
      await client.query("INSERT INTO role (role_id, organization_id, code, name) VALUES ($1, $2, 'ALL_MEMBERS', 'Everyone')", [
        ids.allMembers, ids.org,
      ]);
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission WHERE code = 'PUBLISHED_CONTENT_VIEW'`, [ids.allMembers]);
      await client.query(`
        INSERT INTO audience (audience_id, organization_id, kind, name, is_managed, legacy_role_id)
        VALUES ($1, $2, 'ORGANIZATION_ALL', 'Everyone', true, $1)`, [ids.allMembers, ids.org]);
      await client.query("INSERT INTO knowledge_base (knowledge_base_id, organization_id, name, scope_type) VALUES ($1, $2, 'Org KB', 'ORGANIZATION')", [
        ids.kbOrg, ids.org,
      ]);
      await client.query(`
        INSERT INTO reader_selection (selection_id, organization_id, reader_mode, department_id)
        VALUES ($1, $3, 'ORGANIZATION', NULL), ($2, $3, 'SELECTED_MEMBERS', NULL)`, [
        ids.selOrg, ids.selRestricted, ids.org,
      ]);
      await client.query(`
        INSERT INTO selected_reader (selection_id, organization_id, membership_id, ordinal)
        VALUES ($1, $2, $3, 1), ($1, $2, $4, 2)`, [ids.selRestricted, ids.org, ids.authorM, ids.adminM]);

      await client.query("SET LOCAL session_replication_role = replica");

      primaryRef = await seedIndexedPublication(client, {
        documentId: ids.docPrimary,
        title: "Security Policy",
        readerSelectionId: ids.selOrg,
        management: { type: "Policy & Standard", version: "1.0", expirationDate: "2099-12-31", changeNote: "" },
        text: primaryText,
      });
      primaryVersionId = primaryRef.publishedVersionId;

      const peerRef = await seedIndexedPublication(client, {
        documentId: ids.docPeer,
        title: "MFA Rollout Guide",
        readerSelectionId: ids.selOrg,
        management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
        text: "Companion rollout guide.",
      });
      peerVersionId = peerRef.publishedVersionId;

      const restrictedRef = await seedIndexedPublication(client, {
        documentId: ids.docRestrictedPeer,
        title: "Restricted Admin Runbook",
        readerSelectionId: ids.selRestricted,
        management: { type: "Procedure", version: "1.0", expirationDate: null, changeNote: "" },
        text: "Admin-only procedure.",
      });
      restrictedPeerVersionId = restrictedRef.publishedVersionId;

      // Seed one open maintenance case pinned to primaryVersionId (filed by reader).
      await client.query(`
        INSERT INTO maintenance_case (
          organization_id, origin, reporter_membership_id, document_id, published_version_id,
          content_hash, title, description, route_department_id, classification,
          author_membership_id, reporter_status
        ) VALUES ($1, 'READER_REPORT', $2, $3, $4, $5, 'Security Policy', 'Check MFA section',
          $6, 'INTERNAL', $7, 'Submitted')`, [
        ids.org,
        ids.readerM,
        ids.docPrimary,
        primaryVersionId,
        primaryRef.snapshotContentHash,
        ids.dept,
        ids.authorM,
      ]);

      // Seed two relationships from docPrimary (one readable peer, one restricted peer).
      await client.query(`
        INSERT INTO document_relationship (organization_id, source_document_id, target_document_id, relationship_type, created_by_membership_id)
        VALUES ($1, $2, $3, 'REFERENCES', $5), ($1, $2, $4, 'RELATED', $5)`, [
        ids.org, ids.docPrimary, ids.docPeer, ids.docRestrictedPeer, ids.authorM,
      ]);
    });

    fixtureReady = true;
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (fixtureReady) {
        await asSuperuser(async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          for (const table of [
            "ai_turn_surface_binding",
            "ai_turn_evidence",
            "ai_conversation_turn",
            "ai_conversation",
            "maintenance_case_event",
            "maintenance_notification",
            "maintenance_idempotency",
            "maintenance_case",
            "document_relationship",
            "publication_validity_renewal",
            "knowledge_current_publication",
            "knowledge_index_generation",
            "shared_submission",
            "shared_draft",
            "selected_reader",
            "reader_selection",
            "knowledge_base",
            "reviewer_grant",
            "audience",
            "audit_event",
          ]) {
            await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ids.org]);
          }
          await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id = ANY($1::uuid[])", [
            [ids.docPrimary, ids.docPeer, ids.docRestrictedPeer],
          ]);
          await client.query("DELETE FROM published_knowledge_version WHERE shared_draft_id = ANY($1::uuid[])", [
            [ids.docPrimary, ids.docPeer, ids.docRestrictedPeer],
          ]);
          await client.query("DELETE FROM department_membership WHERE membership_id = ANY($1::uuid[])", [membershipIds]);
          await client.query("DELETE FROM role_assignment WHERE membership_id = ANY($1::uuid[])", [membershipIds]);
          await client.query("DELETE FROM organization_membership WHERE organization_id = $1", [ids.org]);
          await client.query("DELETE FROM department WHERE organization_id = $1", [ids.org]);
          await client.query("DELETE FROM role_permission WHERE role_id = $1", [ids.allMembers]);
          await client.query("DELETE FROM role WHERE organization_id = $1", [ids.org]);
          await client.query("DELETE FROM access_scope WHERE organization_id = $1", [ids.org]);
          await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [userIds]);
          await client.query("DELETE FROM organization WHERE organization_id = $1", [ids.org]);
        });
      }
    } finally {
      await pool.end();
    }
  });

  function stubAiClient(): AskArdenClient {
    return {
      retrieve: async (req) => ({
        contractVersion: 2,
        usageContractVersion: 1,
        usageEvents: [],
        requestId: req.requestId,
        standaloneQuery: req.query,
        retrievalMode: "HYBRID",
        evidence: [{
          generationId: primaryRef.generationId,
          snapshotVersionId: primaryRef.snapshotVersionId,
          snapshotContentHash: primaryRef.snapshotContentHash,
          chunkId: primaryRef.chunkId,
          contentHash: primaryRef.snapshotContentHash,
          content: primaryText,
          startOffset: 0,
          endOffset: Array.from(primaryText).length,
          sourceBlockIds: ["pdf-page-2"],
          parentSectionBlockId: null,
          label: "Security Policy · Version 1.0",
        }],
      }),
      generate: async () => {
        throw new Error("Expected /v3/generations");
      },
      generateV3: async (req: GenerationV3Request) => ({
        contractVersion: 3,
        requestId: req.requestId,
        status: "ANSWERED",
        answer: "MFA is required for all production accounts [1].",
        citations: [{ chunkId: primaryRef.chunkId, quote: primaryText }],
        usedEvidence: [primaryRef.chunkId],
        uiSurfaceStatus: "GENERATED",
        uiSurface: {
          schemaVersion: 1,
          rootId: "root",
          nodes: [
            { id: "root", kind: "stack", gap: "md", childIds: ["metrics", "prose_1", "doc_card", "lin_1"] },
            { id: "metrics", kind: "metric_strip", metricKeys: ["MATCHED_DOCS", "OPEN_MAINTENANCE_CASES"] },
            { id: "prose_1", kind: "prose", markdown: "MFA is required for all production accounts [1].", citationIndexes: [1] },
            { id: "doc_card", kind: "card", title: "Security Policy", bodyIds: ["doc_1"], footerIds: ["maint_1", "report_1"] },
            { id: "doc_1", kind: "document_item", docRef: "D1" },
            { id: "maint_1", kind: "workflow_handoff", label: "Maintenance", handoff: "open_maintenance_case", docRef: "D1" },
            { id: "report_1", kind: "workflow_handoff", label: "Report issue", handoff: "report_issue", docRef: "D1" },
            { id: "lin_1", kind: "lineage_tree", docRef: "D1" },
          ],
        },
      }),
    };
  }

  it("enforces 0075 FORCE RLS, JSONB shape check, and role-scoped openMaintenanceCaseCount privacy", async () => {
    if (!pool || !repository) throw new Error("Database unavailable");

    const rls = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE oid = 'arden.ai_turn_surface_binding'::regclass`);
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    // Ordinary reader (even though they filed the case!) and Author must see openMaintenanceCaseCount === null.
    const readerDocs = await repository.uiSurfaceHydrator.loadDocuments(ids.reader, ids.org, [primaryVersionId]);
    expect(readerDocs.get(primaryVersionId)?.openMaintenanceCaseCount).toBeNull();
    expect(readerDocs.get(primaryVersionId)?.canOpenMaintenance).toBe(false);
    expect(readerDocs.get(primaryVersionId)?.authorDisplayName).toBe("Alice Author");

    const authorDocs = await repository.uiSurfaceHydrator.loadDocuments(ids.author, ids.org, [primaryVersionId]);
    expect(authorDocs.get(primaryVersionId)?.openMaintenanceCaseCount).toBeNull();
    expect(authorDocs.get(primaryVersionId)?.canOpenMaintenance).toBe(false);
    expect(authorDocs.get(primaryVersionId)?.canRenew).toBe(true);

    // Org Admin and 0060 disjoint eligible reviewer see exact openMaintenanceCaseCount === 1.
    const adminDocs = await repository.uiSurfaceHydrator.loadDocuments(ids.admin, ids.org, [primaryVersionId]);
    expect(adminDocs.get(primaryVersionId)?.openMaintenanceCaseCount).toBe(1);
    expect(adminDocs.get(primaryVersionId)?.canOpenMaintenance).toBe(true);

    const reviewerDocs = await repository.uiSurfaceHydrator.loadDocuments(ids.reviewer, ids.org, [primaryVersionId]);
    expect(reviewerDocs.get(primaryVersionId)?.openMaintenanceCaseCount).toBe(1);
    expect(reviewerDocs.get(primaryVersionId)?.canOpenMaintenance).toBe(true);

    // Lineage excludes unreadable restricted peer for reader (only readable peers may appear).
    const readerLineages = await repository.uiSurfaceHydrator.loadLineages(ids.reader, ids.org, [ids.docPrimary]);
    const readerPeers = (readerLineages.get(ids.docPrimary) ?? []).map((e) => e.peerPublishedVersionId);
    expect(readerPeers).not.toContain(restrictedPeerVersionId);
    expect(peerVersionId).toBeTruthy();
  });

  it("persists ui_surface + ai_turn_surface_binding and enforces 4-path fail-closed revocation on real PostgreSQL", async () => {
    if (!pool || !repository) throw new Error("Database unavailable");
    const engine = new GovernedAnswering(repository, stubAiClient());
    const conversationId = id();
    const requestId = id();
    const scopeFilter = { documentIds: [ids.docPrimary] };

    const res = await engine.answer(ids.reader, ids.org, {
      conversationId,
      requestId,
      expectedRevision: 0,
      query: "What is the MFA policy?",
      scopeFilter,
    });

    expect(res.uiSurface).not.toBeNull();
    expect(validateStoredBoundSurface(res.uiSurface, { citationCount: 1 }).ok).toBe(true);
    // Reader lacks maintenance visibility: maint_1 stripped, OPEN_MAINTENANCE_CASES tile omitted!
    expect(res.uiSurface!.nodes.maint_1).toBeUndefined();
    expect(res.uiSurface!.nodes.report_1).toBeDefined();
    expect(res.turnHydration?.metrics.metrics.map((m) => m.key)).toEqual(["MATCHED_DOCS"]);

    // Replay returns live hydrated surface; mismatched scopeFilterHash returns CONFLICT.
    const replayed = await engine.answer(ids.reader, ids.org, {
      conversationId,
      requestId,
      expectedRevision: 0,
      query: "What is the MFA policy?",
      scopeFilter,
    });
    expect(replayed.turnId).toBe(res.turnId);
    await expect(engine.answer(ids.reader, ids.org, {
      conversationId,
      requestId,
      expectedRevision: 0,
      query: "What is the MFA policy?",
      scopeFilter: { documentIds: [ids.docPeer] },
    })).rejects.toMatchObject({ code: "CONFLICT" });

    // Revoke reader access by narrowing target readers to selRestricted (author + admin only).
    await asSuperuser(async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("UPDATE published_knowledge_version SET reader_selection_id = $1 WHERE published_version_id = $2", [
        ids.selRestricted, primaryVersionId,
      ]);
      await client.query("UPDATE knowledge_current_publication SET reader_selection_id = $1 WHERE shared_draft_id = $2", [
        ids.selRestricted, ids.docPrimary,
      ]);
    });

    try {
      // Path 2: load withholds entire turn cleanly.
      const loaded = await engine.load(ids.reader, ids.org, conversationId);
      expect(loaded?.turns[0]).toMatchObject({
        status: "UNAVAILABLE",
        answer: "This answer is no longer available.",
        citations: [],
        uiSurface: null,
        turnHydration: null,
      });

      // Path 3: replay rejects with ACCESS_CHANGED.
      await expect(engine.answer(ids.reader, ids.org, {
        conversationId,
        requestId,
        expectedRevision: 0,
        query: "What is the MFA policy?",
        scopeFilter,
      })).rejects.toMatchObject({ code: "ACCESS_CHANGED" });

      // Path 1: direct store append with revoked surface binding rejects with ACCESS_CHANGED.
      await expect(repository.conversations.append(ids.reader, ids.org, conversationId, 1, {
        id: id(),
        requestId: id(),
        question: "Direct append",
        answer: "Should fail",
        status: "ANSWERED",
        citations: [],
        evidence: [],
        surfaceBindings: [{ documentId: ids.docPrimary, publishedVersionId: primaryVersionId }],
        uiSurface: null,
      })).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    } finally {
      // Restore reader selection for clean teardown.
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("UPDATE published_knowledge_version SET reader_selection_id = $1 WHERE published_version_id = $2", [
          ids.selOrg, primaryVersionId,
        ]);
        await client.query("UPDATE knowledge_current_publication SET reader_selection_id = $1 WHERE shared_draft_id = $2", [
          ids.selOrg, ids.docPrimary,
        ]);
      });
    }
  });

  it("narrows retrieval and dialogue history to the selected eligible documents", async () => {
    if (!repository) throw new Error("Database unavailable");
    const ai = stubAiClient();
    const retrieve = vi.spyOn(ai, "retrieve");
    const engine = new GovernedAnswering(repository, ai);
    const conversationId = id();
    await engine.answer(ids.reader, ids.org, {
      conversationId, requestId: id(), expectedRevision: 0, query: "What is the MFA policy?",
      scopeFilter: { documentIds: [ids.docPrimary] },
    });
    retrieve.mockImplementationOnce(async (request) => ({
      contractVersion: 2, requestId: request.requestId, standaloneQuery: request.query, retrievalMode: "HYBRID", evidence: [],
      usageContractVersion: 1, usageEvents: [],
    }));
    const peer = await engine.answer(ids.reader, ids.org, {
      conversationId, requestId: id(), expectedRevision: 1, query: "What about the rollout?",
      scopeFilter: { documentIds: [ids.docPeer, ids.docRestrictedPeer] },
    });
    expect(peer.status).toBe("INSUFFICIENT_EVIDENCE");
    const peerRequest = retrieve.mock.calls[1]?.[0];
    expect(peerRequest?.allowedGenerationIds).toHaveLength(1);
    expect(peerRequest?.sourceHints).toEqual([{
      generationId: peerRequest?.allowedGenerationIds[0], label: expect.stringContaining("MFA Rollout Guide"),
    }]);
    expect(peerRequest?.history).toEqual([]);

    const requestId = id();
    const gap = await engine.answer(ids.reader, ids.org, {
      conversationId, requestId, expectedRevision: 2, query: "Can you find guidance here?",
      scopeFilter: { documentIds: [ids.docRestrictedPeer, id()] },
    });
    expect(gap).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", citations: [] });
    expect(gap.answer).toContain("None of the selected documents");
    expect(retrieve).toHaveBeenCalledTimes(2);
    const persisted = await repository.conversations.load(ids.reader, ids.org, conversationId);
    expect(persisted?.turns.find((turn) => turn.requestId === requestId))
      .toMatchObject({ evidence: [], surfaceBindings: [] });
  });

  it("computes canRenew accurately per 0068 without 1,000-row silent truncation in both hydrator and graph service", async () => {
    if (!pool || !repository) throw new Error("Database unavailable");
    const graphService = new GraphProjectionService(repository.graph);
    const bulkCount = 1_005;
    const bulkDocIds = Array.from({ length: bulkCount }, () => id());
    const soonDocId = id();
    const soonDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    let soonVersionId = "";
    const pendingSubmissionId = id();

    try {
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        const contentHash = createHash("sha256").update("Bulk renewal doc").digest("hex");
        const bulkManagement = JSON.stringify({
          type: "Guide",
          version: "1.0",
          expirationDate: "2030-01-01",
          changeNote: "",
        });
        // Seed 1,005 earlier-expiring docs (2030-01-01) so docPrimary (2099-12-31) falls past row 1,000
        // of list_publication_renewal_state()'s ORDER BY expires_on LIMIT 1000.
        await client.query(`
          WITH seed AS (
            SELECT d_id,
                   gen_random_uuid() AS dv_id,
                   gen_random_uuid() AS sub_id,
                   gen_random_uuid() AS pv_id,
                   ord
              FROM unnest($1::uuid[]) WITH ORDINALITY AS t(d_id, ord)
          ), ins_draft AS (
            INSERT INTO shared_draft (
              shared_draft_id, organization_id, author_membership_id, title, classification,
              status, responsible_department_id, target_scope_type, current_version_no,
              management, draft_selection_id
            )
            SELECT s.d_id, $2, $3, 'Bulk Expiry ' || s.ord, 'INTERNAL', 'ACTIVE', $4, 'ORGANIZATION', 1, $5::jsonb, $6
              FROM seed s
          ), ins_dv AS (
            INSERT INTO shared_draft_version (
              shared_draft_version_id, shared_draft_id, version_no, content_uri, mime_type, content_hash
            )
            SELECT s.dv_id, s.d_id, 1, 'arden-private-object://' || s.d_id, 'text/plain', $7
              FROM seed s
          ), ins_sub AS (
            INSERT INTO shared_submission (
              submission_id, organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
              submitted_by_membership_id, target_scope_type, target_department_id, responsible_department_id,
              title, classification, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
              content_hash, status, publication_state, submit_request_id, proposed_selection_id,
              approved_selection_id, management
            )
            SELECT s.sub_id, $2, s.d_id, s.dv_id, 1, $3, 'ORGANIZATION', NULL, $4,
                   'Bulk Expiry ' || s.ord, 'INTERNAL', $8::uuid[], 1, 'GRANT_SCOPE',
                   'arden-private-object://' || s.d_id, 'text/plain', $7, 'APPROVED', 'ACTIVE',
                   gen_random_uuid(), $6, $6, $5::jsonb
              FROM seed s
          ), ins_pv AS (
            INSERT INTO published_knowledge_version (
              published_version_id, submission_id, knowledge_base_id, published_by_membership_id,
              author_membership_id, title, version_no, content_uri, content_hash, index_status, published_at,
              shared_draft_id, classification, responsible_department_id, audience_role_ids,
              valid_from, reader_selection_id, management
            )
            SELECT s.pv_id, s.sub_id, $9, NULL, $3, 'Bulk Expiry ' || s.ord, 1,
                   'arden-private-object://' || s.d_id, $7, 'INDEXED', now() - interval '10 days',
                   s.d_id, 'INTERNAL', $4, $8::uuid[], now() - interval '10 days', $6, $5::jsonb
              FROM seed s
          )
          INSERT INTO knowledge_current_publication (
            shared_draft_id, organization_id, published_version_id, audience_role_ids,
            target_scope_type, target_department_id, valid_from, reader_selection_id
          )
          SELECT s.d_id, $2, s.pv_id, $8::uuid[], 'ORGANIZATION', NULL, now() - interval '10 days', $6
            FROM seed s`, [
          bulkDocIds,
          ids.org,
          ids.authorM,
          ids.dept,
          bulkManagement,
          ids.selOrg,
          contentHash,
          [ids.allMembers],
          ids.kbOrg,
        ]);

        const soonRef = await seedIndexedPublication(client, {
          documentId: soonDocId,
          title: "Expiring Within 7 Days",
          readerSelectionId: ids.selOrg,
          management: { type: "Guide", version: "1.0", expirationDate: soonDate, changeNote: "" },
          text: "Expiring soon guidance.",
        });
        soonVersionId = soonRef.publishedVersionId;
      });

      // 1. Beyond 1,000 rows: docPrimary (2099-12-31) MUST still have canRenew=true for author in BOTH hydrator and graph!
      const authorHydrated = await repository.uiSurfaceHydrator.loadDocuments(ids.author, ids.org, [primaryVersionId, soonVersionId]);
      expect(authorHydrated.get(primaryVersionId)?.canRenew).toBe(true);
      expect(authorHydrated.get(soonVersionId)?.canRenew).toBe(true);

      const authorGraph = await graphService.getGraph(ids.author, ids.org, { focusDocumentId: ids.docPrimary });
      expect(authorGraph?.documents.find((d) => d.documentId === ids.docPrimary)?.canRenew).toBe(true);

      // Exact single-document renewal lookup (GovernanceActionDialog path) MUST succeed beyond row 1,000
      // even though the uncapped list_publication_renewal_state() omits docPrimary due to LIMIT 1000.
      const cappedList = await repository.listPublicationRenewalState(ids.author, ids.org);
      expect(cappedList?.some((row) => row.documentId === ids.docPrimary)).toBe(false);
      const exactAuthorRenewal = await repository.listPublicationRenewalState(ids.author, ids.org, ids.docPrimary);
      expect(exactAuthorRenewal).toHaveLength(1);
      expect(exactAuthorRenewal?.[0]?.documentId).toBe(ids.docPrimary);
      expect(exactAuthorRenewal?.[0]?.publishedVersionId).toBe(primaryVersionId);
      expect(exactAuthorRenewal?.[0]?.canRenew).toBe(true);
      expect(exactAuthorRenewal?.[0]?.renewalPending).toBe(false);
      const exactReaderRenewal = await repository.listPublicationRenewalState(ids.reader, ids.org, ids.docPrimary);
      expect(exactReaderRenewal).toEqual([]);

      // 2. Ordinary reader never gets canRenew, even within 7 days.
      const readerHydrated = await repository.uiSurfaceHydrator.loadDocuments(ids.reader, ids.org, [primaryVersionId, soonVersionId]);
      expect(readerHydrated.get(primaryVersionId)?.canRenew).toBe(false);
      expect(readerHydrated.get(soonVersionId)?.canRenew).toBe(false);

      // 3. Org Admin & Responsible Reviewer: false for active-author 2099 doc, true for expiring-within-7d doc.
      const adminHydrated = await repository.uiSurfaceHydrator.loadDocuments(ids.admin, ids.org, [primaryVersionId, soonVersionId]);
      expect(adminHydrated.get(primaryVersionId)?.canRenew).toBe(false);
      expect(adminHydrated.get(soonVersionId)?.canRenew).toBe(true);

      const reviewerHydrated = await repository.uiSurfaceHydrator.loadDocuments(ids.reviewer, ids.org, [primaryVersionId, soonVersionId]);
      expect(reviewerHydrated.get(primaryVersionId)?.canRenew).toBe(false);
      expect(reviewerHydrated.get(soonVersionId)?.canRenew).toBe(true);

      // 4. Pending RENEWAL submission blocks canRenew for author, admin, and reviewer.
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(`
          INSERT INTO shared_submission (
            submission_id, organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
            submitted_by_membership_id, target_scope_type, target_department_id, responsible_department_id,
            title, classification, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
            content_hash, status, publication_state, submit_request_id, request_type, request_reason,
            target_published_version_id, renewal_expiration_date, on_behalf_of_author
          )
          SELECT $1, organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
                 $2, target_scope_type, target_department_id, responsible_department_id,
                 title, classification, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
                 content_hash, 'PENDING_REVIEW', 'NONE', gen_random_uuid(), 'RENEWAL', 'Extending validity',
                 $3, '2099-12-31'::date, false
            FROM shared_submission
           WHERE shared_draft_id = $4 AND status = 'APPROVED'
           LIMIT 1`, [pendingSubmissionId, ids.authorM, soonVersionId, soonDocId]);
      });

      expect((await repository.uiSurfaceHydrator.loadDocuments(ids.author, ids.org, [soonVersionId])).get(soonVersionId)?.canRenew).toBe(false);
      expect((await repository.uiSurfaceHydrator.loadDocuments(ids.admin, ids.org, [soonVersionId])).get(soonVersionId)?.canRenew).toBe(false);
      expect((await repository.uiSurfaceHydrator.loadDocuments(ids.reviewer, ids.org, [soonVersionId])).get(soonVersionId)?.canRenew).toBe(false);

      // 5. Inactive author unlocks immediate on-behalf renewal for Org Admin & Responsible Reviewer even for 2099 expiry!
      await asSuperuser((client) => client.query(
        "UPDATE organization_membership SET status = 'SUSPENDED' WHERE membership_id = $1",
        [ids.authorM],
      ));
      try {
        expect((await repository.uiSurfaceHydrator.loadDocuments(ids.admin, ids.org, [primaryVersionId])).get(primaryVersionId)?.canRenew).toBe(true);
        expect((await repository.uiSurfaceHydrator.loadDocuments(ids.reviewer, ids.org, [primaryVersionId])).get(primaryVersionId)?.canRenew).toBe(true);
        const reviewerGraph = await graphService.getGraph(ids.reviewer, ids.org, { focusDocumentId: ids.docPrimary });
        expect(reviewerGraph?.documents.find((d) => d.documentId === ids.docPrimary)?.canRenew).toBe(true);
        const exactReviewerRenewal = await repository.listPublicationRenewalState(ids.reviewer, ids.org, ids.docPrimary);
        expect(exactReviewerRenewal).toHaveLength(1);
        expect(exactReviewerRenewal?.[0]?.canRenew).toBe(true);
        expect(exactReviewerRenewal?.[0]?.authorActive).toBe(false);
      } finally {
        await asSuperuser((client) => client.query(
          "UPDATE organization_membership SET status = 'ACTIVE' WHERE membership_id = $1",
          [ids.authorM],
        ));
      }
    } finally {
      const extraDocs = [...bulkDocIds, soonDocId];
      await asSuperuser(async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM knowledge_current_publication WHERE shared_draft_id = ANY($1::uuid[])", [extraDocs]);
        await client.query("DELETE FROM knowledge_index_generation WHERE shared_draft_id = ANY($1::uuid[])", [extraDocs]);
        await client.query("DELETE FROM published_knowledge_version WHERE shared_draft_id = ANY($1::uuid[])", [extraDocs]);
        await client.query("DELETE FROM shared_submission WHERE shared_draft_id = ANY($1::uuid[]) OR submission_id = $2", [extraDocs, pendingSubmissionId]);
        await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id = ANY($1::uuid[])", [extraDocs]);
        await client.query("DELETE FROM shared_draft WHERE shared_draft_id = ANY($1::uuid[])", [extraDocs]);
      });
    }
  }, 120_000);
});
