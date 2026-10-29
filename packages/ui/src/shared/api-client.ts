import type { Platform } from "./types";
import { parseAudienceGroup, parseAudienceGroupList, type AudienceGroupRecord,
  type AudienceGroupWrite } from "./audience-group-contracts";
import type {} from "./desktop-session";
import { isKnowledgeClassification, type KnowledgeClassification } from "./knowledge-classification";

export type OrganizationMembership = {
  organization: { id: string; name: string };
  status: string;
  roleCodes: string[];
  canUsePrivateWorkspace: boolean;
};
export type CurrentSession = {
  actor: { id: string; email?: string };
  account: { passwordSetupRequired: boolean };
  memberships: OrganizationMembership[];
  testMode?: boolean;
};
export type OrganizationAdministration = {
  departments: Array<{ id: string; name: string; defaultRoleId: string; defaultRoleName: string }>;
  roles: Array<{ id: string; name: string; code: string; isDefault: boolean }>;
  members: Array<{ id: string; email: string; name: string; status: string; departmentId: string | null; departmentIds?: string[]; roleIds: string[]; roleNames: string[] }>;
  invitations: Array<{ id: string; email: string; departmentId: string; status: string; expiresAt: string }>;
};

export type CreatedKnowledgeDraft = {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  classification: KnowledgeClassification;
  version: number;
};

export type KnowledgeOptions = {
  departments: Array<{ id: string; name: string }>;
  /**
   * The member's primary department, which owns and reviews their drafts (decision 0014). Undefined means the
   * server predates that rule and still expects the author to choose a responsible department.
   */
  primaryDepartmentId?: string | null;
  /** Undefined means the server predates organization-scoped reviewer grants. */
  organizationReviewerAvailable?: boolean;
  audiences: Array<{ id: string; name: string; departmentId: string | null;
    kind: "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP" }>;
};
export type KnowledgeDraftRecord = {
  id: string;
  organizationId: string;
  title: string;
  classification: KnowledgeClassification;
  status: "ACTIVE";
  hasPendingSubmission: boolean;
  body: string;
  pdfBase64?: string;
  responsibleDepartmentId: string | null;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT" | null;
  teamTag: string | null;
  projectTag: string | null;
  audienceIds: string[];
  currentVersion: { id: string; version: number; mimeType: "text/plain" | "application/pdf"; contentHash: string };
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeDraftSummary = {
  id: string;
  organizationId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string | null;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT" | null;
  teamTag: string | null;
  projectTag: string | null;
  audienceIds: string[];
  versionId: string;
  mimeType: "text/plain" | "application/pdf";
  contentHash: string;
  currentVersion: number;
  hasPendingSubmission: boolean;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeSubmission = {
  id: string;
  draftId: string;
  snapshotVersionId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT";
  targetDepartmentId: string | null;
  audienceIds: string[];
  contentHash: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  publicationState: "NONE" | "PREPARING" | "ACTIVE" | "FAILED";
  submittedAt: string;
  publishedVersionId: string | null;
  decisionComment: string | null;
};
export type AssignedKnowledgeReview = {
  submissionId: string;
  snapshotId: string;
  title: string;
  departmentId: string;
  classification: KnowledgeClassification;
  submittedAt: string;
  approvalBlocked: boolean;
};
export type KnowledgeReviewDetail = KnowledgeSubmission & {
  body: string;
  mimeType: "text/plain" | "application/pdf";
  pdfBase64?: string;
  submittedByMembershipId: string;
  teamTag: string | null;
  projectTag: string | null;
};
export type PublishedKnowledge = {
  id: string;
  draftId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  documentCode?: string;
  versionLabel?: string;
  summary?: string;
  audienceIds: string[];
  contentHash: string;
  publishedAt: string;
  validFrom: string;
  validUntil: string | null;
  body?: string;
  mimeType?: "text/plain" | "application/pdf";
  pdfBase64?: string;
};
export type ReviewerGrant = {
  id: string;
  reviewerMembershipId: string;
  scope: "DEPARTMENT" | "ORGANIZATION";
  departmentId: string | null;
  classifications: KnowledgeClassification[];
  level: "STANDARD" | "SPECIALIST" | "SENIOR";
  teamTag: string | null;
  projectTag: string | null;
  validFrom: string;
  validUntil: string | null;
  status: "ACTIVE" | "INACTIVE";
};

function knowledgePath(organizationId: string): string {
  return `/api/v1/organizations/${organizationId}/knowledge`;
}

export function loadKnowledgeOptions(platform: Platform, organizationId: string): Promise<KnowledgeOptions> {
  return request(platform, `${knowledgePath(organizationId)}/options`);
}

export async function listKnowledgeDrafts(platform: Platform, organizationId: string): Promise<KnowledgeDraftSummary[]> {
  // The list route returns the repository shape (`audienceRoleIds`), unlike the detail route (`audienceIds`).
  // Normalize here so screens never receive an undefined audience list.
  const result = await request<{ items: (Omit<KnowledgeDraftSummary, "audienceIds"> & { audienceIds?: string[] | null; audienceRoleIds?: string[] | null })[] }>(
    platform, `${knowledgePath(organizationId)}/drafts`);
  return result.items.map(({ audienceRoleIds, audienceIds, ...item }) => ({ ...item, audienceIds: audienceIds ?? audienceRoleIds ?? [] }));
}

export function loadKnowledgeDraft(platform: Platform, organizationId: string, draftId: string): Promise<KnowledgeDraftRecord> {
  return request(platform, `${knowledgePath(organizationId)}/drafts/${draftId}`);
}

export function createNewKnowledgeDraft(platform: Platform, organizationId: string,
  // Decision 0013: classification is optional; the server defaults a new draft to INTERNAL.
  input: { title: string; body: string; classification?: KnowledgeClassification }, idempotencyKey: string): Promise<KnowledgeDraftRecord> {
  return request(platform, `${knowledgePath(organizationId)}/drafts/new`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export async function createPdfKnowledgeDraft(platform: Platform, organizationId: string,
  input: { title: string; file: File; classification?: KnowledgeClassification }, idempotencyKey: string): Promise<KnowledgeDraftRecord> {
  if (!/\.pdf$/i.test(input.file.name) || input.file.size === 0 || input.file.size > 5 * 1024 * 1024) {
    throw new ApiError(0, "Choose a PDF file up to 5 MB.");
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return request(platform, `${knowledgePath(organizationId)}/drafts/pdf`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ title: input.title, classification: input.classification, pdfBase64: btoa(binary) }),
  });
}

export function saveKnowledgeDraft(platform: Platform, organizationId: string, draftId: string, version: number,
  patch: Partial<Pick<KnowledgeDraftRecord, "title" | "body" | "classification" | "responsibleDepartmentId" | "targetScopeType" | "teamTag" | "projectTag" | "audienceIds">>): Promise<KnowledgeDraftRecord> {
  return request(platform, `${knowledgePath(organizationId)}/drafts/${draftId}`, {
    method: "PATCH", headers: { "If-Match": `"${version}"` }, body: JSON.stringify(patch),
  });
}

export function submitKnowledgeDraft(platform: Platform, organizationId: string, draftId: string,
  version: number, idempotencyKey: string): Promise<KnowledgeSubmission> {
  return request(platform, `${knowledgePath(organizationId)}/drafts/${draftId}/submit`, {
    method: "POST", headers: { "If-Match": `"${version}"`, "Idempotency-Key": idempotencyKey },
  });
}

export async function listKnowledgeSubmissions(platform: Platform, organizationId: string): Promise<KnowledgeSubmission[]> {
  const result = await request<{ items: KnowledgeSubmission[] }>(platform, `${knowledgePath(organizationId)}/submissions`);
  return result.items;
}

export async function listAssignedKnowledgeReviews(platform: Platform, organizationId: string): Promise<AssignedKnowledgeReview[]> {
  const result = await request<{ items: AssignedKnowledgeReview[] }>(platform, `${knowledgePath(organizationId)}/reviews`);
  return result.items;
}

export function loadKnowledgeReview(platform: Platform, organizationId: string, submissionId: string): Promise<KnowledgeReviewDetail> {
  return request(platform, `${knowledgePath(organizationId)}/reviews/${submissionId}`);
}

export function decideKnowledgeReview(platform: Platform, organizationId: string, detail: KnowledgeReviewDetail,
  action: "APPROVE" | "REJECT", comment: string | null, idempotencyKey: string): Promise<KnowledgeSubmission> {
  return request(platform, `${knowledgePath(organizationId)}/reviews/${detail.id}/decisions`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ action, expectedSnapshotVersionId: detail.snapshotVersionId,
      expectedContentHash: detail.contentHash, comment }),
  });
}

export async function listPublishedKnowledge(platform: Platform, organizationId: string): Promise<PublishedKnowledge[]> {
  const result = await request<{ items: PublishedKnowledge[] }>(platform, `${knowledgePath(organizationId)}/published`);
  return result.items;
}

export function loadPublishedKnowledge(platform: Platform, organizationId: string, publishedVersionId: string): Promise<PublishedKnowledge> {
  return request(platform, `${knowledgePath(organizationId)}/published/${publishedVersionId}`);
}

export async function listReviewerGrants(platform: Platform, organizationId: string): Promise<ReviewerGrant[]> {
  const result = await request<{ items: ReviewerGrant[] }>(platform, `${knowledgePath(organizationId)}/reviewer-grants`);
  return result.items;
}

export function createReviewerGrant(platform: Platform, organizationId: string,
  input: Pick<ReviewerGrant, "reviewerMembershipId" | "scope" | "departmentId" | "teamTag" | "projectTag" | "validUntil">): Promise<ReviewerGrant> {
  return request(platform, `${knowledgePath(organizationId)}/reviewer-grants`, { method: "POST", body: JSON.stringify(input) });
}

export function deactivateReviewerGrant(platform: Platform, organizationId: string, grantId: string): Promise<void> {
  return request(platform, `${knowledgePath(organizationId)}/reviewer-grants/${grantId}/deactivate`, { method: "POST" });
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

export async function signIn(platform: Platform, email: string, password: string): Promise<CurrentSession> {
  await request<unknown>(platform, "/api/v1/auth/sign-in", {
    method: "POST", body: JSON.stringify({ email, password }),
  });
  return currentSession(platform);
}

export async function beginGoogleSignIn(platform: Platform): Promise<CurrentSession | null> {
  if (platform === "web") {
    window.location.assign("/api/v1/auth/google/start?client=web");
    return null;
  }
  await requireDesktopBridge().startGoogleSignIn();
  return currentSession(platform);
}

export async function setAccountPassword(platform: Platform, password: string): Promise<CurrentSession> {
  await request(platform, "/api/v1/auth/password", {
    method: "POST", body: JSON.stringify({ password }),
  });
  return currentSession(platform);
}

export async function restoreSession(platform: Platform): Promise<CurrentSession | null> {
  try { return await currentSession(platform); }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOut(platform: Platform): Promise<void> {
  if (platform === "web") {
    await request(platform, "/api/v1/auth/sign-out", { method: "POST" });
    return;
  }
  const bridge = requireDesktopBridge();
  try { await request(platform, "/api/v1/auth/sign-out", { method: "POST" }); }
  finally { await bridge.clearSession(); }
}

export async function currentSession(platform: Platform): Promise<CurrentSession> {
  const session = await request<Omit<CurrentSession, "account"> & {
    account?: { passwordSetupRequired?: boolean };
  }>(platform, "/api/v1/me");
  return {
    ...session,
    account: { passwordSetupRequired: session.account?.passwordSetupRequired === true },
  };
}

export async function createOrganization(platform: Platform, name: string, departmentName: string): Promise<void> {
  await request(platform, "/api/v1/organizations", {
    method: "POST", body: JSON.stringify({ name, departmentName }),
  });
}

export async function signUp(platform: Platform, email: string, password: string, fullName: string): Promise<void> {
  await request(platform, "/api/v1/auth/sign-up", {
    method: "POST", body: JSON.stringify({ email, password, fullName }),
  });
}

export async function acceptInvitation(platform: Platform, token: string): Promise<void> {
  await request(platform, "/api/v1/invitations/accept", {
    method: "POST", body: JSON.stringify({ token }),
  });
}

export async function loadOrganizationAdministration(platform: Platform, organizationId: string): Promise<OrganizationAdministration> {
  return request(platform, `/api/v1/organizations/${organizationId}/administration`);
}

export async function createDepartment(platform: Platform, organizationId: string, name: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/departments`, { method: "POST", body: JSON.stringify({ name }) });
}

export async function loadAudienceGroups(platform: Platform, organizationId: string): Promise<AudienceGroupRecord[]> {
  return parseAudienceGroupList(await request<unknown>(platform, `/api/v1/organizations/${organizationId}/audience-groups`));
}
export async function saveAudienceGroup(platform: Platform, organizationId: string,
  existing: AudienceGroupRecord | null, write: AudienceGroupWrite): Promise<AudienceGroupRecord> {
  return parseAudienceGroup(await request<unknown>(platform,
    `/api/v1/organizations/${organizationId}/audience-groups${existing ? "/" + existing.id : ""}`, {
    method: existing ? "PATCH" : "POST", body: JSON.stringify(write),
    headers: existing ? { "If-Match": `"audience-group-${existing.version}"` } : {},
  }));
}
export async function addAudienceGroupMember(platform: Platform, organizationId: string,
  audienceGroupId: string, membershipId: string): Promise<AudienceGroupRecord> {
  return parseAudienceGroup(await request<unknown>(platform,
    `/api/v1/organizations/${organizationId}/audience-groups/${audienceGroupId}/members`, {
    method: "POST", body: JSON.stringify({ membershipId }),
  }));
}
export async function removeAudienceGroupMember(platform: Platform, organizationId: string,
  audienceGroupId: string, groupMembershipId: string): Promise<AudienceGroupRecord> {
  return parseAudienceGroup(await request<unknown>(platform,
    `/api/v1/organizations/${organizationId}/audience-groups/${audienceGroupId}/members/${groupMembershipId}/remove`,
    { method: "POST", body: "{}" }));
}
export async function deactivateAudienceGroup(platform: Platform, organizationId: string,
  group: AudienceGroupRecord): Promise<AudienceGroupRecord> {
  return parseAudienceGroup(await request<unknown>(platform,
    `/api/v1/organizations/${organizationId}/audience-groups/${group.id}/deactivate`, {
    method: "POST", body: "{}", headers: { "If-Match": `"audience-group-${group.version}"` },
  }));
}

export async function changePrimaryDepartment(platform: Platform, organizationId: string, membershipId: string, departmentId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/members/${membershipId}/department`, { method: "POST", body: JSON.stringify({ departmentId }) });
}

export async function inviteOrganizationMember(platform: Platform, organizationId: string, departmentId: string, email: string): Promise<{ deliveryMode: "email" | "local-test-no-email" }> {
  return request(platform, `/api/v1/organizations/${organizationId}/invitations`, { method: "POST", body: JSON.stringify({ departmentId, email }) });
}

export async function resendOrganizationInvitation(platform: Platform, organizationId: string, invitationId: string): Promise<{ deliveryMode: "email" | "local-test-no-email" }> {
  return request(platform, `/api/v1/organizations/${organizationId}/invitations/${invitationId}/resend`, { method: "POST" });
}

export async function revokeOrganizationInvitation(platform: Platform, organizationId: string, invitationId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/invitations/${invitationId}/revoke`, { method: "POST" });
}

/** `classification` may be omitted (decision 0013); the server then stores INTERNAL. */
export async function createKnowledgeDraft(platform: Platform, organizationId: string, sourcePrivateVersionId: string, classification: KnowledgeClassification | undefined, idempotencyKey: string): Promise<CreatedKnowledgeDraft> {
  let response: unknown;
  try {
    response = await request<unknown>(platform, `/api/v1/organizations/${organizationId}/knowledge/drafts`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ sourcePrivateVersionId, classification }),
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 0) {
      throw new ApiError(0, "Could not confirm whether the shared draft was created. Retry the same request to check safely.");
    }
    throw cause;
  }
  if (typeof response !== "object" || response === null || Array.isArray(response)) throw new ApiError(0, "The server returned an invalid shared draft.");
  const draft = response as Record<string, unknown>;
  const currentVersion = draft.currentVersion;
  if (typeof draft.id !== "string" || draft.organizationId !== organizationId ||
    typeof draft.title !== "string" || typeof draft.body !== "string" ||
    !isKnowledgeClassification(draft.classification) || (classification !== undefined && draft.classification !== classification) ||
    draft.status !== "ACTIVE" || typeof currentVersion !== "object" || currentVersion === null ||
    !("version" in currentVersion) || typeof currentVersion.version !== "number" ||
    !Number.isSafeInteger(currentVersion.version) || currentVersion.version < 1) {
    throw new ApiError(0, "The server returned an invalid shared draft.");
  }
  return {
    id: draft.id,
    organizationId,
    title: draft.title,
    body: draft.body,
    classification: draft.classification,
    version: currentVersion.version,
  };
}

export async function apiRequest<T>(platform: Platform, path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(platform, path, init);
}

type ApiResponse = { status: number; body: string; etag?: string; location?: string };

async function request<T>(platform: Platform, path: string, init: RequestInit = {}): Promise<T> {
  const rawMethod = init.method ?? "GET";
  if (rawMethod !== "GET" && rawMethod !== "POST" && rawMethod !== "PATCH") {
    throw new ApiError(0, "This request method is not available in the Arden client.");
  }
  const method = rawMethod;
  const headers = new Headers(init.headers);
  let response: ApiResponse;
  try {
    if (platform === "desktop") {
      const bridge = requireDesktopBridge();
      if (init.body !== undefined && typeof init.body !== "string") {
        throw new ApiError(0, "Desktop requests require a JSON body.");
      }
      if ([...headers.keys()].some((header) => header !== "if-match" && header !== "idempotency-key")) {
        throw new ApiError(0, "This request header is not available in the Arden desktop client.");
      }
      response = await bridge.requestApi({
        path,
        method,
        body: typeof init.body === "string" ? init.body : undefined,
        ifMatch: headers.get("if-match") ?? undefined,
        ...(headers.has("idempotency-key") ? { idempotencyKey: headers.get("idempotency-key")! } : {}),
      });
    } else {
      const requestHeaders: Record<string, string> = { ...Object.fromEntries(headers.entries()) };
      if (init.body !== undefined) {
        requestHeaders["Content-Type"] = "application/json";
      }
      const webResponse = await fetch(`${window.location.origin}${path}`, {
        ...init,
        credentials: "include",
        headers: requestHeaders,
      });
      response = {
        status: webResponse.status,
        body: await webResponse.text(),
        etag: webResponse.headers.get("etag") ?? undefined,
        location: webResponse.headers.get("location") ?? undefined,
      };
    }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(0, "Arden could not reach its server. Your changes have not been saved.");
  }

  if (response.status < 200 || response.status >= 300) {
    let code: string | null = null;
    let message = response.status === 401 ? "Sign in to continue." : "The request could not be completed.";
    try {
      const data: unknown = JSON.parse(response.body);
      if (typeof data === "object" && data !== null) {
        if ("error" in data) {
          const error = data.error;
          if (typeof error === "object" && error !== null) {
            if ("code" in error && typeof error.code === "string") code = error.code;
            if ("message" in error && typeof error.message === "string") message = error.message;
          }
        } else if ("message" in data && typeof data.message === "string") {
          message = data.message;
        }
      }
    } catch { /* Keep the stable generic message when the server body is not JSON. */ }
    throw new ApiError(response.status, message, code);
  }
  if (response.status === 204 || response.body.length === 0) return undefined as T;
  try { return JSON.parse(response.body) as T; }
  catch { throw new ApiError(response.status, "The server returned an invalid response."); }
}

function requireDesktopBridge() {
  if (!window.ardenDesktop) throw new ApiError(0, "Secure desktop session storage is unavailable.");
  return window.ardenDesktop;
}
