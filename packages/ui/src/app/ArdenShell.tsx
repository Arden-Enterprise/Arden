import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CONTEXT_BASKET_MAX_DOCUMENTS, type GraphDocumentNode } from "@arden/domain";
import { AppSidebar } from "./AppSidebar";
import { ASK_PANEL_MAX, askPanelMaxFor, clampAskPanelWidth, defaultAskPanelWidth, readAskPanelWidth, writeAskPanelWidth } from "./askPanelWidth";
import { MobileTabIsland } from "./MobileTabIsland";
import { AgentPanel } from "./AgentPanel";
import { useArdenChat, type ChatSource } from "../ask-arden/useArdenChat";
import { dispatchSurfaceAction } from "../ask-arden/surface/dispatch";
import type { SurfaceActionHandler } from "../ask-arden/surface/types";
import { PersonalWorkspacePage } from "../personal-workspace/PersonalWorkspacePage";
import { SignInPage } from "../sign-in/SignInPage";
import { clearRecoveryTokens, readRecoveryTokens, storeRecoveryTokens } from "../sign-in/recovery-session";
import { SetPasswordPage } from "../sign-in/SetPasswordPage";
import { WorkspaceSelectPage } from "../sign-in/WorkspaceSelectPage";
import { KnowledgeFeaturePage } from "../knowledge/KnowledgeFeaturePage";
import { GovernanceActionDialog, type GovernanceActionTarget } from "../knowledge/GovernanceActionDialog";
import { AskArdenPage } from "../ask-arden/AskArdenPage";
import type { KnowledgeCitationReference, KnowledgeReaderTarget } from "../knowledge/knowledgeCitation";
import { WaitingRoomPage } from "./WaitingRoomPage";
import { InvitationLinkPage } from "../organization/InvitationLinkPage";
import { OrganizationAdminPage } from "../organization/OrganizationAdminPage";
import { usePrivateNotes } from "../personal-workspace/usePrivateNotes";
import type { ContributionAttempt } from "../personal-workspace/ContributePrivateNoteDialog";
import { SettingsDialog } from "../settings";
import { NotificationProvider } from "../notifications/NotificationProvider";
import { SystemConsolePage } from "../system-console/SystemConsolePage";
import { SystemSetupPage } from "../system-console/SystemSetupPage";
import { SystemSignInPage } from "../system-console/SystemSignInPage";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { WorkspaceNavigationContext } from "../shared/WorkspaceNavigationContext";
import { StatusIslandContext, type StatusIslandConfirm, type StatusIslandToast } from "../shared/StatusIslandContext";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import type { Platform, WorkspaceView } from "../shared/types";
import { IslandConfirm } from "../shared/IslandConfirm";
import { createOrganization as apiCreateOrganization, currentSession, getSystemSetupStatus, restoreSession, restoreSystemSession, signOut as apiSignOut, systemSignOut as apiSystemSignOut, type CreatedKnowledgeDraft, type CurrentSession, type OrganizationMembership, type NotificationTarget, type SystemAdminSession, type SystemSetupStatus } from "../shared/api-client";
import { needsDepartmentAssignment } from "../shared/membershipAssignment";
import { emptyKnowledgeRoute, sameKnowledgeLocation, type KnowledgeRoute, type KnowledgeRouteRequest } from "../knowledge/knowledgeRoute";
import { createGraphIntentBus, graphIntentToSearch, type GraphIntent, type GraphIntentBus } from "../graph/intent-bus";
import { canPinGraphDocument, useContextBasket, type ContextDocument } from "../graph/context-basket";
import { ReportIssueDialog } from "../maintenance/ReportIssueDialog";
import { createMaintenanceCase } from "../maintenance/maintenance-client";
import { ShellBridgeContext, type DispatchGraphIntentOptions, type ReportIssueTarget, type ShellBridge } from "./ShellBridgeContext";
import { allowedRoute, currentBrowserPath, forgetLastOrganization, homeRoute, normalizeSearch, parseWorkspacePath, readLastOrganization, rememberLastOrganization, rememberReturnPath, routeForView, signInPath, takeReturnPath, workspacePath, workspacesPath, type PrivateLocation, type WorkspaceRoute } from "./workspaceRoute";
import { AuthLayout } from "../sign-in/AuthLayout";

export type ArdenShellProps = {
  platform: Platform;
  /** Optional GraphIntentBus shared with a host or test harness; defaults to a shell-owned bus. */
  graphIntentBus?: GraphIntentBus;
  /** Optional renderer for the Graph workspace in shell tests. */
  renderGraphView?: (context: ContextControlProps) => ReactNode;
};

const companyChatSource: ChatSource = { kind: "company" };

/** Lazy-loaded so `@xyflow/react`, `d3-hierarchy`, and `elk.bundled.js` stay out of Home's initial bundle. */
const LazyGraphPage = lazy(() => import("../graph/GraphPage"));

type EntryView = "restoring" | "sign-in" | "password-setup" | "workspace-select" | "workspace" | "invite-link" | "system-console" | "system-setup" | "system-sign-in";

/**
 * Extracts a 43-character invitation token from the URL path `/invite/:token`.
 *
 * @param pathname Current window pathname
 * @returns The token if matched, otherwise null
 */
function tokenFromInvitationPath(pathname: string): string | null {
  const match = /^\/invite\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

/**
 * Detects whether the current browser location targets password recovery.
 *
 * When an account recovery link is followed, password recovery takes precedence
 * over any pending invitation flow so recovery tokens are not lost or overridden.
 *
 * @param location Current browser window location
 * @returns `true` if the location points to password recovery
 */
function isPasswordRecoveryTarget(location: Location): boolean {
  if (location.pathname === "/reset-password") return true;
  if (location.hash && location.hash.includes("type=recovery")) return true;
  if (location.search && location.search.includes("type=recovery")) return true;
  return false;
}

/**
 * Extracts Supabase recovery tokens from the URL hash or query parameters.
 *
 * @param location Current browser window location
 * @returns Access and refresh tokens if present, otherwise null
 */
function parseRecoveryHash(location: Location): { accessToken: string; refreshToken: string } | null {
  const hash = location.hash;
  if (hash && hash.includes("type=recovery")) {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) return { accessToken, refreshToken };
  }
  const search = location.search;
  if (search && search.includes("type=recovery")) {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) return { accessToken, refreshToken };
  }
  return null;
}

/**
 * ArdenShell top-level shell component.
 *
 * Coordinates platform shell framing, navigation, top-level error boundaries,
 * and workspace layout according to active session and membership states.
 *
 * @param props Platform configuration props
 * @returns Shell layout element
 */
export function ArdenShell(props: ArdenShellProps) {
  return <ArdenShellContent {...props} />;
}

/**
 * ArdenShell internal state container and workspace routing dispatcher.
 *
 * Manages view transitions between sign-in, invitation links, workspace selection,
 * and authenticated workspace surfaces while enforcing password recovery precedence.
 *
 * @param props Platform configuration props
 * @returns Arden shell workspace content
 */
function ArdenShellContent({ platform, graphIntentBus: injectedGraphIntentBus, renderGraphView }: ArdenShellProps) {
  const [invitationToken, setInvitationToken] = useState<string | null>(() => {
    if (typeof window !== "undefined" && isPasswordRecoveryTarget(window.location)) return null;
    return typeof window !== "undefined" ? tokenFromInvitationPath(window.location.pathname) : null;
  });
  const [recoveryTokens, setRecoveryTokens] = useState<{ accessToken: string; refreshToken: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const fromUrl = parseRecoveryHash(window.location);
    if (fromUrl) {
      storeRecoveryTokens(fromUrl);
      try { window.history.replaceState(null, "", "/reset-password"); } catch {}
      return fromUrl;
    }
    const stored = readRecoveryTokens();
    if (stored && window.location.pathname !== "/reset-password") {
      try { window.history.replaceState(null, "", "/reset-password"); } catch {}
    }
    return stored;
  });
  const [entryView, setEntryView] = useState<EntryView>(() => {
    if (typeof window !== "undefined" && isPasswordRecoveryTarget(window.location)) return "sign-in";
    // Until the saved session is checked, show the entry background rather than a sign-in form that may vanish.
    return invitationToken ? "invite-link" : "restoring";
  });
  const [organizationDirty, setOrganizationDirty] = useState(false);
  const [knowledgeDirty, setKnowledgeDirty] = useState(false);
  const [invitationBatchSending, setInvitationBatchSending] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("knowledge");
  const privateNotes = usePrivateNotes([], []);
  const [contextOpen, setContextOpen] = useState(false);
  const contextOpener = useRef<HTMLElement | null>(null);
  const returnContextFocus = useRef(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [islandToast, setIslandToast] = useState<StatusIslandToast | null>(null);
  const actionNoticeTimer = useRef<number | null>(null);
  const clearActionNoticeTimer = useCallback(() => {
    if (actionNoticeTimer.current !== null) {
      window.clearTimeout(actionNoticeTimer.current);
      actionNoticeTimer.current = null;
    }
  }, []);
  useEffect(() => clearActionNoticeTimer, [clearActionNoticeTimer]);
  const [islandConfirm, setIslandConfirm] = useState<StatusIslandConfirm | null>(null);
  const [contextOverlay, setContextOverlay] = useState(false);
  const [contextResizing, setContextResizing] = useState(false);
  // Spec F13-RESIZE: the docked panel's chosen width (null = stylesheet default) and the widest it may be now.
  const [askPanelWidth, setAskPanelWidth] = useState<number | null>(readAskPanelWidth);
  const [askPanelMax, setAskPanelMax] = useState(ASK_PANEL_MAX);
  useEffect(() => {
    if (!contextOpen || contextOverlay) setContextResizing(false);
  }, [contextOpen, contextOverlay]);
  const [assignedReviewCount, setAssignedReviewCount] = useState<number | undefined>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<WorkspaceView | "exit" | "workspace-select" | null>(null);
  const [serverSession, setServerSession] = useState<CurrentSession | null>(null);
  const [systemSession, setSystemSession] = useState<SystemAdminSession | null>(null);
  const [systemSetupStatus, setSystemSetupStatus] = useState<SystemSetupStatus | null>(null);
  const [systemSignInNotice, setSystemSignInNotice] = useState<string | null>(null);
  const [serverOrganizationId, setServerOrganizationId] = useState<string | null>(null);
  const [createdKnowledgeDraft, setCreatedKnowledgeDraft] = useState<CreatedKnowledgeDraft | null>(null);
  const [contributionAttempt, setContributionAttempt] = useState<ContributionAttempt | null>(null);
  const [knowledgeCitationTarget, setKnowledgeCitationTarget] = useState<KnowledgeReaderTarget | null>(null);
  const [requestedReviewId, setRequestedReviewId] = useState<string | null>(null);
  const [requestedContributionId, setRequestedContributionId] = useState<string | null>(null);
  const [requestedAdminTab, setRequestedAdminTab] = useState<"documents" | undefined>(undefined);
  const [requestedAdminInspection, setRequestedAdminInspection] = useState<{ documentId: string; title: string } | null>(null);
  const restoreStarted = useRef(false);
  const serverActorId = useRef<string | null>(null);
  // The web address mirrors the open workspace screen so browser Back/Forward and reload work. The desktop app has
  // no address bar and loads from a file URL, so it keeps navigation in memory only.
  const routing = platform === "web" && typeof window !== "undefined";
  const defaultGraphIntentBus = useRef<GraphIntentBus | null>(null);
  if (!defaultGraphIntentBus.current) defaultGraphIntentBus.current = createGraphIntentBus();
  const graphIntentBus = injectedGraphIntentBus ?? defaultGraphIntentBus.current;
  const [knowledgeRoute, setKnowledgeRoute] = useState<KnowledgeRoute>(emptyKnowledgeRoute);
  const [knowledgeRouteRequest, setKnowledgeRouteRequest] = useState<KnowledgeRouteRequest | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [askRouteRequest, setAskRouteRequest] = useState<{ conversationId: string | null; navigationId: string } | null>(null);
  const [graphSearch, setGraphSearch] = useState("");
  const [reportIssueTarget, setReportIssueTarget] = useState<ReportIssueTarget | null>(null);
  const [reportIssueBusy, setReportIssueBusy] = useState(false);
  const workspaceKey = serverSession && serverOrganizationId ? `${serverSession.actor.id}:${serverOrganizationId}` : null;
  const basket = useContextBasket(workspaceKey);
  const [governanceAction, setGovernanceAction] = useState<{ workspace: string; target: GovernanceActionTarget } | null>(null);
  // Single hoisted Company Ask Arden chat shared across AskArdenPage, docked AgentPanel, and /graph;
  // stays mounted and intact while visiting Private (where AgentPanel uses an isolated private-note chat).
  const companyChat = useArdenChat({
    platform,
    organizationId: entryView === "workspace" && serverSession ? serverOrganizationId : null,
    source: companyChatSource,
    sessionKey: serverSession?.actor.id ?? "none",
    scopeDocumentIds: basket.documentIds,
  });
  const [routeSync, setRouteSync] = useState(0);
  /** Address the browser moved to that the screens are still catching up with (a document or chat loading). */
  const historyTarget = useRef<string | null>(null);
  const replaceNextRoute = useRef(false);
  const deferredRoute = useRef<WorkspaceRoute | null>(null);
  /** A Private location from the address that waits for the notes to load. */
  const waitingPrivateRoute = useRef<PrivateLocation | null>(null);
  /** A Back/Forward held behind the Administration discard dialog. */
  const routeAfterDiscard = useRef<WorkspaceRoute | null>(null);
  const handleHistoryNavigation = useRef<(() => void) | null>(null);
  handleHistoryNavigation.current = null;
  /** A feature reported a new location after this render: the address waits for the render that includes it. */
  const reportedSinceRender = useRef(false);
  reportedSinceRender.current = false;

  const focus = privateNotes.focus;
  /** Private shows a note but none is chosen yet; it picks one as soon as the notes are on screen. */
  const privateUnselected = focus.kind === "note" && !privateNotes.selectedNote;
  const wasPrivateUnselected = useRef(false);
  const privateLocation: PrivateLocation = focus.kind === "note"
    ? privateNotes.selectedNote ? { kind: "note", id: privateNotes.selectedNote.id } : { kind: "root" }
    : focus.kind === "collection" ? { kind: "collection", id: focus.id } : { kind: focus.kind };

  /** A screen finished handling an address (shown, refused or failed): record what it now shows in place. */
  const settleRoute = useCallback(() => {
    // Often called while the screen's own update is still to render; the address follows that render.
    reportedSinceRender.current = true;
    historyTarget.current = null;
    replaceNextRoute.current = true;
    setRouteSync((tick) => tick + 1);
  }, []);
  const replaceWhenReported = (replace: boolean) => {
    reportedSinceRender.current = true;
    if (replace && historyTarget.current === null) replaceNextRoute.current = true;
    setRouteSync((tick) => tick + 1);
  };
  const onKnowledgeRouteChange = useCallback((route: KnowledgeRoute, options: { replace: boolean }) => {
    setKnowledgeRoute((current) => sameKnowledgeLocation(current.home, route.home) && sameKnowledgeLocation(current.reviews, route.reviews) ? current : route);
    replaceWhenReported(options.replace);
  }, []);
  const onConversationChange = useCallback((id: string | null, options: { replace: boolean }) => {
    setConversationId(id);
    replaceWhenReported(options.replace);
  }, []);
  const onGraphSearchChange = useCallback((search: string, options: { replace?: boolean } = {}) => {
    historyTarget.current = null;
    const normalized = normalizeSearch(search);
    setGraphSearch((current) => current === normalized ? current : normalized);
    replaceWhenReported(Boolean(options.replace));
  }, []);

  /** Shows a Private location now; a missing note or collection opens the Private root. */
  const showPrivateLocation = (at: PrivateLocation) => {
    if (at.kind === "note" && privateNotes.state.notes.some((note) => note.id === at.id)) privateNotes.openNote(at.id);
    else if (at.kind === "collection" && privateNotes.collections.some((collection) => collection.id === at.id)) privateNotes.openCollection(at.id);
    else if (at.kind === "trash") privateNotes.openTrash();
    else if (at.kind === "archive") privateNotes.openArchive();
    else privateNotes.openRoot();
  };
  useEffect(() => {
    const at = waitingPrivateRoute.current;
    if (!at || privateNotes.loading) return;
    waitingPrivateRoute.current = null;
    showPrivateLocation(at);
    settleRoute();
  }, [privateNotes.loading, routeSync]);

  /** Asks the screens of a route to show its location; the view itself is set by the caller. */
  const requestRouteLocation = (route: WorkspaceRoute) => {
    const navigationId = crypto.randomUUID();
    if (route.view === "knowledge" && !sameKnowledgeLocation(route.at, knowledgeRoute.home)) {
      setKnowledgeRouteRequest({ location: route.at, navigationId });
    } else if (route.view === "review-queue" && !sameKnowledgeLocation(route.at, knowledgeRoute.reviews)) {
      setKnowledgeRouteRequest({ location: route.at, navigationId });
    } else if (route.view === "ask-arden" && route.conversationId !== conversationId) {
      setAskRouteRequest({ conversationId: route.conversationId, navigationId });
    } else if (route.view === "graph" && route.search !== graphSearch) {
      setGraphSearch(route.search);
    } else if (route.view === "personal-workspace" && JSON.stringify(route.at) !== JSON.stringify(privateLocation)) {
      waitingPrivateRoute.current = route.at;
      setRouteSync((tick) => tick + 1);
    }
  };

  useEffect(() => { setRequestedReviewId(null); }, [serverOrganizationId, serverSession?.actor.id]);
  // Declared after the reset above so a location from the address survives entering the organization.
  useEffect(() => {
    const route = deferredRoute.current;
    deferredRoute.current = null;
    if (route) requestRouteLocation(route);
  }, [serverOrganizationId, serverSession?.actor.id]);

  useEffect(() => {
    if (!routing) return;
    const onPopState = () => handleHistoryNavigation.current?.();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [routing]);

  const currentRoutePath = entryView === "workspace"
    ? workspacePath(routeForView(activeView, { knowledge: knowledgeRoute, conversationId, private: privateLocation, graphSearch })) : null;
  useEffect(() => {
    if (reportedSinceRender.current) return;
    // Private choosing its first note is part of opening Private, not a page of its own.
    const replace = replaceNextRoute.current || (activeView === "personal-workspace" && wasPrivateUnselected.current && !privateUnselected);
    replaceNextRoute.current = false;
    wasPrivateUnselected.current = activeView === "personal-workspace" && privateUnselected;
    if (!routing || currentRoutePath === null || waitingPrivateRoute.current) return;
    if (historyTarget.current !== null) {
      if (historyTarget.current === currentRoutePath) historyTarget.current = null;
      return;
    }
    if (currentBrowserPath(window.location) === currentRoutePath) return;
    try {
      if (replace) window.history.replaceState(null, "", currentRoutePath);
      else window.history.pushState(null, "", currentRoutePath);
    } catch {}
  }, [routing, currentRoutePath, routeSync]);

  /**
   * Activates the selected organization workspace for the signed-in member.
   *
   * @param membership Active membership record to enter
   */
  const enterServerOrganization = (membership: OrganizationMembership) => {
    if (membership.status !== "active") return;
    if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
      try { window.history.replaceState(null, "", "/"); } catch {}
    }
    setServerOrganizationId(membership.organization.id);
    if (serverActorId.current) rememberLastOrganization(serverActorId.current, membership.organization.id);
    setRequestedReviewId(null);
    setRequestedContributionId(null);
    setRequestedAdminInspection(null);
    setRequestedAdminTab(undefined);
    setCreatedKnowledgeDraft(null);
    setAssignedReviewCount(undefined);
    setContributionAttempt(null);
    setKnowledgeCitationTarget(null);
    setKnowledgeRoute(emptyKnowledgeRoute);
    setKnowledgeRouteRequest(null);
    setConversationId(null);
    setAskRouteRequest(null);
    setReportIssueTarget(null);
    setReportIssueBusy(false);
    setGovernanceAction(null);
    clearActionNoticeTimer();
    setIslandToast(null);
    graphIntentBus.clear();
    waitingPrivateRoute.current = null;
    // Open the screen the address names (a reload, a shared link, or the page kept across Google sign-in),
    // falling back to Home when this member cannot open it.
    const returnPath = routing ? takeReturnPath() : null;
    const here = routing ? currentBrowserPath(window.location) : "/";
    const parsedHere = routing ? parseWorkspacePath(here) : null;
    const canonicalHere = parsedHere ? workspacePath(parsedHere) : null;
    const currentPath = canonicalHere && canonicalHere !== "/" ? canonicalHere : returnPath ?? "/";
    const requested = parseWorkspacePath(currentPath) ?? homeRoute;
    const route = allowedRoute(requested, {
      admin: membership.roleCodes.includes("ORG_ADMIN"),
      privateNotes: membership.canUsePrivateWorkspace && !needsDepartmentAssignment(membership),
      reviews: (membership.canReview ?? true) && !needsDepartmentAssignment(membership),
    });
    if (routing) {
      const path = workspacePath(route);
      if (currentBrowserPath(window.location) !== path) { try { window.history.replaceState(null, "", path); } catch {} }
      historyTarget.current = path;
    }
    deferredRoute.current = route;
    setGraphSearch(route.view === "graph" ? route.search : "");
    setActiveView(route.view);
    setEntryView("workspace");
    if (membership.canUsePrivateWorkspace) {
      void privateNotes.connectServer(platform, membership.organization.id);
    }
  };

  /**
   * Commits an authenticated server session into shell state, routing to password
   * setup, workspace selection, or a single available organization workspace.
   *
   * @param current The authenticated server session
   */
  const acceptServerSession = async (current: CurrentSession, options: { resume?: boolean } = {}) => {
    if (new URLSearchParams(window.location.search).has("auth") || (typeof window !== "undefined" && window.location.pathname === "/reset-password")) {
      try { window.history.replaceState(null, "", "/"); } catch {}
    }
    setServerSession(current);
    serverActorId.current = current.actor.id;
    if (current.account?.passwordSetupRequired === true) {
      setEntryView("password-setup");
      return;
    }
    if (invitationToken) {
      if (typeof window !== "undefined") {
        try { window.history.replaceState(null, "", "/"); } catch {}
      }
      setInvitationToken(null);
    }
    clearRecoveryTokens();
    if (recoveryTokens) {
      setRecoveryTokens(null);
    }
    const resume = options.resume ? resumableMembership(current) : null;
    if (resume) {
      enterServerOrganization(resume);
      return;
    }
    setEntryView("workspace-select");
  };

  /**
   * Picks the organization a reload returns to: the one this account last opened, or its only active one.
   * An explicit visit to the chooser's address keeps the chooser.
   */
  const resumableMembership = (current: CurrentSession) => {
    if (routing && window.location.pathname === workspacesPath) return null;
    const active = current.memberships.filter((membership) => membership.status === "active");
    const last = readLastOrganization(current.actor.id);
    return active.find((membership) => membership.organization.id === last) ?? (active.length === 1 ? active[0] : null);
  };

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
    const isSystemSetupRoute = pathname === "/system/setup" || pathname === "/system/setup/";
    const isSystemSignInRoute = pathname === "/system" || pathname === "/system/" || pathname === "/system/sign-in" || pathname === "/system/sign-in/";
    const isSystemRoute = isSystemSetupRoute || isSystemSignInRoute;

    if (isSystemRoute) {
      void Promise.all([
        getSystemSetupStatus(platform).catch(() => null),
        restoreSystemSession(platform).catch(() => null),
      ]).then(([setupStatus, restoredSystem]) => {
        if (setupStatus) setSystemSetupStatus(setupStatus);
        if (restoredSystem) {
          setSystemSession(restoredSystem);
          setEntryView("system-console");
          return;
        }
        if (isSystemSetupRoute) {
          if (setupStatus && !setupStatus.needsInitialSetup) {
            setSystemSignInNotice("Initial System Admin setup has already been completed. Sign in below.");
            setEntryView("system-sign-in");
          } else {
            setEntryView("system-setup");
          }
          return;
        }
        if (setupStatus?.needsInitialSetup && !setupStatus.hasOrganizations) {
          setEntryView("system-setup");
        } else {
          setEntryView("system-sign-in");
        }
      }).catch(() => undefined);
      return;
    }

    // One decision picks the view: a member session (and any recovery or invitation flow) is decided
    // first, and only without one does a restored System Admin session open the Console. A late System
    // Admin result can therefore never replace a member, recovery or invitation page.
    const systemRestore = Promise.all([
      getSystemSetupStatus(platform).catch(() => null),
      restoreSystemSession(platform).catch(() => null),
    ]);
    void systemRestore.then(([setupStatus]) => { if (setupStatus) setSystemSetupStatus(setupStatus); });
    void restoreSession(platform).catch(() => null).then(async (current) => {
      const pathToken = typeof window !== "undefined" ? tokenFromInvitationPath(window.location.pathname) : null;
      const recoveryFlow = Boolean(recoveryTokens)
        || (typeof window !== "undefined" && isPasswordRecoveryTarget(window.location));
      if (current) {
        if (recoveryFlow) return undefined;
        if (current.account?.passwordSetupRequired === true) return acceptServerSession(current);
        const activeMemberships = current.memberships.filter((membership) => membership.status === "active");
        if (!pathToken && activeMemberships.length > 0) {
          setInvitationToken(null);
          return acceptServerSession(current, { resume: true });
        }
        if (pathToken) {
          setServerSession(current);
          return undefined;
        }
        if (current.pendingInvitationToken && activeMemberships.length === 0) {
          setServerSession(current);
          setInvitationToken(current.pendingInvitationToken);
          setEntryView("invite-link");
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", `/invite/${current.pendingInvitationToken}`); } catch {}
          }
          return undefined;
        }
        return acceptServerSession(current);
      }
      // Password recovery and invitation links always keep their own pages.
      if (pathToken || recoveryFlow) return undefined;
      const [setupStatus, restoredSystem] = await systemRestore;
      if (restoredSystem) {
        setSystemSession(restoredSystem);
        setEntryView("system-console");
        return undefined;
      }
      if (setupStatus?.needsInitialSetup && !setupStatus.hasOrganizations) setEntryView("system-setup");
      return undefined;
    }).catch(() => undefined).finally(() => {
      setEntryView((view) => view === "restoring" ? "sign-in" : view);
    });
  }, [platform]);

  useEffect(() => {
    if (!invitationBatchSending) return;
    const warnOnLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  }, [invitationBatchSending]);

  useEffect(() => {
    const shell = shellRef.current;
    const sidebar = shell?.querySelector<HTMLElement>(".app-sidebar");
    if (!shell || !sidebar) return;
    const measure = () => {
      const sidebarWidth = getComputedStyle(sidebar).position === "fixed" ? 0 : sidebar.getBoundingClientRect().width;
      // Dock Ask Arden beside the page (the page narrows, as in Notion) while the page keeps a readable width; float it otherwise.
      const pageWidth = shell.getBoundingClientRect().width - sidebarWidth;
      setContextOverlay(window.innerWidth < 900 || pageWidth - 360 < 520);
      setAskPanelMax(askPanelMaxFor(pageWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(shell); observer.observe(sidebar); measure();
    return () => observer.disconnect();
  }, [entryView]);

  // Runs after the close renders: a docked panel hides the top-bar opener, which must be visible again before it takes focus.
  useLayoutEffect(() => {
    if (contextOpen || !returnContextFocus.current) return;
    returnContextFocus.current = false;
    const opener = contextOpener.current;
    (opener?.isConnected && opener.offsetParent !== null ? opener : document.getElementById("arden-main"))?.focus();
  }, [contextOpen]);

  // While the floating panel or phone sheet covers the workspace, keep keyboard focus out of what it covers.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !contextOpen || !contextOverlay) return;
    const covered = [...shell.children].filter((child) => !child.hasAttribute("inert")
      && !child.matches("#arden-agent-panel, .shell-context-scrim, .skip-link, dialog"));
    covered.forEach((child) => { child.setAttribute("inert", ""); child.setAttribute("data-context-covered", ""); });
    return () => covered.forEach((child) => { child.removeAttribute("inert"); child.removeAttribute("data-context-covered"); });
  }, [contextOpen, contextOverlay]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (navOpen) setNavOpen(false);
      else if (contextOpen) closeContext();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [contextOpen, navOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setNavOpen(false);
  }, [activeView, entryView]);

  useLayoutEffect(() => {
    if (entryView !== "workspace") return;
    const page = shellRef.current?.querySelector<HTMLElement>("#arden-main");
    if (!page) return;
    page.classList.remove("is-page-enter");
    void page.offsetWidth;
    page.classList.add("is-page-enter");
  }, [activeView, entryView]);

  /** Clears protected workspace state when the user signs out or the session expires. */
  const finishSignOut = () => {
    setSettingsOpen(false);
    setNavOpen(false);
    if (serverSession) void apiSignOut(platform).catch(() => undefined);
    forgetLastOrganization();
    serverActorId.current = null;
    // Leave the workspace address now so the next person to sign in here does not reopen it.
    if (routing && currentBrowserPath(window.location) !== signInPath) { try { window.history.replaceState(null, "", signInPath); } catch {} }
    setServerSession(null);
    setServerOrganizationId(null);
    setRequestedReviewId(null);
    setRequestedContributionId(null);
    setRequestedAdminInspection(null);
    setRequestedAdminTab(undefined);
    setCreatedKnowledgeDraft(null);
    setAssignedReviewCount(undefined);
    setContributionAttempt(null);
    setKnowledgeCitationTarget(null);
    setGraphSearch("");
    setReportIssueTarget(null);
    setReportIssueBusy(false);
    setGovernanceAction(null);
    clearActionNoticeTimer();
    setIslandToast(null);
    graphIntentBus.clear();
    companyChat.reset();
    setEntryView("sign-in");
    setOrganizationDirty(false);
    setActiveView("knowledge");
    setKnowledgeDirty(false);
    privateNotes.reset();
  };

  useEffect(() => {
    if (!serverSession?.sessionExpiresAt) return;
    const expiresAt = Date.parse(serverSession.sessionExpiresAt);
    const expire = () => {
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) finishSignOut();
    };
    const delay = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
    const timer = window.setTimeout(expire, delay);
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [serverSession?.sessionExpiresAt]);

  const finishSystemSignOut = (notice: string | null = null) => {
    void apiSystemSignOut(platform).catch(() => undefined);
    setSystemSession(null);
    setSystemSignInNotice(notice);
    if (typeof window !== "undefined") {
      try { window.history.replaceState(null, "", "/system/sign-in"); } catch {}
    }
    setEntryView("system-sign-in");
  };

  // The System Admin session has its own 24-hour expiry; leave the Console when it ends.
  useEffect(() => {
    if (!systemSession?.sessionExpiresAt) return;
    const expiresAt = Date.parse(systemSession.sessionExpiresAt);
    const expire = () => {
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) finishSystemSignOut("Your System Admin session ended. Sign in again.");
    };
    const delay = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
    const timer = window.setTimeout(expire, delay);
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [systemSession?.sessionExpiresAt]);

  // Sign-in and the workspace chooser have their own addresses. The workspace address the person came for is kept
  // so choosing an organization returns to it.
  const entryPath = entryView === "sign-in" ? signInPath
    : entryView === "workspace-select" && serverSession ? workspacesPath : null;
  useEffect(() => {
    if (!routing || !entryPath || recoveryTokens) return;
    const here = window.location.pathname;
    if (here === entryPath || here === "/reset-password" || tokenFromInvitationPath(here)
      || isPasswordRecoveryTarget(window.location)) return;
    rememberReturnPath(here, window.location.search);
    try { window.history.replaceState(null, "", entryPath); } catch {}
  }, [routing, entryPath, recoveryTokens]);

  if (entryView === "restoring") {
    return <AuthLayout><p className="sr-only" role="status">Loading Arden…</p></AuthLayout>;
  }

  if (entryView === "password-setup" && serverSession) {
    return <SetPasswordPage platform={platform} email={serverSession.actor.email} onComplete={acceptServerSession} />;
  }

  // Only the isolated System Admin session opens the Console; member sessions never do.
  if (entryView === "system-console" && systemSession) {
    return <SystemConsolePage platform={platform} onSignOut={() => finishSystemSignOut()} />;
  }

  if (entryView === "system-setup") {
    return (
      <SystemSetupPage
        platform={platform}
        hasOrganizations={Boolean(systemSetupStatus?.hasOrganizations)}
        onCompleted={(session) => {
          setSystemSession(session);
          setSystemSetupStatus((prev) => ({ needsInitialSetup: false, hasOrganizations: Boolean(prev?.hasOrganizations) }));
          setSystemSignInNotice(null);
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", "/system"); } catch {}
          }
          setEntryView("system-console");
        }}
        onOpenSystemSignIn={() => {
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", "/system/sign-in"); } catch {}
          }
          setEntryView("system-sign-in");
        }}
        onBackToMemberSignIn={() => {
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", signInPath); } catch {}
          }
          setEntryView("sign-in");
        }}
      />
    );
  }

  if (entryView === "system-sign-in") {
    return (
      <SystemSignInPage
        platform={platform}
        needsInitialSetup={Boolean(systemSetupStatus?.needsInitialSetup)}
        noticeMessage={systemSignInNotice}
        onAuthenticated={(session) => {
          setSystemSession(session);
          setSystemSignInNotice(null);
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", "/system"); } catch {}
          }
          setEntryView("system-console");
        }}
        onOpenSetup={() => {
          setSystemSignInNotice(null);
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", "/system/setup"); } catch {}
          }
          setEntryView("system-setup");
        }}
        onBackToMemberSignIn={() => {
          setSystemSignInNotice(null);
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", signInPath); } catch {}
          }
          setEntryView("sign-in");
        }}
      />
    );
  }

  if (entryView === "sign-in" || (!serverSession && entryView !== "invite-link")) {
    return (
      <SignInPage
        platform={platform}
        initialMode={recoveryTokens || (typeof window !== "undefined" && window.location.pathname === "/reset-password") ? "reset-password" : "sign-in"}
        recoveryTokens={recoveryTokens}
        needsSystemSetup={Boolean(systemSetupStatus?.needsInitialSetup)}
        onOpenSystemConsole={() => {
          const goToSetup = Boolean(systemSetupStatus?.needsInitialSetup);
          if (typeof window !== "undefined") {
            try { window.history.replaceState(null, "", goToSetup ? "/system/setup" : "/system/sign-in"); } catch {}
          }
          setEntryView(goToSetup ? "system-setup" : "system-sign-in");
        }}
        onRecoveryComplete={() => {
          clearRecoveryTokens();
          setRecoveryTokens(null);
        }}
        onAuthenticated={acceptServerSession}
      />
    );
  }

  if (entryView === "invite-link" && invitationToken) {
    return (
      <InvitationLinkPage
        platform={platform}
        token={invitationToken}
        authenticated={Boolean(serverSession)}
        session={serverSession}
        onSessionChange={setServerSession}
        onAccepted={acceptServerSession}
      />
    );
  }

  if (entryView === "workspace-select") {
    if (serverSession) {
      return <WorkspaceSelectPage
        organizationName="organization"
        memberships={serverSession.memberships}
        testMode={serverSession.testMode}
        onCreateOrganization={async (name, departmentName) => {
          await apiCreateOrganization(platform, name, departmentName);
          await acceptServerSession(await currentSession(platform));
        }}
        onBack={finishSignOut}
        onContinue={(organizationId) => {
          const membership = serverSession.memberships.find((item) => item.organization.id === organizationId);
          if (membership) enterServerOrganization(membership);
        }}
      />;
    }
  }


  /**
   * Navigates to a specific workspace view, handling unsaved draft confirmation.
   *
   * @param view Target workspace view
   */
  const navigate = (view: WorkspaceView) => {
    historyTarget.current = null;
    setNavOpen(false);
    // Links to Reviews (for example from Home) do nothing for members without review authority.
    if (view === "review-queue" && !canUseReviews) return;
    if (invitationBatchSending && activeView === "organization-access" && view !== activeView) {
      setIslandToast({ message: "Wait for invitations to finish before leaving Administration.", onDismiss: () => setIslandToast(null) });
      return;
    }
    if (view !== "knowledge") setKnowledgeCitationTarget(null);
    if (view === "ask-arden") setContextOpen(false);
    if (organizationDirty && activeView === "organization-access" && view !== activeView) {
      setPendingAction(view);
      return;
    }
    setOrganizationDirty(false);
    setActiveView(view);
  };

  /** Restores the address of the screen still shown after a Back or Forward that was refused. */
  const keepCurrentRoute = () => {
    historyTarget.current = null;
    setRouteSync((tick) => tick + 1);
  };

  /** Shows a route that came from the address bar, as browser Back/Forward does. */
  const showRoute = (route: WorkspaceRoute) => {
    historyTarget.current = workspacePath(route);
    requestRouteLocation(route);
    if (route.view !== activeView) {
      if (route.view !== "knowledge") setKnowledgeCitationTarget(null);
      if (route.view === "ask-arden") setContextOpen(false);
      setOrganizationDirty(false);
      setActiveView(route.view);
    }
  };

  handleHistoryNavigation.current = () => {
    const browserPath = currentBrowserPath(window.location);
    if (!currentRoutePath || browserPath === currentRoutePath) return;
    const requested = parseWorkspacePath(window.location.pathname, window.location.search) ?? homeRoute;
    const route = allowedRoute(requested, { admin: liveAdmin, privateNotes: canUsePrivateNotes, reviews: canUseReviews });
    const path = workspacePath(route);
    if (path !== browserPath) { try { window.history.replaceState(null, "", path); } catch {} }
    if (path === currentRoutePath) return;
    const leavingAdministration = activeView === "organization-access" && route.view !== activeView;
    if (invitationBatchSending && leavingAdministration) {
      setIslandToast({ message: "Wait for invitations to finish before leaving Administration.", onDismiss: () => setIslandToast(null) });
      keepCurrentRoute();
      return;
    }
    if (organizationDirty && leavingAdministration) {
      routeAfterDiscard.current = route;
      setPendingAction(route.view);
      keepCurrentRoute();
      return;
    }
    showRoute(route);
  };

  const openNotificationTarget = (target: NotificationTarget) => {
    if (target.view === "review-queue") {
      setRequestedReviewId(target.id);
      navigate("review-queue");
    } else if (target.view === "shared-item") {
      setRequestedReviewId(null);
      setKnowledgeCitationTarget(null);
      setKnowledgeRouteRequest({ location: { kind: "shared", id: target.itemId }, navigationId: crypto.randomUUID() });
      navigate("knowledge");
    } else if (target.view === "contribution") {
      setRequestedReviewId(null);
      setKnowledgeCitationTarget(null);
      setRequestedContributionId(target.documentId);
      navigate("knowledge");
    } else if (target.view === "reported-case" || target.view === "maintenance-case") {
      showRoute(target.view === "reported-case"
        ? { view: "knowledge", at: { kind: "report", caseId: target.caseId } }
        : { view: "review-queue", at: { kind: "maintenance-case", caseId: target.caseId } });
    } else {
      setRequestedReviewId(null);
      setKnowledgeCitationTarget(target.publicationId ? {
        kind: "publication", versionId: target.publicationId, navigationId: crypto.randomUUID(),
      } : null);
      navigate("knowledge");
    }
  };

  /**
   * Opens knowledge feature view focused on a specific citation reference.
   *
   * @param citation Citation reference to inspect
   */
  const openKnowledgeCitation = (citation: KnowledgeCitationReference) => {
    setKnowledgeCitationTarget({ ...citation, navigationId: crypto.randomUUID() });
    navigate("knowledge");
  };

  /**
   * Initiates member sign-out, checking for unsaved changes before exiting.
   */
  const signOut = () => {
    if (invitationBatchSending) {
      setIslandToast({ message: "Wait for invitations to finish before signing out.", onDismiss: () => setIslandToast(null) });
      return;
    }
    if (organizationDirty || knowledgeDirty || privateNotes.hasUnsavedDrafts) {
      setPendingAction("exit");
      return;
    }
    finishSignOut();
  };

  const showWorkspaceSelector = () => {
    historyTarget.current = null;
    if (routing && currentBrowserPath(window.location) !== workspacesPath) { try { window.history.replaceState(null, "", workspacesPath); } catch {} }
    setKnowledgeDirty(false);
    setServerOrganizationId(null);
    setContributionAttempt(null);
    setGraphSearch("");
    setReportIssueTarget(null);
    setReportIssueBusy(false);
    setGovernanceAction(null);
    graphIntentBus.clear();
    companyChat.reset();
    privateNotes.reset();
    setNavOpen(false);
    setContextOpen(false);
    setEntryView("workspace-select");
  };

  const openWorkspaceSelector = () => {
    if (invitationBatchSending) {
      setIslandToast({ message: "Wait for invitations to finish before switching workspaces.", onDismiss: () => setIslandToast(null) });
      return;
    }
    if (organizationDirty || knowledgeDirty || privateNotes.hasUnsavedDrafts) {
      setPendingAction("workspace-select");
      return;
    }
    showWorkspaceSelector();
  };

  // Focus returns to whatever opened the panel, or to the page when that control is gone or hidden.
  const closeContext = () => {
    setContextOpen(false);
    shellRef.current?.querySelectorAll("[data-context-covered]").forEach((element) => {
      element.removeAttribute("inert");
      element.removeAttribute("data-context-covered");
    });
    returnContextFocus.current = true;
  };
  const contextControl = { contextOpen, onToggleContext: () => {
    setNavOpen(false);
    if (contextOpen) return closeContext();
    contextOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContextOpen(true);
  } };
  const activeMembership = serverSession?.memberships.find((membership) => membership.organization.id === serverOrganizationId);
  const memberName = serverSession?.actor.fullName?.trim() || "Signed-in member";
  const liveAdmin = activeMembership?.roleCodes.includes("ORG_ADMIN") ?? false;
  const isUnassignedMember = Boolean(serverSession && activeMembership && needsDepartmentAssignment(activeMembership));
  const isKnowledgeView = activeView === "knowledge" || activeView === "review-queue";
  const knowledgeView = isKnowledgeView ? activeView : "knowledge";
  // Members need a private workspace in this organization.
  const canUsePrivateNotes = !isUnassignedMember && Boolean(activeMembership?.canUsePrivateWorkspace);
  // Older servers omit the field and still enforce reviewer access at the API.
  const canUseReviews = !isUnassignedMember && Boolean(activeMembership && (activeMembership.canReview ?? true));
  const memberRole = liveAdmin ? "Organization Admin" : "Member";
  const memberDepartment = activeMembership?.departmentName ?? (isUnassignedMember ? "Awaiting assignment" : liveAdmin ? "All organization" : "Member");
  const privateNote = privateNotes.focus.kind === "note" ? privateNotes.selectedNote : null;
  const privateVersion = privateNotes.selectedVersion;
  const chatSource: ChatSource = activeView !== "personal-workspace" ? { kind: "company" }
    // Decision 0034: a PDF without text has nothing the side panel can read.
    : privateNote?.kind === "pdf" && !privateNote.textAvailable
      ? { kind: "private-empty", hint: "This PDF has no text, so AI is unavailable for it." }
    : canUsePrivateNotes && privateNotes.serverBacked && privateNote?.sourceVersionId && privateVersion
      && !privateNotes.isDirty && !privateNotes.autosaving
      ? { kind: "private-note", id: privateNote.id, title: privateNote.title, version: privateVersion }
      : { kind: "private-empty", hint: privateNote && (privateNotes.isDirty || privateNotes.autosaving)
        ? "Save this note before asking Arden." : "Open a saved note in Private to ask Arden." };
  const trashConfirm = privateNotes.trashConfirm;

  const dispatchGraphIntent = (intent: GraphIntent, options: DispatchGraphIntentOptions = {}) => {
    if (invitationBatchSending && activeView === "organization-access") {
      setIslandToast({ message: "Wait for invitations to finish before leaving Administration.", onDismiss: () => setIslandToast(null) });
      return;
    }
    if (organizationDirty && activeView === "organization-access") {
      setPendingAction("graph");
      return;
    }
    historyTarget.current = null;
    setNavOpen(false);
    graphIntentBus.dispatch(intent);
    setGraphSearch((current) => graphIntentToSearch(intent, current));
    if (options.replace) replaceNextRoute.current = true;
    if (activeView !== "graph") {
      setKnowledgeCitationTarget(null);
      setOrganizationDirty(false);
      setActiveView("graph");
    }
    if (options.openAgentPanel) setContextOpen(true);
  };

  const openReportIssue = (target: ReportIssueTarget) => {
    if (!serverOrganizationId) return;
    setReportIssueTarget(target);
  };

  const showActionNotice = (message: string, action?: StatusIslandToast["action"]) => {
    clearActionNoticeTimer();
    const toast: StatusIslandToast = {
      message,
      action: action
        ? {
          label: action.label,
          run: () => {
            clearActionNoticeTimer();
            action.run();
            setIslandToast((current) => current === toast ? null : current);
          },
        }
        : undefined,
      onDismiss: () => {
        clearActionNoticeTimer();
        setIslandToast((current) => current === toast ? null : current);
      },
    };
    setIslandToast(toast);
    actionNoticeTimer.current = window.setTimeout(() => {
      actionNoticeTimer.current = null;
      setIslandToast((current) => current === toast ? null : current);
    }, action ? 8_000 : 6_000);
  };

  const pinGraphContext = (documents: readonly ContextDocument[], branchLabel?: string, openPanel = true) => {
    const result = basket.pin(documents, branchLabel);
    if (result.kind === "limit") {
      showActionNotice(`Context Basket holds up to ${CONTEXT_BASKET_MAX_DOCUMENTS} documents.`);
    } else if (result.kind === "added") {
      if (openPanel) setContextOpen(true);
      showActionNotice(`Scoped Ask Arden to ${result.count} ${result.count === 1 ? "document" : "documents"}.`, {
        label: "Undo",
        run: () => { basket.removeEntry(result.id); setIslandToast(null); },
      });
    }
  };

  const openGovernanceAction = (kind: GovernanceActionTarget["kind"], document: Omit<GovernanceActionTarget, "kind">) => {
    if (!workspaceKey) return;
    setGovernanceAction({ workspace: workspaceKey, target: { kind, documentId: document.documentId,
      publishedVersionId: document.publishedVersionId, title: document.title } });
  };

  const openGraphDocument = (doc: Pick<GraphDocumentNode, "openTarget" | "title"> & Omit<GovernanceActionTarget, "kind">,
    anchor?: { blockId?: string; page?: number }) => {
    if (doc.openTarget === "MY_CONTRIBUTIONS") {
      setRequestedReviewId(null);
      setKnowledgeCitationTarget(null);
      setRequestedContributionId(doc.documentId);
      navigate("knowledge");
      return;
    }
    if (doc.openTarget === "ADMIN_INSPECTION") {
      if (liveAdmin) {
        setRequestedAdminTab("documents");
        setRequestedAdminInspection({ documentId: doc.documentId, title: doc.title });
        navigate("organization-access");
      }
      return;
    }
    if (doc.openTarget === "RESPONSIBLE_VIEW") {
      openGovernanceAction("responsible", doc);
      return;
    }
    setRequestedReviewId(null);
    if (anchor?.blockId || anchor?.page) {
      openKnowledgeCitation({ documentId: doc.documentId, versionId: doc.publishedVersionId, ...anchor, excerpt: "" });
      return;
    }
    setKnowledgeCitationTarget({
      kind: "publication",
      versionId: doc.publishedVersionId,
      navigationId: crypto.randomUUID(),
    });
    navigate("knowledge");
  };

  const handleSurfaceAction: SurfaceActionHandler = (action, _opener, documents) => {
    if (!workspaceKey || activeView === "personal-workspace") return;
    dispatchSurfaceAction(action, documents, {
      graph: (intent) => dispatchGraphIntent(intent, { openAgentPanel: true }),
      pin: (selected) => pinGraphContext(selected, undefined, activeView !== "ask-arden"),
      reader: (doc, anchor) => {
        if (contextOverlay && doc.openTarget !== "RESPONSIBLE_VIEW") setContextOpen(false);
        openGraphDocument(doc, anchor);
      },
      report: (doc) => openReportIssue({ documentId: doc.documentId, publishedVersionId: doc.publishedVersionId,
        title: doc.title, versionLabel: doc.version }),
      maintenance: (doc) => {
        if (!canUseReviews) {
          showActionNotice("This maintenance queue is unavailable.");
          return;
        }
        setRequestedReviewId(null);
        setKnowledgeRouteRequest({ location: { kind: "maintenance" }, navigationId: crypto.randomUUID(), focusDocumentId: doc.documentId });
        if (contextOverlay) setContextOpen(false);
        navigate("review-queue");
      },
      renewal: (doc) => openGovernanceAction("renewal", doc),
      prefill: companyChat.setDraft,
      unavailable: () => showActionNotice("This document action is no longer available."),
    });
  };

  const shellBridge: ShellBridge = {
    graphIntentBus,
    dispatchGraphIntent,
    graphSearch,
    setGraphSearch: onGraphSearchChange,
    openReportIssue,
  };

  return (
    <NotificationProvider platform={platform} organizationId={serverSession ? serverOrganizationId : null}
      onOpenTarget={openNotificationTarget}>
    <ShellBridgeContext.Provider value={shellBridge}>
    <WorkspaceNavigationContext.Provider value={{ open: navOpen, setOpen: setNavOpen }}>
    <StatusIslandContext.Provider value={{ toast: islandToast, setToast: setIslandToast, confirm: islandConfirm, setConfirm: setIslandConfirm }}>
    <div ref={shellRef} className={`arden-app-shell${contextOpen ? "" : " is-context-collapsed"}${contextOverlay ? " is-context-overlay" : ""}${contextResizing ? " is-context-resizing" : ""}${navOpen ? " is-nav-open" : ""}${navCollapsed ? " is-nav-collapsed" : ""}`}
      style={askPanelWidth === null ? undefined : { "--arden-context-width": `${clampAskPanelWidth(askPanelWidth, askPanelMax)}px` } as CSSProperties}>
      <a className="skip-link" href="#arden-main">Skip to content</a>
      <AppSidebar
        activeView={activeView}
        platform={platform}
        organizationLabel={serverOrganizationId ? serverSession?.memberships.find((item) => item.organization.id === serverOrganizationId)?.organization.name : undefined}
        authenticated={Boolean(serverSession)}
        showAdmin={liveAdmin}
        showReviews={canUseReviews}
        isUnassigned={isUnassignedMember}
        memberName={memberName}
        memberRole={memberRole}
        environmentLabel={serverSession?.testMode ? "KIET LOCAL TEST" : undefined}
        assignedReviewCount={serverOrganizationId ? assignedReviewCount : undefined}
        canSwitchWorkspace={Boolean(serverSession)}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((collapsed) => !collapsed)}
        onSwitchWorkspace={openWorkspaceSelector}
        onCloseNavigation={() => setNavOpen(false)}
        onNavigate={navigate}
        onSignOut={signOut}
        onOpenSettings={() => setSettingsOpen(true)}
        privateNotes={canUsePrivateNotes ? { controller: privateNotes, pageVisible: activeView === "personal-workspace", onOpen: () => navigate("personal-workspace") } : undefined}
        trashCount={canUsePrivateNotes ? privateNotes.trash.length : undefined}
        onOpenTrash={canUsePrivateNotes ? () => { privateNotes.openTrash(); navigate("personal-workspace"); } : undefined}
        onOpenArchive={canUsePrivateNotes ? () => { privateNotes.openArchive(); navigate("personal-workspace"); } : undefined}
      />
      {navOpen && <button type="button" className="shell-nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <MobileTabIsland activeView={activeView} authenticated={Boolean(serverSession)} showAdmin={liveAdmin}
        showReviews={canUseReviews}
        assignedReviewCount={serverOrganizationId ? assignedReviewCount : undefined} onNavigate={navigate} />

      <ErrorBoundary>
        <div className="workspace-feature-slot" hidden={activeView !== "ask-arden"}>
          <AskArdenPage key={`${serverSession?.actor.id ?? "preview"}:${serverOrganizationId ?? "none"}`}
            active={activeView === "ask-arden"} platform={platform} organizationId={serverOrganizationId} chat={companyChat} basket={basket}
            onOpenCitation={openKnowledgeCitation} onSurfaceAction={handleSurfaceAction}
            routeRequest={askRouteRequest} onConversationChange={onConversationChange} onRouteSettled={settleRoute} />
        </div>
        {isUnassignedMember && !isKnowledgeView && activeView !== "ask-arden" && activeView !== "graph" ? (
          <WaitingRoomPage
            organizationName={activeMembership?.organization.name ?? "Organization"}
            memberEmail={serverSession?.actor.email ?? ""}
            canSwitchWorkspace={Boolean(serverSession)}
            onSwitchWorkspace={openWorkspaceSelector}
            onRefresh={() => {
              void restoreSession(platform).then((current) => {
                if (current) acceptServerSession(current);
              });
            }}
            onOpenLibrary={() => navigate("knowledge")}
            onSignOut={signOut}
            {...contextControl}
          />
        ) : activeView === "organization-access" && serverOrganizationId && activeMembership && liveAdmin ? (
          <OrganizationAdminPage key={serverOrganizationId} platform={platform} organizationId={serverOrganizationId} organizationName={activeMembership.organization.name} initialTab={requestedAdminTab} requestedInspection={requestedAdminInspection} onInspectionRequestHandled={() => setRequestedAdminInspection(null)} onDirtyChange={setOrganizationDirty} onSendingInvitationsChange={(sending) => { setInvitationBatchSending(sending); if (!sending) setIslandToast(null); }} {...contextControl} />
        ) : activeView === "personal-workspace" ? (
          <PersonalWorkspacePage key={serverOrganizationId ?? "none"} controller={privateNotes} platform={platform} organizationId={serverOrganizationId ?? ""} contributionAttempt={contributionAttempt} onContributionAttemptChange={setContributionAttempt} onKnowledgeDraftCreated={(draft) => { setCreatedKnowledgeDraft(draft); navigate("knowledge"); }} {...contextControl} />
        ) : activeView === "graph" ? (
          renderGraphView ? renderGraphView(contextControl) : serverOrganizationId ? (
            <Suspense fallback={
              <main id="arden-main" className="workspace-page graph-workspace-page" aria-labelledby="graph-workspace-title" tabIndex={-1}>
                <h1 id="graph-workspace-title" className="sr-only">Knowledge Graph</h1>
                <WorkspaceTopbar breadcrumb={`${activeMembership?.organization.name ?? "Arden"} / Graph`} {...contextControl} />
                <div className="graph-page-body">
                  <div className="graph-skeleton island" role="status" aria-busy="true" aria-label="Loading Knowledge Graph" />
                </div>
              </main>
            }>
              <LazyGraphPage
                key={serverOrganizationId}
                platform={platform}
                organizationId={serverOrganizationId}
                organizationName={activeMembership?.organization.name}
                onOpenDocument={openGraphDocument}
                pinnedDocumentIds={basket.documentIds}
                onPinDocument={(doc) => {
                  if (basket.documentIds.has(doc.documentId)) basket.removeDocument(doc.documentId);
                  else if (canPinGraphDocument(doc)) pinGraphContext([doc]);
                }}
                onPinBranch={(label, documents, truncated) => {
                  if (truncated) showActionNotice("Narrow the Graph filters before pinning a branch.");
                  else if (documents.length === 0) showActionNotice("This branch has no documents available for Ask Arden.");
                  else pinGraphContext(documents, label);
                }}
                onUnfilteredSnapshot={basket.reconcile}
                {...contextControl}
              />
            </Suspense>
          ) : null
        ) : null}

      <div className="knowledge-feature-slot" hidden={!isKnowledgeView}>
        <KnowledgeFeaturePage key={`${serverSession?.actor.id ?? "none"}:${serverOrganizationId ?? "none"}`} view={knowledgeView} active={isKnowledgeView}
          platform={platform} organizationId={serverOrganizationId}
          organizationName={activeMembership?.organization.name}
          departmentName="Personal contribution"
          isAdmin={liveAdmin}
          createdDraft={createdKnowledgeDraft?.organizationId === serverOrganizationId ? createdKnowledgeDraft : null}
          citationTarget={knowledgeCitationTarget}
          requestedReviewId={requestedReviewId} onReviewTargetHandled={() => setRequestedReviewId(null)}
          requestedContributionId={requestedContributionId} onContributionTargetHandled={() => setRequestedContributionId(null)}
          onAssignedReviewCount={setAssignedReviewCount} awaitingAssignment={isUnassignedMember}
          canUsePrivateWorkspace={activeMembership?.canUsePrivateWorkspace ?? false}
          onOpenPrivateNotes={() => navigate("personal-workspace")}
          onDirtyChange={setKnowledgeDirty}
          routeRequest={knowledgeRouteRequest} onRouteChange={onKnowledgeRouteChange} onRouteSettled={settleRoute}
          onNavigate={navigate} {...contextControl} />
      </div>
      </ErrorBoundary>

      {contextOpen && contextOverlay && <button type="button" className="shell-context-scrim" aria-label="Close Ask Arden" onClick={contextControl.onToggleContext} />}
      <AgentPanel key={`${serverSession?.actor.id ?? "preview"}:${serverOrganizationId ?? "none"}`} open={contextOpen}
        platform={platform} organizationId={serverOrganizationId} onClose={closeContext} source={chatSource}
        companyChat={companyChat} basket={basket} onSurfaceAction={handleSurfaceAction}
        onOpenAskArden={() => navigate("ask-arden")}
        onOpenCitation={(citation) => { if (contextOverlay) setContextOpen(false); openKnowledgeCitation(citation); }}
        resize={contextOverlay ? undefined : {
          width: clampAskPanelWidth(askPanelWidth ?? defaultAskPanelWidth(window.innerWidth), askPanelMax),
          max: askPanelMax,
          onChange: setAskPanelWidth,
          onCommit: writeAskPanelWidth,
          onReset: () => { setAskPanelWidth(null); writeAskPanelWidth(null); },
          onDraggingChange: setContextResizing,
        }} />
      {governanceAction && governanceAction.workspace === workspaceKey && serverOrganizationId && (
        <GovernanceActionDialog key={`${governanceAction.target.kind}:${governanceAction.target.publishedVersionId}`}
          target={governanceAction.target} platform={platform} organizationId={serverOrganizationId}
          onClose={() => setGovernanceAction(null)} onSent={() => showActionNotice("Renewal sent for review.")} />
      )}
      {reportIssueTarget && serverOrganizationId && (
        <ReportIssueDialog
          key={`${reportIssueTarget.documentId}:${reportIssueTarget.publishedVersionId}`}
          title={reportIssueTarget.title || "Published document"}
          versionLabel={reportIssueTarget.versionLabel || "Published version"}
          busy={reportIssueBusy}
          onClose={() => { if (!reportIssueBusy) setReportIssueTarget(null); }}
          onViewReports={(caseId) => {
            setReportIssueTarget(null);
            setRequestedReviewId(null);
            setKnowledgeCitationTarget(null);
            setKnowledgeRouteRequest({ location: { kind: "report", caseId }, navigationId: crypto.randomUUID() });
            navigate("knowledge");
          }}
          onSubmit={async (description, requestKey, anchor) => {
            setReportIssueBusy(true);
            try {
              const created = await createMaintenanceCase(platform, serverOrganizationId, {
                documentId: reportIssueTarget.documentId,
                publishedVersionId: reportIssueTarget.publishedVersionId,
                description,
                anchor,
              }, requestKey);
              return created.caseId;
            } finally {
              setReportIssueBusy(false);
            }
          }}
        />
      )}
      {trashConfirm && <IslandConfirm
        title={trashConfirm.kind === "collection" ? "Move collection to trash?" : "Move note to trash?"}
        description="Unsaved changes will be lost."
        actionLabel="Move to trash"
        busy={false}
        error=""
        onCancel={privateNotes.cancelTrash}
        onConfirm={privateNotes.confirmTrash} />}
      {settingsOpen && (
        <SettingsDialog
          platform={platform}
          session={serverSession}
          organizationName={activeMembership?.organization.name}
          memberName={memberName}
          memberRole={memberRole}
          memberDepartment={memberDepartment}
          onClose={() => setSettingsOpen(false)}
          onRefreshSession={async () => {
            const refreshed = await restoreSession(platform);
            if (refreshed) acceptServerSession(refreshed);
          }}
          onSignOut={signOut}
        />
      )}
      {pendingAction && (
        <DiscardChangesDialog
          exiting={pendingAction === "exit"}
          onCancel={() => {
            routeAfterDiscard.current = null;
            setPendingAction(null);
          }}
          onDiscard={() => {
            if (pendingAction === "exit") finishSignOut();
            else if (pendingAction === "workspace-select") {
              setOrganizationDirty(false);
              showWorkspaceSelector();
            }
            else if (routeAfterDiscard.current) {
              historyTarget.current = null;
              requestRouteLocation(routeAfterDiscard.current);
              setOrganizationDirty(false);
              setActiveView(routeAfterDiscard.current.view);
            }
            else {
              setOrganizationDirty(false);
              setActiveView(pendingAction);
            }
            routeAfterDiscard.current = null;
            setPendingAction(null);
          }}
        />
      )}
    </div>
    </StatusIslandContext.Provider>
    </WorkspaceNavigationContext.Provider>
    </ShellBridgeContext.Provider>
    </NotificationProvider>
  );
}
