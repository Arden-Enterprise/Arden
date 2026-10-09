import { describe, expect, it } from "vitest";
import type { PrivateNote } from "../src/shared/types";
import { createNotePreview, getNoteDraft, isNoteDirty, notePreviewReducer } from "../src/personal-workspace/noteDraftModel";

const sampleNotes: PrivateNote[] = [
  { id: "review", title: "Review questions", body: "Original questions", updatedLabel: "Preview" },
  { id: "handover", title: "Handover", body: "Original handover", updatedLabel: "Preview" },
];

describe("private note preview drafts", () => {
  it("keeps an unsaved draft when selecting another note and returning", () => {
    let state = createNotePreview(sampleNotes);
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "Unsaved questions" });
    state = notePreviewReducer(state, { type: "select", id: "handover" });
    expect(getNoteDraft(state, sampleNotes[1]).body).toBe("Original handover");
    state = notePreviewReducer(state, { type: "select", id: "review" });
    expect(getNoteDraft(state, sampleNotes[0]).body).toBe("Unsaved questions");
    expect(isNoteDirty(state, sampleNotes[0])).toBe(true);
    expect(state.notes[0].body).toBe("Original questions");
  });

  it("saves only the selected note while preserving other drafts", () => {
    let state = createNotePreview(sampleNotes);
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "First draft" });
    state = notePreviewReducer(state, { type: "select", id: "handover" });
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "Second draft" });
    state = notePreviewReducer(state, { type: "save" });
    expect(state.notes[1].body).toBe("Second draft");
    expect(isNoteDirty(state, state.notes[1])).toBe(false);
    expect(getNoteDraft(state, sampleNotes[0]).body).toBe("First draft");
    expect(state.savedMessage).toContain("preview session");
  });

  it("does not mark a reverted edit as dirty", () => {
    let state = createNotePreview(sampleNotes);
    state = notePreviewReducer(state, { type: "edit", field: "title", value: "Changed title" });
    state = notePreviewReducer(state, { type: "edit", field: "title", value: sampleNotes[0].title });
    expect(isNoteDirty(state, sampleNotes[0])).toBe(false);
  });

  it("creating and saving a new note preserves the previous unsaved note", () => {
    let state = createNotePreview(sampleNotes);
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "Keep this draft" });
    state = notePreviewReducer(state, { type: "create", note: { id: "new", title: "Untitled private note", body: "", updatedLabel: "Not saved" } });
    state = notePreviewReducer(state, { type: "edit", field: "title", value: "   " });
    state = notePreviewReducer(state, { type: "save" });
    expect(state.notes[0].title).toBe("Untitled private note");
    expect(state.notes[0].updatedLabel).toBe("Saved in this preview");
    expect(getNoteDraft(state, sampleNotes[0]).body).toBe("Keep this draft");
  });

  it("clears all drafts and saved preview changes when the session resets", () => {
    let state = createNotePreview(sampleNotes);
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "Saved preview edit" });
    state = notePreviewReducer(state, { type: "save" });
    state = notePreviewReducer(state, { type: "edit", field: "body", value: "Unsaved preview edit" });
    state = notePreviewReducer(state, { type: "reset", notes: sampleNotes });
    expect(state.notes).toEqual(sampleNotes);
    expect(state.drafts).toEqual({});
    expect(state.savedMessage).toBe("");
  });

  it("ignores missing selections and handles an empty workspace", () => {
    const state = createNotePreview(sampleNotes);
    expect(notePreviewReducer(state, { type: "select", id: "missing" })).toBe(state);
    const empty = createNotePreview([]);
    expect(notePreviewReducer(empty, { type: "save" })).toBe(empty);
    expect(notePreviewReducer(empty, { type: "edit", field: "body", value: "text" })).toBe(empty);
  });
});
