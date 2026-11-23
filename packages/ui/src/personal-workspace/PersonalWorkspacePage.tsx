import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { ActionToast } from "../shared/ActionToast";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { PrivateNoteEditor } from "./PrivateNoteEditor";
import { WorkspaceTopbar, type ContextControlProps, type TopbarCrumb } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import { ContributePrivateNoteDialog, type ContributionAttempt } from "./ContributePrivateNoteDialog";
import type { CreatedKnowledgeDraft } from "../shared/api-client";
import type { PrivateNotesController } from "./usePrivateNotes";
import type { Platform } from "../shared/types";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { focusNoteTitle, itemActions } from "./PrivateNotesTree";
import { PrivateNotesTrash } from "./PrivateNotesTrash";
import { ancestorsOf, childrenOf, collectionItem, noteItem, ROOT_LABEL, type TreeItem } from "./privateNotesModel";

function FavoriteToggle({ item, controller, disabled }: { item: TreeItem; controller: PrivateNotesController; disabled: boolean }) {
  const favorite = Boolean(item.favoritedAt);
  return <button type="button" className={`pn-icon-button pn-header-button pn-star${favorite ? " is-on" : ""}`} aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
    title={favorite ? "Remove from favorites" : "Add to favorites"} disabled={disabled}
    onClick={() => void controller.toggleFavorite({ kind: item.kind, id: item.id })}><Icon name="star" size={16} /></button>;
}

function CollectionTitleInput({ title, onDone }: { title: string; onDone: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const finish = (value: string | null) => { if (settled.current) return; settled.current = true; onDone(value); };
  return <input ref={input} className="pn-title-input" aria-label={`Rename ${title}`} defaultValue={title} maxLength={200}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(null); }
    }}
    onBlur={(event) => finish(event.currentTarget.value)} />;
}

/** Lists a collection's (or the root's) children, collections first. */
function ItemListing({ items, onOpen }: { items: TreeItem[]; onOpen: (item: TreeItem) => void }) {
  return <ul className="pn-card-list">
    {items.map((item) => <li key={`${item.kind}:${item.id}`}>
      <button type="button" className="pn-card" onClick={() => onOpen(item)}>
        <Icon name={item.kind === "collection" ? "folder" : "document"} size={17} />
        <span className="pn-card-copy"><strong>{item.title}</strong><span>{item.kind === "collection" ? "Collection" : "Note"}</span></span>
      </button>
    </li>)}
  </ul>;
}

export function PersonalWorkspacePage({ controller, platform, organizationId, contributionAttempt, onContributionAttemptChange, onKnowledgeDraftCreated, contextOpen, onToggleContext }: {
  controller: PrivateNotesController;
  platform: Platform;
  organizationId: string;
  contributionAttempt: ContributionAttempt | null;
  onContributionAttemptChange: (attempt: ContributionAttempt | null) => void;
  onKnowledgeDraftCreated: (draft: CreatedKnowledgeDraft) => void;
} & ContextControlProps) {
  const [contributionOpen, setContributionOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(0);
  const { state, selectedNote, draft, isDirty, serverBacked, loading, saving, error, saveMessage, focus, collections, actionError, busyAction } = controller;
  const sourceVersionId = selectedNote?.sourceVersionId;
  const matchingAttempt = contributionAttempt?.sourceVersionId === sourceVersionId ? contributionAttempt : null;
  const collection = focus.kind === "collection" ? collections.find((entry) => entry.id === focus.id) ?? null : null;
  const view = focus.kind === "trash" ? "trash" : collection ? "collection" : focus.kind === "note" && selectedNote ? "note" : "root";
  const titleOf = (note: (typeof state.notes)[number]) => state.drafts[note.id]?.title ?? note.title;
  const current: TreeItem | null = view === "note" && selectedNote ? noteItem(selectedNote, collections, draft.title)
    : view === "collection" && collection ? collectionItem(collection) : null;
  const ancestors = current ? ancestorsOf(collections, current.parentId) : [];
  const breadcrumb = ["Arden", view === "trash" ? "Trash" : ROOT_LABEL, ...ancestors.map((entry) => entry.title), ...(current ? [current.title] : [])].join(" / ");
  // Like Notion: the trail starts at the outermost collection; only items at the top level show the Private Notes root.
  const crumbs: TopbarCrumb[] = view === "trash" ? [{ label: "Trash" }] : [
    ...(ancestors.length ? [] : [{ label: ROOT_LABEL, onSelect: controller.openRoot }]),
    ...ancestors.map((entry) => ({ label: entry.title, onSelect: () => controller.openCollection(entry.id) })),
    ...(current ? [{ label: current.title || "Untitled" }] : []),
  ];
  const pending = selectedNote ? controller.isPending(selectedNote) : false;
  const notice = controller.notice && controller.notice.id !== dismissedNotice ? controller.notice : null;

  const open = (item: TreeItem) => { if (item.kind === "note") controller.openNote(item.id); else controller.openCollection(item.id); };

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

  const headerMenu = (item: TreeItem) => <ItemActionsMenu placement="below" triggerClassName="pn-icon-button pn-header-button"
    label={`More actions for ${item.title}`}
    actions={itemActions(controller, item, item.kind === "note"
      ? () => focusNoteTitle()
      : () => controller.startRename(item, "page"))} />;

  return (
    <main id="arden-main" className="workspace-page" aria-labelledby="personal-workspace-title" tabIndex={-1}>
      <WorkspaceTopbar breadcrumb={breadcrumb} crumbs={crumbs} previewLabel={serverBacked ? undefined : "Demo"} contextOpen={contextOpen} onToggleContext={onToggleContext} panel={contributionPanel} />
      <WorkspacePageContent className="personal-content is-single is-editing-note" header={<WorkspacePageHeader className="personal-title-row"
        eyebrow="WORK"
        title="Private Notes"
        titleId="personal-workspace-title"
      />}>
        {loading && <p className="island-meta pn-page-status" role="status">Loading your private notes…</p>}
        {error && <p className="admin-feedback is-error personal-feedback pn-page-status" role="alert">{error}</p>}
        {actionError && <p className="admin-feedback is-error personal-feedback pn-page-status" role="alert">{actionError}
          {" "}<button type="button" className="pn-link-button" onClick={controller.dismissActionError}>Dismiss</button></p>}
        {notice && <ActionToast key={notice.id} message={notice.message} onDismiss={() => setDismissedNotice(notice.id)} />}
        <div className="personal-grid">
          {view === "note" && current && <PrivateNoteEditor selectedNote={selectedNote} draftTitle={draft.title} draftBody={draft.body} isDirty={isDirty}
            savedMessage={saveMessage || state.savedMessage || (serverBacked ? "" : "Demo · Cleared on refresh")}
            toolbar={<>
              <FavoriteToggle item={current} controller={controller} disabled={pending || busyAction === "favorite"} />
              <span className="island-chip"><Icon name="lock" size={12} />Only you</span>
              <span className="private-state" aria-live="polite">{isDirty ? "Unsaved changes" : serverBacked ? "Saved" : "Saved · Demo"}</span>
              <span className="note-toolbar-spacer" />
              {isDirty && <button type="button" className="secondary-button" disabled={saving} onClick={() => setDiscarding(true)}>Discard changes</button>}
              {serverBacked && <button type="button" className="secondary-button" disabled={!sourceVersionId || isDirty || saving} onClick={() => setContributionOpen(true)}><Icon name="layers" size={14} />Create review draft</button>}
              {headerMenu(current)}
              <button type="button" className="primary-button" disabled={!isDirty || saving} onClick={() => void controller.save(platform, organizationId)}>{saving ? "Saving…" : "Save"}</button>
            </>}
            onTitleChange={controller.editTitle} onBodyChange={controller.editBody} />}

          {view === "collection" && collection && current && <section className="pn-page" aria-labelledby="private-collection-title">
            <div className="pn-page-toolbar">
              <span className="note-toolbar-spacer" />
              <FavoriteToggle item={current} controller={controller} disabled={busyAction === "favorite"} />
              <span className="island-chip"><Icon name="lock" size={12} />Only you</span>
              {headerMenu(current)}
            </div>
            <div className="pn-page-body">
              <div className="pn-page-heading">
                <span className="pn-page-icon" aria-hidden="true"><Icon name="folder" size={22} /></span>
                {controller.renaming?.where === "page" && controller.renaming.kind === "collection" && controller.renaming.id === collection.id
                  ? <CollectionTitleInput title={current.title} onDone={(value) => {
                    if (value === null) controller.cancelRename();
                    else void controller.commitRename({ kind: "collection", id: collection.id }, value);
                  }} />
                  : <h2 id="private-collection-title">{current.title}</h2>}
              </div>
              {(() => {
                const children = childrenOf(collections, state.notes, collection.id, titleOf);
                return <>
                  <p className="pn-page-meta">Collection · {children.length === 1 ? "1 item" : `${children.length} items`} · Only you</p>
                  {children.length ? <ItemListing items={children} onOpen={open} /> : <p className="pn-empty-page">This collection is empty.</p>}
                </>;
              })()}
              <div className="pn-page-actions">
                <button type="button" className="secondary-button" disabled={busyAction === "create-note"} onClick={() => void controller.addNote(collection.id, "page").then(focusNoteTitle)}>
                  <Icon name="plus" size={14} />New note in this collection
                </button>
              </div>
            </div>
          </section>}

          {view === "root" && <section className="pn-page" aria-labelledby="private-root-title">
            <div className="pn-page-toolbar">
              <span className="island-chip"><Icon name="lock" size={12} />Only you</span>
              <span className="private-state">{serverBacked ? "" : "Demo · Cleared on refresh"}</span>
            </div>
            <div className="pn-page-body">
              <div className="pn-page-heading">
                <span className="pn-page-icon" aria-hidden="true"><Icon name="lock" size={22} /></span>
                <h2 id="private-root-title">{ROOT_LABEL}</h2>
              </div>
              {(() => {
                const children = childrenOf(collections, state.notes, null, titleOf);
                return children.length ? <ItemListing items={children} onOpen={open} />
                  : !loading && <p className="pn-empty-page">No private notes yet.</p>;
              })()}
              <div className="pn-page-actions">
                <button type="button" className="primary-button pn-root-new-note" disabled={loading || busyAction === "create-note"} onClick={() => void controller.addNote(null, "page").then(focusNoteTitle)}>
                  <Icon name="plus" size={14} />New note
                </button>
                <button type="button" className="secondary-button" disabled={loading || busyAction === "create-collection"}
                  onClick={() => void controller.createCollection(null, "page")}>
                  <Icon name="folder-add" size={14} />New collection
                </button>
              </div>
            </div>
          </section>}

          {view === "trash" && <PrivateNotesTrash controller={controller} />}
        </div>
      </WorkspacePageContent>
      {discarding && <DiscardChangesDialog exiting={false} onCancel={() => setDiscarding(false)} onDiscard={() => {
        const wasNew = selectedNote ? controller.isPending(selectedNote) : false;
        controller.discardSelected(); setDiscarding(false);
        if (wasNew) {
          controller.openRoot();
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".pn-root-new-note")?.focus());
        } else focusNoteTitle();
      }} />}
    </main>
  );
}
