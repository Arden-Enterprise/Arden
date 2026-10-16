export type DesktopApiRequest = {
  path: string;
  method: "GET" | "POST" | "PATCH";
  body?: string;
  ifMatch?: string;
  idempotencyKey?: string;
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${uuid}$`);
const privateDraftPath = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts(?:/${uuid})?$`);
const sharedDraftPath = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts$`);
const knowledgeCollection = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/(options|drafts|submissions|reviews|published|reviewer-grants)$`);
const reviewerGrantCollection = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviewer-grants$`);
const newKnowledgeDraft = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/new$`);
const pdfKnowledgeDraft = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/pdf$`);
const knowledgeDraftItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}$`);
const knowledgeDraftSubmit = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/drafts/${uuid}/submit$`);
const knowledgeReviewItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviews/${uuid}$`);
const knowledgeReviewDecision = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviews/${uuid}/decisions$`);
const publishedKnowledgeItem = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/published/${uuid}$`);
const reviewerGrantDeactivate = new RegExp(`^/api/v1/organizations/${uuid}/knowledge/reviewer-grants/${uuid}/deactivate$`);
const administrationPath = new RegExp(`^/api/v1/organizations/${uuid}/administration$`);
const adminCreatePath = new RegExp(`^/api/v1/organizations/${uuid}/(departments|roles|invitations)$`);
const adminMemberRolePath = new RegExp(`^/api/v1/organizations/${uuid}/members/${uuid}/(roles|department)$`);
const adminInvitationActionPath = new RegExp(`^/api/v1/organizations/${uuid}/invitations/${uuid}/(resend|revoke)$`);
const customRoleReadPath = new RegExp(`^/api/v1/organizations/${uuid}/(permissions|roles(?:/${uuid})?)$`);
const customRoleItemPath = new RegExp(`^/api/v1/organizations/${uuid}/roles/${uuid}$`);
const customRoleAssignPath = new RegExp(`^/api/v1/organizations/${uuid}/roles/${uuid}/assignments$`);
const customRoleRevokePath = new RegExp(`^/api/v1/organizations/${uuid}/roles/${uuid}/assignments/${uuid}/revoke$`);
const customRoleDeactivatePath = new RegExp(`^/api/v1/organizations/${uuid}/roles/${uuid}/deactivate$`);

export function validateDesktopApiRequest(value: unknown): value is DesktopApiRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["path", "method", "body", "ifMatch", "idempotencyKey"].includes(key))) return false;
  if (typeof request.path !== "string" || request.path.length > 2048 || !request.path.startsWith("/") || request.path.startsWith("//")) return false;
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PATCH") return false;
  const pdfUpload = typeof request.path === "string" && pdfKnowledgeDraft.test(request.path);
  if (request.body !== undefined && (typeof request.body !== "string" || Buffer.byteLength(request.body, "utf8") >
    (pdfUpload ? 7_100_000 : 128 * 1024))) return false;
  if (request.ifMatch !== undefined && (typeof request.ifMatch !== "string" || request.ifMatch.length > 80)) return false;
  if (request.idempotencyKey !== undefined && (typeof request.idempotencyKey !== "string" || !uuidPattern.test(request.idempotencyKey))) return false;
  return isAllowedRequest(request as DesktopApiRequest);
}

export function desktopApiResponseLimit(request: DesktopApiRequest): number {
  const pdfCreate = request.method === "POST" && pdfKnowledgeDraft.test(request.path);
  const knowledgeDetail = ((request.method === "GET" || request.method === "PATCH")
    && knowledgeDraftItem.test(request.path))
    || (request.method === "GET" && (knowledgeReviewItem.test(request.path)
      || publishedKnowledgeItem.test(request.path)));
  return pdfCreate || knowledgeDetail ? 7_100_000 : 1024 * 1024;
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
  const sharedDraftCreate = sharedDraftPath.test(url.pathname) && request.method === "POST" &&
    Boolean(request.body) && Boolean(request.idempotencyKey) && !request.ifMatch && !url.search;
  const knowledgeGet = (knowledgeCollection.test(url.pathname) || knowledgeDraftItem.test(url.pathname)
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
  const grantCreate = reviewerGrantCollection.test(url.pathname)
    && request.method === "POST" && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const grantDeactivate = reviewerGrantDeactivate.test(url.pathname) && request.method === "POST"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const adminGet = administrationPath.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const customRoleGet = customRoleReadPath.test(url.pathname) && request.method === "GET"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const customRolePatch = customRoleItemPath.test(url.pathname) && request.method === "PATCH"
    && Boolean(request.body) && typeof request.ifMatch === "string" && /^"role-[1-9][0-9]*"$/.test(request.ifMatch) && !request.idempotencyKey;
  const customRoleAssign = customRoleAssignPath.test(url.pathname) && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const customRoleRevoke = customRoleRevokePath.test(url.pathname) && request.method === "POST"
    && request.body === "{}" && !request.ifMatch && !request.idempotencyKey;
  const customRoleDeactivate = customRoleDeactivatePath.test(url.pathname) && request.method === "POST"
    && request.body === "{}" && typeof request.ifMatch === "string" && /^"role-[1-9][0-9]*"$/.test(request.ifMatch) && !request.idempotencyKey;
  const adminPost = (adminCreatePath.test(url.pathname) || adminMemberRolePath.test(url.pathname))
    && request.method === "POST" && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const adminAction = adminInvitationActionPath.test(url.pathname) && request.method === "POST"
    && !request.body && !request.ifMatch && !request.idempotencyKey;
  const accountPost = (url.pathname === "/api/v1/auth/sign-up" || url.pathname === "/api/v1/organizations"
    || url.pathname === "/api/v1/invitations/accept" || url.pathname === "/api/v1/auth/password") && request.method === "POST"
    && Boolean(request.body) && !request.ifMatch && !request.idempotencyKey;
  const otherRequest = (
    (url.pathname === "/api/v1/auth/sign-in" && request.method === "POST") ||
    (url.pathname === "/api/v1/auth/sign-out" && request.method === "POST") ||
    (url.pathname === "/api/v1/me" && request.method === "GET") ||
    privateDraftRequest
  ) && !request.idempotencyKey;
  const queryAllowed = collection && [...url.searchParams.keys()].every((key) => key === "limit" || key === "cursor");
  return (otherRequest || sharedDraftCreate || knowledgeGet || knowledgeCreate || knowledgePdfCreate || knowledgePatch
    || knowledgeSubmit || knowledgeDecision || grantCreate || grantDeactivate || adminGet
    || adminPost || adminAction || accountPost || customRoleGet || customRolePatch
    || customRoleAssign || customRoleRevoke || customRoleDeactivate) && (!url.search || queryAllowed);
}
