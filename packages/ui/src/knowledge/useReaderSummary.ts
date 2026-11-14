import { generateReaderSummary } from "../shared/reader-summary-api";
import type { ReaderSummaryResult } from "../shared/reader-summary-contracts";
import { useReaderOperation, type ReaderOperationOptions } from "./useReaderOperation";

export type ReaderSummaryOptions = ReaderOperationOptions;
export function useReaderSummary(options?: ReaderSummaryOptions) {
  const operation = useReaderOperation<ReaderSummaryResult, void>(options, {
    label: "Summary", run: (config, _input, signal) =>
      generateReaderSummary(config.platform, config.context, crypto.randomUUID(), signal),
  });
  return { ...operation, open: () => operation.open(undefined) };
}
