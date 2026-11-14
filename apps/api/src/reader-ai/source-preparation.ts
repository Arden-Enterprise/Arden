import type { ArdenDataRepository, PublishedKnowledge } from "../db/repository.js";
import { buildIndexGenerationRequest } from "../indexing/contracts.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { canRead } from "../target-readers/policy.js";
import { parseReaderSourceResponse, ReaderSourceError, type ReaderSourceRequest, type ReaderSourceResponse } from "./contracts.js";
import type { ReaderSourceRecord, ReaderSourceStore } from "./source-store.js";

export interface ReaderSourceClient { prepareReaderSource(request: ReaderSourceRequest): Promise<unknown> }
type Repository = Pick<ArdenDataRepository, "getTargetReaderActor" | "getPublishedKnowledge">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Exact-source gate shared by preparation and the final Summary authorization check. */
export class ReaderSourcePreparation {
  constructor(private readonly repository: Repository, private readonly sources: ReaderSourceStore,
    private readonly storage: Pick<PrivateContentStorage, "read" | "readPdf">, private readonly ai: ReaderSourceClient | null) {}

  async resolve(user: string, organization: string, publication: string): Promise<{
    record: ReaderSourceRecord; publication: PublishedKnowledge;
  }> {
    const actor = await this.repository.getTargetReaderActor(user, organization);
    if (!actor) throw new ReaderSourceError("NOT_FOUND");
    const reader = await this.repository.getPublishedKnowledge(user, organization, publication);
    if (!reader || reader.id !== publication || !canRead(actor, { organizationId: organization, readers: reader.targetReaders }))
      throw new ReaderSourceError("NOT_FOUND");
    const record = await this.sources.resolve(user, organization, publication);
    if (!record) throw new ReaderSourceError("SOURCE_UNAVAILABLE");
    if (record.publishedVersionId !== publication || record.documentId !== reader.draftId
      || record.source.organizationId !== organization || record.source.snapshotContentHash !== reader.contentHash
      || record.source.sourceUri !== reader.sourceUri) throw new ReaderSourceError("INVALID_SOURCE");
    return { record, publication: reader };
  }

  async revalidate(user: string, organization: string, publication: string,
    prepared: ReaderSourceResponse): Promise<PublishedKnowledge> {
    const current = await this.resolve(user, organization, publication), manifest = current.record.manifest;
    if (prepared.organizationId !== organization || prepared.publishedVersionId !== publication
      || manifest.generationId !== prepared.generationId || manifest.snapshotVersionId !== prepared.snapshotVersionId
      || manifest.snapshotContentHash !== prepared.snapshotContentHash || manifest.markdownContentHash !== prepared.markdownContentHash
      || manifest.chunksDigest !== prepared.chunksDigest || manifest.compilerVersion !== prepared.compilerVersion
      || manifest.chunkingVersion !== prepared.chunkingVersion) throw new ReaderSourceError("SOURCE_UNAVAILABLE");
    return current.publication;
  }

  async checkAccess(user: string, organization: string, publication: string): Promise<{
    documentId: string; versionId: string; contentHash: string;
  }> {
    const current = await this.resolve(user, organization, publication);
    return { documentId: current.record.documentId, versionId: publication,
      contentHash: current.record.source.snapshotContentHash };
  }

  async prepare(user: string, organization: string, publication: string, requestId: string): Promise<ReaderSourceResponse> {
    if (!this.ai) throw new ReaderSourceError("SOURCE_UNAVAILABLE");
    if (![user, organization, publication, requestId].every(id => uuid.test(id))) throw new ReaderSourceError("INVALID_SOURCE");
    const source = structuredClone((await this.resolve(user, organization, publication)).record);
    const snapshot = source.source.mimeType === "application/pdf"
      ? await this.storage.readPdf(source.source.sourceUri, source.source.snapshotContentHash)
      : await this.storage.read(source.source.sourceUri, source.source.snapshotContentHash);
    const request: ReaderSourceRequest = { contractVersion: 1, purpose: "READER_SUMMARY", requestId,
      publishedVersionId: publication, snapshot: buildIndexGenerationRequest(source.source, snapshot) };
    const recheck = async () => {
      const latest = (await this.resolve(user, organization, publication)).record;
      if (JSON.stringify(latest) !== JSON.stringify(source)) throw new ReaderSourceError("SOURCE_UNAVAILABLE");
    };
    await recheck(); // storage latency must not bypass revocation before snapshot transfer
    const response = parseReaderSourceResponse(await this.ai.prepareReaderSource(request), request, source.manifest);
    await recheck();
    return response;
  }
}
