import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { MobileTabIsland } from "./MobileTabIsland";
import { KnowledgePane } from "./KnowledgePane";
import { MyWorkPage } from "../my-work/MyWorkPage";
import { PersonalWorkspacePage } from "../personal-workspace/PersonalWorkspacePage";
import { SignInPage } from "../sign-in/SignInPage";
import { SetPasswordPage } from "../sign-in/SetPasswordPage";
import { WorkspaceSelectPage } from "../sign-in/WorkspaceSelectPage";
import { KnowledgeFeaturePage } from "../knowledge/KnowledgeFeaturePage";
import { AskArdenPage } from "../ask-arden/AskArdenPage";
import type { KnowledgeCitationReference, KnowledgeNavigationTarget } from "../knowledge/knowledgeCitation";
import { InvitationAcceptPage } from "../organization/InvitationAcceptPage";
import { InvitationLinkPage } from "../organization/InvitationLinkPage";
import { OrganizationAdminPage } from "../organization/OrganizationAdminPage";
import { MembershipAccessPage } from "../organization/MembershipAccessPage";
import { OrganizationSetupPage } from "../organization/OrganizationSetupPage";
import { OrganizationAccessPage } from "../organization/OrganizationAccessPage";
import { usePrivateNotes } from "../personal-workspace/usePrivateNotes";
import type { ContributionAttempt } from "../personal-workspace/ContributePrivateNoteDialog";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { WorkspaceNavigationContext } from "../shared/WorkspaceNavigationContext";
import { StatusIslandContext, type StatusIslandToast } from "../shared/StatusIslandContext";
import { createPreviewOrganization, type OrganizationPreview } from "../organization/previewModel";
import { membershipReadiness } from "../organization/organizationWorkflow";
import type { PaneContent, Platform, PrivateNote, WorkspaceView } from "../shared/types";
import { createOrganization as apiCreateOrganization, currentSession, restoreSession, signOut as apiSignOut, type CreatedKnowledgeDraft, type CurrentSession, type OrganizationMembership } from "../shared/api-client";

type ArdenShellProps = { platform: Platform };

const initialNotes: PrivateNote[] = [
  {
    id: "architecture-review",
    title: "Discovery notes — private workflow",
    body:
      "Observations\nMembers need a place to capture incomplete thoughts before they are ready for a governed shared item.\n\nAssumptions to validate\n• Privacy must be explicit at every entry point.\n• Save acknowledgement must reflect the server response.\n• Publication creates a separate immutable snapshot.",
    updatedLabel: "Updated 2m ago · Sample",
  },
  {
    id: "handover-observations",
    title: "Weekly reflection",
    body:
      "A private summary of what worked, what changed, and what to revisit.",
    updatedLabel: "Updated yesterday · Sample",
  },
  {
    id: "incident-follow-up",
    title: "API questions",
    body:
      "Open questions about note save acknowledgement and version conflicts.",
    updatedLabel: "Updated 3d ago · Sample",
  },
];

const paneContent: Record<WorkspaceView, PaneContent> = {
  "my-work": {
    eyebrow: "ACTIVE CONTEXT",
    title: "Today’s priorities",
    description:
      "3 sample tasks need action, 5 reviews are waiting and one handover is at risk.",
    suggestions: [
      "Prioritize overdue tasks",
      "Summarize pending handovers",
      "Explain today’s access alerts",
    ],
    boundaryTitle: "Authorized review scope",
    boundaryBody:
      "When the APIs are connected, this view must be limited to assigned review content and company-wide published knowledge. Private documents remain excluded.",
  },
  "ask-arden": {
    eyebrow: "ASK ARDEN CONTEXT",
    title: "Published knowledge only",
    description: "The interface preview shows how permission-aware answers and exact-version citations will appear.",
    suggestions: ["Ask a focused question", "Inspect cited versions", "Verify the audience scope"],
    boundaryTitle: "Retrieval is not connected",
    boundaryBody: "No live knowledge is searched in this preview. The production service must authorize the member before retrieval and cite only active published versions they can read.",
  },
  "personal-workspace": {
    eyebrow: "ACTIVE CONTEXT",
    title: "Private notes",
    description:
      "A personal drafting space. The current content is sample data held only in this running preview.",
    suggestions: ["Organize private notes", "Find an earlier thought", "Prepare a shareable draft"],
    boundaryTitle: "Only the owner",
    boundaryBody:
      "Private notes must never appear in department search, shared AI answers, counts or suggestions. Server-side authorization remains required before release.",
  },
  "organization-access": {
    eyebrow: "ADMINISTRATION CONTEXT",
    title: "Organization boundaries",
    description: "Review the synthetic organization structure and the proposed document access scopes.",
    suggestions: ["Review membership", "Inspect access changes", "Verify department scope"],
    boundaryTitle: "Server authority required",
    boundaryBody: "This admin UI is a local preview. A real session, server authorization and audit event are required before any access change takes effect.",
  },
  "knowledge": {
    eyebrow: "KNOWLEDGE CONTEXT", title: "Your shared library",
    description: "Explore clearly labeled sample records and any draft created in this session.",
    suggestions: ["Inspect the source version", "Review the intended audience"],
    boundaryTitle: "Shared knowledge", boundaryBody: "Sample records only. Real results must be selected by server-authorized scope.",
  },
  "review-queue": {
    eyebrow: "REVIEW CONTEXT", title: "A snapshot to review",
    description: "In the sample, approval moves the reviewed snapshot into publication preparation.",
    suggestions: ["Check the intended audience", "Approve or reject the snapshot"],
    boundaryTitle: "Immutable review snapshot", boundaryBody: "Review applies to the submitted version. Private originals remain excluded.",
  },
  "knowledge-handover": {
    eyebrow: "HANDOVER CONTEXT", title: "Clear ownership",
    description: "Review a sample transfer of responsibilities and shared knowledge.",
    suggestions: ["Check receiving owner", "Review readiness"],
    boundaryTitle: "Shared items only", boundaryBody: "Handover does not grant access to personal notes. Server checks remain required.",
  },
};

type EntryView = "sign-in" | "password-setup" | "workspace-select" | "workspace" | "setup" | "invitation" | "access" | "invite-link";

function tokenFromInvitationPath(pathname: string): string | null {
  const match = /^\/invite\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

export function ArdenShell({ platform }: ArdenShellProps) {
  return (
    <>
      <ArdenShellContent platform={platform} />
      <footer className="icon-credits" aria-label="Icon attribution">
        {platform === "web"
          ? <a href="https://www.flaticon.com/uicons" target="_blank" rel="noopener noreferrer">Uicons by Flaticon</a>
          : <span title="https://www.flaticon.com/uicons">Uicons by Flaticon</span>}
      </footer>
    </>
  );
}

function ArdenShellContent({ platform }: ArdenShellProps) {
  const [previewRole, setPreviewRole] = useState<"member" | "admin" | null>(null);
  const [invitationToken, setInvitationToken] = useState<string | null>(() => tokenFromInvitationPath(window.location.pathname));
  const [entryView, setEntryView] = useState<EntryView>(() => invitationToken ? "invite-link" : "sign-in");
  const [previewMemberId, setPreviewMemberId] = useState("sample-employee");
  const [invitationId, setInvitationId] = useState("");
  const [accessMemberId, setAccessMemberId] = useState("");
  const [pendingMemberEntry, setPendingMemberEntry] = useState<string | null>(null);
  const [organization, setOrganization] = useState<OrganizationPreview | null>(null);
  const [organizationDirty, setOrganizationDirty] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("my-work");
  const privateNotes = usePrivateNotes(initialNotes);
  const [contextOpen, setContextOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [islandToast, setIslandToast] = useState<StatusIslandToast | null>(null);
  const [contextOverlay, setContextOverlay] = useState(false);
  const [assignedReviewCount, setAssignedReviewCount] = useState<number | undefined>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [pendingAction, setPendingAction] = useState<WorkspaceView | "exit" | "setup" | null>(null);
  const [serverSession, setServerSession] = useState<CurrentSession | null>(null);
  const [serverOrganizationId, setServerOrganizationId] = useState<string | null>(null);
  const [createdKnowledgeDraft, setCreatedKnowledgeDraft] = useState<CreatedKnowledgeDraft | null>(null);
  const [contributionAttempt, setContributionAttempt] = useState<ContributionAttempt | null>(null);
  const [knowledgeCitationTarget, setKnowledgeCitationTarget] = useState<KnowledgeNavigationTarget | null>(null);
  const restoreStarted = useRef(false);

  const enterServerOrganization = (membership: OrganizationMembership) => {
    if (membership.status !== "active" || !membership.canUsePrivateWorkspace) return;
    setServerOrganizationId(membership.organization.id);
    setCreatedKnowledgeDraft(null);
    setAssignedReviewCount(undefined);
    setContributionAttempt(null);
    setKnowledgeCitationTarget(null);
    setOrganization(null);
    setPreviewRole(null);
    setActiveView("personal-workspace");
    setEntryView("workspace");
    void privateNotes.connectServer(platform, membership.organization.id);
  };

  const acceptServerSession = async (current: CurrentSession) => {
    if (new URLSearchParams(window.location.search).has("auth")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    setServerSession(current);
    if (current.account?.passwordSetupRequired === true) {
      setEntryView("password-setup");
      return;
    }
    if (invitationToken) {
      window.history.replaceState(null, "", "/");
      setInvitationToken(null);
    }
    const allowed = current.memberships.filter((membership) => membership.status === "active" && membership.canUsePrivateWorkspace);
    if (allowed.length === 1) enterServerOrganization(allowed[0]);
    else setEntryView("workspace-select");
  };

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void restoreSession(platform).then((current) => {
      if (current) {
        if (current.account?.passwordSetupRequired === true) return acceptServerSession(current);
        if (invitationToken) setServerSession(current);
        else return acceptServerSession(current);
      }
      return undefined;
    }).catch(() => undefined);
  }, [platform, invitationToken]);

  useEffect(() => {
    const shell = shellRef.current;
    const sidebar = shell?.querySelector<HTMLElement>(".app-sidebar");
    if (!shell || !sidebar) return;
    const measure = () => {
      const sidebarWidth = getComputedStyle(sidebar).position === "fixed" ? 0 : sidebar.getBoundingClientRect().width;
      setContextOverlay(shell.getBoundingClientRect().width - sidebarWidth < 1100);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(shell); observer.observe(sidebar); measure();
    return () => observer.disconnect();
  }, [entryView]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (navOpen) setNavOpen(false);
      else if (contextOpen) { setContextOpen(false); document.querySelector<HTMLButtonElement>(".context-toggle")?.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [contextOpen, navOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setNavOpen(false);
  }, [activeView, previewRole, entryView]);

  const enterMemberWorkspace = (memberId: string) => {
    if (!organization || membershipReadiness(organization, memberId).state !== "ready") return;
    const member = organization.members.find(item => item.id === memberId);
    setPreviewRole(member?.role === "Organization Admin" ? "admin" : "member");
    setPreviewMemberId(memberId);
    if (memberId !== previewMemberId) privateNotes.reset([]);
    setActiveView("my-work");
    setKnowledgeCitationTarget(null);
    setEntryView("workspace");
    setPendingMemberEntry(null);
  };

  if (entryView === "setup") {
    return (
      <OrganizationSetupPage
        initialOrganization={organization ?? undefined}
        onSaveDraft={setOrganization}
        onCancel={() => setEntryView(previewRole ? "workspace" : "sign-in")}
        onComplete={(configuredOrganization) => {
          setOrganization(configuredOrganization);
          if (previewMemberId !== "sample-admin") privateNotes.reset([]);
          setEntryView("workspace");
          setPreviewRole("admin");
          setPreviewMemberId("sample-admin");
          setActiveView("organization-access");
        }}
      />
    );
  }

  if (entryView === "password-setup" && serverSession) {
    return <SetPasswordPage platform={platform} email={serverSession.actor.email} onComplete={acceptServerSession} />;
  }

  if (entryView === "sign-in") {
    return (
      <SignInPage
        platform={platform}
        onAuthenticated={acceptServerSession}
        onEnterPreview={() => {
          setServerSession(null);
          setServerOrganizationId(null);
          setCreatedKnowledgeDraft(null);
          setContributionAttempt(null);
          setOrganization(createPreviewOrganization());
          setPreviewRole("member");
          setPreviewMemberId("sample-employee");
          privateNotes.reset();
          setEntryView("workspace-select");
        }}
        onEnterAdminPreview={() => {
          setServerSession(null);
          setServerOrganizationId(null);
          setCreatedKnowledgeDraft(null);
          setContributionAttempt(null);
          setOrganization(createPreviewOrganization());
          setPreviewRole("admin");
          setPreviewMemberId("sample-admin");
          privateNotes.reset([]);
          setActiveView("organization-access");
          setEntryView("workspace");
        }}
        onOpenSetup={() => setEntryView("setup")}
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
        onBack={() => { void apiSignOut(platform).catch(() => undefined); setServerSession(null); privateNotes.reset(); setEntryView("sign-in"); }}
        onContinue={(organizationId) => {
          const membership = serverSession.memberships.find((item) => item.organization.id === organizationId);
          if (membership) enterServerOrganization(membership);
        }}
      />;
    }
    return <WorkspaceSelectPage organizationName={organization?.name ?? "FPT Digital"} onBack={() => { setPreviewRole(null); setOrganization(null); privateNotes.reset(); setEntryView("sign-in"); }} onContinue={() => { setActiveView("my-work"); setEntryView("workspace"); }} />;
  }

  const returnToAdmin = () => {
    setPreviewRole("admin");
    setPreviewMemberId("sample-admin");
    setActiveView("organization-access");
    setEntryView("workspace");
  };

  if (entryView === "invitation" && organization) {
    return <InvitationAcceptPage organization={organization} invitationId={invitationId} onChange={setOrganization} onBack={returnToAdmin} onContinue={(memberId) => { setAccessMemberId(memberId); setEntryView("access"); }} />;
  }

  if (entryView === "access" && organization) {
    return <><MembershipAccessPage organization={organization} memberId={accessMemberId} onBack={returnToAdmin} onContinue={(memberId) => {
      if (membershipReadiness(organization, memberId).state !== "ready") return;
      if (memberId !== previewMemberId && privateNotes.hasUnsavedDrafts) setPendingMemberEntry(memberId);
      else enterMemberWorkspace(memberId);
    }} />{pendingMemberEntry && <DiscardChangesDialog exiting={false} switchingMember onCancel={() => setPendingMemberEntry(null)} onDiscard={() => enterMemberWorkspace(pendingMemberEntry)} />}</>;
  }

  const navigate = (view: WorkspaceView) => {
    setNavOpen(false);
    if (view !== "knowledge") setKnowledgeCitationTarget(null);
    if (view === "ask-arden") setContextOpen(false);
    if (organizationDirty && activeView === "organization-access" && view !== activeView) {
      setPendingAction(view);
      return;
    }
    setOrganizationDirty(false);
    setActiveView(view);
  };

  const openKnowledgeCitation = (citation: KnowledgeCitationReference) => {
    setKnowledgeCitationTarget({ ...citation, navigationId: crypto.randomUUID() });
    navigate("knowledge");
  };

  const finishSignOut = () => {
    setNavOpen(false);
    if (serverSession) void apiSignOut(platform).catch(() => undefined);
    setServerSession(null);
    setServerOrganizationId(null);
    setCreatedKnowledgeDraft(null);
    setAssignedReviewCount(undefined);
    setContributionAttempt(null);
    setKnowledgeCitationTarget(null);
    setPreviewRole(null);
    setEntryView("sign-in");
    setOrganization(null);
    setOrganizationDirty(false);
    setActiveView("my-work");
    privateNotes.reset();
    setInvitationId("");
    setAccessMemberId("");
    setPendingMemberEntry(null);
  };

  const signOut = () => {
    if (organizationDirty || privateNotes.hasUnsavedDrafts) {
      setPendingAction("exit");
      return;
    }
    finishSignOut();
  };

  const contextControl = { contextOpen, onToggleContext: () => { setNavOpen(false); setContextOpen((open) => !open); } };
  const previewMember = organization?.members.find(member => member.id === previewMemberId);
  const activeMembership = serverSession?.memberships.find((membership) => membership.organization.id === serverOrganizationId);
  const liveAdmin = activeMembership?.roleCodes.includes("ORG_ADMIN") ?? false;
  const isKnowledgeView = activeView === "knowledge" || activeView === "review-queue" || activeView === "knowledge-handover";
  const knowledgeView = isKnowledgeView ? activeView : "knowledge";
  const activeContext = activeView === "personal-workspace"
    ? {
      ...paneContent[activeView],
      title: privateNotes.selectedNote ? privateNotes.draft.title.trim() || "Untitled private note" : "Private notes",
      description: privateNotes.serverBacked ? "Your private notes are loaded from the selected organization’s Arden server." : "Drafts stay in this preview session when you switch notes or screens.",
      boundaryBody: privateNotes.serverBacked ? "Only you can work with this server-stored note. It is excluded from shared answers." : "Only you can work with this preview note. It is excluded from shared answers. Refreshing or exiting clears this session.",
    }
    : serverOrganizationId && activeView === "knowledge"
      ? { ...paneContent.knowledge, description: "Your server-backed drafts and currently accessible published versions.",
        boundaryBody: "Drafts remain author-owned. Approved versions are shown only when your current server-side audience and access scope allow them." }
      : serverOrganizationId && activeView === "review-queue"
        ? { ...paneContent[activeView], description: "Submissions assigned by an explicit reviewer grant.",
          boundaryBody: "A reviewer can act only within the granted department and classification, never on their own submission." }
        : paneContent[activeView];

  return (
    <WorkspaceNavigationContext.Provider value={{ open: navOpen, setOpen: setNavOpen }}>
    <StatusIslandContext.Provider value={{ toast: islandToast, setToast: setIslandToast }}>
    <div ref={shellRef} className={`arden-app-shell${contextOpen ? "" : " is-context-collapsed"}${contextOverlay ? " is-context-overlay" : ""}${navOpen ? " is-nav-open" : ""}${navCollapsed ? " is-nav-collapsed" : ""}${activeView === "my-work" ? " is-my-work" : ""}`}>
      <a className="skip-link" href="#arden-main">Skip to content</a>
      <AppSidebar
        activeView={activeView}
        platform={platform}
        previewRole={previewRole ?? "member"}
        organization={organization}
        organizationLabel={serverOrganizationId ? serverSession?.memberships.find((item) => item.organization.id === serverOrganizationId)?.organization.name : undefined}
        authenticated={Boolean(serverSession)}
        showAdmin={liveAdmin}
        memberName={serverSession ? serverSession.actor.email ?? "Signed-in member" : previewMember?.name}
        memberRole={serverSession ? liveAdmin ? "Organization Admin" : "Member" : previewMember?.role || "Awaiting assignment"}
        memberDepartment={serverSession ? "Member" : organization?.departments.find(department => department.id === previewMember?.departmentId)?.name}
        environmentLabel={serverSession?.testMode ? "KIET LOCAL TEST" : undefined}
        assignedReviewCount={serverOrganizationId ? assignedReviewCount : undefined}
        canSwitchWorkspace={Boolean(serverSession && serverSession.memberships.filter((item) => item.status === "active").length > 1)}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((collapsed) => !collapsed)}
        onSwitchWorkspace={() => { setNavOpen(false); setContextOpen(false); setEntryView("workspace-select"); }}
        onCloseNavigation={() => setNavOpen(false)}
        onNavigate={navigate}
        onSignOut={signOut}
      />
      {navOpen && <button type="button" className="shell-nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <MobileTabIsland activeView={activeView} authenticated={Boolean(serverSession)} showAdmin={(previewRole === "admin" && !serverSession) || liveAdmin}
        assignedReviewCount={serverOrganizationId ? assignedReviewCount : undefined} onNavigate={navigate} />

      {activeView === "my-work" ? (
        <MyWorkPage memberName={previewMember?.name} onOpenPrivateNotes={() => navigate("personal-workspace")} onOpenKnowledge={() => navigate("knowledge")} onOpenReview={() => navigate("review-queue")} onOpenHandover={() => navigate("knowledge-handover")} {...contextControl} />
      ) : activeView === "ask-arden" ? (
        <AskArdenPage onOpenCitation={openKnowledgeCitation} />
      ) : activeView === "organization-access" && serverOrganizationId && activeMembership && liveAdmin ? (
        <OrganizationAdminPage key={serverOrganizationId} platform={platform} organizationId={serverOrganizationId} organizationName={activeMembership.organization.name} onDirtyChange={setOrganizationDirty} {...contextControl} />
      ) : activeView === "organization-access" && organization && previewRole === "admin" ? (
        <OrganizationAccessPage organization={organization} onChange={setOrganization} onDirtyChange={setOrganizationDirty} onOpenSetup={() => { if (organizationDirty) setPendingAction("setup"); else setEntryView("setup"); }} onPreviewInvitation={(id) => { setInvitationId(id); setEntryView("invitation"); }} onPreviewAccess={(id) => { setAccessMemberId(id); setEntryView("access"); }} {...contextControl} />
      ) : activeView === "personal-workspace" ? (
        <PersonalWorkspacePage key={serverOrganizationId ?? previewMemberId} controller={privateNotes} platform={platform} organizationId={serverOrganizationId ?? ""} contributionAttempt={contributionAttempt} onContributionAttemptChange={setContributionAttempt} onKnowledgeDraftCreated={(draft) => { setCreatedKnowledgeDraft(draft); navigate("knowledge"); }} {...contextControl} />
      ) : null}

      <div className="knowledge-feature-slot" hidden={!isKnowledgeView}>
        <KnowledgeFeaturePage key={serverOrganizationId ?? "sample"} view={knowledgeView} active={isKnowledgeView}
          platform={platform} organizationId={serverOrganizationId}
          organizationName={activeMembership?.organization.name ?? organization?.name}
          departmentName={activeMembership ? "Personal contribution" : organization?.departments.find(department => department.id === previewMember?.departmentId)?.name}
          createdDraft={createdKnowledgeDraft?.organizationId === serverOrganizationId ? createdKnowledgeDraft : null}
          citationTarget={knowledgeCitationTarget}
          onAssignedReviewCount={setAssignedReviewCount}
          onNavigate={navigate} {...contextControl} />
      </div>

      {contextOpen && contextOverlay && <button type="button" className="shell-context-scrim" aria-label="Close context" onClick={contextControl.onToggleContext} />}
      <KnowledgePane content={activeContext} open={contextOpen} onToggle={contextControl.onToggleContext} />
      {pendingAction && (
        <DiscardChangesDialog
          exiting={pendingAction === "exit"}
          onCancel={() => setPendingAction(null)}
          onDiscard={() => {
            if (pendingAction === "exit") finishSignOut();
            else if (pendingAction === "setup") { setOrganizationDirty(false); setEntryView("setup"); }
            else {
              setOrganizationDirty(false);
              setActiveView(pendingAction);
            }
            setPendingAction(null);
          }}
        />
      )}
    </div>
    </StatusIslandContext.Provider>
    </WorkspaceNavigationContext.Provider>
  );
}
