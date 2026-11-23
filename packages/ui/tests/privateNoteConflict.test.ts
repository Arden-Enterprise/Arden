// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { usePrivateNotes } from "../src/personal-workspace/usePrivateNotes";

afterEach(() => vi.restoreAllMocks());

const note = {
  id: "note", organizationId: "org", title: "Note", body: "Saved text", createdAt: "2026-10-01", updatedAt: "2026-10-01",
  currentVersion: { id: "version", version: 1 }, collectionId: null, favoritedAt: null,
};

it("preserves unsaved edits and gives effective recovery after a note version conflict", async () => {
  const request = vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
    if (init?.method === "PATCH") throw new api.ApiError(409, "Conflict", "VERSION_CONFLICT");
    if (path.includes("/drafts?")) return { items: [note], nextCursor: null };
    if (path.endsWith("/drafts/note")) return note;
    if (path.endsWith("/collections") || path.endsWith("/trash")) return { items: [] };
    throw new Error(`Unexpected ${path}`);
  });
  const { result } = renderHook(() => usePrivateNotes([]));
  await act(() => result.current.connectServer("web", "org"));
  act(() => result.current.openNote("note"));
  act(() => result.current.editBody("Unsaved local edits"));
  await act(() => result.current.save("web", "org"));
  expect(result.current.error).toBe("This note has changed. Copy your edits, then refresh the page.");
  expect(result.current.draft.body).toBe("Unsaved local edits");
  expect(result.current.hasUnsavedDrafts).toBe(true);
  const patch = request.mock.calls.find(([, , init]) => init?.method === "PATCH");
  expect(new Headers(patch?.[2]?.headers).get("If-Match")).toBe('"1"');
  act(() => result.current.discardSelected());
  expect(result.current.draft.body).toBe("Saved text");
  expect(result.current.hasUnsavedDrafts).toBe(false);
  expect(result.current.error).toBe("This note has changed. Copy your edits, then refresh the page.");
  // A conflict does not trigger a reload that could overwrite the draft's base version.
  expect(request.mock.calls.filter(([, path]) => path.includes("/drafts?"))).toHaveLength(1);
});

it("keeps a dirty draft and its base version when the tree is refreshed after a failed action", async () => {
  let listed = { ...note };
  vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
    if (path.endsWith("/favorite")) throw new api.ApiError(500, "Server unavailable");
    if (init?.method === "PATCH") return { ...listed, body: JSON.parse(String(init.body)).body };
    if (path.includes("/drafts?")) return { items: [listed], nextCursor: null };
    if (path.endsWith("/drafts/note")) return listed;
    if (path.endsWith("/collections") || path.endsWith("/trash")) return { items: [] };
    throw new Error(`Unexpected ${path}`);
  });
  const { result } = renderHook(() => usePrivateNotes([]));
  await act(() => result.current.connectServer("web", "org"));
  act(() => result.current.openNote("note"));
  act(() => result.current.editBody("Mine"));
  listed = { ...note, body: "Changed elsewhere", currentVersion: { id: "v2", version: 2 } };
  await act(() => result.current.toggleFavorite({ kind: "note", id: "note" }));
  expect(result.current.actionError).toBe("Server unavailable");
  expect(result.current.draft.body).toBe("Mine");
  expect(result.current.selectedNote?.body).toBe("Saved text");
});
