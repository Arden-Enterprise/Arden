import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArdenRepository } from "../db/repository.js";
import { PgIndexGenerationStore } from "../indexing/store.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import type { TargetReadersInput } from "../target-readers/policy.js";
import type { ReaderSourceResponse } from "../reader-ai/contracts.js";
import { ReaderSourcePreparation } from "../reader-ai/source-preparation.js";
import { ReaderSummary } from "../reader-ai/summary.js";
import { ReaderQuestion } from "../reader-ai/question.js";
import type { EvidenceReference, VersionScope } from "./governed-contracts.js";

const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;
const repo = pool ? new ArdenRepository(pool) : null;
const owner = randomUUID(), member = randomUUID(), other = randomUUID();
const memberId = randomUUID(), otherId = randomUUID();
let org = "", ownerMembership = "", draftId = "", version = 1, topicId = "";
const date = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// All publication tests share the worker queue and are deliberately registered in
// one suite, not raced in independent files against a common disposable database.
export function registerGovernedAnsweringVerification() {
describe.skipIf(!pool)("governed AI temporal sources and private history with real RLS", () => {
  beforeAll(async () => {
    const identity = await pool!.query("SELECT current_database() AS name, rolsuper FROM pg_roles WHERE rolname = current_user");
    if (!identity.rows[0]?.name.startsWith("arden_test_") || !identity.rows[0]?.rolsuper) throw new Error("Disposable superuser fixture database required");
    const created = await repo!.createOrganization(owner, `${owner}@example.test`, "AI fixture owner",
      { name: `AI QA ${owner}`, departmentName: "Engineering" }, "ai-fixture");
    org = created.organizationId;
    ownerMembership = (await repo!.requireActiveMembership(owner, org))!.membershipId;
    for (const [user, membership] of [[member, memberId], [other, otherId]]) {
      await pool!.query("INSERT INTO arden.user_account(user_id,email,full_name) VALUES ($1,$2,'AI reader')", [user, `${user}@example.test`]);
      await pool!.query("INSERT INTO arden.organization_membership(membership_id,organization_id,user_id) VALUES ($1,$2,$3)", [membership, org, user]);
    }
    topicId = (await repo!.knowledgeCatalog.write(owner, org, "topics", null, null,
      { name: "AI fixtures", description: "", status: "ACTIVE" }, "ai-topic")).id;
    const draft = await repo!.createNewKnowledgeDraft(owner, org, { actorMembershipId: ownerMembership, title: "Temporal guide",
      classification: "INTERNAL", idempotencyKey: randomUUID(), content: { sourceUri: "arden-private-object://ai-fixture",
        mimeType: "text/plain", contentHash: "a".repeat(64) }, requestId: "ai-create" });
    if (draft.kind !== "created") throw new Error("Draft fixture failed");
    draftId = draft.draft.id;
  });

  afterAll(async () => {
    if (!pool) return;
    if (org) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL search_path TO arden, public");
        // Synthetic fixture only; no production cleanup path uses trigger suppression.
        await client.query("SET LOCAL session_replication_role = replica");
        for (const table of ["ai_turn_evidence", "ai_conversation_turn", "ai_conversation", "knowledge_ai_release"])
          await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org]);
        await client.query("DELETE FROM knowledge_index_job WHERE generation_id IN (SELECT generation_id FROM knowledge_index_generation WHERE organization_id=$1)", [org]);
        await client.query("DELETE FROM review_decision WHERE submission_id IN (SELECT submission_id FROM shared_submission WHERE organization_id=$1)", [org]);
        await client.query("DELETE FROM shared_draft_version WHERE shared_draft_id=$1", [draftId]);
        await client.query("DELETE FROM published_knowledge_version WHERE shared_draft_id=$1", [draftId]);
        for (const table of ["knowledge_collection_document", "knowledge_collection", "knowledge_current_publication",
          "knowledge_index_generation", "shared_submission", "shared_draft_audience", "shared_draft",
          "selected_reader", "reader_selection", "knowledge_topic", "knowledge_base", "audit_event", "audience_group_membership", "audience", "reviewer_grant"])
          await client.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
        for (const table of ["department_membership", "role_assignment"])
          await client.query(`DELETE FROM ${table} WHERE membership_id IN (SELECT membership_id FROM organization_membership WHERE organization_id=$1)`, [org]);
        await client.query("DELETE FROM role_permission WHERE role_id IN (SELECT role_id FROM role WHERE organization_id=$1)", [org]);
        for (const table of ["organization_membership", "department", "role", "access_scope", "organization"])
          await client.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
        await client.query("DELETE FROM user_account WHERE user_id=ANY($1::uuid[])", [[owner, member, other]]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await pool.end();
  });

  async function publish(effectiveDate: string, readers: TargetReadersInput = { mode: "ORGANIZATION" }, expirationDate: string | null = null) {
    const updated = await repo!.updateKnowledgeDraft(owner, org, draftId, version, {
      management: { type: "Guide", topicId, version: `${version}.0`, effectiveDate, expirationDate,
        changeNote: version > 1 ? "Updated guidance." : "" }, targetReaders: readers,
    }, null, "ai-update");
    if (updated.kind !== "updated") throw new Error(`Update fixture failed: ${updated.kind}`);
    version = updated.draft.currentVersion;
    const submission = await repo!.submitKnowledgeDraft(owner, org, draftId, version, randomUUID(), "ai-submit");
    if (submission.kind !== "submitted") throw new Error(`Submit fixture failed: ${submission.kind}`);
    const decision = await repo!.decideReview(owner, org, submission.submission.id, "APPROVE", submission.submission.snapshotVersionId,
      submission.submission.contentHash, null, randomUUID(), "ai-approve");
    expect(decision.kind).toBe("decided");
    const indexing = new PgIndexGenerationStore(pool!); const worker = randomUUID();
    const job = await indexing.claim(worker, 120);
    if (!job || job.submissionId !== submission.submission.id) throw new Error("Unexpected fixture job");
    const text = "Use MFA for every sign-in.";
    const chunk = { chunkId: createHash("sha256").update(job.generationId).digest("hex"), ordinal: 0,
      contentHash: createHash("sha256").update(text).digest("hex"), startOffset: 0, endOffset: text.length,
      sourceBlockIds: ["body"], parentSectionBlockId: null };
    const manifest: IndexGenerationManifest = { contractVersion: 1, jobId: job.jobId, generationId: job.generationId,
      snapshotVersionId: job.snapshotVersionId, snapshotContentHash: job.snapshotContentHash, compilerVersion: "semantic-markdown-v1",
      chunkingVersion: "langchain-section-token-v1", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
      markdownContentHash: createHash("sha256").update(text).digest("hex"),
      chunksDigest: createHash("sha256").update(JSON.stringify([chunk], Object.keys(chunk).sort())).digest("hex"), chunks: [chunk] };
    const publishedVersionId = await indexing.complete(job, worker, manifest);
    const reference: EvidenceReference = { generationId: job.generationId, publishedVersionId,
      snapshotVersionId: job.snapshotVersionId, snapshotContentHash: job.snapshotContentHash, chunkId: chunk.chunkId };
    return reference;
  }
  const sources = async (user: string, scope: VersionScope) =>
    (await repo!.listAuthorizedAiSources(user, org, undefined, undefined, scope))!.filter(source => source.draftId === draftId);

  it("selects currently applicable versus announced sources; denies fallback after expiry/ACL and after withdrawal", async () => {
    const baseline = await publish(date(-20));
    const announced = await publish(date(20));
    // Reader preparation resolves exactly the requested eligible version; no default substitution.
    expect((await repo!.readerSources.resolve(member, org, baseline.publishedVersionId))?.source.generationId).toBe(baseline.generationId);
    expect((await repo!.readerSources.resolve(member, org, announced.publishedVersionId))?.source.generationId).toBe(announced.generationId);
    expect(await repo!.readerSources.resolve(member, randomUUID(), announced.publishedVersionId)).toBeNull();
    expect(await repo!.readerSources.resolve(member, org, randomUUID())).toBeNull();
    expect((await sources(member, "CURRENT")).map(s => s.publishedVersionId)).toEqual([baseline.publishedVersionId]);
    expect((await sources(member, "UPCOMING")).map(s => s.publishedVersionId)).toEqual([announced.publishedVersionId]);
    expect((await sources(member, "COMPARE")).map(s => s.publishedVersionId).sort()).toEqual([baseline.publishedVersionId, announced.publishedVersionId].sort());
    // Exact older applicable citation/file route remains readable, not all old versions.
    expect(await repo!.getPublishedKnowledge(member, org, baseline.publishedVersionId)).not.toBeNull();
    const restricted = await publish(date(-1), { mode: "SELECTED_MEMBERS", memberIds: [memberId, otherId] });
    expect(await sources(owner, "CURRENT")).toEqual([]); // Org Admin is not an automatic reader.
    expect(await repo!.readerSources.resolve(owner, org, restricted.publishedVersionId)).toBeNull();
    expect(await repo!.readerSources.resolve(member, org, restricted.publishedVersionId)).not.toBeNull();
    expect(await repo!.readerSources.resolve(member, org, baseline.publishedVersionId)).toBeNull();
    expect((await sources(member, "CURRENT")).map(s => s.publishedVersionId)).toEqual([restricted.publishedVersionId]);
    expect(await repo!.getPublishedKnowledge(owner, org, baseline.publishedVersionId)).toBeNull();
    const expired = await publish(date(-4), { mode: "ORGANIZATION" }, date(-2));
    expect(await repo!.readerSources.resolve(member, org, expired.publishedVersionId)).toBeNull();
    expect(await sources(member, "CURRENT")).toEqual([]); // no resurrection of a readable older policy
    await pool!.query("DELETE FROM arden.knowledge_current_publication WHERE shared_draft_id=$1", [draftId]);
    expect(await repo!.readerSources.resolve(member, org, restricted.publishedVersionId)).toBeNull();
    expect(await sources(member, "COMPARE")).toEqual([]);
    await publish(date(30));
    expect(await sources(member, "CURRENT")).toEqual([]); // new release epoch has no inherited baseline
    expect(await repo!.getPublishedKnowledge(member, org, baseline.publishedVersionId)).toBeNull();
  }, 30_000);

  it("persists private turns atomically under runtime RLS, rejects stale evidence and serializes writers", async () => {
    const ref = await publish(date(-1));
    const conversations = repo!.conversations, id = randomUUID();
    await conversations.ensure(member, org, id, "My private question");
    expect(await conversations.load(owner, org, id)).toBeNull();
    expect(await conversations.list(owner, org)).toEqual([]);
    await expect(conversations.ensure(owner, org, id, "Cannot take over")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const turn = { id: randomUUID(), requestId: randomUUID(), question: "MFA?", answer: "Use MFA.",
      status: "ANSWERED" as const, versionScope: "CURRENT" as const, citations: [], evidence: [ref] };
    const attempts = await Promise.allSettled([conversations.append(member, org, id, 0, turn),
      conversations.append(member, org, id, 0, { ...turn, id: randomUUID(), requestId: randomUUID() })]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await conversations.load(member, org, id))?.turns).toHaveLength(1);
    const before = await conversations.load(member, org, id);
    // The second duplicate reference fails after the turn and first reference
    // were inserted. The whole real transaction must roll back, including revision.
    await expect(conversations.append(member, org, id, 1, { ...turn, id: randomUUID(), requestId: randomUUID(),
      evidence: [ref, ref] })).rejects.toMatchObject({ code: "23505" });
    expect(await conversations.load(member, org, id)).toEqual(before);
    await expect(conversations.append(member, org, id, 1, { ...turn, id: randomUUID(), requestId: randomUUID(),
      evidence: [{ ...ref, snapshotContentHash: "0".repeat(64) }] })).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(await conversations.load(member, org, id)).toEqual(before);
    await pool!.query("UPDATE arden.organization_membership SET status='SUSPENDED' WHERE membership_id=$1", [memberId]);
    expect(await repo!.readerSources.resolve(member, org, ref.publishedVersionId)).toBeNull();
    expect(await conversations.load(member, org, id)).toBeNull();
    expect(await repo!.listAuthorizedAiSources(member, org)).toBeNull();
    await pool!.query("UPDATE arden.organization_membership SET status='ACTIVE' WHERE membership_id=$1", [memberId]);
    expect((await conversations.load(member, org, id))?.revision).toBe(1);
    await pool!.query("UPDATE arden.user_account SET status='DISABLED' WHERE user_id=$1", [member]);
    expect(await conversations.load(member, org, id)).toBeNull();
    await pool!.query("UPDATE arden.user_account SET status='ACTIVE' WHERE user_id=$1", [member]);
  }, 30_000);

  it("withholds exact-document Q&A after real runtime membership revocation without storing turns", async () => {
    const ref = await publish(date(-1)), requestId = randomUUID();
    const historyBefore = await repo!.conversations.list(member, org);
    const record = await repo!.readerSources.resolve(member, org, ref.publishedVersionId);
    if (!record) throw new Error("Reader source fixture unavailable");
    const unused = async (): Promise<never> => { throw new Error("Q&A must not read storage or prepare Summary"); };
    const gate = new ReaderSourcePreparation(repo!, repo!.readerSources, { read: unused, readPdf: unused }, null);
    const text = "Use MFA for every sign-in.", chunk = record.manifest.chunks[0];
    const ai = {
      retrieve: async (input: { requestId: string; query: string }) => ({ contractVersion: 2 as const, requestId: input.requestId,
        standaloneQuery: input.query, retrievalMode: "HYBRID" as const, evidence: [{ chunkId: chunk.chunkId,
          contentHash: chunk.contentHash, content: text, startOffset: chunk.startOffset, endOffset: chunk.endOffset,
          sourceBlockIds: chunk.sourceBlockIds, parentSectionBlockId: chunk.parentSectionBlockId, label: "fixture",
          generationId: ref.generationId, snapshotVersionId: ref.snapshotVersionId, snapshotContentHash: ref.snapshotContentHash }] }),
      generate: async () => ({ contractVersion: 2 as const, requestId, status: "ANSWERED" as const, answer: "Use MFA.",
        usedEvidence: [chunk.chunkId], citations: [{ chunkId: chunk.chunkId, quote: text }] }),
    };
    expect((await new ReaderQuestion(gate, ai).answer(member, org, ref.publishedVersionId, requestId, "How to sign in?")).citations[0].versionId).toBe(ref.publishedVersionId);
    const revoked = new ReaderQuestion(gate, { ...ai, generate: async () => {
      await pool!.query("UPDATE arden.organization_membership SET status='SUSPENDED' WHERE membership_id=$1", [memberId]);
      return ai.generate();
    } });
    try {
      await expect(revoked.answer(member, org, ref.publishedVersionId, requestId, "How to sign in?")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(new ReaderQuestion(gate, ai).answer(member, org, ref.publishedVersionId, requestId, "q")).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally { await pool!.query("UPDATE arden.organization_membership SET status='ACTIVE' WHERE membership_id=$1", [memberId]); }
    expect(await repo!.conversations.list(member, org)).toEqual(historyBefore);
  }, 30_000);

  it("withholds Reader Summary after real runtime membership revocation during fake generation", async () => {
    const ref = await publish(date(-1)), requestId = randomUUID();
    const historyBefore = await repo!.conversations.list(member, org);
    const record = await repo!.readerSources.resolve(member, org, ref.publishedVersionId);
    if (!record) throw new Error("Reader source fixture unavailable");
    const manifest = record.manifest, text = "Use MFA for every sign-in.";
    const prepared: ReaderSourceResponse = { contractVersion: 1, purpose: "READER_SUMMARY", requestId,
      organizationId: org, publishedVersionId: ref.publishedVersionId, generationId: ref.generationId,
      snapshotVersionId: ref.snapshotVersionId, snapshotContentHash: ref.snapshotContentHash,
      compilerVersion: manifest.compilerVersion, chunkingVersion: manifest.chunkingVersion,
      markdownContentHash: manifest.markdownContentHash, chunksDigest: manifest.chunksDigest,
      markdown: text, chunks: manifest.chunks.map(chunk => ({ ...chunk, content: text })) };
    const unused = async (): Promise<never> => { throw new Error("Preparation adapter must not run in this RLS-only test"); };
    const gate = new ReaderSourcePreparation(repo!, repo!.readerSources, { read: unused, readPdf: unused }, { prepareReaderSource: unused });
    expect(await gate.checkAccess(member, org, ref.publishedVersionId)).toEqual({ documentId: record.documentId,
      versionId: ref.publishedVersionId, contentHash: record.source.snapshotContentHash });
    await expect(gate.checkAccess(member, randomUUID(), ref.publishedVersionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const source = { checkAccess: gate.checkAccess.bind(gate), revalidate: gate.revalidate.bind(gate),
      prepare: async () => structuredClone(prepared) };
    const output = { ...prepared, status: "COMPLETED", coverage: [{ startOffset: 0, endOffset: text.length }],
      usedChunkIds: prepared.chunks.map(chunk => chunk.chunkId), points: [{ kind: "KEY_POINT", text: "Use MFA.",
        citations: [{ chunkId: prepared.chunks[0].chunkId, quote: text }] }] };
    const { compilerVersion: _compiler, chunkingVersion: _chunker, markdown: _text, chunks: _chunks, ...response } = output;
    const allowed = new ReaderSummary(source, { summarizeReaderSource: async () => response });
    expect((await allowed.summarize(member, org, ref.publishedVersionId, requestId)).points[0].citations[0].versionId).toBe(ref.publishedVersionId);
    const revoked = new ReaderSummary(source, { summarizeReaderSource: async () => {
      await pool!.query("UPDATE arden.organization_membership SET status='SUSPENDED' WHERE membership_id=$1", [memberId]);
      return response;
    } });
    try {
      await expect(revoked.summarize(member, org, ref.publishedVersionId, requestId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(gate.checkAccess(member, org, ref.publishedVersionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await pool!.query("UPDATE arden.organization_membership SET status='ACTIVE' WHERE membership_id=$1", [memberId]);
    }
    expect(await repo!.conversations.list(member, org)).toEqual(historyBefore); // Summary never appends chat history.
  }, 30_000);
});
}
