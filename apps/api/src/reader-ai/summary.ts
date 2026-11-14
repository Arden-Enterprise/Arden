import type { PublicCitation } from "../answers/governed-contracts.js";
import { ArdenAiAnswerError } from "../answers/ai-client.js";
import { readerCitation } from "./citation.js";
import { ReaderAdmission } from "./admission.js";
export { ReaderAdmission as SummaryAdmission } from "./admission.js";
import type { ReaderSourceResponse } from "./contracts.js";
import type { ReaderSourceClient, ReaderSourcePreparation } from "./source-preparation.js";
import { parseReaderSummary, ReaderSummaryError, type SummaryKind } from "./summary-contracts.js";

export interface ReaderAiClient extends ReaderSourceClient {
  summarizeReaderSource(source: ReaderSourceResponse): Promise<unknown>;
}
export type PublicReaderSummary = { requestId: string; status: "COMPLETED"; documentId: string; versionId: string;
  points: Array<{ kind: SummaryKind; text: string; citations: PublicCitation[] }> };

export class ReaderSummary {
  constructor(private readonly sources: Pick<ReaderSourcePreparation, "checkAccess" | "prepare" | "revalidate">,
    private readonly ai: Pick<ReaderAiClient, "summarizeReaderSource">,
    private readonly admission = new ReaderAdmission()) {}

  async summarize(user: string, organization: string, publication: string, requestId: string): Promise<PublicReaderSummary> {
    await this.sources.checkAccess(user, organization, publication); // denial must stay 404 even during cooldown
    const lease = this.admission.reserve(user, organization);
    try {
      const source = structuredClone(await this.sources.prepare(user, organization, publication, requestId));
      await this.sources.revalidate(user, organization, publication, source);
      lease.dispatch();
      let output: unknown;
      try { output = await this.ai.summarizeReaderSource(structuredClone(source)); }
      catch (error) {
        if (error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422") throw new ReaderSummaryError("UNSUPPORTED");
        throw new ReaderSummaryError("UNAVAILABLE");
      }
      const result = parseReaderSummary(output, source);
      const metadata = await this.sources.revalidate(user, organization, publication, source);
      return { requestId, status: "COMPLETED", documentId: metadata.draftId, versionId: publication,
        points: result.points.map(point => ({ kind: point.kind, text: point.text,
          citations: point.citations.map(citation => {
            const chunk = source.chunks.find(item => item.chunkId === citation.chunkId)!;
            return readerCitation(metadata, publication, chunk, citation.quote);
          }) })) };
    } finally { lease.release(); }
  }
}
