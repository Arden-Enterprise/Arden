import { useEffect, useReducer, useRef, useState } from "react";
import type { Platform, PrivateNote } from "../shared/types";
import { ApiError, apiRequest } from "../shared/api-client";
import { createNotePreview, getNoteDraft, isNoteDirty, notePreviewReducer } from "./noteDraftModel";

type DraftRepresentation = {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
  currentVersion: { version: number };
};
type DraftListRepresentation = { items: Array<{ id: string; title: string; currentVersion: number; updatedAt: string }>; nextCursor: string | null };

function toPrivateNote(note: DraftRepresentation): PrivateNote {
  return { id: note.id, title: note.title, body: note.body, updatedLabel: `Saved to server · ${new Date(note.updatedAt).toLocaleString()}` };
}

export function usePrivateNotes(initialNotes: PrivateNote[]) {
  const [state, dispatch] = useReducer(notePreviewReducer, initialNotes, createNotePreview);
  const [serverBacked, setServerBacked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const versions = useRef(new Map<string, number>());
  const loadGeneration = useRef(0);
  const selectedNote = state.notes.find((note) => note.id === state.selectedId) ?? null;
  const draft = selectedNote ? getNoteDraft(state, selectedNote) : { title: "", body: "" };
  const hasUnsavedDrafts = state.notes.some((note) => isNoteDirty(state, note) || note.updatedLabel === "Not saved");

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [hasUnsavedDrafts]);

  const connectServer = async (platform: Platform, organizationId: string) => {
    const generation = ++loadGeneration.current;
    setServerBacked(true);
    setLoading(true);
    setError("");
    setSaveMessage("");
    versions.current.clear();
    dispatch({ type: "reset", notes: [] });
    try {
      const path = `/api/v1/organizations/${organizationId}/private-workspace/drafts`;
      const items: DraftListRepresentation["items"] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = await apiRequest<DraftListRepresentation>(platform, `${path}?${query}`);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const loaded: PrivateNote[] = [];
      for (let offset = 0; offset < items.length; offset += 6) {
        const batch = await Promise.all(items.slice(offset, offset + 6).map(async (item) => {
          const note = await apiRequest<DraftRepresentation>(platform, `${path}/${item.id}`);
          versions.current.set(note.id, note.currentVersion.version);
          return toPrivateNote(note);
        }));
        loaded.push(...batch);
      }
      if (generation === loadGeneration.current) dispatch({ type: "reset", notes: loaded });
    } catch (cause) {
      if (generation === loadGeneration.current) {
        dispatch({ type: "reset", notes: [] });
        setError(cause instanceof Error ? cause.message : "Private notes could not be loaded.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  };

  const createNote = () => {
    setError("");
    setSaveMessage("");
    dispatch({ type: "create", note: {
      id: serverBacked ? `pending-${crypto.randomUUID()}` : `preview-${crypto.randomUUID()}`,
      title: "Untitled private note", body: "", updatedLabel: serverBacked ? "Not saved" : "Not saved",
    } });
  };

  const save = async (platform?: Platform, organizationId?: string) => {
    if (!serverBacked) {
      dispatch({ type: "save" });
      return;
    }
    if (!platform || !organizationId || !selectedNote) {
      setError("Choose a signed-in organization before saving this note.");
      return;
    }
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      const path = `/api/v1/organizations/${organizationId}/private-workspace/drafts`;
      const result = selectedNote.id.startsWith("pending-")
        ? await apiRequest<DraftRepresentation>(platform, path, {
          method: "POST", body: JSON.stringify(draft),
        })
        : await apiRequest<DraftRepresentation>(platform, `${path}/${selectedNote.id}`, {
          method: "PATCH", headers: { "If-Match": `"${versions.current.get(selectedNote.id) ?? 0}"` },
          body: JSON.stringify(draft),
        });
      versions.current.set(result.id, result.currentVersion.version);
      const updatedNotes = [toPrivateNote(result), ...state.notes.filter((note) => note.id !== selectedNote.id && note.id !== result.id)];
      dispatch({ type: "reset", notes: updatedNotes });
      setSaveMessage("Saved to your private workspace.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "VERSION_CONFLICT") {
        setError("This note changed on the server. Reload the private notes before saving again.");
      } else {
        setError(cause instanceof Error ? cause.message : "The note was not saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = (notes: PrivateNote[] = initialNotes) => {
    loadGeneration.current += 1;
    versions.current.clear();
    setServerBacked(false);
    setLoading(false);
    setSaving(false);
    setError("");
    setSaveMessage("");
    dispatch({ type: "reset", notes });
  };

  return {
    state, selectedNote, draft, hasUnsavedDrafts, serverBacked, loading, saving, error, saveMessage,
    isDirty: selectedNote ? isNoteDirty(state, selectedNote) || selectedNote.updatedLabel === "Not saved" : false,
    selectNote: (note: PrivateNote) => { setError(""); setSaveMessage(""); dispatch({ type: "select", id: note.id }); },
    createNote,
    editTitle: (value: string) => { setSaveMessage(""); dispatch({ type: "edit", field: "title", value }); },
    editBody: (value: string) => { setSaveMessage(""); dispatch({ type: "edit", field: "body", value }); },
    save,
    connectServer,
    reset,
  };
}

export type PrivateNotesController = ReturnType<typeof usePrivateNotes>;
