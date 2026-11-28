import type { PoolClient } from "pg";
import { assertIndexGenerationJob, parseIndexGenerationManifest, type IndexGenerationManifest,
  type IndexGenerationSource } from "../indexing/contracts.js";

export type ReaderSourceRecord = { publishedVersionId: string; documentId: string;
  source: IndexGenerationSource; manifest: IndexGenerationManifest };
export interface ReaderSourceStore {
  resolve(user: string, organization: string, publication: string): Promise<ReaderSourceRecord | null>;
}
type ActorTransaction = <T>(user: string, org: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type SourceRow = { published_version_id: string; shared_draft_id: string; submission_id: string;
  generation_id: string; snapshot_version_id: string; snapshot_content_hash: string;
  content_uri: string; job_id: string; manifest: unknown };

export class PgReaderSourceStore implements ReaderSourceStore {
  constructor(private readonly withActor: ActorTransaction) {}
  async resolve(user: string, organization: string, publication: string): Promise<ReaderSourceRecord | null> {
    return this.withActor(user, organization, async client => {
      const result = await client.query<SourceRow>(`
        SELECT pv.id AS published_version_id, pv.document_id AS shared_draft_id, pv.file_uri AS content_uri, g.review_submission_id AS submission_id,
               g.id AS generation_id, g.snapshot_version_id, g.snapshot_content_hash,
               g.manifest AS manifest, g.manifest->>'jobId' AS job_id
          FROM published_version pv
          JOIN index_generation g ON g.review_submission_id = pv.review_submission_id
            AND g.snapshot_content_hash = pv.content_hash AND g.status = 'READY'
         WHERE g.organization_id = $1 AND pv.id = $2
           AND pv.id IN (SELECT eligible_ai_publications())`, [organization, publication]);
      if (result.rows.length !== 1) return null;
      const row = result.rows[0];
      const source: IndexGenerationSource = { jobId: row.job_id, generationId: row.generation_id,
        organizationId: organization, submissionId: row.submission_id, snapshotVersionId: row.snapshot_version_id,
        snapshotContentHash: row.snapshot_content_hash, sourceUri: row.content_uri,
        mimeType: row.content_uri.endsWith(".pdf") ? "application/pdf" : "text/plain" };
      assertIndexGenerationJob(source);
      return { publishedVersionId: row.published_version_id, documentId: row.shared_draft_id,
        source, manifest: parseIndexGenerationManifest(row.manifest, source) };
    });
  }
}
