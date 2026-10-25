import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { parseSemanticDocument, plainTextToSemanticDocument, serializeSemanticDocument } from "@arden/domain";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { SearchField } from "../shared/SearchField";
import { KnowledgeHeading, KnowledgeNotice } from "./KnowledgePrimitives";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import { validAudienceSelection } from "./audience-options";
import {
  ApiError, createNewKnowledgeDraft, createPdfKnowledgeDraft, decideKnowledgeReview, listAssignedKnowledgeReviews,
  listKnowledgeDrafts, listKnowledgeSubmissions, listPublishedKnowledge, loadKnowledgeDraft,
  loadKnowledgeOptions, loadKnowledgeReview, loadPublishedKnowledge, saveKnowledgeDraft,
  submitKnowledgeDraft, type AssignedKnowledgeReview, type KnowledgeDraftRecord,
  type KnowledgeDraftSummary, type KnowledgeOptions, type KnowledgeReviewDetail,
  type KnowledgeSubmission, type PublishedKnowledge,
} from "../shared/api-client";
import type { KnowledgeClassification } from "../shared/knowledge-classification";
import type { Platform } from "../shared/types";
import { PdfDocument, PdfViewer, pdfFileName, usePdfObjectUrl } from "./PdfDocument";
import { libraryDateLabel, libraryTitleParts } from "./libraryDisplay";
import { ReaderPicker } from "./ReaderPicker";
import { addReader, onlyGroupReaders, readerChoices, removeReader, scopeForReaders } from "./readerSelection";
import { ActionToast } from "../shared/ActionToast";
import { draftStatus, statusLabel, validatePdfFile } from "./knowledgeStatus";
import { KnowledgeDocumentDetail, readerDocumentStatusAt } from "./KnowledgeDocumentDetail";
import type { KnowledgeNavigationTarget } from "./knowledgeCitation";

const ArdenRichTextEditor = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenRichTextEditor })));
const ArdenDocumentView = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenDocumentView })));

function DocumentSurfaceLoading() {
  return <div className="arden-document-loading" role="status">Loading document editor…</div>;
}

type Props = ContextControlProps & {
  platform: Platform;
  organizationId: string;
  organizationName: string;
  view: "knowledge" | "review-queue";
  active: boolean;
  createdDraftId: string | null;
  citationTarget?: KnowledgeNavigationTarget | null;
  onAssignedReviewCount?: (count: number) => void;
};

type EditorValues = Pick<KnowledgeDraftRecord, "title" | "body" | "classification" | "responsibleDepartmentId" |
  "targetScopeType" | "teamTag" | "projectTag" | "audienceIds">;

function valuesFromDraft(draft: KnowledgeDraftRecord): EditorValues {
  return {
    title: draft.title, body: draft.body, classification: draft.classification,
    responsibleDepartmentId: draft.responsibleDepartmentId,
    targetScopeType: draft.targetScopeType, teamTag: draft.teamTag,
    projectTag: draft.projectTag, audienceIds: [...draft.audienceIds],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The server request failed. Refresh and try again.";
}

function semanticSummary(body: string | undefined): string | null {
  if (!body) return null;
  const parsed = parseSemanticDocument(body);
  if (!parsed.ok) return null;
  const text: string[] = [];
  const visit = (blocks: typeof parsed.document.blocks) => {
    for (const block of blocks) {
      if (block.type === "table") {
        for (const row of block.content) for (const cell of row.cells) {
          text.push(cell.flatMap((item) => item.type === "text" ? item.text : item.content.map((part) => part.text).join(" ")).join(" "));
        }
      } else if (block.type !== "asset") {
        text.push(block.content.flatMap((item) => item.type === "text" ? item.text : item.content.map((part) => part.text).join(" ")).join(" "));
      }
      visit(block.children);
    }
  };
  visit(parsed.document.blocks);
  const summary = text.join(" ").replace(/\s+/g, " ").trim();
  if (!summary) return null;
  return summary.length <= 280 ? summary : `${summary.slice(0, 277).trimEnd()}...`;
}

export function ServerKnowledgeFeaturePage({ platform, organizationId, organizationName,
  view, active, createdDraftId, citationTarget, onAssignedReviewCount, contextOpen, onToggleContext }: Props) {
  const [drafts, setDrafts] = useState<KnowledgeDraftSummary[]>([]);
  const [submissions, setSubmissions] = useState<KnowledgeSubmission[]>([]);
  const [published, setPublished] = useState<PublishedKnowledge[]>([]);
  const [reviews, setReviews] = useState<AssignedKnowledgeReview[]>([]);
  const [options, setOptions] = useState<KnowledgeOptions | null>(null);
  const [draft, setDraft] = useState<KnowledgeDraftRecord | null>(null);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [review, setReview] = useState<KnowledgeReviewDetail | null>(null);
  const [document, setDocument] = useState<PublishedKnowledge | null>(null);
  const [openedCitation, setOpenedCitation] = useState<KnowledgeNavigationTarget | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState(() => serializeSemanticDocument(
    plainTextToSemanticDocument("", () => crypto.randomUUID()),
  ));
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileError, setNewFileError] = useState("");
  const [newTitleError, setNewTitleError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [createMode, setCreateMode] = useState<"text" | "pdf">("text");
  const [screen, setScreen] = useState<"library" | "create" | "editor" | "document">("library");
  const [libraryTab, setLibraryTab] = useState<"drafts" | "published">("published");
  const [selectedContributionId, setSelectedContributionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [decisionToConfirm, setDecisionToConfirm] = useState<"APPROVE" | "REJECT" | null>(null);
  const createRequestKey = useRef<string | null>(null);
  const submitRequestKey = useRef<string | null>(null);
  const decisionRequest = useRef<{ action: "APPROVE" | "REJECT"; key: string } | null>(null);
  const openedCreatedDraftId = useRef<string | null>(null);
  const openedCitationId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseFileButton = useRef<HTMLButtonElement>(null);
  const decisionReason = useRef<HTMLTextAreaElement>(null);
  const reviewBodyRef = useRef<HTMLDivElement>(null);
  const pendingNextReview = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const [nextDrafts, nextSubmissions, nextPublished, nextReviews, nextOptions] = await Promise.all([
      listKnowledgeDrafts(platform, organizationId), listKnowledgeSubmissions(platform, organizationId),
      listPublishedKnowledge(platform, organizationId), listAssignedKnowledgeReviews(platform, organizationId),
      loadKnowledgeOptions(platform, organizationId),
    ]);
    setDrafts(nextDrafts); setSubmissions(nextSubmissions); setPublished(nextPublished);
    setReviews(nextReviews); setOptions(nextOptions);
    onAssignedReviewCount?.(nextReviews.length);
  }, [platform, organizationId, onAssignedReviewCount]);

  useEffect(() => {
    let present = true;
    setLoading(true); setError("");
    void reload().catch((cause) => { if (present) setError(errorMessage(cause)); })
      .finally(() => { if (present) setLoading(false); });
    return () => { present = false; };
  }, [reload, createdDraftId]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => { void reload().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, reload]);

  useEffect(() => {
    if (!active || !createdDraftId || openedCreatedDraftId.current === createdDraftId) return;
    openedCreatedDraftId.current = createdDraftId;
    let present = true;
    void loadKnowledgeDraft(platform, organizationId, createdDraftId)
      .then((loaded) => {
        if (!present) return;
        setDraft(loaded); setEditor(valuesFromDraft(loaded)); setScreen("editor");
        setMessage("Contribute copy created a separate server draft. Add governance metadata before submitting.");
      })
      .catch((cause) => { if (present) setError(errorMessage(cause)); });
    return () => { present = false; };
  }, [active, createdDraftId, organizationId, platform]);

  const refresh = async () => {
    setError("");
    try { await reload(); }
    catch (cause) { setError(errorMessage(cause)); }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const openDraft = (id: string) => void run(async () => {
    const loaded = await loadKnowledgeDraft(platform, organizationId, id);
    submitRequestKey.current = null;
    setDraft(loaded); setEditor(valuesFromDraft(loaded)); setScreen("editor");
  });

  const createDraft = () => void run(async () => {
    if (!newTitle.trim()) { setNewTitleError("Enter a title for this draft."); window.document.getElementById("knowledge-new-title")?.focus(); return; }
    const pdfError = createMode === "pdf" ? validatePdfFile(newFile) : "";
    if (pdfError) { setNewFileError(pdfError); chooseFileButton.current?.focus(); return; }
    const key = createRequestKey.current ?? crypto.randomUUID();
    createRequestKey.current = key;
    const created = createMode === "pdf" && newFile
      ? await createPdfKnowledgeDraft(platform, organizationId,
        { title: newTitle.trim(), file: newFile }, key)
      : await createNewKnowledgeDraft(platform, organizationId,
        { title: newTitle.trim(), body: newBody }, key);
    createRequestKey.current = null;
    setDraft(created); setEditor(valuesFromDraft(created)); setScreen("editor");
    setNewTitle(""); setNewBody(serializeSemanticDocument(
      plainTextToSemanticDocument("", () => crypto.randomUUID()),
    )); setNewFile(null); setNewFileError(""); setNewTitleError("");
    await refresh(); setMessage("Draft saved on the Arden server. Add its governance metadata before submitting.");
  });

  const saveDraft = () => void run(async () => {
    if (!draft || !editor) return;
    if (!editor.title.trim()) { setError("The title cannot be empty."); return; }
    const { body: _body, ...metadata } = editor;
    const saved = await saveKnowledgeDraft(platform, organizationId, draft.id, draft.currentVersion.version,
      draft.currentVersion.mimeType === "application/pdf" ? metadata : editor);
    submitRequestKey.current = null;
    setDraft(saved); setEditor(valuesFromDraft(saved));
    await refresh(); setMessage(`Draft v${saved.currentVersion.version} saved on the server.`);
  });

  const submitDraft = () => void run(async () => {
    if (!draft || !editor) return;
    const key = submitRequestKey.current ?? crypto.randomUUID();
    submitRequestKey.current = key;
    const submission = await submitKnowledgeDraft(platform, organizationId, draft.id, draft.currentVersion.version, key);
    submitRequestKey.current = null;
    setDraft({ ...draft, hasPendingSubmission: true });
    setMessage(`Version ${draft.currentVersion.version} submitted for review (${statusLabel(submission.status)}).`);
    await refresh();
  });

  const openReview = (id: string) => void run(async () => {
    const loaded = await loadKnowledgeReview(platform, organizationId, id);
    setReview(loaded); setComment(""); setCommentSubmitted(false); decisionRequest.current = null;
  });

  const requireDecisionReason = () => {
    setCommentSubmitted(true);
    if (comment.trim()) return true;
    decisionReason.current?.focus();
    return false;
  };
  const decide = (action: "APPROVE" | "REJECT") => void run(async () => {
    if (!review) return;
    const existing = decisionRequest.current;
    const key = existing?.action === action ? existing.key : crypto.randomUUID();
    decisionRequest.current = { action, key };
    const result = await decideKnowledgeReview(platform, organizationId, review, action, comment.trim() || null, key);
    decisionRequest.current = null; setReview(null); setDecisionToConfirm(null);
    await refresh();
    setMessage(result.status === "APPROVED"
      ? "Approved. The exact reviewed snapshot is preparing for indexing; it is not active yet."
      : "Submission rejected. The working draft remains editable and can be submitted again.");
  });

  // A newly opened submission starts at the top of its document, and a pending confirmation never carries over to it.
  useEffect(() => { reviewBodyRef.current?.scrollTo?.({ top: 0 }); setDecisionToConfirm(null); }, [review?.id]);
  // After a decision clears the submission and the queue refreshes, open its neighbour if it is still listed.
  useEffect(() => {
    if (busy) return;
    const next = pendingNextReview.current;
    if (review) { pendingNextReview.current = null; return; }
    if (!next) return;
    pendingNextReview.current = null;
    if (!reviews.some((item) => item.submissionId === next)) return;
    // Loaded directly rather than through run(), which would clear the decision's status-island message.
    let present = true;
    void loadKnowledgeReview(platform, organizationId, next).then((loaded) => {
      if (!present) return;
      setReview(loaded); setComment(""); setCommentSubmitted(false); decisionRequest.current = null;
    }).catch((cause: unknown) => { if (present) setError(errorMessage(cause)); });
    return () => { present = false; };
  }, [busy, review, reviews, platform, organizationId]);

  // Advanced tags start open only for a draft that already uses them; afterwards the author controls it.
  useEffect(() => { setAdvancedOpen(Boolean(draft?.teamTag || draft?.projectTag)); }, [draft?.id]);

  const openPublished = (id: string) => void run(async () => {
    const loaded = await loadPublishedKnowledge(platform, organizationId, id);
    setOpenedCitation(null); setDocument(loaded); setScreen("document");
  });

  useEffect(() => {
    if (!active || view !== "knowledge" || !citationTarget || openedCitationId.current === citationTarget.navigationId) return;
    openedCitationId.current = citationTarget.navigationId;
    let present = true;
    setBusy(true); setError("");
    void loadPublishedKnowledge(platform, organizationId, citationTarget.versionId)
      .then((loaded) => {
        if (!present) return;
        if (loaded.id !== citationTarget.versionId) throw new Error("citation-version-mismatch");
        setLibraryTab("published"); setOpenedCitation(citationTarget); setDocument(loaded); setScreen("document");
      })
      .catch(() => {
        if (!present) return;
        setOpenedCitation(null);
        setError("This citation source is unavailable in your current access scope.");
      })
      .finally(() => { if (present) setBusy(false); });
    return () => { present = false; };
  }, [active, citationTarget, organizationId, platform, view]);

  const latestByDraft = new Map<string, KnowledgeSubmission>();
  for (const submission of submissions) {
    const previous = latestByDraft.get(submission.draftId);
    if (!previous || Date.parse(submission.submittedAt) > Date.parse(previous.submittedAt)) latestByDraft.set(submission.draftId, submission);
  }
  const dirty = Boolean(draft && editor && JSON.stringify(editor) !== JSON.stringify(valuesFromDraft(draft)));
  const latest = draft ? latestByDraft.get(draft.id) : undefined;
  const currentDraftStatus = draft ? draftStatus({ hasPendingSubmission: draft.hasPendingSubmission,
    responsibleDepartmentId: draft.responsibleDepartmentId, targetScopeType: draft.targetScopeType,
    audienceIds: draft.audienceIds, versionId: draft.currentVersion.id }, latest) : null;
  const snapshotAlreadySubmitted = Boolean(latest && draft && latest.snapshotVersionId === draft.currentVersion.id);
  const ready = Boolean(editor?.responsibleDepartmentId && editor.targetScopeType
    && validAudienceSelection(editor.audienceIds, options?.audiences ?? [], editor.targetScopeType));
  const departmentName = (id: string | null) => options?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredDrafts = drafts.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery));
  const filteredPublished = published.filter((item) => [item.title, item.documentCode ?? "", item.summary ?? "",
    departmentName(item.responsibleDepartmentId), item.classification]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  const submitHint = draft?.hasPendingSubmission ? "This version is awaiting review."
    : dirty ? "Save your changes before submitting."
      : !ready ? "Complete the required governance metadata before submitting."
        : snapshotAlreadySubmitted ? "This version has already been submitted."
          : `Version ${draft?.currentVersion.version ?? 1} is ready to submit.`;
  const chooseFile = (file: File | null) => { setNewFile(file); setNewFileError(file ? validatePdfFile(file) : ""); createRequestKey.current = null; };

  const audienceNames = (ids: string[] | null | undefined) => (ids ?? []).map((id) => options?.audiences.find((audience) => audience.id === id)?.name ?? "Inactive audience").join(", ") || "None";
  const selectedContribution = drafts.find((item) => item.id === selectedContributionId) ?? null;
  const selectedContributionLatest = selectedContribution ? latestByDraft.get(selectedContribution.id) : undefined;
  const activeReview = review ? reviews.find((item) => item.submissionId === review.id) : undefined;
  const reviewIndex = review ? reviews.findIndex((item) => item.submissionId === review.id) : -1;
  const reviewTitle = review ? libraryTitleParts(review.title, null) : null;
  const noteRequired = commentSubmitted && !comment.trim();
  /** Decides, then opens the neighbouring submission once the queue has refreshed. */
  const decideAndAdvance = (action: "APPROVE" | "REJECT") => {
    const neighbour = reviews[reviewIndex + 1] ?? reviews[reviewIndex - 1];
    pendingNextReview.current = neighbour?.submissionId ?? null;
    decide(action);
  };
  const openCreate = (mode: "text" | "pdf") => { setCreateMode(mode); createRequestKey.current = null; setScreen("create"); };
  const readerPdfUrl = usePdfObjectUrl(screen === "document" && document?.mimeType === "application/pdf" ? document.pdfBase64 : null);
  const librarySearch = view === "knowledge" && screen === "library"
    ? <SearchField value={query} onChange={setQuery} placeholder={libraryTab === "drafts" ? "Filter my contributions…" : "Search title, code, owner or summary…"} /> : undefined;
  const breadcrumb = view === "review-queue" ? `${organizationName} / Knowledge / Reviews`
    : screen === "library" ? `${organizationName} / Knowledge / ${libraryTab === "drafts" ? "My Contributions" : "Library"}`
      : screen === "create" ? `${organizationName} / Knowledge / New draft`
        : `${organizationName} / Knowledge / ${screen === "document" ? document?.title ?? "Publication" : draft?.title ?? "Draft"}`;

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={breadcrumb} previewLabel="ARDEN SERVER · GOVERNED CONTENT" contextOpen={contextOpen} onToggleContext={onToggleContext}
      search={librarySearch} searchActive={Boolean(librarySearch && query)} chrome={screen === "document" && document ? "reader" : "full"} />
    <div className={`knowledge-feature-page knowledge-live-page${view === "review-queue" && !loading ? " is-review" : ""}`}>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {loading ? <div className="island island-empty" role="status">Loading governed knowledge…</div> : view === "review-queue" ? <div className="review-workspace">
        <section className="review-pane review-queue" aria-labelledby="review-queue-title">
          <div className="review-queue-heading"><h1 id="review-queue-title">Review queue</h1><span className="island-badge">{reviews.length}</span>
            <button type="button" className="island-link-button" disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
          <p className="review-queue-note">Covered by your grants. Never your own.</p>
          {reviews.length ? <div className="review-queue-list">{reviews.map((item) => {
            const shown = libraryTitleParts(item.title, null);
            return <button type="button" key={item.submissionId} className="review-queue-item" title={item.title}
              aria-current={review?.id === item.submissionId ? "true" : undefined} onClick={() => openReview(item.submissionId)}>
              {shown.code && <span className="review-queue-code">{shown.code}</span>}
              <strong>{shown.title}</strong>
              <span className="review-queue-meta">
                <span>{departmentName(item.departmentId)} · {libraryDateLabel(item.submittedAt)}</span>
                {item.classification !== "INTERNAL" && <span className={`island-chip review-mini-chip ${item.classification === "RESTRICTED" ? "tone-danger" : "tone-info"}`}>
                  {item.classification === "RESTRICTED" && <Icon name="lock" size={10} />}{item.classification === "RESTRICTED" ? "RESTR." : "CONF."}</span>}
                {item.approvalBlocked && <span className="review-blocked-dot" title="Approval blocked: an audience can no longer be enforced"><span className="sr-only">Approval blocked</span></span>}
              </span>
            </button>;
          })}</div> : <div className="island-empty review-queue-empty"><h3>Queue is clear</h3><p>New submissions in your granted departments appear here.</p></div>}
        </section>
        <article className="island review-pane review-submission" aria-label="Submission">
          {review ? <>
            <header className="review-document-header">
              <div className="review-document-tags">
                <Icon name={review.mimeType === "application/pdf" ? "pdf" : "document"} size={14} />
                {reviewTitle?.code && <span className="review-document-code">{reviewTitle.code}</span>}
                {review.classification !== "INTERNAL" && <KnowledgeClassificationChip classification={review.classification} />}
              </div>
              <h2 title={review.title}>{reviewTitle?.title ?? review.title}</h2>
              <p className="review-document-meta">{departmentName(review.responsibleDepartmentId)} · Submitted {libraryDateLabel(review.submittedAt)}</p>
            </header>
            <div ref={reviewBodyRef} className={`review-document${review.mimeType === "application/pdf" && review.pdfBase64 ? " is-pdf" : ""}`} tabIndex={0} aria-label={`Submitted document: ${review.title}`}>
              {review.mimeType === "application/pdf" && review.pdfBase64
                ? <PdfDocument base64={review.pdfBase64} title={review.title} />
                : <div className="review-document-text"><Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
                  key={`review:${review.id}:${review.snapshotVersionId}`} body={review.body}
                  instanceKey={`review:${review.id}:${review.snapshotVersionId}`} /></Suspense></div>}
            </div>
          </> : <div className="island-empty review-submission-empty"><span className="island-tile" aria-hidden="true"><Icon name="review" size={16} /></span>
            <h3>{reviews.length ? "Select a submission" : "Nothing left to review"}</h3>
            <p>{reviews.length ? "You decide the exact snapshot the author submitted. Approval starts publication preparation." : "Approved snapshots are preparing or active."}</p></div>}
        </article>
        {review && <aside className="island review-pane review-decision" aria-labelledby="review-decision-title">
          <div className="review-decision-header">
            <h2 id="review-decision-title">Decision</h2>
            {reviewIndex >= 0 && <span className="island-meta">{reviewIndex + 1} of {reviews.length}</span>}
            <span className="review-decision-nav">
              <button type="button" className="island-icon-button review-nav-previous" aria-label="Previous submission" disabled={busy || reviewIndex <= 0}
                onClick={() => { const previous = reviews[reviewIndex - 1]; if (previous) openReview(previous.submissionId); }}><Icon name="chevron" size={14} /></button>
              <button type="button" className="island-icon-button" aria-label="Next submission" disabled={busy || reviewIndex < 0 || reviewIndex >= reviews.length - 1}
                onClick={() => { const next = reviews[reviewIndex + 1]; if (next) openReview(next.submissionId); }}><Icon name="chevron" size={14} /></button>
            </span>
          </div>
          <div className="review-decision-body">
            <section aria-labelledby="review-frozen-title">
              <h3 id="review-frozen-title" className="review-section-label">FROZEN AT SUBMISSION</h3>
              <dl className="review-frozen">
                <div><dt>Review level</dt><dd>{review.classification === "RESTRICTED" || review.audienceIds.some((id) => options?.audiences.find((item) => item.id === id)?.kind === "ORGANIZATION_ALL")
                  ? "Specialist or Senior" : "Any reviewer grant"}</dd></div>
                <div><dt>Department</dt><dd title={departmentName(review.responsibleDepartmentId)}>{departmentName(review.responsibleDepartmentId)}</dd></div>
                <div><dt>Access scope</dt><dd>{review.targetScopeType === "DEPARTMENT" ? "Responsible department" : "Organization"}</dd></div>
                <div><dt>Audience</dt><dd title={audienceNames(review.audienceIds)}>{audienceNames(review.audienceIds)}</dd></div>
                <div><dt>Team / project</dt><dd title={`${review.teamTag || "All teams"} · ${review.projectTag || "All projects"}`}>{review.teamTag || "All teams"} · {review.projectTag || "All projects"}</dd></div>
                <div><dt>Snapshot</dt><dd className="knowledge-hash" title={review.contentHash}>{review.contentHash}</dd></div>
              </dl>
            </section>
            {activeReview?.approvalBlocked && <p className="island-note is-warning review-blocked-note" role="note"><Icon name="warning" size={14} /><span><strong>Approval is blocked.</strong> An audience on this snapshot can no longer be enforced. You can still reject.</span></p>}
            <label className="review-note">
              <span className="review-note-label"><span>Note to the author</span>
                <small className={noteRequired ? "is-required" : ""}>{noteRequired ? "Required to reject" : "Optional to approve"}</small></span>
              <textarea ref={decisionReason} rows={5} maxLength={2000} value={comment} disabled={busy} aria-invalid={noteRequired} aria-describedby="knowledge-decision-help"
                onChange={(event) => setComment(event.target.value)} placeholder="Explain what needs to change" />
            </label>
          </div>
          <footer className="review-decision-footer" role="group" aria-label="Review decision"
            onKeyDown={(event) => { if (event.key === "Escape" && decisionToConfirm && !busy) { event.stopPropagation(); setDecisionToConfirm(null); } }}>
            {decisionToConfirm ? <div className="review-confirm" role="alertdialog" aria-labelledby="review-confirm-title" aria-describedby="review-confirm-body">
              <strong id="review-confirm-title">{decisionToConfirm === "APPROVE" ? "Approve this snapshot for preparation?" : "Reject this snapshot?"}</strong>
              <p id="review-confirm-body">{decisionToConfirm === "APPROVE"
                ? "The server prepares this exact snapshot for indexing. It is not active until indexing finishes."
                : "The author gets your note. Their working draft stays editable and can be submitted again."}</p>
              {error && <p role="alert" className="knowledge-live-error">{error}</p>}
              <div className="review-decision-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
                <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button review-confirm-action" : "primary-button review-confirm-action"} disabled={busy}
                  onClick={() => decideAndAdvance(decisionToConfirm)}>{busy ? "Working…" : decisionToConfirm === "APPROVE" ? "Approve for preparation" : "Reject with note"}</button>
              </div>
            </div> : <>
              <div className="review-decision-actions">
                <button type="button" className="secondary-button review-reject" disabled={busy} onClick={() => { if (requireDecisionReason()) setDecisionToConfirm("REJECT"); }}>Reject</button>
                <button type="button" className="primary-button review-approve" disabled={busy || activeReview?.approvalBlocked} onClick={() => setDecisionToConfirm("APPROVE")}><Icon name="check" size={14} />Approve</button>
              </div>
              <small id="knowledge-decision-help" className={noteRequired ? "field-error" : "island-meta"}>{noteRequired ? "Explain why this snapshot is rejected."
                : activeReview?.approvalBlocked ? "Approval needs an enforceable audience."
                  : `Approve prepares this exact snapshot for indexing. It becomes active for ${audienceNames(review.audienceIds)} afterwards.`}</small>
            </>}
          </footer>
        </aside>}
      </div> : screen === "create" ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" disabled={busy} onClick={() => setScreen("library")}>← Knowledge</button>
        <KnowledgeHeading eyebrow="KNOWLEDGE" title="New shared draft" description="The draft stays yours. Governance metadata and review come after it's saved." />
        <form className="island island-panel knowledge-create-island" onSubmit={(event) => { event.preventDefault(); createDraft(); }}>
          <fieldset className="knowledge-create-source" disabled={busy}><legend>Content source</legend>
            <label className={createMode === "pdf" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "pdf"} onChange={() => { setCreateMode("pdf"); createRequestKey.current = null; }} /><span className="island-tile" aria-hidden="true"><Icon name="pdf" size={16} /></span><span><strong>Upload a PDF</strong><small>Kept as the original file</small></span></label>
            <label className={createMode === "text" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "text"} onChange={() => { setCreateMode("text"); createRequestKey.current = null; }} /><span className="island-tile" aria-hidden="true"><Icon name="document" size={16} /></span><span><strong>Write document text</strong><small>Arden's formatted editor</small></span></label>
          </fieldset>
          <div className="knowledge-create-fields">
            <label className="island-field">Title<input id="knowledge-new-title" maxLength={160} value={newTitle} disabled={busy} aria-invalid={Boolean(newTitleError)} aria-describedby="knowledge-new-title-help" onChange={(event) => { setNewTitle(event.target.value); setNewTitleError(""); createRequestKey.current = null; }} /><small id="knowledge-new-title-help" className={newTitleError ? "field-error" : ""}>{newTitleError || "Up to 160 characters."}</small></label>
          </div>
          {createMode === "pdf" ? <div className={`knowledge-pdf-choose${dragActive ? " is-drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files[0] ?? null); }}>
            <span className="island-tile" aria-hidden="true"><Icon name="pdf" size={18} /></span>
            <strong>Choose a PDF from this computer</strong><span>PDF only, up to 5 MB. The original is kept for review and download and isn't converted to editable text.</span>
            <input ref={fileInput} className="knowledge-hidden-file-input" tabIndex={-1} type="file" accept=".pdf,application/pdf" disabled={busy} aria-label="Choose PDF file" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            <button ref={chooseFileButton} type="button" className="secondary-button" disabled={busy} aria-invalid={Boolean(newFileError)} aria-describedby="knowledge-pdf-help" onClick={() => fileInput.current?.click()}>Choose file</button>
            <small id="knowledge-pdf-help" className={newFileError ? "field-error" : ""}>{newFileError}</small>
            {newFile && !newFileError && <div className="knowledge-selected-pdf"><strong>{newFile.name}</strong><span>{(newFile.size / 1024 / 1024).toFixed(1)} MB · ready to upload</span><button type="button" disabled={busy} onClick={() => { chooseFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Remove</button></div>}
          </div> : <div className="arden-document-field"><span>Document text</span>
            <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor key="new-shared-knowledge"
              body={newBody} instanceKey="new-shared-knowledge" disabled={busy} onChange={(body) => { setNewBody(body); createRequestKey.current = null; }} /></Suspense>
          </div>}
          <div className="knowledge-live-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setScreen("library"); createRequestKey.current = null; }}>Cancel</button>
            <span className="island-meta">Nothing is shared or submitted until you do it.</span></div>
        </form>
      </> : screen === "editor" && draft && editor ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => { setLibraryTab("drafts"); setScreen("library"); void refresh(); }}>← My Contributions</button>
        <h1 className="sr-only">{draft.title}</h1>
        <div className="draft-workspace">
          <article className="island draft-document" aria-label="Draft">
            <div className="draft-document-toolbar">
              <span className={`island-chip has-dot ${chipTone(currentDraftStatus?.tone ?? "")}`}>{currentDraftStatus?.label}</span>
              <span className="island-meta">v{draft.currentVersion.version} · {draft.currentVersion.mimeType === "application/pdf" ? "PDF original" : "Text"}{dirty ? " · Unsaved changes" : ""}</span>
            </div>
            {draft.hasPendingSubmission && <KnowledgeNotice title="Waiting for a reviewer" tone="amber">
              A different member needs an active reviewer grant for this department and classification. An Org Admin can assign one if the review queue is empty.
            </KnowledgeNotice>}
            {latest?.status === "REJECTED" && <KnowledgeNotice title="Submission rejected" tone="danger">
              {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
              This version was not published. You may revise the draft and submit a new version.
            </KnowledgeNotice>}
            {latest?.status === "APPROVED" && <KnowledgeNotice title="Approved · preparing publication" tone="jade">The reviewed snapshot is waiting for indexing and atomic activation. It is not searchable yet.</KnowledgeNotice>}
            <div className="draft-document-body knowledge-live-form">
              <label className="draft-title-field"><span className="sr-only">Title</span><input maxLength={160} disabled={busy} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
              {draft.currentVersion.mimeType === "application/pdf" && draft.pdfBase64
                ? <PdfDocument base64={draft.pdfBase64} title={draft.title} />
                : <div className="arden-document-field"><span className="sr-only">Document text</span>
                <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor
                  key={`${draft.id}:${draft.currentVersion.version}`} body={editor.body}
                  instanceKey={`${draft.id}:${draft.currentVersion.version}`}
                  disabled={busy} onChange={(body) => setEditor({ ...editor, body })} /></Suspense>
              </div>}
            </div>
          </article>
          <aside className="island island-panel draft-metadata knowledge-live-form" aria-labelledby="draft-metadata-title">
            <h2 id="draft-metadata-title">Before you submit</h2>
            <label className="island-field">Responsible department<select disabled={busy} value={editor.responsibleDepartmentId ?? ""} onChange={(event) => {
              const responsibleDepartmentId = event.target.value || null;
              const audienceIds = editor.audienceIds.filter((id) => {
                const audience = options?.audiences.find((item) => item.id === id);
                return audience?.kind === "ORGANIZATION_ALL" || !audience?.departmentId || audience.departmentId === responsibleDepartmentId;
              });
              setEditor({ ...editor, responsibleDepartmentId, audienceIds, targetScopeType: scopeForReaders(audienceIds, options?.audiences ?? [], editor.targetScopeType) });
            }}>
              <option value="">Choose department</option>{options?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Owns the document. Reviewers are drawn from this department.</small></label>
            <fieldset className="draft-readers" disabled={busy}><legend>Who can read it</legend>
              <ReaderPicker choices={readerChoices(options?.audiences ?? [], editor.responsibleDepartmentId)} selectedIds={editor.audienceIds}
                audiences={options?.audiences ?? []} disabled={busy}
                departmentHint={editor.responsibleDepartmentId ? undefined : "Choose the responsible department to add its department audience."}
                onAdd={(id) => { const audienceIds = addReader(editor.audienceIds, id, options?.audiences ?? []);
                  setEditor({ ...editor, audienceIds, targetScopeType: scopeForReaders(audienceIds, options?.audiences ?? [], editor.targetScopeType) }); }}
                onRemove={(id) => { const audienceIds = removeReader(editor.audienceIds, id);
                  setEditor({ ...editor, audienceIds, targetScopeType: scopeForReaders(audienceIds, options?.audiences ?? [], editor.targetScopeType) }); }} />
              {onlyGroupReaders(editor.audienceIds, options?.audiences ?? []) && editor.responsibleDepartmentId && <label className="draft-readers-limit">
                <input type="checkbox" checked={editor.targetScopeType === "DEPARTMENT"} onChange={(event) => setEditor({ ...editor, targetScopeType: event.target.checked ? "DEPARTMENT" : "ORGANIZATION" })} />
                <span>Only group members who are also in {departmentName(editor.responsibleDepartmentId)}</span></label>}
              {editor.targetScopeType && editor.audienceIds.length > 0 && <p className="draft-readers-scope" aria-live="polite">
                Scope: <strong>{editor.targetScopeType === "DEPARTMENT" ? `Department · ${departmentName(editor.responsibleDepartmentId)}` : "Organization"}</strong>, set by the readers above.</p>}
            </fieldset>
            {editor.responsibleDepartmentId && editor.audienceIds.length > 0 && <p className="draft-review-level" aria-live="polite">
              <Icon name="shield" size={14} /><span>{editor.audienceIds.some((id) => options?.audiences.find((item) => item.id === id)?.kind === "ORGANIZATION_ALL")
                ? `Everyone in the organization can read it, so a Specialist or Senior reviewer from ${departmentName(editor.responsibleDepartmentId)} decides.`
                : `A reviewer from ${departmentName(editor.responsibleDepartmentId)} decides.`}</span></p>}
            <details className="draft-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
              <summary>Advanced · team and project tags</summary>
              <div className="admin-grant-tags">
                <label className="island-field">Team tag<input maxLength={100} placeholder="Optional" disabled={busy} value={editor.teamTag ?? ""} onChange={(event) => setEditor({ ...editor, teamTag: event.target.value || null })} /></label>
                <label className="island-field">Project tag<input maxLength={100} placeholder="Optional" disabled={busy} value={editor.projectTag ?? ""} onChange={(event) => setEditor({ ...editor, projectTag: event.target.value || null })} /></label>
              </div>
              <small className="island-meta">Tags narrow which reviewer grants apply.</small>
            </details>
            <ul className="draft-readiness" aria-label="Submission readiness">
              {([["Title", Boolean(editor.title.trim())], ["Responsible department", Boolean(editor.responsibleDepartmentId)],
                ["Readers", Boolean(editor.targetScopeType) && validAudienceSelection(editor.audienceIds, options?.audiences ?? [], editor.targetScopeType)]] as const).map(([label, done]) =>
                <li key={label} className={done ? "is-done" : ""}><Icon name={done ? "check" : "close"} size={12} />{label}<small>{done ? "Done" : "Missing"}</small></li>)}
            </ul>
            <div className="draft-actions" role="group" aria-label="Draft actions">
              <button type="button" className="secondary-button" disabled={busy || !dirty} onClick={saveDraft}>{busy ? "Working…" : "Save version"}</button>
              <button type="button" className="primary-button" disabled={busy || draft.hasPendingSubmission || dirty || !ready || snapshotAlreadySubmitted} onClick={submitDraft}>Submit v{draft.currentVersion.version} for review</button>
              <span className="island-meta" aria-live="polite">{dirty ? "Unsaved changes · " : ""}{submitHint}</span>
            </div>
            <section className="island-detail-section" aria-label="Review history"><h3>History</h3>
              <ol className="island-timeline"><li><strong>v{draft.currentVersion.version} · {draft.hasPendingSubmission ? "awaiting review" : "working draft"}</strong><small>Updated {new Date(draft.updatedAt).toLocaleDateString()}</small></li>
                {submissions.filter((item) => item.draftId === draft.id).map((item) => <li key={item.id}><strong>{statusLabel(item.status)}</strong><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></li>)}</ol>
            </section>
          </aside>
        </div>
      </> : screen === "document" && document ? <KnowledgeDocumentDetail
        focusTarget={openedCitation}
        metadata={{
          title: document.title,
          documentCode: document.documentCode ?? "Not assigned",
          ownerDepartment: departmentName(document.responsibleDepartmentId),
          summary: document.summary ?? semanticSummary(document.body) ?? "No summary was supplied for this publication.",
          activeVersionId: document.id,
          versions: [{ id: document.id, label: document.versionLabel ?? "Current", status: readerDocumentStatusAt(document.validFrom, document.validUntil, new Date()), effectiveDate: document.validFrom }],
          sensitiveLabel: document.classification === "INTERNAL" ? undefined : document.classification,
        }}
        onBack={() => { setOpenedCitation(null); setScreen("library"); }}
        surfaceActions={readerPdfUrl && <a className="secondary-button" href={readerPdfUrl} download={pdfFileName(document.title)}>Download PDF</a>}
        content={document.mimeType === "application/pdf" && document.pdfBase64
          ? readerPdfUrl ? <PdfViewer url={readerPdfUrl} title={document.title} page={openedCitation?.page} /> : <p role="status">Preparing PDF preview…</p>
          : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
            key={`published:${document.id}:${document.contentHash}`} body={document.body ?? ""}
            instanceKey={`published:${document.id}:${document.contentHash}`} /></Suspense>}
      /> : <>
        <KnowledgeHeading eyebrow="KNOWLEDGE" title={libraryTab === "drafts" ? "My Contributions" : "Knowledge Library"}
          description={libraryTab === "drafts" ? "Shared drafts you author. Each submission freezes an exact version for review."
            : `${published.length} ${published.length === 1 ? "publication" : "publications"} you can read in ${organizationName}`}
          action={<div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
            <button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button>
            <button type="button" className="primary-button" onClick={() => openCreate("pdf")}><Icon name="plus" size={14} />Create from PDF</button></div>} />
        <div className="island-seg knowledge-library-tabs" role="tablist" aria-label="Knowledge library">
          <button type="button" role="tab" aria-selected={libraryTab === "published"} onClick={() => setLibraryTab("published")}>Library<span className="island-badge">{published.length}</span></button>
          <button type="button" role="tab" aria-selected={libraryTab === "drafts"} onClick={() => setLibraryTab("drafts")}>My Contributions<span className="island-badge">{drafts.length}</span></button>
        </div>
        {query.trim() && <p className="island-meta" role="status">Searching accessible publications for “{query.trim()}”.</p>}
        {libraryTab === "published" && (filteredPublished.length ? <IslandTable label="Accessible published knowledge" minWidth={780}
          columns="minmax(320px, 3fr) minmax(130px, 1fr) 72px 128px 112px"
          headers={["DOCUMENT", "OWNER", "VERSION", "EFFECTIVE DATE", "STATUS"]}>
          {filteredPublished.map((item) => {
            const publicationStatus = readerDocumentStatusAt(item.validFrom, item.validUntil, new Date());
            const shown = libraryTitleParts(item.title, item.documentCode);
            const isPdf = item.mimeType === "application/pdf";
            const sensitive = item.classification === "INTERNAL" ? null : item.classification;
            return <IslandRow key={item.id} className="library-row">
              <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name library-row-name"
                onClick={() => openPublished(item.id)} aria-label={`Read ${item.title}`} title={item.title}>
                <span className="library-row-icon" aria-hidden="true"><Icon name={isPdf ? "pdf" : "document"} size={16} /></span>
                <span className="library-row-copy">
                  {shown.code && <span className="library-row-code">{shown.code}</span>}
                  <strong className="library-row-title">{shown.title}</strong>
                  {(isPdf || sensitive) && <span className="library-row-meta">{isPdf && <span>PDF</span>}
                    {sensitive && <KnowledgeClassificationChip classification={sensitive} />}</span>}
                </span>
              </button></IslandCell>
              <IslandCell className="island-row-cell library-row-secondary">{departmentName(item.responsibleDepartmentId)}</IslandCell>
              <IslandCell className="island-row-cell library-row-secondary">{item.versionLabel ?? <span className="library-row-empty"><span aria-hidden="true">—</span><span className="sr-only">No version label</span></span>}</IslandCell>
              <IslandCell className="island-row-cell library-row-date">{libraryDateLabel(item.validFrom)}</IslandCell>
              <IslandCell>{publicationStatus === "EFFECTIVE"
                ? <span className="library-row-effective">Effective</span>
                : <span className={`island-chip knowledge-reader-status is-${publicationStatus.toLowerCase()}`}>{publicationStatus === "UPCOMING" ? "Upcoming" : "Expired"}</span>}</IslandCell>
            </IslandRow>;
          })}
        </IslandTable>
          : <div className="island island-empty"><h3>{published.length ? "No matching publications" : "No accessible publication"}</h3><p>{published.length ? "Try another title, document code or owner department." : "Approved knowledge appears here when one of your audiences may read it."}</p></div>)}
        {libraryTab === "drafts" && (filteredDrafts.length ? <div className="island-split">
          <div className="island-main"><IslandTable label="My contributions" minWidth={620} columns="minmax(240px, 1.8fr) minmax(110px, 1fr) 110px minmax(150px, auto)"
            headers={["DOCUMENT", "DEPARTMENT", "UPDATED", "STATUS"]}>
            {filteredDrafts.map((item) => {
              const status = draftStatus(item, latestByDraft.get(item.id));
              const shown = libraryTitleParts(item.title, null);
              const sensitive = item.classification === "INTERNAL" ? null : item.classification;
              return <IslandRow key={item.id} selected={selectedContributionId === item.id} className="library-row">
                <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name library-row-name" onClick={() => setSelectedContributionId(item.id)}
                  aria-label={`Open details for ${item.title}`} title={item.title}>
                  <span className="library-row-icon" aria-hidden="true"><Icon name={item.mimeType === "application/pdf" ? "pdf" : "document"} size={16} /></span>
                  <span className="library-row-copy">
                    {shown.code && <span className="library-row-code">{shown.code}</span>}
                    <span className="library-row-heading"><strong className="library-row-title">{shown.title}</strong><span className="library-row-version">v{item.currentVersion}</span></span>
                    <span className="library-row-meta">{sensitive && <KnowledgeClassificationChip classification={sensitive} />}<span className="library-row-audience">{audienceNames(item.audienceIds)}</span></span>
                  </span></button></IslandCell>
                <IslandCell className="island-row-cell library-row-secondary">{departmentName(item.responsibleDepartmentId)}</IslandCell>
                <IslandCell className="island-row-cell library-row-date">{libraryDateLabel(item.updatedAt)}</IslandCell>
                <IslandCell><span className={`island-chip has-dot ${chipTone(status.tone)}`}>{status.label}</span></IslandCell>
              </IslandRow>;
            })}
          </IslandTable></div>
          {selectedContribution && <aside className="island island-panel island-side contribution-side" aria-labelledby="contribution-title">
            <div className="island-side-header"><div>
              <span className="island-chip-row"><span className={`island-chip has-dot ${chipTone(draftStatus(selectedContribution, selectedContributionLatest).tone)}`}>{draftStatus(selectedContribution, selectedContributionLatest).label}</span><span className="island-meta">v{selectedContribution.currentVersion}</span></span>
              <h2 id="contribution-title">{selectedContribution.title}</h2></div>
              <button type="button" className="island-icon-button" onClick={() => setSelectedContributionId(null)} aria-label="Close contribution details"><Icon name="close" size={14} /></button></div>
            {selectedContributionLatest?.decisionComment && <blockquote className="island-box contribution-reason"><strong>Reviewer note</strong><p>{selectedContributionLatest.decisionComment}</p></blockquote>}
            <dl className="island-kv">
              <dt>Classification</dt><dd>{selectedContribution.classification}</dd>
              <dt>Department</dt><dd>{departmentName(selectedContribution.responsibleDepartmentId)}</dd>
              <dt>Audience</dt><dd>{audienceNames(selectedContribution.audienceIds)}</dd>
              <dt>Snapshot</dt><dd className="knowledge-hash">{selectedContribution.contentHash}</dd>
            </dl>
            <section className="island-detail-section" aria-label="History"><h3>History</h3>
              <ol className="island-timeline"><li><strong>v{selectedContribution.currentVersion} · working version</strong><small>Updated {new Date(selectedContribution.updatedAt).toLocaleDateString()}</small></li>
                {submissions.filter((item) => item.draftId === selectedContribution.id).map((item) => <li key={item.id}><strong>{statusLabel(item.status)}</strong><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></li>)}</ol>
            </section>
            <div className="island-side-footer contribution-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => openDraft(selectedContribution.id)}>Open draft</button>
              <span className="island-meta">Private originals stay private; this draft is a separate shared copy.</span></div>
          </aside>}
        </div> : <div className="island island-empty"><h3>{drafts.length ? "No matching drafts" : "No contributions yet"}</h3><p>{drafts.length ? "Try another title." : "Create a draft by writing text or uploading a PDF. It stays yours until you submit a version for review."}</p><button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button></div>)}
      </>}
    </div>
    <ActionToast message={message} onDismiss={() => setMessage("")} />
  </main>;
}

const statusChipTone: Record<string, string> = { "is-info": "tone-info", "is-success": "tone-success", "is-danger": "tone-danger", "is-attention": "tone-warning" };
function chipTone(tone: string): string { return statusChipTone[tone] ?? ""; }

const classificationChipTone: Record<KnowledgeClassification, string> = { INTERNAL: "tone-strong", CONFIDENTIAL: "tone-info", RESTRICTED: "tone-danger" };
function KnowledgeClassificationChip({ classification }: { classification: KnowledgeClassification }) {
  return <span className={`island-chip ${classificationChipTone[classification]}`}>{classification === "RESTRICTED" && <Icon name="lock" size={11} />}{classification}</span>;
}
