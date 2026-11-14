// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { installTestDialogs } from "./dialogTestSupport";

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });
const summary = { id: "saved", title: "MFA discussion", revision: 1, updatedAt: "2026-11-13T00:00:00Z" };
const saved: api.AiConversation = { ...summary, turns: [{ id: "turn", requestId: "request", sequence: 1,
  question: "Is MFA required?", answer: "This answer is no longer available.", status: "UNAVAILABLE",
  versionScope: "CURRENT", citations: [] }] };
const prompt = () => screen.getByRole("textbox", { name: "Ask Arden" });
const send = (text: string) => { fireEvent.change(prompt(), { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "Send message" })); };

describe("persisted Ask Arden history", () => {
  it("loads owner history, marks withheld answers and sends selected scope with the saved revision", async () => {
    vi.spyOn(api, "listAiConversations").mockResolvedValue([summary]);
    vi.spyOn(api, "loadAiConversation").mockResolvedValue(saved);
    const ask = vi.spyOn(api, "askArden").mockResolvedValue({ status: "INSUFFICIENT_EVIDENCE", answer: "No guidance.", citations: [],
      conversationId: "saved", revision: 2, turnId: "turn2" });
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    fireEvent.click(screen.getByRole("button", { name: "History", exact: true }));
    fireEvent.click(await screen.findByRole("button", { name: "MFA discussion" }));
    expect(await screen.findByText("Unavailable", { exact: true })).toBeTruthy();
    expect(screen.queryByLabelText("Sources")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Knowledge version scope" }), { target: { value: "UPCOMING" } });
    send("What changes next?");
    await screen.findByText("No guidance.");
    expect(ask.mock.calls[0]).toMatchObject(["web", "org", "What changes next?", { conversationId: "saved", expectedRevision: 1, versionScope: "UPCOMING" }]);
  });

  it("preserves the request ID for a retry after an uncertain network result", async () => {
    const ask = vi.spyOn(api, "askArden").mockRejectedValueOnce(new api.ApiError(503, "Try again."))
      .mockResolvedValueOnce({ status: "ANSWERED", answer: "Saved answer.", citations: [], conversationId: "saved", revision: 1 });
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    send("MFA?"); await screen.findByRole("alert"); send("MFA?");
    await screen.findByText("Saved answer.");
    expect(ask.mock.calls[0]![3]).toEqual(ask.mock.calls[1]![3]);
    expect(document.querySelectorAll(".ask-message.is-member")).toHaveLength(1);
  });

  it("ignores late history after switching organizations", async () => {
    let finish!: (items: api.AiConversationSummary[]) => void;
    vi.spyOn(api, "listAiConversations").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(createElement(AskArdenPage, { platform: "web", organizationId: "one" }));
    fireEvent.click(screen.getByRole("button", { name: "History", exact: true }));
    view.rerender(createElement(AskArdenPage, { platform: "web", organizationId: "two" }));
    await act(() => finish([summary]));
    expect(screen.queryByText("MFA discussion")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Knowledge version scope" }) as HTMLSelectElement).value).toBe("CURRENT");
  });

  it("can close a failed history request without refreshing or losing the unsent prompt", async () => {
    vi.spyOn(api, "listAiConversations").mockRejectedValue(new api.ApiError(503, "History is unavailable."));
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    fireEvent.change(prompt(), { target: { value: "Unsent question" } });
    fireEvent.click(screen.getByRole("button", { name: "History", exact: true }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
    expect((prompt() as HTMLTextAreaElement).value).toBe("Unsent question");
  });
});
