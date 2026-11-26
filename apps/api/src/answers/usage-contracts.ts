import { createHash } from "node:crypto";

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

/** Keys that an Arden-AI response may carry; older services omit both. */
export const usageEnvelopeKeys = ["usageContractVersion", "usageEvents"] as const;
export const maxUsageEventsPerResponse = 64;
const postgresIntegerMaximum = 2_147_483_647;

export class UsageContractError extends Error {
  constructor(message: string) { super(message); this.name = "UsageContractError"; }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operations = new Set<UsageOperation>([
  "CHAT_RETRIEVAL", "CHAT_GENERATION", "READER_QUESTION_RETRIEVAL",
  "READER_QUESTION_GENERATION", "READER_SUMMARY", "INDEX_EMBEDDING", "MAINTENANCE_ANALYSIS",
]);
const eventKeys = ["eventId", "inputTokens", "latencyMs", "model", "operation", "outputTokens", "provider", "usageComplete"]
  .sort().join();

export function parseUsageEvents(value: unknown, allowed: UsageOperation[]): ProviderUsageEvent[] {
  if (!Array.isArray(value) || value.length > maxUsageEventsPerResponse) throw new UsageContractError("invalid provider usage event list");
  const seen = new Set<string>();
  return value.map((item): ProviderUsageEvent => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new UsageContractError("invalid provider usage event");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join() !== eventKeys) throw new UsageContractError("invalid provider usage event fields");
    if (typeof row.eventId !== "string" || !uuid.test(row.eventId) || seen.has(row.eventId)
      || typeof row.operation !== "string" || !operations.has(row.operation as UsageOperation)
      || !allowed.includes(row.operation as UsageOperation)
      || typeof row.provider !== "string" || !/^[A-Z0-9_-]{1,80}$/.test(row.provider)
      || typeof row.model !== "string" || !row.model.trim() || row.model.length > 120
      || typeof row.usageComplete !== "boolean") throw new UsageContractError("invalid provider usage event values");
    const count = (item: unknown, maximum = Number.MAX_SAFE_INTEGER) => item === null ? null
      : typeof item === "number" && Number.isSafeInteger(item) && item >= 0 && item <= maximum ? item : undefined;
    const inputTokens = count(row.inputTokens), outputTokens = count(row.outputTokens);
    const latencyMs = count(row.latencyMs, postgresIntegerMaximum);
    if (inputTokens === undefined || outputTokens === undefined || latencyMs === undefined
      || (row.usageComplete && (inputTokens === null || outputTokens === null))) {
      throw new UsageContractError("invalid provider usage counts");
    }
    seen.add(row.eventId);
    return { eventId: row.eventId, operation: row.operation as UsageOperation,
      provider: row.provider, model: row.model, inputTokens, outputTokens, latencyMs,
      usageComplete: row.usageComplete };
  });
}

export function usageContractVersion(value: unknown): void {
  if (value !== 1) throw new UsageContractError("unsupported provider usage contract");
}

/**
 * A deterministic incomplete-usage marker. Missing provider telemetry is stored as
 * `usageComplete: false` so reports show incomplete usage instead of a zero cost, and a
 * retried operation reuses the same idempotency key instead of adding another row.
 */
export function incompleteUsageMarker(scopeId: string, operation: UsageOperation): ProviderUsageEvent {
  const digest = createHash("sha256").update(`arden:usage-missing:${scopeId}:${operation}`, "utf8").digest("hex");
  const variant = ((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const eventId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return { eventId, operation, provider: "UNREPORTED", model: "unreported",
    inputTokens: null, outputTokens: null, latencyMs: null, usageComplete: false };
}

export type UsageEnvelopeOptions = {
  /** Identifier that scopes the deterministic marker: a request, run or job identifier. */
  scopeId: string;
  allowed: UsageOperation[];
  /** Operation recorded when the service omitted or malformed its usage data. */
  fallback: UsageOperation;
  /** True when a successful call always involves a provider, so an empty list is missing telemetry. */
  providerCallRequired: boolean;
};

/**
 * Rollout-tolerant reading of the optional usage envelope. An older Arden-AI service that
 * omits the envelope, or a malformed envelope, yields an incomplete marker; it never fails
 * the user's answer, summary, analysis or index generation.
 */
export function readUsageEnvelope(row: Record<string, unknown>, options: UsageEnvelopeOptions): ProviderUsageEvent[] {
  const marker = () => [incompleteUsageMarker(options.scopeId, options.fallback)];
  if (row.usageContractVersion === undefined && row.usageEvents === undefined) return marker();
  try {
    usageContractVersion(row.usageContractVersion);
    const events = parseUsageEvents(row.usageEvents, options.allowed);
    return !events.length && options.providerCallRequired ? marker() : events;
  } catch (error) {
    if (error instanceof UsageContractError) return marker();
    throw error;
  }
}

/** Keys of a service response without the optional usage envelope, for exact-key contract checks. */
export function keysWithoutUsageEnvelope(value: object): string[] {
  return Object.keys(value).filter((key) => !(usageEnvelopeKeys as readonly string[]).includes(key));
}

export type UsageTelemetryFailure = (error: unknown) => void;

/**
 * Usage telemetry is operational metadata. A failed write is reported to the caller's
 * sanitized logger and does not fail or roll back the user-facing operation.
 */
export async function recordUsageBestEffort(write: () => Promise<boolean | void>,
  onFailure: UsageTelemetryFailure | undefined): Promise<void> {
  try {
    if (await write() === false) onFailure?.(new Error("AI usage metadata was not recorded"));
  } catch (error) {
    onFailure?.(error);
  }
}
