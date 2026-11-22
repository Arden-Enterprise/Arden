// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MaintenanceCaseScreen } from "../src/maintenance/MaintenanceCaseScreen";
import type { MaintenanceCase } from "../src/maintenance/maintenance-client";

afterEach(() => cleanup());

const item: MaintenanceCase = {
  kind: "assigned",
  caseId: "case-1",
  reporterStatus: "In Progress",
  title: "IT Support Guide",
  description: "Step 3 is wrong.",
  canDecide: true,
  canReassign: false,
};

describe("maintenance case screen", () => {
  it("keeps the reporter explanation and reviewer rationale as separate labeled notes", () => {
    render(<MaintenanceCaseScreen item={item} history={{ items: [], nextCursor: null }} loading={false} error="" busy={false}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByRole("heading", { name: "IT Support Guide" })).toBeTruthy();
    expect(screen.getByLabelText("Reporter explanation").getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByLabelText("Reviewer rationale").getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "No change needed" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Add both notes before recording no change.")).toBeTruthy();
    expect(screen.getByText("The reporter sees this. It is stored separately from your rationale.")).toBeTruthy();
  });

  it("offers eligible reviewers by name and keeps reassignment closed until one is chosen", () => {
    render(<MaintenanceCaseScreen item={{ ...item, canDecide: false, canReassign: true }} history={{ items: [], nextCursor: null }}
      loading={false} error="" busy={false} reviewers={[{ membershipId: "member-next", displayName: "Synthetic Next" }]}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    const picker = screen.getByRole("combobox", { name: "Eligible reviewer" });
    expect(picker.querySelector("option[value='member-next']")?.textContent).toBe("Synthetic Next");
    expect(screen.getByRole("button", { name: "Reassign" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Membership ID of a reviewer who did not write the document.")).toBeNull();
  });

  it("clears a reviewer question after it is accepted and keeps it when sending fails", async () => {
    const sent: string[] = [];
    const view = render(<MaintenanceCaseScreen item={item} history={{ items: [], nextCursor: null }} loading={false} error="" busy={false}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onAsk={async (message) => { sent.push(message); if (message === "Again") throw new Error("stale"); }}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Question for the reporter"), { target: { value: "Which page?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(sent).toEqual(["Which page?"]);
    expect(await screen.findByLabelText("Question for the reporter")).toHaveProperty("value", "");
    fireEvent.change(screen.getByLabelText("Question for the reporter"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(sent).toEqual(["Which page?", "Again"]);
    expect(view.getByLabelText("Question for the reporter")).toHaveProperty("value", "Again");
  });

  it("lets the reporter send a reply", async () => {
    const sent: string[] = [];
    render(<MaintenanceCaseScreen item={{ ...item, kind: "reporter", canDecide: false }} history={{ items: [], nextCursor: null }}
      loading={false} error="" busy={false}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onAsk={async (message) => { sent.push(message); }}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "Page 4." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(sent).toEqual(["Page 4."]);
    expect(await screen.findByLabelText("Reply")).toHaveProperty("value", "");
  });

  it("opens a related case without treating the link as this case's outcome", () => {
    const opened: string[] = [];
    render(<MaintenanceCaseScreen item={item} history={{ items: [], nextCursor: null }} loading={false} error="" busy={false}
      relatedCases={[{ caseId: "44444444-4444-4444-8444-444444444444", reporterStatus: "Resolved", title: "IT Support Guide" }]}
      onOpenRelated={(caseId) => opened.push(caseId)}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open IT Support Guide, Resolved" }));
    expect(opened).toEqual(["44444444-4444-4444-8444-444444444444"]);
    expect(screen.getByText("Step 3 is wrong.")).toBeTruthy();
  });

  it("keeps a published outcome closed until the proof applies and the publication is linked", () => {
    const screenFor = (publicationProof: MaintenanceCase["publicationProof"], publicationLinkVersionId: string | null = null) =>
      render(<MaintenanceCaseScreen item={{ ...item, publicationProof, publicationLinkVersionId }} history={{ items: [], nextCursor: null }}
        loading={false} error="" busy={false} onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined}
        onReassign={() => undefined} onMoreHistory={() => undefined} onRetry={() => undefined} />);
    const view = screenFor({ state: "rejected", outcome: null, publishedVersionId: "v3" });
    expect(screen.queryByRole("button", { name: "Record published outcome" })).toBeNull();
    expect(screen.getByText("The latest publication request was rejected. It can't close this case.")).toBeTruthy();
    view.unmount();
    const upcoming = screenFor({ state: "upcoming", outcome: null, publishedVersionId: "v4" });
    expect(screen.queryByRole("button", { name: "Record published outcome" })).toBeNull();
    expect(screen.getByText(/not in effect yet/)).toBeTruthy();
    upcoming.unmount();
    const unlinked = screenFor({ state: "applicable", outcome: "UPDATED", publishedVersionId: "v4" });
    fireEvent.change(screen.getByLabelText("Reporter explanation"), { target: { value: "Fixed in version 4." } });
    fireEvent.change(screen.getByLabelText("Reviewer rationale"), { target: { value: "Checked version 4." } });
    expect(screen.getByRole("button", { name: "Record published outcome" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Link the current publication before recording the outcome.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link current publication" })).toBeTruthy();
    unlinked.unmount();
    screenFor({ state: "applicable", outcome: "UPDATED", publishedVersionId: "v4" }, "v4");
    fireEvent.change(screen.getByLabelText("Reporter explanation"), { target: { value: "Fixed in version 4." } });
    fireEvent.change(screen.getByLabelText("Reviewer rationale"), { target: { value: "Checked version 4." } });
    expect(screen.getByRole("button", { name: "Record published outcome" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Link current publication" })).toBeNull();
  });

  it("moves between exact version pairs and jumps to the current pair", () => {
    const moves: string[] = [];
    render(<MaintenanceCaseScreen item={item} history={{ items: [], nextCursor: null }} loading={false} error="" busy={false}
      comparison={{ unavailable: false, rows: [{ kind: "added", text: "Contact the service desk if the client stays offline." }] }}
      versionPair={{ earlierLabel: "Version 3", laterLabel: "Version 4", canPrevious: false, canNext: true, canCompareCurrent: true }}
      onVersionPair={(action) => moves.push(action)}
      onBack={() => undefined} onClaim={() => undefined} onResolve={() => undefined} onReassign={() => undefined}
      onMoreHistory={() => undefined} onRetry={() => undefined} />);
    expect(screen.getByText("Version 3 to Version 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous versions" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next versions" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare with current" }));
    expect(moves).toEqual(["next", "current"]);
    expect(screen.getByText("Contact the service desk if the client stays offline.").closest("li")?.textContent).toContain("+ Added");
  });
});
