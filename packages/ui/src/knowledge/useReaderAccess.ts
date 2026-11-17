import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError } from "../shared/api-client";
import { checkReaderSummaryAccess } from "../shared/reader-summary-api";
import type { ReaderSummaryContext } from "../shared/reader-summary-contracts";
import type { Platform } from "../shared/types";

export type ReaderAccessOptions = { platform: Platform; context: ReaderSummaryContext; active: boolean };
export class ReaderAccessInterrupted extends Error {}

/** One ephemeral access checkpoint for the exact mounted reader, not a server read grant. */
export class ReaderAccessSession {
  readonly key: string | null;
  hidden = false;
  private epoch = 0;
  private checkedEpoch = 0;
  private revision = 0;
  private denied = false;
  private listeners = new Set<() => void>();
  private pending: { controller: AbortController; work: Promise<void> } | null = null;

  constructor(private readonly options: ReaderAccessOptions | undefined) {
    this.key = readerAccessKey(options);
  }
  get needsCheck() { return this.denied || this.checkedEpoch !== this.epoch; }
  snapshot = () => this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.revision++; this.listeners.forEach(listener => listener()); }
  private interrupt() { this.epoch++; this.pending?.controller.abort(); this.pending = null; }
  suspend(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) this.interrupt();
    this.notify();
  }
  stop() { if (this.pending) this.interrupt(); }
  deny() {
    if (this.denied) return false;
    this.denied = true; this.checkedEpoch = -1; this.notify();
    return true;
  }
  check = (force = false): Promise<void> => {
    if (!this.key || !this.options || this.denied) return Promise.reject(new ApiError(404, "This document is unavailable."));
    if (this.hidden) return Promise.reject(new ReaderAccessInterrupted());
    if (this.pending) return this.pending.work;
    if (!force && !this.needsCheck) return Promise.resolve();
    const epoch = this.epoch, controller = new AbortController();
    this.checkedEpoch = -1;
    const work = checkReaderSummaryAccess(this.options.platform, this.options.context, controller.signal)
      .then(() => {
        if (this.epoch !== epoch) throw new ReaderAccessInterrupted();
        if (this.denied) throw new ApiError(404, "This document is unavailable.");
        this.checkedEpoch = epoch;
      }).catch((cause: unknown) => {
        if (this.epoch !== epoch) throw new ReaderAccessInterrupted();
        throw cause;
      }).finally(() => {
        if (this.pending?.controller === controller) { this.pending = null; this.notify(); }
      });
    this.pending = { controller, work };
    this.notify();
    return work;
  };
}

function readerAccessKey(options?: ReaderAccessOptions) {
  return options?.active ? JSON.stringify([options.platform, options.context.organizationId,
    options.context.documentId, options.context.versionId, options.context.contentHash]) : null;
}

export function useReaderAccess(options?: ReaderAccessOptions) {
  const key = readerAccessKey(options);
  // Equal scalar identities deliberately retain one session across parent renders/panels.
  const session = useMemo(() => new ReaderAccessSession(options), [key]);
  useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => {
    const visibility = () => session.suspend(document.visibilityState === "hidden");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); session.stop(); };
  }, [session]);
  return session;
}
