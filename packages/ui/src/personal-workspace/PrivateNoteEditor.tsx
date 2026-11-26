import { lazy, Suspense, useRef, type ReactNode } from "react";
import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { Icon } from "../shared/Icon";
import type { Platform, PrivateNote } from "../shared/types";
import { NOTE_BODY_MAX_BYTES } from "./pdfImport";
import { isRichNoteBody, noteEditorBody, noteText, utf8Bytes } from "./noteDocument";

const ArdenRichTextEditor = lazy(() => import("../knowledge/ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenRichTextEditor })));

type PrivateNoteEditorProps = {
  selectedNote: PrivateNote | null;
  draftTitle: string;
  draftBody: string;
  isDirty: boolean;
  savedMessage: string;
  toolbar: ReactNode;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  entering?: boolean;
  platform: Platform;
  assistantEnabled: boolean;
  organizationId: string;
  /** Location trail shown above the title. */
  header?: ReactNode;
};

/**
 * The rich editor keeps its own document while the owner types. A body that changes from outside
 * (Discard, a PDF import, a newer saved version) opens a fresh editor with that body.
 */
function useEditorInstance(noteId: string, body: string) {
  const state = useRef<{ emitted: string; revision: number; editorBody: string } | null>(null);
  if (!state.current) state.current = { emitted: body, revision: 0, editorBody: noteEditorBody(body) };
  else if (body !== state.current.emitted) {
    state.current = { emitted: body, revision: state.current.revision + 1, editorBody: noteEditorBody(body) };
  }
  const current = state.current;
  return {
    key: `${noteId}:${current.revision}`,
    editorBody: current.editorBody,
    accept: (next: string) => { current.emitted = next; },
  };
}

export function PrivateNoteEditor({
  selectedNote,
  draftTitle,
  draftBody,
  isDirty,
  savedMessage,
  toolbar,
  onTitleChange,
  onBodyChange,
  entering = false,
  platform,
  assistantEnabled,
  organizationId,
  header,
}: PrivateNoteEditorProps) {
  const titleRef = useAutosizeTextarea(draftTitle, 40);
  const instance = useEditorInstance(selectedNote?.id ?? "", draftBody);

  return (
    <section className={`note-editor-card island${entering ? " is-entering" : ""}`} aria-label="Private note editor">
      {selectedNote ? (
        <>
          <div className="private-editor-toolbar" role="toolbar" aria-label="Note actions">{toolbar}</div>
          <div className="note-editor-page">
            {header}
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
            <div className="editor-body-label note-rich-body" aria-label="Note content" role="group">
              <Suspense fallback={<p className="island-meta" role="status">Loading editor…</p>}>
                <ArdenRichTextEditor key={instance.key} instanceKey={instance.key} body={instance.editorBody} selectionFormatting
                  maxLength={NOTE_BODY_MAX_BYTES} measure={utf8Bytes} pageWriting
                  platform={assistantEnabled ? platform : undefined} organizationId={assistantEnabled ? organizationId : undefined}
                  onChange={(next) => { instance.accept(next); onBodyChange(next); }} />
              </Suspense>
            </div>
          </div>
          <footer className="editor-footer" aria-live="polite">
            {savedMessage && <span>{savedMessage}</span>}
            {/* A legacy Markdown note counts the text it opens as, not its markers. */}
            <span>{noteText(isRichNoteBody(draftBody) ? draftBody : instance.editorBody).length} characters</span>
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
