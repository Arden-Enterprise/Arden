export type DesktopApiRequest = {
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT";
  body?: string;
  ifMatch?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${uuid}$`);
const privateDraftPath = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts(?:/${uuid})?$`);
const privateNoteQuestionPath = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts/${uuid}/questions$`);
/** Decision 0034: original PDFs kept in Private (upload, read and replace the file). */
const privatePdfCreate = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts/pdf$`);
const privatePdfFile = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts/${uuid}/pdf$`);
/** Decision 0034: direct shares (owner list/share/revoke, recipient reads, organization setting). */
const directShareCollection = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts/${uuid}/shares$`);
const directShareRevoke = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts/${uuid}/shares/(${uuid}/revoke|revoke-all)$`);
const sharedWithMe = new RegExp(`^/api/v1/organizations/${uuid}/shared-with-me(?:/${uuid})?$`);
const sharedWithMePdf = new RegExp(`^/api/v1/organizations/${uuid}/shared-with-me/${uuid}/pdf$`);
const directSharingSetting = new RegExp(`^/api/v1/organizations/${uuid}/direct-sharing$`);
// Decision 0029 private notes organization: collections, favorites and trash; spec F03-ARR order and archive. No DELETE method.
const privateCollectionCollection = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/collections$`);
const privateCollectionItem = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/collections/${uuid}$`);
const privateFavoritePlacement = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/(drafts/${uuid}/(collection|favorite|archive)|collections/${uuid}/favorite)$`);
const privateItemAction = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/((drafts|collections)/${uuid}/(duplicate|trash)|trash/${uuid}/(restore|purge))$`);
const privateTrashCollection = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/(trash|archive)$`);
const sharedDraftPath = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts$`);
const knowledgeCollection = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/(options|drafts|submissions|reviews|published|reviewer-grants)$`);
const reviewerGrantCollection = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviewer-grants$`);
const newKnowledgeDraft = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/new$`);
const pdfKnowledgeDraft = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/pdf$`);
const knowledgeDraftItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}$`);
const knowledgeDraftVersions = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}/versions(?:/${uuid})?$`);
const knowledgeDraftVersionItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}/versions/${uuid}$`);
const knowledgeDraftSubmit = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}/submit$`);
const knowledgeSubmissionWithdraw = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/submissions/${uuid}/(withdraw|publication-retry)$`);
const knowledgeChangeRequest = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/documents/${uuid}/change-requests$`);
// Decision 0023 governance: reads, and actions that carry a reason or message body.
const governanceRead = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/(governance/publications|governance/inspections/${uuid}|documents/${uuid}/responsible-view|reports)$`);
const governanceWithBody = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/(governance/publications/${uuid}/inspections|documents/${uuid}/withdrawal|published/${uuid}/reports)$`);
const governanceDismiss = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reports/${uuid}/dismiss$`);
const knowledgeReviewItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviews/${uuid}$`);
const knowledgeReviewDecision = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviews/${uuid}/decisions$`);
const knowledgeReviewAi = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviews/${uuid}/ai-review$`);
const publishedKnowledgeItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/published/${uuid}$`);
const readerSummaryPath = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/published/${uuid}/summary$`);
const readerSummaryAccess = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/published/${uuid}/summary/access$`);
const readerQuestionPath = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/published/${uuid}/questions$`);
const knowledgeCatalogRead = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/catalog(?:/readers)?$`);
const knowledgeCatalogCreate = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/catalog/collections$`);
const knowledgeCatalogItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/catalog/collections/${uuid}$`);
const knowledgePlacement = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/catalog/placements/${uuid}$`);
const maintenanceCollection = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases$`);
const maintenanceCase = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}$`);
const maintenanceHistory = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/history$`);
const maintenanceReviewers = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/reviewers$`);
const maintenanceVersions = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/versions(?:/${uuid})?$`);
const maintenanceLinks = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/links$`);
const maintenanceAnalysis = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/analysis$`);
const maintenanceCommand = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/cases/${uuid}/(claim|reassign|decisions|compare|messages|publication-confirmation|publication-link|links|analysis|analysis-cancellation)$`);
const maintenanceImport = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/maintenance/imports$`);
const closedReportQuery = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reports$`);
const aiAnswerPath = new RegExp(`^/api/v1/organizations/${uuid}/ai/answers$`);
const writingActionPath = new RegExp(`^/api/v1/organizations/${uuid}/ai/writing-actions$`);
const aiConversationPath = new RegExp(`^/api/v1/organizations/${uuid}/ai/conversations(?:/${uuid})?$`);
const aiFeedbackPath = new RegExp(`^/api/v1/organizations/${uuid}/ai/conversations/${uuid}/turns/${uuid}/feedback$`);
const privateFeedbackPath = new RegExp(`^/api/v1/organizations/${uuid}/ai/private-feedback$`);
const reviewerGrantDeactivate = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviewer-grants/${uuid}/deactivate$`);
const administrationPath = new RegExp(`^/api/v1/organizations/${uuid}/administration$`);
const adminCreatePath = new RegExp(`^/api/v1/organizations/${uuid}/(departments|invitations)$`);
const adminMemberDepartmentPath = new RegExp(`^/api/v1/organizations/${uuid}/members/${uuid}/department$`);
const adminInvitationActionPath = new RegExp(`^/api/v1/organizations/${uuid}/invitations/${uuid}/(resend|revoke)$`);
const adminDepartmentActionPath = new RegExp(`^/api/v1/organizations/${uuid}/departments/${uuid}/delete$`);
const audienceGroupReadPath = new RegExp(`^/api/v1/organizations/${uuid}/audience-groups(?:/${uuid})?$`);
const audienceGroupItemPath = new RegExp(`^/api/v1/organizations/${uuid}/audience-groups/${uuid}$`);
const audienceGroupMemberPath = new RegExp(`^/api/v1/organizations/${uuid}/audience-groups/${uuid}/members$`);
const audienceGroupRemovePath = new RegExp(`^/api/v1/organizations/${uuid}/audience-groups/${uuid}/members/${uuid}/remove$`);
const audienceGroupDeactivatePath = new RegExp(`^/api/v1/organizations/${uuid}/audience-groups/${uuid}/deactivate$`);
const systemAdministratorCollection = /^\/api\/v1\/system\/administrators$/;
const systemPrivateFeedbackAnalytics = "/api/v1/system/analytics/private-feedback";
const systemAdministratorRevoke = new RegExp(`^/api/v1/system/administrators/${uuid}/revoke$`);
const invitationPreview = /^\/api\/v1\/invitations\/[A-Za-z0-9_-]{43}$/;
const notificationCollection = new RegExp(`^/api/v1/organizations/${uuid}/notifications$`);
const notificationRead = new RegExp(`^/api/v1/organizations/${uuid}/notifications/${uuid}/read$`);
const notificationReadAll = new RegExp(`^/api/v1/organizations/${uuid}/notifications/read-all$`);

export function validateDesktopApiRequest(value: unknown): value is DesktopApiRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["path", "method", "body", "ifMatch", "idempotencyKey", "timeoutMs"].includes(key))) return false;
  if (typeof request.path !== "string" || request.path.length > 2048 || !request.path.startsWith("/") || request.path.startsWith("//")) return false;
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PATCH" && request.method !== "PUT") return false;
  const pdfUpload = typeof request.path === "string" && (pdfKnowledgeDraft.test(request.path)
    || (request.method === "PATCH" && knowledgeDraftItem.test(request.path))
    || (request.method === "POST" && privatePdfCreate.test(request.path))
    || (request.method === "PUT" && privatePdfFile.test(request.path)));
  if (request.body !== undefined && (typeof request.body !== "string" || Buffer.byteLength(request.body, "utf8") >
    (pdfUpload ? 7_100_000 : 128 * 1024))) return false;
  if (request.ifMatch !== undefined && (typeof request.ifMatch !== "string" || request.ifMatch.length > 80)) return false;
  if (request.idempotencyKey !== undefined && (typeof request.idempotencyKey !== "string" || !uuidPattern.test(request.idempotencyKey))) return false;
  if (request.timeoutMs !== undefined && (typeof request.timeoutMs !== "number"
    || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1_000 || request.timeoutMs > 60_000)) return false;
  return isAllowedRequest(request as DesktopApiRequest);
}

export function desktopApiResponseLimit(request: DesktopApiRequest): number {
  const pdfCreate = request.method === "POST" && pdfKnowledgeDraft.test(request.path);
  const privatePdfRead = request.method === "GET" && (privatePdfFile.test(request.path) || sharedWithMePdf.test(request.path));
  const knowledgeDetail = ((request.method === "GET" || request.method === "PATCH")
    && (knowledgeDraftItem.test(request.path) || knowledgeDraftVersionItem.test(request.path)))
    || (request.method === "GET" && (knowledgeReviewItem.test(request.path)
      || publishedKnowledgeItem.test(request.path)));
  return pdfCreate || knowledgeDetail || privatePdfRead ? 7_100_000 : 1024 * 1024;
}

/** Reader deadlines are main-owned; other routes retain the validated renderer bound. */
export function desktopApiTimeout(request: DesktopApiRequest): number | undefined {
  if (request.method === "POST" && knowledgeReviewAi.test(request.path)) return 85_000;
  if (request.method === "POST" && writingActionPath.test(request.path)) return 90_000;
  if (request.method === "POST" && (readerQuestionPath.test(request.path) || privateNoteQuestionPath.test(request.path))) return 240_000;
  if (request.method === "POST" && readerSummaryPath.test(request.path)) return 300_000;
  if (request.method === "GET" && readerSummaryAccess.test(request.path)) return 30_000;
  return request.timeoutMs;
}

function reviewAiBody(body: string | undefined): boolean {
  if (!body || body.length > 200) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.keys(value).sort().join() === "snapshotContentHash,snapshotVersionId"
      && "snapshotVersionId" in value && typeof value.snapshotVersionId === "string" && uuidPattern.test(value.snapshotVersionId)
      && "snapshotContentHash" in value && typeof value.snapshotContentHash === "string"
      && /^[0-9a-f]{64}$/.test(value.snapshotContentHash);
  } catch { return false; }
}

function summaryBody(body: string | undefined): boolean {
  if (!body || body.length > 100) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.keys(value).join() === "requestId" && "requestId" in value
      && typeof value.requestId === "string" && uuidPattern.test(value.requestId);
  } catch { return false; }
}

function questionBody(body: string | undefined, versioned = false): boolean {
  if (!body || body.length > 25_000) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.keys(value).sort().join() === (versioned ? "expectedVersion,query,requestId" : "query,requestId")
      && (!versioned || ("expectedVersion" in value && typeof value.expectedVersion === "number"
        && Number.isInteger(value.expectedVersion) && value.expectedVersion >= 1 && value.expectedVersion <= 2_147_483_647))
      && "requestId" in value && "query" in value
      && typeof value.requestId === "string" && uuidPattern.test(value.requestId)
      && typeof value.query === "string" && Boolean(value.query.trim()) && Array.from(value.query).length <= 4_000;
  } catch { return false; }
}

function feedbackBody(body: string | undefined, privateAnswer: boolean): boolean {
  if (!body || body.length > (privateAnswer ? 200 : 60)) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.keys(value).length === (privateAnswer ? 2 : 1) && "feedback" in value
      && (!privateAnswer || ("token" in value && typeof value.token === "string"
        && /^[0-9a-f-]{36}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/.test(value.token)))
      && (value.feedback === "GOOD" || value.feedback === "BAD" || value.feedback === null);
  } catch { return false; }
}

function writingBody(body: string | undefined): boolean {
  if (!body || body.length > 25_000) return false;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const data = value as Record<string, unknown>;
    return Object.keys(data).sort().join() === "action,requestId,scope,text"
      && typeof data.requestId === "string" && uuidPattern.test(data.requestId)
      && ["IMPROVE", "REFORMAT", "EXPLAIN"].includes(String(data.action))
      && ["SELECTION", "PAGE"].includes(String(data.scope))
      && typeof data.text === "string" && Boolean(data.text.trim()) && data.text.length <= 12_000;
  } catch { return false; }
}

function isAllowedRequest(request: DesktopApiRequest): boolean {
  let url: URL;
  try { url = new URL(request.path, "https://arden.invalid"); }
  catch { return false; }
  if (url.origin !== "https://arden.invalid" || url.hash) return false;

  const isPrivateDraft = privateDraftPath.test(url.pathname);
  const collection = isPrivateDraft && url.pathname.endsWith("/drafts");
  const privateDraftRequest = isPrivateDraft && (
    (request.method === "GET" && !request.body && !request.ifMatch) ||
    (collection && request.method === "POST" && Boolean(request.body) && !request.ifMatch) ||
    (!collection && request.method === "PATCH" && Boolean(request.body) && Boolean(request.ifMatch))
  );
  const privateOrganizationRequest = !request.ifMatch && !request.idempotencyKey && !url.search && (
    ((privateCollectionCollection.test(url.pathname) || privateTrashCollection.test(url.pathname)) && request.method === "GET" && request.body === undefined)
    || (privateCollectionCollection.test(url.pathname) && request.method === "POST" && Boolean(request.body))
    || (privateCollectionItem.test(url.pathname) && request.method === "PATCH" && Boolean(request.body))
    || (privateFavoritePlacement.test(url.pathname) && request.method === "PUT" && Boolean(request.body))
    || (privateItemAction.test(url.pathname) && request.method === "POST" && (request.body === undefined || request.body === "{}")));
  const privatePdfRequest = !request.idempotencyKey && !url.search && (
    (privatePdfCreate.test(url.pathname) && request.method === "POST" && Boolean(request.body) && !request.ifMatch)
    || (privatePdfFile.test(url.pathname) && request.method === "GET" && request.body === undefined && !request.ifMatch)
    || (privatePdfFile.test(url.pathname) && request.method === "PUT" && Boolean(request.body) && Boolean(request.ifMatch)));
  const directShareRequest = !request.ifMatch && !request.idempotencyKey && !url.search && (
    ((directShareCollection.test(url.pathname) || sharedWithMe.test(url.pathname) || sharedWithMePdf.test(url.pathname)
      || directSharingSetting.test(url.pathname)) && request.method === "GET" && request.body === undefined)
    || (directShareCollection.test(url.pathname) && request.method === "POST" && Boolean(request.body))
    || (directShareRevoke.test(url.pathname) && request.method === "POST" && request.body === undefined)
    || (directSharingSetting.test(url.pathname) && request.method === "PUT" && Boolean(request.body)));
  const sharedDraftCreate = sharedDraftPath.test(url.pathname) && request.method === "POST" &&
    Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch && !url.search;
  const knowledgeGet = (knowledgeCollection.test(url.pathname) || knowledgeDraftItem.test(url.pathname)
    || knowledgeDraftVersions.test(url.pathname)
    || knowledgeReviewItem.test(url.pathname) || publishedKnowledgeItem.test(url.pathname))
    && request.method === "GET" && !request.body && !request.ifMatch && !request.idempotencyKey;
  const knowledgeCreate = newKnowledgeDraft.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch;
  const knowledgePdfCreate = pdfKnowledgeDraft.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch;
  const knowledgePatch = knowledgeDraftItem.test(url.pathname) && request.method === "PATCH"
    && Boolean(request.body) && Boolean(request.ifMatch) && !request.idempotencyKey;
  const knowledgeSubmit = knowledgeDraftSubmit.test(url.pathname) && request.method === "POST"
    && !request.body && Boolean(request.ifMatch) && Boolean(request.idempotencyKey);
  const knowledgeDecision = knowledgeReviewDecision.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch;
  // T5.1 withdrawal and T6.3 publication retry: bodyless author actions that are idempotent by state.
  const knowledgeWithdraw = knowledgeSubmissionWithdraw.test(url.pathname) && request.method === "POST"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  // T6.1/T6.4: an author's reader-change or withdrawal request carries a body and an idempotency key.
  const knowledgeChange = knowledgeChangeRequest.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch;
  const reportCursors = url.searchParams.getAll("cursor");
  const closedReports = closedReportQuery.test(url.pathname)
    && [...url.searchParams.keys()].every((key) => key === "disposition" || key === "cursor")
    && url.searchParams.getAll("disposition").length === 1 && url.searchParams.get("disposition") === "closed"
    && reportCursors.length <= 1 && reportCursors.every((value) => new RegExp(`^${uuid}$`, "i").test(value));
  const governance = (governanceRead.test(url.pathname) && request.method === "GET" && !request.body && (!url.search || closedReports))
    || (governanceWithBody.test(url.pathname) && request.method === "POST" && Boolean(request.body))
    || (governanceDismiss.test(url.pathname) && request.method === "POST" && !request.body);
  const governanceAllowed = governance && !request.ifMatch && !request.idempotencyKey;
  const grantCreate = reviewerGrantCollection.test(url.pathname)
    && request.method === "POST" && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const grantDeactivate = reviewerGrantDeactivate.test(url.pathname) && request.method === "POST"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const aiAnswer = aiAnswerPath.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const writingAction = writingActionPath.test(url.pathname) && request.method === "POST" && !url.search
    && writingBody(request.body) && !request.ifMatch && !request.idempotencyKey && request.timeoutMs === undefined;
  const reviewAi = knowledgeReviewAi.test(url.pathname) && request.method === "POST" && !url.search
    && reviewAiBody(request.body) && !request.ifMatch && !request.idempotencyKey && request.timeoutMs === undefined;
  const aiConversationGet = aiConversationPath.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const privateAnswerFeedback = privateFeedbackPath.test(url.pathname);
  const aiFeedback = (aiFeedbackPath.test(url.pathname) || privateAnswerFeedback) && request.method === "PUT" && !url.search
    && !request.ifMatch && !request.idempotencyKey && feedbackBody(request.body, privateAnswerFeedback);
  const readerSummary = ((readerSummaryPath.test(url.pathname) && request.method === "POST" && summaryBody(request.body))
    || (readerQuestionPath.test(url.pathname) && request.method === "POST" && questionBody(request.body))
    || (privateNoteQuestionPath.test(url.pathname) && request.method === "POST" && !url.search && questionBody(request.body, true))
    || (readerSummaryAccess.test(url.pathname) && request.method === "GET" && request.body === undefined))
    && !request.ifMatch && !request.idempotencyKey && request.timeoutMs === undefined;
  const adminGet = administrationPath.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const audienceGroupGet = audienceGroupReadPath.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const audienceGroupPatch = audienceGroupItemPath.test(url.pathname) && request.method === "PATCH"
    && Boolean(request.body) && typeof request.ifMatch === "string" && /^"audience-group-[1-9][0-9]*"$/.test(request.ifMatch) && !request.idempotencyKey;
  const audienceGroupAddMember = audienceGroupMemberPath.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const audienceGroupRemoveMember = audienceGroupRemovePath.test(url.pathname) && request.method === "POST"
    && request.body === "{}" && !request.ifMatch && !request.idempotencyKey;
  const audienceGroupDeactivate = audienceGroupDeactivatePath.test(url.pathname) && request.method === "POST"
    && request.body === "{}" && typeof request.ifMatch === "string" && /^"audience-group-[1-9][0-9]*"$/.test(request.ifMatch) && !request.idempotencyKey;
  const systemAdministrationGet = (systemAdministratorCollection.test(url.pathname) || url.pathname === systemPrivateFeedbackAnalytics) && request.method === "GET"
    && !url.search && !request.body && !request.ifMatch && !request.idempotencyKey;
  const systemAdministrationGrant = systemAdministratorCollection.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const systemAdministrationRevoke = systemAdministratorRevoke.test(url.pathname) && request.method === "POST"
    && request.body === "{}" && !request.ifMatch && !request.idempotencyKey;
  const adminPost = (adminCreatePath.test(url.pathname) || adminMemberDepartmentPath.test(url.pathname))
    && request.method === "POST" && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const adminAction = ((adminInvitationActionPath.test(url.pathname) && !request.body)
    || (adminDepartmentActionPath.test(url.pathname) && (!request.body || request.body === "{}")))
    && request.method === "POST" && !request.ifMatch && !request.idempotencyKey;
  const accountPost = (url.pathname === "/api/v1/auth/sign-up" || url.pathname === "/api/v1/organizations"
    || url.pathname === "/api/v1/invitations/accept" || url.pathname === "/api/v1/auth/password"
    || url.pathname === "/api/v1/auth/change-password") && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const invitationGet = invitationPreview.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const notificationsGet = notificationCollection.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey && notificationQuery(url);
  const notificationReadRequest = notificationRead.test(url.pathname) && request.method === "PATCH"
    && !url.search && !request.body && !request.ifMatch && !request.idempotencyKey;
  const notificationReadAllRequest = notificationReadAll.test(url.pathname) && request.method === "POST"
    && !url.search && !request.body && !request.ifMatch && !request.idempotencyKey;
  const otherRequest = (
    (url.pathname === "/api/v1/auth/sign-in" && request.method === "POST") ||
    (url.pathname === "/api/v1/auth/sign-out" && request.method === "POST") ||
    (url.pathname === "/api/v1/me" && request.method === "GET") ||
    privateDraftRequest || privatePdfRequest || directShareRequest
  ) && !request.idempotencyKey;
  const queryAllowed = collection && [...url.searchParams.keys()].every((key) => key === "limit" || key === "cursor");
  const catalogGet = knowledgeCatalogRead.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const placementGet = knowledgePlacement.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const placementPatch = knowledgePlacement.test(url.pathname) && request.method === "PATCH"
    && Boolean(request.body) && typeof request.ifMatch === "string" && /^"placement-(0|[1-9][0-9]*)"$/.test(request.ifMatch)
    && Number.isSafeInteger(Number(request.ifMatch.slice(11, -1))) && !request.idempotencyKey;
  const catalogPost = knowledgeCatalogCreate.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const catalogPatch = knowledgeCatalogItem.test(url.pathname) && request.method === "PATCH"
    && Boolean(request.body) && typeof request.ifMatch === "string" && /^"catalog-[1-9][0-9]*"$/.test(request.ifMatch) && !request.idempotencyKey;
  const catalogQuery = catalogGet && url.pathname.endsWith("/readers")
    && [...url.searchParams.keys()].every(key => key === "q" || key === "ids");
  const publicationScopeQuery = knowledgeGet && url.pathname.endsWith("/knowledge/published")
    && [...url.searchParams.keys()].every(key => key === "scope")
    && url.searchParams.getAll("scope").length === 1
    && ["ALL_READABLE", "ORGANIZATION", "SHARED"].includes(url.searchParams.get("scope") ?? "");
  const maintenanceList = maintenanceCollection.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey
    && [...url.searchParams.keys()].every((key) => key === "scope")
    && (url.searchParams.get("scope") === "mine" || url.searchParams.get("scope") === "queue");
  const maintenanceCreate = maintenanceCollection.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch && !url.search;
  const maintenanceRead = (maintenanceCase.test(url.pathname) || maintenanceHistory.test(url.pathname) || maintenanceReviewers.test(url.pathname) || maintenanceVersions.test(url.pathname) || maintenanceLinks.test(url.pathname) || maintenanceAnalysis.test(url.pathname))
    && request.method === "GET" && !request.body && !request.ifMatch && !request.idempotencyKey
    && (!url.search || (maintenanceHistory.test(url.pathname) && [...url.searchParams.keys()].every((key) => key === "cursor")));
  const maintenanceImportPost = maintenanceImport.test(url.pathname) && request.method === "POST"
    && !request.body && !request.ifMatch && !request.idempotencyKey && !url.search;
  const maintenanceWrite = maintenanceCommand.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch && !url.search;
  return (privateOrganizationRequest || placementGet || placementPatch || catalogGet || catalogPost || catalogPatch || otherRequest || sharedDraftCreate || knowledgeGet || knowledgeCreate || knowledgePdfCreate || knowledgePatch
    || knowledgeSubmit || knowledgeDecision || knowledgeWithdraw || knowledgeChange || governanceAllowed || grantCreate || grantDeactivate || aiAnswer || writingAction || reviewAi || aiConversationGet || aiFeedback || readerSummary || adminGet
    || adminPost || adminAction || accountPost || invitationGet || audienceGroupGet || audienceGroupPatch
    || audienceGroupAddMember || audienceGroupRemoveMember || audienceGroupDeactivate
    || maintenanceImportPost || maintenanceList || maintenanceCreate || maintenanceRead || maintenanceWrite
    || systemAdministrationGet || systemAdministrationGrant || systemAdministrationRevoke
    || notificationsGet || notificationReadRequest || notificationReadAllRequest)
    && (!url.search || queryAllowed || catalogQuery || notificationsGet || publicationScopeQuery || maintenanceList || maintenanceRead || closedReports);
}

function notificationQuery(url: URL): boolean {
  const allowed = new Set(["cursor", "unreadOnly", "limit"]);
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
    if (key === "cursor" && (!/^[A-Za-z0-9_-]{1,180}$/.test(value))) return false;
    if (key === "unreadOnly" && value !== "true" && value !== "false") return false;
    if (key === "limit" && (!/^[1-9][0-9]?$/.test(value) || Number(value) > 50)) return false;
  }
  return true;
}
