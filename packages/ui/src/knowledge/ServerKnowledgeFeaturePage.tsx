import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
};

type EditorValues = Pick<KnowledgeDraftRecord, "title" | "body" | "classification" | "responsibleDepartmentId" |
  "targetScopeType" | "teamTag" | "projectTag" | "audienceRoleIds">;

function valuesFromDraft(draft: KnowledgeDraftRecord): EditorValues {
  return {
    title: draft.title, body: draft.body, classification: draft.classification,
    responsibleDepartmentId: draft.responsibleDepartmentId,
    targetScopeType: draft.targetScopeType, teamTag: draft.teamTag,
    projectTag: draft.projectTag, audienceRoleIds: [...draft.audienceRoleIds],
  };
}

function statusLabel(status: KnowledgeSubmission["status"]): string {
  return ({ PENDING_REVIEW: "Awaiting review", APPROVED: "Approved", REJECTED: "Rejected",
    CHANGES_REQUESTED: "Revision requested", WITHDRAWN: "Withdrawn" })[status];
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The server request failed. Refresh and try again.";
}

export function ServerKnowledgeFeaturePage({ platform, organizationId, organizationName,
  view, active, createdDraftId, contextOpen, onToggleContext }: Props) {
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
  const [decisionToConfirm, setDecisionToConfirm] = useState<"APPROVE" | "REJECT" | null>(null);
  const createRequestKey = useRef<string | null>(null);
  const submitRequestKey = useRef<string | null>(null);
  const decisionRequest = useRef<{ action: "APPROVE" | "REQUEST_REVISION" | "REJECT"; key: string } | null>(null);
  const openedCreatedDraftId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const [nextDrafts, nextSubmissions, nextPublished, nextReviews, nextOptions] = await Promise.all([
      listKnowledgeDrafts(platform, organizationId), listKnowledgeSubmissions(platform, organizationId),
      listPublishedKnowledge(platform, organizationId), listAssignedKnowledgeReviews(platform, organizationId),
      loadKnowledgeOptions(platform, organizationId),
    ]);
    setDrafts(nextDrafts); setSubmissions(nextSubmissions); setPublished(nextPublished);
    setReviews(nextReviews); setOptions(nextOptions);
  }, [platform, organizationId]);

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
    if (!newTitle.trim()) { setError("Enter a title for this draft."); return; }
    const key = createRequestKey.current ?? crypto.randomUUID();
    createRequestKey.current = key;
    if (createMode === "pdf" && !newFile) { setError("Choose a PDF file from your computer."); return; }
    const created = createMode === "pdf" && newFile
      ? await createPdfKnowledgeDraft(platform, organizationId,
        { title: newTitle.trim(), file: newFile, classification: newClassification }, key)
      : await createNewKnowledgeDraft(platform, organizationId,
        { title: newTitle.trim(), body: newBody, classification: newClassification }, key);
    createRequestKey.current = null;
    setDraft(created); setEditor(valuesFromDraft(created)); setScreen("editor");
    setNewTitle(""); setNewBody(""); setNewFile(null);
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
    setReview(loaded); setComment(""); decisionRequest.current = null;
  });

  const decide = (action: "APPROVE" | "REQUEST_REVISION" | "REJECT") => void run(async () => {
    if (!review) return;
    if (action !== "APPROVE" && !comment.trim()) { setError("Explain the requested changes or rejection before deciding."); return; }
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
  for (const submission of submissions) if (!latestByDraft.has(submission.draftId)) latestByDraft.set(submission.draftId, submission);
  const dirty = Boolean(draft && editor && JSON.stringify(editor) !== JSON.stringify(valuesFromDraft(draft)));
  const latest = draft ? latestByDraft.get(draft.id) : undefined;
  const snapshotAlreadySubmitted = Boolean(latest && draft && latest.snapshotVersionId === draft.currentVersion.id);
  const ready = Boolean(editor?.responsibleDepartmentId && editor.targetScopeType
    && validAudienceSelection(editor.audienceRoleIds, options?.audienceRoles ?? [], editor.targetScopeType));
  const filteredDrafts = drafts.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredPublished = published.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  const departmentName = (id: string | null) => options?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const submitHint = draft?.hasPendingSubmission ? "This version is awaiting review."
    : dirty ? "Save your changes before submitting."
      : !ready ? "Complete the required governance metadata before submitting."
        : snapshotAlreadySubmitted ? "This version has already been submitted."
          : `Version ${draft?.currentVersion.version ?? 1} is ready to submit.`;

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / ${view === "knowledge" ? "Knowledge" : "Review Queue"}`}
      previewLabel="ARDEN SERVER · GOVERNED CONTENT" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="knowledge-feature-page knowledge-live-page">
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {message && <p role="status" className="knowledge-action-message">{message}</p>}
      {loading ? <div className="knowledge-empty" role="status">Loading governed knowledge…</div> : view === "review-queue" ? <>
        <KnowledgeHeading eyebrow="WORKSPACE / REVIEW QUEUE" title={review ? "Review submitted version" : "Review Queue"}
          description={review ? undefined : "Submissions assigned to you by active reviewer authority."}

          action={<button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>} />
        {review && <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => setReview(null)}>← Assigned reviews</button>}
        {review ? <div className="knowledge-two-column knowledge-live-review-detail">
          <article className="knowledge-panel knowledge-live-document"><span className="meta-label knowledge-tone-blue">IMMUTABLE SUBMITTED SNAPSHOT</span>
            <h2>{review.title}</h2><div className="knowledge-inline-meta"><KnowledgeBadge>{review.classification}</KnowledgeBadge>
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
            <dl><div><dt>Submitted</dt><dd>{new Date(review.submittedAt).toLocaleString()}</dd></div>
              <div><dt>Department</dt><dd>{departmentName(review.responsibleDepartmentId)}</dd></div>
              <div><dt>Audience</dt><dd>{review.targetScopeType === "DEPARTMENT" ? "Responsible department" : "Organization"}</dd></div>
              <div><dt>Team / project</dt><dd>{review.teamTag || "All teams"} · {review.projectTag || "all projects"}</dd></div></dl></section>
          <aside className="knowledge-panel knowledge-live-decision"><span className="meta-label knowledge-tone-amber">HUMAN DECISION</span>
            <h2>Decision</h2><p>Decide the exact snapshot shown at left. Approval automatically publishes it.</p>
            {reviews.find((item) => item.submissionId === review.id)?.approvalBlocked &&
              <KnowledgeNotice title="Audience no longer enforceable" tone="amber">Approval is blocked until the author creates a new valid snapshot. You may request revision or reject.</KnowledgeNotice>}
            <label>Decision reason<textarea rows={4} maxLength={2000} value={comment} disabled={busy}
              onChange={(event) => setComment(event.target.value)} placeholder="Required for revision or rejection" /></label>
            <div className="knowledge-live-actions">
              <button type="button" className="primary-button" disabled={busy || reviews.find((item) => item.submissionId === review.id)?.approvalBlocked} onClick={() => setDecisionToConfirm("APPROVE")}>Approve &amp; auto-publish</button>
              <button type="button" className="secondary-button" disabled={busy || !comment.trim()} onClick={() => decide("REQUEST_REVISION")}>Request revision</button>
              <button type="button" className="secondary-button" disabled={busy || !comment.trim()} onClick={() => setDecisionToConfirm("REJECT")}>Reject</button>
            </div>
          </aside></div>
        </div> : reviews.length ? <div className="knowledge-row-list">{reviews.map((item) =>
          <KnowledgeRow key={item.submissionId} title={item.title}
            details={`${departmentName(item.departmentId)} · ${item.classification} · submitted ${new Date(item.submittedAt).toLocaleString()}`}
            status={item.approvalBlocked ? "Review · approval blocked" : "Review"} tone="amber"
            onClick={() => openReview(item.submissionId)} />)}</div>
          : <div className="knowledge-empty"><h2>No assigned reviews</h2></div>}
      </> : screen === "create" ? <>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Create a shared draft"  />
        <div className="knowledge-two-column"><form className="knowledge-panel knowledge-live-form" onSubmit={(event) => { event.preventDefault(); createDraft(); }}>
          <fieldset className="knowledge-create-source" disabled={busy}><legend>Content source</legend>
            <label><input type="radio" name="knowledge-create-mode" checked={createMode === "text"} onChange={() => { setCreateMode("text"); createRequestKey.current = null; }} /> Write document text</label>
            <label><input type="radio" name="knowledge-create-mode" checked={createMode === "pdf"} onChange={() => { setCreateMode("pdf"); createRequestKey.current = null; }} /> Upload PDF from this computer</label>
          </fieldset>
          <label>Title<input required maxLength={160} value={newTitle} disabled={busy} onChange={(event) => { setNewTitle(event.target.value); createRequestKey.current = null; }} /></label>
          <label>Classification<select value={newClassification} disabled={busy} onChange={(event) => { setNewClassification(event.target.value as KnowledgeClassification); createRequestKey.current = null; }}>
            <option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select></label>
          {createMode === "pdf" ? <label>PDF file (up to 5 MB)
            <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => {
              setNewFile(event.target.files?.[0] ?? null); createRequestKey.current = null;
            }} />
            <small>The original PDF is kept for review and download. It will not be converted into editable text.</small>
          </label> : <div className="arden-document-field"><span>Document text</span>
            <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor key="new-shared-knowledge"
              body={newBody} instanceKey="new-shared-knowledge" disabled={busy} onChange={(body) => { setNewBody(body); createRequestKey.current = null; }} /></Suspense>
          </div>}
          <div className="knowledge-live-actions"><button type="submit" className="primary-button" disabled={busy || !newTitle.trim()}>Save new draft</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setScreen("library"); createRequestKey.current = null; }}>Cancel</button></div>
        </form></div>
      </> : screen === "editor" && draft && editor ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" onClick={() => { setScreen("library"); void refresh(); }}>← Knowledge</button>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title={draft.title}
          action={<button type="button" className="secondary-button" disabled={busy} onClick={() => { setScreen("library"); void refresh(); }}>Back to library</button>} />
        <div className="knowledge-inline-meta"><KnowledgeBadge tone={draft.hasPendingSubmission ? "amber" : "blue"}>{draft.hasPendingSubmission ? "Awaiting review" : "Working draft"}</KnowledgeBadge>
          <KnowledgeBadge>{draft.classification}</KnowledgeBadge>{latest && <KnowledgeBadge tone={latest.status === "APPROVED" ? "jade" : "amber"}>{statusLabel(latest.status)}</KnowledgeBadge>}
          {dirty && <span>Unsaved changes</span>}</div>
        {draft.hasPendingSubmission && <KnowledgeNotice title="Waiting for a reviewer" tone="amber">
          A different member needs an active reviewer grant for this department and classification. An Org Admin can assign one if the review queue is empty.
        </KnowledgeNotice>}
        {latest?.status === "CHANGES_REQUESTED" && <KnowledgeNotice title="Revision requested" tone="amber">
          {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
          Edit and save a new version, then resubmit. The earlier submitted snapshot is unchanged.
        </KnowledgeNotice>}
        {latest?.status === "REJECTED" && <KnowledgeNotice title="Submission rejected" tone="amber">
          {latest.decisionComment && <>Reviewer: {latest.decisionComment}<br /></>}
          This version was not published. You may revise the draft and submit a new version.
        </KnowledgeNotice>}
        {latest?.status === "APPROVED" && <KnowledgeNotice title="Approved and published" tone="jade">The system published the reviewed snapshot. A new edit requires a new submission before it can replace that publication.</KnowledgeNotice>}
        <div className="knowledge-editor-grid"><section className="knowledge-panel knowledge-live-form">
          <label>Title<input maxLength={160} disabled={busy || draft.hasPendingSubmission} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
          {draft.currentVersion.mimeType === "application/pdf" && draft.pdfBase64
            ? <PdfDocument base64={draft.pdfBase64} title={draft.title} />
            : <div className="arden-document-field"><span>Document text</span>
            <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor
              key={`${draft.id}:${draft.currentVersion.version}`} body={editor.body}
              instanceKey={`${draft.id}:${draft.currentVersion.version}`}
              disabled={busy || draft.hasPendingSubmission} onChange={(body) => setEditor({ ...editor, body })} /></Suspense>
          </div>}
        </section><div className="knowledge-live-side"><section className="knowledge-panel knowledge-live-history"><h2>Review history</h2>
          <ol><li><strong>v{draft.currentVersion.version} · {draft.hasPendingSubmission ? "awaiting review" : "working draft"}</strong><small>Updated {new Date(draft.updatedAt).toLocaleDateString()}</small></li>
            {submissions.filter((item) => item.draftId === draft.id).map((item) => <li key={item.id}><strong>{statusLabel(item.status)}</strong><small>Submitted {new Date(item.submittedAt).toLocaleDateString()}</small></li>)}</ol>
        </section><aside className="knowledge-panel knowledge-live-form"><div className="knowledge-live-meta-heading"><h2>Governance metadata</h2><small>* Required to submit</small></div>
          <label>Responsible department<select disabled={busy || draft.hasPendingSubmission} value={editor.responsibleDepartmentId ?? ""} onChange={(event) => setEditor({ ...editor, responsibleDepartmentId: event.target.value || null })}>
            <option value="">Choose department</option>{options?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Access scope<select disabled={busy || draft.hasPendingSubmission} value={editor.targetScopeType ?? ""} onChange={(event) => {
            const targetScopeType = (event.target.value || null) as EditorValues["targetScopeType"];
            const audienceRoleIds = normalizeAudienceSelection(editor.audienceRoleIds, options?.audienceRoles ?? [], targetScopeType);
            setEditor({ ...editor, targetScopeType, audienceRoleIds });
          }}>
            <option value="">Choose scope</option><option value="DEPARTMENT">Responsible department</option><option value="ORGANIZATION">Organization</option></select></label>
          <label>Classification<select disabled={busy || draft.hasPendingSubmission} value={editor.classification} onChange={(event) => setEditor({ ...editor, classification: event.target.value as KnowledgeClassification })}>
            <option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select></label>
          <fieldset disabled={busy || draft.hasPendingSubmission}><legend>Audience roles</legend>

            <div className="knowledge-live-role-list">{availableAudienceOptions(options?.audienceRoles ?? [], editor.targetScopeType).map((role) => <label key={role.id}>
              <input type="checkbox" checked={editor.audienceRoleIds.includes(role.id)} onChange={(event) => setEditor({ ...editor,
                audienceRoleIds: event.target.checked ? [...editor.audienceRoleIds, role.id] : editor.audienceRoleIds.filter((id) => id !== role.id) })} />
              <span>{role.name}{role.kind === "ALL_MEMBERS" ? " · Organization default"
                : role.departmentId ? ` · ${departmentName(role.departmentId)}` : " · Organization"}</span></label>)}</div>
          </fieldset>
          <label>Team tag (optional)<input maxLength={100} disabled={busy || draft.hasPendingSubmission} value={editor.teamTag ?? ""} onChange={(event) => setEditor({ ...editor, teamTag: event.target.value || null })} /></label>
          <label>Project tag (optional)<input maxLength={100} disabled={busy || draft.hasPendingSubmission} value={editor.projectTag ?? ""} onChange={(event) => setEditor({ ...editor, projectTag: event.target.value || null })} /></label>
          {!ready && <KnowledgeNotice title="Not ready to submit" tone="amber">Select a responsible department, access scope and at least one audience role.</KnowledgeNotice>}
        </aside></div></div>
        <div className="knowledge-live-action-bar" role="group" aria-label="Draft actions"><span>{dirty ? "Unsaved changes · " : ""}{submitHint}</span>
          <div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy || draft.hasPendingSubmission || !dirty} onClick={saveDraft}>{busy ? "Working…" : "Save new version"}</button>
            <button type="button" className="primary-button" disabled={busy || draft.hasPendingSubmission || dirty || !ready || snapshotAlreadySubmitted} onClick={submitDraft}>Submit v{draft.currentVersion.version} for review</button></div></div>
      </> : screen === "document" && document ? <>
        <KnowledgeHeading eyebrow="WORKSPACE / PUBLISHED KNOWLEDGE" title={document.title}
          action={<button type="button" className="secondary-button" onClick={() => setScreen("library")}>Back to library</button>} />
        <div className="knowledge-inline-meta"><KnowledgeBadge tone="jade">Published</KnowledgeBadge><KnowledgeBadge>{document.classification}</KnowledgeBadge>
          <span>Published {new Date(document.publishedAt).toLocaleString()}</span></div>
        <article className="knowledge-panel knowledge-live-document">
          {document.mimeType === "application/pdf" && document.pdfBase64
            ? <PdfDocument base64={document.pdfBase64} title={document.title} />
            : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
              key={`published:${document.id}:${document.contentHash}`} body={document.body ?? ""}
              instanceKey={`published:${document.id}:${document.contentHash}`} /></Suspense>}
        </article>
      </> : <>
        <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Knowledge" description="Drafts you own and the versions published to you."
          action={<div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
            <button type="button" className="primary-button" onClick={() => setScreen("create")}>Create draft</button></div>} />
        <div className="knowledge-live-library-controls"><div role="tablist" aria-label="Knowledge library"><button type="button" role="tab" aria-selected={libraryTab === "drafts"} className={libraryTab === "drafts" ? "is-active" : ""} onClick={() => setLibraryTab("drafts")}>My drafts <span>{drafts.length}</span></button>
          <button type="button" role="tab" aria-selected={libraryTab === "published"} className={libraryTab === "published" ? "is-active" : ""} onClick={() => setLibraryTab("published")}>Published for me <span>{published.length}</span></button></div>
          <SearchField value={query} onChange={setQuery} placeholder="Filter titles…" /></div>
        {libraryTab === "drafts" && (filteredDrafts.length ? <div className="knowledge-live-library-list" aria-label="My drafts">{filteredDrafts.map((item) => {
          const status = latestByDraft.get(item.id)?.status;
          return <button type="button" key={item.id} className="knowledge-live-library-row" onClick={() => openDraft(item.id)} aria-label={`Open ${item.title}`}>
            <span className="knowledge-live-file-kind" aria-hidden="true">{item.mimeType === "application/pdf" ? "PDF" : "TXT"}</span>
            <span className="knowledge-live-row-title"><strong>{item.title}</strong><small>v{item.currentVersion} · updated {new Date(item.updatedAt).toLocaleDateString()}</small></span>
            <span className="knowledge-live-classification">{item.classification}</span><span>{departmentName(item.responsibleDepartmentId)}</span>
            <span className={`knowledge-live-status ${status === "APPROVED" ? "is-success" : status === "PENDING_REVIEW" ? "is-info" : status === "CHANGES_REQUESTED" ? "is-attention" : ""}`}>{status ? statusLabel(status) : item.responsibleDepartmentId ? "Draft" : "Draft · metadata incomplete"}</span>
          </button>;
        })}</div> : <div className="knowledge-empty"><h2>{drafts.length ? "No matching drafts" : "No drafts yet"}</h2><p>{drafts.length ? "Try another title." : "Create a draft to start the review process."}</p></div>)}
        {libraryTab === "published" && (filteredPublished.length ? <div className="knowledge-live-library-list" aria-label="Published for me">{filteredPublished.map((item) =>
          <button type="button" className="knowledge-live-library-row" key={item.id} onClick={() => openPublished(item.id)} aria-label={`Read ${item.title}`}>
            <span className="knowledge-live-file-kind" aria-hidden="true">{item.mimeType === "application/pdf" ? "PDF" : "TXT"}</span>
            <span className="knowledge-live-row-title"><strong>{item.title}</strong><small>Published {new Date(item.publishedAt).toLocaleDateString()}</small></span>
            <span className="knowledge-live-classification">{item.classification}</span><span>Approved snapshot</span><span className="knowledge-live-status is-success">Published</span>
          </button>)}</div>
          : <div className="knowledge-empty"><h2>{published.length ? "No matching publications" : "No accessible publication"}</h2></div>)}
      </>}
    </div>
    {decisionToConfirm && review && <KnowledgeDialog title={decisionToConfirm === "APPROVE" ? `Approve and publish ${review.title}?` : `Reject ${review.title}?`}
      onClose={() => setDecisionToConfirm(null)} dismissible={!busy}>
      <p>{decisionToConfirm === "APPROVE" ? "The server will publish this exact reviewed snapshot if approval succeeds." : "The author will need to revise and submit a new version. Nothing will be published."}</p>
      <div className="knowledge-live-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
        <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button" : "primary-button"} disabled={busy} onClick={() => decide(decisionToConfirm)}>{busy ? "Working…" : decisionToConfirm === "APPROVE" ? "Approve and publish" : "Reject submission"}</button></div>
    </KnowledgeDialog>}
  </main>;
}
