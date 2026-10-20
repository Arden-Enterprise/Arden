import { describe, expect, it } from "vitest";
import { AppSidebar } from "../src/app/AppSidebar";

describe("workspace navigation without deferred AI", () => {
  it.each(["member", "admin"] as const)("keeps governance destinations but removes Ask Arden for %s", (previewRole) => {
    const sidebar = AppSidebar({
      activeView: "my-work", platform: "web", previewRole, organization: null,
      onNavigate: () => undefined, onSignOut: () => undefined,
    });
    const markup = JSON.stringify(sidebar);
    expect(markup).not.toContain("Ask Arden");
    expect(markup).not.toContain("ask-arden");
    for (const label of ["My Work", "Knowledge", "Review Queue", "Knowledge Handover", "Personal Workspace"]) {
      expect(markup).toContain(label);
    }
  });
});
