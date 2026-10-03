import { useEffect, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { KnowledgePane } from "./KnowledgePane";
import { MyWorkPage } from "../my-work/MyWorkPage";
import { PersonalWorkspacePage } from "../personal-workspace/PersonalWorkspacePage";
import { SignInPage } from "../sign-in/SignInPage";
import { OrganizationSetupPage } from "../organization/OrganizationSetupPage";
import { OrganizationAccessPage } from "../organization/OrganizationAccessPage";
import type { OrganizationPreview } from "../organization/previewModel";
import type { PaneContent, Platform, PrivateNote, WorkspaceView } from "../shared/types";

type ArdenShellProps = { platform: Platform };

const initialNotes: PrivateNote[] = [
  {
    id: "architecture-review",
    title: "Questions for architecture review",
    body:
      "Confirm whether retry ownership sits with the gateway or the calling service.\n\nAsk for the exact rollback signal before the review.",
    updatedLabel: "Updated today · Preview",
  },
  {
    id: "handover-observations",
    title: "Handover observations",
    body:
      "The receiving owner still needs access to the operational dashboard and the incident archive.",
    updatedLabel: "Updated yesterday · Preview",
  },
  {
    id: "incident-follow-up",
    title: "Incident follow-up prompts",
    body:
      "Which decision changed after the incident, and where is the reviewed evidence stored?",
    updatedLabel: "Updated 4 days ago · Preview",
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
};

export function ArdenShell({ platform }: ArdenShellProps) {
  const [previewRole, setPreviewRole] = useState<"member" | "admin" | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [organization, setOrganization] = useState<OrganizationPreview | null>(null);
  const [organizationDirty, setOrganizationDirty] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("my-work");
  const [notes, setNotes] = useState(initialNotes);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeView, previewRole, setupOpen]);

  if (setupOpen) {
    return (
      <OrganizationSetupPage
        onCancel={() => setSetupOpen(false)}
        onComplete={(configuredOrganization) => {
          setOrganization(configuredOrganization);
          setSetupOpen(false);
          setPreviewRole("admin");
          setActiveView("my-work");
        }}
      />
    );
  }

  if (!previewRole) {
    return (
      <SignInPage
        platform={platform}
        onEnterPreview={() => setPreviewRole("member")}
        onOpenSetup={() => setSetupOpen(true)}
      />
    );
  }

  const navigate = (view: WorkspaceView) => {
    if (organizationDirty && activeView === "organization-access" && view !== activeView && !window.confirm("Discard unsaved organization preview changes?")) return;
    setOrganizationDirty(false);
    setActiveView(view);
  };

  const signOut = () => {
    if (organizationDirty && !window.confirm("Discard unsaved organization preview changes and exit?")) return;
    setPreviewRole(null);
    setOrganization(null);
    setOrganizationDirty(false);
    setActiveView("my-work");
    setNotes(initialNotes);
  };

  return (
    <div className="arden-app-shell">
      <AppSidebar
        activeView={activeView}
        platform={platform}
        previewRole={previewRole}
        organization={organization}
        onNavigate={navigate}
        onSignOut={signOut}
      />

      {activeView === "my-work" ? (
        <MyWorkPage onOpenPrivateNotes={() => navigate("personal-workspace")} />
      ) : activeView === "organization-access" && organization && previewRole === "admin" ? (
        <OrganizationAccessPage organization={organization} onChange={setOrganization} onDirtyChange={setOrganizationDirty} />
      ) : (
        <PersonalWorkspacePage notes={notes} onNotesChange={setNotes} />
      )}

      <KnowledgePane content={paneContent[activeView]} />
    </div>
  );
}
