import { useState } from "react";
import { Icon } from "../shared/Icon";
import type { PrivateNotesController } from "./usePrivateNotes";
import { arrangeArchived, UNTITLED_NOTE, type ArchiveSort } from "./privateNotesModel";

const SORT_LABELS: Record<ArchiveSort, string> = {
  archived: "Recently archived",
  updated: "Last edited",
  title: "Title A–Z",
};

export function archivedWhen(isoDate: string): string {
  const time = Date.parse(isoDate);
  return Number.isFinite(time)
    ? `Archived ${new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Archived";
}

/**
 * Archived private notes (spec F03-ARR), reached from the account menu. Search and sort run over the
 * loaded list; notes are grouped by the collection Unarchive returns them to. Delete is the regular
 * Move to trash, so the note stays restorable from Trash for 30 days.
 */
export function PrivateNotesArchive({ controller }: { controller: PrivateNotesController }) {
  const { archive, archiveHasMore, archiveLoading, archiveError, busyAction } = controller;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ArchiveSort>("archived");
  const groups = arrangeArchived(archive, query, sort);
  const busy = busyAction === "unarchive" || busyAction === "trash";
  const shown = groups.reduce((total, group) => total + group.items.length, 0);

  return <section className="pn-page pn-archive" aria-labelledby="private-archive-title">
    <div className="pn-page-heading">
      <span className="pn-page-icon" aria-hidden="true"><Icon name="archive" size={22} /></span>
      <h2 id="private-archive-title">Archived notes</h2>
    </div>
    <p className="pn-page-meta">Find notes you’ve archived and restore the ones you want to keep using. Only you can see them.</p>
    <div className="pn-archive-controls">
      <label className="pn-archive-search">
        <Icon name="search" size={15} />
        <span className="sr-only">Search archived notes</span>
        <input type="search" placeholder="Search archived notes" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <label className="pn-archive-sort">
        <Icon name="sliders" size={14} />
        <span className="sr-only">Sort archived notes</span>
        <select value={sort} onChange={(event) => setSort(event.currentTarget.value as ArchiveSort)}>
          {(Object.keys(SORT_LABELS) as ArchiveSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
        </select>
      </label>
    </div>
    {archiveLoading && !archive.length && <p className="pn-page-meta" role="status">Loading archived notes…</p>}
    {archiveError && <p className="admin-feedback is-error" role="alert">{archiveError}{" "}
      <button type="button" className="pn-link-button" onClick={() => void controller.loadArchive()}>Retry</button></p>}
    {!archiveLoading && !archiveError && !archive.length && <p className="pn-empty-page">
      No archived notes. Choose Archive in a note’s ··· menu to hide it from your notes without deleting it.
    </p>}
    {archive.length > 0 && !shown && <p className="pn-empty-page">No archived notes match “{query.trim()}”.</p>}
    <span className="sr-only" role="status" aria-live="polite">{query.trim() ? `${shown} ${shown === 1 ? "note" : "notes"} found` : ""}</span>
    {groups.map((group) => <section key={group.key} className="pn-archive-group" aria-label={`From ${group.title}`}>
      <div className="pn-archive-group-head">
        <Icon name={group.collectionId ? "folder" : "lock"} size={15} />
        <strong className="pn-ellipsis">{group.title}</strong>
        <span>{group.items.length === 1 ? "1 note" : `${group.items.length} notes`}</span>
      </div>
      <ul className="pn-trash-list">
        {group.items.map((item) => {
          const title = item.title || UNTITLED_NOTE;
          return <li key={item.id} className="pn-trash-row">
            <span className="pn-row-icon" aria-hidden="true"><Icon name="document" size={17} /></span>
            <span className="pn-trash-copy"><strong>{title}</strong><span>{archivedWhen(item.archivedAt)}</span></span>
            <span className="pn-trash-actions">
              <button type="button" className="secondary-button" disabled={busy} aria-label={`Unarchive ${title}`}
                onClick={() => void controller.unarchiveNote(item.id)}>
                <Icon name="unarchive" size={14} />Unarchive
              </button>
              <button type="button" className="secondary-button pn-danger-button" disabled={busy} aria-label={`Delete ${title}: move it to trash`}
                title="Moves the note to Trash, where it stays for 30 days" onClick={() => void controller.trashArchived(item.id)}>
                <Icon name="trash" size={14} />Delete
              </button>
            </span>
          </li>;
        })}
      </ul>
    </section>)}
    {archiveHasMore && <p className="pn-page-meta">Showing the 1,000 most recently archived notes.</p>}
  </section>;
}
