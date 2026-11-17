import { useState } from "react";
import { ApiError, saveKnowledgeCatalogEntry, type KnowledgeCatalog, type KnowledgeCatalogEntry,
  type KnowledgeCatalogWrite, type KnowledgeCollection, type PublishedKnowledge } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { Icon } from "../shared/Icon";
import handbookCover from "../assets/knowledge/employee-handbook.png";
import productionCover from "../assets/knowledge/production-handbook.png";

export const knowledgeCovers = { handbook: handbookCover, production: productionCover };
const blank = (): KnowledgeCatalogWrite => ({ name: "", description: "", status: "ACTIVE" });

export function KnowledgeCatalogEditor({ platform, organizationId, catalog, publications, onSaved, onClose }: {
  platform: Platform; organizationId: string; catalog: KnowledgeCatalog; publications: PublishedKnowledge[];
  onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [kind, setKind] = useState<"topics" | "collections">("topics");
  const [entry, setEntry] = useState<KnowledgeCatalogEntry | null>(null);
  const [value, setValue] = useState<KnowledgeCatalogWrite>(blank);
  const [baseline, setBaseline] = useState(() => JSON.stringify(blank()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const dirty = JSON.stringify(value) !== baseline;
  const guard = (action: () => void) => { if (dirty) setDiscard(() => action); else action(); };
  const select = (nextKind: typeof kind, next: KnowledgeCatalogEntry | null) => guard(() => {
    const collection = next as KnowledgeCollection | null;
    const input: KnowledgeCatalogWrite = { name: next?.name ?? "", description: next?.description ?? "",
      status: next?.status ?? "ACTIVE", ...(nextKind === "collections" ? {
        cover: collection?.cover ?? "handbook", documentIds: collection?.documentIds ?? [],
      } : {}) };
    setKind(nextKind); setEntry(next); setValue(input); setBaseline(JSON.stringify(input)); setError(""); setSearch("");
  });
  const save = async () => {
    setBusy(true); setError("");
    try {
      const saved = await saveKnowledgeCatalogEntry(platform, organizationId, kind, entry, value);
      setEntry(saved); setBaseline(JSON.stringify(value)); await onSaved();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Couldn’t save catalog changes."); }
    finally { setBusy(false); }
  };
  return <section className="island km-catalog" aria-labelledby="km-catalog-title">
    <header className="km-section-heading"><div><h2 id="km-catalog-title">Manage catalog</h2>
      <p>Organize knowledge without changing who can read it.</p></div>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => guard(onClose)}>Back to Library</button></header>
    <div className="km-catalog-layout">
      <nav className="km-catalog-nav" aria-label="Catalog items">
        {(["topics", "collections"] as const).map(group => <section key={group}>
          <div className="km-section-heading"><h3>{group === "topics" ? "Topics" : "Collections"}</h3>
            <button type="button" className="island-icon-button" disabled={busy} aria-label={`New ${group === "topics" ? "topic" : "collection"}`}
              onClick={() => select(group, null)}><Icon name="plus" size={14} /></button></div>
          {catalog[group].length === 0 && <p className="island-meta">None yet</p>}
          {catalog[group].map(item => <button type="button" key={item.id} disabled={busy}
            className={item.id === entry?.id ? "is-selected" : ""} onClick={() => select(group, item)}>
            <span>{item.name}</span>{item.status === "INACTIVE" && <small>Inactive</small>}</button>)}
        </section>)}
      </nav>
      <form className="km-catalog-form knowledge-live-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h3>{entry ? "Edit" : "New"} {kind === "topics" ? "topic" : "collection"}</h3>
        {error && <p className="knowledge-live-error" role="alert">{error}</p>}
        <label className="island-field">Name *<input required maxLength={80} disabled={busy} value={value.name}
          onChange={event => setValue({ ...value, name: event.target.value })} /></label>
        <label className="island-field">Description<textarea rows={2} maxLength={300} disabled={busy} value={value.description}
          onChange={event => setValue({ ...value, description: event.target.value })} /></label>
        <label className="island-field">Status<select disabled={busy} value={value.status}
          onChange={event => setValue({ ...value, status: event.target.value as typeof value.status })}>
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
        {kind === "collections" && <>
          <fieldset className="km-cover-options" disabled={busy}><legend>Cover</legend>
            {(["handbook", "production"] as const).map(cover => <label key={cover}>
              <input type="radio" name="collection-cover" checked={value.cover === cover} onChange={() => setValue({ ...value, cover })} />
              <img src={knowledgeCovers[cover]} alt="" /><span>{cover === "handbook" ? "People & practices" : "Systems & operations"}</span>
            </label>)}
          </fieldset>
          <fieldset className="km-curation" disabled={busy}><legend>Documents</legend>
            <input type="search" aria-label="Filter documents for collection" placeholder="Find a document…" value={search} onChange={event => setSearch(event.target.value)} />
            <div className="km-curation-list">{publications.filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item =>
              <label key={item.id}><input type="checkbox" checked={value.documentIds?.includes(item.id) ?? false}
                onChange={event => setValue({ ...value, documentIds: event.target.checked ? [...(value.documentIds ?? []), item.id]
                  : value.documentIds?.filter(id => id !== item.id) })} /><span>{item.title}</span></label>)}
              {!publications.length && <p>No documents available to curate.</p>}</div>
          </fieldset>
        </>}
        <div className="knowledge-live-actions"><button type="submit" className="primary-button" disabled={busy || !value.name.trim() || !dirty}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => guard(onClose)}>Cancel</button></div>
      </form>
    </div>
    {discard && <DiscardChangesDialog exiting={false} onCancel={() => setDiscard(null)} onDiscard={() => { const next = discard; setDiscard(null); next(); }} />}
  </section>;
}
