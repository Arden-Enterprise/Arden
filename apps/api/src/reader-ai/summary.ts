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
type Completed = { result: PublicReaderSummary; source: ReaderSourceResponse };
export type SummaryStage = "ACCESS" | "ADMISSION" | "SOURCE" | "GENERATION" | "VALIDATION" | "FINAL_ACCESS" | "JOIN";
type Observe = (stage: SummaryStage, joinedOperationId?: string) => void;

export class ReaderSummary {
  private readonly pending = new Map<string, { work: Promise<Completed>; requestId: string; waiters: number }>();
  constructor(private readonly sources: Pick<ReaderSourcePreparation, "checkAccess" | "prepare" | "revalidate">,
    private readonly ai: Pick<ReaderAiClient, "summarizeReaderSource">,
    private readonly admission = new ReaderAdmission()) {}

  async summarize(user: string, organization: string, publication: string, requestId: string,
    observe: Observe = () => {}): Promise<PublicReaderSummary> {
    observe("ACCESS");
    await this.sources.checkAccess(user, organization, publication); // denial must stay 404 even during cooldown
    const key = `${organization}:${user}:${publication}`, pending = this.pending.get(key);
    if (pending) {
      if (pending.waiters >= 8) throw new ReaderSummaryError("BUSY", "CAPACITY", 5);
      observe("JOIN", pending.requestId); pending.waiters++;
      try {
        const completed = await pending.work;
        observe("FINAL_ACCESS", pending.requestId);
        await this.sources.revalidate(user, organization, publication, completed.source);
        return { ...structuredClone(completed.result), requestId };
      } finally { pending.waiters--; }
    }
    observe("ADMISSION");
    const lease = this.admission.reserve(user, organization, publication);
    const work = this.generate(user, organization, publication, requestId, lease, observe);
    const entry = { work, requestId, waiters: 0 }; this.pending.set(key, entry);
    try { return (await work).result; }
    finally { if (this.pending.get(key) === entry) this.pending.delete(key); }
  }

  private async generate(user: string, organization: string, publication: string, requestId: string,
    lease: ReturnType<ReaderAdmission["reserve"]>, observe: Observe): Promise<Completed> {
    let unsupported = false;
    try {
      observe("SOURCE");
      const source = structuredClone(await this.sources.prepare(user, organization, publication, requestId));
      await this.sources.revalidate(user, organization, publication, source);
      lease.dispatch();
      observe("GENERATION");
      let output: unknown;
      try { output = await this.ai.summarizeReaderSource(structuredClone(source)); }
      catch (error) {
        if (error instanceof ArdenAiAnswerError) {
          if (error.code === "AI_SERVICE_HTTP_422") { unsupported = true; throw new ReaderSummaryError("UNSUPPORTED"); }
          if (error.code === "AI_SUMMARY_TIMEOUT") throw new ReaderSummaryError("TIMEOUT");
          if (error.code === "AI_SUMMARY_PROVIDER_BUSY") throw new ReaderSummaryError("PROVIDER_BUSY", undefined, 60);
          if (error.code === "AI_SUMMARY_PROVIDER_AUTH") throw new ReaderSummaryError("PROVIDER_AUTH");
          if (error.code === "AI_SUMMARY_INVALID_OUTPUT") throw new ReaderSummaryError("INVALID_SUMMARY");
        }
        throw new ReaderSummaryError("UNAVAILABLE");
      }
      observe("VALIDATION");
      const result = parseReaderSummary(output, source);
      observe("FINAL_ACCESS");
      const metadata = await this.sources.revalidate(user, organization, publication, source);
      return { source, result: { requestId, status: "COMPLETED", documentId: metadata.draftId, versionId: publication,
        points: result.points.map(point => ({ kind: point.kind, text: point.text,
          citations: point.citations.map(citation => {
            const chunk = source.chunks.find(item => item.chunkId === citation.chunkId)!;
            return readerCitation(metadata, publication, chunk, citation.quote);
          }) })) } };
    } catch (error) {
      if (error instanceof ReaderSummaryError && error.code !== "UNSUPPORTED") throw new ReaderSummaryError(error.code, error.reason,
        Math.max(error.retryAfterSeconds ?? 0, this.admission.remaining(user, organization, publication)) || undefined);
      throw error;
    } finally { lease.release(unsupported); }
  }
}
