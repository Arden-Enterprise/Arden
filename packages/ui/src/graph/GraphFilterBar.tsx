import type { RefObject } from "react";
import {
  documentRelationshipTypes,
  type DocumentRelationshipType,
  type GraphReaderScope,
  type GraphTypeCode,
  type GraphValidityFilter,
  type KnowledgeGraphPayload,
} from "@arden/domain";
import { Icon } from "../shared/Icon";
import { hasActiveFacetFilters, type GraphFilterState } from "./query-state";

export type GraphDisplayMode = "canvas" | "outline";

export interface GraphFilterBarProps {
  state: GraphFilterState;
  displayMode: GraphDisplayMode;
  departments: ReadonlyArray<{ id: string; name: string }>;
  collections: ReadonlyArray<{ id: string; name: string }>;
  capabilities: KnowledgeGraphPayload["capabilities"];
  matchedCount: number;
  totalCount: number;
  partialCounts: boolean;
  onChange: (patch: Partial<GraphFilterState>) => void;
  onDisplayModeChange: (mode: GraphDisplayMode) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  busy?: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

const TYPE_OPTIONS: ReadonlyArray<{ code: GraphTypeCode; label: string }> = [
  { code: "POLICY_AND_STANDARD", label: "Policy & Standard" },
  { code: "PROCEDURE", label: "Procedure" },
  { code: "GUIDE", label: "Guide" },
  { code: "REFERENCE", label: "Reference" },
  { code: "LESSONS_LEARNED", label: "Lessons Learned" },
  { code: "UNCATEGORIZED", label: "Uncategorized (legacy)" },
];

const SCOPE_OPTIONS: ReadonlyArray<{ value: GraphReaderScope; label: string }> = [
  { value: "ORGANIZATION", label: "Whole organization" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "SELECTED_MEMBERS", label: "Selected members" },
  { value: "LEGACY_AUDIENCE", label: "Legacy audience" },
];

const RELATIONSHIP_LABELS: Record<DocumentRelationshipType, string> = {
  REFERENCES: "References",
  RELATED: "Related",
  SUPERSEDES: "Supersedes",
};

/**
 * Filter, view-mode, cross-link, and Monitor Mode seam controls for `/graph`.
 * Filter chip toggles use 0ms transition (SPEC-knowledge-graph.md §6.2).
 */
export function GraphFilterBar({
  state,
  displayMode,
  departments,
  collections,
  capabilities,
  matchedCount,
  totalCount,
  partialCounts,
  onChange,
  onDisplayModeChange,
  onClearFilters,
  onRefresh,
  busy = false,
  searchInputRef,
}: GraphFilterBarProps) {
  const hasFilters = hasActiveFacetFilters(state) || state.isolateMatching;

  const toggleRelationshipType = (relType: DocumentRelationshipType) => {
    const exists = state.relationshipTypes.includes(relType);
    const next = exists
      ? state.relationshipTypes.filter((item) => item !== relType)
      : [...state.relationshipTypes, relType];
    onChange({ relationshipTypes: next });
  };

  return (
    <section className="graph-filter-bar" aria-label="Graph filters and display options">
      <div className="graph-filter-row">
        <div className="island-seg graph-seg" role="group" aria-label="Graph hierarchy view">
          <button
            type="button"
            className="graph-instant-toggle"
            aria-pressed={state.view === "accountability"}
            onClick={() => onChange({ view: "accountability" })}
          >
            Accountability
          </button>
          <button
            type="button"
            className="graph-instant-toggle"
            aria-pressed={state.view === "collections"}
            onClick={() => onChange({ view: "collections" })}
          >
            Collections
          </button>
        </div>

        <label className="graph-search-field">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Filter graph"
            placeholder="Filter documents…"
            maxLength={120}
            value={state.q}
            onChange={(event) => onChange({ q: event.target.value.slice(0, 120) })}
          />
        </label>

        <div className="graph-filter-spacer" />

        <div className="island-seg graph-seg" role="group" aria-label="Graph display mode">
          <button
            type="button"
            className="graph-instant-toggle"
            aria-pressed={displayMode === "canvas"}
            onClick={() => onDisplayModeChange("canvas")}
          >
            Canvas
          </button>
          <button
            type="button"
            className="graph-instant-toggle"
            aria-pressed={displayMode === "outline"}
            onClick={() => onDisplayModeChange("outline")}
          >
            Outline
          </button>
        </div>

        <button
          type="button"
          className="island-icon-button graph-refresh-btn"
          aria-label="Refresh graph"
          title="Refresh graph"
          disabled={busy}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      <div className="graph-filter-row graph-facets-row">
        <select
          className="graph-select"
          aria-label="Owner department"
          value={state.ownerDepartmentId}
          onChange={(event) => onChange({ ownerDepartmentId: event.target.value })}
        >
          <option value="">All departments</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </select>

        <select
          className="graph-select"
          aria-label="Document type"
          value={state.typeCode}
          onChange={(event) => onChange({ typeCode: event.target.value as GraphTypeCode | "" })}
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>

        <select
          className="graph-select"
          aria-label="Collection"
          value={state.collectionId}
          onChange={(event) => onChange({ collectionId: event.target.value })}
        >
          <option value="">All collections</option>
          <option value="UNASSIGNED">Unassigned</option>
          {collections.map((col) => (
            <option key={col.id} value={col.id}>{col.name}</option>
          ))}
        </select>

        <select
          className="graph-select"
          aria-label="Reader scope"
          value={state.readerScope}
          onChange={(event) => onChange({ readerScope: event.target.value as GraphReaderScope | "" })}
        >
          <option value="">All scopes</option>
          {SCOPE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>

        <select
          className="graph-select"
          aria-label="Validity"
          value={state.validity}
          onChange={(event) => {
            const validity = event.target.value as GraphValidityFilter | "";
            onChange({
              validity,
              ...(validity === "EXPIRED" ? { includeExpired: true } : {}),
            });
          }}
        >
          <option value="">All validity</option>
          <option value="CURRENT">Current</option>
          <option value="EXPIRING_SOON">Expiring soon</option>
          {state.monitor && capabilities.canIncludeExpired && (
            <option value="EXPIRED">Expired</option>
          )}
        </select>

        <button
          type="button"
          className={`graph-chip-toggle graph-instant-toggle${state.isolateMatching ? " is-active" : ""}`}
          aria-pressed={state.isolateMatching}
          onClick={() => onChange({ isolateMatching: !state.isolateMatching })}
        >
          <Icon name="filter" size={13} />
          Isolate matching
        </button>

        <button
          type="button"
          className={`graph-chip-toggle graph-instant-toggle${state.includeLinks ? " is-active" : ""}`}
          aria-pressed={state.includeLinks}
          onClick={() => onChange({ includeLinks: !state.includeLinks })}
        >
          <Icon name="branch" size={13} />
          Cross-links
        </button>

        {state.includeLinks && (
          <div className="graph-rel-types" role="group" aria-label="Relationship types">
            {documentRelationshipTypes.map((relType) => (
              <label key={relType} className="graph-rel-checkbox">
                <input
                  type="checkbox"
                  checked={state.relationshipTypes.includes(relType)}
                  onChange={() => toggleRelationshipType(relType)}
                />
                <span>{RELATIONSHIP_LABELS[relType]}</span>
              </label>
            ))}
          </div>
        )}

        {capabilities.canUseMonitorMode && (
          <div className="graph-monitor-seam" role="group" aria-label="Governance Monitor Mode">
            <button
              type="button"
              className={`graph-chip-toggle graph-instant-toggle${state.monitor ? " is-active" : ""}`}
              aria-pressed={state.monitor}
              onClick={() => onChange({
                monitor: !state.monitor,
                ...(!state.monitor ? {} : {
                  onlyOpenCases: false,
                  onlyUnassignedOrg: false,
                  includeExpired: false,
                  ...(state.validity === "EXPIRED" ? { validity: "" } : {}),
                }),
              })}
            >
              <Icon name="shield" size={13} />
              Monitor
            </button>

            {state.monitor && (
              <>
                <button
                  type="button"
                  className={`graph-chip-toggle graph-instant-toggle${state.validity === "EXPIRING_SOON" ? " is-active" : ""}`}
                  aria-pressed={state.validity === "EXPIRING_SOON"}
                  onClick={() => onChange({ validity: state.validity === "EXPIRING_SOON" ? "" : "EXPIRING_SOON" })}
                >
                  Expiring ≤ 30d
                </button>
                <button
                  type="button"
                  className={`graph-chip-toggle graph-instant-toggle${state.onlyOpenCases ? " is-active" : ""}`}
                  aria-pressed={state.onlyOpenCases}
                  onClick={() => onChange({ onlyOpenCases: !state.onlyOpenCases })}
                >
                  Open cases
                </button>
                <button
                  type="button"
                  className={`graph-chip-toggle graph-instant-toggle${state.onlyUnassignedOrg ? " is-active" : ""}`}
                  aria-pressed={state.onlyUnassignedOrg}
                  onClick={() => onChange({ onlyUnassignedOrg: !state.onlyUnassignedOrg })}
                >
                  Unassigned Org Doc
                </button>
                {capabilities.canIncludeExpired && (
                  <button
                    type="button"
                    className={`graph-chip-toggle graph-instant-toggle${state.includeExpired ? " is-active" : ""}`}
                    aria-pressed={state.includeExpired}
                    onClick={() => onChange({
                      includeExpired: !state.includeExpired,
                      ...(state.includeExpired && state.validity === "EXPIRED" ? { validity: "" } : {}),
                    })}
                  >
                    Include Expired
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {hasFilters && (
          <button type="button" className="km-text-button graph-clear-btn" onClick={onClearFilters}>
            Clear filters
          </button>
        )}

        <span className="graph-count-summary" role="status" aria-live="polite">
          {matchedCount === totalCount
            ? `${totalCount} ${totalCount === 1 ? "document" : "documents"}`
            : `${matchedCount} of ${totalCount} matching`}
          {partialCounts ? " · Partial branch counts while filtered" : ""}
        </span>
      </div>
    </section>
  );
}
