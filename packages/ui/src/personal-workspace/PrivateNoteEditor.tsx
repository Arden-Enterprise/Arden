import { useRef, useState, type ReactNode } from "react";
import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { Icon } from "../shared/Icon";
import type { Platform, PrivateNote } from "../shared/types";
import { WritingActionPanel } from "../shared/WritingActionPanel";

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
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const suppressSelection = useRef(false);
  const [selection, setSelection] = useState<{ start: number; end: number; body: string } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const updateSelection = () => {
    if (suppressSelection.current) return;
    const target = bodyRef.current;
    if (!target) return;
    if (target.selectionEnd > target.selectionStart) {
      setSelection({ start: target.selectionStart, end: target.selectionEnd, body: target.value });
      setAssistantOpen(true);
    } else setSelection(null);
  };
  const selectedText = selection && selection.body === draftBody ? draftBody.slice(selection.start, selection.end) : "";
  const targetText = selectedText || draftBody;
  const scope = selectedText ? "SELECTION" : "PAGE";

  return (
    <section className={`note-editor-card island${entering ? " is-entering" : ""}`} aria-label="Private note editor">
      {selectedNote ? (
        <>
          <div className="private-editor-toolbar" role="toolbar" aria-label="Note actions">{toolbar}
            {assistantEnabled && <button type="button" className="secondary-button" disabled={!draftBody.trim()}
              onClick={() => { suppressSelection.current = false; setSelection(null); setAssistantOpen(value => !value); }}>AI writing</button>}
          </div>
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
            <label className="editor-body-label">
              <span className="sr-only">Note content</span>
              <textarea
                ref={bodyRef}
                value={draftBody}
                onChange={(event) => { setAssistantOpen(false); setSelection(null); onBodyChange(event.target.value); }}
                onSelect={updateSelection}
                onMouseDown={() => { suppressSelection.current = false; }}
                onKeyDown={(event) => { if (event.key !== "Escape") suppressSelection.current = false; }}
                onKeyUp={updateSelection}
                onMouseUp={updateSelection}
                onContextMenu={(event) => {
                  if (!draftBody.trim()) return;
                  event.preventDefault();
                  suppressSelection.current = false;
                  updateSelection();
                  setAssistantOpen(true);
                }}
                placeholder="Write a private note…"
              />
            </label>
            {assistantEnabled && assistantOpen && targetText.trim() && targetText.length <= 12_000 && <WritingActionPanel
              key={`${selectedNote?.id}:${selection?.start}:${selection?.end}:${selection?.body.length}`}
              platform={platform} organizationId={organizationId} text={targetText} scope={scope} canApply={!selection || selection.body === draftBody}
              onClose={() => { suppressSelection.current = true; setAssistantOpen(false); bodyRef.current?.focus(); }} onApply={(replacement) => {
                if (selection && selection.body !== draftBody) return;
                const next = selection ? draftBody.slice(0, selection.start) + replacement + draftBody.slice(selection.end) : replacement;
                suppressSelection.current = true;
                onBodyChange(next); setAssistantOpen(false); setSelection(null);
                requestAnimationFrame(() => {
                  bodyRef.current?.focus();
                  const position = selection ? selection.start + replacement.length : replacement.length;
                  bodyRef.current?.setSelectionRange(position, position);
                });
              }} />}
            {assistantEnabled && assistantOpen && targetText.length > 12_000 &&
              <p role="status">Select up to 12,000 characters to use AI writing.</p>}
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
