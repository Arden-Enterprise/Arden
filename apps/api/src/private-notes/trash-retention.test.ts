import { describe, expect, it, vi } from "vitest";
import type { PrivateTrashRetentionStore, PurgedPrivateContent } from "./organization-store.js";
import { erasePurgedContent, PrivateTrashRetention, privateTrashPurgeAfter, startPrivateTrashRetentionLoop } from "./trash-retention.js";

const log = { info: vi.fn(), error: vi.fn() };

function store(content: PurgedPrivateContent, purgedBatches = 1) {
  const calls: { cutoff: Date; limit: number }[] = [];
  const marked: string[][] = [];
  const retentionStore: PrivateTrashRetentionStore = {
    async purgeExpired(cutoff, batchLimit) { calls.push({ cutoff, limit: batchLimit }); return { purgedBatches, content }; },
    async markContentErased(draftIds) { marked.push(draftIds); },
  };
  return { retentionStore, calls, marked };
}

describe("private trash retention (decision 0029)", () => {
  it("purges batches trashed more than 30 days before the injected clock and marks erased notes", async () => {
    const { retentionStore, calls, marked } = store([
      { draftId: "note-a", sourceUris: ["arden-private-object://a"] },
      { draftId: "note-b", sourceUris: ["arden-private-object://b1", "arden-private-object://b2"] },
    ]);
    const removed: string[] = [];
    const retention = new PrivateTrashRetention(retentionStore, { remove: async (uri) => { removed.push(uri); } }, log,
      { now: () => new Date("2026-12-31T12:00:00.000Z"), batchLimit: 7 });
    expect(await retention.runOnce()).toEqual({ purgedBatches: 1, erasedNotes: 2, pendingNotes: 0 });
    expect(calls).toEqual([{ cutoff: new Date("2026-12-01T12:00:00.000Z"), limit: 7 }]);
    expect(removed).toEqual(["arden-private-object://a", "arden-private-object://b1", "arden-private-object://b2"]);
    expect(marked).toEqual([["note-a", "note-b"]]);
  });

  it("leaves a note pending (never resurrected) when one of its objects cannot be removed", async () => {
    const errors = vi.fn();
    const erased = await erasePurgedContent({
      remove: async (uri) => { if (uri.endsWith("b2")) throw new Error("disk unavailable"); },
    }, [
      { draftId: "note-a", sourceUris: ["arden-private-object://a"] },
      { draftId: "note-b", sourceUris: ["arden-private-object://b1", "arden-private-object://b2"] },
    ], { error: errors });
    expect(erased).toEqual(["note-a"]);
    expect(errors).toHaveBeenCalledOnce();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("arden-private-object");
  });

  it("states purgeAfter as exactly 30 days after trashing", () => {
    expect(privateTrashPurgeAfter(new Date("2026-11-23T10:00:00.000Z")).toISOString()).toBe("2026-12-23T10:00:00.000Z");
  });

  it("reschedules hourly after success and failure, and stops cleanly", async () => {
    const timers: { callback: () => void; delayMs: number }[] = [];
    const cleared: unknown[] = [];
    const runOnce = vi.fn<() => Promise<{ purgedBatches: number; erasedNotes: number; pendingNotes: number }>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ purgedBatches: 0, erasedNotes: 0, pendingNotes: 0 });
    const errors = vi.fn();
    const loop = startPrivateTrashRetentionLoop({ runOnce }, { error: errors }, {
      intervalMs: 3_600_000, initialDelayMs: 5,
      setTimer: (callback, delayMs) => { const handle = { callback, delayMs, unref: vi.fn() }; timers.push(handle); return handle; },
      clearTimer: (handle) => cleared.push(handle),
    });
    expect(timers.map((timer) => timer.delayMs)).toEqual([5]);
    timers[0]!.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(errors).toHaveBeenCalledWith({ errorType: "Error" }, "Private trash retention run failed");
    expect(timers[1]!.delayMs).toBe(3_600_000);
    timers[1]!.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(3));
    loop.stop();
    expect(cleared).toEqual([timers[2]]);
    timers[2]!.callback();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(3));
    expect(timers).toHaveLength(3);
  });
});
