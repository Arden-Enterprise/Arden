import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { plainTextToSemanticDocument, serializeSemanticDocument } from "@arden/domain";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { SearchField } from "../shared/SearchField";
import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow } from "./KnowledgePrimitives";
import { availableAudienceOptions, normalizeAudienceSelection, validAudienceSelection } from "./audience-options";
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
import { PdfDocument } from "./PdfDocument";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { ActionToast } from "../shared/ActionToast";
import { draftStatus, statusLabel, validatePdfFile } from "./knowledgeStatus";

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

export function ServerKnowledgeFeaturePage({ platform, organizationId, organizationName,
  view, active, createdDraftId, onAssignedReviewCount, contextOpen, onToggleContext }: Props) {
  const [drafts, setDrafts] = useState<KnowledgeDraftSummary[]>([]);
  const [submissions, setSubmissions] = useState<KnowledgeSubmission[]>([]);
  const [published, setPublished] = useState<PublishedKnowledge[]>([]);
  const [reviews, setReviews] = useState<AssignedKnowledgeReview[]>([]);
  const [options, setOptions] = useState<KnowledgeOptions | null>(null);
  const [draft, setDraft] = useState<KnowledgeDraftRecord | null>(null);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [review, setReview] = useState<KnowledgeReviewDetail | null>(null);
  const [document, setDocument] = useState<PublishedKnowledge | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState(() => serializeSemanticDocument(
    plainTextToSemanticDocument("", () => crypto.randomUUID()),
  ));
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileError, setNewFileError] = useState("");
  const [newTitleError, setNewTitleError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [createMode, setCreateMode] = useState<"text" | "pdf">("text");
  const [newClassification, setNewClassification] = useState<KnowledgeClassification>("INTERNAL");
  const [screen, setScreen] = useState<"library" | "create" | "editor" | "document">("library");
  const [libraryTab, setLibraryTab] = useState<"drafts" | "published">("drafts");
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
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseFileButton = useRef<HTMLButtonElement>(null);
  const decisionReason = useRef<HTMLTextAreaElement>(null);

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
        { title: newTitle.trim(), file: newFile, classification: newClassification }, key)
      : await createNewKnowledgeDraft(platform, organizationId,
        { title: newTitle.trim(), body: newBody, classification: newClassification }, key);
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

  const openPublished = (id: string) => void run(async () => {
    const loaded = await loadPublishedKnowledge(platform, organizationId, id);
    setDocument(loaded); setScreen("document");
  });

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
  const filteredDrafts = drafts.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredPublished = published.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const departmentName = (id: string | null) => options?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const submitHint = draft?.hasPendingSubmission ? "This version is awaiting review."
    : dirty ? "Save your changes before submitting."
      : !ready ? "Complete the required governance metadata before submitting."
        : snapshotAlreadySubmitted ? "This version has already been submitted."
          : `Version ${draft?.currentVersion.version ?? 1} is ready to submit.`;
  const chooseFile = (file: File | null) => { setNewFile(file); setNewFileError(file ? validatePdfFile(file) : ""); createRequestKey.current = null; };

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / ${view === "knowledge" ? "Knowledge" : "Review Queue"}`}
      previewLabel="ARDEN SERVER · GOVERNED CONTENT" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="knowledge-feature-page knowledge-live-page">
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {loading ? <div className="knowledge-empty" role="status">Loading governed knowledge…</div> : view === "review-queue" ? <>
        <KnowledgeHeading eyebrow="WORKSPACE / REVIEW QUEUE" title={review ? review.title : "Review Queue"}
          description={review ? undefined : "Submissions assigned to you through reviewer authority. You never review your own work."}

          action={<button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>} />
        {review && <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => setReview(null)}>← Assigned reviews</button>}
        {review ? <div className="knowledge-two-column knowledge-live-review-detail">
          <article className="knowledge-panel knowledge-live-document"><span className="meta-label knowledge-tone-blue">IMMUTABLE SUBMITTED SNAPSHOT</span>
            <h2>{review.title}</h2><div className="knowledge-inline-meta"><KnowledgeBadge classification={review.classification}>{review.classification}</KnowledgeBadge>
              <KnowledgeBadge tone="blue">{departmentName(review.responsibleDepartmentId)}</KnowledgeBadge>
              <KnowledgeBadge tone="amber">{review.targetScopeType}</KnowledgeBadge></div>
            {review.mimeType === "application/pdf" && review.pdfBase64
              ? <PdfDocument base64={review.pdfBase64} title={review.title} />
              : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
                key={`review:${review.id}:${review.snapshotVersionId}`} body={review.body}
                instanceKey={`review:${review.id}:${review.snapshotVersionId}`} /></Suspense>}
            <small>Snapshot hash: {review.contentHash}</small>
          </article>
          <div className="knowledge-live-side"><section className="knowledge-panel knowledge-live-submission"><h2>Submission</h2>
            <dl><div><dt>Submitted by</dt><dd>{review.submittedByMembershipId}</dd></div><div><dt>Submitted</dt><dd>{new Date(review.submittedAt).toLocaleString()}</dd></div>
              <div><dt>Department</dt><dd>{departmentName(review.responsibleDepartmentId)}</dd></div>
              <div><dt>Access scope</dt><dd>{review.targetScopeType === "DEPARTMENT" ? "Responsible department" : "Organization"}</dd></div>
              <div><dt>Audience</dt><dd>{review.audienceIds.map((id) => options?.audiences.find((audience) => audience.id === id)?.name ?? `${id} (inactive)`).join(", ") || "None"}</dd></div>
              <div><dt>Team tag</dt><dd>{review.teamTag || "All teams"}</dd></div><div><dt>Project tag</dt><dd>{review.projectTag || "All projects"}</dd></div>
              <div><dt>Snapshot hash</dt><dd className="knowledge-hash">{review.contentHash}</dd></div></dl></section>
          <aside className="knowledge-panel knowledge-live-decision"><span className="meta-label knowledge-tone-amber">HUMAN DECISION</span>
            <h2>Decision</h2><p>Decide the exact snapshot shown at left. Approval starts publication preparation.</p>
            {reviews.find((item) => item.submissionId === review.id)?.approvalBlocked &&
              <KnowledgeNotice title="Audience no longer enforceable" tone="amber">Approval is blocked. Reject this snapshot; the author can submit a new one.</KnowledgeNotice>}
            <label>Decision reason<textarea ref={decisionReason} rows={4} maxLength={2000} value={comment} disabled={busy} aria-invalid={commentSubmitted && !comment.trim()} aria-describedby="knowledge-decision-help"
              onChange={(event) => setComment(event.target.value)} placeholder="Required for rejection" /></label>
            <small id="knowledge-decision-help" className={commentSubmitted && !comment.trim() ? "field-error" : ""}>{commentSubmitted && !comment.trim() ? "Explain why this snapshot is rejected." : "Shared with the author. Required for rejection."}</small>
            <div className="knowledge-live-actions">
              <button type="button" className="primary-button" disabled={busy || reviews.find((item) => item.submissionId === review.id)?.approvalBlocked} onClick={() => setDecisionToConfirm("APPROVE")}>Approve</button>
              <button type="button" className="admin-text-danger" disabled={busy} onClick={() => { if (requireDecisionReason()) setDecisionToConfirm("REJECT"); }}>Reject submission…</button>
            </div>
          </aside></div>
        </div> : reviews.length ? <div className="knowledge-row-list">{reviews.map((item) =>
          <KnowledgeRow key={item.submissionId} title={item.title}
            details={`${departmentName(item.departmentId)} · ${item.classification} · submitted ${new Date(item.submittedAt).toLocaleString()}`}
            status={item.approvalBlocked ? "Approval blocked" : "Ready to review"} tone={item.approvalBlocked ? "amber" : "blue"}
            onClick={() => openReview(item.submissionId)} />)}</div>
          : <div className="knowledge-empty"><h2>No reviews assigned to you</h2></div>}
      </> : screen === "create" ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" disabled={busy} onClick={() => setScreen("library")}>← Knowledge</button>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Create a shared draft" description="The draft stays yours. Governance metadata and review come after it's saved." />
        <div className="knowledge-two-column"><form className="knowledge-panel knowledge-live-form" onSubmit={(event) => { event.preventDefault(); createDraft(); }}>
          <fieldset className="knowledge-create-source" disabled={busy}><legend>Content source</legend>
            <label className={createMode === "pdf" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "pdf"} onChange={() => { setCreateMode("pdf"); createRequestKey.current = null; }} /><strong>Upload a PDF</strong><small>Kept as the original file</small></label>
            <label className={createMode === "text" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "text"} onChange={() => { setCreateMode("text"); createRequestKey.current = null; }} /><strong>Write document text</strong><small>Arden's formatted editor</small></label>
          </fieldset>
          <label>Title *<input id="knowledge-new-title" maxLength={160} value={newTitle} disabled={busy} aria-invalid={Boolean(newTitleError)} aria-describedby="knowledge-new-title-help" onChange={(event) => { setNewTitle(event.target.value); setNewTitleError(""); createRequestKey.current = null; }} /><small id="knowledge-new-title-help" className={newTitleError ? "field-error" : ""}>{newTitleError || "Up to 160 characters."}</small></label>
          <label>Classification<select value={newClassification} disabled={busy} onChange={(event) => { setNewClassification(event.target.value as KnowledgeClassification); createRequestKey.current = null; }}>
            <option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select><small>You can change it before submitting.</small></label>
          {createMode === "pdf" ? <div className={`knowledge-pdf-choose${dragActive ? " is-drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files[0] ?? null); }}>
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
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setScreen("library"); createRequestKey.current = null; }}>Cancel</button></div>
        </form></div>
      </> : screen === "editor" && draft && editor ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => { setScreen("library"); void refresh(); }}>← Knowledge</button>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title={draft.title}
          action={<button type="button" className="secondary-button" disabled={busy} onClick={() => { setScreen("library"); void refresh(); }}>Back to library</button>} />
        <div className="knowledge-inline-meta"><span className={`knowledge-live-status ${currentDraftStatus?.tone ?? ""}`}>{currentDraftStatus?.label}</span>
          <span>v{draft.currentVersion.version} · {draft.currentVersion.mimeType === "application/pdf" ? "PDF" : "Text"} · {departmentName(draft.responsibleDepartmentId)}</span>
          <KnowledgeBadge classification={draft.classification}>{draft.classification}</KnowledgeBadge>
          {dirty && <span>Unsaved changes</span>}</div>
        {draft.hasPendingSubmission && <KnowledgeNotice title="Waiting for a reviewer" tone="amber">
          A different member needs an active reviewer grant for this department and classification. An Org Admin can assign one if the review queue is empty.
        </KnowledgeNotice>}
        {latest?.status === "REJECTED" && <KnowledgeNotice title="Submission rejected" tone="danger">
          {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
          This version was not published. You may revise the draft and submit a new version.
        </KnowledgeNotice>}
        {latest?.status === "APPROVED" && <KnowledgeNotice title="Approved · preparing publication" tone="jade">The reviewed snapshot is waiting for indexing and atomic activation. It is not searchable yet.</KnowledgeNotice>}
        <div className="knowledge-editor-grid"><section className="knowledge-panel knowledge-live-form">
          <label>Title *<input maxLength={160} disabled={busy} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
          {draft.currentVersion.mimeType === "application/pdf" && draft.pdfBase64
            ? <PdfDocument base64={draft.pdfBase64} title={draft.title} />
            : <div className="arden-document-field"><span>Document text</span>
            <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor
              key={`${draft.id}:${draft.currentVersion.version}`} body={editor.body}
              instanceKey={`${draft.id}:${draft.currentVersion.version}`}
              disabled={busy} onChange={(body) => setEditor({ ...editor, body })} /></Suspense>
          </div>}
        </section><div className="knowledge-live-side"><section className="knowledge-panel knowledge-live-history"><h2>Review history</h2>
          <ol><li><strong>v{draft.currentVersion.version} · {draft.hasPendingSubmission ? "awaiting review" : "working draft"}</strong><small>Updated {new Date(draft.updatedAt).toLocaleDateString()}</small></li>
            {submissions.filter((item) => item.draftId === draft.id).map((item) => <li key={item.id}><strong>{statusLabel(item.status)}</strong><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></li>)}</ol>
        </section><aside className="knowledge-panel knowledge-live-form"><div className="knowledge-live-meta-heading"><h2>Governance metadata</h2><small>* Required to submit</small></div>
          <label>Responsible department *<select disabled={busy} value={editor.responsibleDepartmentId ?? ""} onChange={(event) => {
            const responsibleDepartmentId = event.target.value || null;
            setEditor({ ...editor, responsibleDepartmentId, audienceIds: editor.audienceIds.filter((id) => {
              const audience = options?.audiences.find((item) => item.id === id);
              return audience?.kind === "ORGANIZATION_ALL" || !audience?.departmentId || audience.departmentId === responsibleDepartmentId;
            }) });
          }}>
            <option value="">Choose department</option>{options?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Reviewers are drawn from this department.</small></label>
          <fieldset className="knowledge-option-cards" disabled={busy}><legend>Access scope *</legend>{(["DEPARTMENT", "ORGANIZATION"] as const).map((scope) => <label key={scope} className={editor.targetScopeType === scope ? "is-selected" : ""}><input type="radio" name="knowledge-scope" checked={editor.targetScopeType === scope} onChange={() => setEditor({ ...editor, targetScopeType: scope,
            audienceIds: normalizeAudienceSelection(editor.audienceIds, options?.audiences ?? [], scope) })} /><span><strong>{scope === "DEPARTMENT" ? "Responsible department" : "Organization"}</strong><small>{scope === "DEPARTMENT" ? "Department and eligible group audiences" : "Organization and eligible group audiences"}</small></span></label>)}</fieldset>
          <fieldset className="knowledge-option-cards knowledge-classification-cards" disabled={busy}><legend>Classification *</legend>{(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const).map((classification) => <label key={classification} className={editor.classification === classification ? "is-selected" : ""}><input type="radio" name="knowledge-classification" checked={editor.classification === classification} onChange={() => setEditor({ ...editor, classification })} /><span><strong>{classification[0]}{classification.slice(1).toLowerCase()}</strong></span></label>)}</fieldset>
          <fieldset disabled={busy}><legend>Audience *</legend>

            {!editor.targetScopeType ? <p className="knowledge-field-helper">Choose an access scope to see available audiences.</p> : <div className="knowledge-live-role-list">{availableAudienceOptions(options?.audiences ?? [], editor.targetScopeType).map((audience) => <label key={audience.id}>
              <input type="checkbox" checked={editor.audienceIds.includes(audience.id)} onChange={(event) => setEditor({ ...editor,
                audienceIds: event.target.checked ? [...editor.audienceIds, audience.id] : editor.audienceIds.filter((id) => id !== audience.id) })} />
              <span>{audience.name}{audience.kind === "ORGANIZATION_ALL" ? " · Organization default"
                : audience.kind === "DEPARTMENT_ALL" ? ` · ${departmentName(audience.departmentId ?? "")}` : " · Audience group"}</span></label>)}</div>}
            <small>Only roles available for the selected scope are listed.</small>
          </fieldset>
          <label>Team tag (optional)<input maxLength={100} disabled={busy} value={editor.teamTag ?? ""} onChange={(event) => setEditor({ ...editor, teamTag: event.target.value || null })} /></label>
          <label>Project tag (optional)<input maxLength={100} disabled={busy} value={editor.projectTag ?? ""} onChange={(event) => setEditor({ ...editor, projectTag: event.target.value || null })} /></label>
          <div className="knowledge-readiness" aria-label="Submission readiness"><strong>Ready to submit</strong>
            <span>{editor.title.trim() ? "✓" : "✕"} Title <small>{editor.title.trim() ? "Done" : "Missing"}</small></span>
            <span>{editor.responsibleDepartmentId ? "✓" : "✕"} Responsible department <small>{editor.responsibleDepartmentId ? "Done" : "Missing"}</small></span>
            <span>{editor.targetScopeType ? "✓" : "✕"} Access scope <small>{editor.targetScopeType ? "Done" : "Missing"}</small></span>
            <span>{validAudienceSelection(editor.audienceIds, options?.audiences ?? [], editor.targetScopeType) ? "✓" : "✕"} Audience <small>{validAudienceSelection(editor.audienceIds, options?.audiences ?? [], editor.targetScopeType) ? "Done" : "Missing"}</small></span>
          </div>
        </aside></div></div>
        <div className="knowledge-live-action-bar" role="group" aria-label="Draft actions"><span aria-live="polite">{dirty ? "Unsaved changes · " : ""}{submitHint}</span>
          <div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy || !dirty} onClick={saveDraft}>{busy ? "Working…" : "Save new version"}</button>
            <button type="button" className="primary-button" disabled={busy || draft.hasPendingSubmission || dirty || !ready || snapshotAlreadySubmitted} onClick={submitDraft}>Submit v{draft.currentVersion.version} for review</button></div></div>
      </> : screen === "document" && document ? <>
        <KnowledgeHeading eyebrow="WORKSPACE / PUBLISHED KNOWLEDGE" title={document.title}
          action={<button type="button" className="secondary-button" onClick={() => setScreen("library")}>Back to library</button>} />
        <div className="knowledge-inline-meta"><KnowledgeBadge tone="jade">Published</KnowledgeBadge><KnowledgeBadge classification={document.classification}>{document.classification}</KnowledgeBadge>
          <span>Published {new Date(document.publishedAt).toLocaleString()}</span></div>
        <div className="knowledge-two-column knowledge-live-published"><article className="knowledge-panel knowledge-live-document">
          {document.mimeType === "application/pdf" && document.pdfBase64
            ? <PdfDocument base64={document.pdfBase64} title={document.title} />
            : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
              key={`published:${document.id}:${document.contentHash}`} body={document.body ?? ""}
              instanceKey={`published:${document.id}:${document.contentHash}`} /></Suspense>}
        </article><aside className="knowledge-panel knowledge-live-submission"><h2>Publication</h2><dl>
          <div><dt>Published</dt><dd>{new Date(document.publishedAt).toLocaleString()}</dd></div>
          <div><dt>Valid from</dt><dd>{new Date(document.validFrom).toLocaleString()}</dd></div>
          <div><dt>Valid until</dt><dd>{document.validUntil ? new Date(document.validUntil).toLocaleString() : "No end date"}</dd></div>
          <div><dt>Audience</dt><dd>{document.audienceIds.map((id) => options?.audiences.find((audience) => audience.id === id)?.name ?? `${id} (inactive)`).join(", ") || "None"}</dd></div>
          <div><dt>Content hash</dt><dd className="knowledge-hash">{document.contentHash}</dd></div>
        </dl></aside></div>
      </> : <>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Knowledge" description="Drafts you own and the versions published to you."
          action={<div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
            <button type="button" className="primary-button" onClick={() => setScreen("create")}>Create draft</button></div>} />
        <div className="knowledge-live-library-controls"><div role="tablist" aria-label="Knowledge library"><button type="button" role="tab" aria-selected={libraryTab === "drafts"} className={libraryTab === "drafts" ? "is-active" : ""} onClick={() => setLibraryTab("drafts")}>My drafts <span>{drafts.length}</span></button>
          <button type="button" role="tab" aria-selected={libraryTab === "published"} className={libraryTab === "published" ? "is-active" : ""} onClick={() => setLibraryTab("published")}>Published for me <span>{published.length}</span></button></div>
          <SearchField value={query} onChange={setQuery} placeholder="Filter titles…" /></div>
        {libraryTab === "drafts" && (filteredDrafts.length ? <div className="knowledge-live-library-list" aria-label="My drafts">{filteredDrafts.map((item) => {
          const status = draftStatus(item, latestByDraft.get(item.id));
          return <button type="button" key={item.id} className="knowledge-live-library-row" onClick={() => openDraft(item.id)} aria-label={`Open ${item.title}`}>
            <span className="knowledge-live-file-kind" aria-hidden="true">{item.mimeType === "application/pdf" ? "PDF" : "TXT"}</span>
            <span className="knowledge-live-row-title"><strong>{item.title}</strong><small>v{item.currentVersion} · updated {new Date(item.updatedAt).toLocaleDateString()}</small></span>
            <span className="knowledge-live-classification" data-classification={item.classification}>{item.classification}</span><span>{departmentName(item.responsibleDepartmentId)}</span>
            <span className={`knowledge-live-status ${status.tone}`}>{status.label}</span>
          </button>;
        })}</div> : <div className="knowledge-empty"><h2>{drafts.length ? "No matching drafts" : "No drafts found"}</h2><p>{drafts.length ? "Try another title." : "Create a draft by writing text or uploading a PDF. It stays yours until you submit a version for review."}</p><button type="button" className="secondary-button" onClick={() => setScreen("create")}>Create draft</button></div>)}
        {libraryTab === "published" && (filteredPublished.length ? <div className="knowledge-live-library-list" aria-label="Published for me">{filteredPublished.map((item) =>
          <button type="button" className="knowledge-live-library-row" key={item.id} onClick={() => openPublished(item.id)} aria-label={`Read ${item.title}`}>
            <span className="knowledge-live-file-kind" aria-hidden="true">{item.mimeType === "application/pdf" ? "PDF" : "TXT"}</span>
            <span className="knowledge-live-row-title"><strong>{item.title}</strong><small>Published {new Date(item.publishedAt).toLocaleDateString()}</small></span>
            <span className="knowledge-live-classification" data-classification={item.classification}>{item.classification}</span><span>Approved snapshot</span><span className="knowledge-live-status is-success">Published</span>
          </button>)}</div>
          : <div className="knowledge-empty"><h2>{published.length ? "No matching publications" : "No accessible publication"}</h2></div>)}
      </>}
    </div>
    {decisionToConfirm && review && <KnowledgeDialog confirmation title={decisionToConfirm === "APPROVE" ? `Approve ${review.title}?` : `Reject ${review.title}?`}
      onClose={() => setDecisionToConfirm(null)} dismissible={!busy}>
      <p>{decisionToConfirm === "APPROVE" ? "The server will prepare this exact reviewed snapshot for indexing. It will not be searchable until atomic activation succeeds." : "The author may revise and submit a new version. Nothing will be published."}</p>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      <div className="knowledge-live-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
        <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button" : "primary-button"} disabled={busy} onClick={() => decide(decisionToConfirm)}>{busy ? "Working…" : decisionToConfirm === "APPROVE" ? "Approve for preparation" : "Reject submission"}</button></div>
    </KnowledgeDialog>}
    <ActionToast message={message} onDismiss={() => setMessage("")} />
  </main>;
}
