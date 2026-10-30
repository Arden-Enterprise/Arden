import { describe, expect, it } from "vitest";
import { invitationFeedback } from "../src/organization/invitationFeedback";

describe("invitation page feedback", () => {
  it("returns an acceptance error for the shared signed-in and signed-out page area", () => {
    expect(invitationFeedback("Invitation has expired.", "")).toEqual({
      role: "alert", className: "auth-message", text: "Invitation has expired.",
    });
  });

  it("shows a success message when no error is present", () => {
    expect(invitationFeedback("", "Check your email.")).toEqual({
      role: "status", className: "auth-message is-success", text: "Check your email.",
    });
  });

  it("does not render empty feedback", () => {
    expect(invitationFeedback("", "")).toBeNull();
  });
});
