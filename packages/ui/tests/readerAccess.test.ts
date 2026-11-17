import { afterEach, expect, it, vi } from "vitest";
import { ReaderAccessInterrupted, ReaderAccessSession } from "../src/knowledge/useReaderAccess";
import * as api from "../src/shared/reader-summary-api";
import { deferred, readerContext } from "./readerSummary.test-support";
afterEach(() => vi.restoreAllMocks());
const session = () => new ReaderAccessSession({ platform: "web", context: readerContext, active: true });

it("coalesces concurrent checks and reuses success only until the next real hidden cycle", async () => {
  const pending = deferred<void>(), check = vi.spyOn(api, "checkReaderSummaryAccess").mockReturnValue(pending.promise);
  const access = session(); await access.check(); expect(check).not.toHaveBeenCalled();
  access.suspend(true); access.suspend(true); access.suspend(false);
  const first = access.check(), second = access.check(true); expect(second).toBe(first);
  expect(check).toHaveBeenCalledOnce(); await pending.resolve(); await first;
  await access.check(); expect(check).toHaveBeenCalledOnce(); expect(access.needsCheck).toBe(false);
  access.suspend(true); access.suspend(false); await access.check(); expect(check).toHaveBeenCalledTimes(2);
});
it.each(["hidden", "stop"])("ignores late successful checks after %s", async mode => {
  const pending = deferred<void>(), check = vi.spyOn(api, "checkReaderSummaryAccess").mockReturnValue(pending.promise);
  const access = session(), work = access.check(true), signal = check.mock.calls[0][2];
  const rejected = expect(work).rejects.toBeInstanceOf(ReaderAccessInterrupted);
  if (mode === "hidden") access.suspend(true); else access.stop();
  expect(signal.aborted).toBe(true); pending.resolve(); await rejected; expect(access.needsCheck).toBe(true);
});
it("does not turn a failed check into a valid checkpoint or silently retry it", async () => {
  const check = vi.spyOn(api, "checkReaderSummaryAccess").mockRejectedValue(new Error("offline"));
  const access = session(); await expect(access.check(true)).rejects.toThrow("offline");
  expect(access.needsCheck).toBe(true); expect(check).toHaveBeenCalledOnce();
});
it("does not probe while hidden or allow known denial to reuse a checkpoint", async () => {
  const check = vi.spyOn(api, "checkReaderSummaryAccess").mockResolvedValue();
  const access = session(); access.suspend(true);
  await expect(access.check()).rejects.toBeInstanceOf(ReaderAccessInterrupted); expect(check).not.toHaveBeenCalled();
  access.suspend(false); expect(access.deny()).toBe(true); expect(access.deny()).toBe(false);
  await expect(access.check()).rejects.toMatchObject({ status: 404 }); expect(check).not.toHaveBeenCalled();
});
it("a late successful probe cannot undo known access loss from another operation", async () => {
  const pending = deferred<void>(); vi.spyOn(api, "checkReaderSummaryAccess").mockReturnValue(pending.promise);
  const access = session(), work = access.check(true);
  const rejected = expect(work).rejects.toMatchObject({ status: 404 });
  access.deny(); pending.resolve(); await rejected;
  expect(access.needsCheck).toBe(true);
});
