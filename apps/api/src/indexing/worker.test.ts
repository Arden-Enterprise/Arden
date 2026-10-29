import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import type { IndexGenerationClient } from "./ai-client.js";
import { IndexGenerationSupersededError, type IndexGenerationJob, type IndexGenerationManifest } from "./contracts.js";
import type { IndexGenerationStore } from "./store.js";
import { IndexingWorker, indexWorkerLeaseSeconds } from "./worker.js";

const snapshot = "arden-document:application/vnd.arden.semantic-blocks+json;version=1\n{\"schemaVersion\":1,\"blocks\":[]}";
const pdfSnapshot = Buffer.from("%PDF-1.7\nsynthetic test payload\n%%EOF", "utf8");

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
  it("rejects leases shorter than the bounded AI request plus completion margin", () => {
    expect(indexWorkerLeaseSeconds(undefined)).toBe(300);
    expect(indexWorkerLeaseSeconds("180")).toBe(180);
    for (const value of ["90", "179", "601", "180.5", "NaN"]) {
      expect(() => indexWorkerLeaseSeconds(value)).toThrow("ARDEN_INDEX_LEASE_SECONDS");
    }
  });

  it("does not retry a generation superseded by an already published snapshot", async () => {
    const job = makeJob();
    const store = new FakeStore(job);
    store.complete = async () => { throw new IndexGenerationSupersededError("superseded"); };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 300,
      store, storage, { index: async () => makeManifest(job) }, logger);
    await worker.runOnce();
    expect(store.completed).toBe(false);
    expect(store.failure).toEqual({ code: "INDEX_GENERATION_SUPERSEDED", retryable: false });
  });

  it("indexes one claimed snapshot and delegates atomic activation to core storage", async () => {
    const job = makeJob();
    const store = new FakeStore(job);
    let receivedSnapshot = "";
    const ai: IndexGenerationClient = { index: async (request) => {
      receivedSnapshot = request.snapshotMimeType === "text/plain" ? request.snapshotContent : "";
      return makeManifest(job);
    } };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 90,
      store, storage, ai, logger);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(receivedSnapshot).toBe(snapshot);
    expect(store.completed).toBe(true);
    expect(store.failure).toBeNull();
  });

  it("passes an integrity-checked PDF snapshot to Arden AI as base64", async () => {
    const job = makeJob({
      mimeType: "application/pdf",
      sourceUri: "arden-private-object://10000000-0000-4000-8000-000000000006.pdf",
      snapshotContentHash: createHash("sha256").update(pdfSnapshot).digest("hex"),
    });
    const store = new FakeStore(job);
    const pdfStorage: PrivateContentStorage = { ...storage, async readPdf() { return pdfSnapshot; } };
    let received = "";
    const ai: IndexGenerationClient = { index: async (request) => {
      received = request.snapshotMimeType === "application/pdf" ? request.snapshotContentBase64 : "";
      return makeManifest(job);
    } };
    const worker = new IndexingWorker("10000000-0000-4000-8000-000000000008", 90,
      store, pdfStorage, ai, logger);

    await worker.runOnce();
    expect(Buffer.from(received, "base64")).toEqual(pdfSnapshot);
    expect(store.completed).toBe(true);
    expect(store.failure).toBeNull();
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
