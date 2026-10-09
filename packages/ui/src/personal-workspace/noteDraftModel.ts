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
  | { type: "reset"; notes: PrivateNote[] };

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
  if (action.type === "select") {
    if (!state.notes.some((note) => note.id === action.id)) return state;
    return { ...state, selectedId: action.id, savedMessage: "" };
  }
  if (action.type === "create") {
    return { ...state, notes: [action.note, ...state.notes], selectedId: action.note.id, savedMessage: "" };
  }
  const selectedNote = state.notes.find((note) => note.id === state.selectedId);
  if (!selectedNote) return state;
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
