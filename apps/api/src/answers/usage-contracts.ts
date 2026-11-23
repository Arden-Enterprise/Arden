export type UsageOperation = "CHAT_RETRIEVAL" | "CHAT_GENERATION" | "READER_QUESTION_RETRIEVAL"
  | "READER_QUESTION_GENERATION" | "READER_SUMMARY" | "INDEX_EMBEDDING" | "MAINTENANCE_ANALYSIS";

export type ProviderUsageEvent = {
  eventId: string;
  operation: UsageOperation;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  usageComplete: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operations = new Set<UsageOperation>([
  "CHAT_RETRIEVAL", "CHAT_GENERATION", "READER_QUESTION_RETRIEVAL",
  "READER_QUESTION_GENERATION", "READER_SUMMARY", "INDEX_EMBEDDING", "MAINTENANCE_ANALYSIS",
]);

export function parseUsageEvents(value: unknown, allowed: UsageOperation[]): ProviderUsageEvent[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("invalid provider usage event list");
  const seen = new Set<string>();
  return value.map((item): ProviderUsageEvent => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid provider usage event");
    const row = item as Record<string, unknown>;
    const keys = Object.keys(row).sort().join();
    if (keys !== ["eventId", "inputTokens", "latencyMs", "model", "operation", "outputTokens", "provider", "usageComplete"].sort().join()) {
      throw new Error("invalid provider usage event fields");
    }
    if (typeof row.eventId !== "string" || !uuid.test(row.eventId) || seen.has(row.eventId)
      || typeof row.operation !== "string" || !operations.has(row.operation as UsageOperation)
      || !allowed.includes(row.operation as UsageOperation)
      || typeof row.provider !== "string" || !/^[A-Z0-9_-]{1,80}$/.test(row.provider)
      || typeof row.model !== "string" || !row.model.trim() || row.model.length > 120
      || typeof row.usageComplete !== "boolean") throw new Error("invalid provider usage event values");
    const count = (item: unknown) => item === null ? null
      : typeof item === "number" && Number.isSafeInteger(item) && item >= 0 ? item : undefined;
    const inputTokens = count(row.inputTokens), outputTokens = count(row.outputTokens), latencyMs = count(row.latencyMs);
    if (inputTokens === undefined || outputTokens === undefined || latencyMs === undefined
      || (row.usageComplete && (inputTokens === null || outputTokens === null))) {
      throw new Error("invalid provider usage counts");
    }
    seen.add(row.eventId);
    return { eventId: row.eventId, operation: row.operation as UsageOperation,
      provider: row.provider, model: row.model, inputTokens, outputTokens, latencyMs,
      usageComplete: row.usageComplete };
  });
}

export function usageContractVersion(value: unknown): void {
  if (value !== 1) throw new Error("unsupported provider usage contract");
}
