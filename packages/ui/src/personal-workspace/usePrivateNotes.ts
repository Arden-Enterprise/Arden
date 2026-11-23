import { useEffect, useReducer, useRef, useState } from "react";
import type { Platform, PrivateCollection, PrivateNote } from "../shared/types";
import { ApiError } from "../shared/api-client";
import type { PrivateTrashEntry } from "../shared/private-workspace-api";
import { createNotePreview, getNoteDraft, isNoteDirty, notePreviewReducer, type NotePreviewState } from "./noteDraftModel";
import { createDemoBackend, createServerBackend, type LoadedNote, type PrivateNotesBackend } from "./privateNotesBackend";
import { ancestorsOf, itemSubtree, ROOT_LABEL, UNTITLED_COLLECTION, UNTITLED_NOTE, type TreeItemRef } from "./privateNotesModel";

/** What the Private Notes page shows: the selected note, a collection's contents, the root list or Trash. */
export type NotesFocus = { kind: "note" } | { kind: "collection"; id: string } | { kind: "root" } | { kind: "trash" };
export type NotesNotice = { id: number; message: string };
/** Where an inline rename input shows: the sidebar row or the page heading. */
export type RenameTarget = TreeItemRef & { where: "tree" | "page" };

const CONFLICT_MESSAGE = "This note has changed. Copy your edits, then refresh the page.";
const isPending = (note: PrivateNote) => note.updatedLabel === "Not saved";

function withoutVersion({ version: _version, ...note }: LoadedNote): PrivateNote {
  return note;
}

function actionMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.code === "VERSION_CONFLICT") return CONFLICT_MESSAGE;
  if (cause instanceof ApiError && cause.status === 404) return "This item is no longer available. Your notes were refreshed.";
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function usePrivateNotes(initialNotes: PrivateNote[], initialCollections: PrivateCollection[] = []) {
  const [state, dispatch] = useReducer(notePreviewReducer, initialNotes, createNotePreview);
  const [collections, setCollections] = useState<PrivateCollection[]>(initialCollections);
  const [trash, setTrash] = useState<PrivateTrashEntry[]>([]);
  const [serverBacked, setServerBacked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<NotesNotice | null>(null);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState("");
  const [focus, setFocus] = useState<NotesFocus>({ kind: "note" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [treeOpen, setTreeOpen] = useState(true);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [trashConfirm, setTrashConfirm] = useState<TreeItemRef | null>(null);
  const backend = useRef<PrivateNotesBackend>(null as unknown as PrivateNotesBackend);
  if (!backend.current) backend.current = createDemoBackend({ notes: initialNotes, collections: initialCollections });
  const versions = useRef(new Map<string, number>(initialNotes.map((note) => [note.id, 1])));
  const loadGeneration = useRef(0);
  const noticeId = useRef(0);
  const latest = useRef<{ state: NotePreviewState; collections: PrivateCollection[]; trash: PrivateTrashEntry[] }>({ state, collections, trash });
  latest.current = { state, collections, trash };

  const selectedNote = state.notes.find((note) => note.id === state.selectedId) ?? null;
  const draft = selectedNote ? getNoteDraft(state, selectedNote) : { title: "", body: "" };
  const hasUnsavedDrafts = state.notes.some((note) => isNoteDirty(state, note) || isPending(note));

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [hasUnsavedDrafts]);

  const announce = (message: string) => setNotice({ id: ++noticeId.current, message });
  const expand = (...ids: Array<string | null | undefined>) => setExpanded((current) => {
    const next = new Set(current);
    for (const id of ids) if (id) next.add(id);
    return next;
  });
  const expandPath = (parentId: string | null, extra?: string) =>
    expand(...ancestorsOf(latest.current.collections, parentId).map((collection) => collection.id), extra);
  const rememberVersions = (notes: LoadedNote[]) => { for (const note of notes) versions.current.set(note.id, note.version); };
  const findNote = (id: string) => latest.current.state.notes.find((note) => note.id === id);
  const findCollection = (id: string) => latest.current.collections.find((collection) => collection.id === id);
  const titleOf = (item: TreeItemRef) => item.kind === "note"
    ? (findNote(item.id)?.title || UNTITLED_NOTE) : (findCollection(item.id)?.title || UNTITLED_COLLECTION);
  const isUnsaved = (note: PrivateNote) => isPending(note) || isNoteDirty(latest.current.state, note);

  /** Reloads notes, collections and trash; unsaved drafts keep their content and the version they were based on. */
  const refresh = async () => {
    const generation = loadGeneration.current;
    try {
      const loaded = await backend.current.load();
      if (generation !== loadGeneration.current) return;
      const current = latest.current.state;
      for (const note of loaded.notes) {
        const local = current.notes.find((entry) => entry.id === note.id);
        if (!local || !isNoteDirty(current, local)) versions.current.set(note.id, note.version);
      }
      dispatch({ type: "merge", notes: loaded.notes.map(withoutVersion) });
      setCollections(loaded.collections);
      setTrash(loaded.trash);
      setFocus((focus) => focus.kind === "collection" && !loaded.collections.some((collection) => collection.id === focus.id) ? { kind: "root" } : focus);
    } catch (cause) {
      if (generation === loadGeneration.current) setActionError(actionMessage(cause, "Private notes could not be refreshed."));
    }
  };

  /** Runs one organization action; failures are shown and followed by a refresh so the tree matches the server. */
  const run = async <T,>(label: string, work: (backend: PrivateNotesBackend) => Promise<T>, apply: (result: T) => void,
    fallback = "This action couldn’t be completed.") => {
    const generation = loadGeneration.current;
    setActionError("");
    setBusyAction(label);
    try {
      const result = await work(backend.current);
      if (generation !== loadGeneration.current) return false;
      apply(result);
      return true;
    } catch (cause) {
      if (generation !== loadGeneration.current) return false;
      setActionError(actionMessage(cause, fallback));
      await refresh();
      return false;
    } finally {
      if (generation === loadGeneration.current) setBusyAction(null);
    }
  };

  const clearTransient = () => {
    setSaving(false);
    setError("");
    setSaveMessage("");
    setActionError("");
    setBusyAction(null);
    setNotice(null);
    setTrashError("");
    setTrashLoading(false);
    setRenaming(null);
    setTrashConfirm(null);
    setFocus({ kind: "note" });
    setExpanded(new Set());
    versions.current.clear();
  };

  const connectServer = async (platform: Platform, organizationId: string) => {
    const generation = ++loadGeneration.current;
    backend.current = createServerBackend(platform, organizationId);
    setServerBacked(true);
    setLoading(true);
    clearTransient();
    setCollections([]);
    setTrash([]);
    dispatch({ type: "reset", notes: [] });
    try {
      const loaded = await backend.current.load();
      if (generation !== loadGeneration.current) return;
      rememberVersions(loaded.notes);
      setCollections(loaded.collections);
      setTrash(loaded.trash);
      dispatch({ type: "reset", notes: loaded.notes.map(withoutVersion) });
    } catch (cause) {
      if (generation === loadGeneration.current) {
        dispatch({ type: "reset", notes: [] });
        setError(cause instanceof Error ? cause.message : "Private notes could not be loaded.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  };

  /** Starts a never-saved note, optionally inside a collection; it reaches the server on Save. */
  const createNote = (collectionId: string | null = null) => {
    setError("");
    setSaveMessage("");
    const note: PrivateNote = { id: `pending-${crypto.randomUUID()}`, title: UNTITLED_NOTE, body: "", updatedLabel: "Not saved", collectionId };
    dispatch({ type: "create", note });
    setFocus({ kind: "note" });
    setTreeOpen(true);
    if (collectionId) expandPath(collectionId, collectionId);
    return note.id;
  };

  const save = async (_platform?: Platform, _organizationId?: string) => {
    if (!selectedNote) return;
    const note = selectedNote;
    const content = draft;
    const generation = loadGeneration.current;
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      const result = isPending(note)
        ? await backend.current.createNote({ title: content.title, body: content.body, collectionId: note.collectionId ?? null })
        : await backend.current.updateNote(note.id, versions.current.get(note.id) ?? 0, content);
      if (generation !== loadGeneration.current) return;
      versions.current.set(result.id, result.version);
      dispatch({ type: "saved", previousId: note.id, note: withoutVersion(result) });
      setSaveMessage("Saved");
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setError(cause instanceof ApiError && cause.code === "VERSION_CONFLICT" ? CONFLICT_MESSAGE
        : cause instanceof Error ? cause.message : "The note was not saved.");
    } finally {
      if (generation === loadGeneration.current) setSaving(false);
    }
  };

  const reset = (notes?: PrivateNote[], seedCollections?: PrivateCollection[]) => {
    const seedNotes = notes ?? initialNotes;
    const seed = seedCollections ?? (notes ? [] : initialCollections);
    loadGeneration.current += 1;
    backend.current = createDemoBackend({ notes: seedNotes, collections: seed });
    setServerBacked(false);
    setLoading(false);
    clearTransient();
    for (const note of seedNotes) versions.current.set(note.id, 1);
    setCollections(seed);
    setTrash([]);
    setTreeOpen(true);
    dispatch({ type: "reset", notes: seedNotes });
  };

  const openNote = (id: string) => {
    const note = findNote(id);
    if (!note) return;
    setError("");
    setSaveMessage("");
    dispatch({ type: "select", id });
    setFocus({ kind: "note" });
    expandPath(note.collectionId ?? null);
  };
  const openCollection = (id: string) => {
    const collection = findCollection(id);
    if (!collection) return;
    setFocus({ kind: "collection", id });
    expandPath(collection.parentId, id);
  };

  const loadTrash = async () => {
    const generation = loadGeneration.current;
    setTrashLoading(true);
    setTrashError("");
    try {
      const items = await backend.current.loadTrash();
      if (generation === loadGeneration.current) setTrash(items);
    } catch (cause) {
      if (generation === loadGeneration.current) setTrashError(actionMessage(cause, "Trash could not be loaded."));
    } finally {
      if (generation === loadGeneration.current) setTrashLoading(false);
    }
  };

  /** Creates a saved note straight away (titled "Untitled private note") and opens its inline rename. */
  const addNote = (collectionId: string | null = null, where: RenameTarget["where"] = "tree") => run("create-note",
    (service) => service.createNote({ title: UNTITLED_NOTE, body: "", collectionId }), (note) => {
      rememberVersions([note]);
      dispatch({ type: "upsert", notes: [withoutVersion(note)] });
      dispatch({ type: "select", id: note.id });
      setFocus({ kind: "note" });
      setTreeOpen(true);
      if (collectionId) expandPath(collectionId, collectionId);
      setRenaming(where === "tree" ? { kind: "note", id: note.id, where } : null);
    }, "The note couldn’t be created.");

  const createCollection = (parentId: string | null = null, where: RenameTarget["where"] = "tree") => run("create-collection",
    (service) => service.createCollection(UNTITLED_COLLECTION, parentId), (collection) => {
      setCollections((current) => [...current, collection]);
      setTreeOpen(true);
      expandPath(parentId, collection.id);
      if (parentId) expand(parentId);
      setFocus({ kind: "collection", id: collection.id });
      setRenaming({ kind: "collection", id: collection.id, where });
    }, "The collection couldn’t be created.");

  const commitRename = async (item: TreeItemRef, value: string) => {
    setRenaming(null);
    const title = value.trim();
    if (item.kind === "collection") {
      const collection = findCollection(item.id);
      if (!collection || (title || UNTITLED_COLLECTION) === collection.title) return;
      await run("rename", (service) => service.updateCollection(item.id, { title }), (updated) => {
        setCollections((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      }, "The collection couldn’t be renamed.");
      return;
    }
    const note = findNote(item.id);
    if (!note) return;
    if (isPending(note)) {
      dispatch({ type: "draftTitle", id: note.id, title: title || UNTITLED_NOTE });
      return;
    }
    if ((title || UNTITLED_NOTE) === note.title) return;
    // A rename is a new version of the saved content; unsaved body edits stay in the draft.
    await run("rename", (service) => service.updateNote(note.id, versions.current.get(note.id) ?? 0, { title: title || UNTITLED_NOTE, body: note.body }),
      (result) => {
        versions.current.set(result.id, result.version);
        const hadDraft = Boolean(latest.current.state.drafts[note.id]);
        dispatch({ type: "upsert", notes: [withoutVersion(result)] });
        if (hadDraft) dispatch({ type: "draftTitle", id: note.id, title: result.title });
      }, "The note couldn’t be renamed.");
  };

  const toggleFavorite = (item: TreeItemRef) => {
    if (item.kind === "note") {
      const note = findNote(item.id);
      if (!note || isPending(note)) return Promise.resolve(false);
      const favorite = !note.favoritedAt;
      return run("favorite", (service) => service.favoriteNote(note.id, favorite), (placement) => {
        const current = findNote(note.id);
        if (current) dispatch({ type: "upsert", notes: [{ ...current, collectionId: placement.collectionId, favoritedAt: placement.favoritedAt }] });
        announce(favorite ? `Added “${titleOf(item)}” to favorites` : "Removed from favorites");
      }, "Favorites couldn’t be updated.");
    }
    const collection = findCollection(item.id);
    if (!collection) return Promise.resolve(false);
    const favorite = !collection.favoritedAt;
    return run("favorite", (service) => service.favoriteCollection(collection.id, favorite), (updated) => {
      setCollections((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      announce(favorite ? `Added “${updated.title}” to favorites` : "Removed from favorites");
    }, "Favorites couldn’t be updated.");
  };

  const duplicate = (item: TreeItemRef) => {
    const title = titleOf(item);
    if (item.kind === "note") {
      const note = findNote(item.id);
      if (!note || isPending(note)) return Promise.resolve(false);
      return run("duplicate", (service) => service.duplicateNote(note.id), (copy) => {
        rememberVersions([copy]);
        dispatch({ type: "upsert", notes: [withoutVersion(copy)] });
        dispatch({ type: "select", id: copy.id });
        setFocus({ kind: "note" });
        announce(`Duplicated “${title}”`);
      }, "The note couldn’t be duplicated.");
    }
    return run("duplicate", (service) => service.duplicateCollection(item.id), (copy) => {
      rememberVersions(copy.notes);
      setCollections((current) => [...current.filter((entry) => !copy.collections.some((added) => added.id === entry.id)), ...copy.collections]);
      dispatch({ type: "upsert", notes: copy.notes.map(withoutVersion) });
      expandPath(copy.collection.parentId);
      setFocus({ kind: "collection", id: copy.collection.id });
      announce(`Duplicated “${title}”`);
    }, "The collection couldn’t be duplicated.");
  };

  const moveTo = (item: TreeItemRef, destinationId: string | null) => {
    const destination = destinationId ? findCollection(destinationId)?.title ?? UNTITLED_COLLECTION : ROOT_LABEL;
    const done = () => { if (destinationId) expandPath(destinationId, destinationId); announce(`Moved to ${destination}`); };
    if (item.kind === "note") {
      const note = findNote(item.id);
      if (!note) return Promise.resolve(false);
      if (isPending(note)) {
        dispatch({ type: "upsert", notes: [{ ...note, collectionId: destinationId }] });
        done();
        return Promise.resolve(true);
      }
      return run("move", (service) => service.moveNote(note.id, destinationId), (placement) => {
        const current = findNote(note.id);
        if (current) dispatch({ type: "upsert", notes: [{ ...current, collectionId: placement.collectionId, favoritedAt: placement.favoritedAt }] });
        done();
      }, "The note couldn’t be moved.");
    }
    return run("move", (service) => service.updateCollection(item.id, { parentId: destinationId }), (updated) => {
      setCollections((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      done();
    }, "The collection couldn’t be moved.");
  };

  const subtreeNotes = (item: TreeItemRef) => {
    const { state: current, collections: currentCollections } = latest.current;
    const { noteIds, collectionIds } = itemSubtree(currentCollections, current.notes, item);
    return { notes: current.notes.filter((note) => noteIds.has(note.id)), collectionIds };
  };

  const trashItem = (item: TreeItemRef) => {
    const title = titleOf(item);
    const { notes, collectionIds } = subtreeNotes(item);
    const pending = notes.filter(isPending).map((note) => note.id);
    const onlyLocal = item.kind === "note" && pending.includes(item.id);
    if (onlyLocal) {
      // A never-saved note has nothing on the server to trash; it is discarded locally.
      dispatch({ type: "remove", ids: [item.id] });
      return Promise.resolve(true);
    }
    return run("trash", (service) => service.trash(item), (entry) => {
      dispatch({ type: "remove", ids: notes.map((note) => note.id) });
      setCollections((current) => current.filter((collection) => !collectionIds.has(collection.id)));
      setTrash((current) => [entry, ...current.filter((existing) => existing.batchId !== entry.batchId)]);
      setFocus((focus) => focus.kind === "collection" && collectionIds.has(focus.id) ? { kind: "root" } : focus);
      setRenaming(null);
      announce(`Moved “${title}” to trash`);
    }, "This couldn’t be moved to trash.");
  };

  /** Moving unsaved work to trash asks first; otherwise it happens straight away (Trash keeps it for 30 days). */
  const requestTrash = (item: TreeItemRef) => {
    if (subtreeNotes(item).notes.some(isUnsaved)) {
      setTrashConfirm(item);
      return Promise.resolve(false);
    }
    return trashItem(item);
  };

  const restore = (batchId: string) => {
    const entry = latest.current.trash.find((item) => item.batchId === batchId);
    return run("restore", (service) => service.restore(batchId), (restored) => {
      rememberVersions(restored.notes);
      setCollections((current) => [...current.filter((collection) => !restored.collections.some((added) => added.id === collection.id)), ...restored.collections]);
      dispatch({ type: "upsert", notes: restored.notes.map(withoutVersion) });
      setTrash((current) => current.filter((item) => item.batchId !== batchId));
      announce(`Restored “${entry?.title ?? "item"}”`);
    }, "This couldn’t be restored.");
  };

  const purge = (batchId: string) => {
    const entry = latest.current.trash.find((item) => item.batchId === batchId);
    return run("purge", (service) => service.purge(batchId), () => {
      setTrash((current) => current.filter((item) => item.batchId !== batchId));
      announce(`Deleted “${entry?.title ?? "item"}” permanently`);
    }, "This couldn’t be deleted.");
  };

  return {
    state, selectedNote, draft, hasUnsavedDrafts, serverBacked, loading, saving, error, saveMessage,
    collections, trash, trashLoading, trashError, actionError, busyAction, notice, focus, expanded, treeOpen, renaming, trashConfirm,
    isDirty: selectedNote ? isNoteDirty(state, selectedNote) || isPending(selectedNote) : false,
    isPending,
    selectNote: (note: PrivateNote) => openNote(note.id),
    openNote,
    openCollection,
    openRoot: () => setFocus({ kind: "root" }),
    openTrash: () => { setFocus({ kind: "trash" }); void loadTrash(); },
    loadTrash,
    toggleExpanded: (id: string) => setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    setTreeOpen,
    startRename: (item: TreeItemRef, where: RenameTarget["where"] = "tree") => {
      const parentId = item.kind === "note" ? findNote(item.id)?.collectionId ?? null : findCollection(item.id)?.parentId ?? null;
      setTreeOpen(true);
      expandPath(parentId);
      setRenaming({ kind: item.kind, id: item.id, where });
    },
    cancelRename: () => setRenaming(null),
    commitRename,
    createNote,
    addNote,
    createCollection,
    toggleFavorite,
    duplicate,
    moveTo,
    requestTrash,
    confirmTrash: () => {
      const item = trashConfirm;
      setTrashConfirm(null);
      if (item) void trashItem(item);
    },
    cancelTrash: () => setTrashConfirm(null),
    restore,
    purge,
    refresh,
    dismissActionError: () => setActionError(""),
    discardSelected: () => { if (saving) return; setSaveMessage(""); dispatch({ type: "discard" }); },
    editTitle: (value: string) => { setSaveMessage(""); dispatch({ type: "edit", field: "title", value }); },
    editBody: (value: string) => { setSaveMessage(""); dispatch({ type: "edit", field: "body", value }); },
    save,
    connectServer,
    reset,
  };
}

export type PrivateNotesController = ReturnType<typeof usePrivateNotes>;
