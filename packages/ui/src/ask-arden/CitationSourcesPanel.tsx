import { useEffect, useMemo, useRef } from "react";
import { Icon } from "../shared/Icon";
import type { AnswerCitation } from "./askArdenModel";

const passageKey = (citation: AnswerCitation) =>
  `${citation.versionId}:${citation.blockId ?? ""}:${citation.page ?? ""}:${citation.excerpt}`;

/**
 * Side panel listing the sources of one answer, like a reference drawer: each cited document with its exact
 * version, scope and quoted passages. It shows only citation data already validated with the answer;
 * Open in document takes the governed reader path, which rechecks access and highlights the passage.
 */
export function CitationSourcesPanel({ id, citations, selected, onOpenDocument, onClose }: {
  id: string;
  citations: readonly AnswerCitation[];
  selected: AnswerCitation;
  onOpenDocument?: (citation: AnswerCitation) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const documents = useMemo(() => {
    const byVersion = new Map<string, { title: string; meta: string; passages: AnswerCitation[] }>();
    const seen = new Set<string>();
    for (const citation of citations) {
      const key = passageKey(citation);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = byVersion.get(citation.versionId)
        ?? { title: citation.title, meta: [citation.version, citation.scope].filter(Boolean).join(" · "), passages: [] };
      entry.passages.push(citation);
      byVersion.set(citation.versionId, entry);
    }
    return [...byVersion.entries()];
  }, [citations]);
  const selectedKey = passageKey(selected);

  useEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(".ask-source-passage.is-selected");
    target?.scrollIntoView?.({ block: "nearest" });
    target?.focus({ preventScroll: true });
  }, [selectedKey]);

  return <aside ref={root} id={id} className="ask-sources-panel" aria-labelledby={`${id}-title`}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="ask-sources-header">
      <h2 id={`${id}-title`}>Sources</h2>
      <span className="ask-sources-count">{documents.length} {documents.length === 1 ? "document" : "documents"}</span>
      <button type="button" className="island-icon-button" aria-label="Close sources" title="Close sources" onClick={onClose}>
        <Icon name="close" size={13} />
      </button>
    </header>
    <div className="ask-sources-list">
      {documents.map(([versionId, document]) => <section key={versionId} className="ask-source-document" aria-label={document.title}>
        <div className="ask-source-document-title">
          <span className="ask-source-icon"><Icon name="document" size={14} /></span>
          <div><strong>{document.title}</strong>{document.meta && <small>{document.meta}</small>}</div>
        </div>
        {document.passages.map((citation) => {
          const key = passageKey(citation), isSelected = key === selectedKey;
          return <article key={key} tabIndex={-1} className={`ask-source-passage${isSelected ? " is-selected" : ""}`}
            aria-current={isSelected ? "true" : undefined} aria-label={citation.page ? `Passage on page ${citation.page}` : "Cited passage"}>
            {citation.page && <small>Page {citation.page}</small>}
            <q>{citation.excerpt}</q>
            <button type="button" className="ask-source-open" disabled={!onOpenDocument}
              aria-label={`Open ${citation.title} at this passage`} onClick={() => onOpenDocument?.(citation)}>
              Open in document <Icon name="open-external" size={11} />
            </button>
          </article>;
        })}
      </section>)}
    </div>
    <p className="ask-sources-footer">Passages are quoted from the exact version Arden used.</p>
  </aside>;
}
