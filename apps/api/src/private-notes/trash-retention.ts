import type { PrivateContentStorage } from "./content-storage.js";
import type { PrivateTrashRetentionStore, PurgedPrivateContent } from "./organization-store.js";

/** Decision 0029: trash batches are permanently deleted after 30 days. */
export const privateTrashRetentionDays = 30;
export const privateTrashRetentionIntervalMs = 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

type Logger = {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export function privateTrashPurgeAfter(trashedAt: Date): Date {
  return new Date(trashedAt.getTime() + privateTrashRetentionDays * dayMs);
}

/**
 * Erases the content objects of tombstoned notes after their database purge
 * committed. A failed removal is logged and left for the hourly retention run;
 * the tombstone is never reverted. Returns notes whose objects are all gone.
 */
export async function erasePurgedContent(storage: Pick<PrivateContentStorage, "remove">, content: PurgedPrivateContent,
  log: Pick<Logger, "error">): Promise<string[]> {
  const erased: string[] = [];
  for (const item of content) {
    let complete = true;
    for (const sourceUri of item.sourceUris) {
      try {
        await storage.remove(sourceUri);
      } catch (error) {
        complete = false;
        log.error({ errorType: error instanceof Error ? error.name : "UnknownError" },
          "Private note content erasure failed; it will be retried");
      }
    }
    if (complete) erased.push(item.draftId);
  }
  return erased;
}

export class PrivateTrashRetention {
  private readonly now: () => Date;
  private readonly batchLimit: number;

  constructor(private readonly store: PrivateTrashRetentionStore, private readonly storage: Pick<PrivateContentStorage, "remove">,
    private readonly log: Logger, options: { now?: () => Date; batchLimit?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.batchLimit = options.batchLimit ?? 100;
  }

  /** Purges expired batches, then erases pending content of all tombstoned notes. */
  async runOnce(): Promise<{ purgedBatches: number; erasedNotes: number; pendingNotes: number }> {
    const cutoff = new Date(this.now().getTime() - privateTrashRetentionDays * dayMs);
    const { purgedBatches, content } = await this.store.purgeExpired(cutoff, this.batchLimit);
    const erased = await erasePurgedContent(this.storage, content, this.log);
    await this.store.markContentErased(erased);
    const result = { purgedBatches, erasedNotes: erased.length, pendingNotes: content.length - erased.length };
    if (purgedBatches || content.length) this.log.info(result, "Private trash retention run completed");
    return result;
  }
}

type TimerHandle = { unref?: () => void };

/** Runs retention now and then every interval until stopped; failures are logged and retried next interval. */
export function startPrivateTrashRetentionLoop(retention: Pick<PrivateTrashRetention, "runOnce">, log: Pick<Logger, "error">,
  options: {
    intervalMs?: number; initialDelayMs?: number;
    setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimer?: (handle: TimerHandle) => void;
  } = {}): { stop(): void } {
  const intervalMs = options.intervalMs ?? privateTrashRetentionIntervalMs;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let stopped = false;
  let handle: TimerHandle | undefined;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    handle = setTimer(() => {
      void retention.runOnce()
        .catch((error: unknown) => log.error({ errorType: error instanceof Error ? error.name : "UnknownError" },
          "Private trash retention run failed"))
        .finally(() => schedule(intervalMs));
    }, delayMs);
    handle.unref?.();
  };
  schedule(options.initialDelayMs ?? 60_000);
  return {
    stop() {
      stopped = true;
      if (handle) clearTimer(handle);
    },
  };
}
