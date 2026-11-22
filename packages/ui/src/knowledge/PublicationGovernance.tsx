import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, dismissPublicationReport, listClosedPublicationReports, listGovernancePublications, listPublicationReports, loadGovernanceInspection,
  loadResponsiblePublication, openGovernanceInspection, reportPublicationProblem, withdrawPublication,
  type GovernanceDocument, type GovernanceInspection, type GovernancePublication, type GovernanceReaderMode,
  type PublicationReport } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { importOpenMaintenanceReports } from "../maintenance/maintenance-client";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { PdfDocument } from "./PdfDocument";

const ArdenDocumentView = lazy(() => import("./ArdenRichTextEditor").then((module) => ({ default: module.ArdenDocumentView })));

const failure = (cause: unknown, fallback: string) => cause instanceof ApiError ? cause.message : fallback;

export function governanceReadersLabel(mode: GovernanceReaderMode, departmentId: string | null,
  departmentName: (id: string | null) => string): string {
  if (mode === "ORGANIZATION") return "Everyone in organization";
  if (mode === "DEPARTMENT") return departmentName(departmentId);
  return "Selected members";
}

/** One required reason (1-1000 characters) before an action that is recorded with it. */
export function ReasonDialog({ title, effect, label, placeholder, submitLabel, danger = false, onSubmit, onClose }: {
  title: string; effect: ReactNode; label: string; placeholder: string; submitLabel: string; danger?: boolean;
  onSubmit: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missing = !reason.trim();
  const submit = async () => {
    setAttempted(true);
    if (missing) return;
    setBusy(true); setError("");
    try { await onSubmit(reason.trim()); } catch (cause) { setError(failure(cause, "Couldn’t complete this action.")); setBusy(false); }
  };
  return <KnowledgeDialog title={title} dismissible={!busy} onClose={onClose}>
    <form className="publication-change-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="publication-change-effect">{effect}</div>
      <label className="island-field publication-change-reason">{label} *
        <textarea rows={4} maxLength={1000} value={reason} disabled={busy} aria-invalid={attempted && missing}
          placeholder={placeholder} onChange={(event) => setReason(event.target.value)} />
        <small className={attempted && missing ? "field-error" : ""} role={attempted && missing ? "alert" : undefined}>
          {attempted && missing ? "Enter a reason." : `${reason.length}/1000`}</small>
      </label>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      <div className="publication-change-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className={danger ? "primary-button governance-danger" : "primary-button"} disabled={busy}>
          {busy ? "Working…" : submitLabel}</button>
      </div>
    </form>
  </KnowledgeDialog>;
}

/** Read-only content of an inspection or a responsible view. It is never a Library or Ask Arden source. */
function GovernanceContentDialog({ document, heading, onClose }: { document: GovernanceDocument; heading: ReactNode; onClose: () => void }) {
  return <KnowledgeDialog title={document.title} onClose={onClose}>
    <div className="governance-view">
      <div className="governance-view-meta">{heading}</div>
      <div className="knowledge-version-preview">
        {document.mimeType === "application/pdf" && document.pdfBase64
          ? <PdfDocument base64={document.pdfBase64} title={document.title} showToolbar={false} />
          : <Suspense fallback={<p role="status">Loading document…</p>}><ArdenDocumentView
            key={`governance:${document.publishedVersionId}`} body={document.body}
            instanceKey={`governance:${document.publishedVersionId}`} /></Suspense>}
      </div>
    </div>
  </KnowledgeDialog>;
}

type WithdrawTarget = { documentId: string; title: string };

function WithdrawPublicationDialog({ target, platform, organizationId, onDone, onClose }: {
  target: WithdrawTarget; platform: Platform; organizationId: string; onDone: () => void; onClose: () => void;
}) {
  return <ReasonDialog title="Withdraw publication" danger label="Reason" submitLabel="Withdraw"
    placeholder="Why must this document stop being used?"
    effect={<><p><strong>{target.title}</strong></p><p>It leaves the Library, search and Ask Arden at once. Its versions stay in
      history, the author sees your reason, and publishing it again needs a new review. Copies people already
      downloaded cannot be recalled.</p></>}
    onClose={onClose}
    onSubmit={async (reason) => { await withdrawPublication(platform, organizationId, target.documentId, reason); onDone(); }} />;
}

/**
 * Open and retained problem reports visible to the current governance actor.
 */
export function PublicationReportsPanel({ platform, organizationId, departmentName, onInspect, refreshSignal = 0,
  allowDirectWithdrawal = false }: {
  platform: Platform; organizationId: string; departmentName: (id: string | null) => string;
  /** Organization Admin path for a document they are not responsible for as a reviewer. */
  onInspect?: (documentId: string, title: string) => void; refreshSignal?: number;
  /** Admin surface only; the database independently rechecks current Admin authority. */
  allowDirectWithdrawal?: boolean;
}) {
  const [reports, setReports] = useState<PublicationReport[] | null>(null);
  const [disposition, setDisposition] = useState<"open" | "closed">("open");
  const [closedAvailable, setClosedAvailable] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [viewing, setViewing] = useState<GovernanceDocument | null>(null);
  const [withdrawing, setWithdrawing] = useState<WithdrawTarget | null>(null);
  const [busy, setBusy] = useState(false);
  // Requests may settle after the page (or a test environment) is gone; never update state then.
  const mounted = useRef(false);
  const reportRequest = useRef(0);
  const selectedDisposition = useRef(disposition);
  selectedDisposition.current = disposition;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reportRequest.current += 1; };
  }, []);
  // A secondary panel: when reports can't be loaded it stays hidden rather than adding an error to Reviews.
  // Actions call the latest `load`, which always reloads the disposition selected when it runs.
  const load = useCallback(() => {
    const request = ++reportRequest.current;
    const isCurrent = () => mounted.current && reportRequest.current === request;
    setNextCursor(null);
    setLoadingMore(false);
    if (selectedDisposition.current === "closed") {
      void listClosedPublicationReports(platform, organizationId)
        .then((page) => {
          if (!isCurrent()) return;
          setReports(page.items);
          setNextCursor(page.nextCursor);
        })
        .catch((cause: unknown) => {
          if (!isCurrent()) return;
          setReports(null);
          setError(failure(cause, "Couldn’t load closed reports."));
        });
      return;
    }
    setClosedAvailable(false);
    void listPublicationReports(platform, organizationId)
      .then(async (items) => {
        if (!isCurrent()) return;
        setReports(items);
        if (items.length) return;
        const closedPage = await listClosedPublicationReports(platform, organizationId);
        if (isCurrent()) setClosedAvailable(closedPage.items.length > 0);
      })
      .catch(() => { if (isCurrent()) setReports([]); });
  }, [platform, organizationId]);
  useEffect(() => { load(); }, [load, refreshSignal, disposition]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const request = ++reportRequest.current;
    const isCurrent = () => mounted.current && reportRequest.current === request;
    setLoadingMore(true);
    setError("");
    try {
      const page = await listClosedPublicationReports(platform, organizationId, nextCursor);
      if (!isCurrent()) return;
      if (!page.items.length) {
        setReports([]);
        load();
        return;
      }
      setReports((previous) => [...(previous ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!isCurrent()) return;
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
        setReports([]);
        setNextCursor(null);
      }
      setError(failure(cause, "Couldn’t load more closed reports."));
    } finally {
      if (isCurrent()) setLoadingMore(false);
    }
  };
  const act = (work: () => Promise<void>) => { setBusy(true); setError(""); void work()
    .catch((cause: unknown) => { if (mounted.current) setError(failure(cause, "Couldn’t complete this action.")); })
    .finally(() => { if (mounted.current) setBusy(false); }); };
  // Stay visible while an outcome message is shown, even after the last report closes.
  if (disposition === "open" && !reports?.length && !closedAvailable && !error && !message) return null;
  const closed = disposition === "closed";
  return <section className="island governance-reports" aria-labelledby="governance-reports-title">
    <div className="governance-section-head">
      <h2 id="governance-reports-title">Reported problems</h2>
      <span className="island-badge">{reports?.length ?? 0}</span>
      <div className="island-seg governance-report-filters" role="group" aria-label="Report status">
        <button type="button" aria-pressed={disposition === "open"}
          onClick={() => { if (closed) { setDisposition("open"); setReports(null); setError(""); } }}>Open</button>
        <button type="button" aria-pressed={closed}
          onClick={() => { if (!closed) { setDisposition("closed"); setReports(null); setError(""); } }}>Closed</button>
      </div>
      {allowDirectWithdrawal && <button type="button" className="secondary-button governance-import" disabled={busy}
        onClick={() => act(async () => {
          const result = await importOpenMaintenanceReports(platform, organizationId);
          setMessage(`Imported ${result.imported.length}. Held ${result.held.length}.`);
          load();
        })}>Import open reports</button>}
    </div>
    {error && <p role="alert" className="knowledge-live-error">{error}</p>}
    {error && closed && reports === null && <button type="button" className="secondary-button"
      onClick={() => { setError(""); load(); }}>Retry</button>}
    {message && <p role="status" className="island-meta governance-report-message">{message}</p>}
    <ul className="governance-report-list">
      {(reports ?? []).map((report) => <li key={report.id} className="governance-report">
        <div className="governance-report-copy">
          <strong>{report.title}</strong>
          <p>{report.message}</p>
          <small>{report.reporterName} · {new Date(report.createdAt).toLocaleDateString()}
            {!report.stillCurrent && " · A newer version is published"}</small>
        </div>
        {closed && report.resolution && <span className="island-chip has-dot tone-strong">{report.resolution === "DISMISSED" ? "Dismissed" : "Withdrawn"}</span>}
        {!closed && <div className="governance-report-actions">
          {report.canView && <button type="button" className="secondary-button" disabled={busy} onClick={() => act(async () => {
            setViewing(await loadResponsiblePublication(platform, organizationId, report.documentId)); })}>View document</button>}
          {!report.canView && onInspect && <button type="button" className="secondary-button" disabled={busy}
            onClick={() => onInspect(report.documentId, report.title)}>Inspect</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => act(async () => {
            await dismissPublicationReport(platform, organizationId, report.id); setMessage("Report dismissed"); load(); })}>Dismiss</button>
          {allowDirectWithdrawal && <button type="button" className="secondary-button governance-danger-text" disabled={busy}
            onClick={() => setWithdrawing({ documentId: report.documentId, title: report.title })}>Withdraw</button>}
        </div>}
      </li>)}
    </ul>
    {closed && nextCursor && <button type="button" className="secondary-button" disabled={loadingMore}
      onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more closed reports"}</button>}
    {viewing && <GovernanceContentDialog document={viewing} onClose={() => setViewing(null)}
      heading={<span>Responsible review · {governanceReadersLabel(viewing.readers.mode, viewing.readers.departmentId, departmentName)}</span>} />}
    {withdrawing && <WithdrawPublicationDialog target={withdrawing} platform={platform} organizationId={organizationId}
      onClose={() => setWithdrawing(null)} onDone={() => { setWithdrawing(null); setMessage("Publication withdrawn"); load(); }} />}
  </section>;
}

/** Decision 0023: Administration → Documents. Metadata only until the Admin opens an audited inspection. */
export function GovernanceDocumentsPanel({ platform, organizationId, departmentName }: {
  platform: Platform; organizationId: string; departmentName: (id: string | null) => string;
}) {
  const [items, setItems] = useState<GovernancePublication[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [inspectTarget, setInspectTarget] = useState<WithdrawTarget | null>(null);
  const [inspection, setInspection] = useState<GovernanceInspection | null>(null);
  const [withdrawing, setWithdrawing] = useState<WithdrawTarget | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let present = true;
    setError("");
    listGovernancePublications(platform, organizationId).then((loaded) => { if (present) setItems(loaded); })
      .catch((cause: unknown) => { if (present) { setItems([]); setError(failure(cause, "Couldn’t load documents.")); } });
    return () => { present = false; };
  }, [platform, organizationId, refresh]);
  const shown = (items ?? []).filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const reload = () => setRefresh((value) => value + 1);

  return <div className="admin-tabpanel governance-documents">
    <p className="island-note">You see what is published and who it is shared with, not its content. Opening a document
      you can’t read requires a reason, is recorded, and lasts until 15 minutes of inactivity or 2 hours.</p>
    {error && <p role="alert" className="knowledge-live-error">{error}</p>}
    {message && <p role="status" className="island-meta">{message}</p>}
    <PublicationReportsPanel platform={platform} organizationId={organizationId} departmentName={departmentName} allowDirectWithdrawal
      refreshSignal={refresh} onInspect={(documentId, title) => setInspectTarget({ documentId, title })} />
    <label className="island-field governance-search">Search documents
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title" /></label>
    {items === null ? <div className="island island-empty" role="status">Loading documents…</div>
      : shown.length ? <IslandTable label="Published documents" minWidth={760}
        columns="minmax(220px, 2fr) minmax(120px, 1fr) minmax(150px, 1.1fr) 80px 110px minmax(190px, auto)"
        headers={["DOCUMENT", "DEPARTMENT", "SHARED WITH", "VERSION", "PUBLISHED", ""]}>
        {shown.map((item) => <IslandRow key={item.documentId}>
          <IslandCell className="island-row-cell is-name"><strong>{item.title}</strong>
            {item.openReports > 0 && <span className="island-chip is-danger">{item.openReports} reported</span>}</IslandCell>
          <IslandCell className="island-row-cell">{departmentName(item.responsibleDepartmentId)}</IslandCell>
          <IslandCell className="island-row-cell">{governanceReadersLabel(item.readerMode, item.readerDepartmentId, departmentName)}</IslandCell>
          <IslandCell className="island-row-cell">{item.versionLabel ?? (item.snapshotVersionNo ? `v${item.snapshotVersionNo}` : "—")}</IslandCell>
          <IslandCell className="island-row-cell">{new Date(item.publishedAt).toLocaleDateString()}</IslandCell>
          <IslandCell className="island-row-cell governance-row-actions">
            {item.readable ? <span className="island-meta">Readable in Library</span>
              : <button type="button" className="secondary-button" onClick={() => setInspectTarget({ documentId: item.documentId, title: item.title })}>Inspect</button>}
            <button type="button" className="secondary-button governance-danger-text"
              onClick={() => setWithdrawing({ documentId: item.documentId, title: item.title })}>Withdraw</button>
          </IslandCell>
        </IslandRow>)}
      </IslandTable> : <div className="island island-empty"><h3>{items.length ? "No matching documents" : "No published documents"}</h3></div>}
    {inspectTarget && <ReasonDialog title="Inspect document" label="Reason" submitLabel="Open"
      placeholder="Why do you need to open this document?"
      effect={<><p><strong>{inspectTarget.title}</strong></p><p>Your reason is recorded before the document opens. You won’t
        become a reader: it stays out of your Library and Ask Arden.</p></>}
      onClose={() => setInspectTarget(null)}
      onSubmit={async (reason) => {
        const id = await openGovernanceInspection(platform, organizationId, inspectTarget.documentId, reason);
        setInspection(await loadGovernanceInspection(platform, organizationId, id));
        setInspectTarget(null);
      }} />}
    {inspection && <GovernanceContentDialog document={inspection} onClose={() => setInspection(null)}
      heading={<dl className="island-kv">
        <dt>Reason</dt><dd>{inspection.reason}</dd>
        <dt>Shared with</dt><dd>{inspection.readers.names?.length
          ? inspection.readers.names.join(", ")
          : governanceReadersLabel(inspection.readers.mode, inspection.readers.departmentId, departmentName)}</dd>
        <dt>Open until</dt><dd>{new Date(inspection.expiresAt).toLocaleTimeString()} if idle</dd>
      </dl>} />}
    {withdrawing && <WithdrawPublicationDialog target={withdrawing} platform={platform} organizationId={organizationId}
      onClose={() => setWithdrawing(null)} onDone={() => { setWithdrawing(null); setMessage("Publication withdrawn"); reload(); }} />}
  </div>;
}

/** Decision 0023: a reader reports a problem with the document they are reading. */
export function ReportProblemButton({ platform, organizationId, publishedVersionId, title, onReported }: {
  platform: Platform; organizationId: string; publishedVersionId: string; title: string; onReported: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}>Report a problem</button>
    {open && <ReasonDialog title="Report a problem" label="What is wrong?" submitLabel="Send report"
      placeholder="For example: the figures in section 2 are out of date."
      effect={<><p><strong>{title}</strong></p><p>The reviewers responsible for this document and your administrators
        will see your report and your name. Other readers won’t.</p></>}
      onClose={() => setOpen(false)}
      onSubmit={async (message) => {
        await reportPublicationProblem(platform, organizationId, publishedVersionId, message);
        setOpen(false); onReported("Report sent");
      }} />}
  </>;
}
