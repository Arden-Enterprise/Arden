import { knowledgeTypes, validityStatus } from "@arden/domain";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import type { KnowledgeCatalog, PublishedKnowledge } from "../shared/api-client";
import { libraryDateLabel } from "./libraryDisplay";
import { knowledgeCovers } from "./KnowledgeCatalogEditor";

export type LibraryFilters = { type: string; ownerId: string; collectionId: string };
export const emptyLibraryFilters = (): LibraryFilters => ({ type: "", ownerId: "", collectionId: "" });
export function filterLibrary(items: PublishedKnowledge[], catalog: KnowledgeCatalog | null, query: string, filters: LibraryFilters) {
  const terms = query.trim().toLocaleLowerCase();
  const collection = filters.collectionId ? catalog?.collections.find(item => item.id === filters.collectionId) : null;
  const assigned = new Set(catalog?.collections.filter(item => item.status === "ACTIVE").flatMap(item => item.documentIds));
  return items.filter(item => (!filters.type || item.management?.type === filters.type)
    && (!filters.ownerId || item.responsibleDepartmentId === filters.ownerId)
    && (!filters.collectionId || (filters.collectionId === "unassigned" ? Boolean(catalog) && !assigned.has(item.id)
      : collection?.status === "ACTIVE" && collection.documentIds.includes(item.id)))
    && (!terms || [item.title, item.management?.type,
      item.responsibleDepartmentName].some(value => value?.toLocaleLowerCase().includes(terms))))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
}

/** One status vocabulary for Home and the reader: Current, Expires in N days, Expired. */
export function validityLabel({ status, daysLeft }: ReturnType<typeof validityStatus>): string {
  if (status === "Expiring soon") return daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  return status;
}

/** Same chip tones as the reader: sage Current, amber Expires soon, coral Expired. */
const statusTone: Record<ReturnType<typeof validityStatus>["status"], string> = {
  Current: "effective", "Expiring soon": "expiring", Expired: "expired",
};

function DocumentRegister({ items, onOpen, recent = false, showReaders = false }: { items: PublishedKnowledge[]; onOpen: (id: string) => void; recent?: boolean; showReaders?: boolean }) {
  return <IslandTable label={recent ? "Newly published documents" : "All documents"} minWidth={940}
    columns="minmax(270px, 2.8fr) minmax(120px, 1fr) minmax(130px, 1fr) 70px 115px 140px"
    headers={["DOCUMENT", "TYPE", "OWNER", "VERSION", recent ? "PUBLISHED" : "VALID UNTIL", "STATUS"]}>
    {items.map(item => {
      const validity = validityStatus(item.management, new Date().toLocaleDateString("en-CA"));
      const release = item.management?.releaseKind;
      const releaseTag = recent && release ? release === "UPDATED" ? "Updated" : "New" : null;
      return <IslandRow key={item.id} className="library-row">
        <IslandCell className="island-row-cell is-name"><button className="island-row-name library-row-name" type="button" data-publication-id={item.id} aria-label={`Read ${item.title}`}
          title={item.title} onClick={() => onOpen(item.id)}>
          <span className="library-row-icon"><Icon name="document" size={17} /></span><span className="library-row-copy">
            <strong className="library-row-title">{item.title}</strong>
            {/* The meta line exists only when it says something; an empty line would add height to every row. */}
            {(showReaders || releaseTag) && <span className="library-row-meta">{showReaders && (item.targetReaders?.mode === "DEPARTMENT" ? "Department readers" : "Selected readers")}
              {releaseTag && <span className="km-release">{releaseTag}</span>}</span>}
          </span></button></IslandCell>
        <IslandCell className="library-row-secondary">{item.management?.type ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary">{item.responsibleDepartmentName ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary">{item.management?.version || "—"}</IslandCell>
        <IslandCell className="library-row-date">{recent ? libraryDateLabel(item.publishedAt) : item.management?.expirationDate ? libraryDateLabel(`${item.management.expirationDate}T00:00:00`) : <span className="km-no-expiry">No expiry</span>}</IslandCell>
        <IslandCell><span className={`island-chip knowledge-reader-status library-row-status is-${statusTone[validity.status]}`}>{validityLabel(validity)}</span></IslandCell>
      </IslandRow>;
    })}
  </IslandTable>;
}

export function KnowledgeLibraryBrowse({ items, catalog, catalogError, query, filters, onFilters, discover, onBrowse, onOpen, onManage, allowCollections = true, showReaders = false }: {
  items: PublishedKnowledge[]; catalog: KnowledgeCatalog | null; catalogError: string; query: string; filters: LibraryFilters;
  onFilters: (filters: LibraryFilters) => void; discover: boolean; onBrowse: () => void; onOpen: (id: string) => void; onManage: () => void;
  allowCollections?: boolean;
  showReaders?: boolean;
}) {
  const filtered = filterLibrary(items, catalog, query, filters);
  const owners = [...new Map(items.map(item => [item.responsibleDepartmentId, item.responsibleDepartmentName ?? "Unknown department"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const browseWith = (change: Partial<LibraryFilters>) => { onFilters({ ...emptyLibraryFilters(), ...change }); onBrowse(); };
  const selectedCollection = catalog?.collections.find(item => item.id === filters.collectionId);
  const collections = catalog?.collections.filter(item => item.status === "ACTIVE"
    && (item.id === filters.collectionId || item.documentIds.some(id => items.some(source => source.id === id)))) ?? [];
  const unavailableCollection = Boolean(filters.collectionId && (!catalog || (filters.collectionId !== "unassigned" && selectedCollection?.status !== "ACTIVE")));
  return <div className="km-library">
    {catalogError && <p className="island-note is-warning" role="status">{catalogError}</p>}
    {discover && !query.trim() ? <>
      <section aria-labelledby="km-types"><header className="km-section-heading"><div><h2 id="km-types">Browse by type</h2></div></header><div className="km-types">
        {knowledgeTypes.map(type => <button key={type} type="button" onClick={() => browseWith({ type })}>
          <Icon name={type === "Policy & Standard" ? "shield" : type === "Procedure" ? "layers" : type === "Guide" ? "knowledge" : type === "Reference" ? "document" : "chat"} size={20} />
          <strong>{type}</strong><span>{items.filter(item => item.management?.type === type).length}</span></button>)}
      </div></section>
      <section aria-labelledby="km-collections"><header className="km-section-heading"><div><h2 id="km-collections">Collections</h2></div>
        {catalog?.canManage && <button className="km-text-button" type="button" onClick={onManage}>Manage collections <Icon name="sliders" size={13} /></button>}</header>
        <div className="km-collections">{collections.map(collection => <button className="km-collection" type="button" key={collection.id} onClick={() => browseWith({ collectionId: collection.id })}>
          <img src={knowledgeCovers[collection.cover]} alt="" loading="lazy" /><span className="km-collection-copy"><small>{collection.documentIds.filter(id => items.some(source => source.id === id)).length} documents</small>
            <strong>{collection.name}</strong>{collection.description && <span>{collection.description}</span>}<Icon name="arrow" size={15} /></span></button>)}</div>
        {!collections.length && <p className="km-empty-inline">No collections available.</p>}
      </section>
      <section aria-labelledby="km-new"><header className="km-section-heading"><div><h2 id="km-new">Newly published</h2></div>
        <button className="km-text-button" type="button" onClick={() => browseWith({})}>View all <Icon name="arrow" size={13} /></button></header>
        {items.length ? <DocumentRegister recent items={filterLibrary(items, catalog, "", emptyLibraryFilters()).slice(0, 8)} onOpen={onOpen} />
          : <div className="island island-empty"><h3>No documents available</h3><p>Published documents will appear here.</p></div>}
      </section>
    </> : <>
      <div className="km-register-bar"><div className="km-filters">
        <label><span className="sr-only">Type</span><select value={filters.type} onChange={event => onFilters({ ...filters, type: event.target.value })}><option value="">All types</option>{knowledgeTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label><span className="sr-only">Owner department</span><select value={filters.ownerId} onChange={event => onFilters({ ...filters, ownerId: event.target.value })}><option value="">All departments</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        {allowCollections && <label><span className="sr-only">Collection</span><select value={filters.collectionId} disabled={!catalog}
          onChange={event => onFilters({ ...filters, collectionId: event.target.value })}>
          <option value="">All collections</option><option value="unassigned">Unassigned</option>
          {unavailableCollection && filters.collectionId !== "unassigned" && <option value={filters.collectionId} disabled>Unavailable collection</option>}
          {collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {Object.values(filters).some(Boolean) && <button type="button" className="km-text-button" onClick={() => onFilters(emptyLibraryFilters())}>Clear filters</button>}
      </div>{!unavailableCollection && <span className="island-meta" role="status">{filtered.length} documents · newest first</span>}</div>
      {unavailableCollection ? <p role="status" className="island-note is-warning">Collection unavailable. Clear filters to browse documents.</p>
        : filtered.length ? <DocumentRegister items={filtered} onOpen={onOpen} showReaders={showReaders} /> : <div className="island island-empty"><h3>{items.length ? "No results" : "No documents available"}</h3><p>{items.length ? "Try another search or filter." : "Published documents will appear here."}</p></div>}
    </>}
  </div>;
}
