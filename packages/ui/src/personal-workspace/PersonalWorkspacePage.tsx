import { useCallback, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import { PrivateNoteEditor } from "./PrivateNoteEditor";
import { PrivateNoteList } from "./PrivateNoteList";
import { SearchField } from "../shared/SearchField";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import { useSearchShortcut } from "../shared/useSearchShortcut";
import { ContributePrivateNoteDialog, type ContributionAttempt } from "./ContributePrivateNoteDialog";
import type { CreatedKnowledgeDraft } from "../shared/api-client";
import type { PrivateNotesController } from "./usePrivateNotes";
import type { Platform } from "../shared/types";

export function PersonalWorkspacePage({ controller, platform, organizationId, contributionAttempt, onContributionAttemptChange, onKnowledgeDraftCreated, contextOpen, onToggleContext }: {
  controller: PrivateNotesController;
  platform: Platform;
  organizationId: string;
  contributionAttempt: ContributionAttempt | null;
  onContributionAttemptChange: (attempt: ContributionAttempt | null) => void;
  onKnowledgeDraftCreated: (draft: CreatedKnowledgeDraft) => void;
} & ContextControlProps) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [contributionOpen, setContributionOpen] = useState(false);
  const revealSearch = useCallback(() => setEditorOpen(false), []);
  const searchRef = useSearchShortcut(revealSearch);
  const { state, selectedNote, draft, isDirty, serverBacked, loading, saving, error, saveMessage } = controller;
  const sourceVersionId = selectedNote?.sourceVersionId;
  const matchingAttempt = contributionAttempt?.sourceVersionId === sourceVersionId ? contributionAttempt : null;
  const visibleNotes = useMemo(() => state.notes.filter((note) => {
    const current = state.drafts[note.id] ?? note;
    return `${current.title} ${current.body}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [state.notes, state.drafts, query]);

  const openEditor = () => {
    setEditorOpen(true);
    // Focus after React reveals the editor on narrow layouts; no content leaves this session.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".editor-title-label textarea")?.focus());
  };
  const backToNotes = () => {
    setEditorOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".note-list .is-selected")?.focus());
  };

  return (
    <main id="arden-main" className="workspace-page" aria-labelledby="personal-workspace-title" tabIndex={-1}>
      <WorkspaceTopbar breadcrumb="Arden / Work / Private Notes" previewLabel={serverBacked ? "PRIVATE NOTES · SERVER" : "SAMPLE NOTES · SESSION ONLY"} contextOpen={contextOpen} onToggleContext={onToggleContext} />
      <WorkspacePageContent className={`personal-content${editorOpen ? " is-editing-note" : ""}`} header={<WorkspacePageHeader className="personal-title-row"
        eyebrow="WORK · OWNER PRIVATE"
        title="Private Notes"
        titleId="personal-workspace-title"
        description="Only you can open these. Contributing creates a separate copy for review; the original stays private."
      />}>
        {loading && <p className="island-meta" role="status">Loading your private notes…</p>}
        {error && <p className="admin-feedback is-error personal-feedback" role="alert">{error}</p>}
        <div className="personal-grid">
          <PrivateNoteList notes={visibleNotes} drafts={state.drafts} selectedId={state.selectedId} searching={Boolean(query.trim())}
            search={<SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search notes…" />}
            onCreate={() => { controller.createNote(); setQuery(""); openEditor(); }}
            onSelect={(note) => { controller.selectNote(note); openEditor(); }} onClearSearch={() => setQuery("")} />
          <PrivateNoteEditor selectedNote={selectedNote} draftTitle={draft.title} draftBody={draft.body} isDirty={isDirty}
            savedMessage={saveMessage || state.savedMessage || (serverBacked ? "Private note · server-backed storage." : "Session preview. Refreshing or exiting clears your notes.")}
            toolbar={<>
              <span className="island-chip"><Icon name="lock" size={12} />Only you</span>
              <span className="private-state" aria-live="polite">{isDirty ? "Unsaved changes" : serverBacked ? "Saved · Server" : "Saved · Preview"}</span>
              <span className="note-toolbar-spacer" />
              <button type="button" className="secondary-button note-back-button" onClick={backToNotes}>Back to notes</button>
              {serverBacked && <button type="button" className="secondary-button" disabled={!sourceVersionId || isDirty || saving} onClick={() => setContributionOpen(true)}><Icon name="layers" size={14} />Contribute copy</button>}
              <button type="button" className="primary-button" disabled={!isDirty || saving} onClick={() => void controller.save(platform, organizationId)}>{saving ? "Saving…" : serverBacked ? "Save" : "Save preview"}</button>
            </>}
            onTitleChange={controller.editTitle} onBodyChange={controller.editBody} />
        </div>
      </WorkspacePageContent>
      {contributionOpen && serverBacked && selectedNote && sourceVersionId && !isDirty && <ContributePrivateNoteDialog
        key={sourceVersionId}
        platform={platform}
        organizationId={organizationId}
        source={{ title: selectedNote.title, body: selectedNote.body, versionId: sourceVersionId }}
        attempt={matchingAttempt}
        onAttemptChange={onContributionAttemptChange}
        onClose={() => setContributionOpen(false)}
        onCreated={(created) => { onContributionAttemptChange(null); setContributionOpen(false); onKnowledgeDraftCreated(created); }}
      />}
    </main>
  );
}
