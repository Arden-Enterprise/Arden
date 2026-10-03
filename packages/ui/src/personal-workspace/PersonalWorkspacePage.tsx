import { useEffect, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import { PrivateNoteEditor } from "./PrivateNoteEditor";
import { PrivateNoteList } from "./PrivateNoteList";
import { SearchField } from "../shared/SearchField";
import type { PrivateNote } from "../shared/types";
import { useSearchShortcut } from "../shared/useSearchShortcut";

type PersonalWorkspacePageProps = {
  notes: PrivateNote[];
  onNotesChange: (notes: PrivateNote[]) => void;
};

export function PersonalWorkspacePage({
  notes,
  onNotesChange,
}: PersonalWorkspacePageProps) {
  const [selectedId, setSelectedId] = useState(notes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState(notes[0]?.title ?? "");
  const [draftBody, setDraftBody] = useState(notes[0]?.body ?? "");
  const [savedMessage, setSavedMessage] = useState("");
  const searchRef = useSearchShortcut();

  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;
  const isDirty = Boolean(
    selectedNote &&
      (selectedNote.title !== draftTitle || selectedNote.body !== draftBody),
  );

  const visibleNotes = useMemo(
    () =>
      notes.filter((note) =>
        `${note.title} ${note.body}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [notes, query],
  );

  useEffect(() => {
    const warnOnUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [isDirty]);

  const selectNote = (note: PrivateNote) => {
    setSelectedId(note.id);
    setDraftTitle(note.title);
    setDraftBody(note.body);
    setSavedMessage("");
  };

  const createPreviewNote = () => {
    const next: PrivateNote = {
      id: `preview-${Date.now()}`,
      title: "Untitled private note",
      body: "",
      updatedLabel: "Not saved",
    };
    onNotesChange([next, ...notes]);
    selectNote(next);
  };

  const savePreview = () => {
    if (!selectedNote) return;
    onNotesChange(
      notes.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              title: draftTitle.trim() || "Untitled private note",
              body: draftBody,
              updatedLabel: "Saved in this preview",
            }
          : note,
      ),
    );
    setDraftTitle(draftTitle.trim() || "Untitled private note");
    setSavedMessage("Saved in memory only. Refreshing the app will discard this change.");
  };

  return (
    <section className="workspace-page" aria-labelledby="personal-workspace-title">
      <header className="workspace-topbar">
        <span>ARDEN / PERSONAL WORKSPACE</span>
        <span className="preview-state">PRIVATE UI PREVIEW · NOT PERSISTED</span>
      </header>

      <div className="workspace-content personal-content">
        <div className="page-title-row personal-title-row">
          <div>
            <span className="privacy-kicker">
              <Icon name="lock" size={14} /> ONLY YOU
            </span>
            <h1 id="personal-workspace-title">Personal Workspace</h1>
            <p>Capture private notes before deciding whether anything should be shared.</p>
          </div>
          <button type="button" className="primary-button" onClick={createPreviewNote}>
            <Icon name="plus" size={15} /> New private note
          </button>
        </div>

        <SearchField
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder="Search your private notes…"
        />

        <div className="privacy-banner" role="note">
          <Icon name="lock" size={17} />
          <div>
            <strong>Private by default</strong>
            <span>
              These preview notes are separated from shared knowledge and are not used in shared answers.
            </span>
          </div>
        </div>

        <div className="personal-grid">
          <PrivateNoteList
            notes={visibleNotes}
            selectedId={selectedId}
            onSelect={selectNote}
            onClearSearch={() => setQuery("")}
          />
          <PrivateNoteEditor
            selectedNote={selectedNote}
            draftTitle={draftTitle}
            draftBody={draftBody}
            isDirty={isDirty}
            savedMessage={savedMessage}
            onTitleChange={(value) => {
              setDraftTitle(value);
              setSavedMessage("");
            }}
            onBodyChange={(value) => {
              setDraftBody(value);
              setSavedMessage("");
            }}
            onSave={savePreview}
          />
        </div>
      </div>
    </section>
  );
}
