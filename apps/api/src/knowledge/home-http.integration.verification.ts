import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { AuthProvider, AuthSessionTokens } from "../auth/provider.js";
import type { ArdenRepository } from "../db/repository.js";
import { PgIndexGenerationStore } from "../indexing/store.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import { LocalPrivateContentStorage } from "../private-notes/content-storage.js";
import type { ReaderAiClient } from "../reader-ai/summary.js";
import type { AskArdenClient } from "../answers/ai-client.js";
import type { TargetReadersInput } from "../target-readers/policy.js";

type Context = { pool: Pool; repository: ArdenRepository; organization: string;
  owner: string; member: string; memberId: string; colleague: string; colleagueId: string; department: string };
type Json = Record<string, unknown>;
const text = "Confirm access with your own account before requesting changes.";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function record(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
  return value as Json;
}
function string(row: Json, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`Missing string: ${key}`);
  return row[key];
}
function rows(row: Json): Json[] {
  if (!Array.isArray(row.items)) throw new Error("Expected items array");
  return row.items.map(record);
}

/** Registered inside the existing catalog fixture: one disposable DB/worker queue,
 * real Fastify TCP/cookies/repository/RLS/storage; only identity and AI are doubles. */
export function registerHomeHttpVerification(context: () => Context) {
  describe("KM2 complete HTTP-to-PostgreSQL knowledge paths", () => {
    let app: ReturnType<typeof buildApp>, storage: LocalPrivateContentStorage;
    let address = "", contentRoot = "";
    const sessions = new Map<string, string>(), cookies = new Map<string, string>();
    const manifests = new Map<string, IndexGenerationManifest>();
    let summaryCalls = 0, retrievalCalls = 0;
    let duringSummary: (() => Promise<void>) | null = null;
    let duringAnswer: (() => Promise<void>) | null = null;

    async function request(user: string | null, path: string, status = 200,
      method = "GET", payload?: object, headers: Record<string, string> = {}) {
      const response = await fetch(`${address}${path}`, { method, signal: AbortSignal.timeout(15_000),
        headers: { origin: address, ...(user ? { cookie: cookies.get(user)! } : {}),
          ...(payload ? { "content-type": "application/json" } : {}), ...headers },
        ...(payload ? { body: JSON.stringify(payload) } : {}) });
      const raw = await response.text();
      const body: unknown = raw ? JSON.parse(raw) : {};
      expect(response.status, `${method} ${path}: ${JSON.stringify(body)}`).toBe(status);
      return { body: record(body), headers: response.headers };
    }
    const base = () => `/api/v1/organizations/${context().organization}`;
    const knowledge = () => `${base()}/knowledge`;
    const published = (id: string) => `${knowledge()}/published/${id}`;
    async function login(user: string) {
      const result = await request(null, "/api/v1/auth/sign-in", 200, "POST", {
        email: `${user}@example.test`, password: "synthetic-local-only" });
      cookies.set(user, result.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; "));
      expect(cookies.get(user)).toContain("arden");
    }
    async function create(readers: TargetReadersInput) {
      const { owner } = context();
      const created = await request(owner, `${knowledge()}/drafts/new`, 201, "POST", { title: "HTTP controlled guide", body: text },
        { "idempotency-key": randomUUID() });
      const id = string(created.body, "id");
      const saved = await request(owner, `${knowledge()}/drafts/${id}`, 200, "PATCH", {
        targetReaders: readers, management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
      }, { "if-match": created.headers.get("etag")! });
      const submission = await request(owner, `${knowledge()}/drafts/${id}/submit`, 201, "POST", undefined,
        { "if-match": saved.headers.get("etag")!, "idempotency-key": randomUUID() });
      return { id, saved, submission: submission.body };
    }
    async function approve(submission: Json) {
      return request(context().owner, `${knowledge()}/reviews/${string(submission, "id")}/decisions`, 201, "POST", {
        action: "APPROVE", expectedSnapshotVersionId: string(submission, "snapshotVersionId"),
        expectedContentHash: string(submission, "contentHash"),
      }, { "idempotency-key": randomUUID() });
    }
    async function activate() {
      const store = new PgIndexGenerationStore(context().pool), worker = randomUUID();
      const job = await store.claim(worker, 90);
      if (!job) throw new Error("Missing approved worker job");
      const manifest: IndexGenerationManifest = { contractVersion: 1, usageContractVersion: 1, usageEvents: [],
        jobId: job.jobId, generationId: job.generationId,
        snapshotVersionId: job.snapshotVersionId, snapshotContentHash: job.snapshotContentHash,
        compilerVersion: "semantic-markdown-v1", chunkingVersion: "langchain-section-token-v1",
        embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
        markdownContentHash: digest(text), chunksDigest: "", chunks: [{
          chunkId: digest(job.generationId), ordinal: 0, contentHash: digest(text), startOffset: 0, endOffset: text.length,
          sourceBlockIds: ["body"], parentSectionBlockId: null }] };
      manifest.chunksDigest = digest(JSON.stringify(manifest.chunks, Object.keys(manifest.chunks[0]).sort()));
      const id = await store.complete(job, worker, manifest);
      manifests.set(job.generationId, manifest);
      return id;
    }
    async function publish(readers: TargetReadersInput) {
      const draft = await create(readers); await approve(draft.submission);
      return { ...draft, publication: await activate() };
    }

    beforeAll(async () => {
      const ctx = context();
      const identity = await ctx.pool.query("SELECT current_database() AS name");
      if (!identity.rows[0]?.name.startsWith("arden_test_")) throw new Error("Disposable test DB required");
      contentRoot = await mkdtemp(join(tmpdir(), "arden-km2-http-"));
      storage = new LocalPrivateContentStorage(contentRoot);
      const users = [ctx.owner, ctx.member, ctx.colleague];
      const auth: AuthProvider = {
        async signIn(input) {
          const user = users.find(id => input.email === `${id}@example.test`);
          if (!user || input.password !== "synthetic-local-only") throw new Error("INVALID_CREDENTIALS");
          const tokens: AuthSessionTokens = { accessToken: randomUUID(), refreshToken: randomUUID(), expiresIn: 3600 };
          sessions.set(tokens.accessToken, user);
          return { userId: user, email: input.email, fullName: "Synthetic HTTP actor", tokens };
        },
        async resolveSession(tokens) {
          const user = sessions.get(tokens.accessToken);
          return user ? { kind: "authenticated", userId: user, email: `${user}@example.test`, fullName: "Synthetic HTTP actor",
            emailVerified: true, passwordSetupRequired: false } : { kind: "unauthenticated" };
        },
        async signOut(tokens) { sessions.delete(tokens.accessToken); },
        async signUp() { throw new Error("Not supported by isolated test identity provider"); },
      };
      const readerAi: ReaderAiClient = {
        async prepareReaderSource(request) {
          const manifest = manifests.get(request.snapshot.generationId);
          if (!manifest) throw new Error("Unexpected generation");
          return { contractVersion: 1, purpose: "READER_SUMMARY", requestId: request.requestId,
            organizationId: request.snapshot.organizationId, publishedVersionId: request.publishedVersionId,
            generationId: manifest.generationId, snapshotVersionId: manifest.snapshotVersionId,
            snapshotContentHash: manifest.snapshotContentHash, compilerVersion: manifest.compilerVersion,
            chunkingVersion: manifest.chunkingVersion, markdownContentHash: manifest.markdownContentHash,
            chunksDigest: manifest.chunksDigest, markdown: text, chunks: manifest.chunks.map(chunk => ({ ...chunk, content: text })) };
        },
        async summarizeReaderSource(source) {
          summaryCalls++; await duringSummary?.();
          const { compilerVersion: _compiler, chunkingVersion: _chunker, markdown: _markdown, chunks: _chunks, ...identity } = source;
          return { ...identity, usageContractVersion: 1, usageEvents: [], status: "COMPLETED",
            coverage: [{ startOffset: 0, endOffset: text.length }],
            usedChunkIds: source.chunks.map(chunk => chunk.chunkId), points: [{ kind: "KEY_POINT", text,
              citations: [{ chunkId: source.chunks[0].chunkId, quote: text }] }] };
        },
      };
      const askArden: AskArdenClient = {
        async retrieve(request) {
          retrievalCalls++;
          expect(request.allowedGenerationIds).toHaveLength(1);
          const manifest = manifests.get(request.allowedGenerationIds[0]);
          if (!manifest) throw new Error("Unexpected retrieval generation");
          const { ordinal: _ordinal, ...chunk } = manifest.chunks[0];
          return { contractVersion: 2, usageContractVersion: 1, usageEvents: [], requestId: request.requestId,
            standaloneQuery: request.query, retrievalMode: "HYBRID",
            evidence: [{ ...chunk, content: text, label: "synthetic", generationId: manifest.generationId,
              snapshotVersionId: manifest.snapshotVersionId, snapshotContentHash: manifest.snapshotContentHash }] };
        },
        async generate(request) {
          await duringAnswer?.();
          return { contractVersion: 2, usageContractVersion: 1, usageEvents: [], requestId: request.requestId,
            status: "ANSWERED", answer: text,
            usedEvidence: request.evidence.map(item => item.chunkId), citations: [{ chunkId: request.evidence[0].chunkId, quote: text }] };
        },
      };
      const origins: string[] = [];
      app = buildApp({ repository: ctx.repository, storage, auth, authTrustedOrigins: origins, secureCookies: false,
        checkDatabase: async () => { await ctx.pool.query("SELECT 1"); }, readerAi, askArden });
      address = await app.listen({ host: "127.0.0.1", port: 0 }); origins.push(address);
      for (const user of users) await login(user);
    });
    afterAll(async () => {
      await app?.close(); sessions.clear(); cookies.clear();
      // Exact mkdtemp child only, never a shared content root.
      if (contentRoot) {
        if (!resolve(contentRoot).startsWith(`${resolve(tmpdir())}${sep}arden-km2-http-`)) throw new Error("Unexpected test content root");
        await rm(contentRoot, { recursive: true, force: true });
      }
    });

    it("copies private knowledge, freezes review, activates atomically and curates only after publication", async () => {
      const { owner, member } = context();
      const note = await request(owner, `${base()}/private-workspace/drafts`, 201, "POST", { title: "Private original", body: text });
      const privateId = string(note.body, "id");
      await request(member, `${base()}/private-workspace/drafts/${privateId}`, 404);
      const copied = await request(owner, `${knowledge()}/drafts`, 201, "POST", {
        sourcePrivateVersionId: string(record(note.body.currentVersion), "id") }, { "idempotency-key": randomUUID() });
      const draftId = string(copied.body, "id");
      const saved = await request(owner, `${knowledge()}/drafts/${draftId}`, 200, "PATCH", {
        targetReaders: { mode: "ORGANIZATION" }, management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "" },
      }, { "if-match": copied.headers.get("etag")! });
      const submission = await request(owner, `${knowledge()}/drafts/${draftId}/submit`, 201, "POST", undefined,
        { "if-match": saved.headers.get("etag")!, "idempotency-key": randomUUID() });
      await request(owner, `${knowledge()}/drafts/${draftId}`, 200, "PATCH", { body: "Unsubmitted private working changes." },
        { "if-match": saved.headers.get("etag")! });
      await approve(submission.body);
      expect(rows((await request(member, `${knowledge()}/published?scope=ORGANIZATION`)).body).some(row => row.draftId === draftId)).toBe(false);
      const id = await activate();
      const detail = await request(member, published(id));
      expect(string(detail.body, "body")).toContain(text);
      expect(string(detail.body, "body")).not.toContain("Unsubmitted");
      expect(detail.headers.get("cache-control")).toBe("no-store");
      expect(string((await request(owner, `${base()}/private-workspace/drafts/${privateId}`)).body, "body")).toBe(text);
      const folder = await request(owner, `${knowledge()}/catalog/collections`, 201, "POST", {
        name: `HTTP handbook ${randomUUID()}`, status: "ACTIVE", allowedTypes: ["Guide"] });
      const folderId = string(folder.body, "id");
      const placement = `${knowledge()}/catalog/placements/${draftId}`;
      const initial = await request(owner, placement);
      const placed = await request(owner, placement, 200, "PATCH", { collectionId: folderId }, { "if-match": initial.headers.get("etag")! });
      await request(owner, placement, 412, "PATCH", { collectionId: null }, { "if-match": initial.headers.get("etag")! });
      expect(placed.body.collectionId).toBe(folderId);
      const catalog = (await request(member, `${knowledge()}/catalog`)).body;
      expect(JSON.stringify(catalog)).toContain(id);
      expect(rows((await request(member, `${knowledge()}/published?scope=ORGANIZATION`)).body).some(row => row.id === id)).toBe(true);
      await request(owner, `${knowledge()}/catalog/collections/${folderId}`, 200, "PATCH", {
        name: string(folder.body, "name"), status: "INACTIVE", allowedTypes: ["Guide"] }, { "if-match": '"catalog-1"' });
      expect((await request(owner, placement)).body.collectionId).toBeNull();
      await request(member, published(id)); // Archive never withdraws the document.
    }, 30_000);

    it("separates common/shared results and blocks escalation and in-flight Q&A after revocation", async () => {
      const { owner, member, colleague, department, pool } = context();
      const source = await publish({ mode: "SELECTED_MEMBERS", memberIds: [context().memberId, context().colleagueId] });
      await request(member, published(source.publication));
      const colleagueId = context().colleagueId;
      duringAnswer = async () => { await pool.query("UPDATE arden.organization_membership SET status='SUSPENDED' WHERE membership_id=$1", [colleagueId]); };
      try {
        const rejected = await request(context().colleague, `${published(source.publication)}/questions`, 404, "POST", {
          requestId: randomUUID(), query: "How should I confirm access?" });
        expect(JSON.stringify(rejected.body)).not.toContain(text);
      } finally {
        duringAnswer = null;
        await pool.query("UPDATE arden.organization_membership SET status='ACTIVE' WHERE membership_id=$1", [colleagueId]);
      }
      await request(owner, published(source.publication), 404); // Admin is not an automatic reader.
      await request(colleague, published(source.publication));
      const shared = rows((await request(member, `${knowledge()}/published?scope=SHARED`)).body);
      expect(shared.some(row => row.id === source.publication)).toBe(true);
      expect(JSON.stringify(shared)).not.toContain(context().memberId);
      expect(rows((await request(member, `${knowledge()}/published?scope=ORGANIZATION`)).body).some(row => row.id === source.publication)).toBe(false);
      await request(owner, `${knowledge()}/catalog/placements/${source.id}`, 404);
      await request(member, `${knowledge()}/catalog/collections`, 404, "POST", { name: "Denied", status: "ACTIVE", allowedTypes: ["Guide"] });
      await request(null, published(source.publication), 401);
      await request(member, `/api/v1/organizations/${randomUUID()}/knowledge/published?scope=ORGANIZATION`, 404);
      const restricted = await publish({ mode: "DEPARTMENT", departmentId: department });
      await request(owner, published(restricted.publication));
      await request(colleague, published(restricted.publication), 404);
      expect(rows((await request(owner, `${knowledge()}/published?scope=SHARED`)).body).some(row => row.id === restricted.publication)).toBe(true);
    }, 30_000);

    it("uses exact-version Summary/Q&A then denies subsequent and in-flight disclosure after real revocation", async () => {
      const { owner, member, memberId, pool } = context();
      const source = await publish({ mode: "SELECTED_MEMBERS", memberIds: [memberId, context().colleagueId] });
      expect(await context().repository.readerSources.resolve(member, context().organization, source.publication)).not.toBeNull();
      const access = await request(member, `${published(source.publication)}/summary/access`);
      expect(access.body.versionId).toBe(source.publication);
      const answer = await request(member, `${published(source.publication)}/questions`, 200, "POST", { requestId: randomUUID(), query: "How should I confirm access?" });
      expect(answer.body.status).toBe("ANSWERED");
      expect(JSON.stringify(answer.body.citations)).toContain(source.publication);
      const summary = await request(member, `${published(source.publication)}/summary`, 200, "POST", { requestId: randomUUID() });
      expect(summary.body.status).toBe("COMPLETED");
      expect(JSON.stringify(summary.body.points)).toContain(source.publication);
      const deniedCounts = [summaryCalls, retrievalCalls];
      await request(owner, `${published(source.publication)}/summary`, 404, "POST", {});
      await request(owner, `${published(source.publication)}/questions`, 404, "POST", { requestId: randomUUID(), query: "Read it" });
      expect([summaryCalls, retrievalCalls]).toEqual(deniedCounts);
      // A fresh publication avoids Summary cooldown without sleeping or changing policy.
      const inFlight = await publish({ mode: "SELECTED_MEMBERS", memberIds: [memberId, context().colleagueId] });
      duringSummary = async () => { await pool.query("UPDATE arden.organization_membership SET status='SUSPENDED' WHERE membership_id=$1", [memberId]); };
      try {
        const rejected = await request(member, `${published(inFlight.publication)}/summary`, 404, "POST", { requestId: randomUUID() });
        expect(JSON.stringify(rejected.body)).not.toContain(text);
        await request(member, published(source.publication), 404);
        await request(member, `${published(source.publication)}/summary/access`, 404);
        await request(member, `${published(source.publication)}/questions`, 404, "POST", { requestId: randomUUID(), query: "Read it" });
        await request(member, `${knowledge()}/published?scope=SHARED`, 404);
      } finally {
        duringSummary = null;
        await pool.query("UPDATE arden.organization_membership SET status='ACTIVE' WHERE membership_id=$1", [memberId]);
      }
      await request(member, published(source.publication));
      await request(member, "/api/v1/auth/sign-out", 204, "POST");
      await request(member, published(source.publication), 401);
      await login(member);
    }, 30_000);
  });
}
