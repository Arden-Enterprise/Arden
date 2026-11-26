import { evidenceMatchesManifest, parseGenerationResponse, parseRetrievalResponse,
  type PublicCitation, type GenerationRequest, type RetrievalRequest } from "../answers/governed-contracts.js";
import type { ReaderSourcePreparation } from "./source-preparation.js";
import { ReaderSourceError } from "./contracts.js";
import { readerCitation } from "./citation.js";
import { ReaderAdmission } from "./admission.js";

export const insufficientDocumentEvidence = "This document does not provide enough information to answer that question.";
export type PublicReaderAnswer = { requestId: string; documentId: string; versionId: string;
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE"; answer: string; citations: PublicCitation[] };
export interface ReaderQuestionClient {
  retrieve(request: RetrievalRequest): Promise<unknown>;
  generate(request: GenerationRequest): Promise<unknown>;
}

/** Stateless question path. No general conversation store, source substitution or implicit history. */
export class ReaderQuestion {
  constructor(private readonly sources: Pick<ReaderSourcePreparation, "resolve">,
    private readonly ai: ReaderQuestionClient,
    private readonly admission = new ReaderAdmission(Date.now, 10_000)) {}

  async answer(user: string, organization: string, publication: string, requestId: string, query: string): Promise<PublicReaderAnswer> {
    if (!query.trim() || Array.from(query).length > 4_000) throw new ReaderSourceError("INVALID_SOURCE");
    const initial = structuredClone(await this.sources.resolve(user, organization, publication)), record = initial.record;
    const frozen = JSON.stringify(record);
    const recheck = async () => {
      const current = await this.sources.resolve(user, organization, publication);
      if (JSON.stringify(current.record) !== frozen) throw new ReaderSourceError("SOURCE_UNAVAILABLE");
      return current.publication;
    };
    const lease = this.admission.reserve(user, organization);
    try {
      await recheck(); lease.dispatch();
      const retrieval = parseRetrievalResponse(await this.ai.retrieve({ contractVersion: 2, purpose: "READER_QUESTION",
        requestId, organizationId: organization, query, allowedGenerationIds: [record.source.generationId], history: [],
        sourceHints: [{ generationId: record.source.generationId, label: initial.publication.title.slice(0, 800) }] }), requestId);
      // No contextualization is allowed to smuggle an unrelated question into generation.
      if (retrieval.standaloneQuery !== query) throw new ReaderSourceError("INVALID_SOURCE");
      await recheck();
      const expected = { ...record.source, chunks: record.manifest.chunks };
      const evidence = retrieval.evidence.map(chunk => {
        if (!evidenceMatchesManifest(chunk, expected)) throw new ReaderSourceError("INVALID_SOURCE");
        return { ...chunk, label: initial.publication.title.slice(0, 800) };
      });
      if (!evidence.length) {
        const metadata = await recheck();
        return { requestId, documentId: metadata.draftId, versionId: publication, status: "INSUFFICIENT_EVIDENCE",
          answer: insufficientDocumentEvidence, citations: [] };
      }
      const request: GenerationRequest = { contractVersion: 2, purpose: "READER_QUESTION", requestId,
        organizationId: organization, query, history: [], evidence };
      const generated = parseGenerationResponse(await this.ai.generate(structuredClone(request)), request);
      const metadata = await recheck();
      const citations = generated.citations.map(citation => {
        const chunk = evidence.find(item => item.chunkId === citation.chunkId)!;
        if (chunk.content.indexOf(citation.quote) !== chunk.content.lastIndexOf(citation.quote)) throw new ReaderSourceError("INVALID_SOURCE");
        return readerCitation(metadata, publication, chunk, citation.quote);
      });
      return { requestId, documentId: metadata.draftId, versionId: publication, status: generated.status,
        answer: generated.status === "ANSWERED" ? generated.answer : insufficientDocumentEvidence, citations };
    } finally { lease.release(); }
  }
}
