import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { HttpArdenAiClient } from "./ai-client.js";
import { PgIndexGenerationStore } from "./store.js";
import { IndexingWorker } from "./worker.js";
import { LocalPrivateContentStorage } from "../private-notes/content-storage.js";

const databaseUrl = requiredEnvironment("DATABASE_URL");
const aiUrl = requiredEnvironment("ARDEN_AI_URL");
const serviceToken = requiredEnvironment("ARDEN_AI_SERVICE_TOKEN");
const storageRoot = process.env.ARDEN_PRIVATE_STORAGE_ROOT
  ?? (process.env.NODE_ENV === "production" ? undefined : resolve(process.cwd(), "../../.private/note-content"));
if (!storageRoot) throw new Error("ARDEN_PRIVATE_STORAGE_ROOT is required in production");

const pollMilliseconds = boundedInteger("ARDEN_INDEX_POLL_MS", 1_000, 100, 30_000);
const leaseSeconds = boundedInteger("ARDEN_INDEX_LEASE_SECONDS", 180, 15, 600);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const worker = new IndexingWorker(
  randomUUID(),
  leaseSeconds,
  new PgIndexGenerationStore(pool),
  new LocalPrivateContentStorage(storageRoot),
  new HttpArdenAiClient(aiUrl, serviceToken),
  console,
);
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

try {
  while (!stopping) {
    try {
      if (!await worker.runOnce()) await delay(pollMilliseconds);
    } catch (error) {
      console.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Index worker iteration failed");
      await delay(Math.max(pollMilliseconds, 1_000));
    }
  }
} finally {
  await pool.end();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
