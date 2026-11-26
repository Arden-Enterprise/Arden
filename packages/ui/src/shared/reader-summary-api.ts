import { ApiError, apiRequest } from "./api-client";
import { assertReaderSummaryContext, parsePublicReaderSummary, parseReaderSummaryAccess, type ReaderSummaryContext } from "./reader-summary-contracts";
import type { Platform } from "./types";

/** Fixed operation envelope; dismissal abandons local waiting, not provider work/cost. */
export async function boundedReaderRequest<T>(signal: AbortSignal, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort(); else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  let rejectWait: (() => void) | undefined;
  try {
    if (controller.signal.aborted) throw new ApiError(0, "Summary request stopped.");
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectWait = () => reject(new ApiError(0, "Summary request stopped."));
      controller.signal.addEventListener("abort", rejectWait, { once: true });
    });
    return await Promise.race([work(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
    if (rejectWait) controller.signal.removeEventListener("abort", rejectWait);
  }
}
const path = (context: ReaderSummaryContext) => `/api/v1/organizations/${context.organizationId}/knowledge/published/${context.versionId}/summary`;
export async function generateReaderSummary(platform: Platform, context: ReaderSummaryContext, requestId: string, signal: AbortSignal) {
  assertReaderSummaryContext(context);
  return boundedReaderRequest(signal, 300_000, async signal => {
    const value = await apiRequest<unknown>(platform, path(context), { method: "POST", body: JSON.stringify({ requestId }), signal });
    try { return parsePublicReaderSummary(value, context, requestId); }
    catch { throw new ApiError(0, "Summary is unavailable. Please retry."); }
  });
}
export async function checkReaderSummaryAccess(platform: Platform, context: ReaderSummaryContext, signal: AbortSignal): Promise<void> {
  assertReaderSummaryContext(context);
  await boundedReaderRequest(signal, 30_000, async signal => {
    const value = await apiRequest<unknown>(platform, `${path(context)}/access`, { signal });
    try { parseReaderSummaryAccess(value, context); }
    catch { throw new ApiError(404, "This document is unavailable."); }
  });
}
