import { useEffect, useReducer } from "react";
import type { PrivateNote } from "../shared/types";
import { createNotePreview, getNoteDraft, isNoteDirty, notePreviewReducer } from "./noteDraftModel";

export function usePrivateNotes(initialNotes: PrivateNote[]) {
  const [state, dispatch] = useReducer(notePreviewReducer, initialNotes, createNotePreview);
  const selectedNote = state.notes.find((note) => note.id === state.selectedId) ?? null;
  const draft = selectedNote ? getNoteDraft(state, selectedNote) : { title: "", body: "" };
  const hasUnsavedDrafts = state.notes.some((note) => isNoteDirty(state, note) || note.updatedLabel === "Not saved");

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [hasUnsavedDrafts]);

  return {
    state, selectedNote, draft, hasUnsavedDrafts,
    isDirty: selectedNote ? isNoteDirty(state, selectedNote) || selectedNote.updatedLabel === "Not saved" : false,
    selectNote: (note: PrivateNote) => dispatch({ type: "select", id: note.id }),
    createNote: () => dispatch({ type: "create", note: {
      id: `preview-${crypto.randomUUID()}`, title: "Untitled private note", body: "", updatedLabel: "Not saved",
    } }),
    editTitle: (value: string) => dispatch({ type: "edit", field: "title", value }),
    editBody: (value: string) => dispatch({ type: "edit", field: "body", value }),
    save: () => dispatch({ type: "save" }),
    reset: (notes: PrivateNote[] = initialNotes) => dispatch({ type: "reset", notes }),
  };
}

export type PrivateNotesController = ReturnType<typeof usePrivateNotes>;
