import { KnowledgeLibraryBrowse, emptyLibraryFilters, type LibraryFilters } from "./KnowledgeLibraryBrowse";
import type { KnowledgeCatalog } from "../shared/api-client";
import type { HomeSource, HomeSourceState } from "./useHomePublications";

export function KnowledgeHomeBrowse({ source, state, catalog, catalogError, query, filters, onFilters, organizationView,
  onOrganizationView, onOpen, onManage, onRetry }: {
  source: HomeSource; state: HomeSourceState; catalog: KnowledgeCatalog | null; catalogError: string;
  query: string; filters: LibraryFilters; onFilters: (filters: LibraryFilters) => void;
  organizationView: "overview" | "all"; onOrganizationView: (view: "overview" | "all") => void;
  onOpen: (id: string) => void; onManage: () => void; onRetry: () => void;
}) {
  const organization = source === "organization";
  const register = organizationView === "all" || Boolean(query.trim() || filters.type || filters.ownerId || filters.collectionId);
  return <section className="km-home-source" role="tabpanel" aria-labelledby={`home-tab-${source}`}>
    {organization && <header className="km-section-heading km-source-views">
      <div className="island-seg" role="group" aria-label="Organization views">
        <button type="button" aria-pressed={!register} onClick={() => { onFilters(emptyLibraryFilters()); onOrganizationView("overview"); }}>Overview</button>
        <button type="button" aria-pressed={register && !filters.collectionId} onClick={() => { onFilters({ ...filters, collectionId: "" }); onOrganizationView("all"); }}>All documents</button>
        <button type="button" aria-pressed={register && filters.collectionId === "unassigned"} onClick={() => { onFilters({ ...filters, collectionId: "unassigned" }); onOrganizationView("all"); }}>Unassigned</button>
      </div></header>}
    {state.status === "error" ? <div className="island island-empty" role="alert"><h3>Documents unavailable</h3><p>Couldn’t load this view.</p>
      <button type="button" className="secondary-button" onClick={onRetry}>Try again</button></div>
      : state.status === "loading" ? <div className="island island-empty" role="status">Loading documents…</div>
      : <KnowledgeLibraryBrowse items={state.items} catalog={organization ? catalog : null} catalogError={organization ? catalogError : ""}
        allowCollections={organization} showReaders={source === "shared"} query={query} filters={filters} onFilters={onFilters}
        discover={organization && !register} onBrowse={() => onOrganizationView("all")} onOpen={onOpen} onManage={onManage} />}
  </section>;
}
