import { applicabilityStatus, knowledgeTypes } from "@arden/domain";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import type { KnowledgeCatalog, PublishedKnowledge } from "../shared/api-client";
import { libraryDateLabel } from "./libraryDisplay";
import { knowledgeCovers } from "./KnowledgeCatalogEditor";

export type LibraryFilters = { type: string; topicId: string; ownerId: string; collectionId: string };
export const emptyLibraryFilters = (): LibraryFilters => ({ type: "", topicId: "", ownerId: "", collectionId: "" });
export function filterLibrary(items: PublishedKnowledge[], catalog: KnowledgeCatalog | null, query: string, filters: LibraryFilters) {
  const terms = query.trim().toLocaleLowerCase();
  const collection = filters.collectionId ? catalog?.collections.find(item => item.id === filters.collectionId) : null;
  return items.filter(item => (!filters.type || item.management?.type === filters.type)
    && (!filters.topicId || item.management?.topicId === filters.topicId)
    && (!filters.ownerId || item.responsibleDepartmentId === filters.ownerId)
    && (!filters.collectionId || collection?.documentIds.includes(item.id))
    && (!terms || [item.title, item.management?.type, item.management?.topicName,
      item.responsibleDepartmentName].some(value => value?.toLocaleLowerCase().includes(terms))))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
}

function DocumentRegister({ items, onOpen, recent = false }: { items: PublishedKnowledge[]; onOpen: (id: string) => void; recent?: boolean }) {
  return <IslandTable label={recent ? "Newly published documents" : "All documents"} minWidth={900}
    columns="minmax(270px, 2.8fr) minmax(120px, 1fr) minmax(130px, 1fr) 70px 115px 100px"
    headers={["DOCUMENT", "TYPE", "OWNER", "VERSION", recent ? "PUBLISHED" : "EFFECTIVE DATE", "STATUS"]}>
    {items.map(item => {
      const applicability = applicabilityStatus(item.management, new Date().toLocaleDateString("en-CA"));
      const release = item.management?.releaseKind;
      return <IslandRow key={item.id} className="library-row">
        <IslandCell className="island-row-cell is-name"><button className="island-row-name library-row-name" type="button" aria-label={`Read ${item.title}`} onClick={() => onOpen(item.id)}>
          <span className="library-row-icon"><Icon name="document" size={17} /></span><span className="library-row-copy">
            <strong className="library-row-title">{item.title}</strong>
            <span className="library-row-meta">{item.management?.topicName}{recent && release && <span className="km-release">{release === "UPDATED" ? "Updated" : "New"}</span>}</span>
          </span></button></IslandCell>
        <IslandCell className="library-row-secondary">{item.management?.type ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary">{item.responsibleDepartmentName ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary">{item.management?.version || "—"}</IslandCell>
        <IslandCell className="library-row-date">{recent ? libraryDateLabel(item.publishedAt) : item.management?.effectiveDate ? libraryDateLabel(`${item.management.effectiveDate}T00:00:00`) : "—"}</IslandCell>
        <IslandCell><span className={`km-applicability is-${applicability?.toLowerCase() ?? "published"}`}>{applicability ?? "Published"}</span></IslandCell>
      </IslandRow>;
    })}
  </IslandTable>;
}

export function KnowledgeLibraryBrowse({ items, catalog, catalogError, query, filters, onFilters, discover, onBrowse, onOpen, onManage }: {
  items: PublishedKnowledge[]; catalog: KnowledgeCatalog | null; catalogError: string; query: string; filters: LibraryFilters;
  onFilters: (filters: LibraryFilters) => void; discover: boolean; onBrowse: () => void; onOpen: (id: string) => void; onManage: () => void;
}) {
  const filtered = filterLibrary(items, catalog, query, filters);
  const owners = [...new Map(items.map(item => [item.responsibleDepartmentId, item.responsibleDepartmentName ?? "Unknown department"])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const browseWith = (change: Partial<LibraryFilters>) => { onFilters({ ...emptyLibraryFilters(), ...change }); onBrowse(); };
  const selectedCollection = catalog?.collections.find(item => item.id === filters.collectionId);
  const collections = catalog?.collections.filter(item => item.status === "ACTIVE" && item.documentIds.some(id => items.some(source => source.id === id))) ?? [];
  return <div className="km-library">
    {catalogError && <p className="island-note is-warning" role="status">{catalogError}</p>}
    {discover && !query.trim() ? <>
      <section aria-labelledby="km-types"><h2 id="km-types" className="km-section-label">Browse by type</h2><div className="km-types">
        {knowledgeTypes.map(type => <button key={type} type="button" onClick={() => browseWith({ type })}>
          <Icon name={type === "Policy & Standard" ? "shield" : type === "Procedure" ? "layers" : type === "Guide" ? "knowledge" : type === "Reference" ? "document" : "chat"} size={20} />
          <strong>{type}</strong><span>{items.filter(item => item.management?.type === type).length}</span></button>)}
      </div></section>
      <section aria-labelledby="km-topics"><header className="km-section-heading"><h2 id="km-topics">Topics</h2>
        {catalog?.canManage && <button className="km-text-button" type="button" onClick={onManage}>Manage catalog <Icon name="sliders" size={13} /></button>}</header>
        <div className="km-topics">{catalog?.topics.filter(topic => topic.status === "ACTIVE").map(topic => <button key={topic.id} type="button" onClick={() => browseWith({ topicId: topic.id })}>
          <span>{topic.name}</span><small>{items.filter(item => item.management?.topicId === topic.id).length}</small><Icon name="chevron" size={12} /></button>)}</div>
        {!catalog?.topics.some(topic => topic.status === "ACTIVE") && <p className="km-empty-inline">No topics yet.{catalog?.canManage ? " Add one in Manage catalog." : ""}</p>}
      </section>
      <section aria-labelledby="km-collections"><header className="km-section-heading"><div><h2 id="km-collections">Collections</h2><p>Curated documents, brought together.</p></div></header>
        <div className="km-collections">{collections.map(collection => <button className="km-collection" type="button" key={collection.id} onClick={() => browseWith({ collectionId: collection.id })}>
          <img src={knowledgeCovers[collection.cover]} alt="" loading="lazy" /><span className="km-collection-copy"><small>{collection.documentIds.filter(id => items.some(source => source.id === id)).length} documents</small>
            <strong>{collection.name}</strong>{collection.description && <span>{collection.description}</span>}<Icon name="arrow" size={15} /></span></button>)}</div>
        {!collections.length && <p className="km-empty-inline">No collections available.</p>}
      </section>
      <section aria-labelledby="km-new"><header className="km-section-heading"><div><h2 id="km-new">Newly published</h2><p>New and updated knowledge you can read.</p></div>
        <button className="km-text-button" type="button" onClick={() => browseWith({})}>View all <Icon name="arrow" size={13} /></button></header>
        {items.length ? <DocumentRegister recent items={filterLibrary(items, catalog, "", emptyLibraryFilters()).slice(0, 8)} onOpen={onOpen} />
          : <div className="island island-empty"><h3>No documents available</h3><p>Published documents will appear here.</p></div>}
      </section>
    </> : <>
      <div className="km-register-bar"><div className="km-filters">
        <label><span className="sr-only">Type</span><select value={filters.type} onChange={event => onFilters({ ...filters, type: event.target.value })}><option value="">All types</option>{knowledgeTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label><span className="sr-only">Topic</span><select value={filters.topicId} onChange={event => onFilters({ ...filters, topicId: event.target.value })}><option value="">All topics</option>{catalog?.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
        <label><span className="sr-only">Owner department</span><select value={filters.ownerId} onChange={event => onFilters({ ...filters, ownerId: event.target.value })}><option value="">All departments</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        {selectedCollection && <button type="button" className="km-filter-chip" onClick={() => onFilters({ ...filters, collectionId: "" })}>{selectedCollection.name}<Icon name="close" size={11} /></button>}
        {Object.values(filters).some(Boolean) && <button type="button" className="km-text-button" onClick={() => onFilters(emptyLibraryFilters())}>Clear filters</button>}
      </div><span className="island-meta" role="status">{filtered.length} documents · newest first</span></div>
      {filtered.length ? <DocumentRegister items={filtered} onOpen={onOpen} /> : <div className="island island-empty"><h3>{items.length ? "No results" : "No documents available"}</h3><p>{items.length ? "Try another search or filter." : "Published documents will appear here."}</p></div>}
    </>}
  </div>;
}
