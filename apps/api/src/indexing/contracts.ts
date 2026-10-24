import { createHash } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const maxManifestChunks = 20_000;

export type IndexGenerationJob = {
  jobId: string;
  generationId: string;
  organizationId: string;
  submissionId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  sourceUri: string;
  mimeType: string;
  attemptCount: number;
  maxAttempts: number;
};

export type IndexGenerationRequest = {
  contractVersion: 1;
  jobId: string;
  organizationId: string;
  submissionId: string;
  generationId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  snapshotContent: string;
};

export type ChunkManifestEntry = {
  chunkId: string;
  ordinal: number;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  sourceBlockIds: string[];
  parentSectionBlockId: string | null;
};

export type IndexGenerationManifest = {
  contractVersion: 1;
  jobId: string;
  generationId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  compilerVersion: string;
  chunkingVersion: string;
  embeddingModel: string;
  embeddingDimensions: number;
  markdownContentHash: string;
  chunksDigest: string;
  chunks: ChunkManifestEntry[];
};

export class IndexContractError extends Error {
  readonly code = "INVALID_INDEX_MANIFEST";
}

export function buildIndexGenerationRequest(job: IndexGenerationJob, snapshotContent: string): IndexGenerationRequest {
  if (createHash("sha256").update(snapshotContent, "utf8").digest("hex") !== job.snapshotContentHash) {
    throw new IndexContractError("Snapshot content no longer matches its immutable hash");
  }
  return {
    contractVersion: 1,
    jobId: job.jobId,
    organizationId: job.organizationId,
    submissionId: job.submissionId,
    generationId: job.generationId,
    snapshotVersionId: job.snapshotVersionId,
    snapshotContentHash: job.snapshotContentHash,
    snapshotContent,
  };
}

export function parseIndexGenerationManifest(value: unknown, job: IndexGenerationJob): IndexGenerationManifest {
  const manifest = objectValue(value, "manifest");
  exactKeys(manifest, ["contractVersion", "jobId", "generationId", "snapshotVersionId",
    "snapshotContentHash", "compilerVersion", "chunkingVersion", "embeddingModel",
    "embeddingDimensions", "markdownContentHash", "chunksDigest", "chunks"]);
  if (manifest.contractVersion !== 1 || manifest.jobId !== job.jobId
    || manifest.generationId !== job.generationId || manifest.snapshotVersionId !== job.snapshotVersionId
    || manifest.snapshotContentHash !== job.snapshotContentHash) {
    throw new IndexContractError("Manifest identity does not match the claimed job");
  }
  const compilerVersion = nonEmptyString(manifest.compilerVersion, "compilerVersion");
  const chunkingVersion = nonEmptyString(manifest.chunkingVersion, "chunkingVersion");
  const embeddingModel = nonEmptyString(manifest.embeddingModel, "embeddingModel");
  const embeddingDimensions = positiveInteger(manifest.embeddingDimensions, "embeddingDimensions");
  const markdownContentHash = sha256(manifest.markdownContentHash, "markdownContentHash");
  const chunksDigest = sha256(manifest.chunksDigest, "chunksDigest");
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0 || manifest.chunks.length > maxManifestChunks) {
    throw new IndexContractError("Manifest chunks must be a bounded non-empty array");
  }
  const chunks = manifest.chunks.map(parseChunk);
  const ordinals = new Set<number>();
  const chunkIds = new Set<string>();
  for (const chunk of chunks) {
    if (ordinals.has(chunk.ordinal) || chunkIds.has(chunk.chunkId)) {
      throw new IndexContractError("Manifest contains duplicate chunks");
    }
    ordinals.add(chunk.ordinal);
    chunkIds.add(chunk.chunkId);
  }
  if (chunks.some((chunk, index) => chunk.ordinal !== index)) {
    throw new IndexContractError("Manifest chunk ordinals must be contiguous and ordered");
  }
  const actualDigest = createHash("sha256").update(canonicalJson(chunks), "utf8").digest("hex");
  if (actualDigest !== chunksDigest) throw new IndexContractError("Manifest chunk digest is invalid");
  return {
    contractVersion: 1,
    jobId: job.jobId,
    generationId: job.generationId,
    snapshotVersionId: job.snapshotVersionId,
    snapshotContentHash: job.snapshotContentHash,
    compilerVersion,
    chunkingVersion,
    embeddingModel,
    embeddingDimensions,
    markdownContentHash,
    chunksDigest,
    chunks,
  };
}

function parseChunk(value: unknown): ChunkManifestEntry {
  const chunk = objectValue(value, "chunk");
  exactKeys(chunk, ["chunkId", "ordinal", "contentHash", "startOffset", "endOffset",
    "sourceBlockIds", "parentSectionBlockId"]);
  const ordinal = nonNegativeInteger(chunk.ordinal, "ordinal");
  const startOffset = nonNegativeInteger(chunk.startOffset, "startOffset");
  const endOffset = positiveInteger(chunk.endOffset, "endOffset");
  if (endOffset <= startOffset) throw new IndexContractError("Chunk offsets are invalid");
  if (!Array.isArray(chunk.sourceBlockIds) || chunk.sourceBlockIds.length === 0
    || chunk.sourceBlockIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new IndexContractError("Chunk sourceBlockIds are invalid");
  }
  if (chunk.parentSectionBlockId !== null
    && (typeof chunk.parentSectionBlockId !== "string" || chunk.parentSectionBlockId.length === 0)) {
    throw new IndexContractError("Chunk parentSectionBlockId is invalid");
  }
  return {
    chunkId: sha256(chunk.chunkId, "chunkId"),
    ordinal,
    contentHash: sha256(chunk.contentHash, "contentHash"),
    startOffset,
    endOffset,
    sourceBlockIds: [...chunk.sourceBlockIds] as string[],
    parentSectionBlockId: chunk.parentSectionBlockId as string | null,
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IndexContractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new IndexContractError("Manifest contains missing or unsupported fields");
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new IndexContractError(`${label} is invalid`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) throw new IndexContractError(`${label} is invalid`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new IndexContractError(`${label} is invalid`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const integer = nonNegativeInteger(value, label);
  if (integer === 0) throw new IndexContractError(`${label} is invalid`);
  return integer;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertIndexGenerationJob(value: IndexGenerationJob): void {
  for (const id of [value.jobId, value.generationId, value.organizationId, value.submissionId, value.snapshotVersionId]) {
    if (!uuidPattern.test(id)) throw new IndexContractError("Claimed index job contains an invalid identifier");
  }
  sha256(value.snapshotContentHash, "snapshotContentHash");
}
