import { useCallback, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import { PrivateNoteEditor } from "./PrivateNoteEditor";
import { PrivateNoteList } from "./PrivateNoteList";
import { SearchField } from "../shared/SearchField";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { useSearchShortcut } from "../shared/useSearchShortcut";
import type { PrivateNotesController } from "./usePrivateNotes";
import type { Platform } from "../shared/types";

export function PersonalWorkspacePage({ controller, platform, organizationId, contextOpen, onToggleContext }: {
  controller: PrivateNotesController;
  platform: Platform;
  organizationId: string;
} & ContextControlProps) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const revealSearch = useCallback(() => setEditorOpen(false), []);
  const searchRef = useSearchShortcut(revealSearch);
  const { state, selectedNote, draft, isDirty, serverBacked, loading, saving, error, saveMessage } = controller;
  const visibleNotes = useMemo(() => state.notes.filter((note) => {
    const current = state.drafts[note.id] ?? note;
    return `${current.title} ${current.body}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [state.notes, state.drafts, query]);

  const openEditor = () => {
    setEditorOpen(true);
    // Focus after React reveals the mobile editor; no content leaves this session.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".editor-title-label textarea")?.focus());
  };

  return (
    <main id="arden-main" className="workspace-page" aria-labelledby="personal-workspace-title" tabIndex={-1}>
      <WorkspaceTopbar breadcrumb="Arden / Personal Workspace" previewLabel={serverBacked ? "PRIVATE NOTES · SERVER" : "SAMPLE NOTES · SESSION ONLY"} contextOpen={contextOpen} onToggleContext={onToggleContext} />
      <div className={`workspace-content personal-content${editorOpen ? " is-editing-note" : ""}`}>
        <div className="page-title-row personal-title-row">
          <div>
            <span className="meta-label">PERSONAL / OWNER PRIVATE</span>
            <h1 id="personal-workspace-title">{editorOpen ? draft.title.trim() || "Untitled private note" : "Private notes"}</h1>
            <p>{editorOpen ? isDirty ? "Unsaved changes · Your draft is kept while you work." : serverBacked ? "Saved to your private workspace on the Arden server." : "Saved in this preview session." : "Only you can view these notes. Sharing always creates a separate governed copy."}</p>
          </div>
          {!editorOpen && <button type="button" className="primary-button" onClick={() => { controller.createNote(); setQuery(""); openEditor(); }}>
            <Icon name="plus" size={16} /> New private note
          </button>}
        </div>
        {!editorOpen && <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search your private notes…" />}
        {editorOpen && <div className="private-editor-toolbar">
          <span className="private-state"><Icon name="lock" size={14} /> PRIVATE · ONLY YOU</span>
          <button type="button" className="secondary-button" onClick={() => {
          setEditorOpen(false);
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".note-list .is-selected")?.focus());
        }}>Back to notes</button>
          <button type="button" className="primary-button" disabled={!isDirty || saving} onClick={() => void controller.save(platform, organizationId)}>{saving ? "Saving…" : serverBacked ? "Save private note" : "Save preview note"}</button>
        </div>}
        {loading && <p role="status">Loading your private notes…</p>}
        {error && <p className="sign-in-message" role="alert">{error}</p>}
        {saveMessage && <p role="status">{saveMessage}</p>}
        <div className="personal-grid">
          {editorOpen ? <PrivateNoteEditor selectedNote={selectedNote} draftTitle={draft.title} draftBody={draft.body} isDirty={isDirty} savedMessage={saveMessage || state.savedMessage || (serverBacked ? "Private note · server-backed storage." : "Session preview. Refreshing or exiting clears your notes.")} onTitleChange={controller.editTitle} onBodyChange={controller.editBody} /> : <PrivateNoteList notes={visibleNotes} drafts={state.drafts} selectedId={state.selectedId} searching={Boolean(query.trim())} onSelect={(note) => { controller.selectNote(note); openEditor(); }} onClearSearch={() => setQuery("")} />}
          <aside className="private-ownership-card" aria-label="Private note ownership">
            <Icon name="lock" size={32} />
            <span className="meta-label">{editorOpen ? "PRIVACY" : "PRIVATE BY DEFAULT"}</span>
            <h2>{editorOpen ? "Only you" : <>Your working <br />memory</>}</h2>
            <p>A private note is visible only to its owner.</p>
            <hr />
            <p>Publishing or contributing creates a separate governed item. It never changes this note silently.</p>
            <span className="private-guidance-badge">YOU DECIDE WHAT TO SHARE</span>
            {editorOpen && <p className="private-save-status" aria-live="polite">{isDirty ? "Your draft has unsaved changes." : state.savedMessage || "No pending changes."}</p>}
          </aside>
        </div>
      </div>
    </main>
  );
}
