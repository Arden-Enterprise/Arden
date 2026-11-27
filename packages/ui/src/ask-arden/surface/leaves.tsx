import { useId, type ReactNode } from "react";
import type {
  BoundCalloutNode,
  BoundComparisonTableNode,
  BoundDocumentItemNode,
  BoundGovernanceKvNode,
  BoundLineageTreeNode,
  BoundMetricStripNode,
  BoundProseNode,
  GovernanceFieldKey,
  HydratedDocumentSummary,
} from "@arden/domain";
import { Icon } from "../../shared/Icon";
import { CitedAnswer } from "../CitedAnswer";
import type { AnswerCitation } from "../askArdenModel";
import {
  defaultGovernanceFields,
  formatCalloutMeta,
  formatGovernanceFieldLabel,
  formatReaderScope,
  formatRelationshipType,
  formatSurfaceDate,
  formatValidityBadge,
  safeGetOwn,
} from "./formatters";
import type { SurfaceRenderContext } from "./types";

function CitationChips({
  citationIndexes,
  citations,
  onOpenCitation,
}: {
  citationIndexes?: readonly number[];
  citations: readonly AnswerCitation[];
  onOpenCitation?: (citation: AnswerCitation, opener: HTMLElement) => void;
}) {
  if (!citationIndexes || citationIndexes.length === 0) return null;
  const resolved = citationIndexes
    .map((index) => ({ index, citation: citations[index - 1] }))
    .filter((entry): entry is { index: number; citation: AnswerCitation } => Boolean(entry.citation));

  if (resolved.length === 0) return null;

  return (
    <span className="arden-surface-citations">
      {resolved.map(({ index, citation }) => (
        <button
          key={index}
          type="button"
          className="ask-citation-chip"
          title={citation.title}
          aria-label={`Source ${index}: ${citation.title}`}
          onClick={(event) => onOpenCitation?.(citation, event.currentTarget)}
        >
          {index}
        </button>
      ))}
    </span>
  );
}

function ValidityBadge({
  doc,
}: {
  doc: Pick<HydratedDocumentSummary, "validityStatus" | "daysUntilExpiry">;
}) {
  const badge = formatValidityBadge(doc.validityStatus, doc.daysUntilExpiry);
  return (
    <span
      className={`arden-surface-badge tone-${badge.tone}`}
      title={badge.detail ? `${badge.label} (${badge.detail})` : badge.label}
    >
      <Icon name={badge.icon} size={12} />
      <span>{badge.label}</span>
    </span>
  );
}

export function ProseBlock({
  node,
  ctx,
}: {
  node: BoundProseNode;
  ctx: SurfaceRenderContext;
}) {
  return (
    <div className="arden-surface-prose">
      <CitedAnswer
        body={node.markdown}
        citations={ctx.citations}
        onOpen={ctx.onOpenCitation}
      />
    </div>
  );
}

export function DocumentItemBlock({
  node,
  ctx,
}: {
  node: BoundDocumentItemNode;
  ctx: SurfaceRenderContext;
}) {
  const doc = safeGetOwn(ctx.hydratedDocuments, node.publishedVersionId);
  if (!doc) {
    return (
      <div className="arden-surface-doc is-unavailable" role="status">
        <Icon name="document" size={15} />
        <span>Document details unavailable.</span>
      </div>
    );
  }

  return (
    <div className="arden-surface-doc">
      <div className="arden-surface-doc-facts">
        <div className="arden-surface-doc-head">
          <span className="arden-surface-doc-icon">
            <Icon name="document" size={15} />
          </span>
          <strong className="arden-surface-doc-title">{doc.title}</strong>
          <ValidityBadge doc={doc} />
        </div>
        <div className="arden-surface-doc-meta">
          <span className="arden-surface-meta-pill">{doc.ownerDepartmentName}</span>
          <span className="arden-surface-meta-pill">{doc.type ?? "Uncategorized"}</span>
          <span className="arden-surface-meta-pill is-numeric" aria-label={`Version ${doc.version}`}>
            {doc.version}
          </span>
          <span className="arden-surface-meta-pill">{formatReaderScope(doc.readerScope)}</span>
        </div>
      </div>
      {node.highlightNote && (
        <aside
          className="arden-surface-ai-note"
          aria-label="AI note"
          data-ai-quarantine="true"
        >
          <span className="arden-surface-ai-note-label">Note</span>
          <p className="arden-surface-ai-note-text">{node.highlightNote}</p>
        </aside>
      )}
    </div>
  );
}

function renderGovernanceFieldValue(
  field: GovernanceFieldKey,
  doc: HydratedDocumentSummary,
): ReactNode | null {
  switch (field) {
    case "ownerDepartment":
      return doc.ownerDepartmentName;
    case "authorDisplayName":
      return doc.authorDisplayName ?? "—";
    case "type":
      return doc.type ?? "Uncategorized";
    case "version":
      return doc.version;
    case "publishedAt":
      return formatSurfaceDate(doc.publishedAt);
    case "validUntil":
      return formatSurfaceDate(doc.validUntil);
    case "validityStatus":
      return <ValidityBadge doc={doc} />;
    case "readerScope":
      return formatReaderScope(doc.readerScope);
    case "collectionName":
      return doc.collectionName ?? "Unassigned";
    case "openMaintenanceCaseCount":
      if (doc.openMaintenanceCaseCount === null) return null;
      return String(doc.openMaintenanceCaseCount);
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export function GovernanceKvBlock({
  node,
  ctx,
}: {
  node: BoundGovernanceKvNode;
  ctx: SurfaceRenderContext;
}) {
  const doc = safeGetOwn(ctx.hydratedDocuments, node.publishedVersionId);
  if (!doc) {
    return (
      <div className="arden-surface-kv-unavailable" role="status">
        Governance details unavailable.
      </div>
    );
  }

  const fields = node.fields && node.fields.length > 0 ? node.fields : defaultGovernanceFields;
  const rows: Array<{ key: GovernanceFieldKey; label: string; value: ReactNode }> = [];
  for (const field of fields) {
    const value = renderGovernanceFieldValue(field, doc);
    if (value === null) continue;
    rows.push({ key: field, label: formatGovernanceFieldLabel(field), value });
  }

  if (rows.length === 0) return null;

  return (
    <dl className="arden-surface-kv">
      {rows.map((row) => (
        <div key={row.key} className="arden-surface-kv-row" data-field={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ComparisonTableBlock({
  node,
  ctx,
}: {
  node: BoundComparisonTableNode;
  ctx: SurfaceRenderContext;
}) {
  const captionId = useId();

  return (
    <div
      className="arden-surface-table-frame"
      tabIndex={0}
      role="region"
      aria-labelledby={node.caption ? captionId : undefined}
      aria-label={node.caption ? undefined : "Comparison table"}
    >
      <table className="arden-surface-table">
        {node.caption && <caption id={captionId}>{node.caption}</caption>}
        <thead>
          <tr>
            {node.columns.map((column, colIdx) => (
              <th key={colIdx} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.cells.map((cell, cellIdx) => (
                <td key={cellIdx}>
                  <span className="arden-surface-cell-text">{cell.text}</span>
                  <CitationChips
                    citationIndexes={cell.citationIndexes}
                    citations={ctx.citations}
                    onOpenCitation={ctx.onOpenCitation}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CalloutBlock({
  node,
  ctx,
}: {
  node: BoundCalloutNode;
  ctx: SurfaceRenderContext;
}) {
  const meta = formatCalloutMeta(node.tone);

  return (
    <aside
      className="arden-surface-callout"
      data-tone={node.tone}
      aria-label={`${meta.badge}: ${node.title}`}
    >
      <div className="arden-surface-callout-head">
        <span className="arden-surface-callout-badge">
          <Icon name={meta.icon} size={13} />
          <span>{meta.badge}</span>
        </span>
        <strong className="arden-surface-callout-title">{node.title}</strong>
      </div>
      <p className="arden-surface-callout-body">
        <span>{node.body}</span>
        <CitationChips
          citationIndexes={node.citationIndexes}
          citations={ctx.citations}
          onOpenCitation={ctx.onOpenCitation}
        />
      </p>
    </aside>
  );
}

export function MetricStripBlock({
  nodeId,
  node,
  ctx,
}: {
  nodeId: string;
  node: BoundMetricStripNode;
  ctx: SurfaceRenderContext;
}) {
  const rawTiles = safeGetOwn(ctx.turnHydration?.metrics, nodeId);
  if (!Array.isArray(rawTiles) || rawTiles.length === 0) return null;

  const allowedKeys = new Set(node.metricKeys);
  const tiles = rawTiles.filter((tile) => allowedKeys.has(tile.key));
  if (tiles.length === 0) return null;

  return (
    <div className="arden-surface-metrics" role="list" aria-label="Document summary metrics">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          role="listitem"
          className="arden-surface-metric-tile"
          data-tone={tile.tone}
          data-metric-key={tile.key}
        >
          <span className="arden-surface-metric-value">{tile.value}</span>
          <span className="arden-surface-metric-label">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

export function LineageTreeBlock({
  nodeId,
  node,
  ctx,
}: {
  nodeId: string;
  node: BoundLineageTreeNode;
  ctx: SurfaceRenderContext;
}) {
  const preview = safeGetOwn(ctx.turnHydration?.lineages, nodeId);
  const rootDoc = safeGetOwn(ctx.hydratedDocuments, node.rootPublishedVersionId);
  const edges = preview?.edges ?? [];

  return (
    <div className="arden-surface-lineage">
      <div className="arden-surface-lineage-root">
        <Icon name="branch" size={14} />
        <strong>{rootDoc?.title ?? "Document relationships"}</strong>
      </div>
      {edges.length === 0 ? (
        <p className="arden-surface-lineage-empty">No direct document relationships visible</p>
      ) : (
        <ul className="arden-surface-lineage-list">
          {edges.map((edge) => (
            <li
              key={edge.relationshipId}
              className="arden-surface-lineage-edge"
              data-direction={edge.direction}
            >
              <span className="arden-surface-lineage-direction">
                <Icon name="arrow" size={11} />
                <span>{edge.direction === "OUTGOING" ? "Outgoing" : "Incoming"}</span>
              </span>
              <span className="arden-surface-lineage-rel">
                {formatRelationshipType(edge.relationshipType)}
              </span>
              <span className="arden-surface-lineage-peer">{edge.peerTitle}</span>
              <span className="arden-surface-meta-pill">{edge.peerType ?? "Uncategorized"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
