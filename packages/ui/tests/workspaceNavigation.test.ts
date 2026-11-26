import { describe, expect, it } from "vitest";
import { adminNavigation, AppSidebar, knowledgeNavigation, navigationDisabled, workNavigation } from "../src/app/AppSidebar";
import { MobileTabIsland } from "../src/app/MobileTabIsland";

describe("workspace navigation with Ask Arden", () => {
  it.each([false, true])("shows Ask Arden and governance destinations (admin: %s)", (showAdmin) => {
    const sidebar = AppSidebar({
      activeView: "knowledge", platform: "web", authenticated: true, showAdmin,
      onNavigate: () => undefined, onSignOut: () => undefined,
    });
    const markup = JSON.stringify(sidebar);
    expect(markup).toContain("Ask Arden");
    expect(workNavigation).toContainEqual(expect.objectContaining({ label: "Ask Arden", view: "ask-arden" }));
    for (const label of ["Home", "Ask Arden", "Private", "Reviews"]) {
      expect(markup).toContain(label);
    }
    // Home replaced the sample My Work dashboard and the Library label (15 Nov 2026).
    expect(markup).not.toContain("My Work");
    expect(markup).not.toContain("Library");
    expect(markup).not.toContain("Handover");
  });

  it("shows Administration only to organization admins", () => {
    const base = { activeView: "knowledge" as const, platform: "web" as const, authenticated: true, onNavigate: () => undefined, onSignOut: () => undefined };
    expect(JSON.stringify(AppSidebar(base))).not.toContain("Administration");
    expect(JSON.stringify(AppSidebar({ ...base, showAdmin: true }))).toContain("Administration");
  });
});

describe("Reviews visibility", () => {
  it("hides the REVIEW section and the phone tab for members without review authority", () => {
    const base = { activeView: "knowledge" as const, platform: "web" as const, previewRole: "member" as const, organization: null,
      authenticated: true, onNavigate: () => undefined, onSignOut: () => undefined };
    expect(JSON.stringify(AppSidebar({ ...base, showReviews: false }))).not.toContain("Reviews");
    expect(JSON.stringify(AppSidebar({ ...base, showReviews: true }))).toContain("Reviews");
    const tabs = (showReviews: boolean) => JSON.stringify(MobileTabIsland({ activeView: "knowledge", authenticated: true, showAdmin: false,
      showReviews, onNavigate: () => undefined }));
    expect(tabs(false)).not.toContain("Reviews");
    expect(tabs(true)).toContain("Reviews");
  });
});

describe("server-backed navigation availability", () => {
  it("keeps only connected destinations enabled for signed-in sessions", () => {
    const enabled = [...workNavigation, ...knowledgeNavigation, adminNavigation]
      .filter((item) => !navigationDisabled(item, true)).map((item) => item.view);
    expect(enabled).toEqual(["knowledge", "ask-arden", "personal-workspace", "review-queue", "organization-access"]);
  });

  it("shows no unavailable Integrations destination", () => {
    const items = [...workNavigation, ...knowledgeNavigation, adminNavigation];
    expect(items.map((item) => item.label)).not.toContain("Integrations");
    expect(items.filter((item) => navigationDisabled(item, false))).toEqual([]);
  });
});

describe("Home as the start page", () => {
  it("opens Home first and keeps Home, Ask, Notes and Reviews on the phone tab bar", () => {
    expect(workNavigation[0]).toEqual(expect.objectContaining({ label: "Home", view: "knowledge", icon: "home" }));
    expect([...workNavigation, ...knowledgeNavigation].map((item) => item.view)).not.toContain("my-work");
  });
});
