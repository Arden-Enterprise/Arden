import { useRef, useState } from "react";
import { knowledgeTypes, validityStatus } from "@arden/domain";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import { IslandPagination, pageCountFor, type PageSize } from "../shared/IslandPagination";
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

/** Validity words for My Contributions, Administration and the reader: Current, Expires in N days, Expired. */
export function validityLabel({ status, daysLeft }: ReturnType<typeof validityStatus>): string {
  if (status === "Expiring soon") return daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  return status;
}

export const todayIso = () => new Date().toLocaleDateString("en-CA");

/** Decision 0032: readers see only a small amber clock for a document expiring in 30 days or less. */
export function expiringLabel(item: Pick<PublishedKnowledge, "management">, today = todayIso()): string | null {
  const validity = validityStatus(item.management, today);
  if (validity.status !== "Expiring soon" || !item.management?.expirationDate) return null;
  return `${validityLabel(validity)} · ${libraryDateLabel(`${item.management.expirationDate}T00:00:00`)}`;
}

function ClockIcon() {
  return <svg className="arden-icon" width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

export type RegisterSortKey = "title" | "type" | "owner" | "author" | "updated";
export type RegisterSort = { key: RegisterSortKey; direction: "ascending" | "descending" };
export const defaultRegisterSort: RegisterSort = { key: "updated", direction: "descending" };
const sortColumns: Array<{ key: RegisterSortKey; label: string }> = [
  { key: "title", label: "DOCUMENT" }, { key: "type", label: "TYPE" }, { key: "owner", label: "OWNER" },
  { key: "author", label: "AUTHOR" }, { key: "updated", label: "UPDATED" }];

export function sortRegister(items: PublishedKnowledge[], sort: RegisterSort): PublishedKnowledge[] {
  const text = (item: PublishedKnowledge) => ({ title: item.title, type: item.management?.type ?? "",
    owner: item.responsibleDepartmentName ?? "", author: item.authorName ?? "", updated: "" })[sort.key];
  const sign = sort.direction === "ascending" ? 1 : -1;
  return [...items].sort((a, b) => {
    const order = sort.key === "updated" ? Date.parse(a.publishedAt) - Date.parse(b.publishedAt)
      // Missing values ("—") stay last in either direction.
      : !text(a) !== !text(b) ? (text(a) ? -1 : 1) * sign : text(a).localeCompare(text(b), undefined, { sensitivity: "base" });
    return order * sign || a.id.localeCompare(b.id);
  });
}

/** Larger registers are paged; the short Newly published list never is. */
const pagedFrom = 10;

function DocumentRegister({ items, onOpen, onViewInGraph, recent = false, showReaders = false, resetKey = "" }: {
  items: PublishedKnowledge[];
  onOpen: (id: string) => void;
  onViewInGraph?: (documentId: string) => void;
  recent?: boolean;
  showReaders?: boolean;
  /** Search and filters behind `items` determine when the register returns to page 1. */
  resetKey?: string;
}) {
  const [sort, setSort] = useState<RegisterSort>(defaultRegisterSort);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [position, setPosition] = useState({ resetKey, page: 1 });
  const sorted = sortRegister(items, sort);
  const paged = !recent && items.length > pagedFrom;
  // A background refresh can shrink the list, so the remembered page is clamped rather than trusted.
  const page = paged && position.resetKey === resetKey ? Math.min(position.page, pageCountFor(items.length, pageSize)) : 1;
  const visible = paged ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted;
  const today = todayIso();
  const tableRef = useRef<HTMLDivElement>(null);
  const showPage = (next: number) => {
    setPosition({ resetKey, page: next });
    // Paging from the footer would otherwise leave the reader below the new rows.
    const table = tableRef.current;
    if (table && table.getBoundingClientRect().top < 0) table.scrollIntoView({ block: "start" });
  };
  const toggle = (key: RegisterSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: key === "updated" ? "descending" : "ascending" });
    setPosition({ resetKey, page: 1 });
  };
  return <div ref={tableRef} className="library-register-frame"><IslandTable label={recent ? "Newly published documents" : "All documents"} minWidth={760} className="library-register"
    columns="minmax(260px, 2.6fr) minmax(110px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) 120px"
    sort={{ index: sortColumns.findIndex((column) => column.key === sort.key), direction: sort.direction }}
    headers={sortColumns.map((column) => <button type="button" className="library-sort" onClick={() => toggle(column.key)}
      aria-label={`Sort by ${column.label.toLowerCase()}`}>{column.label}{sort.key === column.key
        && <Icon name={sort.direction === "ascending" ? "arrow-up" : "arrow-down"} size={11} />}</button>)}>
    {visible.map(item => {
      const expiring = expiringLabel(item, today);
      const release = item.management?.releaseKind;
      const releaseTag = recent && release ? release === "UPDATED" ? "Updated" : "New" : null;
      const openButton = <button className="island-row-name library-row-name" type="button" data-publication-id={item.id} aria-label={`Read ${item.title}`}
        title={item.title} onClick={() => onOpen(item.id)}>
        <span className="library-row-icon"><Icon name="document" size={17} /></span><span className="library-row-copy">
          <span className="library-row-heading"><strong className="library-row-title">{item.title}</strong>
            {expiring && <span className="library-row-expiring" role="img" aria-label={expiring} title={expiring}><ClockIcon /></span>}</span>
          {/* The meta line exists only when it says something; an empty line would add height to every row. */}
          {(showReaders || releaseTag) && <span className="library-row-meta">{showReaders && (item.targetReaders?.mode === "DEPARTMENT" ? "Department readers" : "Selected readers")}
            {releaseTag && <span className="km-release">{releaseTag}</span>}</span>}
        </span></button>;
      return <IslandRow key={item.id} className="library-row">
        <IslandCell className="island-row-cell is-name">
          {onViewInGraph ? (
            <div className="library-row-name-wrap">
              {openButton}
              <button
                type="button"
                className="island-icon-button library-row-graph-btn"
                aria-label={`View ${item.title} in Graph`}
                title="View in Graph"
                onClick={() => onViewInGraph(item.draftId)}
              >
                <Icon name="graph" size={14} />
              </button>
            </div>
          ) : openButton}
        </IslandCell>
        <IslandCell className="library-row-secondary">{item.management?.type ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary">{item.responsibleDepartmentName ?? "—"}</IslandCell>
        <IslandCell className="library-row-secondary library-row-author">{item.authorName || "—"}</IslandCell>
        <IslandCell className="library-row-date">{libraryDateLabel(item.publishedAt)}</IslandCell>
      </IslandRow>;
    })}
  </IslandTable>
  {paged && <IslandPagination label="All documents" noun="documents" page={page} pageSize={pageSize} total={items.length}
    onPage={showPage} onPageSize={(size) => { setPageSize(size); setPosition({ resetKey, page: 1 }); }} />}
  </div>;
}

export function KnowledgeLibraryBrowse({ items, catalog, catalogError, query, filters, onFilters, discover, onBrowse, onOpen, onManage, onViewInGraph, allowCollections = true, showReaders = false }: {
  items: PublishedKnowledge[]; catalog: KnowledgeCatalog | null; catalogError: string; query: string; filters: LibraryFilters;
  onFilters: (filters: LibraryFilters) => void; discover: boolean; onBrowse: () => void; onOpen: (id: string) => void; onManage: () => void;
  onViewInGraph?: (documentId: string) => void;
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
        {items.length ? <DocumentRegister recent items={filterLibrary(items, catalog, "", emptyLibraryFilters()).slice(0, 8)} onOpen={onOpen} onViewInGraph={onViewInGraph} />
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
      </div>{!unavailableCollection && <span className="island-meta" role="status">{filtered.length} documents</span>}</div>
      {unavailableCollection ? <p role="status" className="island-note is-warning">Collection unavailable. Clear filters to browse documents.</p>
        : filtered.length ? <DocumentRegister items={filtered} onOpen={onOpen} onViewInGraph={onViewInGraph} showReaders={showReaders}
          resetKey={JSON.stringify([query.trim(), filters])} /> : <div className="island island-empty"><h3>{items.length ? "No results" : "No documents available"}</h3><p>{items.length ? "Try another search or filter." : "Published documents will appear here."}</p></div>}
    </>}
  </div>;
}
