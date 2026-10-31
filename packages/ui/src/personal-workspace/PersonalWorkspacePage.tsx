import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../shared/Icon";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
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
  const [discarding, setDiscarding] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const revealSearch = useCallback(() => setEditorOpen(false), []);
  const searchRef = useSearchShortcut(revealSearch);
  const { state, selectedNote, draft, isDirty, serverBacked, loading, saving, error, saveMessage } = controller;
  const sourceVersionId = selectedNote?.sourceVersionId;
  const matchingAttempt = contributionAttempt?.sourceVersionId === sourceVersionId ? contributionAttempt : null;
  const visibleNotes = useMemo(() => state.notes.filter((note) => {
    const current = state.drafts[note.id] ?? note;
    return `${current.title} ${current.body}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [state.notes, state.drafts, query]);

  useEffect(() => {
    if (!enteringId) return;
    const timeout = window.setTimeout(() => setEnteringId(null), 520);
    return () => window.clearTimeout(timeout);
  }, [enteringId]);

  const openEditor = () => {
    setEditorOpen(true);
    // Focus after React reveals the editor on narrow layouts; no content leaves this session.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".editor-title-label textarea")?.focus());
  };
  const backToNotes = () => {
    setEditorOpen(false);
    requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>(".note-list .is-selected")
      ?? document.querySelector<HTMLButtonElement>('[aria-label="New private note"]'))?.focus());
  };

  // Contributing a copy opens inside this page's status island rather than a modal dialog.
  const contributionPanel = contributionOpen && serverBacked && selectedNote && sourceVersionId && !isDirty ? <ContributePrivateNoteDialog
    key={sourceVersionId}
    platform={platform}
    organizationId={organizationId}
    source={{ title: selectedNote.title, body: selectedNote.body, versionId: sourceVersionId }}
    attempt={matchingAttempt}
    onAttemptChange={onContributionAttemptChange}
    onClose={() => setContributionOpen(false)}
    onCreated={(created) => { onContributionAttemptChange(null); setContributionOpen(false); onKnowledgeDraftCreated(created); }}
  /> : undefined;

  return (
    <main id="arden-main" className="workspace-page" aria-labelledby="personal-workspace-title" tabIndex={-1}>
      <WorkspaceTopbar breadcrumb="Arden / Work / Private Notes" previewLabel={serverBacked ? undefined : "Demo"} contextOpen={contextOpen} onToggleContext={onToggleContext} panel={contributionPanel} />
      <WorkspacePageContent className={`personal-content${editorOpen ? " is-editing-note" : ""}`} header={<WorkspacePageHeader className="personal-title-row"
        eyebrow="WORK"
        title="Private Notes"
        titleId="personal-workspace-title"
      />}>
        {loading && <p className="island-meta" role="status">Loading your private notes…</p>}
        {error && <p className="admin-feedback is-error personal-feedback" role="alert">{error}</p>}
        <div className="personal-grid">
          <PrivateNoteList notes={visibleNotes} drafts={state.drafts} selectedId={state.selectedId} searching={Boolean(query.trim())}
            search={<SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search notes…" />}
            enteringId={enteringId}
            onCreate={() => {
              const id = controller.createNote();
              setQuery("");
              setEnteringId(id);
              openEditor();
              requestAnimationFrame(() => {
                const list = document.querySelector<HTMLElement>(".note-list");
                if (list) list.scrollTop = 0;
              });
            }}
            onSelect={(note) => { controller.selectNote(note); openEditor(); }} onClearSearch={() => setQuery("")} />
          <PrivateNoteEditor selectedNote={selectedNote} draftTitle={draft.title} draftBody={draft.body} isDirty={isDirty}
            savedMessage={saveMessage || state.savedMessage || (serverBacked ? "" : "Demo · Cleared on refresh")}
            toolbar={<>
              <span className="island-chip"><Icon name="lock" size={12} />Only you</span>
              <span className="private-state" aria-live="polite">{isDirty ? "Unsaved changes" : serverBacked ? "Saved" : "Saved · Demo"}</span>
              <span className="note-toolbar-spacer" />
              <button type="button" className="secondary-button note-back-button" onClick={backToNotes}>Back to notes</button>
              {isDirty && <button type="button" className="secondary-button" disabled={saving} onClick={() => setDiscarding(true)}>Discard changes</button>}
              {serverBacked && <button type="button" className="secondary-button" disabled={!sourceVersionId || isDirty || saving} onClick={() => setContributionOpen(true)}><Icon name="layers" size={14} />Create review draft</button>}
              <button type="button" className="primary-button" disabled={!isDirty || saving} onClick={() => void controller.save(platform, organizationId)}>{saving ? "Saving…" : "Save"}</button>
            </>}
            entering={selectedNote?.id === enteringId}
            onTitleChange={controller.editTitle} onBodyChange={controller.editBody} />
        </div>
      </WorkspacePageContent>
      {discarding && <DiscardChangesDialog exiting={false} onCancel={() => setDiscarding(false)} onDiscard={() => {
        controller.discardSelected(); setDiscarding(false);
        if (selectedNote?.updatedLabel === "Not saved") backToNotes(); else openEditor();
      }} />}
    </main>
  );
}
