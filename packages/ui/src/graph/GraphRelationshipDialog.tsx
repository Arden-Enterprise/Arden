import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  documentRelationshipTypes,
  type DocumentRelationshipType,
  type GraphDocumentNode,
  type GraphRelationshipEdge,
} from "@arden/domain";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";
import { Icon } from "../shared/Icon";
import {
  ApiError,
  createDocumentRelationship,
  getKnowledgeGraph,
  removeDocumentRelationship,
} from "../shared/api-client";
import type { Platform } from "../shared/types";

export interface GraphRelationshipSource {
  documentId: string;
  title: string;
  version?: string;
}

export interface GraphRelationshipDialogProps {
  platform: Platform;
  organizationId: string;
  sourceDocument: GraphRelationshipSource;
  /** Optional already-loaded graph snapshot (when opened from `/graph`). */
  documents?: readonly GraphDocumentNode[];
  relationships?: readonly GraphRelationshipEdge[];
  onChanged?: () => void;
  onClose: () => void;
}

const RELATIONSHIP_LABELS: Record<DocumentRelationshipType, string> = {
  REFERENCES: "References",
  RELATED: "Related to",
  SUPERSEDES: "Supersedes (informational lineage)",
};

const RELATIONSHIP_CHIP_LABELS: Record<DocumentRelationshipType, string> = {
  REFERENCES: "References",
  RELATED: "Related",
  SUPERSEDES: "Supersedes",
};

function relationshipTypeLabel(type: DocumentRelationshipType): string {
  return RELATIONSHIP_CHIP_LABELS[type];
}

function formatRelationshipError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && !error.code) {
      return "This relationship conflicts with an existing link or creates a cycle.";
    }
    if (error.status === 404) {
      return error.message || "That document or link is unavailable.";
    }
    return error.message;
  }
  return fallback;
}

/**
 * Published-only document relationship manager modal (SPEC-knowledge-graph.md §4.1 & §9).
 * Invoked from the Graph floating node toolbar and the Reader Document Information panel.
 * Deliberately free of graph visualization library imports so Home/Reader stays lean.
 */
export function GraphRelationshipDialog({
  platform,
  organizationId,
  sourceDocument,
  documents: providedDocuments,
  relationships: providedRelationships,
  onChanged,
  onClose,
}: GraphRelationshipDialogProps) {
  const targetFieldId = useId();
  const typeFieldId = useId();
  const errorId = useId();

  const [documents, setDocuments] = useState<readonly GraphDocumentNode[]>(providedDocuments ?? []);
  const [relationships, setRelationships] = useState<readonly GraphRelationshipEdge[]>(providedRelationships ?? []);
  const [loading, setLoading] = useState(!providedDocuments || !providedRelationships);
  const [loadError, setLoadError] = useState("");
  const [incompleteResults, setIncompleteResults] = useState(false);
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [relationshipType, setRelationshipType] = useState<DocumentRelationshipType>("REFERENCES");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const mountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const pendingAddKeyRef = useRef<{ signature: string; key: string } | null>(null);
  const pendingRemoveKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (providedDocuments) setDocuments(providedDocuments);
  }, [providedDocuments]);

  useEffect(() => {
    if (providedRelationships) setRelationships(providedRelationships);
  }, [providedRelationships]);

  const loadSnapshot = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const payload = await getKnowledgeGraph(platform, organizationId, {
        includeLinks: true,
        focusDocumentId: sourceDocument.documentId,
      });
      if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
      setDocuments(payload.documents);
      setRelationships(payload.relationships);
      setIncompleteResults(Boolean(payload.truncation.truncated || payload.truncation.relationshipsTruncated));
    } catch (caught) {
      if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
      setLoadError(formatRelationshipError(caught, "Couldn’t load document links."));
    } finally {
      if (mountedRef.current && loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [platform, organizationId, sourceDocument.documentId]);

  useEffect(() => {
    if (providedDocuments && providedRelationships) return;
    void loadSnapshot();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [loadSnapshot, providedDocuments, providedRelationships]);

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    map.set(sourceDocument.documentId, sourceDocument.title);
    for (const doc of documents) {
      map.set(doc.documentId, doc.title);
    }
    return map;
  }, [documents, sourceDocument.documentId, sourceDocument.title]);

  const targetChoices = useMemo(
    () => documents
      .filter((doc) => doc.documentId !== sourceDocument.documentId && doc.validityStatus !== "Expired")
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [documents, sourceDocument.documentId],
  );

  const outgoing = useMemo(
    () => relationships.filter((rel) => rel.sourceDocumentId === sourceDocument.documentId),
    [relationships, sourceDocument.documentId],
  );

  const incoming = useMemo(
    () => relationships.filter((rel) => rel.targetDocumentId === sourceDocument.documentId),
    [relationships, sourceDocument.documentId],
  );

  const handleAdd = async () => {
    if (!targetDocumentId) {
      setActionError("Choose a published target document.");
      return;
    }
    setBusy(true);
    setActionError("");
    setStatusMessage("");
    const signature = `${sourceDocument.documentId}:${targetDocumentId}:${relationshipType}`;
    const idempotencyKey = pendingAddKeyRef.current?.signature === signature
      ? pendingAddKeyRef.current.key
      : crypto.randomUUID();
    pendingAddKeyRef.current = { signature, key: idempotencyKey };
    try {
      const created = await createDocumentRelationship(
        platform,
        organizationId,
        sourceDocument.documentId,
        { targetDocumentId, relationshipType },
        idempotencyKey,
      );
      pendingAddKeyRef.current = null;
      if (!mountedRef.current) return;
      setRelationships((current) => (
        current.some((item) => item.relationshipId === created.relationshipId)
          ? current
          : [...current, created]
      ));
      setTargetDocumentId("");
      setStatusMessage("Link added.");
      onChanged?.();
    } catch (caught) {
      // Preserve the idempotency key across transient 5xx/network errors; mint a fresh key after deterministic 4xx rejections.
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        pendingAddKeyRef.current = null;
      }
      if (!mountedRef.current) return;
      setActionError(formatRelationshipError(caught, "Couldn’t add this link."));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleRemove = async (edge: GraphRelationshipEdge) => {
    setRemovingId(edge.relationshipId);
    setActionError("");
    setStatusMessage("");
    const idempotencyKey = pendingRemoveKeysRef.current.get(edge.relationshipId) ?? crypto.randomUUID();
    pendingRemoveKeysRef.current.set(edge.relationshipId, idempotencyKey);
    try {
      await removeDocumentRelationship(
        platform,
        organizationId,
        sourceDocument.documentId,
        edge.relationshipId,
        idempotencyKey,
      );
      pendingRemoveKeysRef.current.delete(edge.relationshipId);
      if (!mountedRef.current) return;
      setRelationships((current) => current.filter((item) => item.relationshipId !== edge.relationshipId));
      setStatusMessage("Link removed.");
      onChanged?.();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        pendingRemoveKeysRef.current.delete(edge.relationshipId);
      }
      if (!mountedRef.current) return;
      setActionError(formatRelationshipError(caught, "Couldn’t remove this link."));
    } finally {
      if (mountedRef.current) setRemovingId(null);
    }
  };

  const subtitle = sourceDocument.version
    ? `${sourceDocument.title} · v${sourceDocument.version}`
    : sourceDocument.title;

  return (
    <KnowledgeDialog
      title="Manage links"
      subtitle={subtitle}
      icon="graph"
      dismissible={!busy && removingId === null}
      onClose={onClose}
    >
      <div className="graph-rel-dialog">
        {loading ? (
          <div className="graph-rel-loading" role="status" aria-busy="true">Loading document links…</div>
        ) : loadError ? (
          <div className="graph-rel-error-block" role="alert">
            <p>{loadError}</p>
            <button type="button" className="secondary-button" onClick={() => void loadSnapshot()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <form
              className="graph-rel-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAdd();
              }}
            >
              <div className="graph-rel-form-row">
                <label className="island-field" htmlFor={typeFieldId}>
                  <span>Relationship type</span>
                  <select
                    id={typeFieldId}
                    value={relationshipType}
                    disabled={busy}
                    onChange={(event) => {
                      setRelationshipType(event.target.value as DocumentRelationshipType);
                      setActionError("");
                    }}
                  >
                    {documentRelationshipTypes.map((type) => (
                      <option key={type} value={type}>{RELATIONSHIP_LABELS[type]}</option>
                    ))}
                  </select>
                </label>

                <label className="island-field" htmlFor={targetFieldId}>
                  <span>Target document</span>
                  <select
                    id={targetFieldId}
                    value={targetDocumentId}
                    disabled={busy}
                    aria-invalid={Boolean(actionError) || undefined}
                    aria-describedby={actionError ? errorId : undefined}
                    onChange={(event) => {
                      setTargetDocumentId(event.target.value);
                      setActionError("");
                    }}
                  >
                    <option value="">Choose published document…</option>
                    {targetChoices.map((doc) => (
                      <option key={doc.documentId} value={doc.documentId}>
                        {doc.title} ({doc.ownerDepartmentName})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {relationshipType === "SUPERSEDES" && (
                <p className="graph-rel-hint">
                  Supersedes records informational cross-document lineage only; it does not replace versions or withdraw the target document.
                </p>
              )}

              <div className="graph-rel-form-actions">
                <button type="submit" className="primary-button" disabled={busy || !targetDocumentId}>
                  <Icon name="plus" size={14} />
                  {busy ? "Adding…" : "Add link"}
                </button>
              </div>
            </form>

            {actionError && (
              <p id={errorId} className="knowledge-live-error graph-rel-alert" role="alert">
                {actionError}
              </p>
            )}

            {statusMessage && !actionError && (
              <p className="graph-rel-status" role="status" aria-live="polite">
                {statusMessage}
              </p>
            )}

            {incompleteResults && (
              <div className="island-note is-warning graph-banner" role="status">
                <Icon name="warning" size={14} />
                <span>
                  Showing links across up to 500 documents and 1,000 links. Some target choices or links in large organizations may be omitted.
                </span>
              </div>
            )}

            <section className="graph-rel-section" aria-labelledby="graph-rel-outgoing-title">
              <h3 id="graph-rel-outgoing-title">Outgoing links ({outgoing.length})</h3>
              {outgoing.length === 0 ? (
                <p className="graph-rel-empty">No outgoing links declared from this document.</p>
              ) : (
                <ul className="graph-rel-list">
                  {outgoing.map((edge) => {
                    const targetTitle = titleById.get(edge.targetDocumentId) ?? "Unavailable document";
                    const isRemoving = removingId === edge.relationshipId;
                    return (
                      <li key={edge.relationshipId} className="graph-rel-item">
                        <span className="graph-rel-type-chip">{relationshipTypeLabel(edge.relationshipType)}</span>
                        <span className="graph-rel-target" title={targetTitle}>{targetTitle}</span>
                        <button
                          type="button"
                          className="secondary-button graph-rel-remove"
                          disabled={busy || removingId !== null}
                          aria-label={`Remove link to ${targetTitle}`}
                          onClick={() => void handleRemove(edge)}
                        >
                          <Icon name="trash" size={13} />
                          {isRemoving ? "Removing…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="graph-rel-section" aria-labelledby="graph-rel-incoming-title">
              <h3 id="graph-rel-incoming-title">Incoming links ({incoming.length})</h3>
              {incoming.length === 0 ? (
                <p className="graph-rel-empty">No visible published documents link to this document.</p>
              ) : (
                <ul className="graph-rel-list">
                  {incoming.map((edge) => {
                    const sourceTitle = titleById.get(edge.sourceDocumentId) ?? "Published document";
                    return (
                      <li key={edge.relationshipId} className="graph-rel-item">
                        <span className="graph-rel-type-chip">{relationshipTypeLabel(edge.relationshipType)}</span>
                        <span className="graph-rel-target" title={sourceTitle}>{sourceTitle}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        <div className="graph-rel-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || removingId !== null}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </KnowledgeDialog>
  );
}
