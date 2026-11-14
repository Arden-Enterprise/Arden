import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { emptyKnowledgeMetadata, metadataSubmissionErrors, applicabilityStatus, plainTextToSemanticDocument, serializeSemanticDocument, parseSemanticDocument, semanticDocumentHasText,
  type KnowledgeMetadata } from "@arden/domain";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { SearchField } from "../shared/SearchField";
import { KnowledgeHeading, KnowledgeNotice } from "./KnowledgePrimitives";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import {
  ApiError, createNewKnowledgeDraft, createPdfKnowledgeDraft, decideKnowledgeReview, listKnowledgeReviewBoard,
  listKnowledgeDrafts, listKnowledgeSubmissions, listPublishedKnowledge, loadKnowledgeDraft,
  withdrawKnowledgeSubmission,
  loadKnowledgeOptions, loadKnowledgeReview, loadPublishedKnowledge, saveKnowledgeDraft, loadKnowledgeCatalog, replaceKnowledgePdf,
  submitKnowledgeDraft, type AssignedKnowledgeReview, type DecidedKnowledgeReview, type KnowledgeDraftRecord,
  type KnowledgeDraftSummary, type KnowledgeOptions, type KnowledgeReviewDetail,
  type KnowledgeSubmission, type PublishedKnowledge, type KnowledgeCatalog, type TargetReaders,
  listKnowledgeDraftVersions, loadKnowledgeDraftVersion,
  type KnowledgeDraftVersionRecord, type KnowledgeDraftVersionSummary,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import { PdfDocument, PdfViewer, pdfFileName, pdfSizeLabel, usePdfObjectUrl } from "./PdfDocument";
import { ReviewList, initialsOf } from "./ReviewList";
import { libraryDateLabel } from "./libraryDisplay";
import { ownerDepartment } from "./readerSelection";
import { KnowledgeCatalogEditor } from "./KnowledgeCatalogEditor";
import { KnowledgeLibraryBrowse, emptyLibraryFilters } from "./KnowledgeLibraryBrowse";
import { KnowledgeMetadataFields, editableKnowledgeMetadata, targetReadersLabel } from "./KnowledgeMetadataFields";
import { ActionToast } from "../shared/ActionToast";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { draftStatus, statusLabel, validatePdfFile } from "./knowledgeStatus";
import { KnowledgeDocumentDetail } from "./KnowledgeDocumentDetail";
import { KnowledgeDialog } from "./KnowledgeDialog";
import type { KnowledgeNavigationTarget } from "./knowledgeCitation";

const ArdenRichTextEditor = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenRichTextEditor })));
const ArdenDocumentView = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenDocumentView })));

function DocumentSurfaceLoading() {
  return <div className="arden-document-loading" role="status">Loading document…</div>;
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
  "targetScopeType" | "teamTag" | "projectTag" | "audienceIds"> & { management: KnowledgeMetadata; targetReaders: TargetReaders | null };

function valuesFromDraft(draft: KnowledgeDraftRecord): EditorValues {
  return {
    title: draft.title, body: draft.body, classification: draft.classification,
    responsibleDepartmentId: draft.responsibleDepartmentId,
    targetScopeType: draft.targetScopeType, teamTag: draft.teamTag,
    projectTag: draft.projectTag, audienceIds: [...draft.audienceIds],
    management: editableKnowledgeMetadata(draft.management ?? emptyKnowledgeMetadata()), targetReaders: draft.targetReaders ?? null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Couldn’t complete this action.";
}

export function ServerKnowledgeFeaturePage({ platform, organizationId, organizationName,
  view, active, createdDraftId, citationTarget, onAssignedReviewCount, contextOpen, onToggleContext }: Props) {
  const [drafts, setDrafts] = useState<KnowledgeDraftSummary[]>([]);
  const [submissions, setSubmissions] = useState<KnowledgeSubmission[]>([]);
  const [published, setPublished] = useState<PublishedKnowledge[]>([]);
  const [reviews, setReviews] = useState<AssignedKnowledgeReview[]>([]);
  const [decidedReviews, setDecidedReviews] = useState<DecidedKnowledgeReview[]>([]);
  const [options, setOptions] = useState<KnowledgeOptions | null>(null);
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [managingCatalog, setManagingCatalog] = useState(false);
  const [libraryFilters, setLibraryFilters] = useState(emptyLibraryFilters);
  const [draft, setDraft] = useState<KnowledgeDraftRecord | null>(null);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [replacementPdf, setReplacementPdf] = useState<File | null>(null);
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
  const [libraryTab, setLibraryTab] = useState<"drafts" | "published" | "discover">("discover");
  const [selectedContributionId, setSelectedContributionId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<{ draftId: string; items: KnowledgeDraftVersionSummary[] } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const [viewedVersion, setViewedVersion] = useState<KnowledgeDraftVersionRecord | null>(null);
  const viewedVersionRequest = useRef(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [decisionToConfirm, setDecisionToConfirm] = useState<"APPROVE" | "REJECT" | null>(null);
  const createRequestKey = useRef<string | null>(null);
  const newBodyBaseline = useRef(newBody);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);
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
    const [nextDrafts, nextSubmissions, nextPublished, nextBoard, nextOptions, nextCatalog] = await Promise.all([
      listKnowledgeDrafts(platform, organizationId), listKnowledgeSubmissions(platform, organizationId),
      listPublishedKnowledge(platform, organizationId), listKnowledgeReviewBoard(platform, organizationId),
      loadKnowledgeOptions(platform, organizationId),
      loadKnowledgeCatalog(platform, organizationId).then(value => { setCatalogError(""); return value; })
        .catch(() => { setCatalogError("Catalog is unavailable. You can still browse documents."); return null; }),
    ]);
    const nextReviews = nextBoard.items;
    setDrafts(nextDrafts); setSubmissions(nextSubmissions); setPublished(nextPublished);
    setReviews(nextReviews); setDecidedReviews(nextBoard.decided); setOptions(nextOptions);
    setCatalog(nextCatalog);
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

  const historyDraftId = screen === "editor" ? draft?.id ?? null
    : screen === "library" && libraryTab === "drafts" ? selectedContributionId : null;
  const historyRevision = screen === "editor" ? draft?.currentVersion.version
    : drafts.find((item) => item.id === selectedContributionId)?.currentVersion;
  const historyContext = useRef({ active, organizationId, historyDraftId });
  historyContext.current = { active, organizationId, historyDraftId };
  useEffect(() => {
    viewedVersionRequest.current += 1;
    setViewedVersion(null);
  }, [active, historyDraftId, organizationId]);
  useEffect(() => {
    if (!active || !historyDraftId) { setHistoryVersions(null); return; }
    let present = true;
    setHistoryVersions(null); setHistoryError("");
    void listKnowledgeDraftVersions(platform, organizationId, historyDraftId)
      .then((items) => { if (present) setHistoryVersions({ draftId: historyDraftId, items }); })
      .catch((cause) => { if (present) setHistoryError(errorMessage(cause)); });
    return () => { present = false; };
  }, [active, historyDraftId, historyRevision, historyRetry, organizationId, platform]);

  useEffect(() => {
    if (!active || !createdDraftId || openedCreatedDraftId.current === createdDraftId) return;
    openedCreatedDraftId.current = createdDraftId;
    let present = true;
    void loadKnowledgeDraft(platform, organizationId, createdDraftId)
      .then((loaded) => {
        if (!present) return;
        setDraft(loaded); setEditor(valuesFromDraft(loaded)); setScreen("editor");
        setMessage("Draft created");
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
    setReplacementPdf(null);
    const loaded = await loadKnowledgeDraft(platform, organizationId, id);
    submitRequestKey.current = null;
    setDraft(loaded); setEditor(valuesFromDraft(loaded)); setScreen("editor");
  });
  const openHistoryVersion = (draftId: string, versionId: string) => {
    const request = ++viewedVersionRequest.current;
    const requestedOrganizationId = organizationId;
    void loadKnowledgeDraftVersion(platform, requestedOrganizationId, draftId, versionId)
      .then((loaded) => {
        const current = historyContext.current;
        if (request === viewedVersionRequest.current && current.active
          && current.organizationId === requestedOrganizationId && current.historyDraftId === draftId) {
          setViewedVersion(loaded);
        }
      })
      .catch((cause) => {
        const current = historyContext.current;
        if (request === viewedVersionRequest.current && current.active
          && current.organizationId === requestedOrganizationId && current.historyDraftId === draftId) {
          setError(errorMessage(cause));
        }
      });
  };

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
    await refresh(); setMessage("Draft created");
  });

  const saveDraft = () => void run(async () => {
    if (!draft || !editor) return;
    if (!editor.title.trim()) { setError("The title cannot be empty."); return; }
    // With a derived owner the client sends no department; the server applies the author's primary department.
    const values = options?.primaryDepartmentId !== undefined ? { ...editor, responsibleDepartmentId: null } : editor;
    const { body, targetReaders, ...metadata } = values;
    const patch = { ...metadata, ...(targetReaders ? { targetReaders } : {}), ...(draft.currentVersion.mimeType === "application/pdf" ? {} : { body }) };
    const saved = replacementPdf
      ? await replaceKnowledgePdf(platform, organizationId, draft.id, draft.currentVersion.version, replacementPdf, patch)
      : await saveKnowledgeDraft(platform, organizationId, draft.id, draft.currentVersion.version, patch);
    submitRequestKey.current = null;
    setDraft(saved); setEditor(valuesFromDraft(saved));
    setReplacementPdf(null);
    await refresh(); setMessage("Draft saved");
  });

  const submitDraft = () => void run(async () => {
    if (!draft || !editor) return;
    const key = submitRequestKey.current ?? crypto.randomUUID();
    submitRequestKey.current = key;
    const submission = await submitKnowledgeDraft(platform, organizationId, draft.id, draft.currentVersion.version, key);
    submitRequestKey.current = null;
    setDraft({ ...draft, hasPendingSubmission: true });
    setMessage(statusLabel(submission.status));
    await refresh();
  });

  const withdrawSubmission = (submissionId: string) => void run(async () => {
    const withdrawn = await withdrawKnowledgeSubmission(platform, organizationId, submissionId);
    setWithdrawConfirmId(null);
    setMessage(`Request ${statusLabel(withdrawn.status).toLowerCase()}`);
    await refresh();
  });

  const openReview = (id: string) => guardDiscard(Boolean(comment.trim()), () => { void run(async () => {
    const loaded = await loadKnowledgeReview(platform, organizationId, id);
    setReview(loaded); setComment(""); setCommentSubmitted(false); decisionRequest.current = null;
  }); });

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
      ? "Preparing publication"
      : "Submission rejected");
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

  const openPublished = (id: string) => void run(async () => {
    const loaded = await loadPublishedKnowledge(platform, organizationId, id);
    setOpenedCitation(null); setDocument(loaded); setScreen("document");
  });

  useEffect(() => {
    if (!active || view !== "knowledge" || !citationTarget || openedCitationId.current === citationTarget.navigationId) return;
    openedCitationId.current = citationTarget.navigationId;
    let present = true;
    let loading = true;
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
        setError("Source unavailable.");
      })
      .finally(() => { loading = false; if (present) setBusy(false); });
    return () => {
      present = false;
      if (loading) { openedCitationId.current = null; setBusy(false); }
    };
  }, [active, citationTarget, organizationId, platform, view]);

  const latestByDraft = new Map<string, KnowledgeSubmission>();
  for (const submission of submissions) {
    const previous = latestByDraft.get(submission.draftId);
    if (!previous || Date.parse(submission.submittedAt) > Date.parse(previous.submittedAt)) latestByDraft.set(submission.draftId, submission);
  }
  const dirty = Boolean(replacementPdf || (draft && editor && JSON.stringify(editor) !== JSON.stringify(valuesFromDraft(draft))));
  const creationDirty = Boolean(newTitle || newFile || newBody !== newBodyBaseline.current);
  const guardDiscard = (changed: boolean, action: () => void) => {
    if (busy) return;
    if (changed) setDiscardAction(() => action); else action();
  };
  const resetCreation = () => {
    const body = serializeSemanticDocument(plainTextToSemanticDocument("", () => crypto.randomUUID()));
    newBodyBaseline.current = body; setNewBody(body); setNewTitle(""); setNewFile(null);
    setNewFileError(""); setNewTitleError(""); setDragActive(false); createRequestKey.current = null;
  };
  const cancelCreation = () => guardDiscard(creationDirty, () => { resetCreation(); setError(""); setScreen("library"); });
  const cancelEditing = () => guardDiscard(dirty, () => {
    if (draft) setEditor(valuesFromDraft(draft));
    setReplacementPdf(null);
    setError(""); setLibraryTab("drafts"); setScreen("library"); void refresh();
  });
  const latest = draft ? latestByDraft.get(draft.id) : undefined;
  const currentDraftStatus = draft ? draftStatus({ hasPendingSubmission: draft.hasPendingSubmission,
    responsibleDepartmentId: draft.responsibleDepartmentId, targetScopeType: draft.targetScopeType,
    audienceIds: draft.audienceIds, versionId: draft.currentVersion.id }, latest) : null;
  const snapshotAlreadySubmitted = Boolean(latest && draft && latest.snapshotVersionId === draft.currentVersion.id);
  // Decision 0014: a server that reports the member's primary department derives the responsible department itself.
  const { derived: ownerDerived, departmentId: ownerDepartmentId } = ownerDepartment(options?.primaryDepartmentId, editor?.responsibleDepartmentId ?? null);
  // A draft saved before decision 0014 (or before the author changed department) must be saved once to adopt it.
  const ownerOutOfSync = Boolean(ownerDerived && ownerDepartmentId && draft && draft.responsibleDepartmentId !== ownerDepartmentId);
  const metadataErrors = editor ? metadataSubmissionErrors(editor.management, draft?.hasPublishedVersion ?? false) : [];
  const versionAlreadyPublished = Boolean(draft && editor && submissions.some(item => item.draftId === draft.id
    && ["ACTIVE", "SUPERSEDED"].includes(item.publicationState) && item.management?.version === editor.management.version));
  const readersReady = Boolean(editor?.targetReaders && (editor.targetReaders.mode === "ORGANIZATION"
    || (editor.targetReaders.mode === "DEPARTMENT" && editor.targetReaders.departmentId)
    || (editor.targetReaders.mode === "SELECTED_MEMBERS" && editor.targetReaders.memberIds.length >= 2)));
  const parsedEditor = editor ? parseSemanticDocument(editor.body) : null;
  const hasContent = Boolean(draft?.currentVersion.mimeType === "application/pdf" || (parsedEditor?.ok ? semanticDocumentHasText(parsedEditor.document) : editor?.body.trim()));
  const ready = Boolean(ownerDepartmentId && editor?.title.trim() && hasContent && readersReady && !metadataErrors.length && !versionAlreadyPublished
    && catalog?.topics.some(topic => topic.id === editor.management.topicId && topic.status === "ACTIVE"));
  const departmentName = (id: string | null) => options?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const publicationDepartmentName = (item: PublishedKnowledge) =>
    item.responsibleDepartmentName?.trim() || departmentName(item.responsibleDepartmentId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredDrafts = drafts.filter((item) => item.title.toLocaleLowerCase().includes(normalizedQuery));
  const submitHint = draft?.hasPendingSubmission ? "Awaiting review"
    : dirty ? "Save your changes before submitting."
      : versionAlreadyPublished ? "Enter a new version."
        : !ready ? "Complete document details."
        : snapshotAlreadySubmitted ? "Already submitted" : "Ready to submit";
  const chooseFile = (file: File | null) => { setNewFile(file); setNewFileError(file ? validatePdfFile(file) : ""); createRequestKey.current = null; };

  const audienceNames = (ids?: string[] | null) => (Array.isArray(ids) ? ids : []).map((id) => options?.audiences.find((audience) => audience.id === id)?.name ?? "Unavailable group").join(", ") || "None";
  const selectedContribution = drafts.find((item) => item.id === selectedContributionId) ?? null;
  const selectedContributionLatest = selectedContribution ? latestByDraft.get(selectedContribution.id) : undefined;
  const activeReview = review ? reviews.find((item) => item.submissionId === review.id) : undefined;
  const reviewIndex = review ? reviews.findIndex((item) => item.submissionId === review.id) : -1;
  const noteRequired = commentSubmitted && !comment.trim();
  /** Decides, then opens the neighbouring submission once the queue has refreshed. */
  const decideAndAdvance = (action: "APPROVE" | "REJECT") => {
    const neighbour = reviews[reviewIndex + 1] ?? reviews[reviewIndex - 1];
    pendingNextReview.current = neighbour?.submissionId ?? null;
    decide(action);
  };
  const openCreate = (mode: "text" | "pdf") => { resetCreation(); setCreateMode(mode); setScreen("create"); };
  const readerPdfUrl = usePdfObjectUrl(screen === "document" && document?.mimeType === "application/pdf" ? document.pdfBase64 : null);
  const reviewPdfUrl = usePdfObjectUrl(view === "review-queue" && review?.mimeType === "application/pdf" ? review.pdfBase64 : null);
  /** REV-03/04 breadcrumb "Reviews": back to the REV-02 list, keeping an unsent note behind the discard guard. */
  const backToAllReviews = () => guardDiscard(Boolean(comment.trim()), () => {
    setReview(null); setComment(""); setCommentSubmitted(false); decisionRequest.current = null;
  });
  const librarySearch = view === "knowledge" && screen === "library"
    ? <SearchField value={query} onChange={setQuery} placeholder={libraryTab === "drafts" ? "Filter my contributions…" : "Search documents…"} /> : undefined;
  const breadcrumb = view === "review-queue" ? `${organizationName} / Knowledge / Reviews`
    : screen === "library" ? `${organizationName} / Knowledge / ${libraryTab === "drafts" ? "My Contributions" : "Library"}`
      : screen === "create" ? `${organizationName} / Knowledge / New draft`
        : `${organizationName} / Knowledge / ${screen === "document" ? document?.title ?? "Publication" : draft?.title ?? "Draft"}`;

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={breadcrumb} contextOpen={contextOpen} onToggleContext={onToggleContext}
      search={librarySearch} searchActive={Boolean(librarySearch && query)} chrome={screen === "document" && document ? "reader" : "full"} />
    <div className={`knowledge-feature-page knowledge-live-page${view === "review-queue" && !loading ? " is-review" : ""}`}>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {loading ? <div className="island island-empty" role="status">Loading documents…</div> : view === "review-queue" && !review ? <ReviewList pending={reviews} decided={decidedReviews}
        departmentName={departmentName} busy={busy} onOpen={openReview} onRefresh={() => void refresh()} />
      : view === "review-queue" && review ? <section className="island review-detail" aria-labelledby="review-detail-title">
        <header className="review-detail-bar">
          <nav className="review-detail-crumbs" aria-label="Breadcrumb">
            <button type="button" className="review-crumb-link" disabled={busy} onClick={backToAllReviews}>Reviews</button>
            <span className="review-crumb-separator" aria-hidden="true"><Icon name="chevron" size={11} /></span>
            <span className="review-crumb-current" aria-current="page" title={review.title}>
              <span>{review.title}</span>
            </span>
          </nav>
          {reviewIndex >= 0 && <span className="review-detail-position">{reviewIndex + 1} / {reviews.length}</span>}
          <span className="review-detail-nav">
            <button type="button" className="island-icon-button" aria-label="Next submission" disabled={busy || reviewIndex < 0 || reviewIndex >= reviews.length - 1}
              onClick={() => { const next = reviews[reviewIndex + 1]; if (next) openReview(next.submissionId); }}><Icon name="arrow-down" size={14} /></button>
            <button type="button" className="island-icon-button" aria-label="Previous submission" disabled={busy || reviewIndex <= 0}
              onClick={() => { const previous = reviews[reviewIndex - 1]; if (previous) openReview(previous.submissionId); }}><Icon name="arrow-up" size={14} /></button>
          </span>
        </header>
        <div className="review-detail-body">
          {review.mimeType === "application/pdf" && review.pdfBase64
            ? <div ref={reviewBodyRef} className="review-detail-document is-pdf" aria-label={`Submitted PDF: ${review.title}`}>
              <h1 id="review-detail-title" className="sr-only">{review.title}</h1>
              <div className="review-pdf-toolbar">
                <span className="review-pdf-icon" aria-hidden="true"><Icon name="pdf" size={14} /></span>
                <span className="review-pdf-name" title={pdfFileName(review.title)}>{pdfFileName(review.title)}</span>
                <span className="review-pdf-size">{pdfSizeLabel(review.pdfBase64)}</span>
                <span className="review-pdf-spacer" />
                {reviewPdfUrl && <>
                  <a className="island-icon-button" href={reviewPdfUrl} download={pdfFileName(review.title)} aria-label="Download PDF" title="Download PDF"><Icon name="download" size={14} /></a>
                  <a className="island-icon-button" href={reviewPdfUrl} target="_blank" rel="noopener noreferrer" aria-label="Open PDF in a new tab" title="Open in a new tab"><Icon name="open-external" size={14} /></a>
                </>}
              </div>
              <div className="review-pdf-canvas">
                {reviewPdfUrl ? <PdfViewer url={reviewPdfUrl} title={review.title} /> : <p role="status">Preparing PDF preview…</p>}
              </div>
            </div>
            : <div ref={reviewBodyRef} className="review-detail-document" tabIndex={0} aria-label={`Submitted document: ${review.title}`}>
              <article className="review-detail-text">
                <h1 id="review-detail-title">{review.title}</h1>
                <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
                  key={`review:${review.id}:${review.snapshotVersionId}`} body={review.body}
                  instanceKey={`review:${review.id}:${review.snapshotVersionId}`} /></Suspense>
              </article>
            </div>}
          <aside className="review-detail-side" aria-label="Review decision">
            <div className="review-detail-side-body">
              <section aria-labelledby="review-properties-title">
                <h2 id="review-properties-title" className="review-properties-label">Properties</h2>
                <ul className="review-properties">
                  <li><Icon name="branch" size={13} /><span>{review.management?.version
                    ? `Version ${review.management.version}${review.management.releaseKind === "NEW" ? " · new document" : review.management.releaseKind === "UPDATED" ? " · update" : ""}`
                    : "Submitted version"}</span></li>
                  <li>{activeReview?.authorName
                    ? <><span className="review-row-avatar" aria-hidden="true">{initialsOf(activeReview.authorName)}</span><span>{activeReview.authorName}</span></>
                    : <><Icon name="people" size={13} /><span className="review-property-muted">Author unavailable</span></>}</li>
                  <li><Icon name="calendar" size={13} /><span>Submitted {libraryDateLabel(review.submittedAt)}</span></li>
                </ul>
              </section>
              <section aria-labelledby="review-frozen-title">
                <h3 id="review-frozen-title" className="review-section-label">SUBMITTED DETAILS</h3>
                <dl className="review-frozen">
                  <div><dt>Department</dt><dd title={departmentName(review.responsibleDepartmentId)}>{departmentName(review.responsibleDepartmentId)}</dd></div>
                  <div><dt>Readers</dt><dd>{review.proposedTargetReaders ? targetReadersLabel(review.proposedTargetReaders, departmentName) : audienceNames(review.audienceIds)}</dd></div>
                  {review.management ? <>
                    <div><dt>Type</dt><dd>{review.management.type ?? "—"}</dd></div>
                    <div><dt>Topic</dt><dd>{review.management.topicName ?? "—"}</dd></div>
                    <div><dt>Version</dt><dd>{review.management.version}</dd></div>
                    <div><dt>Effective Date</dt><dd>{review.management.effectiveDate ?? "—"}</dd></div>
                    {review.management.expirationDate && <div><dt>Expiration Date</dt><dd>{review.management.expirationDate}</dd></div>}
                    {review.management.changeNote && <div><dt>Change Note</dt><dd>{review.management.changeNote}</dd></div>}
                  </> : <>
                    <div><dt>Within</dt><dd>{review.targetScopeType === "DEPARTMENT" ? departmentName(review.targetDepartmentId ?? review.responsibleDepartmentId) : "Across departments"}</dd></div>
                    <div><dt>Team / project</dt><dd>{review.teamTag || "All teams"} · {review.projectTag || "All projects"}</dd></div>
                  </>}
                </dl>
              </section>
              {activeReview?.approvalBlocked && <p className="island-note is-warning review-blocked-note" role="note"><Icon name="warning" size={14} /><span>Reader selection is no longer valid. You can still reject.</span></p>}
              <label className="review-note">
                <span className="review-note-label"><span>Note to the author</span>
                  {noteRequired ? <small className="is-required">Required to reject</small> : <small>Optional to approve</small>}</span>
                <textarea ref={decisionReason} rows={5} maxLength={2000} value={comment} disabled={busy} aria-invalid={noteRequired} aria-describedby="knowledge-decision-help"
                  onChange={(event) => setComment(event.target.value)} placeholder="Explain what needs to change" />
              </label>
            </div>
            <footer className="review-decision-footer" role="group" aria-label="Review decision"
              onKeyDown={(event) => { if (event.key === "Escape" && decisionToConfirm && !busy) { event.stopPropagation(); setDecisionToConfirm(null); } }}>
              {decisionToConfirm ? <div className="review-confirm" role="alertdialog" aria-labelledby="review-confirm-title" aria-describedby="review-confirm-body">
                <strong id="review-confirm-title">{decisionToConfirm === "APPROVE" ? "Approve this submission?" : "Reject this submission?"}</strong>
                <p id="review-confirm-body">{decisionToConfirm === "APPROVE"
                  ? "This version will be prepared for publication."
                  : "Your note will be sent to the author."}</p>
                {error && <p role="alert" className="knowledge-live-error">{error}</p>}
                <div className="review-decision-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
                  <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button review-confirm-action" : "primary-button review-confirm-action"} disabled={busy}
                    onClick={() => decideAndAdvance(decisionToConfirm)}>{busy ? "Saving…" : decisionToConfirm === "APPROVE" ? "Approve" : "Reject"}</button>
                </div>
              </div> : <>
                <div className="review-decision-actions">
                  <button type="button" className="secondary-button review-reject" disabled={busy} onClick={() => { if (requireDecisionReason()) setDecisionToConfirm("REJECT"); }}>Reject</button>
                  <button type="button" className="primary-button review-approve" disabled={busy || activeReview?.approvalBlocked} onClick={() => setDecisionToConfirm("APPROVE")}><Icon name="check" size={14} />Approve</button>
                </div>
                <small id="knowledge-decision-help" className="field-error" role={noteRequired ? "alert" : undefined}>{noteRequired ? "Enter a reason." : ""}</small>
              </>}
            </footer>
          </aside>
        </div>
      </section> : screen === "create" ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" disabled={busy} onClick={cancelCreation}>← Back to library</button>
        <KnowledgeHeading eyebrow="KNOWLEDGE" title="New draft" />
        <form className="island island-panel knowledge-create-island" onSubmit={(event) => { event.preventDefault(); createDraft(); }}>
          <fieldset className="knowledge-create-source" disabled={busy}><legend>Content source</legend>
            <label className={createMode === "pdf" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "pdf"} onChange={() => { setCreateMode("pdf"); createRequestKey.current = null; }} /><span className="island-tile" aria-hidden="true"><Icon name="pdf" size={16} /></span><span><strong>Upload a PDF</strong></span></label>
            <label className={createMode === "text" ? "is-selected" : ""}><input type="radio" name="knowledge-create-mode" checked={createMode === "text"} onChange={() => { setCreateMode("text"); createRequestKey.current = null; }} /><span className="island-tile" aria-hidden="true"><Icon name="document" size={16} /></span><span><strong>Write a document</strong></span></label>
          </fieldset>
          <div className="knowledge-create-fields">
            <label className="island-field"><span>Title *</span><input aria-label="Title" id="knowledge-new-title" maxLength={160} value={newTitle} disabled={busy} aria-invalid={Boolean(newTitleError)} aria-describedby="knowledge-new-title-help" onChange={(event) => { setNewTitle(event.target.value); setNewTitleError(""); createRequestKey.current = null; }} /><small id="knowledge-new-title-help" className={newTitleError ? "field-error" : ""}>{newTitleError}</small></label>
          </div>
          {createMode === "pdf" ? <div className={`knowledge-pdf-choose${dragActive ? " is-drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files[0] ?? null); }}>
            <span className="island-tile" aria-hidden="true"><Icon name="pdf" size={18} /></span>
            <strong>Choose a PDF</strong><span>PDF · Max 5 MB</span>
            <input ref={fileInput} className="knowledge-hidden-file-input" tabIndex={-1} type="file" accept=".pdf,application/pdf" disabled={busy} aria-label="Choose PDF file" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            <button ref={chooseFileButton} type="button" className="secondary-button" disabled={busy} aria-invalid={Boolean(newFileError)} aria-describedby="knowledge-pdf-help" onClick={() => fileInput.current?.click()}>Choose file</button>
            <small id="knowledge-pdf-help" className={newFileError ? "field-error" : ""}>{newFileError}</small>
            {newFile && !newFileError && <div className="knowledge-selected-pdf"><strong>{newFile.name}</strong><span>{(newFile.size / 1024 / 1024).toFixed(1)} MB · ready to upload</span><button type="button" disabled={busy} onClick={() => { chooseFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Remove</button></div>}
          </div> : <div className="arden-document-field"><span>Document text</span>
            <Suspense fallback={<DocumentSurfaceLoading />}><ArdenRichTextEditor key="new-shared-knowledge"
              body={newBody} instanceKey="new-shared-knowledge" disabled={busy} onChange={(body) => { setNewBody(body); createRequestKey.current = null; }} /></Suspense>
          </div>}
          <div className="knowledge-live-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={cancelCreation}>Cancel</button>
          </div>
        </form>
      </> : screen === "editor" && draft && editor ? <>
        <button type="button" className="knowledge-back-button knowledge-live-back" disabled={busy} onClick={cancelEditing}>← My Contributions</button>
        <h1 className="sr-only">{draft.title}</h1>
        <div className="draft-workspace">
          <article className="island draft-document" aria-label="Draft">
            <div className="draft-document-toolbar">
              <span className={`island-chip has-dot ${chipTone(currentDraftStatus?.tone ?? "")}`}>{currentDraftStatus?.label}</span>
              <span className="island-meta">{draft.currentVersion.mimeType === "application/pdf" ? "PDF" : "Text"}{dirty ? " · Unsaved changes" : ""}</span>
              {draft.currentVersion.mimeType === "application/pdf" && <label className="km-replace-pdf secondary-button">
                {replacementPdf ? replacementPdf.name : "Replace PDF"}<input type="file" accept=".pdf,application/pdf" disabled={busy}
                  aria-label="Replace PDF" onChange={event => { const file = event.target.files?.[0] ?? null;
                    const validation = file ? validatePdfFile(file) : ""; setError(validation); if (!validation) setReplacementPdf(file); }} />
              </label>}
            </div>
            {latest?.status === "REJECTED" && latest.decisionComment && <KnowledgeNotice title="Reviewer note" tone="danger">
              {latest.decisionComment}
            </KnowledgeNotice>}
            <div className="draft-document-body knowledge-live-form">
              <label className="draft-title-field"><span className="sr-only">Title</span><span aria-hidden="true" className="km-title-required">Title *</span><input maxLength={160} disabled={busy} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
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
            <h2 id="draft-metadata-title">Document details</h2>
            {ownerDerived ? <p className={`draft-owner${ownerDepartmentId ? "" : " is-missing"}`}>
              <Icon name={ownerDepartmentId ? "people" : "warning"} size={14} />
              <span>{ownerDepartmentId ? <>Department: <strong>{departmentName(ownerDepartmentId)}</strong></>
                : "Ask an admin to assign your department."}</span></p> : <>
            <label className="island-field">Responsible department<select disabled={busy} value={editor.responsibleDepartmentId ?? ""} onChange={(event) => {
              const responsibleDepartmentId = event.target.value || null;
              const audienceIds = editor.audienceIds.filter((id) => {
                const audience = options?.audiences.find((item) => item.id === id);
                return audience?.kind === "ORGANIZATION_ALL" || !audience?.departmentId || audience.departmentId === responsibleDepartmentId;
              });
              setEditor({ ...editor, responsibleDepartmentId, audienceIds });
            }}>
              <option value="">Choose department</option>{options?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </>}
            <KnowledgeMetadataFields value={editor.management} readers={editor.targetReaders} topics={catalog?.topics ?? []}
              departments={options?.departments ?? []} busy={busy} isUpdate={draft.hasPublishedVersion ?? false}
              platform={platform} organizationId={organizationId}
              onChange={management => setEditor({ ...editor, management })} onReaders={targetReaders => setEditor({ ...editor, targetReaders })} />
            <p className="island-note">Reviewer: {editor.targetReaders?.mode === "ORGANIZATION"
              ? "Organization reviewer" : ownerDepartmentId ? `${departmentName(ownerDepartmentId)} reviewer` : "Department reviewer"}</p>
            {editor.targetReaders?.mode === "ORGANIZATION"
              && options?.organizationReviewerAvailable === false
              && <p className="island-note is-warning" role="note"><Icon name="warning" size={14} />
                <span>No organization reviewer assigned.</span></p>}
            <div className="draft-actions" role="group" aria-label="Draft actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={cancelEditing}>{dirty ? "Cancel" : "Back"}</button>
              <button type="button" className="secondary-button" disabled={busy || !(dirty || ownerOutOfSync)} onClick={saveDraft}>{busy ? "Saving…" : "Save changes"}</button>
              <button type="button" className="primary-button" disabled={busy || draft.hasPendingSubmission || dirty || ownerOutOfSync || !ready || snapshotAlreadySubmitted} onClick={submitDraft}>Submit for review</button>
              <span className="island-meta" aria-live="polite">{dirty ? "Unsaved changes · " : ""}{ownerOutOfSync && !dirty ? "Save changes before submitting." : submitHint}</span>
            </div>
            <section className="island-detail-section" aria-label="Review history"><h3>History</h3>
              <DraftVersionHistory draftId={draft.id} versions={historyVersions?.draftId === draft.id ? historyVersions.items : null}
                error={historyError} currentVersion={draft.currentVersion.version} submissions={submissions}
                busy={busy} onOpen={openHistoryVersion} onRetry={() => setHistoryRetry((value) => value + 1)} />
            </section>
          </aside>
        </div>
      </> : screen === "document" && document ? <KnowledgeDocumentDetail
        focusTarget={openedCitation}
        summaryOptions={{ platform, active: active && view === "knowledge", context: { organizationId,
          documentId: document.draftId, versionId: document.id, contentHash: document.contentHash },
          onCitation: citation => setOpenedCitation(previous => citation ? { ...citation, navigationId: `reader-summary:${crypto.randomUUID()}` }
            : previous?.navigationId.startsWith("reader-summary:") ? null : previous),
          onAccessLost: () => { setOpenedCitation(null); setDocument(null); setScreen("library"); setError("This document is unavailable."); } }}
        metadata={{
          title: document.title,
          ownerDepartment: publicationDepartmentName(document),
          summary: document.summary ?? "",
          type: document.management?.type ?? undefined, topic: document.management?.topicName,
          publishedDate: document.publishedAt, expirationDate: document.management?.expirationDate ?? undefined,
          activeVersionId: document.id,
          versions: [{ id: document.id, label: document.management?.version || document.versionLabel || "Current",
            status: (applicabilityStatus(document.management, new Date().toLocaleDateString("en-CA"))?.toUpperCase() ?? "PUBLISHED") as "EFFECTIVE" | "UPCOMING" | "EXPIRED" | "PUBLISHED",
            effectiveDate: document.management?.effectiveDate ?? "" }],
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
          description={libraryTab === "drafts" ? ""
            : `${published.length} ${published.length === 1 ? "document" : "documents"} you can read in ${organizationName}`}
          action={!managingCatalog && <div className="knowledge-live-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
            {catalog?.canManage && libraryTab !== "discover" && <button type="button" className="secondary-button" onClick={() => setManagingCatalog(true)}>Manage catalog</button>}
            <button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button>
            <button type="button" className="primary-button" onClick={() => openCreate("pdf")}><Icon name="plus" size={14} />Create from PDF</button></div>} />
        {!managingCatalog && <div className="island-seg knowledge-library-tabs" role="tablist" aria-label="Knowledge library">
          <button type="button" role="tab" aria-selected={libraryTab === "discover"} onClick={() => setLibraryTab("discover")}>Discover</button>
          <button type="button" role="tab" aria-selected={libraryTab === "published"} onClick={() => setLibraryTab("published")}>All documents<span className="island-badge">{published.length}</span></button>
          <button type="button" role="tab" aria-selected={libraryTab === "drafts"} onClick={() => setLibraryTab("drafts")}>My Contributions<span className="island-badge">{drafts.length}</span></button>
        </div>}
        {managingCatalog && catalog?.canManage ? <KnowledgeCatalogEditor platform={platform} organizationId={organizationId}
          catalog={catalog} publications={published} onSaved={reload} onClose={() => setManagingCatalog(false)} />
          : libraryTab !== "drafts" && <KnowledgeLibraryBrowse items={published.map(item => ({ ...item, responsibleDepartmentName: publicationDepartmentName(item) }))} catalog={catalog} catalogError={catalogError}
            query={query} filters={libraryFilters} onFilters={setLibraryFilters} discover={libraryTab === "discover"}
            onBrowse={() => setLibraryTab("published")} onOpen={openPublished} onManage={() => setManagingCatalog(true)} />}
        {!managingCatalog && libraryTab === "drafts" && (filteredDrafts.length ? <div className="island-split">
          <div className="island-main"><IslandTable label="My contributions" minWidth={620} columns="minmax(240px, 1.8fr) minmax(110px, 1fr) 110px minmax(150px, auto)"
            headers={["DOCUMENT", "DEPARTMENT", "UPDATED", "STATUS"]}>
            {filteredDrafts.map((item) => {
              const status = draftStatus(item, latestByDraft.get(item.id));
              return <IslandRow key={item.id} selected={selectedContributionId === item.id} className="library-row">
                <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name library-row-name" onClick={() => setSelectedContributionId(item.id)}
                  aria-label={`Open details for ${item.title}`} title={item.title}>
                  <span className="library-row-icon" aria-hidden="true"><Icon name={item.mimeType === "application/pdf" ? "pdf" : "document"} size={16} /></span>
                  <span className="library-row-copy">
                    <span className="library-row-heading"><strong className="library-row-title">{item.title}</strong>{item.management?.version && <span className="library-row-version">{item.management.version}</span>}</span>
                    <span className="library-row-meta"><span className="library-row-audience">{targetReadersLabel(item.targetReaders, departmentName)}</span></span>
                  </span></button></IslandCell>
                <IslandCell className="island-row-cell library-row-secondary">{departmentName(item.responsibleDepartmentId)}</IslandCell>
                <IslandCell className="island-row-cell library-row-date">{libraryDateLabel(item.updatedAt)}</IslandCell>
                <IslandCell><span className={`island-chip has-dot ${chipTone(status.tone)}`}>{status.label}</span></IslandCell>
              </IslandRow>;
            })}
          </IslandTable></div>
          {selectedContribution && <aside className="island island-panel island-side contribution-side" aria-labelledby="contribution-title">
            <div className="island-side-header"><div>
              <span className="island-chip-row"><span className={`island-chip has-dot ${chipTone(draftStatus(selectedContribution, selectedContributionLatest).tone)}`}>{draftStatus(selectedContribution, selectedContributionLatest).label}</span><span className="island-meta">{selectedContribution.management?.version}</span></span>
              <h2 id="contribution-title">{selectedContribution.title}</h2></div>
              <button type="button" className="island-icon-button" onClick={() => setSelectedContributionId(null)} aria-label="Close contribution details"><Icon name="close" size={14} /></button></div>
            {selectedContributionLatest?.decisionComment && <blockquote className="island-box contribution-reason"><strong>Reviewer note</strong><p>{selectedContributionLatest.decisionComment}</p></blockquote>}
            <dl className="island-kv">
              <dt>Type</dt><dd>{selectedContribution.management?.type ?? "—"}</dd>
              <dt>Department</dt><dd>{departmentName(selectedContribution.responsibleDepartmentId)}</dd>
              <dt>Readers</dt><dd>{targetReadersLabel(selectedContribution.targetReaders, departmentName)}</dd>
            </dl>
            <section className="island-detail-section" aria-label="History"><h3>History</h3>
              <DraftVersionHistory draftId={selectedContribution.id}
                versions={historyVersions?.draftId === selectedContribution.id ? historyVersions.items : null}
                error={historyError} currentVersion={selectedContribution.currentVersion} submissions={submissions}
                busy={busy} onOpen={openHistoryVersion} onRetry={() => setHistoryRetry((value) => value + 1)} />
            </section>
            {selectedContributionLatest?.status === "PENDING_REVIEW" && withdrawConfirmId === selectedContributionLatest.id
              && <div className="island-box contribution-withdraw" role="alertdialog" aria-labelledby="withdraw-title" aria-describedby="withdraw-body">
                <strong id="withdraw-title">Withdraw this review request?</strong>
                <p id="withdraw-body">Reviewers will no longer see this version. Your draft stays, and you can submit it again.</p>
                <div className="contribution-withdraw-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => setWithdrawConfirmId(null)}>Keep request</button>
                  <button type="button" className="secondary-button contribution-withdraw-confirm" disabled={busy} onClick={() => withdrawSubmission(selectedContributionLatest.id)}>{busy ? "Withdrawing…" : "Withdraw request"}</button>
                </div>
              </div>}
            <div className="island-side-footer contribution-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => openDraft(selectedContribution.id)}>Open draft</button>
              {selectedContributionLatest?.status === "PENDING_REVIEW" && withdrawConfirmId !== selectedContributionLatest.id
                && <button type="button" className="secondary-button" disabled={busy} onClick={() => setWithdrawConfirmId(selectedContributionLatest.id)}>Withdraw request</button>}
              </div>
          </aside>}
        </div> : <div className="island island-empty"><h3>{drafts.length ? "No matching drafts" : "No contributions yet"}</h3>{drafts.length > 0 && <p>Try another title.</p>}<button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button></div>)}
      </>}
    </div>
    <ActionToast message={message} onDismiss={() => setMessage("")} />
    {viewedVersion && <KnowledgeDialog title={`Version v${viewedVersion.version}`} onClose={() => setViewedVersion(null)}>
      <p className="island-meta">Saved {new Date(viewedVersion.createdAt).toLocaleString()} · Read only</p>
      <div className="knowledge-version-preview">
        {viewedVersion.mimeType === "application/pdf" && viewedVersion.pdfBase64
          ? <PdfDocument base64={viewedVersion.pdfBase64} title={`Version v${viewedVersion.version}`} showToolbar={false} />
          : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
            key={viewedVersion.id} body={viewedVersion.body} instanceKey={viewedVersion.id} /></Suspense>}
      </div>
    </KnowledgeDialog>}
    {discardAction && <DiscardChangesDialog exiting={false} onCancel={() => setDiscardAction(null)} onDiscard={() => {
      discardAction(); setDiscardAction(null);
    }} />}
  </main>;
}

function DraftVersionHistory({ draftId, versions, error, currentVersion, submissions, busy, onOpen, onRetry }: {
  draftId: string; versions: KnowledgeDraftVersionSummary[] | null; error: string;
  currentVersion: number; submissions: KnowledgeSubmission[]; busy: boolean;
  onOpen: (draftId: string, versionId: string) => void;
  onRetry: () => void;
}) {
  if (error) return <div className="knowledge-version-error" role="alert"><p className="field-error">{error}</p>
    <button type="button" className="secondary-button" onClick={onRetry}>Retry history</button></div>;
  if (!versions) return <p role="status" className="island-meta">Loading versions…</p>;
  if (!versions.length) return <p className="island-meta">No saved versions yet.</p>;
  return <ol className="island-timeline">
    {versions.map((version) => {
      const submission = submissions.find((item) => item.snapshotVersionId === version.id);
      return <li key={version.id}><button type="button" className="knowledge-version-link" disabled={busy}
        onClick={() => onOpen(draftId, version.id)} aria-label={`View version ${version.version}`}>
        <strong>v{version.version}{version.version === currentVersion ? " · current version" : ""}</strong>
        <small>Saved {new Date(version.createdAt).toLocaleDateString()}
          {submission ? ` · ${statusLabel(submission.status)}` : ""}</small>
      </button></li>;
    })}
  </ol>;
}

const statusChipTone: Record<string, string> = { "is-info": "tone-info", "is-success": "tone-success", "is-danger": "tone-danger", "is-attention": "tone-warning" };
function chipTone(tone: string): string { return statusChipTone[tone] ?? ""; }
