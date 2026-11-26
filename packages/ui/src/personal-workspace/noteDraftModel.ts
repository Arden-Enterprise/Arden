import type { PrivateNote } from "../shared/types";

export type NoteDraft = { title: string; body: string };
export type NotePreviewState = {
  notes: PrivateNote[];
  selectedId: string;
  drafts: Record<string, NoteDraft>;
  savedMessage: string;
};

export type NotePreviewAction =
  | { type: "select"; id: string }
  | { type: "create"; note: PrivateNote }
  | { type: "edit"; field: keyof NoteDraft; value: string }
  | { type: "save" }
  | { type: "discard" }
  | { type: "reset"; notes: PrivateNote[] }
  /** Replaces notes by id (new ones go first) without touching any draft. */
  | { type: "upsert"; notes: PrivateNote[] }
  /**
   * Replaces a saved note (a pending id may become the server id) and clears its draft. With `sent`, a draft
   * that changed while the save was in flight is kept (under the new id) so typing during an autosave is not lost.
   */
  | { type: "saved"; previousId: string; note: PrivateNote; sent?: NoteDraft }
  /** Drops notes and their drafts, for example after moving them to trash. */
  | { type: "remove"; ids: string[] }
  /** Reloaded notes; notes with unsaved drafts and never-saved notes keep their local state. */
  | { type: "merge"; notes: PrivateNote[] }
  | { type: "draftTitle"; id: string; title: string }
  | { type: "deselect" };

export function createNotePreview(notes: PrivateNote[]): NotePreviewState {
  return { notes, selectedId: notes[0]?.id ?? "", drafts: {}, savedMessage: "" };
}

export function getNoteDraft(state: NotePreviewState, note: PrivateNote): NoteDraft {
  return state.drafts[note.id] ?? { title: note.title, body: note.body };
}

export function isNoteDirty(state: NotePreviewState, note: PrivateNote): boolean {
  const draft = getNoteDraft(state, note);
  return draft.title !== note.title || draft.body !== note.body;
}

export function notePreviewReducer(state: NotePreviewState, action: NotePreviewAction): NotePreviewState {
  if (action.type === "reset") return createNotePreview(action.notes);
  if (action.type === "upsert") {
    const incoming = new Map(action.notes.map((note) => [note.id, note]));
    const existing = new Set(state.notes.map((note) => note.id));
    return { ...state, notes: [...action.notes.filter((note) => !existing.has(note.id)),
      ...state.notes.map((note) => incoming.get(note.id) ?? note)] };
  }
  if (action.type === "saved") {
    const drafts = { ...state.drafts };
    const latest = drafts[action.previousId];
    const newer = action.sent && latest && (latest.title !== action.sent.title || latest.body !== action.sent.body) ? latest : null;
    delete drafts[action.previousId];
    delete drafts[action.note.id];
    if (newer) drafts[action.note.id] = newer;
    const notes = state.notes.some((note) => note.id === action.previousId)
      ? state.notes.filter((note) => note.id !== action.note.id || action.note.id === action.previousId)
        .map((note) => note.id === action.previousId ? action.note : note)
      : [action.note, ...state.notes.filter((note) => note.id !== action.note.id)];
    const selectedId = state.selectedId === action.previousId ? action.note.id : state.selectedId;
    return { ...state, notes, drafts, selectedId, savedMessage: "" };
  }
  if (action.type === "remove") {
    const ids = new Set(action.ids);
    const drafts = { ...state.drafts };
    for (const id of ids) delete drafts[id];
    return { ...state, notes: state.notes.filter((note) => !ids.has(note.id)), drafts,
      selectedId: ids.has(state.selectedId) ? "" : state.selectedId, savedMessage: "" };
  }
  if (action.type === "merge") {
    const kept = state.notes.filter((note) => note.updatedLabel === "Not saved" || isNoteDirty(state, note));
    const keptIds = new Set(kept.map((note) => note.id));
    const loadedIds = new Set(action.notes.map((note) => note.id));
    // Unsaved work is never dropped by a reload, even when the server no longer lists the note.
    const notes = [...kept.filter((note) => !loadedIds.has(note.id)),
      ...action.notes.map((note) => keptIds.has(note.id) ? { ...kept.find((entry) => entry.id === note.id)!,
        collectionId: note.collectionId, favoritedAt: note.favoritedAt, position: note.position } : note)];
    const present = new Set(notes.map((note) => note.id));
    const drafts = Object.fromEntries(Object.entries(state.drafts).filter(([id]) => present.has(id)));
    return { ...state, notes, drafts, selectedId: present.has(state.selectedId) ? state.selectedId : "" };
  }
  if (action.type === "draftTitle") {
    const note = state.notes.find((entry) => entry.id === action.id);
    if (!note) return state;
    return { ...state, drafts: { ...state.drafts, [note.id]: { ...getNoteDraft(state, note), title: action.title } } };
  }
  if (action.type === "deselect") return { ...state, selectedId: "", savedMessage: "" };
  if (action.type === "select") {
    if (!state.notes.some((note) => note.id === action.id)) return state;
    return { ...state, selectedId: action.id, savedMessage: "" };
  }
  if (action.type === "create") {
    return { ...state, notes: [action.note, ...state.notes], selectedId: action.note.id, savedMessage: "" };
  }
  const selectedNote = state.notes.find((note) => note.id === state.selectedId);
  if (!selectedNote) return state;
  if (action.type === "discard") {
    const drafts = { ...state.drafts };
    delete drafts[selectedNote.id];
    const notes = selectedNote.updatedLabel === "Not saved"
      ? state.notes.filter((note) => note.id !== selectedNote.id) : state.notes;
    return { ...state, notes, drafts, savedMessage: "", selectedId: notes.some((note) => note.id === selectedNote.id) ? selectedNote.id : notes[0]?.id ?? "" };
  }
  if (action.type === "edit") {
    return {
      ...state,
      drafts: { ...state.drafts, [selectedNote.id]: { ...getNoteDraft(state, selectedNote), [action.field]: action.value } },
      savedMessage: "",
    };
  }
  const draft = getNoteDraft(state, selectedNote);
  const remainingDrafts = { ...state.drafts };
  delete remainingDrafts[selectedNote.id];
  return {
    ...state,
    notes: state.notes.map((note) => note.id === selectedNote.id
      ? { ...note, title: draft.title.trim() || "Untitled private note", body: draft.body, updatedLabel: "Saved in this preview" }
      : note),
    drafts: remainingDrafts,
    savedMessage: "Saved for this preview session. Refreshing or exiting clears these notes.",
  };
}
