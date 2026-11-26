import { useRef, useState, type ReactNode } from "react";
import { useAutosizeTextarea } from "../shared/useAutosizeTextarea";
import { Icon } from "../shared/Icon";
import type { Platform, PrivateNote } from "../shared/types";
import { WritingActionPanel } from "../shared/WritingActionPanel";
import { pointAnchor, textareaSelectionAnchor, type EditorActionAnchor } from "../shared/editor-action-anchor";
import { runEditorClipboard } from "../shared/editor-clipboard";
import { activeInlineFormats, toggleInlineFormat, type InlineFormat } from "../shared/markdownInlineFormat";

const formatShortcuts: Record<string, InlineFormat> = { b: "bold", i: "italic", e: "code", "shift+s": "strike" };

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
  const [popup, setPopup] = useState<{
    source: HTMLElement; anchor: EditorActionAnchor; kind: "selection" | "toolbar" | "context";
    clipboard?: { start: number; end: number; value: string; draft: string }; keyboard?: boolean;
  } | null>(null);
  const closePopup = (restoreFocus: boolean) => {
    suppressSelection.current = true;
    setPopup(null);
    if (restoreFocus) (popup?.source ?? bodyRef.current)?.focus({ preventScroll: true });
  };
  const updateSelection = (fallback?: EditorActionAnchor) => {
    if (suppressSelection.current) return;
    const target = bodyRef.current;
    if (!target) return;
    const { selectionStart: start, selectionEnd: end, value } = target;
    if (popup?.kind === "context" && start === popup.clipboard?.start && end === popup.clipboard.end) return;
    if (start === end || !value.slice(start, end).trim()) {
      setSelection(null);
      if (popup?.kind !== "toolbar") setPopup(null);
      return;
    }
    if (popup?.kind === "selection" && selection?.start === start && selection.end === end && selection.body === value) return;
    setSelection({ start, end, body: value });
    setPopup({ kind: "selection", source: target,
      anchor: textareaSelectionAnchor(target, start, end, fallback ?? target.getBoundingClientRect()) });
  };
  const openContext = (target: HTMLTextAreaElement, point: EditorActionAnchor, keyboard: boolean) => {
    const { selectionStart: start, selectionEnd: end, value } = target;
    suppressSelection.current = true;
    setSelection(start !== end ? { start, end, body: value } : null);
    setPopup({ kind: "context", source: target, keyboard, clipboard: { start, end, value, draft: draftBody },
      anchor: start !== end || keyboard ? textareaSelectionAnchor(target, start, end, point) : point });
  };
  const applyFormat = (format: InlineFormat) => {
    const target = bodyRef.current;
    if (!target || target.value !== draftBody) return;
    const { selectionStart: start, selectionEnd: end } = target;
    const edit = toggleInlineFormat(draftBody, start, end, format);
    if (!edit) return;
    suppressSelection.current = true;
    target.focus({ preventScroll: true });
    target.setSelectionRange(edit.from, edit.to);
    // insertText keeps the browser's undo history; the fallback still produces the same body.
    if (!target.ownerDocument.execCommand?.("insertText", false, edit.insert) || target.value !== edit.value) {
      onBodyChange(edit.value);
    } else {
      target.setSelectionRange(edit.start, edit.end);
    }
    requestAnimationFrame(() => {
      if (bodyRef.current !== target || target.value !== edit.value) return;
      target.setSelectionRange(edit.start, edit.end);
      setSelection({ start: edit.start, end: edit.end, body: edit.value });
      setPopup({ kind: "selection", source: target,
        anchor: textareaSelectionAnchor(target, edit.start, edit.end, target.getBoundingClientRect()) });
      suppressSelection.current = false;
    });
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
              onClick={event => {
                suppressSelection.current = false;
                setSelection(null);
                const source = event.currentTarget;
                const keyboard = event.detail === 0;
                const anchor = source.getBoundingClientRect();
                setPopup(current => current?.kind === "toolbar" ? null : { kind: "toolbar", source, anchor, keyboard });
              }}>AI writing</button>}
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
                onChange={(event) => { setPopup(null); setSelection(null); onBodyChange(event.target.value); }}
                onSelect={() => updateSelection()}
                onMouseDown={() => { suppressSelection.current = false; }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") return;
                  const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey
                    && formatShortcuts[`${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`];
                  if (shortcut && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) {
                    event.preventDefault();
                    applyFormat(shortcut);
                    return;
                  }
                  suppressSelection.current = false;
                  if (assistantEnabled && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
                    event.preventDefault();
                    openContext(event.currentTarget, event.currentTarget.getBoundingClientRect(), true);
                  }
                }}
                onKeyUp={() => updateSelection()}
                onMouseUp={event => { if (event.button === 0) updateSelection(pointAnchor(event.clientX, event.clientY)); }}
                onContextMenu={(event) => {
                  if (!assistantEnabled) return;
                  event.preventDefault();
                  const keyboard = !event.clientX && !event.clientY && event.button === 0;
                  openContext(event.currentTarget, keyboard ? event.currentTarget.getBoundingClientRect()
                    : pointAnchor(event.clientX, event.clientY), keyboard);
                }}
                placeholder="Write a private note…"
              />
            </label>
            {popup && (popup.clipboard ? popup.clipboard.draft === draftBody : targetText.trim()) && <WritingActionPanel
              key={`${selectedNote?.id}:${popup.kind}:${selection?.start}:${selection?.end}:${draftBody}`}
              platform={platform} organizationId={organizationId} text={targetText} scope={scope}
              anchor={popup.anchor} source={popup.source} focusOnOpen={popup.keyboard} aiEnabled={assistantEnabled}
              formatting={selectedText.trim() && selection ? {
                active: activeInlineFormats(draftBody, selection.start, selection.end), onToggle: applyFormat,
              } : undefined}
              canApply={!selection || selection.body === draftBody}
              clipboard={popup.clipboard && {
                hasSelection: popup.clipboard.start !== popup.clipboard.end,
                run: (action, signal) => {
                  const { start, end, value } = popup.clipboard!;
                  return runEditorClipboard(action, platform, signal, () => {
                    const target = bodyRef.current;
                    if (!target || target.value !== value) return false;
                    suppressSelection.current = true;
                    target.focus({ preventScroll: true });
                    target.setSelectionRange(start, end);
                    return true;
                  }, text => {
                    const target = bodyRef.current;
                    if (!target) return;
                    if (target.ownerDocument.execCommand?.("insertText", false, text)) return;
                    target.setRangeText(text, start, end, "end");
                    setPopup(null);
                    setSelection(null);
                    onBodyChange(target.value);
                  });
                },
              }}
              onClose={closePopup} onApply={(replacement) => {
                if (selection && selection.body !== draftBody) return;
                const next = selection ? draftBody.slice(0, selection.start) + replacement + draftBody.slice(selection.end) : replacement;
                suppressSelection.current = true;
                onBodyChange(next); setPopup(null); setSelection(null);
                requestAnimationFrame(() => {
                  bodyRef.current?.focus();
                  const position = selection ? selection.start + replacement.length : replacement.length;
                  bodyRef.current?.setSelectionRange(position, position);
                });
              }} />}
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
