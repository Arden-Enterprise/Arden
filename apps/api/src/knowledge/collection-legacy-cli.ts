import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { inventoryCollectionLegacy, migrateCollectionLegacy, parseCollectionLegacyPlan } from "./collection-legacy.js";

export function assertCollectionRehearsalTarget(value: string, environment: string | undefined): void {
  const url = new URL(value);
  if (environment === "production" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash
    || !/^\/arden_test_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Collection tooling is restricted to local disposable rehearsal");
}

async function main(args: string[]): Promise<void> {
  const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL ?? "";
  assertCollectionRehearsalTarget(databaseUrl, process.env.NODE_ENV);
  const [mode, subject, actor] = args;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!subject || !((mode === "--inventory" && args.length === 2 && uuid.test(subject))
    || (mode === "--apply" && args.length === 3 && actor && uuid.test(actor)))) throw new Error("Use --inventory organizationId or --apply private-plan.json actorMembershipId");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      if (mode === "--inventory") {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          const result = await inventoryCollectionLegacy(client, subject);
          await client.query("COMMIT"); console.log(JSON.stringify(result));
        } catch (error) { await client.query("ROLLBACK"); throw error; }
      } else {
        if ((await stat(subject)).size > 20_000_000) throw new Error("Plan too large");
        const info = await readFile(subject, "utf8");
        const plan = parseCollectionLegacyPlan(JSON.parse(info));
        console.log(JSON.stringify(await migrateCollectionLegacy(client, plan, actor!)));
      }
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error("Collection rehearsal failed; no success is claimed. Check the reviewed plan and disposable target."); process.exitCode = 1; });
}
