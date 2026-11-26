import { ApiError, apiRequest } from "./api-client";
import { boundedReaderRequest } from "./reader-summary-api";
import { assertReaderSummaryContext, parseReaderCitation, type ReaderSummaryContext,
  type ReaderSummaryCitation } from "./reader-summary-contracts";
import type { Platform } from "./types";

export type ReaderAnswer = { requestId: string; documentId: string; versionId: string;
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE"; answer: string; citations: ReaderSummaryCitation[] };
export function parseReaderAnswer(value: unknown, context: ReaderSummaryContext, requestId: string): ReaderAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document answer");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== ["requestId", "documentId", "versionId", "status", "answer", "citations"].sort().join()
    || row.requestId !== requestId || row.documentId !== context.documentId || row.versionId !== context.versionId
    || (row.status !== "ANSWERED" && row.status !== "INSUFFICIENT_EVIDENCE")
    || typeof row.answer !== "string" || !row.answer.trim() || Array.from(row.answer).length > 12_000
    || !Array.isArray(row.citations) || row.citations.length > 12 || (row.status === "ANSWERED") !== Boolean(row.citations.length)) {
    throw new Error("Invalid document answer");
  }
  return { requestId, documentId: context.documentId, versionId: context.versionId, status: row.status,
    answer: row.status === "ANSWERED" ? row.answer : "This document does not provide enough information to answer that question.",
    // Q&A retrieves bounded passages; it does not inherit Summary's whole-text size limit.
    citations: row.citations.map(value => parseReaderCitation(value, context, Number.MAX_SAFE_INTEGER)) };
}
export async function askReaderQuestion(platform: Platform, context: ReaderSummaryContext, query: string, signal: AbortSignal): Promise<ReaderAnswer> {
  assertReaderSummaryContext(context);
  if (!query.trim() || Array.from(query).length > 4_000) throw new ApiError(422, "Enter a question.");
  const requestId = crypto.randomUUID();
  return boundedReaderRequest(signal, 240_000, async signal => {
    const value = await apiRequest<unknown>(platform,
      `/api/v1/organizations/${context.organizationId}/knowledge/published/${context.versionId}/questions`,
      { method: "POST", body: JSON.stringify({ requestId, query }), signal });
    try { return parseReaderAnswer(value, context, requestId); }
    catch { throw new ApiError(0, "Document Q&A is unavailable. Please retry."); }
  });
}
