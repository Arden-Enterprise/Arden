import { describe, expect, it } from "vitest";
import { adminNavigation, AppSidebar, knowledgeNavigation, navigationDisabled, workNavigation } from "../src/app/AppSidebar";

describe("workspace navigation with Ask Arden", () => {
  it.each(["member", "admin"] as const)("shows Ask Arden and governance destinations for %s", (previewRole) => {
    const sidebar = AppSidebar({
      activeView: "knowledge", platform: "web", previewRole, organization: null,
      onNavigate: () => undefined, onSignOut: () => undefined,
    });
    const markup = JSON.stringify(sidebar);
    expect(markup).toContain("Ask Arden");
    expect(workNavigation).toContainEqual(expect.objectContaining({ label: "Ask Arden", view: "ask-arden" }));
    for (const label of ["Home", "Ask Arden", "Private Notes", "Reviews"]) {
      expect(markup).toContain(label);
    }
    // Home replaced the sample My Work dashboard and the Library label (15 Nov 2026).
    expect(markup).not.toContain("My Work");
    expect(markup).not.toContain("Library");
    expect(markup).not.toContain("Handover");
  });

  it("shows Administration only to organization admins", () => {
    const base = { activeView: "knowledge" as const, platform: "web" as const, organization: null, onNavigate: () => undefined, onSignOut: () => undefined };
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "member" }))).not.toContain("Administration");
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "admin" }))).toContain("Administration");
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "member", authenticated: true, showAdmin: true }))).toContain("Administration");
  });
});

describe("server-backed navigation availability", () => {
  it("keeps only connected destinations enabled for signed-in sessions", () => {
    const enabled = [...workNavigation, ...knowledgeNavigation, adminNavigation]
      .filter((item) => !navigationDisabled(item, true)).map((item) => item.view);
    expect(enabled).toEqual(["knowledge", "ask-arden", "personal-workspace", "review-queue", "organization-access"]);
  });

  it("enables every sample destination except planned integrations", () => {
    const disabled = [...workNavigation, ...knowledgeNavigation, adminNavigation]
      .filter((item) => navigationDisabled(item, false)).map((item) => item.label);
    expect(disabled).toEqual(["Integrations"]);
  });
});

describe("Home as the start page", () => {
  it("opens Home first and keeps Home, Ask, Notes and Reviews on the phone tab bar", () => {
    expect(workNavigation[0]).toEqual(expect.objectContaining({ label: "Home", view: "knowledge", icon: "home" }));
    expect([...workNavigation, ...knowledgeNavigation].map((item) => item.view)).not.toContain("my-work");
  });
});
