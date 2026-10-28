import type { Pool, PoolClient } from "pg";
import type { IndexGenerationJob, IndexGenerationManifest } from "./contracts.js";
import { assertIndexGenerationJob } from "./contracts.js";

type ClaimedJobRow = {
  job_id: string;
  generation_id: string;
  organization_id: string;
  submission_id: string;
  snapshot_version_id: string;
  snapshot_content_hash: string;
  source_uri: string;
  mime_type: string;
  attempt_count: number;
  max_attempts: number;
};

export interface IndexGenerationStore {
  claim(workerId: string, leaseSeconds: number): Promise<IndexGenerationJob | null>;
  complete(job: IndexGenerationJob, workerId: string, manifest: IndexGenerationManifest): Promise<string>;
  fail(job: IndexGenerationJob, workerId: string, errorCode: string, retryable: boolean): Promise<"PENDING" | "FAILED">;
}

export class PgIndexGenerationStore implements IndexGenerationStore {
  constructor(private readonly pool: Pool) {}

  async claim(workerId: string, leaseSeconds: number): Promise<IndexGenerationJob | null> {
    return this.transaction(async (client) => {
      const result = await client.query<ClaimedJobRow>(
        "SELECT * FROM claim_knowledge_index_job($1, $2)", [workerId, leaseSeconds],
      );
      const row = result.rows[0];
      if (!row) return null;
      const job: IndexGenerationJob = {
        jobId: row.job_id,
        generationId: row.generation_id,
        organizationId: row.organization_id,
        submissionId: row.submission_id,
        snapshotVersionId: row.snapshot_version_id,
        snapshotContentHash: row.snapshot_content_hash,
        sourceUri: row.source_uri,
        mimeType: row.mime_type,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
      assertIndexGenerationJob(job);
      return job;
    });
  }

  async complete(job: IndexGenerationJob, workerId: string, manifest: IndexGenerationManifest): Promise<string> {
    return this.transaction(async (client) => {
      const result = await client.query<{ published_version_id: string }>(
        "SELECT complete_knowledge_index_job($1, $2, $3::jsonb) AS published_version_id",
        [job.jobId, workerId, JSON.stringify(manifest)],
      );
      const id = result.rows[0]?.published_version_id;
      if (!id) throw new Error("Index activation returned no publication id");
      return id;
    });
  }

  async fail(job: IndexGenerationJob, workerId: string, errorCode: string,
    retryable: boolean): Promise<"PENDING" | "FAILED"> {
    return this.transaction(async (client) => {
      const result = await client.query<{ status: "PENDING" | "FAILED" }>(
        "SELECT fail_knowledge_index_job($1, $2, $3, $4) AS status",
        [job.jobId, workerId, errorCode, retryable],
      );
      const status = result.rows[0]?.status;
      if (status !== "PENDING" && status !== "FAILED") throw new Error("Index failure transition returned no status");
      return status;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_indexer");
      await client.query("SET LOCAL search_path TO arden, public");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
