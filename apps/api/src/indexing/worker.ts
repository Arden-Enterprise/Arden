import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { ArdenAiRequestError, type IndexGenerationClient } from "./ai-client.js";
import { buildIndexGenerationRequest, IndexContractError, type IndexGenerationJob } from "./contracts.js";
import type { IndexGenerationStore } from "./store.js";

export type IndexingWorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export class IndexingWorker {
  constructor(
    private readonly workerId: string,
    private readonly leaseSeconds: number,
    private readonly store: IndexGenerationStore,
    private readonly storage: PrivateContentStorage,
    private readonly ai: IndexGenerationClient,
    private readonly logger: IndexingWorkerLogger,
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.store.claim(this.workerId, this.leaseSeconds);
    if (!job) return false;
    try {
      if (job.mimeType !== "text/plain") throw new WorkerFailure("UNSUPPORTED_SNAPSHOT_MIME_TYPE", false);
      const snapshot = await this.storage.read(job.sourceUri, job.snapshotContentHash);
      const request = buildIndexGenerationRequest(job, snapshot);
      const manifest = await this.ai.index(request, job);
      const publishedVersionId = await this.store.complete(job, this.workerId, manifest);
      this.logger.info({ jobId: job.jobId, generationId: job.generationId, publishedVersionId },
        "Knowledge index generation activated");
    } catch (error) {
      const failure = classifyFailure(error);
      const status = await this.store.fail(job, this.workerId, failure.code, failure.retryable);
      this.logger.error({ jobId: job.jobId, generationId: job.generationId, errorCode: failure.code,
        retryable: failure.retryable, status }, "Knowledge index generation failed");
    }
    return true;
  }
}

class WorkerFailure extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); }
}

function classifyFailure(error: unknown): WorkerFailure {
  if (error instanceof WorkerFailure) return error;
  if (error instanceof ArdenAiRequestError) return new WorkerFailure(error.code, error.retryable);
  if (error instanceof IndexContractError) return new WorkerFailure(error.code, false);
  if (error instanceof Error && error.message === "Private content integrity check failed") {
    return new WorkerFailure("SNAPSHOT_INTEGRITY_FAILURE", false);
  }
  return new WorkerFailure("INDEXING_UNEXPECTED_FAILURE", true);
}

export function workerJobFields(job: IndexGenerationJob): Record<string, unknown> {
  return { jobId: job.jobId, generationId: job.generationId, attemptCount: job.attemptCount };
}
