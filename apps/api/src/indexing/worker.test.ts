import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import type { IndexGenerationClient } from "./ai-client.js";
import type { IndexGenerationJob, IndexGenerationManifest } from "./contracts.js";
import type { IndexGenerationStore } from "./store.js";
import { IndexingWorker } from "./worker.js";

const snapshot = "arden-document:application/vnd.arden.semantic-blocks+json;version=1\n{\"schemaVersion\":1,\"blocks\":[]}";

function makeJob(patch: Partial<IndexGenerationJob> = {}): IndexGenerationJob {
  return {
    jobId: "10000000-0000-4000-8000-000000000001",
    generationId: "10000000-0000-4000-8000-000000000002",
    organizationId: "10000000-0000-4000-8000-000000000003",
    submissionId: "10000000-0000-4000-8000-000000000004",
    snapshotVersionId: "10000000-0000-4000-8000-000000000005",
    snapshotContentHash: createHash("sha256").update(snapshot).digest("hex"),
    sourceUri: "arden-private-object://10000000-0000-4000-8000-000000000006",
    mimeType: "text/plain",
    attemptCount: 1,
    maxAttempts: 3,
    ...patch,
  };
}

function makeManifest(job: IndexGenerationJob): IndexGenerationManifest {
  return {
    contractVersion: 1,
    jobId: job.jobId,
    generationId: job.generationId,
    snapshotVersionId: job.snapshotVersionId,
    snapshotContentHash: job.snapshotContentHash,
    compilerVersion: "semantic-markdown-v1",
    chunkingVersion: "langchain-section-token-v1",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    markdownContentHash: "a".repeat(64),
    chunksDigest: "b".repeat(64),
    chunks: [{ chunkId: "c".repeat(64), ordinal: 0, contentHash: "d".repeat(64),
      startOffset: 0, endOffset: 8, sourceBlockIds: ["body"], parentSectionBlockId: null }],
  };
}

class FakeStore implements IndexGenerationStore {
  completed = false;
  failure: { code: string; retryable: boolean } | null = null;
  constructor(private readonly job: IndexGenerationJob | null) {}
  async claim() { return this.job; }
  async complete() { this.completed = true; return "10000000-0000-4000-8000-000000000007"; }
  async fail(_job: IndexGenerationJob, _workerId: string, code: string, retryable: boolean) {
    this.failure = { code, retryable };
    return "FAILED" as const;
  }
}

const storage: PrivateContentStorage = {
  async read() { return snapshot; },
  async write() { throw new Error("not used"); },
  async writePdf() { throw new Error("not used"); },
  async readPdf() { throw new Error("not used"); },
  async remove() { throw new Error("not used"); },
};
const logger = { info() {}, error() {} };

describe("indexing worker", () => {
  it("indexes one claimed snapshot and delegates atomic activation to core storage", async () => {
    const job = makeJob();
    const store = new FakeStore(job);
    let receivedSnapshot = "";
    const ai: IndexGenerationClient = { index: async (request) => {
      receivedSnapshot = request.snapshotContent;
      return makeManifest(job);
    } };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 90,
      store, storage, ai, logger);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(receivedSnapshot).toBe(snapshot);
    expect(store.completed).toBe(true);
    expect(store.failure).toBeNull();
  });

  it("fails unsupported immutable snapshots closed without calling Arden AI", async () => {
    const job = makeJob({ mimeType: "application/pdf" });
    const store = new FakeStore(job);
    let called = false;
    const ai: IndexGenerationClient = { index: async () => { called = true; return makeManifest(job); } };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 90,
      store, storage, ai, logger);

    await worker.runOnce();
    expect(called).toBe(false);
    expect(store.failure).toEqual({ code: "UNSUPPORTED_SNAPSHOT_MIME_TYPE", retryable: false });
  });

  it("returns idle without side effects when no job is ready", async () => {
    const store = new FakeStore(null);
    const ai: IndexGenerationClient = { index: async () => { throw new Error("not called"); } };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 90,
      store, storage, ai, logger);
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(store.completed).toBe(false);
  });
});
