import type { ReaderSummaryContext, ReaderSummaryResult } from "../src/shared/reader-summary-contracts";
export const readerId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const readerContext: ReaderSummaryContext = { organizationId: readerId(1), versionId: readerId(2), documentId: readerId(3), contentHash: "a".repeat(64) };
export const readerSummaryFixture = (requestId: string, context = readerContext): ReaderSummaryResult => ({
  requestId, status: "COMPLETED", documentId: context.documentId, versionId: context.versionId,
  points: [{ kind: "KEY_POINT", text: "Only approved readers can use this guidance.", citations: [{
    documentId: context.documentId, versionId: context.versionId, blockId: "source-rule", page: 2,
    excerpt: "Only approved readers", startOffset: 10, endOffset: 31, title: "Working together", version: "1.0",
    scope: "Organization", classification: "INTERNAL", documentCode: "ARD-001",
  }] }],
});
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
