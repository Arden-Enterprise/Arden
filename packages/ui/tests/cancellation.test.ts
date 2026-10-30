// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { PersonalWorkspacePage } from "../src/personal-workspace/PersonalWorkspacePage";
import { usePrivateNotes } from "../src/personal-workspace/usePrivateNotes";
import { OrganizationAdminPage } from "../src/organization/OrganizationAdminPage";
import { ServerAudienceGroupPanel } from "../src/organization/ServerAudienceGroupPanel";
import { installTestDialogs } from "./dialogTestSupport";

vi.mock("../src/shared/useAutosizeTextarea", () => ({ useAutosizeTextarea: () => ({ current: null }) }));

let restoreDialogs: () => void;
let previousScroll: PropertyDescriptor | undefined;
beforeEach(() => {
  restoreDialogs = installTestDialogs();
  previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup(); restoreDialogs(); vi.restoreAllMocks();
  if (previousScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", previousScroll); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("explicit cancellation", () => {
  it("clears an unsent chat prompt without calling the AI", () => {
    const ask = vi.spyOn(api, "askArden");
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Unsent prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    expect((screen.getByRole("textbox", { name: "Ask Arden" }) as HTMLTextAreaElement).value).toBe("");
    expect(ask).not.toHaveBeenCalled();
  });

  it("stops waiting, restores the prompt and ignores a late answer without corrupting the next request", async () => {
    let finishFirst!: (answer: api.AskArdenAnswer) => void;
    let finishSecond!: (answer: api.AskArdenAnswer) => void;
    vi.spyOn(api, "askArden")
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "First question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Next draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect((screen.getByRole("textbox", { name: "Ask Arden" }) as HTMLTextAreaElement).value).toBe("First question\n\nNext draft");
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Second question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await act(() => finishFirst({ status: "ANSWERED", answer: "Late old answer", citations: [] }));
    expect(screen.queryByText("Late old answer")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop waiting" })).toBeTruthy();
    await act(() => finishSecond({ status: "ANSWERED", answer: "Current answer", citations: [] }));
    expect(screen.getByText("Current answer")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: "Unsent prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(within(screen.getByRole("alertdialog")).getByText("This clears this chat and your unsent prompt.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Current answer")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Ask Arden" }) as HTMLTextAreaElement).value).toBe("Unsent prompt");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("Current answer")).toBeNull();
  });

  it("allows keeping or discarding selected note edits without a server write", async () => {
    const request = vi.spyOn(api, "apiRequest");
    function Notes() {
      const controller = usePrivateNotes([{ id: "saved", title: "Saved note", body: "Original", updatedLabel: "Saved" }]);
      return createElement(PersonalWorkspacePage, {
        controller, platform: "web", organizationId: "org", contributionAttempt: null,
        onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
      });
    }
    render(createElement(Notes));
    fireEvent.change(screen.getByRole("textbox", { name: "Note content" }), { target: { value: "Local edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect((screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value).toBe("Local edit");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    expect((screen.getByRole("textbox", { name: "Note content" }) as HTMLTextAreaElement).value).toBe("Original");
    expect(request).not.toHaveBeenCalled();
  });

  it("removes a never-saved note locally and clears its dirty state", () => {
    const { result } = renderHook(() => usePrivateNotes([]));
    act(() => result.current.createNote());
    expect(result.current.hasUnsavedDrafts).toBe(true);
    act(() => result.current.discardSelected());
    expect(result.current.state.notes).toEqual([]);
    expect(result.current.hasUnsavedDrafts).toBe(false);
  });

  it("cancels a new reader group without saving or leaving its dirty guard active", async () => {
    vi.spyOn(api, "loadAudienceGroups").mockResolvedValue([]);
    const save = vi.spyOn(api, "saveAudienceGroup");
    const onDirtyChange = vi.fn();
    render(createElement(ServerAudienceGroupPanel, { platform: "web", organizationId: "org", organizationName: "Example", members: [], departments: [], onDirtyChange }));
    fireEvent.click(await screen.findByRole("button", { name: "Create reader group" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Group name" }), { target: { value: "Unsaved group" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("textbox", { name: "Group name" })).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create reader group" })));
  });

  it("returns focus to creating a note when the last unsaved note is discarded", async () => {
    function Notes() {
      const controller = usePrivateNotes([]);
      return createElement(PersonalWorkspacePage, {
        controller, platform: "web", organizationId: "org", contributionAttempt: null,
        onContributionAttemptChange: vi.fn(), onKnowledgeDraftCreated: vi.fn(), contextOpen: false, onToggleContext: vi.fn(),
      });
    }
    render(createElement(Notes));
    fireEvent.click(screen.getByLabelText("New private note"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("New private note")));
    expect(screen.queryByRole("textbox", { name: "Note content" })).toBeNull();
  });

  it("returns focus to a reader-group row after closing or discarding its details", async () => {
    vi.spyOn(api, "loadAudienceGroups").mockResolvedValue([
      { id: "group", name: "Demo readers", description: "", version: 1, status: "ACTIVE", members: [] },
    ]);
    render(createElement(ServerAudienceGroupPanel, { platform: "web", organizationId: "org", organizationName: "Example", members: [], departments: [] }));
    const row = await screen.findByRole("button", { name: /Demo readers/ });
    fireEvent.click(screen.getByRole("button", { name: "Close reader group details" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Details", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Group name" }), { target: { value: "Unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("clears department, invitation and reviewer forms without changing saved data", async () => {
    vi.spyOn(api, "loadOrganizationAdministration").mockResolvedValue({ departments: [], roles: [], members: [], invitations: [] });
    vi.spyOn(api, "listReviewerGrants").mockResolvedValue([]);
    const department = vi.spyOn(api, "createDepartment");
    const invite = vi.spyOn(api, "inviteOrganizationMember");
    const reviewer = vi.spyOn(api, "createReviewerGrant");
    render(createElement(OrganizationAdminPage, { platform: "web", organizationId: "org", organizationName: "Example", contextOpen: false, onToggleContext: vi.fn() }));
    await screen.findByRole("button", { name: "Invite member" });
    fireEvent.click(screen.getByRole("tab", { name: /Departments/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "New department" }), { target: { value: "Unsaved department" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByRole("textbox", { name: "New department" }) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: /Invitations/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Work email/ }), { target: { value: "person@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByRole("textbox", { name: /^Work email/ }) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: /Review permissions/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Team tag Optional" }), { target: { value: "Unsaved team" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByRole("textbox", { name: "Team tag Optional" }) as HTMLInputElement).value).toBe("");
    expect(department).not.toHaveBeenCalled(); expect(invite).not.toHaveBeenCalled(); expect(reviewer).not.toHaveBeenCalled();
  });
});
