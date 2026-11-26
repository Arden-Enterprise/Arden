import type { PoolClient } from "pg";
import type { ProviderUsageEvent } from "../answers/usage-contracts.js";

/**
 * One AI usage row priced from the current price book. Every parameter is cast where it
 * first appears so PostgreSQL infers one type per parameter. `ON CONFLICT DO NOTHING` has
 * no conflict target on purpose: an arbiter column makes PostgreSQL apply the table's
 * SELECT policies to the proposed row, and tenant sessions intentionally have no SELECT
 * policy on `ai_usage_event`. The unique `idempotency_key` still discards retried events.
 */
const insertAiUsageEventSql = `INSERT INTO ai_usage_event(organization_id, request_id, idempotency_key,
    operation, provider, model, input_tokens, output_tokens, latency_ms, usage_complete,
    estimated_cost_micro_usd, price_book_version)
  SELECT $1::uuid, $2::uuid, $2::uuid::text || ':' || $3::text, $4::text, $5::text, $6::text,
    $7::bigint, $8::bigint, $9::integer, $10::boolean,
    CASE WHEN $10::boolean AND price.price_book_version IS NOT NULL THEN
      ceil(($7::bigint::numeric * price.input_micro_usd_per_million_tokens
        + $8::bigint::numeric * price.output_micro_usd_per_million_tokens) / 1000000)::bigint END,
    price.price_book_version
  FROM (SELECT 1) seed LEFT JOIN LATERAL (
    SELECT pb.price_book_version, pb.input_micro_usd_per_million_tokens,
      pb.output_micro_usd_per_million_tokens
    FROM ai_price_book pb WHERE pb.provider = $5::text AND pb.model = $6::text
      AND pb.effective_from <= now() AND (pb.effective_until IS NULL OR pb.effective_until > now())
    ORDER BY pb.effective_from DESC LIMIT 1) price ON true
  ON CONFLICT DO NOTHING`;

/**
 * Writes usage inside the caller's transaction behind a savepoint. A failed usage write is
 * rolled back to the savepoint and reported as `false`, leaving the caller's own work intact.
 */
export async function insertAiUsageEvents(client: PoolClient, organizationId: string, requestId: string,
  events: readonly ProviderUsageEvent[]): Promise<boolean> {
  if (!events.length) return true;
  await client.query("SAVEPOINT arden_ai_usage");
  try {
    for (const event of events) {
      await client.query(insertAiUsageEventSql, [organizationId, requestId, event.eventId,
        event.operation, event.provider, event.model, event.inputTokens, event.outputTokens,
        event.latencyMs, event.usageComplete]);
    }
    await client.query("RELEASE SAVEPOINT arden_ai_usage");
    return true;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT arden_ai_usage");
    await client.query("RELEASE SAVEPOINT arden_ai_usage");
    return false;
  }
}
