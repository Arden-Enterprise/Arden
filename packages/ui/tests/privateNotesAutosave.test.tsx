// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AUTOSAVE_DELAY_MS, usePrivateNotes, type PrivateNotesController } from "../src/personal-workspace/usePrivateNotes";
import { createNotePreview, notePreviewReducer } from "../src/personal-workspace/noteDraftModel";
import type { PrivateNote } from "../src/shared/types";

/** Decision 0030: private notes save themselves shortly after typing stops. */
let controllerRef: PrivateNotesController;
function Harness({ seed }: { seed: PrivateNote[] }) {
  controllerRef = usePrivateNotes(seed, []);
  return null;
}
const notes: PrivateNote[] = [
  { id: "n1", title: "First", body: "one", updatedLabel: "Saved" },
  { id: "n2", title: "Second", body: "two", updatedLabel: "Saved" },
];
const record = (id: string, title: string, body: string, version: number) => ({
  id, organizationId: "org", title, body, createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z",
  currentVersion: { id: `${id}-v`, version }, collectionId: null, favoritedAt: null, position: null,
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("saved reducer", () => {
  it("keeps a draft that changed while its save was in flight", () => {
    let state = createNotePreview(notes);
    state = notePreviewReducer(state, { type: "select", id: "n1" });
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "one more" });
    const sent = { title: "First", body: "one more" };
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "one more and more" });
    const saved = notePreviewReducer(state, { type: "saved", previousId: "n1", note: { ...notes[0]!, body: "one more" }, sent });
    expect(saved.drafts.n1).toEqual({ title: "First", body: "one more and more" });
    const caughtUp = notePreviewReducer(saved, { type: "saved", previousId: "n1", note: { ...notes[0]!, body: "one more and more" },
      sent: { title: "First", body: "one more and more" } });
    expect(caughtUp.drafts.n1).toBeUndefined();
  });
});

describe("autosave", () => {
  it("saves after typing pauses, not before, in the in-browser demo", async () => {
    render(createElement(Harness, { seed: notes }));
    act(() => controllerRef.openNote("n1"));
    act(() => controllerRef.editBody("one, edited"));
    act(() => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100); });
    expect(controllerRef.isDirty).toBe(true);
    act(() => controllerRef.editBody("one, edited again"));
    act(() => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100); });
    expect(controllerRef.isDirty).toBe(true);
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    expect(controllerRef.isDirty).toBe(false);
    expect(controllerRef.selectedNote?.body).toBe("one, edited again");
  });

  it("keeps typing made during a save, then saves it with the new version", async () => {
    const patches: Array<{ ifMatch: string; body: unknown }> = [];
    let release: (() => void) | null = null;
    vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) return { items: [record("n1", "First", "one", 1)], nextCursor: null };
      if (method === "GET" && path.endsWith("/drafts/n1")) return record("n1", "First", "one", 1);
      if (method === "GET" && (path.endsWith("/collections") || path.endsWith("/trash"))) return { items: [] };
      if (method === "PATCH") {
        const body = JSON.parse(String(init!.body));
        patches.push({ ifMatch: (init!.headers as Record<string, string>)["If-Match"]!, body });
        if (patches.length === 1) await new Promise<void>((resolve) => { release = resolve; });
        return record("n1", body.title, body.body, patches.length + 1);
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(createElement(Harness, { seed: [] }));
    await act(() => controllerRef.connectServer("web", "org"));
    act(() => controllerRef.openNote("n1"));
    act(() => controllerRef.editBody("one two"));
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS); });
    expect(controllerRef.autosaving).toBe(true);
    act(() => controllerRef.editBody("one two three"));
    await act(async () => { release!(); });
    await flush();
    expect(controllerRef.isDirty).toBe(true);
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS); });
    await flush();
    expect(patches).toEqual([
      { ifMatch: '"1"', body: { title: "First", body: "one two" } },
      { ifMatch: '"2"', body: { title: "First", body: "one two three" } },
    ]);
    expect(controllerRef.isDirty).toBe(false);
  });

  it("saves at once when another note is opened", async () => {
    render(createElement(Harness, { seed: notes }));
    act(() => controllerRef.openNote("n1"));
    act(() => controllerRef.editBody("changed before switching"));
    await act(async () => controllerRef.openNote("n2"));
    await flush();
    expect(controllerRef.state.notes.find((note) => note.id === "n1")?.body).toBe("changed before switching");
    expect(controllerRef.state.drafts.n1).toBeUndefined();
  });

  it("stops autosaving a note after a version conflict until the user saves again", async () => {
    let patches = 0;
    vi.spyOn(api, "apiRequest").mockImplementation(async (_platform, path, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && path.includes("/drafts?")) return { items: [record("n1", "First", "one", 1)], nextCursor: null };
      if (method === "GET" && path.endsWith("/drafts/n1")) return record("n1", "First", "one", 1);
      if (method === "GET" && (path.endsWith("/collections") || path.endsWith("/trash"))) return { items: [] };
      if (method === "PATCH") { patches += 1; throw new api.ApiError(412, "Changed", "VERSION_CONFLICT"); }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(createElement(Harness, { seed: [] }));
    await act(() => controllerRef.connectServer("web", "org"));
    act(() => controllerRef.openNote("n1"));
    act(() => controllerRef.editBody("mine"));
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS); });
    await flush();
    expect(controllerRef.error).toMatch(/This note has changed/);
    act(() => controllerRef.editBody("mine, more"));
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3); });
    await flush();
    expect(patches).toBe(1);
    expect(controllerRef.isDirty).toBe(true);
    await act(() => controllerRef.save());
    expect(patches).toBe(2);
  });
});
