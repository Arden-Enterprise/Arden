import { describe, expect, it } from "vitest";
import { adminNavigation, AppSidebar, knowledgeNavigation, navigationDisabled, workNavigation } from "../src/app/AppSidebar";

describe("workspace navigation without deferred AI", () => {
  it.each(["member", "admin"] as const)("keeps governance destinations but removes Ask Arden for %s", (previewRole) => {
    const sidebar = AppSidebar({
      activeView: "my-work", platform: "web", previewRole, organization: null,
      onNavigate: () => undefined, onSignOut: () => undefined,
    });
    const markup = JSON.stringify(sidebar);
    expect(markup).not.toContain("Ask Arden");
    expect(markup).not.toContain("ask-arden");
    for (const label of ["My Work", "Private Notes", "Library", "Reviews", "Handover"]) {
      expect(markup).toContain(label);
    }
  });

  it("shows Administration only to organization admins", () => {
    const base = { activeView: "my-work" as const, platform: "web" as const, organization: null, onNavigate: () => undefined, onSignOut: () => undefined };
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "member" }))).not.toContain("Administration");
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "admin" }))).toContain("Administration");
    expect(JSON.stringify(AppSidebar({ ...base, previewRole: "member", authenticated: true, showAdmin: true }))).toContain("Administration");
  });
});

describe("server-backed navigation availability", () => {
  it("keeps only connected destinations enabled for signed-in sessions", () => {
    const enabled = [...workNavigation, ...knowledgeNavigation, adminNavigation]
      .filter((item) => !navigationDisabled(item, true)).map((item) => item.view);
    expect(enabled).toEqual(["personal-workspace", "knowledge", "review-queue", "organization-access"]);
  });

  it("enables every sample destination except planned integrations", () => {
    const disabled = [...workNavigation, ...knowledgeNavigation, adminNavigation]
      .filter((item) => navigationDisabled(item, false)).map((item) => item.label);
    expect(disabled).toEqual(["Integrations"]);
  });
});
