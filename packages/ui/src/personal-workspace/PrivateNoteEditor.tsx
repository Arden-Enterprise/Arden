import type { ReactNode } from "react";
import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { Icon } from "../shared/Icon";
import type { PrivateNote } from "../shared/types";

type PrivateNoteEditorProps = {
  selectedNote: PrivateNote | null;
  draftTitle: string;
  draftBody: string;
  isDirty: boolean;
  savedMessage: string;
  toolbar: ReactNode;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export function PrivateNoteEditor({
  selectedNote,
  draftTitle,
  draftBody,
  isDirty,
  savedMessage,
  toolbar,
  onTitleChange,
  onBodyChange,
}: PrivateNoteEditorProps) {
  const titleRef = useAutosizeTextarea(draftTitle, 40);

  return (
    <section className="note-editor-card island" aria-label="Private note editor">
      {selectedNote ? (
        <>
          <div className="private-editor-toolbar" role="toolbar" aria-label="Note actions">{toolbar}</div>
          <div className="note-editor-page">
            <label className="editor-title-label">
              <span className="sr-only">Note title</span>
              <textarea
                ref={titleRef}
                rows={1}
                value={draftTitle}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Untitled private note"
              />
            </label>
            <span className={`edit-state${isDirty ? " is-dirty" : ""}`}>
              {isDirty ? "Unsaved changes" : selectedNote.updatedLabel}
            </span>
            <label className="editor-body-label">
              <span className="sr-only">Note content</span>
              <textarea
                value={draftBody}
                onChange={(event) => onBodyChange(event.target.value)}
                placeholder="Write a private note…"
              />
            </label>
          </div>
          <footer className="editor-footer" aria-live="polite">
            {savedMessage && <span>{savedMessage}</span>}
            <span>{draftBody.length} characters</span>
          </footer>
        </>
      ) : (
        <div className="island-empty empty-editor">
          <span className="island-tile" aria-hidden="true"><Icon name="lock" size={16} /></span>
          <h3>Select a private note</h3>
        </div>
      )}
    </section>
  );
}
