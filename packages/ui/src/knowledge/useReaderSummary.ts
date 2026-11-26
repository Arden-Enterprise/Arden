import { generateReaderSummary } from "../shared/reader-summary-api";
import type { ReaderSummaryResult } from "../shared/reader-summary-contracts";
import { useReaderOperation, type ReaderOperationOptions } from "./useReaderOperation";
import type { ReaderAccessSession } from "./useReaderAccess";

export type ReaderSummaryOptions = ReaderOperationOptions;
export function useReaderSummary(options: ReaderSummaryOptions | undefined, access: ReaderAccessSession) {
  const operation = useReaderOperation<ReaderSummaryResult, void>(options, access, {
    label: "Summary", run: (config, _input, signal) =>
      generateReaderSummary(config.platform, config.context, crypto.randomUUID(), signal),
  });
  return { ...operation, open: () => operation.open(undefined) };
}
