import { Pool } from "pg";
import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "postgresql://arden:arden_dev_only@127.0.0.1:5433/arden");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in production");
}

const pool = new Pool({ connectionString: databaseUrl });
const app = buildApp(async () => {
  await pool.query("SELECT 1");
});

const port = Number(process.env.ARDEN_API_PORT ?? 3001);
const host = process.env.ARDEN_API_HOST ?? "127.0.0.1";

async function shutdown() {
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ port, host });
