// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { usePrivateNotes } from "../src/personal-workspace/usePrivateNotes";

afterEach(() => vi.restoreAllMocks());

it("preserves unsaved edits and gives effective recovery after a note version conflict", async () => {
  const request = vi.spyOn(api, "apiRequest")
    .mockResolvedValueOnce({ items: [{ id: "note", title: "Note", currentVersion: 1, updatedAt: "2026-10-01" }], nextCursor: null })
    .mockResolvedValueOnce({ id: "note", title: "Note", body: "Saved text", updatedAt: "2026-10-01", currentVersion: { id: "version", version: 1 } })
    .mockRejectedValueOnce(new api.ApiError(409, "Conflict", "VERSION_CONFLICT"));
  const { result } = renderHook(() => usePrivateNotes([]));
  await act(() => result.current.connectServer("web", "org"));
  act(() => result.current.editBody("Unsaved local edits"));
  await act(() => result.current.save("web", "org"));
  expect(result.current.error).toBe("This note has changed. Copy your edits, then refresh the page.");
  expect(result.current.draft.body).toBe("Unsaved local edits");
  expect(result.current.hasUnsavedDrafts).toBe(true);
  expect(request).toHaveBeenCalledTimes(3);
});
