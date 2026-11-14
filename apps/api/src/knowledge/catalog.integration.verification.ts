import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { PgIndexGenerationStore } from "../indexing/store.js";
import { CatalogError } from "./catalog-store.js";

const url = process.env.ARDEN_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
const repository = pool ? new ArdenRepository(pool) : null;
const owner = randomUUID(), member = randomUUID(), memberId = randomUUID(), foreign = randomUUID();
const colleague = randomUUID(), colleagueId = randomUUID();
let org = "", department = "", ownerMembership = "", draftId = "";

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
        await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id = $1", [draftId || randomUUID()]);
        await client.query("DELETE FROM published_knowledge_version WHERE shared_draft_id = $1", [draftId || randomUUID()]);
        await client.query("DELETE FROM knowledge_index_job WHERE generation_id IN (SELECT generation_id FROM knowledge_index_generation WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM review_decision WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id = $1)", [org]);
        for (const table of ["knowledge_ai_release", "knowledge_collection_document", "knowledge_collection", "knowledge_current_publication", "knowledge_index_generation",
          "shared_submission", "shared_draft_audience", "shared_draft", "selected_reader", "reader_selection", "knowledge_topic", "knowledge_base",
          "audit_event", "audience_group_membership", "audience", "reviewer_grant"]) {
          await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
        }
        await client.query("DELETE FROM department_membership WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM role_assignment WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id = $1)", [org]);
        await client.query("DELETE FROM role_permission WHERE role_id IN (SELECT role_id FROM role WHERE organization_id = $1)", [org]);
        for (const table of ["organization_membership", "department", "role", "access_scope", "organization"]) await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
        await client.query("DELETE FROM user_account WHERE user_id = ANY($1::uuid[])", [[owner, member, colleague]]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await pool.end();
  });

  it("enforces catalog ownership, stale writes, submit fields, frozen snapshots and reader-only curation", async () => {
    const repo = repository!, catalog = repo.knowledgeCatalog;
    await expect(catalog.write(member, org, "topics", null, null, { name: "Denied", description: "", status: "ACTIVE" }, "denied"))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(catalog.list(foreign, org)).rejects.toBeInstanceOf(CatalogError);
    const topic = await catalog.write(owner, org, "topics", null, null,
      { name: "Engineering practice", description: "", status: "ACTIVE" }, "create-topic");
    await expect(catalog.write(owner, org, "topics", null, null,
      { name: " engineering PRACTICE ", description: "", status: "ACTIVE" }, "duplicate")).rejects.toMatchObject({ code: "DUPLICATE" });
    const races = await Promise.allSettled(["A", "B"].map(suffix => catalog.write(owner, org, "topics", topic.id, topic.version,
      { name: `Engineering practice ${suffix}`, description: "", status: "ACTIVE" }, "race")));
    expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(races.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["CONFLICT"]);
    const activeTopic = (await catalog.list(member, org)).topics[0]!;
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
    const metadata = { type: "Guide" as const, topicId: activeTopic.id, version: "1.0", effectiveDate: "2027-01-01", expirationDate: null, changeNote: "" };
    await expect(repo.updateKnowledgeDraft(owner, org, draftId, 1, { management: { ...metadata, expirationDate: "2026-01-01" } }, null, "invalid-date"))
      .resolves.toEqual({ kind: "invalid-metadata" });
    const saved = await repo.updateKnowledgeDraft(owner, org, draftId, 1, { management: metadata, targetReaders: { mode: "ORGANIZATION" } }, null, "save");
    expect(saved.kind).toBe("updated");
    const legacyDowngrade = await repo.updateKnowledgeDraft(owner, org, draftId, 2, {
      targetScopeType: "DEPARTMENT", audienceRoleIds: [], teamTag: "misroute-review",
    }, null, "legacy-downgrade");
    expect(legacyDowngrade).toMatchObject({ kind: "updated", draft: { targetScopeType: "ORGANIZATION", teamTag: null } });
    const renamedTopic = await catalog.write(owner, org, "topics", activeTopic.id, activeTopic.version,
      { name: "Current topic name", description: "", status: "ACTIVE" }, "rename-before-submit");
    const submitted = await repo.submitKnowledgeDraft(owner, org, draftId, 3, randomUUID(), "submit");
    if (submitted.kind !== "submitted") throw new Error("Submission fixture failed");
    expect(submitted.submission.management).toMatchObject({ ...metadata, topicName: renamedTopic.name, releaseKind: "NEW" });
    const changed = await repo.updateKnowledgeDraft(owner, org, draftId, 3, { management: { ...metadata, version: "9.0" } }, null, "edit-pending");
    expect(changed.kind).toBe("updated");
    expect((await repo.listKnowledgeSubmissions(owner, org))![0]!.management?.version).toBe("1.0");
    const locked = await pool!.connect();
    try { await locked.query("BEGIN"); await expect(locked.query("UPDATE arden.shared_submission SET management = '{}' WHERE submission_id = $1", [submitted.submission.id])).rejects.toMatchObject({ code: "55000" }); }
    finally { await locked.query("ROLLBACK"); locked.release(); }
    const decision = await repo.decideReview(owner, org, submitted.submission.id, "APPROVE", submitted.submission.snapshotVersionId,
      submitted.submission.contentHash, null, randomUUID(), "approve");
    expect(decision.kind).toBe("decided");
    const indexing = new PgIndexGenerationStore(pool!); const worker = randomUUID();
    const activate = async () => {
    const job = await indexing.claim(worker, 90); if (!job) throw new Error("No index fixture job");
    return indexing.complete(job, worker, { contractVersion: 1, jobId: job.jobId, generationId: job.generationId,
      snapshotVersionId: job.snapshotVersionId, snapshotContentHash: job.snapshotContentHash, compilerVersion: "semantic-markdown-v1",
      chunkingVersion: "langchain-section-token-v1", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
      markdownContentHash: "d".repeat(64), chunksDigest: "e".repeat(64), chunks: [{ chunkId: "f".repeat(64), ordinal: 0,
        contentHash: "1".repeat(64), startOffset: 0, endOffset: 10, sourceBlockIds: ["body"], parentSectionBlockId: null }] });
    };
    const publicationId = await activate();
    const publication = await repo.getPublishedKnowledge(member, org, publicationId);
    // Decision 0021: no Document Code is returned.
    expect(publication).toMatchObject({ management: { version: "1.0", effectiveDate: "2027-01-01" } });
    expect(publication).not.toHaveProperty("documentCode");
    const collection = await catalog.write(owner, org, "collections", null, null, { name: "Engineering handbook", description: "",
      status: "ACTIVE", cover: "production", documentIds: [publicationId] }, "curate");
    expect((await catalog.list(member, org)).collections[0]!.documentIds).toEqual([publicationId]);
    await expect(catalog.write(owner, org, "collections", null, null, { name: "Unavailable source", description: "", status: "ACTIVE",
      documentIds: [randomUUID()] }, "bad-source")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await pool!.query("UPDATE arden.organization_membership SET status = 'SUSPENDED' WHERE membership_id = $1", [memberId]);
    await expect(catalog.list(member, org)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await pool!.query("UPDATE arden.organization_membership SET status = 'ACTIVE' WHERE membership_id = $1", [memberId]);
    await catalog.write(owner, org, "collections", collection.id, collection.version, { name: "Engineering handbook", description: "",
      status: "INACTIVE", cover: "production", documentIds: [publicationId] }, "deactivate");
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
    const restrictedId = await activate();
    expect(await repo.getPublishedKnowledge(owner, org, restrictedId)).toBeNull();
    expect(await repo.getPublishedKnowledge(member, org, restrictedId)).not.toBeNull();
    expect((await catalog.list(owner, org)).canManage).toBe(true);
    expect((await catalog.list(owner, org)).collections).toEqual([]);
    await expect(catalog.write(owner, org, "collections", null, null, { name: "Denied real source", description: "",
      status: "ACTIVE", documentIds: [restrictedId] }, "denied-curation")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(department).toBeTruthy();
  });
});
}
