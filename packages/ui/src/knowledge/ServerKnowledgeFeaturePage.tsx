import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { emptyKnowledgeMetadata, metadataSubmissionErrors, validityStatus, plainTextToSemanticDocument, serializeSemanticDocument, parseSemanticDocument, semanticDocumentHasText,
  type KnowledgeMetadata } from "@arden/domain";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { SearchField } from "../shared/SearchField";
import { KnowledgeHeading, KnowledgeNotice } from "./KnowledgePrimitives";
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import {
  ApiError, createNewKnowledgeDraft, createPdfKnowledgeDraft, decideKnowledgeReview, listKnowledgeReviewBoard,
  listKnowledgeDrafts, listKnowledgeSubmissions, loadKnowledgeDraft,
  withdrawKnowledgeSubmission, retryKnowledgePublication,
  loadKnowledgeOptions, loadKnowledgeReview, loadPublishedKnowledge, saveKnowledgeDraft, loadKnowledgeCatalog, replaceKnowledgePdf,
  submitKnowledgeDraft, type AssignedKnowledgeReview, type DecidedKnowledgeReview, type KnowledgeDraftRecord,
  type KnowledgeDraftSummary, type KnowledgeOptions, type KnowledgeReviewDetail,
  type KnowledgeSubmission, type PublishedKnowledge, type KnowledgeCatalog, type TargetReaders,
  listKnowledgeDraftVersions, loadKnowledgeDraftVersion,
  type KnowledgeDraftVersionRecord, type KnowledgeDraftVersionSummary,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import { PdfDocument, PdfViewer, pdfFileName, pdfSizeLabel, usePdfObjectUrl } from "./PdfDocument";
import { PdfReader } from "./PdfReader";
import { ReviewList, initialsOf } from "./ReviewList";
import { reviewRequestPresentation } from "./reviewRequest";
import { libraryDateLabel } from "./libraryDisplay";
import { ownerDepartment } from "./readerSelection";
import { KnowledgeCatalogEditor } from "./KnowledgeCatalogEditor";
import { emptyLibraryFilters, type LibraryFilters } from "./KnowledgeLibraryBrowse";
import { KnowledgeHomeBrowse } from "./KnowledgeHomeBrowse";
import { useHomePublications, type HomeSource } from "./useHomePublications";
import { KnowledgeHomeNavigation, type HomeTab } from "./KnowledgeHomeNavigation";
import { KnowledgeMetadataFields, editableKnowledgeMetadata, targetReadersLabel } from "./KnowledgeMetadataFields";
import { targetReadersComplete } from "./TargetReadersField";
import { ActionToast } from "../shared/ActionToast";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { draftStatus, statusLabel, validatePdfFile } from "./knowledgeStatus";
import { KnowledgeDocumentDetail } from "./KnowledgeDocumentDetail";
import { PublicationReportsPanel } from "./PublicationGovernance";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { ReportIssueDialog } from "../maintenance/ReportIssueDialog";
import { MyReports } from "../maintenance/MyReports";
import { MaintenanceQueue } from "../maintenance/MaintenanceQueue";
import { MaintenanceCaseScreen } from "../maintenance/MaintenanceCaseScreen";
import { caseLoadVisible, startCaseLoad } from "../maintenance/case-load";
import { describeVersionPair, type VersionPair } from "../maintenance/version-pair";
import {
  cancelMaintenanceAnalysis, claimMaintenanceCase, compareMaintenanceCase, confirmMaintenancePublication, createMaintenanceCase, getMaintenanceCase, linkMaintenanceCase, linkMaintenancePublication, listEligibleReviewers, listMaintenanceCases,
  listMaintenanceHistory, listMaintenanceLinks, listMaintenanceVersions, postMaintenanceMessage, readMaintenanceAnalysis, readMaintenanceOriginal, reassignMaintenanceCase, resolveMaintenanceCase, startMaintenanceAnalysis, type AnalysisRun, type EligibleReviewer, type MaintenanceCase, type MaintenanceComparison, type MaintenanceHistory, type MaintenanceOriginal, type MaintenanceVersion, type RelatedCase,
} from "../maintenance/maintenance-client";
import { ApprovedReadersField, approvedReadersReady } from "./ApprovedReadersField";
import { PublicationChangeDialog, publicationChangeSentMessage, type PublicationChangeType } from "./PublicationChangeDialog";
import type { KnowledgeReaderTarget, KnowledgeCitationReference } from "./knowledgeCitation";

const ArdenRichTextEditor = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenRichTextEditor })));
const ArdenDocumentView = lazy(() => import("./ArdenRichTextEditor")
  .then((module) => ({ default: module.ArdenDocumentView })));

/** Reader status from the optional expiration date; publications are in force from approval. */
/** Minimum time between window-focus refreshes of Home (deliberate Refresh and actions are not limited). */
export const focusReloadIntervalMs = 30_000;

function readerValidity(item: PublishedKnowledge): { status: "EFFECTIVE" | "EXPIRING" | "EXPIRED"; expiresInDays?: number } {
  const { status, daysLeft } = validityStatus(item.management, new Date().toLocaleDateString("en-CA"));
  if (status === "Expiring soon") return { status: "EXPIRING", expiresInDays: daysLeft ?? 0 };
  return { status: status === "Current" ? "EFFECTIVE" : "EXPIRED" };
}

function DocumentSurfaceLoading() {
  return <div className="arden-document-loading" role="status">Loading document…</div>;
}

type Props = ContextControlProps & {
  platform: Platform;
  organizationId: string;
  organizationName: string;
  view: "knowledge" | "review-queue";
  /** Opens Reviews, where Maintenance cases are worked. */
  onOpenReviews?: () => void;
  active: boolean;
  createdDraftId: string | null;
  citationTarget?: KnowledgeReaderTarget | null;
  requestedReviewId?: string | null;
  onReviewTargetHandled?: () => void;
  onAssignedReviewCount?: (count: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  awaitingAssignment?: boolean;
  onOpenPrivateNotes?: () => void;
  canUsePrivateWorkspace?: boolean;
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

/** A failed case action keeps the case on screen, so the message says what changed and that notes are kept. */
function caseActionError(error: unknown): string {
  if (error instanceof ApiError && error.code === "MAINTENANCE_STALE") {
    return "This case changed while you were working. It now shows the latest state, and your notes are kept.";
  }
  return errorMessage(error);
}

type CommandKey = { payload: string; key: string };

/** One idempotency key per exact command: an identical retry replays it; a new revision, payload or case gets a new key. */
function commandKey(slot: { current: CommandKey | null }, ...payload: unknown[]): string {
  const text = JSON.stringify(payload);
  if (slot.current?.payload !== text) slot.current = { payload: text, key: crypto.randomUUID() };
  return slot.current.key;
}

export function ServerKnowledgeFeaturePage(props: Props) {
  return <ConnectedKnowledgePage key={`${props.platform}:${props.organizationId}`} {...props} />;
}
function ConnectedKnowledgePage({ platform, organizationId, organizationName,
  view, active, createdDraftId, citationTarget, requestedReviewId, onReviewTargetHandled,
  onAssignedReviewCount, onDirtyChange, awaitingAssignment = false,
  onOpenPrivateNotes, canUsePrivateWorkspace = false, contextOpen, onToggleContext, onOpenReviews }: Props) {
  const [drafts, setDrafts] = useState<KnowledgeDraftSummary[]>([]);
  const [submissions, setSubmissions] = useState<KnowledgeSubmission[]>([]);
  const home = useHomePublications(platform, organizationId);
  const [reviews, setReviews] = useState<AssignedKnowledgeReview[]>([]);
  const [decidedReviews, setDecidedReviews] = useState<DecidedKnowledgeReview[]>([]);
  const [options, setOptions] = useState<KnowledgeOptions | null>(null);
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [managingCatalog, setManagingCatalog] = useState(false);
  const [filtersBySource, setFiltersBySource] = useState<Record<HomeSource, LibraryFilters>>(() => ({
    organization: emptyLibraryFilters(), shared: emptyLibraryFilters(), other: emptyLibraryFilters() }));
  const [draft, setDraft] = useState<KnowledgeDraftRecord | null>(null);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [replacementPdf, setReplacementPdf] = useState<File | null>(null);
  const [review, setReview] = useState<KnowledgeReviewDetail | null>(null);
  const [document, setDocument] = useState<PublishedKnowledge | null>(null);
  const [openedCitation, setOpenedCitation] = useState<(KnowledgeCitationReference & { navigationId: string }) | null>(null);
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
  const [libraryTab, setLibraryTab] = useState<HomeTab>("organization");
  const [organizationView, setOrganizationView] = useState<"overview" | "all">("overview");
  const [reportOpen, setReportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reports, setReports] = useState<MaintenanceCase[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reviewSection, setReviewSection] = useState<"publication" | "maintenance">("publication");
  const [maintenanceQueue, setMaintenanceQueue] = useState<MaintenanceCase[]>([]);
  const [maintenanceQueueLoading, setMaintenanceQueueLoading] = useState(false);
  const [maintenanceQueueError, setMaintenanceQueueError] = useState("");
  const [maintenanceCase, setMaintenanceCase] = useState<MaintenanceCase | null>(null);
  const [reviewerChoices, setReviewerChoices] = useState<EligibleReviewer[]>([]);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceHistory | null>(null);
  const [relatedCases, setRelatedCases] = useState<RelatedCase[]>([]);
  const [analysisRun, setAnalysisRun] = useState<AnalysisRun | null>(null);
  const analysisKey = useRef<{ evidence: string; key: string } | null>(null);
  const analysisEpoch = useRef(0);
  const caseLoad = useRef({ request: 0 });
  const [maintenanceOriginal, setMaintenanceOriginal] = useState<{ unavailable: true; label: string } | { unavailable: false; label: string; text: string } | null>(null);
  const linkKey = useRef<CommandKey | null>(null);
  const [maintenanceComparison, setMaintenanceComparison] = useState<MaintenanceComparison | null>(null);
  const [versionPair, setVersionPair] = useState<VersionPair | null>(null);
  const maintenanceVersions = useRef<MaintenanceVersion[]>([]);
  const maintenancePairIndex = useRef(0);
  const maintenancePairTo = useRef(1);
  // The case the reader asked for, kept even when its first read fails, so Retry reopens that case.
  const requestedCaseId = useRef<string | null>(null);
  const historyEpoch = useRef(0);
  const comparisonRequest = useRef(0);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState("");
  // A failed load replaces the case; a failed action stays inline so the case and typed notes remain.
  const [maintenanceActionError, setMaintenanceActionError] = useState("");
  // Reviews and Home → My reports share the case state; each shows only a case opened from it.
  const [caseSurface, setCaseSurface] = useState<"reviews" | "reports">("reviews");
  const claimKey = useRef<CommandKey | null>(null);
  const decisionKey = useRef<CommandKey | null>(null);
  const publicationKey = useRef<CommandKey | null>(null);
  const publicationLinkKey = useRef<CommandKey | null>(null);
  const publicationRequestKey = useRef<CommandKey | null>(null);
  const reassignKey = useRef<CommandKey | null>(null);
  const messageRequest = useRef<{ caseId: string; text: string; revision: number; key: string } | null>(null);
  const [selectedContributionId, setSelectedContributionId] = useState<string | null>(null);
  const [historyVersions, setHistoryVersions] = useState<{ draftId: string; items: KnowledgeDraftVersionSummary[] } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const [viewedVersion, setViewedVersion] = useState<KnowledgeDraftVersionRecord | null>(null);
  const viewedVersionRequest = useRef(0);
  const [queries, setQueries] = useState<Record<HomeTab, string>>({ organization: "", shared: "", other: "", drafts: "", reports: "" });
  const query = queries[libraryTab];
  const setQuery = (value: string) => setQueries(previous => ({ ...previous, [libraryTab]: value }));
  const source: HomeSource = libraryTab === "drafts" || libraryTab === "reports" ? "organization" : libraryTab;
  const libraryFilters = filtersBySource[source];
  const setLibraryFilters = (value: LibraryFilters) => setFiltersBySource(previous => ({ ...previous, [source]: value }));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [decisionToConfirm, setDecisionToConfirm] = useState<"APPROVE" | "REJECT" | null>(null);
  /** T2.2: null approves the proposed readers as they are; otherwise the narrowed selection. */
  const [approvedReaders, setApprovedReaders] = useState<TargetReaders | null>(null);
  const createRequestKey = useRef<string | null>(null);
  const newBodyBaseline = useRef(newBody);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);
  /** T6.4: the change the author is asking a reviewer to make to a published document. */
  const [changeRequest, setChangeRequest] = useState<PublicationChangeType | null>(null);
  const submitRequestKey = useRef<string | null>(null);
  const decisionRequest = useRef<{ action: "APPROVE" | "REJECT"; readers: string; key: string } | null>(null);
  const openedCreatedDraftId = useRef<string | null>(null);
  const openedCitationId = useRef<string | null>(null);
  const requestedReviewHandled = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseFileButton = useRef<HTMLButtonElement>(null);
  const decisionReason = useRef<HTMLTextAreaElement>(null);
  const reviewBodyRef = useRef<HTMLDivElement>(null);
  const pendingNextReview = useRef<string | null>(null);
  const readerReturnId = useRef<string | null>(null);
  useEffect(() => {
    if (screen !== "library" || !readerReturnId.current) return;
    const id = readerReturnId.current;
    readerReturnId.current = null;
    const opener = [...window.document.querySelectorAll<HTMLButtonElement>("button[data-publication-id]")]
      .find(button => button.dataset.publicationId === id);
    (opener ?? window.document.getElementById("arden-main"))?.focus();
  }, [screen]);

  const lastReloadAt = useRef(0);
  const reload = useCallback(async () => {
    lastReloadAt.current = Date.now();
    // Each reading view owns its wait/error state; one slow source must not hide the other tabs.
    void home.refresh();
    const [nextDrafts, nextSubmissions, nextBoard, nextOptions, nextCatalog] = await Promise.all([
      listKnowledgeDrafts(platform, organizationId), listKnowledgeSubmissions(platform, organizationId),
      listKnowledgeReviewBoard(platform, organizationId),
      loadKnowledgeOptions(platform, organizationId),
      loadKnowledgeCatalog(platform, organizationId).then(value => { setCatalogError(""); return value; })
        .catch(() => { setCatalogError("Catalog is unavailable. You can still browse documents."); return null; }),
    ]);
    const nextReviews = nextBoard.items;
    setDrafts(nextDrafts); setSubmissions(nextSubmissions);
    setReviews(nextReviews); setDecidedReviews(nextBoard.decided); setOptions(nextOptions);
    setCatalog(nextCatalog);
    if (!nextCatalog?.canManage) setManagingCatalog(false);
    onAssignedReviewCount?.(nextReviews.length);
  }, [platform, organizationId, onAssignedReviewCount, home.refresh]);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    setReportsError("");
    try { setReports(await listMaintenanceCases(platform, organizationId, "mine")); }
    catch (caught) { setReportsError(errorMessage(caught)); }
    finally { setReportsLoading(false); }
  }, [platform, organizationId]);
  const loadMaintenanceQueue = useCallback(async () => {
    setMaintenanceQueueLoading(true);
    setMaintenanceQueueError("");
    try { setMaintenanceQueue(await listMaintenanceCases(platform, organizationId, "queue")); }
    catch (caught) { setMaintenanceQueueError(errorMessage(caught)); }
    finally { setMaintenanceQueueLoading(false); }
  }, [platform, organizationId]);
  const applyVersionPair = useCallback(async (caseId: string, items: MaintenanceVersion[], index: number, request: number,
    reportedVersionId?: string, toIndex = index + 1) => {
    if (caseLoad.current.request !== request) return;
    const pair = describeVersionPair(items, index, reportedVersionId, toIndex);
    const from = items[index];
    const to = items[toIndex];
    if (!pair || !from || !to) {
      maintenancePairIndex.current = Math.max(0, index);
      maintenancePairTo.current = Math.max(0, index);
      setVersionPair(null);
      setMaintenanceComparison(null);
      return;
    }
    maintenancePairIndex.current = index;
    maintenancePairTo.current = toIndex;
    const comparing = ++comparisonRequest.current;
    const current = () => caseLoad.current.request === request && comparisonRequest.current === comparing;
    setMaintenanceOriginal(null);
    setMaintenanceComparison(null);
    setVersionPair(pair);
    try {
      const comparison = await compareMaintenanceCase(platform, organizationId, caseId, from.publishedVersionId, to.publishedVersionId);
      if (current()) setMaintenanceComparison(comparison);
    } catch {
      if (current()) setMaintenanceComparison({ unavailable: true });
    }
  }, [platform, organizationId]);
  const moveVersionPair = useCallback((action: "previous" | "next" | "current") => {
    if (!maintenanceCase) return;
    const items = maintenanceVersions.current;
    const request = caseLoad.current.request;
    if (action === "current") {
      // The reported version against the applicable current version, even when they are not adjacent.
      const reportedIndex = items.findIndex((version) => version.publishedVersionId === maintenanceCase.publishedVersionId);
      const currentIndex = items.findIndex((version) => version.current);
      void applyVersionPair(maintenanceCase.caseId, items, reportedIndex, request, maintenanceCase.publishedVersionId, currentIndex);
      return;
    }
    const index = action === "previous" ? maintenancePairIndex.current - 1 : maintenancePairIndex.current + 1;
    void applyVersionPair(maintenanceCase.caseId, items, index, request, maintenanceCase.publishedVersionId);
  }, [maintenanceCase, applyVersionPair]);
  const openExactOriginal = useCallback((versionId: string, label: string) => {
    if (!maintenanceCase) return;
    const request = caseLoad.current.request;
    const caseId = maintenanceCase.caseId;
    void readMaintenanceOriginal(platform, organizationId, caseId, versionId)
      .then((result: MaintenanceOriginal) => {
        if (caseLoad.current.request !== request) return;
        setMaintenanceOriginal(result.unavailable
          ? { unavailable: true, label }
          : { unavailable: false, label, text: result.text });
      })
      .catch(() => { if (caseLoad.current.request === request) setMaintenanceOriginal({ unavailable: true, label }); });
  }, [maintenanceCase, organizationId, platform]);
  const openOriginal = (which: "earlier" | "later") => {
    const version = maintenanceVersions.current[which === "later" ? maintenancePairTo.current : maintenancePairIndex.current];
    if (version) openExactOriginal(version.publishedVersionId, `Version ${version.versionNo}`);
  };
  const openReported = () => {
    const pinned = maintenanceCase?.publishedVersionId;
    if (!pinned) return;
    const version = maintenanceVersions.current.find((item) => item.publishedVersionId === pinned);
    openExactOriginal(pinned, version ? `Version ${version.versionNo}` : "Reported version");
  };
  const openCitation = (versionId: string) => {
    const version = maintenanceVersions.current.find((item) => item.publishedVersionId === versionId);
    openExactOriginal(versionId, version ? `Version ${version.versionNo}` : "Cited version");
  };
  /** Reads a queued or running analysis until it settles; a newer start, another case or leaving stops it. */
  const followAnalysis = useCallback(async (caseId: string, request: number, waitFirst = false) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (waitFirst || attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (analysisEpoch.current !== request) return;
      }
      const next = await readMaintenanceAnalysis(platform, organizationId, caseId);
      if (analysisEpoch.current !== request) return;
      setAnalysisRun(next);
      if (next?.state !== "queued" && next?.state !== "running") return;
    }
  }, [platform, organizationId]);
  const clearMaintenanceCaseView = useCallback(() => {
    historyEpoch.current += 1;
    const request = startCaseLoad(caseLoad.current);
    analysisEpoch.current += 1;
    setMaintenanceCase(null);
    setMaintenanceHistory(null);
    setRelatedCases([]);
    setAnalysisRun(null);
    setMaintenanceComparison(null);
    setMaintenanceOriginal(null);
    setVersionPair(null);
    maintenanceVersions.current = [];
    setReviewerChoices([]);
    return request;
  }, []);
  const openMaintenanceCase = useCallback(async (caseId: string, surface: "reviews" | "reports") => {
    requestedCaseId.current = caseId;
    setCaseSurface(surface);
    const request = clearMaintenanceCaseView();
    const analysisRequest = analysisEpoch.current;
    setMaintenanceLoading(true);
    setMaintenanceError("");
    setMaintenanceActionError("");
    claimKey.current = null;
    decisionKey.current = null;
    publicationKey.current = null;
    reassignKey.current = null;
    messageRequest.current = null;
    publicationLinkKey.current = null;
    publicationRequestKey.current = null;
    linkKey.current = null;
    try {
      const [item, history] = await Promise.all([
        getMaintenanceCase(platform, organizationId, caseId),
        listMaintenanceHistory(platform, organizationId, caseId),
      ]);
      const loaded = caseLoadVisible(caseLoad.current, request, item, history);
      if (!loaded) return;
      setMaintenanceCase(loaded.item);
      setMaintenanceHistory(loaded.history);
      if (loaded.item.kind === "minimal") return;
      if (loaded.item.kind === "queue" || loaded.item.kind === "assigned") {
        try {
          const links = await listMaintenanceLinks(platform, organizationId, loaded.item.caseId);
          if (caseLoad.current.request !== request) return;
          setRelatedCases(links.items);
        } catch {
          if (caseLoad.current.request !== request) return;
          setRelatedCases([]);
        }
        if (loaded.item.kind === "assigned") {
          try {
            const run = await readMaintenanceAnalysis(platform, organizationId, loaded.item.caseId);
            if (caseLoad.current.request !== request) return;
            setAnalysisRun(run);
            if (run?.state === "queued" || run?.state === "running") {
              void followAnalysis(loaded.item.caseId, analysisRequest, true).catch(() => undefined);
            }
          } catch {
            if (caseLoad.current.request !== request) return;
            setAnalysisRun(null);
          }
        }
        try {
          const versions = await listMaintenanceVersions(platform, organizationId, loaded.item.caseId);
          if (caseLoad.current.request !== request) return;
          maintenanceVersions.current = versions.items;
          const reported = versions.items.findIndex((version) => version.publishedVersionId === loaded.item.publishedVersionId);
          const start = reported >= 0 && reported < versions.items.length - 1 ? reported : Math.max(0, reported - 1);
          await applyVersionPair(loaded.item.caseId, versions.items, start, request, loaded.item.publishedVersionId);
        } catch {
          if (caseLoad.current.request !== request) return;
          setVersionPair(null);
          setMaintenanceComparison({ unavailable: true });
        }
      }
      if (caseLoad.current.request !== request) return;
      if (!loaded.item.canReassign) setReviewerChoices([]);
      else {
        try {
          const choices = await listEligibleReviewers(platform, organizationId, loaded.item.caseId);
          if (caseLoad.current.request !== request) return;
          setReviewerChoices(choices);
        } catch {
          if (caseLoad.current.request !== request) return;
          setReviewerChoices([]);
        }
      }
    } catch (caught) {
      if (caseLoad.current.request === request) setMaintenanceError(errorMessage(caught));
    } finally { if (caseLoad.current.request === request) setMaintenanceLoading(false); }
  }, [platform, organizationId, applyVersionPair, followAnalysis, clearMaintenanceCaseView]);
  /** Applies a write's result only while its own case is still open; `request` is captured when the write starts. */
  const refreshMaintenance = useCallback(async (next: MaintenanceCase, request: number) => {
    if (caseLoad.current.request !== request || next.caseId !== requestedCaseId.current) return;
    const history = await listMaintenanceHistory(platform, organizationId, next.caseId);
    const loaded = caseLoadVisible(caseLoad.current, request, next, history);
    if (!loaded) return;
    historyEpoch.current += 1;
    setMaintenanceCase(loaded.item);
    setMaintenanceHistory(loaded.history);
  }, [platform, organizationId]);
  /**
   * After a failed action, shows the case as it is now without unmounting it, so typed notes survive. When the
   * caller's access changed, for example a removed reviewer grant, the case reopens so no loaded source stays.
   */
  const reloadMaintenanceInPlace = async (request: number, message: string) => {
    setMaintenanceActionError(message);
    const caseId = requestedCaseId.current;
    const previous = maintenanceCase;
    if (!caseId || caseLoad.current.request !== request) return;
    try {
      const [item, history] = await Promise.all([
        getMaintenanceCase(platform, organizationId, caseId),
        listMaintenanceHistory(platform, organizationId, caseId),
      ]);
      const loaded = caseLoadVisible(caseLoad.current, request, item, history);
      if (!loaded) return;
      if (!previous || previous.kind !== loaded.item.kind
        || Boolean(previous.needsReassignment) !== Boolean(loaded.item.needsReassignment)) {
        await openMaintenanceCase(caseId, caseSurface);
        if (requestedCaseId.current === caseId) setMaintenanceActionError(message);
        return;
      }
      historyEpoch.current += 1;
      setMaintenanceCase(loaded.item);
      setMaintenanceHistory(loaded.history);
    } catch (caught) {
      if (caseLoad.current.request !== request) return;
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
        clearMaintenanceCaseView();
        setMaintenanceLoading(false);
        setMaintenanceActionError("");
        setMaintenanceError(errorMessage(caught));
      }
      // A temporary reload failure keeps the current view and inline error.
    }
  };
  const leaveMaintenanceCase = () => {
    clearMaintenanceCaseView();
    requestedCaseId.current = null;
    setMaintenanceError(""); setMaintenanceActionError(""); setMaintenanceLoading(false);
  };
  const retryMaintenanceCase = (fallback: () => Promise<void>) => {
    if (requestedCaseId.current) void openMaintenanceCase(requestedCaseId.current, caseSurface);
    else void fallback();
  };
  /** One case write: stale results and errors never reach a different case opened meanwhile. */
  const runCaseWrite = (write: () => Promise<MaintenanceCase>, after?: (next: MaintenanceCase, request: number) => Promise<void>) => {
    const request = caseLoad.current.request;
    setBusy(true);
    setMaintenanceActionError("");
    void write()
      .then(async (next) => { await refreshMaintenance(next, request); await after?.(next, request); })
      .catch((caught) => {
        if (caseLoad.current.request === request) void reloadMaintenanceInPlace(request, caseActionError(caught));
      })
      .finally(() => setBusy(false));
  };
  const sendMaintenanceMessage = useCallback(async (text: string) => {
    if (!maintenanceCase?.revision) return;
    const { caseId, revision } = maintenanceCase;
    const request = caseLoad.current.request;
    if (messageRequest.current?.text !== text || messageRequest.current.caseId !== caseId) {
      messageRequest.current = { caseId, text, revision, key: crypto.randomUUID() };
    }
    const command = messageRequest.current;
    setBusy(true);
    setMaintenanceActionError("");
    try {
      const next = await postMaintenanceMessage(platform, organizationId, caseId, {
        expectedRevision: command.revision, message: text,
      }, command.key);
      if (caseLoad.current.request !== request) return;
      await refreshMaintenance(next, request);
      if (messageRequest.current === command) messageRequest.current = null;
    } catch (caught) {
      // Only a definite stale rejection lets us rebase without risking a duplicate message.
      if (messageRequest.current === command && caught instanceof ApiError && caught.code === "MAINTENANCE_STALE") {
        messageRequest.current = null;
      }
      if (caseLoad.current.request === request) void reloadMaintenanceInPlace(request, caseActionError(caught));
      throw caught;
    } finally { setBusy(false); }
  }, [maintenanceCase, platform, organizationId, refreshMaintenance, reloadMaintenanceInPlace]);
  useEffect(() => { setReportOpen(false); setMaintenanceCase(null); setMaintenanceHistory(null); setRelatedCases([]); setMaintenanceComparison(null); setVersionPair(null); setReviewerChoices([]); }, [organizationId]);
  useEffect(() => { if (libraryTab === "reports") void loadReports(); }, [libraryTab, loadReports]);
  useEffect(() => {
    if (view === "review-queue" && reviewSection === "maintenance" && (!maintenanceCase || caseSurface !== "reviews")) void loadMaintenanceQueue();
  }, [view, reviewSection, maintenanceCase, caseSurface, loadMaintenanceQueue]);

  useEffect(() => {
    let present = true;
    setLoading(true); setError("");
    void reload().catch((cause) => { if (present) setError(errorMessage(cause)); })
      .finally(() => { if (present) setLoading(false); });
    return () => { present = false; };
  }, [reload, createdDraftId]);

  useEffect(() => {
    if (!active) return;
    // Returning to the window refreshes Home at most every 30 seconds, so switching tabs or apps does not
    // refetch every list each time. Opening a document still rechecks access on its own.
    const onFocus = () => {
      if (Date.now() - lastReloadAt.current < focusReloadIntervalMs) return;
      void reload().catch(() => undefined);
    };
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

  const retryPublication = (submissionId: string) => void run(async () => {
    await retryKnowledgePublication(platform, organizationId, submissionId);
    setMessage("Publication restarted");
    await refresh();
  });

  const openReview = (id: string) => guardDiscard(Boolean(comment.trim()), () => { void run(async () => {
    const loaded = await loadKnowledgeReview(platform, organizationId, id);
    setReview(loaded); setComment(""); setCommentSubmitted(false); decisionRequest.current = null;
  }); });

  useEffect(() => {
    if (!requestedReviewId) { requestedReviewHandled.current = null; return; }
    if (!active || view !== "review-queue" || requestedReviewHandled.current === requestedReviewId) return;
    requestedReviewHandled.current = requestedReviewId;
    onReviewTargetHandled?.();
    openReview(requestedReviewId);
  }, [active, view, requestedReviewId, onReviewTargetHandled]);

  const requireDecisionReason = () => {
    setCommentSubmitted(true);
    if (comment.trim()) return true;
    decisionReason.current?.focus();
    return false;
  };
  const decide = (action: "APPROVE" | "REJECT") => void run(async () => {
    if (!review) return;
    const readers = action === "APPROVE" ? approvedReaders : null;
    const signature = readers ? JSON.stringify(readers) : "";
    // A retry reuses the key only for the same decision; changed readers are a different request.
    const existing = decisionRequest.current;
    const key = existing?.action === action && existing.readers === signature ? existing.key : crypto.randomUUID();
    decisionRequest.current = { action, readers: signature, key };
    const result = await decideKnowledgeReview(platform, organizationId, review, action, comment.trim() || null, key,
      readers ?? undefined);
    decisionRequest.current = null; setReview(null); setDecisionToConfirm(null);
    await refresh();
    setMessage(result.status === "APPROVED"
      ? reviewRequestPresentation(result.requestType ?? review.requestType).success
      : "Submission rejected");
  });

  // A newly opened submission starts at the top of its document, and a pending confirmation never carries over to it.
  useEffect(() => { reviewBodyRef.current?.scrollTo?.({ top: 0 }); setDecisionToConfirm(null); setApprovedReaders(null); }, [review?.id]);
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
    try {
      const loaded = await loadPublishedKnowledge(platform, organizationId, id);
      setOpenedCitation(null); setDocument(loaded); setScreen("document");
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) { home.forget(id); void home.refresh(); }
      throw cause;
    }
  });

  useEffect(() => {
    if (!active || view !== "knowledge" || !citationTarget || openedCitationId.current === citationTarget.navigationId) return;
    openedCitationId.current = citationTarget.navigationId;
    let present = true;
    let loading = false;
    const open = () => {
      if (!present) return;
      loading = true;
      setBusy(true); setError("");
      void loadPublishedKnowledge(platform, organizationId, citationTarget.versionId)
        .then((loaded) => {
          if (!present) return;
          if (loaded.id !== citationTarget.versionId) throw new Error("citation-version-mismatch");
          setLibraryTab(loaded.targetReaders?.mode === "ORGANIZATION" ? "organization"
            : loaded.targetReaders == null ? "other" : "shared");
          setOrganizationView("all");
          setOpenedCitation("documentId" in citationTarget ? citationTarget : null);
          setDocument(loaded); setScreen("document");
        })
        .catch(() => {
          if (!present) return;
          setOpenedCitation(null);
          setError("Source unavailable.");
        })
        .finally(() => { loading = false; if (present) setBusy(false); });
    };
    if ("kind" in citationTarget && unsaved) setDiscardAction(() => open);
    else open();
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
  const unsaved = (screen === "create" && creationDirty) || (screen === "editor" && dirty) || Boolean(review && comment.trim());
  useEffect(() => { onDirtyChange?.(unsaved); }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
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
  const readersReady = targetReadersComplete(editor?.targetReaders);
  const parsedEditor = editor ? parseSemanticDocument(editor.body) : null;
  const hasContent = Boolean(draft?.currentVersion.mimeType === "application/pdf" || (parsedEditor?.ok ? semanticDocumentHasText(parsedEditor.document) : editor?.body.trim()));
  const ready = Boolean(ownerDepartmentId && editor?.title.trim() && hasContent && readersReady && !metadataErrors.length && !versionAlreadyPublished);
  const departmentName = (id: string | null) => options?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const publicationDepartmentName = (item: PublishedKnowledge) =>
    item.responsibleDepartmentName?.trim() || departmentName(item.responsibleDepartmentId);
  /** Plain-language readers; member identities are never sent to the reader. */
  const publishedReadersLabel = (item: PublishedKnowledge): string | undefined => {
    const readers = item.targetReaders;
    if (!readers) return undefined;
    if (readers.mode === "ORGANIZATION") return "Whole organization";
    if (readers.mode === "SELECTED_MEMBERS") return "Selected members";
    const name = readers.departmentId === item.responsibleDepartmentId ? publicationDepartmentName(item)
      : options?.departments.find((entry) => entry.id === readers.departmentId)?.name;
    return name ? `${name} department` : "One department";
  };
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
  // T6.4: only a document with a current publication and no open request can ask for a reader change or withdrawal.
  const selectedContributionPublished = Boolean(selectedContribution && submissions.some(item => item.draftId === selectedContribution.id
    && item.status === "APPROVED" && item.publicationState === "ACTIVE"));
  const canRequestPublicationChange = selectedContributionPublished && !selectedContribution?.hasPendingSubmission
    && selectedContributionLatest?.status !== "PENDING_REVIEW";
  const pendingChangeRequest = selectedContributionLatest?.status === "PENDING_REVIEW"
    && selectedContributionLatest.requestType && selectedContributionLatest.requestType !== "CONTENT"
    ? selectedContributionLatest.requestType : null;
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
  const loadMoreHistory = () => {
    if (!maintenanceCase || !maintenanceHistory?.nextCursor) return;
    const request = caseLoad.current.request;
    const epoch = historyEpoch.current;
    const caseId = maintenanceCase.caseId;
    const cursor = maintenanceHistory.nextCursor;
    const current = maintenanceHistory.items;
    void listMaintenanceHistory(platform, organizationId, caseId, cursor)
      .then((page) => {
        // A refresh while this page loaded already has newer history; drop the stale page.
        if (caseLoad.current.request !== request || historyEpoch.current !== epoch) return;
        setMaintenanceHistory({ items: [...current, ...page.items], nextCursor: page.nextCursor });
      })
      .catch((caught) => { if (caseLoad.current.request === request) setMaintenanceActionError(errorMessage(caught)); });
  };
  const librarySearch = view === "knowledge" && screen === "library" && !managingCatalog && libraryTab !== "reports"
    ? <SearchField value={query} onChange={setQuery} placeholder={libraryTab === "drafts" ? "Filter my contributions…" : "Search documents…"} /> : undefined;
  const breadcrumb = view === "review-queue" ? `${organizationName} / Knowledge / Reviews${reviewSection === "maintenance" ? " / Maintenance" : ""}`
    : screen === "library" ? `${organizationName} / Home${libraryTab === "drafts" ? " / My Contributions" : libraryTab === "reports" ? " / My reports" : ""}`
      : screen === "create" ? `${organizationName} / Home / New draft`
        : `${organizationName} / Home / ${screen === "document" ? document?.title ?? "Publication" : draft?.title ?? "Draft"}`;

  return <main id={active ? "arden-main" : undefined} className="workspace-page" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={breadcrumb} contextOpen={contextOpen} onToggleContext={onToggleContext}
      search={librarySearch} searchActive={Boolean(librarySearch && query)} chrome={screen === "document" && document ? "reader" : "full"} />
    <div className={`knowledge-feature-page knowledge-live-page${view === "review-queue" && !loading ? " is-review" : ""}`}>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      {loading ? <div className="island island-empty" role="status">Loading documents…</div> : view === "review-queue" && reviewSection === "maintenance" ? <>
        <div className="island-seg maintenance-section-switch" role="group" aria-label="Review sections">
          <button type="button" aria-pressed={false} onClick={() => { setReviewSection("publication"); leaveMaintenanceCase(); }}>Publications</button>
          <button type="button" aria-pressed={true} onClick={() => setReviewSection("maintenance")}>Maintenance</button>
        </div>
        {(maintenanceCase || maintenanceLoading || maintenanceError) && caseSurface === "reviews" ? <MaintenanceCaseScreen key={maintenanceCase?.caseId ?? "maintenance-case"} item={maintenanceCase} history={maintenanceHistory}
          comparison={maintenanceComparison} versionPair={versionPair} onVersionPair={moveVersionPair}
          original={maintenanceOriginal} onOpenOriginal={openOriginal} onOpenReported={openReported}
          loading={maintenanceLoading} error={maintenanceError} actionError={maintenanceActionError} busy={busy} reviewers={reviewerChoices}
          analysis={analysisRun}
          onStartAnalysis={() => {
            if (!maintenanceCase?.publishedVersionId) return;
            const request = ++analysisEpoch.current;
            const pinnedVersion = maintenanceCase.publishedVersionId;
            const pairStart = maintenancePairIndex.current;
            const pairEnd = maintenancePairTo.current;
            const versionIds = maintenanceVersions.current
              .filter((version, index) => version.publishedVersionId === pinnedVersion
                || (versionPair && (index === pairStart || index === pairEnd)))
              .map((version) => version.publishedVersionId);
            if (!versionIds.includes(pinnedVersion)) versionIds.unshift(pinnedVersion);
            const evidence = [maintenanceCase.caseId, ...versionIds].join(":");
            if (analysisKey.current?.evidence !== evidence) analysisKey.current = { evidence, key: crypto.randomUUID() };
            setBusy(true);
            setMaintenanceActionError("");
            void startMaintenanceAnalysis(platform, organizationId, maintenanceCase.caseId, versionIds, analysisKey.current.key)
              .then(async (queued) => {
                if (analysisEpoch.current !== request) return;
                analysisKey.current = null;
                setAnalysisRun(queued);
                setBusy(false);
                await followAnalysis(maintenanceCase.caseId, request);
              })
              .catch((caught) => { if (analysisEpoch.current === request) setMaintenanceActionError(errorMessage(caught)); setBusy(false); });
          }}
          onOpenCitation={openCitation}
          onCancelAnalysis={() => {
            if (!maintenanceCase) return;
            const request = ++analysisEpoch.current;
            const key = crypto.randomUUID();
            setBusy(true);
            setMaintenanceActionError("");
            void cancelMaintenanceAnalysis(platform, organizationId, maintenanceCase.caseId, key)
              .then((next) => { if (analysisEpoch.current === request) setAnalysisRun(next); })
              .catch((caught) => { if (analysisEpoch.current === request) setMaintenanceActionError(errorMessage(caught)); })
              .finally(() => setBusy(false));
          }}
          relatedCases={relatedCases}
          onOpenRelated={(caseId) => void openMaintenanceCase(caseId, "reviews")}
          onLinkRelated={(relatedCaseId) => {
            if (!maintenanceCase) return;
            const caseId = maintenanceCase.caseId;
            const key = commandKey(linkKey, caseId, relatedCaseId);
            runCaseWrite(async () => {
              const next = await linkMaintenanceCase(platform, organizationId, caseId, relatedCaseId, key);
              linkKey.current = null;
              return next;
            }, async (next, request) => {
              const links = await listMaintenanceLinks(platform, organizationId, next.caseId);
              if (caseLoad.current.request === request) setRelatedCases(links.items);
            });
          }}
          onBack={leaveMaintenanceCase}
          onRetry={() => retryMaintenanceCase(loadMaintenanceQueue)}
          onMoreHistory={loadMoreHistory}
          onAsk={(message) => sendMaintenanceMessage(message)}
          onClaim={() => {
            if (!maintenanceCase?.revision) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(claimKey, caseId, revision);
            runCaseWrite(async () => {
              const next = await claimMaintenanceCase(platform, organizationId, caseId, revision, key);
              claimKey.current = null;
              return next;
            });
          }}
          onLinkPublicationRequest={(submissionId) => {
            if (!maintenanceCase?.revision) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(publicationRequestKey, caseId, revision, submissionId);
            runCaseWrite(async () => {
              const next = await linkMaintenancePublication(platform, organizationId, caseId, {
                expectedRevision: revision, submissionId, reason: "The author request applies to this report.",
              }, key);
              publicationRequestKey.current = null;
              return next;
            });
          }}
          onLinkPublication={() => {
            const evidence = maintenanceCase?.publicationProof?.publishedVersionId;
            if (!maintenanceCase?.revision || !evidence) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(publicationLinkKey, caseId, revision, evidence);
            runCaseWrite(async () => {
              const next = await linkMaintenancePublication(platform, organizationId, caseId, {
                expectedRevision: revision, publishedVersionId: evidence, reason: "The current publication applies to this report.",
              }, key);
              publicationLinkKey.current = null;
              return next;
            });
          }}
          onConfirmPublication={(explanation, rationale) => {
            const evidence = maintenanceCase?.publicationProof?.publishedVersionId;
            if (!maintenanceCase?.revision || !evidence) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(publicationKey, caseId, revision, evidence, explanation, rationale);
            runCaseWrite(async () => {
              const next = await confirmMaintenancePublication(platform, organizationId, caseId, {
                expectedRevision: revision, reporterExplanation: explanation, reviewerRationale: rationale,
                evidencePublishedVersionId: evidence,
              }, key);
              publicationKey.current = null;
              return next;
            });
          }}
          onResolve={(explanation, rationale) => {
            if (!maintenanceCase?.revision) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(decisionKey, caseId, revision, explanation, rationale);
            runCaseWrite(async () => {
              const next = await resolveMaintenanceCase(platform, organizationId, caseId, {
                expectedRevision: revision, reporterExplanation: explanation, reviewerRationale: rationale,
              }, key);
              decisionKey.current = null;
              return next;
            });
          }}
          onReassign={(membershipId, reason) => {
            if (!maintenanceCase?.revision) return;
            const { caseId, revision } = maintenanceCase;
            const key = commandKey(reassignKey, caseId, revision, membershipId, reason);
            runCaseWrite(async () => {
              const next = await reassignMaintenanceCase(platform, organizationId, caseId, {
                expectedRevision: revision, membershipId, reason,
              }, key);
              reassignKey.current = null;
              return next;
            });
          }} /> : <MaintenanceQueue items={maintenanceQueue} loading={maintenanceQueueLoading} error={maintenanceQueueError}
            onOpen={(caseId) => void openMaintenanceCase(caseId, "reviews")} onRetry={() => void loadMaintenanceQueue()} />}
      </> : view === "review-queue" && !review ? <>
        <div className="island-seg maintenance-section-switch" role="group" aria-label="Review sections">
          <button type="button" aria-pressed={true}>Publications</button>
          <button type="button" aria-pressed={false} onClick={() => setReviewSection("maintenance")}>Maintenance</button>
        </div>
        <PublicationReportsPanel platform={platform} organizationId={organizationId} departmentName={departmentName} />
        <ReviewList pending={reviews} decided={decidedReviews}
        departmentName={departmentName} busy={busy} onOpen={openReview} onRefresh={() => void refresh()} /></>
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
                  {review.requestType && review.requestType !== "CONTENT" && <>
                    <div><dt>Request</dt><dd>{reviewRequestPresentation(review.requestType).label}</dd></div>
                    <div><dt>Reason</dt><dd>{review.requestReason || "—"}</dd></div>
                  </>}
                  <div><dt>Department</dt><dd title={departmentName(review.responsibleDepartmentId)}>{departmentName(review.responsibleDepartmentId)}</dd></div>
                  {review.requestType !== "WITHDRAWAL" && <div><dt>Readers</dt><dd>{review.proposedTargetReaders ? targetReadersLabel(review.proposedTargetReaders, departmentName) : audienceNames(review.audienceIds)}</dd></div>}
                  {review.management ? <>
                    <div><dt>Type</dt><dd>{review.management.type ?? "—"}</dd></div>
                    <div><dt>Version</dt><dd>{review.management.version}</dd></div>
                    {review.management.expirationDate && <div><dt>Expiration Date</dt><dd>{review.management.expirationDate}</dd></div>}
                    {review.management.changeNote && <div><dt>Change Note</dt><dd>{review.management.changeNote}</dd></div>}
                  </> : <>
                    <div><dt>Within</dt><dd>{review.targetScopeType === "DEPARTMENT" ? departmentName(review.targetDepartmentId ?? review.responsibleDepartmentId) : "Across departments"}</dd></div>
                    <div><dt>Team / project</dt><dd>{review.teamTag || "All teams"} · {review.projectTag || "All projects"}</dd></div>
                  </>}
                </dl>
              </section>
              <ApprovedReadersField review={review} value={approvedReaders} departments={options?.departments ?? []}
                departmentName={departmentName} busy={busy} platform={platform} organizationId={organizationId}
                onChange={value => { setApprovedReaders(value); setDecisionToConfirm(null); }} />
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
                <strong id="review-confirm-title">{decisionToConfirm === "APPROVE" ? reviewRequestPresentation(review.requestType).title : "Reject this submission?"}</strong>
                <p id="review-confirm-body">{decisionToConfirm === "APPROVE"
                  ? reviewRequestPresentation(review.requestType).effect
                  : "Your note will be sent to the author."}
                  {decisionToConfirm === "APPROVE" && approvedReaders
                    && <> Readers: <strong>{approvedReadersLabel(approvedReaders, departmentName, review)}</strong>.</>}</p>
                {error && <p role="alert" className="knowledge-live-error">{error}</p>}
                <div className="review-decision-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => setDecisionToConfirm(null)}>Cancel</button>
                  <button type="button" className={decisionToConfirm === "REJECT" ? "admin-danger-button review-confirm-action" : "primary-button review-confirm-action"} disabled={busy}
                    onClick={() => decideAndAdvance(decisionToConfirm)}>{busy ? "Saving…" : decisionToConfirm === "APPROVE" ? "Approve" : "Reject"}</button>
                </div>
              </div> : <>
                <div className="review-decision-actions">
                  <button type="button" className="secondary-button review-reject" disabled={busy} onClick={() => { if (requireDecisionReason()) setDecisionToConfirm("REJECT"); }}>Reject</button>
                  <button type="button" className="primary-button review-approve" disabled={busy || activeReview?.approvalBlocked || !approvedReadersReady(approvedReaders)} onClick={() => setDecisionToConfirm("APPROVE")}><Icon name="check" size={14} />Approve</button>
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
            <KnowledgeMetadataFields value={editor.management} readers={editor.targetReaders}
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
          onAccessLost: () => { home.forget(document.id); void home.refresh(); setOpenedCitation(null); setDocument(null); setScreen("library"); setError("This document is unavailable."); } }}
        metadata={{
          title: document.title,
          ownerDepartment: publicationDepartmentName(document),
          summary: document.summary ?? "",
          type: document.management?.type ?? undefined,
          publishedDate: document.publishedAt, expirationDate: document.management?.expirationDate ?? undefined,
          readers: publishedReadersLabel(document),
          activeVersionId: document.id,
          versions: [{ id: document.id, label: document.management?.version || document.versionLabel || "",
            ...readerValidity(document) }],
        }}
        onBack={() => { readerReturnId.current = document.id; setOpenedCitation(null); setScreen("library"); }}
        surfaceActions={<>
          {readerPdfUrl && <a className="secondary-button" href={readerPdfUrl} download={pdfFileName(document.title)}><Icon name="download" size={13} />Download</a>}
          <button type="button" className="secondary-button" onClick={() => setReportOpen(true)}>
            <Icon name="flag" size={13} />Report an issue</button>
          {!drafts.some((draft) => draft.id === document.draftId)
            && <button type="button" className="secondary-button" onClick={() => setReviewOpen(true)}>Start review</button>}</>}
        content={document.mimeType === "application/pdf" && document.pdfBase64
          ? <PdfReader base64={document.pdfBase64} title={document.title} focus={openedCitation} />
          : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
            key={`published:${document.id}:${document.contentHash}`} body={document.body ?? ""}
            instanceKey={`published:${document.id}:${document.contentHash}`} /></Suspense>}
      /> : <>
        {awaitingAssignment && <p className="island-note knowledge-awaiting-assignment" role="status">
          Waiting for an admin to assign your department. You can read documents shared with the whole organization.</p>}
        <KnowledgeHeading eyebrow="KNOWLEDGE" title={libraryTab === "drafts" ? "My Contributions" : libraryTab === "reports" ? "My reports" : "Home"}
          description=""
          action={!managingCatalog && <div className="knowledge-live-actions"><button type="button" className="island-icon-button" aria-label="Refresh" title="Refresh" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={16} /></button>
            {catalog?.canManage && libraryTab === "organization" && (organizationView === "all" || query.trim() || home.views.organization.status !== "ready")
              && <button type="button" className="secondary-button" onClick={() => setManagingCatalog(true)}>Manage collections</button>}
            <button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button>
            <button type="button" className="primary-button" onClick={() => openCreate("pdf")}><Icon name="plus" size={14} />Create from PDF</button></div>} />
        {!managingCatalog && <KnowledgeHomeNavigation tab={libraryTab} onTab={setLibraryTab} views={home.views} draftCount={drafts.length}
          onPrivateNotes={onOpenPrivateNotes} canUsePrivateWorkspace={canUsePrivateWorkspace} />}
        {managingCatalog && catalog?.canManage ? <KnowledgeCatalogEditor platform={platform} organizationId={organizationId}
          catalog={catalog} publications={home.views.organization.items} publicationsUnavailable={home.views.organization.status === "error"}
          onSaved={reload} onClose={() => setManagingCatalog(false)} />
          : libraryTab !== "drafts" && libraryTab !== "reports" && <KnowledgeHomeBrowse source={source} state={{ ...home.views[source],
              items: home.views[source].items.map(item => ({ ...item, responsibleDepartmentName: publicationDepartmentName(item) })) }}
            catalog={catalog} catalogError={catalogError} query={query} filters={libraryFilters} onFilters={setLibraryFilters}
            organizationView={organizationView} onOrganizationView={value => { setOrganizationView(value); if (value === "overview") setQuery(""); }} onOpen={openPublished}
            onManage={() => setManagingCatalog(true)} onRetry={() => void home.refresh()} />}
        {!managingCatalog && libraryTab === "reports" && <section role="tabpanel" aria-labelledby="home-tab-reports">{(maintenanceCase || maintenanceLoading || maintenanceError) && caseSurface === "reports"
          ? <MaintenanceCaseScreen key={maintenanceCase?.caseId ?? "report-case"} item={maintenanceCase} history={maintenanceHistory} loading={maintenanceLoading} error={maintenanceError} actionError={maintenanceActionError} busy={busy}
            onBack={leaveMaintenanceCase}
            onRetry={() => retryMaintenanceCase(loadReports)}
            reviewers={reviewerChoices}
            onAsk={(message) => sendMaintenanceMessage(message)}
            onMoreHistory={loadMoreHistory} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined} />
          : <MyReports items={reports} loading={reportsLoading} error={reportsError}
            onOpen={(caseId) => void openMaintenanceCase(caseId, "reports")} onRetry={() => void loadReports()} />}</section>}
        {!managingCatalog && libraryTab === "drafts" && <section role="tabpanel" aria-labelledby="home-tab-drafts">{filteredDrafts.length ? <div className="island-split">
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
              {pendingChangeRequest && <><dt>Request</dt><dd>{reviewRequestPresentation(pendingChangeRequest).label} · awaiting review</dd></>}
            </dl>
            {selectedContributionLatest?.withdrawal && <blockquote className="island-box contribution-reason">
              <strong>{selectedContributionLatest.withdrawal.by === "REVIEWER" ? "Withdrawn by a reviewer" : "Withdrawn by an administrator"}</strong>
              <p>{selectedContributionLatest.withdrawal.reason}</p></blockquote>}
            {selectedContributionLatest?.status === "APPROVED" && selectedContributionLatest.publicationState === "FAILED"
              && <PublicationFailureNotice failure={selectedContributionLatest.publicationFailure ?? "SYSTEM"} busy={busy}
                onRetry={() => retryPublication(selectedContributionLatest.id)} />}
            <section className="island-detail-section" aria-label="History"><h3>History</h3>
              <DraftVersionHistory draftId={selectedContribution.id}
                versions={historyVersions?.draftId === selectedContribution.id ? historyVersions.items : null}
                error={historyError} currentVersion={selectedContribution.currentVersion} submissions={submissions}
                busy={busy} onOpen={openHistoryVersion} onRetry={() => setHistoryRetry((value) => value + 1)} />
            </section>
            {selectedContributionLatest?.status === "PENDING_REVIEW" && withdrawConfirmId === selectedContributionLatest.id
              && <div className="island-box contribution-withdraw" role="alertdialog" aria-labelledby="withdraw-title" aria-describedby="withdraw-body">
                <strong id="withdraw-title">Withdraw this review request?</strong>
                <p id="withdraw-body">{pendingChangeRequest
                  ? "Reviewers will no longer see this request. The published document does not change."
                  : "Reviewers will no longer see this version. Your draft stays, and you can submit it again."}</p>
                <div className="contribution-withdraw-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => setWithdrawConfirmId(null)}>Keep request</button>
                  <button type="button" className="secondary-button contribution-withdraw-confirm" disabled={busy} onClick={() => withdrawSubmission(selectedContributionLatest.id)}>{busy ? "Withdrawing…" : "Withdraw request"}</button>
                </div>
              </div>}
            <div className="island-side-footer contribution-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => openDraft(selectedContribution.id)}>Open draft</button>
              {selectedContributionLatest?.status === "PENDING_REVIEW" && withdrawConfirmId !== selectedContributionLatest.id
                && <button type="button" className="secondary-button" disabled={busy} onClick={() => setWithdrawConfirmId(selectedContributionLatest.id)}>Withdraw request</button>}
              {canRequestPublicationChange && <>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setChangeRequest("READER_CHANGE")}>Change readers</button>
                <button type="button" className="secondary-button contribution-withdraw-confirm" disabled={busy} onClick={() => setChangeRequest("WITHDRAWAL")}>Withdraw document</button>
              </>}
              </div>
          </aside>}
        </div> : <div className="island island-empty"><h3>{drafts.length ? "No matching drafts" : "No contributions yet"}</h3>{drafts.length > 0 && <p>Try another title.</p>}<button type="button" className="secondary-button" onClick={() => openCreate("text")}>New draft</button></div>}</section>}
      </>}
    </div>
    <ActionToast message={message} onDismiss={() => setMessage("")} />
    {reportOpen && document && <ReportIssueDialog title={document.title} versionLabel={document.management?.version || document.versionLabel || "Published version"}
      busy={busy} onClose={() => setReportOpen(false)} onViewReports={() => { setReportOpen(false); setScreen("library"); setLibraryTab("reports"); }}
      onSubmit={async (description, requestKey, anchor) => {
        setBusy(true);
        try {
          const created = await createMaintenanceCase(platform, organizationId, {
            documentId: document.draftId, publishedVersionId: document.id, description, anchor,
          }, requestKey);
          return created.caseId;
        } finally { setBusy(false); }
      }} />}
    {reviewOpen && document && <ReportIssueDialog purpose="review" title={document.title} versionLabel={document.management?.version || document.versionLabel || "Published version"}
      busy={busy} onClose={() => setReviewOpen(false)} onViewReports={(caseId) => {
        setReviewOpen(false); setReviewSection("maintenance"); onOpenReviews?.(); void openMaintenanceCase(caseId, "reviews");
      }}
      onSubmit={async (description, requestKey, anchor) => {
        setBusy(true);
        try {
          const created = await createMaintenanceCase(platform, organizationId, {
            origin: "REVIEWER_INTAKE", documentId: document.draftId, publishedVersionId: document.id, description, anchor,
          }, requestKey);
          return created.caseId;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 404) {
            throw new Error("Only a reviewer whose grant covers this document, and who didn't write it, can start a review.");
          }
          throw caught;
        } finally { setBusy(false); }
      }} />}
    {viewedVersion && <KnowledgeDialog title={`Version v${viewedVersion.version}`} onClose={() => setViewedVersion(null)}>
      <p className="island-meta">Saved {new Date(viewedVersion.createdAt).toLocaleString()} · Read only</p>
      <div className="knowledge-version-preview">
        {viewedVersion.mimeType === "application/pdf" && viewedVersion.pdfBase64
          ? <PdfDocument base64={viewedVersion.pdfBase64} title={`Version v${viewedVersion.version}`} showToolbar={false} />
          : <Suspense fallback={<DocumentSurfaceLoading />}><ArdenDocumentView
            key={viewedVersion.id} body={viewedVersion.body} instanceKey={viewedVersion.id} /></Suspense>}
      </div>
    </KnowledgeDialog>}
    {changeRequest && selectedContribution && <PublicationChangeDialog type={changeRequest} documentTitle={selectedContribution.title}
      documentId={selectedContribution.id} platform={platform} organizationId={organizationId}
      departments={options?.departments ?? []} onClose={() => setChangeRequest(null)}
      onSent={() => { const sent = changeRequest; setChangeRequest(null); setMessage(publicationChangeSentMessage(sent)); void refresh(); }} />}
    {discardAction && <DiscardChangesDialog exiting={false} onCancel={() => setDiscardAction(null)} onDiscard={() => {
      discardAction(); setDiscardAction(null);
    }} />}
  </main>;
}

const publicationFailureCopy = {
  TEMPORARY: "Arden couldn't prepare this approved version because a service was briefly unavailable. Try again; it won't need another review.",
  CONTENT: "Arden couldn't read this file. Fix it in the draft and submit it again.",
  SYSTEM: "Arden couldn't prepare this approved version because of a system problem. Trying again won't help; contact your administrator.",
} as const;

/** T6.3: why an approved version did not publish, and a retry only when trying again can help. */
function PublicationFailureNotice({ failure, busy, onRetry }: {
  failure: NonNullable<KnowledgeSubmission["publicationFailure"]>; busy: boolean; onRetry: () => void;
}) {
  return <div className="island-box publication-failure" role="status">
    <strong>Not published</strong>
    <p>{publicationFailureCopy[failure]}</p>
    {failure === "TEMPORARY" && <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>
      {busy ? "Trying again…" : "Try again"}</button>}
  </div>;
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

/** Names kept members when the reviewer narrowed a selected-member proposal. */
function approvedReadersLabel(readers: TargetReaders, departmentName: (id: string | null) => string,
  review: KnowledgeReviewDetail): string {
  if (readers.mode !== "SELECTED_MEMBERS") return targetReadersLabel(readers, departmentName);
  const names = new Map((review.proposedReaders?.members ?? []).map(member => [member.membershipId, member.displayName]));
  const known = readers.memberIds.map(id => names.get(id)).filter((name): name is string => Boolean(name));
  return known.length === readers.memberIds.length && known.length <= 3 ? known.join(", ") : targetReadersLabel(readers, departmentName);
}

const statusChipTone: Record<string, string> = { "is-info": "tone-info", "is-success": "tone-success", "is-danger": "tone-danger", "is-attention": "tone-warning" };
function chipTone(tone: string): string { return statusChipTone[tone] ?? ""; }
