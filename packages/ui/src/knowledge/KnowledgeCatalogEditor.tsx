import { useEffect, useRef, useState } from "react";
import { matchesPublicationScope } from "@arden/domain";
import { loadKnowledgeCatalog, type KnowledgeCatalog, type PublishedKnowledge } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { Icon } from "../shared/Icon";
import { CollectionForm } from "./CollectionForm";
import { CollectionPlacementEditor } from "./CollectionPlacementEditor";
import handbookCover from "../assets/knowledge/employee-handbook.png";
import productionCover from "../assets/knowledge/production-handbook.png";

export const knowledgeCovers = { handbook: handbookCover, production: productionCover };
type Props = { platform: Platform; organizationId: string; catalog: KnowledgeCatalog; publications: PublishedKnowledge[];
  publicationsUnavailable?: boolean; onSaved: () => Promise<void>; onClose: () => void };

export function KnowledgeCatalogEditor(props: Props) {
  return <CollectionManager key={props.organizationId} {...props} />;
}
function CollectionManager({ platform, organizationId, catalog: suppliedCatalog, publications, publicationsUnavailable = false, onSaved, onClose }: Props) {
  const [catalog, setCatalog] = useState(suppliedCatalog);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false), [moving, setMoving] = useState<PublishedKnowledge | null>(null);
  const [busy, setBusy] = useState(false), [search, setSearch] = useState(""), [message, setMessage] = useState("");
  const live = useRef(true), moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const editButton = useRef<HTMLButtonElement>(null), newButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setCatalog(suppliedCatalog); }, [suppliedCatalog]);
  useEffect(() => {
    if (!suppliedCatalog.canManage) { setEditing(false); setMoving(null); setBusy(false); }
  }, [suppliedCatalog.canManage]);
  useEffect(() => {
    if (editing || moving || !restoreFocus.current) return;
    const target = restoreFocus.current;
    restoreFocus.current = null;
    (target === "new" ? newButton.current : target === "edit" ? editButton.current : moveButtons.current.get(target) ?? heading.current)?.focus();
  }, [editing, moving]);
  const eligible = publications.filter(item => matchesPublicationScope(item.targetReaders?.mode, "ORGANIZATION"));
  const folder = catalog.collections.find(item => item.id === selected) ?? null;
  const assigned = new Set(catalog.collections.filter(item => item.status === "ACTIVE").flatMap(item => item.documentIds));
  const visible = eligible.filter(item => (selected ? folder?.documentIds.includes(item.id) : !assigned.has(item.id))
    && item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const closeMove = () => { setMoving(null); setBusy(false); };
  const closeEdit = () => { setEditing(false); setBusy(false); };
  const refresh = async () => {
    const next = await loadKnowledgeCatalog(platform, organizationId);
    if (!live.current) return;
    setCatalog(next); setBusy(false); closeEdit(); closeMove(); setMessage("Updated.");
    // A list refresh failure does not turn a confirmed write into a failed save.
    try { await onSaved(); } catch { if (live.current) setMessage("Updated. Reopen Home to refresh documents."); }
  };
  if (!catalog.canManage || !suppliedCatalog.canManage) return <p role="status">Collection management is unavailable.</p>;
  return <section className="island km-catalog" aria-labelledby="km-catalog-title">
    <header className="km-section-heading"><div><h2 id="km-catalog-title" ref={heading} tabIndex={-1}>Manage collections</h2><p>Organization documents only.</p></div>
      <button type="button" className="secondary-button" disabled={busy || editing || !!moving} onClick={onClose}>Back</button></header>
    {message && <p role="status" className="island-note">{message}</p>}
    <div className="km-catalog-layout">
      <nav className="km-catalog-nav" aria-label="Collections"><section>
        <button type="button" aria-current={!selected && !editing ? "page" : undefined} disabled={busy || editing || !!moving} onClick={() => { setSelected(""); setSearch(""); }}>Unassigned</button>
        {catalog.collections.map(item => <button type="button" key={item.id} aria-current={selected === item.id ? "page" : undefined}
          disabled={busy || editing || !!moving} onClick={() => { setSelected(item.id); setSearch(""); }}>
          <span>{item.name}</span>{item.status === "INACTIVE" ? <small>Archived</small> : !item.allowedTypes?.length ? <small>Setup needed</small> : null}</button>)}
        <button type="button" ref={newButton} disabled={busy || editing || !!moving} onClick={() => { restoreFocus.current = "new"; setSelected(""); setEditing(true); setMessage(""); }}><Icon name="plus" size={14} />New collection</button>
      </section></nav>
      <div className="km-folder-content">
        {editing ? <CollectionForm platform={platform} organizationId={organizationId} entry={folder} onBusy={setBusy}
          onSaved={refresh} onCancel={closeEdit} /> : moving ? <CollectionPlacementEditor key={moving.draftId} platform={platform}
          organizationId={organizationId} publication={moving} collections={catalog.collections} onBusy={setBusy} onSaved={refresh} onClose={closeMove} /> : <>
          <header className="km-section-heading"><div><h3>{folder?.name ?? "Unassigned"}</h3><p>{folder?.status === "INACTIVE" ? "Archived · documents returned to Unassigned."
            : folder ? folder.allowedTypes?.length ? folder.allowedTypes.join(" · ") : "Set allowed types before adding documents." : "Organization documents without a collection."}</p></div>
            {folder && <button type="button" ref={editButton} className="secondary-button" onClick={() => { restoreFocus.current = "edit"; setEditing(true); setMessage(""); }}>{folder.status === "INACTIVE" ? "View details" : "Edit collection"}</button>}</header>
          <label className="island-field"><span className="sr-only">Find organization documents</span><input type="search" value={search} placeholder="Find a document…" onChange={event => setSearch(event.target.value)} /></label>
          {publicationsUnavailable && <p role="alert" className="island-note is-warning">Documents unavailable. Reopen Home and refresh before moving documents.</p>}
          <ul className="km-folder-documents">{!publicationsUnavailable && visible.map(item => <li key={item.id}><span><strong>{item.title}</strong><small>{item.management?.type ?? "Type not recorded"} · {item.management?.version || "Version not recorded"}</small></span>
            <button type="button" className="secondary-button" aria-label={`Move ${item.title}`}
              ref={node => { if (node) moveButtons.current.set(item.draftId, node); else moveButtons.current.delete(item.draftId); }}
              onClick={() => { restoreFocus.current = item.draftId; setMoving(item); setMessage(""); }}>Move</button></li>)}</ul>
          {!publicationsUnavailable && !visible.length && <p className="km-empty-inline">{search ? "No matching documents." : "No documents here."}</p>}
        </>}
      </div>
    </div>
  </section>;
}
