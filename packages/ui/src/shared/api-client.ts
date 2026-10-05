import type { Platform } from "./types";
import type {} from "./desktop-session";

export type OrganizationMembership = {
  organization: { id: string; name: string };
  status: string;
  roleCodes: string[];
  canUsePrivateWorkspace: boolean;
};
export type CurrentSession = { actor: { id: string }; memberships: OrganizationMembership[] };
export type OrganizationAdministration = {
  departments: Array<{ id: string; name: string; defaultRoleId: string; defaultRoleName: string }>;
  roles: Array<{ id: string; name: string; code: string; isDefault: boolean }>;
  members: Array<{ id: string; email: string; name: string; status: string; departmentId: string | null; roleIds: string[]; roleNames: string[] }>;
  invitations: Array<{ id: string; email: string; departmentId: string; status: string; expiresAt: string }>;
};

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
  return request<CurrentSession>(platform, "/api/v1/me");
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

export async function createOrganizationRole(platform: Platform, organizationId: string, name: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/roles`, { method: "POST", body: JSON.stringify({ name }) });
}

export async function assignOrganizationRole(platform: Platform, organizationId: string, membershipId: string, roleId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/members/${membershipId}/roles`, { method: "POST", body: JSON.stringify({ roleId }) });
}

export async function changePrimaryDepartment(platform: Platform, organizationId: string, membershipId: string, departmentId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/members/${membershipId}/department`, { method: "POST", body: JSON.stringify({ departmentId }) });
}

export async function inviteOrganizationMember(platform: Platform, organizationId: string, departmentId: string, email: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/invitations`, { method: "POST", body: JSON.stringify({ departmentId, email }) });
}

export async function resendOrganizationInvitation(platform: Platform, organizationId: string, invitationId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/invitations/${invitationId}/resend`, { method: "POST" });
}

export async function revokeOrganizationInvitation(platform: Platform, organizationId: string, invitationId: string): Promise<void> {
  await request(platform, `/api/v1/organizations/${organizationId}/invitations/${invitationId}/revoke`, { method: "POST" });
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
      response = await bridge.requestApi({
        path,
        method,
        body: typeof init.body === "string" ? init.body : undefined,
        ifMatch: headers.get("if-match") ?? undefined,
      });
    } else {
      const webResponse = await fetch(`${window.location.origin}${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...Object.fromEntries(headers.entries()) },
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
