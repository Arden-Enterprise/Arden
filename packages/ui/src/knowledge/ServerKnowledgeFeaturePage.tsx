import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { SearchField } from "../shared/SearchField";
import { KnowledgeHeading, KnowledgeNotice } from "./KnowledgePrimitives";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
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
  const [newBody, setNewBody] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileError, setNewFileError] = useState("");
  const [newTitleError, setNewTitleError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [createMode, setCreateMode] = useState<"text" | "pdf">("text");
  const [newClassification, setNewClassification] = useState<KnowledgeClassification>("INTERNAL");
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
  const decisionRequest = useRef<{ action: "APPROVE" | "REQUEST_REVISION" | "REJECT"; key: string } | null>(null);
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
    setNewTitle(""); setNewBody(""); setNewFile(null); setNewFileError(""); setNewTitleError("");
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
  const decide = (action: "APPROVE" | "REQUEST_REVISION" | "REJECT") => void run(async () => {
    if (!review) return;
    const existing = decisionRequest.current;
    const key = existing?.action === action ? existing.key : crypto.randomUUID();
    decisionRequest.current = { action, key };
    const result = await decideKnowledgeReview(platform, organizationId, review, action, comment.trim() || null, key);
    decisionRequest.current = null; setReview(null); setDecisionToConfirm(null);
    await refresh();
    setMessage(result.status === "APPROVED"
      ? "Approved. The system published the exact reviewed snapshot and recorded the decision."
      : result.status === "CHANGES_REQUESTED"
        ? "Revision requested. The author can now edit and resubmit a new version."
        : "Submission rejected. Nothing was published.");
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

  const audienceNames = (ids: string[]) => ids.map((id) => options?.audiences.find((audience) => audience.id === id)?.name ?? "Inactive audience").join(", ") || "None";
  const selectedContribution = drafts.find((item) => item.id === selectedContributionId) ?? null;
  const selectedContributionLatest = selectedContribution ? latestByDraft.get(selectedContribution.id) : undefined;
  const activeReview = review ? reviews.find((item) => item.submissionId === review.id) : undefined;
  const openCreate = (mode: "text" | "pdf") => { setCreateMode(mode); createRequestKey.current = null; setScreen("create"); };
  const librarySearch = view === "knowledge" && screen === "library"
    ? <SearchField value={query} onChange={setQuery} placeholder={libraryTab === "drafts" ? "Filter my contributions…" : "Filter publications…"} /> : undefined;
  const breadcrumb = view === "review-queue" ? `${organizationName} / Knowledge / Reviews`
    : screen === "library" ? `${organizationName} / Knowledge / ${libraryTab === "drafts" ? "My Contributions" : "Library"}`
      : screen === "create" ? `${organizationName} / Knowledge / New draft`
        : `${organizationName} / Knowledge / ${screen === "document" ? document?.title ?? "Publication" : draft?.title ?? "Draft"}`;

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={breadcrumb} previewLabel="ARDEN SERVER · GOVERNED CONTENT" contextOpen={contextOpen} onToggleContext={onToggleContext}
      search={librarySearch} searchActive={Boolean(librarySearch && query)} />
    <div className="knowledge-feature-page knowledge-live-page">
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {loading ? <div className="island island-empty" role="status">Loading governed knowledge…</div> : view === "review-queue" ? <div className="review-workspace">
        <section className="review-queue" aria-labelledby="review-queue-title">
          <div className="review-queue-heading"><h1 id="review-queue-title">Review queue</h1><span className="island-badge">{reviews.length}</span>
            <button type="button" className="island-link-button" disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
          <p className="island-meta">Submissions your grants cover. Your own are never listed.</p>
          {reviews.length ? <div className="review-queue-list">{reviews.map((item) => <button type="button" key={item.submissionId} className="review-queue-item"
            aria-current={review?.id === item.submissionId ? "true" : undefined} onClick={() => openReview(item.submissionId)}>
            <strong>{item.title}</strong>
            <span className="island-meta">{departmentName(item.departmentId)} · submitted {new Date(item.submittedAt).toLocaleDateString()}</span>
            <span className="island-chip-row"><KnowledgeClassificationChip classification={item.classification} />
              {item.approvalBlocked && <span className="island-chip tone-warning">Approval blocked</span>}</span>
          </button>)}</div> : <div className="island-empty review-queue-empty"><h3>Queue is clear</h3><p>New submissions in your granted departments appear here.</p></div>}
        </section>
        <article className="island review-submission" aria-label="Submission">
          {review ? <>
            <header className="review-submission-header">
              <div><span className="island-meta">Submitted {new Date(review.submittedAt).toLocaleString()}</span>
                <h2>{review.title}</h2></div>
              <button type="button" className="island-icon-button" onClick={() => setReview(null)} aria-label="Close submission"><Icon name="close" size={14} /></button>
            </header>
            <dl className="review-frozen" aria-label="Frozen submission details">
              <div><dt>CLASSIFICATION</dt><dd><KnowledgeClassificationChip classification={review.classification} /></dd></div>
              <div><dt>DEPARTMENT</dt><dd>{departmentName(review.responsibleDepartmentId)}</dd></div>
              <div><dt>ACCESS SCOPE</dt><dd>{review.targetScopeType === "DEPARTMENT" ? "Responsible department" : "Organization"}</dd></div>
              <div><dt>AUDIENCE</dt><dd>{audienceNames(review.audienceIds)}</dd></div>
              <div><dt>TEAM / PROJECT</dt><dd>{review.teamTag || "All teams"} · {review.projectTag || "All projects"}</dd></div>
              <div><dt>SNAPSHOT</dt><dd className="knowledge-hash">{review.contentHash}</dd></div>
            </dl>
            {activeReview?.approvalBlocked && <p className="island-note is-warning" role="note"><Icon name="warning" size={16} /><span><strong>Approval is blocked.</strong> An audience on this snapshot can no longer be enforced. You can still request a revision or reject.</span></p>}
            <div className="review-document">
              {review.mimeType === "application/pdf" && review.pdfBase64
                ? <PdfDocument base64={review.pdfBase64} title={review.title} />
                : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
                  key={`review:${review.id}:${review.snapshotVersionId}`} body={review.body}
                  instanceKey={`review:${review.id}:${review.snapshotVersionId}`} /></Suspense>}
            </div>
            <div className="review-decision-bar" role="group" aria-label="Review decision">
              <label className="island-field"><span>Decision reason · required to request revision or reject, shared with the author</span>
                <textarea ref={decisionReason} rows={3} maxLength={2000} value={comment} disabled={busy} aria-invalid={commentSubmitted && !comment.trim()} aria-describedby="knowledge-decision-help"
                  onChange={(event) => setComment(event.target.value)} placeholder="Explain what needs to change" /></label>
              <div className="review-decision-actions">
                <small id="knowledge-decision-help" className={commentSubmitted && !comment.trim() ? "field-error" : "island-meta"}>{commentSubmitted && !comment.trim() ? "Explain the requested changes or rejection before deciding." : "Approval publishes this exact snapshot automatically."}</small>
                <button type="button" className="secondary-button is-danger" disabled={busy} onClick={() => { if (requireDecisionReason()) setDecisionToConfirm("REJECT"); }}>Reject…</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (requireDecisionReason()) decide("REQUEST_REVISION"); }}>Request revision</button>
                <button type="button" className="primary-button" disabled={busy || activeReview?.approvalBlocked} onClick={() => setDecisionToConfirm("APPROVE")}><Icon name="check" size={14} />Approve &amp; publish</button>
              </div>
            </div>
          </> : <div className="island-empty review-submission-empty"><span className="island-tile" aria-hidden="true"><Icon name="review" size={16} /></span>
            <h3>{reviews.length ? "Select a submission" : "Nothing left to review"}</h3>
            <p>{reviews.length ? "You decide the exact snapshot the author submitted. Approval publishes it automatically." : "Approved versions were published automatically."}</p></div>}
        </article>
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
            <label className="island-field">Classification<select value={newClassification} disabled={busy} onChange={(event) => { setNewClassification(event.target.value as KnowledgeClassification); createRequestKey.current = null; }}>
              <option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select><small>You can change it before submitting.</small></label>
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
            {latest?.status === "CHANGES_REQUESTED" && <KnowledgeNotice title="Revision requested" tone="amber">
              {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
              Edit and save a new version, then resubmit. The earlier submitted snapshot is unchanged.
            </KnowledgeNotice>}
            {latest?.status === "REJECTED" && <KnowledgeNotice title="Submission rejected" tone="danger">
              {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
              This version was not published. You may revise the draft and submit a new version.
            </KnowledgeNotice>}
            {latest?.status === "APPROVED" && <KnowledgeNotice title="Approved and published" tone="jade">The system published the reviewed snapshot. A new edit requires a new submission before it can replace that publication.</KnowledgeNotice>}
            <div className="draft-document-body knowledge-live-form">
              <label className="draft-title-field"><span className="sr-only">Title</span><input maxLength={160} disabled={busy || draft.hasPendingSubmission} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
              {draft.currentVersion.mimeType === "application/pdf" && draft.pdfBase64
                ? <PdfDocument base64={draft.pdfBase64} title={draft.title} />
                : <div className="arden-document-field"><span className="sr-only">Document text</span>
                <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor
                  key={`${draft.id}:${draft.currentVersion.version}`} body={editor.body}
                  instanceKey={`${draft.id}:${draft.currentVersion.version}`}
                  disabled={busy || draft.hasPendingSubmission} onChange={(body) => setEditor({ ...editor, body })} /></Suspense>
              </div>}
            </div>
          </article>
          <aside className="island island-panel draft-metadata knowledge-live-form" aria-labelledby="draft-metadata-title">
            <h2 id="draft-metadata-title">Before you submit</h2>
            <label className="island-field">Responsible department<select disabled={busy || draft.hasPendingSubmission} value={editor.responsibleDepartmentId ?? ""} onChange={(event) => {
              const responsibleDepartmentId = event.target.value || null;
              setEditor({ ...editor, responsibleDepartmentId, audienceIds: editor.audienceIds.filter((id) => {
                const audience = options?.audiences.find((item) => item.id === id);
                return audience?.kind === "ORGANIZATION_ALL" || !audience?.departmentId || audience.departmentId === responsibleDepartmentId;
              }) });
            }}>
              <option value="">Choose department</option>{options?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Reviewers are drawn from this department.</small></label>
            <fieldset className="island-option-group" disabled={busy || draft.hasPendingSubmission}><legend>Publication scope</legend>{(["DEPARTMENT", "ORGANIZATION"] as const).map((scope) => <label key={scope} className={editor.targetScopeType === scope ? "is-selected" : ""}><input type="radio" name="knowledge-scope" checked={editor.targetScopeType === scope} onChange={() => setEditor({ ...editor, targetScopeType: scope,
              audienceIds: normalizeAudienceSelection(editor.audienceIds, options?.audiences ?? [], scope) })} /><span><strong>{scope === "DEPARTMENT" ? "Responsible department" : "Organization"}</strong><small>{scope === "DEPARTMENT" ? "Department and eligible group audiences" : "Organization and eligible group audiences"}</small></span></label>)}</fieldset>
            <fieldset className="island-option-group is-inline" disabled={busy || draft.hasPendingSubmission}><legend>Classification</legend>{(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const).map((classification) => <label key={classification} className={editor.classification === classification ? "is-selected" : ""}><input type="radio" name="knowledge-classification" checked={editor.classification === classification} onChange={() => setEditor({ ...editor, classification })} /><span><strong>{classification}</strong></span></label>)}</fieldset>
            <fieldset className="island-option-group" disabled={busy || draft.hasPendingSubmission}><legend>Audience</legend>
              {!editor.targetScopeType ? <p className="island-meta">Choose a publication scope to see available audiences.</p> : <div className="draft-audience-list">{availableAudienceOptions(options?.audiences ?? [], editor.targetScopeType).map((audience) => <label key={audience.id} className="draft-audience">
                <input type="checkbox" checked={editor.audienceIds.includes(audience.id)} onChange={(event) => setEditor({ ...editor,
                  audienceIds: event.target.checked ? [...editor.audienceIds, audience.id] : editor.audienceIds.filter((id) => id !== audience.id) })} />
                <span>{audience.name}<small>{audience.kind === "ORGANIZATION_ALL" ? "Organization default"
                  : audience.kind === "DEPARTMENT_ALL" ? departmentName(audience.departmentId ?? "") : "Audience group"}</small></span></label>)}</div>}
              <small className="island-meta">Only audiences available for the selected scope are listed.</small>
            </fieldset>
            <div className="admin-grant-tags">
              <label className="island-field">Team tag<input maxLength={100} placeholder="Optional" disabled={busy || draft.hasPendingSubmission} value={editor.teamTag ?? ""} onChange={(event) => setEditor({ ...editor, teamTag: event.target.value || null })} /></label>
              <label className="island-field">Project tag<input maxLength={100} placeholder="Optional" disabled={busy || draft.hasPendingSubmission} value={editor.projectTag ?? ""} onChange={(event) => setEditor({ ...editor, projectTag: event.target.value || null })} /></label>
            </div>
            <ul className="draft-readiness" aria-label="Submission readiness">
              {([["Title", Boolean(editor.title.trim())], ["Responsible department", Boolean(editor.responsibleDepartmentId)], ["Publication scope", Boolean(editor.targetScopeType)],
                ["Audience", validAudienceSelection(editor.audienceIds, options?.audiences ?? [], editor.targetScopeType)]] as const).map(([label, done]) =>
                <li key={label} className={done ? "is-done" : ""}><Icon name={done ? "check" : "close"} size={12} />{label}<small>{done ? "Done" : "Missing"}</small></li>)}
            </ul>
            {editor.classification === "RESTRICTED" && <p className="island-box">RESTRICTED needs a Specialist or Senior reviewer in the responsible department. Approval publishes this exact version automatically.</p>}
            <div className="draft-actions" role="group" aria-label="Draft actions">
              <button type="button" className="secondary-button" disabled={busy || draft.hasPendingSubmission || !dirty} onClick={saveDraft}>{busy ? "Working…" : "Save version"}</button>
              <button type="button" className="primary-button" disabled={busy || draft.hasPendingSubmission || dirty || !ready || snapshotAlreadySubmitted} onClick={submitDraft}>Submit v{draft.currentVersion.version} for review</button>
              <span className="island-meta" aria-live="polite">{dirty ? "Unsaved changes · " : ""}{submitHint}</span>
            </div>
            <section className="island-detail-section" aria-label="Review history"><h3>History</h3>
              <ol className="island-timeline"><li><strong>v{draft.currentVersion.version} · {draft.hasPendingSubmission ? "awaiting review" : "working draft"}</strong><small>Updated {new Date(draft.updatedAt).toLocaleDateString()}</small></li>
                {submissions.filter((item) => item.draftId === draft.id).map((item) => <li key={item.id}><strong>{statusLabel(item.status)}</strong><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></li>)}</ol>
            </section>
          </aside>
        </div>
      </> : screen === "document" && document ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => setScreen("library")}>← Library</button>
        <div className="draft-workspace">
          <article className="island draft-document" aria-label={document.title}>
            <div className="draft-document-toolbar"><span className="island-chip has-dot tone-success">Published</span><KnowledgeClassificationChip classification={document.classification} />
              <span className="island-meta">Published {new Date(document.publishedAt).toLocaleString()}</span></div>
            <div className="draft-document-body"><h1 className="draft-document-title">{document.title}</h1>
              {document.mimeType === "application/pdf" && document.pdfBase64
                ? <PdfDocument base64={document.pdfBase64} title={document.title} />
                : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
                  key={`published:${document.id}:${document.contentHash}`} body={document.body ?? ""}
                  instanceKey={`published:${document.id}:${document.contentHash}`} /></Suspense>}</div>
          </article>
          <aside className="island island-panel draft-metadata" aria-labelledby="publication-title"><h2 id="publication-title">Publication</h2>
            <dl className="island-kv">
              <dt>Published</dt><dd>{new Date(document.publishedAt).toLocaleString()}</dd>
              <dt>Valid from</dt><dd>{new Date(document.validFrom).toLocaleString()}</dd>
              <dt>Valid until</dt><dd>{document.validUntil ? new Date(document.validUntil).toLocaleString() : "No end date"}</dd>
              <dt>Audience</dt><dd>{audienceNames(document.audienceIds)}</dd>
              <dt>Content hash</dt><dd className="knowledge-hash">{document.contentHash}</dd>
            </dl>
            <p className="island-meta">This is the exact snapshot a reviewer approved. Shown only because your current audiences allow it.</p>
          </aside>
        </div>
      </> : <>
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
        {query.trim() && <p className="island-meta" role="status">Filtering titles for “{query.trim()}”.</p>}
        {libraryTab === "published" && (filteredPublished.length ? <div className="knowledge-card-grid" aria-label="Published for me">{filteredPublished.map((item) =>
          <button type="button" className="island knowledge-card" key={item.id} onClick={() => openPublished(item.id)} aria-label={`Read ${item.title}`}>
            <span className="island-chip-row"><KnowledgeClassificationChip classification={item.classification} /><span className="island-meta">{item.mimeType === "application/pdf" ? "PDF" : "Text"}</span></span>
            <strong>{item.title}</strong>
            <span className="knowledge-card-footer"><span className="island-meta">{audienceNames(item.audienceIds)}</span><span className="island-meta">{new Date(item.publishedAt).toLocaleDateString()}</span></span>
          </button>)}</div>
          : <div className="island island-empty"><h3>{published.length ? "No matching publications" : "No accessible publication"}</h3><p>{published.length ? "Try another title." : "Approved knowledge appears here when one of your audiences may read it."}</p></div>)}
        {libraryTab === "drafts" && (filteredDrafts.length ? <div className="island-split">
          <div className="island-main"><IslandTable label="My contributions" minWidth={620} columns="minmax(240px, 1.8fr) minmax(110px, 1fr) 110px minmax(150px, auto)"
            headers={["DOCUMENT", "DEPARTMENT", "UPDATED", "STATUS"]}>
            {filteredDrafts.map((item) => {
              const status = draftStatus(item, latestByDraft.get(item.id));
              return <IslandRow key={item.id} selected={selectedContributionId === item.id}>
                <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name" onClick={() => setSelectedContributionId(item.id)} aria-label={`Open details for ${item.title}`}>
                  <span><strong>{item.title} <span className="island-version">· v{item.currentVersion}</span></strong><small>{item.classification} · {item.mimeType === "application/pdf" ? "PDF" : "Text"}</small></span></button></IslandCell>
                <IslandCell>{departmentName(item.responsibleDepartmentId)}</IslandCell>
                <IslandCell className="island-row-cell is-number">{new Date(item.updatedAt).toLocaleDateString()}</IslandCell>
                <IslandCell><span className={`island-chip has-dot ${chipTone(status.tone)}`}>{status.label}</span></IslandCell>
              </IslandRow>;
            })}
          </IslandTable></div>
          {selectedContribution && <aside className="island island-panel island-side" aria-labelledby="contribution-title">
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
    {decisionToConfirm && review && <KnowledgeDialog confirmation title={decisionToConfirm === "APPROVE" ? `Approve and publish ${review.title}?` : `Reject ${review.title}?`}
      onClose={() => setDecisionToConfirm(null)} dismissible={!busy}>
      <p>{decisionToConfirm === "APPROVE" ? "The server will publish this exact reviewed snapshot if approval succeeds." : "The author will need to revise and submit a new version. Nothing will be published."}</p>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      <div className="knowledge-live-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
        <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button" : "primary-button"} disabled={busy} onClick={() => decide(decisionToConfirm)}>{busy ? "Working…" : decisionToConfirm === "APPROVE" ? "Approve and publish" : "Reject submission"}</button></div>
    </KnowledgeDialog>}
    <ActionToast message={message} onDismiss={() => setMessage("")} />
  </main>;
}

const statusChipTone: Record<string, string> = { "is-info": "tone-info", "is-success": "tone-success", "is-danger": "tone-danger", "is-attention": "tone-warning" };
function chipTone(tone: string): string { return statusChipTone[tone] ?? ""; }

const classificationChipTone: Record<KnowledgeClassification, string> = { INTERNAL: "tone-strong", CONFIDENTIAL: "tone-info", RESTRICTED: "tone-danger" };
function KnowledgeClassificationChip({ classification }: { classification: KnowledgeClassification }) {
  return <span className={`island-chip ${classificationChipTone[classification]}`}>{classification === "RESTRICTED" && <Icon name="lock" size={11} />}{classification}</span>;
}
