import type { KnowledgeHomeLocation, KnowledgeReviewLocation, KnowledgeRoute } from "../knowledge/knowledgeRoute";
import type { WorkspaceView } from "../shared/types";

/** Where Private is: the root list, a note, a collection, Trash or Archive. */
export type PrivateLocation =
  | { kind: "root" }
  | { kind: "note"; id: string }
  | { kind: "collection"; id: string }
  | { kind: "trash" }
  | { kind: "archive" };

/** The part of a workspace screen that lives in the browser address bar. */
export type WorkspaceRoute =
  | { view: "knowledge"; at: KnowledgeHomeLocation }
  | { view: "review-queue"; at: KnowledgeReviewLocation }
  | { view: "ask-arden"; conversationId: string | null }
  | { view: "personal-workspace"; at: PrivateLocation }
  | { view: "organization-access" };

/** What every routed feature currently shows, as reported to the shell. */
export type FeatureLocations = { knowledge: KnowledgeRoute; conversationId: string | null; private: PrivateLocation };

export type RouteCapabilities = { admin: boolean; privateNotes: boolean };

export const homeRoute: WorkspaceRoute = { view: "knowledge", at: { kind: "home" } };

const identifier = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Reads a workspace route from a URL path.
 *
 * @param pathname Browser location pathname
 * @returns The route, or null when the path is not a workspace address
 */
export function parseWorkspacePath(pathname: string): WorkspaceRoute | null {
  const segments = pathname.replace(/\/+$/, "").split("/").slice(1);
  if (segments.length > 3) return null;
  const [section = "", first, second] = segments;
  const id = (value: string | undefined) => value !== undefined && identifier.test(value) ? value : null;
  const only = (route: WorkspaceRoute) => first === undefined ? route : null;
  switch (section) {
    case "": return only(homeRoute);
    case "new": return only({ view: "knowledge", at: { kind: "create" } });
    case "documents": return second === undefined && id(first) ? { view: "knowledge", at: { kind: "document", id: first! } } : null;
    case "drafts": return second === undefined && id(first) ? { view: "knowledge", at: { kind: "draft", id: first! } } : null;
    case "reports": return second === undefined && id(first) ? { view: "knowledge", at: { kind: "report", caseId: first! } } : null;
    case "reviews":
      if (first === undefined) return { view: "review-queue", at: { kind: "reviews" } };
      if (first === "maintenance") {
        if (second === undefined) return { view: "review-queue", at: { kind: "maintenance" } };
        return id(second) ? { view: "review-queue", at: { kind: "maintenance-case", caseId: second } } : null;
      }
      return second === undefined && id(first) ? { view: "review-queue", at: { kind: "review", id: first } } : null;
    case "ask":
      if (first === undefined) return { view: "ask-arden", conversationId: null };
      return second === undefined && id(first) ? { view: "ask-arden", conversationId: first } : null;
    case "private":
      if (first === undefined) return { view: "personal-workspace", at: { kind: "root" } };
      if (second === undefined && (first === "trash" || first === "archive")) return { view: "personal-workspace", at: { kind: first } };
      if (first === "notes" && id(second)) return { view: "personal-workspace", at: { kind: "note", id: second! } };
      if (first === "collections" && id(second)) return { view: "personal-workspace", at: { kind: "collection", id: second! } };
      return null;
    case "admin": return only({ view: "organization-access" });
    default: return null;
  }
}

/**
 * Builds the URL path for a workspace route.
 *
 * @param route Workspace route
 * @returns Absolute URL path
 */
export function workspacePath(route: WorkspaceRoute): string {
  switch (route.view) {
    case "knowledge": return homePath(route.at);
    case "review-queue": return reviewsPath(route.at);
    case "ask-arden": return route.conversationId ? `/ask/${encodeURIComponent(route.conversationId)}` : "/ask";
    case "personal-workspace": return privatePath(route.at);
    case "organization-access": return "/admin";
  }
}

function homePath(at: KnowledgeHomeLocation): string {
  switch (at.kind) {
    case "home": return "/";
    case "create": return "/new";
    case "document": return `/documents/${encodeURIComponent(at.id)}`;
    case "draft": return `/drafts/${encodeURIComponent(at.id)}`;
    case "report": return `/reports/${encodeURIComponent(at.caseId)}`;
  }
}

function reviewsPath(at: KnowledgeReviewLocation): string {
  switch (at.kind) {
    case "reviews": return "/reviews";
    case "review": return `/reviews/${encodeURIComponent(at.id)}`;
    case "maintenance": return "/reviews/maintenance";
    case "maintenance-case": return `/reviews/maintenance/${encodeURIComponent(at.caseId)}`;
  }
}

function privatePath(at: PrivateLocation): string {
  switch (at.kind) {
    case "root": return "/private";
    case "trash": return "/private/trash";
    case "archive": return "/private/archive";
    case "note": return `/private/notes/${encodeURIComponent(at.id)}`;
    case "collection": return `/private/collections/${encodeURIComponent(at.id)}`;
  }
}

/**
 * Describes the screen the shell shows as a route.
 *
 * @param view Active workspace view
 * @param features What the routed features report as open
 * @returns Route for the address bar
 */
export function routeForView(view: WorkspaceView, features: FeatureLocations): WorkspaceRoute {
  switch (view) {
    case "knowledge": return { view, at: features.knowledge.home };
    case "review-queue": return { view, at: features.knowledge.reviews };
    case "ask-arden": return { view, conversationId: features.conversationId };
    case "personal-workspace": return { view, at: features.private };
    case "organization-access": return { view };
    default: return homeRoute;
  }
}

/**
 * Falls back to Home for a screen the member cannot open, so a typed or stale address never shows an empty page.
 *
 * @param route Requested route
 * @param capabilities What the active member may open
 * @returns The requested route, or Home
 */
export function allowedRoute(route: WorkspaceRoute, capabilities: RouteCapabilities): WorkspaceRoute {
  if (route.view === "organization-access" && !capabilities.admin) return homeRoute;
  if (route.view === "personal-workspace" && !capabilities.privateNotes) return homeRoute;
  return route;
}

const returnPathKey = "arden.returnPath";

/** Keeps the workspace address across a sign-in redirect (Google returns to `/`). */
export function rememberReturnPath(pathname: string): void {
  if (pathname === "/" || !parseWorkspacePath(pathname)) return;
  try { window.sessionStorage.setItem(returnPathKey, pathname); } catch {}
}

/** Reads and forgets the address kept before a sign-in redirect. */
export function takeReturnPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(returnPathKey);
    window.sessionStorage.removeItem(returnPathKey);
    return path && parseWorkspacePath(path) ? path : null;
  } catch { return null; }
}
