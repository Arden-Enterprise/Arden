import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { Icon } from "../shared/Icon";
import type { PrivateNote } from "../shared/types";

type PrivateNoteEditorProps = {
  selectedNote: PrivateNote | null;
  draftTitle: string;
  draftBody: string;
  isDirty: boolean;
  savedMessage: string;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export function PrivateNoteEditor({
  selectedNote,
  draftTitle,
  draftBody,
  isDirty,
  savedMessage,
  onTitleChange,
  onBodyChange,
}: PrivateNoteEditorProps) {
  const titleRef = useAutosizeTextarea(draftTitle, 82);

  return (
    <section className="note-editor-card" aria-label="Private note editor">
      {selectedNote ? (
        <>
          <header className="editor-header">
            <div>
              <span className="meta-label">PRIVATE · PERSONAL WORKSPACE</span>
              <span className={`edit-state${isDirty ? " is-dirty" : ""}`}>
                {isDirty ? "Unsaved draft · Kept while you switch notes" : "No pending changes"}
              </span>
            </div>
          </header>
          <label className="editor-title-label">
            <span className="sr-only">Note title</span>
            <textarea
              ref={titleRef}
              rows={2}
              value={draftTitle}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Untitled private note"
            />
          </label>
          <label className="editor-body-label">
            <span className="sr-only">Note content</span>
            <textarea
              value={draftBody}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder="Write a private note…"
            />
          </label>
          <footer className="editor-footer" aria-live="polite">
            <span>{savedMessage || "Session preview. Refreshing or exiting clears your notes."}</span>
            <span>{draftBody.length} characters</span>
          </footer>
        </>
      ) : (
        <div className="empty-editor">
          <Icon name="document" size={23} />
          <strong>Select a private note</strong>
          <span>Choose a note from the list or create a new preview note.</span>
        </div>
      )}
    </section>
  );
}
