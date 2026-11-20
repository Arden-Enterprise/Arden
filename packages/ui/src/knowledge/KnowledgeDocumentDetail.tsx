import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "../shared/Icon";
import type { KnowledgeCitationReference } from "./knowledgeCitation";
import { clearHighlight, paintHighlight, quoteRanges } from "./citationHighlight";
import { useReaderSummary, type ReaderSummaryOptions } from "./useReaderSummary";
import { ReaderSummaryPanel } from "./ReaderSummaryPanel";
import { ReaderQuestionPanel } from "./ReaderQuestionPanel";
import { useReaderAccess } from "./useReaderAccess";

const citationHighlightName = "arden-citation";

export type ReaderDocumentStatus = "EFFECTIVE" | "EXPIRING" | "UPCOMING" | "EXPIRED";

export type ReaderDocumentVersion = {
  id: string;
  label: string;
  status: ReaderDocumentStatus | "PUBLISHED";
  /** Whole days until the expiration date, for EXPIRING. */
  expiresInDays?: number;
  /** Retained for sample history; the reader no longer shows effective dates. */
  effectiveDate?: string;
};

export type ReaderDocumentMetadata = {
  type?: string;
  publishedDate?: string;
  expirationDate?: string;
  title: string;
  ownerDepartment: string;
  /** Who may read this version, in plain words (Whole organization, a department, selected members). */
  readers?: string;
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

const informationCollapsedKey = "arden.reader.informationCollapsed";

/** Per-viewer preference only; a blocked or empty storage simply starts expanded. */
function readInformationCollapsed(): boolean {
  try { return window.localStorage.getItem(informationCollapsedKey) === "true"; } catch { return false; }
}

function writeInformationCollapsed(collapsed: boolean): void {
  try { window.localStorage.setItem(informationCollapsedKey, String(collapsed)); } catch { /* preference is optional */ }
}

function statusLabel(version: ReaderDocumentVersion): string {
  if (version.status === "UPCOMING") return "Upcoming";
  if (version.status === "EXPIRED") return "Expired";
  if (version.status === "EXPIRING") {
    const days = version.expiresInDays ?? 0;
    return days === 0 ? "Expires today" : `Expires in ${days} ${days === 1 ? "day" : "days"}`;
  }
  return "Current";
}

function dateLabel(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
  }).format(date);
}

/**
 * Reading layout: document information on the left, the viewer on the right. The title appears once,
 * in the viewer bar (the page h1); status and classification live in the information panel.
 */
export function KnowledgeDocumentDetail({ metadata, content, surfaceActions, focusTarget, onBack, onVersionChange, summaryOptions }: {
  metadata: ReaderDocumentMetadata;
  content: ReactNode;
  /** Actions for the viewer bar, such as Download PDF. */
  surfaceActions?: ReactNode;
  focusTarget?: KnowledgeCitationReference | null;
  onBack: () => void;
  onVersionChange?: (versionId: string) => void;
  summaryOptions?: ReaderSummaryOptions;
}) {
  const [panel, setPanel] = useState<"summary" | "question" | null>(null);
  const [questionMounted, setQuestionMounted] = useState(false), questionButton = useRef<HTMLButtonElement>(null);
  const access = useReaderAccess(summaryOptions);
  const summary = useReaderSummary(summaryOptions ? { ...summaryOptions, visible: panel === "summary" } : undefined, access);
  const summaryId = useId(), summaryButton = useRef<HTMLButtonElement>(null);
  const closeSummary = () => { summary.close(); setPanel(null); summaryButton.current?.focus(); };
  const closeQuestion = () => { setQuestionMounted(false); setPanel(null); questionButton.current?.focus(); };
  const readerRef = useRef<HTMLDivElement>(null);
  const [informationCollapsed, setInformationCollapsed] = useState(readInformationCollapsed);
  const toggleInformation = (collapsed: boolean) => {
    setInformationCollapsed(collapsed);
    writeInformationCollapsed(collapsed);
    // Keep focus on the control that now toggles the panel back.
    requestAnimationFrame(() => readerRef.current?.querySelector<HTMLButtonElement>(collapsed ? ".knowledge-reader-expand" : ".knowledge-reader-collapse")?.focus());
  };
  const activeVersion = metadata.versions.find((version) => version.id === metadata.activeVersionId)
    ?? metadata.versions[0];
  const hasEffectiveVersion = metadata.versions.some((version) => version.status === "EFFECTIVE" || version.status === "EXPIRING" || version.status === "PUBLISHED");
  // A selector appears only when there is something to choose; one version is shown as plain text.
  const canChooseVersion = Boolean(onVersionChange) && metadata.versions.length > 1;
  const visibleFocus = focusTarget?.versionId === activeVersion?.id ? focusTarget : null;

  useEffect(() => {
    const root = readerRef.current?.querySelector<HTMLElement>(".knowledge-reader-content");
    const blockId = visibleFocus?.blockId;
    // PDF block ids never match rendered elements; the PDF reader highlights its own text layer.
    if (!root || !visibleFocus || !blockId) return;
    let highlighted: HTMLElement | null = null;
    const reveal = () => {
      const candidates = root.querySelectorAll<HTMLElement>("[data-id], [data-source-block-id]");
      const match = Array.from(candidates).find((element) => element.dataset.id === blockId || element.dataset.sourceBlockId === blockId);
      if (!match) return false;
      // The rich-text view owns its DOM and reverts class or markup changes, so the quote is painted
      // with the CSS Custom Highlight API instead. The block outline is the fallback without that API.
      const ranges = quoteRanges(match, visibleFocus.excerpt);
      if (!paintHighlight(citationHighlightName, ranges)) { highlighted = match; match.classList.add("is-citation-source"); }
      const anchor = ranges[0]?.startContainer.parentElement ?? match;
      anchor.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return true;
    };
    const clear = () => { clearHighlight(citationHighlightName); highlighted?.classList.remove("is-citation-source"); };
    if (reveal()) return clear;
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(root, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 15_000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); clear(); };
    // A new citation request (even for the same passage) has a new identity and highlights again.
  }, [visibleFocus]);

  if (!activeVersion) return null;

  return <div ref={readerRef} className="knowledge-reader-page" onKeyDown={event => {
    if (event.key === "Escape" && panel === "question") { event.stopPropagation(); closeQuestion(); return; }
    if (event.key === "Escape" && panel === "summary") { event.stopPropagation(); closeSummary(); }
  }}>
    <button type="button" className="knowledge-reader-back" onClick={onBack}>
      <Icon name="arrow" size={12} />Home
    </button>
    {activeVersion.status === "EXPIRED" && <div className="island-note is-warning knowledge-reader-expired" role="note">
      <Icon name="warning" size={16} />
      <span><strong>This version has expired.</strong> {hasEffectiveVersion ? "Choose the current version." : ""}</span>
    </div>}

    {visibleFocus && <div className="knowledge-citation-focus" role="status">
      <span className="knowledge-citation-focus-icon"><Icon name="search" size={14} /></span>
      <div><strong>Cited passage</strong><mark>{visibleFocus.excerpt}</mark></div>
      {visibleFocus.page && <small>Page {visibleFocus.page}</small>}
    </div>}

    <div className={`knowledge-reader-layout${informationCollapsed ? " is-information-collapsed" : ""}`}>
      <aside id="knowledge-reader-information" hidden={informationCollapsed} className="island knowledge-reader-information" aria-labelledby="document-information-title">
        <div className="knowledge-reader-section-title">
          <Icon name="document" size={14} />
          <h2 id="document-information-title">Document information</h2>
          <button type="button" className="island-icon-button knowledge-reader-collapse" aria-expanded="true" aria-controls="knowledge-reader-information"
            aria-label="Hide document information" title="Hide document information" onClick={() => toggleInformation(true)}><Icon name="sidebar" size={14} /></button>
        </div>
        <dl>
          {metadata.type && <div><dt>Type</dt><dd>{metadata.type}</dd></div>}
          <div><dt>Version</dt><dd>{canChooseVersion ? <label><span className="sr-only">Document version</span><select
            value={activeVersion.id}
            onChange={(event) => onVersionChange?.(event.target.value)}
          >{metadata.versions.map((version) => <option key={version.id} value={version.id}>
            {version.label || "Not recorded"}{version.status === "EXPIRED" ? " (Expired)" : ""}
          </option>)}</select></label>
            : activeVersion.label ? <span className="knowledge-reader-version">{activeVersion.label}</span>
              : <span className="knowledge-reader-unset">Not recorded</span>}</dd></div>
          <div><dt>Status</dt><dd><span className={`island-chip knowledge-reader-status is-${activeVersion.status === "PUBLISHED" ? "effective" : activeVersion.status.toLowerCase()}`}>
            {statusLabel(activeVersion)}</span></dd></div>
          {metadata.sensitiveLabel && <div><dt>Classification</dt><dd><span className="island-chip tone-warning">{metadata.sensitiveLabel}</span></dd></div>}
          {metadata.expirationDate && <div><dt>Valid until</dt><dd>{dateLabel(metadata.expirationDate)}</dd></div>}
          {metadata.readers && <div><dt>Readers</dt><dd>{metadata.readers}</dd></div>}
          <div><dt>Owner department</dt><dd>{metadata.ownerDepartment}</dd></div>
          {metadata.publishedDate && <div><dt>Published</dt><dd>{dateLabel(metadata.publishedDate)}</dd></div>}
        </dl>
        {metadata.summary && <section className="knowledge-reader-summary" aria-labelledby="document-summary-title">
          <h3 id="document-summary-title">Summary</h3>
          <p>{metadata.summary}</p>
        </section>}
      </aside>

      <article className="island knowledge-reader-surface" aria-label={`${metadata.title}, version ${activeVersion.label}`}>
        <header className="knowledge-reader-surface-bar">
          {informationCollapsed && <button type="button" className="island-icon-button knowledge-reader-expand" aria-expanded="false" aria-controls="knowledge-reader-information"
            aria-label="Show document information" title="Show document information" onClick={() => toggleInformation(false)}><Icon name="sidebar" size={14} /></button>}
          <Icon name="pdf" size={14} />
          <h1 title={metadata.title}>{metadata.title}</h1>
          {activeVersion.label && <small>v{activeVersion.label}</small>}
          {(surfaceActions || summaryOptions) && <div className="knowledge-reader-surface-actions">
            {summaryOptions && <button ref={summaryButton} type="button" className="secondary-button reader-ai-summary-trigger"
              aria-expanded={panel === "summary" && summary.state.status !== "closed"} aria-controls={summaryId}
              onClick={() => {
                if (panel === "summary" && summary.state.status !== "closed") return;
                setPanel("summary"); if (summary.state.status === "closed") void summary.open();
              }}>Summary</button>}
            {summaryOptions && <button ref={questionButton} type="button" className="secondary-button"
              aria-expanded={panel === "question"} onClick={() => {
                if (panel === "question") return;
                setQuestionMounted(true); setPanel("question");
              }}>Ask this document</button>}
            {surfaceActions}</div>}
        </header>
        {panel === "summary" && <ReaderSummaryPanel id={summaryId} summary={summary} onClose={closeSummary} />}
        {questionMounted && summaryOptions?.active && <ReaderQuestionPanel
          options={{ ...summaryOptions, visible: panel === "question" }} access={access} onClose={closeQuestion}
          key={JSON.stringify([summaryOptions.platform, summaryOptions.context])} />}
        <div className="knowledge-reader-content">{content}</div>
      </article>
    </div>
  </div>;
}
