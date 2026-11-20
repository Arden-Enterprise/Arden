import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { PgIndexGenerationStore } from "../indexing/store.js";
import { CatalogError } from "./catalog-store.js";
import { inventoryCollectionLegacy, migrateCollectionLegacy, type CollectionLegacyPlan } from "./collection-legacy.js";
import type { TargetReadersInput } from "../target-readers/policy.js";
import { registerHomeHttpVerification } from "./home-http.integration.verification.js";
import { registerLegacyMetadataVerification } from "./legacy-metadata.integration.verification.js";

const url = process.env.ARDEN_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;
const owner = randomUUID(), member = randomUUID(), memberId = randomUUID(), foreign = randomUUID();
const colleague = randomUUID(), colleagueId = randomUUID();
let org = "", department = "", ownerMembership = "", draftId = "";

// Exercise the real worker claim/atomic activation contract with a synthetic
// manifest. No embedding provider or real text indexing is invoked by this fixture.
async function activateFixture(): Promise<string> {
  const indexing = new PgIndexGenerationStore(pool!); const worker = randomUUID();
  const job = await indexing.claim(worker, 90); if (!job) throw new Error("No index fixture job");
  return indexing.complete(job, worker, { contractVersion: 1, jobId: job.jobId, generationId: job.generationId,
    snapshotVersionId: job.snapshotVersionId, snapshotContentHash: job.snapshotContentHash, compilerVersion: "semantic-markdown-v1",
    chunkingVersion: "langchain-section-token-v1", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
    markdownContentHash: "d".repeat(64), chunksDigest: "e".repeat(64), chunks: [{ chunkId: "f".repeat(64), ordinal: 0,
      contentHash: "1".repeat(64), startOffset: 0, endOffset: 10, sourceBlockIds: ["body"], parentSectionBlockId: null }] });
}

async function publishCollectionFixture(readers: TargetReadersInput) {
  const repo = repository!;
  const draft = await repo.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership, title: "Collection source fixture",
    classification: "INTERNAL", idempotencyKey: randomUUID(), content: { sourceUri: "arden-private-object://collection-scope-fixture",
      mimeType: "text/plain", contentHash: "a".repeat(64) }, requestId: "collection-create" });
  if (draft.kind !== "created") throw new Error("Collection draft fixture failed");
  const saved = await repo.updateKnowledgeDraft(owner, org, draft.draft.id, 1, {
    management: { type: "Guide", version: "1.0", effectiveDate: null, expirationDate: null, changeNote: "" }, targetReaders: readers,
  }, null, "collection-save");
  if (saved.kind !== "updated") throw new Error("Collection save fixture failed");
  const submitted = await repo.submitKnowledgeDraft(owner, org, draft.draft.id, 2, randomUUID(), "collection-submit");
  if (submitted.kind !== "submitted") throw new Error("Collection submit fixture failed");
  const decision = await repo.decideReview(owner, org, submitted.submission.id, "APPROVE", submitted.submission.snapshotVersionId,
    submitted.submission.contentHash, null, randomUUID(), "collection-approve");
  if (decision.kind !== "decided") throw new Error("Collection approval fixture failed");
  return { id: await activateFixture(), draftId: draft.draft.id };
}

async function runtimeCatalog<T>(actor: string, admin: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE arden_runtime");
    await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true), set_config('arden.org_admin', $3, true)",
      [actor, org, String(admin)]);
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function collectionFolder(name: string) {
  const folder = await repository!.knowledgeCatalog.write(owner, org, "collections", null, null,
    { name: `${name} ${randomUUID()}`, status: "ACTIVE", allowedTypes: ["Guide"] }, "folder-schema-fixture");
  return folder;
}

// Registered in repository.integration.test.ts: both fixtures publish through
// the global worker queue and must not race each other's claims across files.
export function registerKnowledgeCatalogVerification() {
describe.skipIf(!pool)("KM catalog and immutable metadata with real runtime RLS", () => {
  beforeAll(async () => {
    const identity = await pool!.query("SELECT current_database() AS name, rolsuper FROM pg_roles WHERE rolname = current_user");
    if (!identity.rows[0]?.name.startsWith("arden_test_") || !identity.rows[0]?.rolsuper) throw new Error("Disposable superuser database required");
    const created = await repository!.createOrganization(owner, `${owner}@example.test`, "Catalog owner",
      { name: `Catalog QA ${owner}`, departmentName: "Engineering" }, "catalog-fixture");
    org = created.organizationId; department = created.departmentId!;
    ownerMembership = (await repository!.requireActiveMembership(owner, org))!.membershipId;
    await pool!.query("INSERT INTO arden.user_account (user_id, email, full_name) VALUES ($1, $2, 'Catalog reader')", [member, `${member}@example.test`]);
    await pool!.query("INSERT INTO arden.organization_membership (membership_id, organization_id, user_id) VALUES ($1, $2, $3)", [memberId, org, member]);
    await pool!.query("INSERT INTO arden.user_account (user_id, email, full_name) VALUES ($1, $2, 'Other reader')", [colleague, `${colleague}@example.test`]);
    await pool!.query("INSERT INTO arden.organization_membership (membership_id, organization_id, user_id) VALUES ($1, $2, $3)", [colleagueId, org, colleague]);
  });
  afterAll(async () => {
    if (!pool) return;
    if (org) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Cleanup is session-local and limited to this synthetic organization.
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("SET LOCAL search_path TO arden, public");
        await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id IN (SELECT shared_draft_id FROM shared_draft WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM published_knowledge_version WHERE shared_draft_id IN (SELECT shared_draft_id FROM shared_draft WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM knowledge_index_job WHERE generation_id IN (SELECT generation_id FROM knowledge_index_generation WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM review_decision WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)", [org]);
        for (const table of ["knowledge_ai_release", "knowledge_collection_placement", "knowledge_collection_document", "knowledge_collection", "knowledge_current_publication", "knowledge_index_generation",
          "shared_submission", "shared_draft_audience", "shared_draft", "selected_reader", "reader_selection", "knowledge_base",
          "audit_event", "audience_group_membership", "audience", "reviewer_grant"]) {
          await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
        }
        await client.query("DELETE FROM department_membership WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM role_assignment WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM role_permission WHERE role_id IN (SELECT role_id FROM role WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM draft_version WHERE draft_id IN (SELECT d.draft_id FROM draft_document d JOIN private_workspace w ON w.workspace_id=d.workspace_id JOIN organization_membership m ON m.membership_id=w.membership_id WHERE m.organization_id=$1)", [org]);
        await client.query("DELETE FROM draft_document WHERE workspace_id IN (SELECT w.workspace_id FROM private_workspace w JOIN organization_membership m ON m.membership_id=w.membership_id WHERE m.organization_id=$1)", [org]);
        await client.query("DELETE FROM private_workspace WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id=$1)", [org]);
        for (const table of ["organization_membership", "department", "role", "access_scope", "organization"]) await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
        await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [[owner, member, colleague]]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await pool.end();
  });

  registerHomeHttpVerification(() => ({ pool: pool!, repository: repository!, organization: org,
    owner, member, memberId, colleague, colleagueId, department }));
  registerLegacyMetadataVerification(() => ({ pool: pool!, publish: () => publishCollectionFixture({ mode: "ORGANIZATION" }) }));

  it("enforces catalog ownership, stale writes, submit fields, frozen snapshots and reader-only curation", async () => {
    const repo = repository!, catalog = repo.knowledgeCatalog;
    await expect(catalog.write(member, org, "collections", null, null, { name: "Denied", description: "", status: "ACTIVE", allowedTypes: ["Guide"] }, "denied"))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(catalog.list(foreign, org)).rejects.toBeInstanceOf(CatalogError);
    const shell = await catalog.write(owner, org, "collections", null, null,
      { name: "Engineering practice", description: "", status: "ACTIVE", allowedTypes: ["Guide"] }, "create-collection");
    await expect(catalog.write(owner, org, "collections", null, null,
      { name: " engineering PRACTICE ", description: "", status: "ACTIVE", allowedTypes: ["Guide"] }, "duplicate")).rejects.toMatchObject({ code: "DUPLICATE" });
    const races = await Promise.allSettled(["A", "B"].map(suffix => catalog.write(owner, org, "collections", shell.id, shell.version,
      { name: `Engineering practice ${suffix}`, description: "", status: "ACTIVE", allowedTypes: ["Guide"] }, "race")));
    expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(races.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["CONFLICT"]);
    // Decision0027: the catalog has no Topics; an empty Collection shell is visible only to its manager.
    expect((await catalog.list(member, org)).collections).toEqual([]);
    expect(Object.keys(await catalog.list(owner, org))).not.toContain("topics");
    expect((await catalog.list(member, org)).canManage).toBe(false);
    expect((await catalog.list(owner, org)).canManage).toBe(true);
    // Decision 0021: name or email search, returning the full email like sharing in Google Drive.
    expect(await catalog.readers(member, org, "Catalog", [])).toEqual(expect.arrayContaining([expect.objectContaining({
      id: ownerMembership, name: "Catalog owner", email: `${owner}@example.test` })]));
    expect(await catalog.readers(member, org, `${owner}@EXAMPLE.test`, [])).toEqual([expect.objectContaining({ id: ownerMembership })]);
    expect(await catalog.readers(member, org, "nobody@other.test", [])).toEqual([]);
    expect(await catalog.readers(foreign, org, "Catalog", [])).toEqual([]);
    expect(await catalog.readers(foreign, org, `${owner}@example.test`, [])).toEqual([]);

    const draft = await repo.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership, title: "Governed guide",
      classification: "INTERNAL", idempotencyKey: randomUUID(), content: { sourceUri: "arden-private-object://catalog-fixture",
        mimeType: "text/plain", contentHash: "a".repeat(64) }, requestId: "create" });
    if (draft.kind !== "created") throw new Error("Draft fixture failed");
    draftId = draft.draft.id;
    await expect(repo.submitKnowledgeDraft(owner, org, draftId, 1, randomUUID(), "incomplete")).resolves.toEqual({ kind: "not-ready" });
    const metadata = { type: "Guide" as const, version: "1.0", effectiveDate: "2027-01-01", expirationDate: null, changeNote: "" };
    await expect(repo.updateKnowledgeDraft(owner, org, draftId, 1, { management: { ...metadata, expirationDate: "2026-01-01" } }, null, "invalid-date"))
      .resolves.toEqual({ kind: "invalid-metadata" });
    const saved = await repo.updateKnowledgeDraft(owner, org, draftId, 1, { management: metadata, targetReaders: { mode: "ORGANIZATION" } }, null, "save");
    expect(saved.kind).toBe("updated");
    expect(saved).toMatchObject({ draft: { management: metadata } });
    const legacyDowngrade = await repo.updateKnowledgeDraft(owner, org, draftId, 2, {
      targetScopeType: "DEPARTMENT", audienceRoleIds: [], teamTag: "misroute-review",
    }, null, "legacy-downgrade");
    expect(legacyDowngrade).toMatchObject({ kind: "updated", draft: { targetScopeType: "ORGANIZATION", teamTag: null } });
    const submitted = await repo.submitKnowledgeDraft(owner, org, draftId, 3, randomUUID(), "submit");
    if (submitted.kind !== "submitted") throw new Error("Submission fixture failed");
    expect(submitted.submission.management).toMatchObject({ ...metadata, releaseKind: "NEW" });
    expect(submitted.submission.management).not.toHaveProperty("topicId");
    const changed = await repo.updateKnowledgeDraft(owner, org, draftId, 3, { management: { ...metadata, version: "9.0" } }, null, "edit-pending");
    expect(changed.kind).toBe("updated");
    expect((await repo.listKnowledgeSubmissions(owner, org))![0]!.management?.version).toBe("1.0");
    const locked = await pool!.connect();
    try { await locked.query("BEGIN"); await expect(locked.query("UPDATE arden.shared_submission SET management = '{}' WHERE submission_id = $1", [submitted.submission.id])).rejects.toMatchObject({ code: "55000" }); }
    finally { await locked.query("ROLLBACK"); locked.release(); }
    const decision = await repo.decideReview(owner, org, submitted.submission.id, "APPROVE", submitted.submission.snapshotVersionId,
      submitted.submission.contentHash, null, randomUUID(), "approve");
    expect(decision.kind).toBe("decided");
    const publicationId = await activateFixture();
    const publication = await repo.getPublishedKnowledge(member, org, publicationId);
    // Decision 0021: no Document Code is returned.
    expect(publication).toMatchObject({ management: { version: "1.0", effectiveDate: "2027-01-01" } });
    expect(publication).not.toHaveProperty("documentCode");
    const collection = await catalog.write(owner, org, "collections", null, null, { name: "Engineering handbook", description: "",
      status: "ACTIVE", cover: "production", allowedTypes: ["Guide"] }, "curate");
    await catalog.place(owner, org, draftId, 0, collection.id, "place-guide");
    expect((await catalog.list(member, org)).collections[0]!.documentIds).toEqual([publicationId]);
    await expect(catalog.place(owner, org, randomUUID(), 0, collection.id, "bad-source")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await pool!.query("UPDATE arden.organization_membership SET status = 'SUSPENDED' WHERE membership_id = $1", [memberId]);
    await expect(catalog.list(member, org)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await pool!.query("UPDATE arden.organization_membership SET status = 'ACTIVE' WHERE membership_id = $1", [memberId]);
    await catalog.write(owner, org, "collections", collection.id, collection.version, { name: "Engineering handbook", description: "",
      status: "INACTIVE", cover: "production", allowedTypes: ["Guide"] }, "deactivate");
    expect((await catalog.list(member, org)).collections).toEqual([]);
    expect(await repo.getPublishedKnowledge(member, org, publicationId)).not.toBeNull();
    // Admin authority is not a read entitlement. Publish a replacement for two
    // other readers, retaining the same logical identity but excluding its author.
    const replacement = await repo.updateKnowledgeDraft(owner, org, draftId, 4, {
      management: { ...metadata, version: "2.0", changeNote: "Narrowed working guidance." },
      targetReaders: { mode: "SELECTED_MEMBERS", memberIds: [memberId, colleagueId] },
    }, null, "restricted-replacement");
    expect(replacement.kind).toBe("updated");
    const second = await repo.submitKnowledgeDraft(owner, org, draftId, 5, randomUUID(), "restricted-submit");
    if (second.kind !== "submitted") throw new Error("Replacement fixture failed");
    await repo.decideReview(owner, org, second.submission.id, "APPROVE", second.submission.snapshotVersionId,
      second.submission.contentHash, null, randomUUID(), "restricted-approve");
    const restrictedId = await activateFixture();
    expect(await repo.getPublishedKnowledge(owner, org, restrictedId)).toBeNull();
    expect(await repo.getPublishedKnowledge(member, org, restrictedId)).not.toBeNull();
    expect((await catalog.list(owner, org)).canManage).toBe(true);
    expect((await catalog.list(owner, org)).collections.every(item => item.documentIds.length === 0)).toBe(true);
    await expect(catalog.place(owner, org, draftId, 1, collection.id, "denied-curation")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(department).toBeTruthy();
  });

  it.each(["ORGANIZATION", "DEPARTMENT", "SELECTED_MEMBERS"] as const)(
    "publishes Topic-free %s contributions without changing readership", async mode => {
      const repo = repository!;
      const created = await repo.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership, title: `Topic-free ${mode}`,
        classification: "INTERNAL", idempotencyKey: randomUUID(), content: { sourceUri: "arden-private-object://topic-free-fixture",
          mimeType: "text/plain", contentHash: "b".repeat(64) }, requestId: "create-topic-free" });
      if (created.kind !== "created") throw new Error("Draft fixture failed");
      const id = created.draft.id;
      const management = { type: "Guide" as const, version: "1.0", effectiveDate: null, expirationDate: null, changeNote: "" };
      const targetReaders = mode === "ORGANIZATION" ? { mode } : mode === "DEPARTMENT" ? { mode, departmentId: department }
        : { mode, memberIds: [memberId, colleagueId] };
      expect(await repo.updateKnowledgeDraft(owner, org, id, 1, { management, targetReaders }, null, "save-topic-free"))
        .toMatchObject({ kind: "updated", draft: { management, targetReaders: { mode } } });
      const submitted = await repo.submitKnowledgeDraft(owner, org, id, 2, randomUUID(), "submit-topic-free");
      if (submitted.kind !== "submitted") throw new Error("Topic-free submission failed");
      expect(submitted.submission.management).toMatchObject(management);
      expect(submitted.submission.management).not.toHaveProperty("topicId");
      expect(await repo.decideReview(owner, org, submitted.submission.id, "APPROVE", submitted.submission.snapshotVersionId,
        submitted.submission.contentHash, null, randomUUID(), "approve-topic-free")).toMatchObject({ kind: "decided" });
      expect((await repo.listKnowledgeSubmissions(owner, org))!.find(item => item.id === submitted.submission.id)?.publicationState).toBe("PREPARING");
      const publicationId = await activateFixture();
      const reader = mode === "DEPARTMENT" ? owner : member;
      expect(await repo.getPublishedKnowledge(reader, org, publicationId)).toMatchObject({ management: { version: "1.0" }, targetReaders: { mode } });
      expect(await repo.getPublishedKnowledge(foreign, org, publicationId)).toBeNull();
      if (mode === "DEPARTMENT") expect(await repo.getPublishedKnowledge(member, org, publicationId)).toBeNull();
      if (mode === "SELECTED_MEMBERS") expect(await repo.getPublishedKnowledge(owner, org, publicationId)).toBeNull();
    });

  it.each(["DEPARTMENT", "SELECTED_MEMBERS"] as const)("excludes readable %s sources from new and legacy Collections", async mode => {
    const repo = repository!, catalog = repo.knowledgeCatalog;
    const readers: TargetReadersInput = mode === "DEPARTMENT" ? { mode, departmentId: department }
      : { mode, memberIds: [ownerMembership, memberId] };
    const restricted = await publishCollectionFixture(readers);
    // The active Admin is genuinely a permitted reader; exclusion must be based
    // on Organization scope, not an unrelated read denial.
    expect(await repo.getPublishedKnowledge(owner, org, restricted.id)).not.toBeNull();
    const destination = await collectionFolder(`Denied ${mode}`);
    await expect(catalog.place(owner, org, restricted.draftId, 0, destination.id, "reject-restricted-folder"))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    const common = await publishCollectionFixture({ mode: "ORGANIZATION" });
    const mixed = await catalog.write(owner, org, "collections", null, null, { name: `Mixed legacy ${mode}`, description: "",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "create-common-folder");
    await catalog.place(owner, org, common.draftId, 0, mixed.id, "place-common");
    const hidden = await catalog.write(owner, org, "collections", null, null, { name: `Restricted legacy ${mode}`, description: "",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "create-legacy-shell");
    // Trusted setup models pre-KM2 links without relaxing runtime policies.
    await pool!.query(`INSERT INTO arden.knowledge_collection_document (collection_id, organization_id, published_version_id, ordinal)
      VALUES ($1, $2, $3, 1), ($4, $2, $3, 0)`, [mixed.id, org, restricted.id, hidden.id]);
    for (const actor of [owner, member]) {
      const listed = await catalog.list(actor, org);
      expect(listed.collections.find(item => item.id === mixed.id)?.documentIds).toEqual([common.id]);
      expect(listed.collections.find(item => item.id === hidden.id)?.documentIds ?? []).toEqual([]);
      if (actor === member) expect(listed.collections.find(item => item.id === hidden.id)).toBeUndefined();
    }
    await expect(catalog.write(member, org, "collections", null, null, { name: "Member cannot manage", description: "",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "member-folder-denied")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(catalog.write(foreign, org, "collections", null, null, { name: "Foreign cannot manage", description: "",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "foreign-folder-denied")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const updated = await catalog.write(owner, org, "collections", mixed.id, mixed.version, { name: mixed.name, description: "Updated description",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "edit-common-folder");
    expect(updated.version).toBe(mixed.version + 1);
    expect((await pool!.query("SELECT 1 FROM arden.knowledge_collection_document WHERE collection_id = $1 AND published_version_id = $2",
      [mixed.id, restricted.id])).rowCount).toBe(1); // No unapproved legacy-link deletion.
  });

  it("hides Collection links after approved readers narrow, without denying a still-authorized normal reader", async () => {
    const repo = repository!, catalog = repo.knowledgeCatalog;
    const common = await publishCollectionFixture({ mode: "ORGANIZATION" });
    const folder = await catalog.write(owner, org, "collections", null, null, { name: "Readership changes", description: "",
      status: "ACTIVE", allowedTypes: ["Guide"] }, "create-change-folder");
    await catalog.place(owner, org, common.draftId, 0, folder.id, "place-change");
    const request = await repo.requestPublicationChange(owner, org, common.draftId, { type: "READER_CHANGE", reason: "Limit working guidance",
      idempotencyKey: randomUUID(), targetReaders: { mode: "DEPARTMENT", departmentId: department } }, "narrow-common");
    if (request.kind !== "requested") throw new Error(`Reader-change fixture failed: ${request.kind}`);
    const decision = await repo.decideReview(owner, org, request.submission.id, "APPROVE", request.submission.snapshotVersionId,
      request.submission.contentHash, null, randomUUID(), "approve-narrow-common");
    expect(decision.kind).toBe("decided");
    expect(await repo.getPublishedKnowledge(owner, org, common.id)).not.toBeNull();
    expect((await catalog.list(owner, org)).collections.find(item => item.id === folder.id)?.documentIds).toEqual([]);
    expect((await catalog.list(member, org)).collections.find(item => item.id === folder.id)).toBeUndefined();
    expect((await pool!.query("SELECT collection_id FROM arden.knowledge_collection_placement WHERE shared_draft_id = $1", [common.draftId])).rows)
      .toEqual([{ collection_id: null }]);
  });

  it("preserves an untouched legacy Topic snapshot when its draft is later saved Topic-free", async () => {
    const repo = repository!;
    const topic = { id: randomUUID(), name: "Legacy snapshot reference" };
    const created = await repo.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership, title: "Legacy fixture",
      classification: "INTERNAL", idempotencyKey: randomUUID(), content: { sourceUri: "arden-private-object://legacy-topic-fixture",
        mimeType: "text/plain", contentHash: "c".repeat(64) }, requestId: "legacy-create" });
    if (created.kind !== "created") throw new Error("Draft fixture failed");
    const id = created.draft.id;
    const metadata = { type: "Guide" as const, version: "1.0", effectiveDate: null, expirationDate: null, changeNote: "" };
    await repo.updateKnowledgeDraft(owner, org, id, 1, { management: metadata, targetReaders: { mode: "ORGANIZATION" } }, null, "legacy-save");
    // Trusted fixture setup only: simulate a draft saved by the previous application.
    await pool!.query("UPDATE arden.shared_draft SET management = management || jsonb_build_object('topicId', $1::text) WHERE shared_draft_id = $2", [topic.id, id]);
    const submitted = await repo.submitKnowledgeDraft(owner, org, id, 2, randomUUID(), "legacy-submit");
    if (submitted.kind !== "submitted") throw new Error("Legacy submission failed");
    expect(submitted.submission.management).not.toHaveProperty("topicId");
    // Trusted fixture only: represent an immutable snapshot created before contraction.
    // The application runtime never receives permission to disable this trigger.
    const fixture = await pool!.connect();
    let before: unknown;
    try {
      await fixture.query("BEGIN");
      await fixture.query("ALTER TABLE arden.shared_submission DISABLE TRIGGER trg_freeze_submission_management");
      before = (await fixture.query(`UPDATE arden.shared_submission SET management = management ||
        jsonb_build_object('topicId', $1::text, 'topicName', $2::text) WHERE submission_id = $3 RETURNING management`,
      [topic.id, topic.name, submitted.submission.id])).rows[0].management;
      await fixture.query("ALTER TABLE arden.shared_submission ENABLE TRIGGER trg_freeze_submission_management");
      await fixture.query("COMMIT");
    } catch (error) { await fixture.query("ROLLBACK"); throw error; }
    finally { fixture.release(); }
    expect(await repo.updateKnowledgeDraft(owner, org, id, 2, { management: { ...metadata, version: "2.0" } }, null, "new-save"))
      .toMatchObject({ kind: "updated", draft: { management: { version: "2.0" } } });
    expect((await repo.listKnowledgeSubmissions(owner, org))!.find(item => item.id === submitted.submission.id)?.management)
      .toMatchObject({ version: "1.0" });
    expect((await pool!.query("SELECT management FROM arden.shared_submission WHERE submission_id = $1", [submitted.submission.id])).rows[0].management).toEqual(before);
  });

  describe("P3B.2 Collection management API storage", () => {
    it("adds, moves, removes and reconciles concurrent placement with transactional audit", async () => {
      const catalog = repository!.knowledgeCatalog;
      const source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const first = await collectionFolder("API first"), second = await collectionFolder("API second");
      expect(await catalog.getPlacement(owner, org, source.draftId)).toEqual({ documentId: source.draftId, collectionId: null, revision: 0 });
      for (const actor of [member, foreign]) {
        await expect(catalog.getPlacement(actor, org, source.draftId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
        await expect(catalog.place(actor, org, source.draftId, 0, first.id, "denied-place")).rejects.toMatchObject({ code: "UNAVAILABLE" });
      }
      const placed = await catalog.place(owner, org, source.draftId, 0, first.id, "api-place");
      expect(placed).toMatchObject({ collectionId: first.id, revision: 1 });
      const races = await Promise.allSettled([first.id, second.id].map(id => catalog.place(owner, org, source.draftId, 1, id, "api-race")));
      expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(races.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["CONFLICT"]);
      expect(await catalog.place(owner, org, source.draftId, 2, null, "api-remove")).toMatchObject({ collectionId: null, revision: 3 });
      await expect(catalog.place(owner, org, source.draftId, 0, first.id, "stale-create")).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await catalog.list(member, org)).collections.flatMap(item => item.documentIds)).not.toContain(source.id);
      expect(await repository!.getPublishedKnowledge(member, org, source.id)).not.toBeNull();
      expect((await pool!.query(`SELECT count(*) FROM arden.audit_event WHERE organization_id = $1
        AND event_type = 'KNOWLEDGE_COLLECTION_PLACED' AND details_json->>'documentId' = $2`, [org, source.draftId])).rows[0].count).toBe("3");
    });

    it("requires explicit allowed Types, rejects old bulk links, and archives without withdrawing", async () => {
      const catalog = repository!.knowledgeCatalog;
      await expect(catalog.write(owner, org, "collections", null, null,
        { name: "No implicit type", status: "ACTIVE" }, "missing-types")).rejects.toMatchObject({ code: "INVALID" });
      await expect(catalog.write(owner, org, "collections", null, null,
        { name: "Old payload", status: "ACTIVE", documentIds: [] }, "old-client")).rejects.toMatchObject({ code: "UPGRADE_REQUIRED" });
      const folder = await collectionFolder("API archive"), source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      await catalog.place(owner, org, source.draftId, 0, folder.id, "api-before-archive");
      await catalog.write(owner, org, "collections", folder.id, folder.version,
        { name: folder.name, status: "INACTIVE", allowedTypes: ["Guide"] }, "api-archive");
      expect(await catalog.getPlacement(owner, org, source.draftId)).toMatchObject({ collectionId: null, revision: 2 });
      await expect(catalog.place(owner, org, source.draftId, 2, folder.id, "archived-destination"))
        .rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect((await catalog.list(member, org)).collections.find(item => item.id === folder.id)).toBeUndefined();
      expect(await repository!.getPublishedKnowledge(member, org, source.id)).not.toBeNull();
    });

    it("rejects wrong-Type, unreadable and unknown destinations without changing placement", async () => {
      const catalog = repository!.knowledgeCatalog;
      const folder = await catalog.write(owner, org, "collections", null, null,
        { name: `Procedure ${randomUUID()}`, status: "ACTIVE", allowedTypes: ["Procedure"] }, "procedure-only");
      const source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      for (const destination of [folder.id, randomUUID()]) {
        await expect(catalog.place(owner, org, source.draftId, 0, destination, "bad-destination")).rejects.toMatchObject({ code: "UNAVAILABLE" });
        expect(await catalog.getPlacement(owner, org, source.draftId)).toMatchObject({ revision: 0 });
      }
      const restricted = await publishCollectionFixture({ mode: "SELECTED_MEMBERS", memberIds: [memberId, colleagueId] });
      await expect(catalog.getPlacement(owner, org, restricted.draftId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(catalog.place(owner, org, restricted.draftId, 0, folder.id, "restricted")).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(catalog.place(owner, org, source.draftId, -1, null, "invalid-revision")).rejects.toMatchObject({ code: "INVALID" });
    });

    it("rolls placement back when its audit write fails", async () => {
      const catalog = repository!.knowledgeCatalog, folder = await collectionFolder("Audit rollback");
      const source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      await pool!.query(`ALTER TABLE arden.audit_event ADD CONSTRAINT test_collection_audit_failure
        CHECK (organization_id <> '${org}'::uuid OR event_type <> 'KNOWLEDGE_COLLECTION_PLACED') NOT VALID`);
      try {
        await expect(catalog.place(owner, org, source.draftId, 0, folder.id, "failed-audit")).rejects.toMatchObject({ code: "23514" });
        expect(await catalog.getPlacement(owner, org, source.draftId)).toMatchObject({ revision: 0, collectionId: null });
      } finally { await pool!.query("ALTER TABLE arden.audit_event DROP CONSTRAINT test_collection_audit_failure"); }
    });
  });

  describe("P3B.2 explicit legacy conversion and cleanup", () => {
    it("maps ambiguous legacy folders explicitly, removes only legacy links and preserves content/readers/history/Topics", async () => {
      const common = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const restricted = await publishCollectionFixture({ mode: "DEPARTMENT", departmentId: department });
      const newer = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const newerFolder = await collectionFolder("Newer explicit placement");
      await repository!.knowledgeCatalog.place(owner, org, newer.draftId, 0, newerFolder.id, "newer-before-legacy");
      const folders = (await pool!.query<{ id: string }>(`INSERT INTO arden.knowledge_collection (organization_id, name)
        VALUES ($1, $2), ($1, $3) RETURNING collection_id AS id`, [org, `Legacy A ${randomUUID()}`, `Legacy B ${randomUUID()}`])).rows;
      await pool!.query(`INSERT INTO arden.knowledge_collection_document (organization_id, collection_id, published_version_id, ordinal)
        VALUES ($1, $2, $4, 0), ($1, $3, $4, 0), ($1, $2, $5, 1), ($1, $2, $6, 2)`,
      [org, folders[0]!.id, folders[1]!.id, common.id, restricted.id, newer.id]);
      const history = async () => (await pool!.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(pv) ORDER BY published_version_id)::text, '')) AS digest
        FROM arden.published_knowledge_version pv WHERE shared_draft_id IN
          (SELECT shared_draft_id FROM arden.shared_draft WHERE organization_id = $1)`, [org])).rows[0].digest;
      const before = await history();
      const client = await pool!.connect();
      try {
        const inventory = await inventoryCollectionLegacy(client, org);
        const plan: CollectionLegacyPlan = { organizationId: org, fingerprint: inventory.fingerprint,
          collections: inventory.collections.filter(item => item.allowedTypes === null).map(item => ({ id: item.id, allowedTypes: ["Guide"] })),
          documents: [...new Set(inventory.links.map(item => item.documentId))].map(documentId => ({ documentId,
            collectionId: documentId === common.draftId ? folders[0]!.id : documentId === newer.draftId ? newerFolder.id : null })) };
        const result = await migrateCollectionLegacy(client, plan, ownerMembership);
        expect(result.removedLinks).toBe(inventory.links.length);
        expect((await inventoryCollectionLegacy(client, org)).links).toEqual([]);
        await expect(migrateCollectionLegacy(client, plan, ownerMembership)).rejects.toThrow(/inventory changed/);
        expect(await history()).toBe(before);
        expect((await inventoryCollectionLegacy(client, org)).retainedTopics).toBe(inventory.retainedTopics);
        expect(await repository!.knowledgeCatalog.getPlacement(owner, org, common.draftId)).toMatchObject({ collectionId: folders[0]!.id });
        expect(await repository!.knowledgeCatalog.getPlacement(owner, org, newer.draftId)).toMatchObject({ collectionId: newerFolder.id, revision: 1 });
        expect((await repository!.knowledgeCatalog.list(member, org)).collections.find(item => item.id === folders[0]!.id)?.documentIds).toEqual([common.id]);
        expect(await repository!.getPublishedKnowledge(member, org, restricted.id)).toBeNull();
        expect(await repository!.getPublishedKnowledge(owner, org, restricted.id)).not.toBeNull();
      } finally { client.release(); }
    });

    it("refuses missing mappings and rolls back configuration, links and placements if the migration audit fails", async () => {
      const common = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const folder = (await pool!.query<{ id: string }>(`INSERT INTO arden.knowledge_collection (organization_id, name)
        VALUES ($1, $2) RETURNING collection_id AS id`, [org, `Rollback legacy ${randomUUID()}`])).rows[0]!;
      await pool!.query(`INSERT INTO arden.knowledge_collection_document (organization_id, collection_id, published_version_id, ordinal)
        VALUES ($1, $2, $3, 0)`, [org, folder.id, common.id]);
      const client = await pool!.connect();
      try {
        const inventory = await inventoryCollectionLegacy(client, org);
        const plan: CollectionLegacyPlan = { organizationId: org, fingerprint: inventory.fingerprint,
          collections: [{ id: folder.id, allowedTypes: ["Guide"] }], documents: [{ documentId: common.draftId, collectionId: folder.id }] };
        await expect(migrateCollectionLegacy(client, { ...plan, documents: [] }, ownerMembership)).rejects.toThrow(/exactly once/);
        await pool!.query(`ALTER TABLE arden.audit_event ADD CONSTRAINT test_collection_migration_audit_failure
          CHECK (organization_id <> '${org}'::uuid OR event_type <> 'KNOWLEDGE_COLLECTION_LEGACY_MIGRATED') NOT VALID`);
        try { await expect(migrateCollectionLegacy(client, plan, ownerMembership)).rejects.toMatchObject({ code: "23514" }); }
        finally { await pool!.query("ALTER TABLE arden.audit_event DROP CONSTRAINT test_collection_migration_audit_failure"); }
        expect(await inventoryCollectionLegacy(client, org)).toEqual(inventory);
        await expect(migrateCollectionLegacy(client, plan, memberId)).rejects.toThrow(/Admin attribution/);
        const lateSource = await publishCollectionFixture({ mode: "ORGANIZATION" });
        const writer = await pool!.connect();
        let pending: Promise<unknown> | undefined;
        try {
          const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
          await writer.query("BEGIN");
          await writer.query(`INSERT INTO arden.knowledge_collection_document (organization_id, collection_id, published_version_id, ordinal)
            VALUES ($1, $2, $3, 1)`, [org, folder.id, lateSource.id]);
          pending = migrateCollectionLegacy(client, plan, ownerMembership).then(() => null, error => error);
          await vi.waitFor(async () => {
            expect((await pool!.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid])).rows[0].wait_event_type).toBe("Lock");
          }, { timeout: 3000, interval: 20 });
          await writer.query("COMMIT");
          expect(await pending).toMatchObject({ message: "Legacy inventory changed; review a fresh plan" });
        } finally { await writer.query("ROLLBACK"); await pending; writer.release(); }
        const fresh = await inventoryCollectionLegacy(client, org);
        expect(fresh.links).toHaveLength(2);
        expect(fresh.collections.find(item => item.id === folder.id)?.allowedTypes).toBeNull();
        await migrateCollectionLegacy(client, { ...plan, fingerprint: fresh.fingerprint,
          documents: [...plan.documents, { documentId: lateSource.draftId, collectionId: folder.id }] }, ownerMembership);
      } finally { client.release(); }
    });
  });

  describe("P3B.1 flat-folder schema foundation", () => {
    it("keeps the trusted validator trigger-only with no runtime EXECUTE or publication-table write grants", async () => {
      const result = await pool!.query(`SELECT p.prosecdef, owner.rolname AS owner,
        has_function_privilege('arden_runtime', p.oid, 'EXECUTE') AS runtime_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles owner ON owner.oid = p.proowner
        WHERE n.nspname = 'arden' AND p.proname = 'validate_collection_placement'`);
      expect(result.rows).toEqual([{ prosecdef: true, owner: "postgres", runtime_execute: false }]);
      expect((await pool!.query("SELECT has_table_privilege('arden_runtime', 'arden.knowledge_current_publication', 'UPDATE') AS can_write")).rows)
        .toEqual([{ can_write: false }]);
    });
    it.each([{ value: [] }, { value: ["Unknown"] }, { value: ["Guide", "Guide"] }, { value: [null] },
      { value: [["Guide", "Procedure"]] }])("rejects invalid Allowed types $value", async ({ value: invalid }) => {
      const folder = await collectionFolder("Invalid types");
      await expect(runtimeCatalog(owner, true, client => client.query(
        "UPDATE arden.knowledge_collection SET allowed_types = $2::text[] WHERE collection_id = $1", [folder.id, invalid])))
        .rejects.toMatchObject({ code: "23514" });
    });

    it("enforces one folder, Admin-only writes, optimistic revisions and retained Unassigned tombstones", async () => {
      const source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const first = await collectionFolder("First"), second = await collectionFolder("Second");
      const insert = (folderId: string) => runtimeCatalog(owner, true, client => client.query(`INSERT INTO arden.knowledge_collection_placement
        (organization_id, shared_draft_id, collection_id) VALUES ($1, $2, $3) RETURNING placement_revision`, [org, source.draftId, folderId]));
      expect((await insert(first.id)).rows[0].placement_revision).toBe("1");
      await expect(insert(second.id)).rejects.toMatchObject({ code: "23505" });
      for (const actor of [member, foreign]) {
        expect((await runtimeCatalog(actor, false, client => client.query(
          "UPDATE arden.knowledge_collection_placement SET collection_id = NULL WHERE shared_draft_id = $1", [source.draftId]))).rowCount).toBe(0);
      }
      expect((await runtimeCatalog(foreign, false, client => client.query("SELECT * FROM arden.knowledge_collection_placement"))).rows).toEqual([]);
      const move = (revision: number, folderId: string | null) => runtimeCatalog(owner, true, client => client.query(`UPDATE arden.knowledge_collection_placement
        SET collection_id = $2 WHERE shared_draft_id = $1 AND placement_revision = $3 RETURNING placement_revision`, [source.draftId, folderId, revision]));
      expect((await move(1, second.id)).rows[0].placement_revision).toBe("2");
      expect((await move(1, null)).rowCount).toBe(0);
      expect((await move(2, null)).rows[0].placement_revision).toBe("3");
      expect((await move(3, second.id)).rows[0].placement_revision).toBe("4");
      const racing = await Promise.all([move(4, first.id), move(4, null)]);
      expect(racing.map(result => result.rowCount).sort()).toEqual([0, 1]);
      await expect(runtimeCatalog(owner, true, client => client.query(
        "DELETE FROM arden.knowledge_collection_placement WHERE shared_draft_id = $1", [source.draftId]))).rejects.toMatchObject({ code: "42501" });
    });

    it("rejects restricted, unpublished, wrong-Type and cross-organization placement", async () => {
      const folder = await collectionFolder("Eligibility");
      const source = await publishCollectionFixture({ mode: "DEPARTMENT", departmentId: department });
      const common = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const unpublished = await repository!.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership,
        title: "Unpublished Collection fixture", classification: "INTERNAL", idempotencyKey: randomUUID(),
        content: { sourceUri: "arden-private-object://unpublished-collection-fixture", mimeType: "text/plain", contentHash: "b".repeat(64) },
        requestId: "unpublished-collection" });
      if (unpublished.kind !== "created") throw new Error("Unpublished draft fixture failed");
      const wrong = await collectionFolder("Wrong type");
      await runtimeCatalog(owner, true, client => client.query("UPDATE arden.knowledge_collection SET allowed_types = ARRAY['Procedure'] WHERE collection_id = $1", [wrong.id]));
      for (const [documentId, collectionId, organizationId] of [[source.draftId, folder.id, org], [unpublished.draft.id, folder.id, org], [randomUUID(), folder.id, org],
        [common.draftId, wrong.id, org], [common.draftId, folder.id, randomUUID()]]) {
        await expect(runtimeCatalog(owner, true, client => client.query(`INSERT INTO arden.knowledge_collection_placement
          (organization_id, shared_draft_id, collection_id) VALUES ($1, $2, $3)`, [organizationId, documentId, collectionId])))
          .rejects.toMatchObject({ code: "23514" });
      }
    });

    it("detaches on Archive or allowed-Type narrowing without withdrawing the source", async () => {
      for (const change of ["archive", "types"]) {
        const source = await publishCollectionFixture({ mode: "ORGANIZATION" });
        const folder = await collectionFolder("Detach");
        await runtimeCatalog(owner, true, client => client.query(`INSERT INTO arden.knowledge_collection_placement
          (organization_id, shared_draft_id, collection_id) VALUES ($1, $2, $3)`, [org, source.draftId, folder.id]));
        await runtimeCatalog(owner, true, client => client.query(change === "archive"
          ? "UPDATE arden.knowledge_collection SET status = 'INACTIVE' WHERE collection_id = $1"
          : "UPDATE arden.knowledge_collection SET allowed_types = ARRAY['Procedure'] WHERE collection_id = $1", [folder.id]));
        expect((await pool!.query("SELECT collection_id, placement_revision FROM arden.knowledge_collection_placement WHERE shared_draft_id = $1", [source.draftId])).rows)
          .toEqual([{ collection_id: null, placement_revision: "2" }]);
        expect(await repository!.getPublishedKnowledge(member, org, source.id)).not.toBeNull();
      }
    });

    it("follows eligible activated versions and detaches an incompatible replacement without rewriting history", async () => {
      const repo = repository!, source = await publishCollectionFixture({ mode: "ORGANIZATION" });
      const folder = await collectionFolder("Versions");
      await runtimeCatalog(owner, true, client => client.query(`INSERT INTO arden.knowledge_collection_placement
        (organization_id, shared_draft_id, collection_id) VALUES ($1, $2, $3)`, [org, source.draftId, folder.id]));
      for (const [revision, type] of [[2, "Guide"], [3, "Procedure"]] as const) {
        const saved = await repo.updateKnowledgeDraft(owner, org, source.draftId, revision, { management: {
          type, version: `${revision}.0`, effectiveDate: null, expirationDate: null, changeNote: "Updated controlled guidance" },
        }, null, "folder-version-save");
        if (saved.kind !== "updated") throw new Error("Replacement save failed");
        const submitted = await repo.submitKnowledgeDraft(owner, org, source.draftId, revision + 1, randomUUID(), "folder-version-submit");
        if (submitted.kind !== "submitted") throw new Error("Replacement submit failed");
        await repo.decideReview(owner, org, submitted.submission.id, "APPROVE", submitted.submission.snapshotVersionId,
          submitted.submission.contentHash, null, randomUUID(), "folder-version-approve");
        const id = await activateFixture();
        expect(await repo.getPublishedKnowledge(member, org, id)).not.toBeNull();
        const visibleFolder = (await repo.knowledgeCatalog.list(member, org)).collections.find(item => item.id === folder.id);
        expect(visibleFolder?.documentIds ?? []).toEqual(type === "Guide" ? [id] : []);
        const placement = (await pool!.query("SELECT collection_id FROM arden.knowledge_collection_placement WHERE shared_draft_id = $1", [source.draftId])).rows[0];
        expect(placement.collection_id).toBe(type === "Guide" ? folder.id : null);
      }
      expect((await pool!.query("SELECT count(*) FROM arden.published_knowledge_version WHERE shared_draft_id = $1", [source.draftId])).rows[0].count).toBe("3");
    });
  });
});
}
