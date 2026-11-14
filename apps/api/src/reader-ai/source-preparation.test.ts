import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PublishedKnowledge } from "../db/repository.js";
import type { ReaderActor } from "../target-readers/policy.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import { parseIndexGenerationManifest } from "../indexing/contracts.js";
import { parseReaderSourceResponse, type ReaderSourceRequest, type ReaderSourceResponse } from "./contracts.js";
import { ReaderSourcePreparation } from "./source-preparation.js";
import type { ReaderSourceRecord } from "./source-store.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/reader-source-v1.json", import.meta.url), "utf8")) as {
  request: ReaderSourceRequest; response: ReaderSourceResponse; manifest: IndexGenerationManifest };
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function harness() {
  const input = structuredClone(golden), organization = input.request.snapshot.organizationId;
  const record: ReaderSourceRecord = { publishedVersionId: input.request.publishedVersionId, documentId: id(8),
    source: { ...input.request.snapshot, sourceUri: `arden-private-object://${id(9)}`, mimeType: "text/plain" },
    manifest: input.manifest };
  const publication: PublishedKnowledge = { id: record.publishedVersionId, draftId: record.documentId,
    title: "Source fixture", classification: "INTERNAL", responsibleDepartmentId: id(10),
    responsibleDepartmentName: "Engineering", contentHash: record.source.snapshotContentHash,
    sourceUri: record.source.sourceUri, audienceRoleIds: [], targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    publishedAt: new Date(), validFrom: new Date(), validUntil: null };
  let actor: ReaderActor | null = { membershipId: id(11), organizationId: organization, status: "ACTIVE", departmentIds: [] };
  const repository = { getTargetReaderActor: vi.fn(async () => actor),
    getPublishedKnowledge: vi.fn(async () => publication as PublishedKnowledge | null) };
  const sources = { resolve: vi.fn(async () => record as ReaderSourceRecord | null) };
  const storage = { read: vi.fn(async () => input.request.snapshot.snapshotContent!), readPdf: vi.fn(async () => Buffer.alloc(0)) };
  const ai = { prepareReaderSource: vi.fn(async () => input.response as unknown) };
  const run = () => new ReaderSourcePreparation(repository, sources, storage, ai)
    .prepare(id(12), organization, input.request.publishedVersionId, input.request.requestId);
  return { input, record, publication, repository, sources, storage, ai, run, setActor: (value: ReaderActor | null) => { actor = value; } };
}

describe("Reader exact-version source gate", () => {
  it("validates the Python golden fixture against its authoritative complete manifest", async () => {
    const h = harness();
    expect(parseIndexGenerationManifest(h.input.manifest, h.record.source)).toEqual(h.input.manifest);
    expect(await h.run()).toEqual(h.input.response);
    expect(h.ai.prepareReaderSource).toHaveBeenCalledExactlyOnceWith(h.input.request);
    expect(h.repository.getTargetReaderActor).toHaveBeenCalledTimes(3);
  });

  it.each(["organizationId", "publishedVersionId", "generationId", "snapshotVersionId", "snapshotContentHash",
    "requestId", "purpose", "compilerVersion", "chunkingVersion", "chunksDigest", "markdownContentHash"])("rejects forged %s", async field => {
    const h = harness();
    h.ai.prepareReaderSource.mockResolvedValue({ ...h.input.response, [field]: "forged" });
    await expect(h.run()).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it.each(["missing", "reordered", "duplicate", "wording", "offset", "blocks", "heading", "extra"])("rejects %s source response", async mode => {
    const h = harness(), response = h.input.response;
    if (mode === "missing") response.chunks.pop();
    if (mode === "reordered") response.chunks.reverse();
    if (mode === "duplicate") response.chunks[1] = response.chunks[0];
    if (mode === "wording") response.chunks[0].content = "Fake content";
    if (mode === "offset") response.chunks[0].startOffset++;
    if (mode === "blocks") response.chunks[0].sourceBlockIds = ["other"];
    if (mode === "heading") response.markdown = response.markdown.replace("Exceptions", "Altered title");
    if (mode === "extra") h.ai.prepareReaderSource.mockResolvedValue({ ...response, extra: true });
    await expect(h.run()).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it.each(["missing", "suspended", "other-org", "no-readership", "unavailable"])("blocks %s before storage/AI", async mode => {
    const h = harness();
    if (mode === "missing") h.repository.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "suspended") h.setActor({ membershipId: id(11), organizationId: h.input.request.snapshot.organizationId, status: "SUSPENDED", departmentIds: [] });
    if (mode === "other-org") h.setActor({ membershipId: id(11), organizationId: id(30), status: "ACTIVE", departmentIds: [] });
    if (mode === "no-readership") h.publication.targetReaders = { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [id(40)] };
    if (mode === "unavailable") h.sources.resolve.mockResolvedValue(null);
    await expect(h.run()).rejects.toMatchObject({ code: mode === "unavailable" ? "SOURCE_UNAVAILABLE" : "NOT_FOUND" });
    expect(h.storage.read).not.toHaveBeenCalled();
    expect(h.ai.prepareReaderSource).not.toHaveBeenCalled();
  });

  it("rechecks revocation after storage and does not transfer the snapshot", async () => {
    const h = harness();
    h.storage.read.mockImplementation(async () => { h.setActor(null); return h.input.request.snapshot.snapshotContent!; });
    await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.ai.prepareReaderSource).not.toHaveBeenCalled();
  });

  it("withholds the prepared result after revocation or immutable source change", async () => {
    const h = harness();
    h.ai.prepareReaderSource.mockImplementation(async () => { h.setActor(null); return h.input.response; });
    await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const changed = harness();
    changed.ai.prepareReaderSource.mockImplementation(async () => { changed.record.manifest.compilerVersion = "changed"; return changed.input.response; });
    await expect(changed.run()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("does not accept a storage hash mismatch or a source resolved to another version", async () => {
    const h = harness();
    h.storage.read.mockResolvedValue("wrong snapshot");
    await expect(h.run()).rejects.toThrow();
    expect(h.ai.prepareReaderSource).not.toHaveBeenCalled();
    const other = harness(); other.record.publishedVersionId = id(31);
    await expect(other.run()).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });

  it("preserves documented overlap and verifies Unicode codepoint offsets", () => {
    const response = structuredClone(golden.response);
    const manifest = structuredClone(golden.manifest);
    response.markdown = "🔐abcdef\n";
    manifest.markdownContentHash = response.markdownContentHash = createHash("sha256").update(response.markdown).digest("hex");
    const points = Array.from(response.markdown);
    response.chunks = [[0, 5], [3, 8]].map(([startOffset, endOffset], ordinal) => {
      const content = points.slice(startOffset, endOffset).join("");
      return { ...response.chunks[0], ordinal, chunkId: String(ordinal).repeat(64), startOffset, endOffset,
        content, contentHash: createHash("sha256").update(content).digest("hex") };
    });
    manifest.chunks = response.chunks.map(({ content: _, ...entry }) => entry);
    expect(parseReaderSourceResponse(response, golden.request, manifest).chunks).toEqual(response.chunks);
  });
});
