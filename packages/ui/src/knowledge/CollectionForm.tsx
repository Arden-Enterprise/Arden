import { useEffect, useRef, useState } from "react";
import { knowledgeTypes } from "@arden/domain";
import { ApiError, saveKnowledgeCatalogEntry, type KnowledgeCollection, type KnowledgeCatalogWrite } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { IslandConfirm } from "../shared/IslandConfirm";

/** Configuration only. Placement has a separate revision and mutation path. */
export function CollectionForm({ platform, organizationId, entry: suppliedEntry, onSaved, onCancel, onBusy }: {
  platform: Platform; organizationId: string; entry: KnowledgeCollection | null;
  onSaved: () => Promise<void>; onCancel: () => void; onBusy: (busy: boolean) => void;
}) {
  // Focus refreshes must not replace the revision against which these edits began.
  const [entry] = useState(suppliedEntry);
  const live = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    live.current = true; heading.current?.focus();
    return () => { live.current = false; };
  }, []);
  const [initial] = useState<KnowledgeCatalogWrite>(() => ({ name: entry?.name ?? "", description: entry?.description ?? "",
    status: entry?.status ?? "ACTIVE", cover: entry?.cover ?? "handbook", allowedTypes: entry?.allowedTypes ?? [] }));
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false), [discard, setDiscard] = useState(false), [archive, setArchive] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const archived = entry?.status === "INACTIVE";
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const cancel = () => { if (busy) return; if (dirty && !blocked) setDiscard(true); else onCancel(); };
  const save = async (input: KnowledgeCatalogWrite) => {
    if (busy || blocked || archived || !input.name.trim() || !input.allowedTypes?.length) return;
    setBusy(true); onBusy(true); setError("");
    try { await saveKnowledgeCatalogEntry(platform, organizationId, "collections", entry, input); }
    catch (cause) {
      if (!live.current) return;
      setArchive(false); setBlocked(true);
      // Never blindly repeat a create or a write whose result may be unknown.
      setError(cause instanceof ApiError && cause.status === 412 ? "Collection changed. Reload before editing."
        : cause instanceof ApiError && cause.status === 409 ? "Collection could not be saved. Reload and check its name."
        : cause instanceof ApiError && [400, 404].includes(cause.status) ? "Collection is unavailable or its details are no longer valid. Reload to check."
        : "Couldn’t confirm the change. Reload to check.");
      setBusy(false); onBusy(false); return;
    }
    if (!live.current) return;
    setBlocked(true); setArchive(false);
    try { await onSaved(); } catch { setError("Saved. Reload to update this view."); }
    finally { if (live.current) { setBusy(false); onBusy(false); } }
  };
  const reload = async () => {
    setBusy(true); onBusy(true);
    try { await onSaved(); } catch { setError("Couldn’t reload. Try again."); }
    finally { if (live.current) { setBusy(false); onBusy(false); } }
  };
  return <form className="km-catalog-form knowledge-live-form" onSubmit={event => { event.preventDefault(); void save(value); }}>
    <h3 ref={heading} tabIndex={-1}>{entry ? archived ? "Archived collection" : "Edit collection" : "New collection"}</h3>
    {error && <p className="knowledge-live-error" role="alert">{error}</p>}
    {blocked && <button type="button" className="secondary-button" disabled={busy} onClick={() => void reload()}>Reload collections</button>}
    <fieldset className="km-collection-fields" disabled={busy || blocked || archived}>
      <label className="island-field">Name *<input required maxLength={80} value={value.name}
        onChange={event => setValue({ ...value, name: event.target.value })} /></label>
      <fieldset className="km-allowed-types"><legend>Allowed types *</legend>
        {knowledgeTypes.map(type => <label key={type}><input type="checkbox" checked={value.allowedTypes?.includes(type) ?? false}
          onChange={event => setValue({ ...value, allowedTypes: knowledgeTypes.filter(candidate => candidate === type
            ? event.target.checked : value.allowedTypes?.includes(candidate)) })} />{type}</label>)}
      </fieldset>
      <label className="island-field">Description<textarea rows={2} maxLength={300} value={value.description}
        onChange={event => setValue({ ...value, description: event.target.value })} /></label>
      <label className="island-field">Cover<select value={value.cover} onChange={event => setValue({ ...value, cover: event.target.value as "handbook" | "production" })}>
        <option value="handbook">People & practices</option><option value="production">Systems & operations</option></select></label>
    </fieldset>
    {entry && !archived && dirty && <p className="island-note">Documents outside the allowed types will return to Unassigned.</p>}
    <div className="knowledge-live-actions">
      {!archived && <button type="submit" className="primary-button" disabled={busy || blocked || !dirty || !value.name.trim() || !value.allowedTypes?.length}>{busy ? "Saving…" : "Save"}</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={cancel}>Cancel</button>
      {entry && !archived && <button type="button" className="km-text-button" disabled={busy || blocked || dirty || !value.allowedTypes?.length} onClick={() => setArchive(true)}>Archive collection</button>}
    </div>
    {archive && <IslandConfirm title={`Archive ${entry?.name}?`} description="Documents will return to Unassigned. They stay published."
      actionLabel="Archive collection" busy={busy} error="" onCancel={() => { if (!busy) setArchive(false); }} onConfirm={() => void save({ ...value, status: "INACTIVE" })} />}
    {discard && <DiscardChangesDialog exiting={false} onCancel={() => setDiscard(false)} onDiscard={onCancel} />}
  </form>;
}
