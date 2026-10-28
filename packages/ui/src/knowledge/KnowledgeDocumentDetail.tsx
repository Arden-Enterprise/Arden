import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../shared/Icon";
import type { KnowledgeCitationReference } from "./knowledgeCitation";

export type ReaderDocumentStatus = "EFFECTIVE" | "UPCOMING" | "EXPIRED";

export type ReaderDocumentVersion = {
  id: string;
  label: string;
  status: ReaderDocumentStatus;
  effectiveDate: string;
};

export type ReaderDocumentMetadata = {
  title: string;
  documentCode: string;
  ownerDepartment: string;
  summary: string;
  activeVersionId: string;
  versions: ReaderDocumentVersion[];
  sensitiveLabel?: "CONFIDENTIAL" | "RESTRICTED";
};

export function readerDocumentStatusAt(validFrom: string, validUntil: string | null, now: Date): ReaderDocumentStatus {
  const from = Date.parse(validFrom);
  const until = validUntil ? Date.parse(validUntil) : null;
  if (Number.isFinite(from) && from > now.getTime()) return "UPCOMING";
  if (until !== null && Number.isFinite(until) && until <= now.getTime()) return "EXPIRED";
  return "EFFECTIVE";
}

function statusLabel(status: ReaderDocumentStatus): string {
  if (status === "UPCOMING") return "Upcoming";
  if (status === "EXPIRED") return "Expired";
  return "Effective";
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
  }).format(date);
}

export function KnowledgeDocumentDetail({ metadata, content, focusTarget, onBack, onVersionChange }: {
  metadata: ReaderDocumentMetadata;
  content: ReactNode;
  focusTarget?: KnowledgeCitationReference | null;
  onBack: () => void;
  onVersionChange?: (versionId: string) => void;
}) {
  const readerRef = useRef<HTMLDivElement>(null);
  const activeVersion = metadata.versions.find((version) => version.id === metadata.activeVersionId)
    ?? metadata.versions[0];
  const hasEffectiveVersion = metadata.versions.some((version) => version.status === "EFFECTIVE");
  const visibleFocus = focusTarget?.versionId === activeVersion?.id ? focusTarget : null;

  useEffect(() => {
    const root = readerRef.current;
    const blockId = visibleFocus?.blockId;
    if (!root || !blockId) return;
    let highlighted: HTMLElement | null = null;
    const reveal = () => {
      const candidates = root.querySelectorAll<HTMLElement>("[data-id], [data-source-block-id]");
      const match = Array.from(candidates).find((element) => element.dataset.id === blockId || element.dataset.sourceBlockId === blockId);
      if (!match) return false;
      highlighted = match;
      match.classList.add("is-citation-source");
      match.scrollIntoView?.({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return true;
    };
    if (reveal()) return () => highlighted?.classList.remove("is-citation-source");
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); highlighted?.classList.remove("is-citation-source"); };
  }, [visibleFocus?.blockId, visibleFocus?.versionId]);

  if (!activeVersion) return null;

  return <div ref={readerRef} className="knowledge-reader-page">
    <button type="button" className="knowledge-back-button knowledge-live-back" onClick={onBack}>
      <Icon name="arrow" size={13} /> Library
    </button>
    <header className="knowledge-reader-heading">
      <div>
        <span className="island-meta">{metadata.ownerDepartment}</span>
        <h1>{metadata.title}</h1>
      </div>
      <div className="knowledge-reader-heading-status">
        {metadata.sensitiveLabel && <span className="island-chip tone-warning">{metadata.sensitiveLabel}</span>}
        <span className={`island-chip knowledge-reader-status is-${activeVersion.status.toLowerCase()}`}>
          {statusLabel(activeVersion.status)}
        </span>
      </div>
    </header>

    {activeVersion.status === "EXPIRED" && <div className="island-note is-warning knowledge-reader-expired" role="note">
      <Icon name="warning" size={16} />
      <span><strong>This version is no longer effective.</strong> {hasEffectiveVersion
        ? "Choose the current version before applying this guidance."
        : "Confirm whether newer guidance is available before applying it."}</span>
    </div>}

    {visibleFocus && <div className="knowledge-citation-focus" role="status">
      <span className="knowledge-citation-focus-icon"><Icon name="search" size={14} /></span>
      <div><strong>Opened from Ask Arden</strong><mark>{visibleFocus.excerpt}</mark></div>
      {visibleFocus.page && <small>Page {visibleFocus.page}</small>}
    </div>}

    <div className="knowledge-reader-layout">
      <aside className="island knowledge-reader-information" aria-labelledby="document-information-title">
        <div className="knowledge-reader-section-title">
          <Icon name="document" size={14} />
          <h2 id="document-information-title">Document information</h2>
        </div>
        <dl>
          <div><dt>Document code</dt><dd>{metadata.documentCode}</dd></div>
          <div><dt>Version</dt><dd><label><span className="sr-only">Document version</span><select
            value={activeVersion.id}
            onChange={(event) => onVersionChange?.(event.target.value)}
            disabled={!onVersionChange || metadata.versions.length < 2}
          >{metadata.versions.map((version) => <option key={version.id} value={version.id}>
            {version.label}{version.status === "EXPIRED" ? " (Expired)" : ""}
          </option>)}</select></label></dd></div>
          <div><dt>Status</dt><dd>{statusLabel(activeVersion.status)}</dd></div>
          <div><dt>Effective date</dt><dd>{dateLabel(activeVersion.effectiveDate)}</dd></div>
          <div><dt>Owner department</dt><dd>{metadata.ownerDepartment}</dd></div>
        </dl>
        <section className="knowledge-reader-summary" aria-labelledby="document-summary-title">
          <h3 id="document-summary-title">Summary</h3>
          <p>{metadata.summary}</p>
        </section>
      </aside>

      <article className="island knowledge-reader-surface" aria-label={`${metadata.title}, version ${activeVersion.label}`}>
        <div className="knowledge-reader-surface-bar">
          <span><Icon name="pdf" size={14} />{metadata.title}</span>
          <small>{activeVersion.label}</small>
        </div>
        <div className="knowledge-reader-content">{content}</div>
      </article>
    </div>
  </div>;
}
