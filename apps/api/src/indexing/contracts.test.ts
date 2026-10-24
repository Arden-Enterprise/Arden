import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildIndexGenerationRequest,
  IndexContractError,
  parseIndexGenerationManifest,
  type IndexGenerationJob,
} from "./contracts.js";

const job: IndexGenerationJob = {
  jobId: "10000000-0000-4000-8000-000000000001",
  generationId: "10000000-0000-4000-8000-000000000002",
  organizationId: "10000000-0000-4000-8000-000000000003",
  submissionId: "10000000-0000-4000-8000-000000000004",
  snapshotVersionId: "10000000-0000-4000-8000-000000000005",
  snapshotContentHash: "a".repeat(64),
  sourceUri: "arden-private-object://10000000-0000-4000-8000-000000000006",
  mimeType: "text/plain",
  attemptCount: 1,
  maxAttempts: 3,
};

function manifest() {
  const chunks = [{
    chunkId: "b".repeat(64),
    contentHash: "c".repeat(64),
    endOffset: 8,
    ordinal: 0,
    parentSectionBlockId: null,
    sourceBlockIds: ["body"],
    startOffset: 0,
  }];
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
    markdownContentHash: "d".repeat(64),
    chunksDigest: createHash("sha256").update(JSON.stringify(chunks)).digest("hex"),
    chunks,
  };
}

describe("index generation manifest contract", () => {
  it("builds MIME-explicit text and PDF requests without changing snapshot identity", () => {
    const text = "immutable semantic document";
    const textJob = { ...job, snapshotContentHash: createHash("sha256").update(text).digest("hex") };
    expect(buildIndexGenerationRequest(textJob, text)).toMatchObject({
      snapshotMimeType: "text/plain",
      snapshotContent: text,
    });

    const pdf = Buffer.from("%PDF-1.7\nfixture\n%%EOF", "utf8");
    const pdfJob = {
      ...job,
      mimeType: "application/pdf",
      snapshotContentHash: createHash("sha256").update(pdf).digest("hex"),
    };
    expect(buildIndexGenerationRequest(pdfJob, pdf)).toMatchObject({
      snapshotMimeType: "application/pdf",
      snapshotContentBase64: pdf.toString("base64"),
    });
  });

  it("accepts the strict Arden-AI v1 manifest and verifies its chunk digest", () => {
    expect(parseIndexGenerationManifest(manifest(), job)).toMatchObject({
      generationId: job.generationId,
      embeddingDimensions: 1536,
      chunks: [{ ordinal: 0, sourceBlockIds: ["body"] }],
    });
  });

  it("rejects identity drift, unknown fields and invalid chunk digests", () => {
    expect(() => parseIndexGenerationManifest({ ...manifest(), generationId: crypto.randomUUID() }, job))
      .toThrow(IndexContractError);
    expect(() => parseIndexGenerationManifest({ ...manifest(), extra: true }, job)).toThrow(IndexContractError);
    expect(() => parseIndexGenerationManifest({ ...manifest(), chunksDigest: "e".repeat(64) }, job))
      .toThrow("Manifest chunk digest is invalid");
  });
});
