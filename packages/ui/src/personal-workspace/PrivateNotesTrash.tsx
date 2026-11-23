import { useState } from "react";
import { Icon } from "../shared/Icon";
import { IslandConfirm } from "../shared/IslandConfirm";
import type { PrivateTrashEntry } from "../shared/private-workspace-api";
import type { PrivateNotesController } from "./usePrivateNotes";
import { daysUntil, ROOT_LABEL } from "./privateNotesModel";

export function trashMeta(entry: PrivateTrashEntry, now = Date.now()): string {
  const days = daysUntil(entry.purgeAfter, now);
  const deletes = days <= 0 ? "Deletes within a day" : `Deletes in ${days} ${days === 1 ? "day" : "days"}`;
  const contents = entry.kind === "collection" && entry.itemCount > 1 ? ` · ${entry.itemCount} items` : "";
  return `From ${entry.fromCollectionTitle || ROOT_LABEL}${contents} · ${deletes}`;
}

/** Private Notes trash (ADR 0029): batches stay 30 days, then the server erases their content. */
export function PrivateNotesTrash({ controller }: { controller: PrivateNotesController }) {
  const { trash, trashLoading, trashError, busyAction } = controller;
  const [requested, setConfirming] = useState<PrivateTrashEntry | null>(null);
  // A batch that left the list (deleted, restored or purged elsewhere) closes its confirmation.
  const confirming = requested && trash.some((entry) => entry.batchId === requested.batchId) ? requested : null;
  const [confirmError, setConfirmError] = useState("");
  const busy = busyAction === "restore" || busyAction === "purge";

  return <section className="pn-page pn-trash" aria-labelledby="private-trash-title">
    <div className="pn-page-heading">
      <span className="pn-page-icon" aria-hidden="true"><Icon name="trash" size={22} /></span>
      <h2 id="private-trash-title">Trash</h2>
    </div>
    <p className="pn-page-meta">Items in trash are permanently deleted after 30 days. Only you can see them.</p>
    {trashLoading && !trash.length && <p className="pn-page-meta" role="status">Loading trash…</p>}
    {trashError && <p className="admin-feedback is-error" role="alert">{trashError} <button type="button" className="pn-link-button" onClick={() => void controller.loadTrash()}>Retry</button></p>}
    {!trashLoading && !trashError && !trash.length && <p className="pn-empty-page">Trash is empty.</p>}
    {trash.length > 0 && <ul className="pn-trash-list" aria-label="Items in trash">
      {trash.map((entry) => <li key={entry.batchId} className="pn-trash-row">
        <span className="pn-row-icon" aria-hidden="true"><Icon name={entry.kind === "collection" ? "folder" : "document"} size={17} /></span>
        <span className="pn-trash-copy"><strong>{entry.title}</strong><span>{trashMeta(entry)}</span></span>
        <span className="pn-trash-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void controller.restore(entry.batchId)}>
            <Icon name="restore" size={14} />Restore
          </button>
          <button type="button" className="secondary-button pn-danger-button" disabled={busy}
            onClick={() => { setConfirmError(""); setConfirming(entry); }}>Delete permanently</button>
        </span>
      </li>)}
    </ul>}
    {confirming && <IslandConfirm
      title={`Delete “${confirming.title}” permanently?`}
      description={confirming.kind === "collection" ? "Its notes and collections are erased now. This can’t be undone." : "Its content is erased now. This can’t be undone."}
      actionLabel="Delete permanently"
      busy={busyAction === "purge"}
      error={confirmError}
      onCancel={() => setConfirming(null)}
      onConfirm={() => {
        const entry = confirming;
        void controller.purge(entry.batchId).then((done) => {
          if (done) setConfirming(null);
          else setConfirmError("This couldn’t be deleted. Try again.");
        });
      }} />}
  </section>;
}
