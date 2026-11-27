import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { ProviderUsageEvent } from "../answers/usage-contracts.js";
import type { IndexGenerationJob } from "./contracts.js";
import { indexUsageBatchSize, PgIndexGenerationStore } from "./store.js";

const job = { jobId: "10000000-0000-4000-8000-000000000001" } as IndexGenerationJob;
const workerId = "10000000-0000-4000-8000-000000000009";

function event(index: number): ProviderUsageEvent {
  return { eventId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, operation: "INDEX_EMBEDDING",
    provider: "OPENAI", model: "text-embedding-3-small", inputTokens: 10, outputTokens: 0, latencyMs: 5, usageComplete: true };
}

function recordingPool() {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const client = { query: async (text: string, values?: unknown[]) => { statements.push({ text, values }); return { rows: [] }; },
    release: () => undefined };
  return { pool: { connect: async () => client } as unknown as Pool, statements };
}

describe("index usage persistence", () => {
  it("writes a 64-event manifest in database-sized batches inside one transaction", async () => {
    const { pool, statements } = recordingPool();
    await new PgIndexGenerationStore(pool).recordUsage(job, workerId, Array.from({ length: 64 }, (_, index) => event(index)));
    const writes = statements.filter((statement) => statement.text.includes("record_index_ai_usage"));
    expect(indexUsageBatchSize).toBe(32);
    expect(writes).toHaveLength(2);
    expect(writes.map((write) => (JSON.parse(String(write.values?.[2])) as unknown[]).length)).toEqual([32, 32]);
    expect(statements.filter((statement) => statement.text === "BEGIN")).toHaveLength(1);
    expect(statements.filter((statement) => statement.text === "COMMIT")).toHaveLength(1);
  });

  it("does not open a transaction when there is nothing to record", async () => {
    const { pool, statements } = recordingPool();
    await new PgIndexGenerationStore(pool).recordUsage(job, workerId, []);
    expect(statements).toHaveLength(0);
  });
});
