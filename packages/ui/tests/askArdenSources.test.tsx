// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { groupChatHistory } from "../src/ask-arden/chatHistory";
import { installTestDialogs } from "./dialogTestSupport";

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const policy = { documentId: "doc-1", versionId: "ver-1", title: "Synthetic Lifecycle Policy", version: "1.0", scope: "Company-wide",
  classification: "INTERNAL" as const };
const access = { ...policy, blockId: "b1", page: 2, excerpt: "Managers must request system access five working days before the start date." };
const send = (text: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Ask Arden" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
};

describe("Ask Arden sources panel", () => {
  it("opens the cited passage beside the chat and keeps the reader path behind Open in document", async () => {
    vi.spyOn(api, "askArden").mockResolvedValue({ status: "ANSWERED", conversationId: "c1", revision: 1, citations: [access],
      answer: "**Request access** five working days before the start date." });
    const onOpenCitation = vi.fn();
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org", onOpenCitation }));
    send("When do I request access?");
    const strong = await screen.findByText("Request access");
    expect(strong.tagName).toBe("STRONG");
    expect(document.body.textContent).not.toContain("**");

    const chip = screen.getByRole("button", { name: /^Source:/ });
    chip.focus(); fireEvent.click(chip);
    expect(onOpenCitation).not.toHaveBeenCalled();
    const panel = screen.getByRole("complementary", { name: "Sources" });
    expect(within(panel).getByText("Synthetic Lifecycle Policy")).toBeTruthy();
    expect(within(panel).getByText("1.0 · Company-wide")).toBeTruthy();
    const passage = within(panel).getByRole("article", { name: "Passage on page 2" });
    expect(passage.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(passage);

    fireEvent.click(within(panel).getByRole("button", { name: "Open Synthetic Lifecycle Policy at this passage" }));
    expect(onOpenCitation).toHaveBeenCalledWith(access);

    fireEvent.keyDown(passage, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Sources" })).toBeNull();
  });

  it("clears the panel when a new chat starts", async () => {
    vi.spyOn(api, "askArden").mockResolvedValue({ status: "ANSWERED", conversationId: "c1", revision: 1, citations: [access],
      answer: "Request access five working days before the start date." });
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org", onOpenCitation: vi.fn() }));
    send("When?");
    fireEvent.click(await screen.findByRole("button", { name: /^Source:/ }));
    expect(screen.getByRole("complementary", { name: "Sources" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Start a new chat?" })).getByRole("button", { name: "New chat" }));
    expect(screen.queryByRole("complementary", { name: "Sources" })).toBeNull();
  });
});

describe("Ask Arden history popover", () => {
  const now = new Date(2026, 10, 21, 12, 0);
  const at = (days: number) => new Date(2026, 10, 21 - days, 9, 30).toISOString();
  const items = [
    { id: "a", title: "Remote equipment approval", revision: 1, updatedAt: at(0) },
    { id: "b", title: "Handover checks", revision: 1, updatedAt: at(1) },
    { id: "c", title: "Client file retention", revision: 1, updatedAt: at(4) },
    { id: "d", title: "Designer onboarding", revision: 1, updatedAt: at(30) },
  ];

  it("groups chats by last update and searches titles only", () => {
    expect(groupChatHistory(items, now).map((group) => [group.label, group.items.map((item) => item.id)]))
      .toEqual([["Today", ["a"]], ["Yesterday", ["b"]], ["Previous 7 days", ["c"]], ["Older", ["d"]]]);
    expect(groupChatHistory(items, now, "HANDOVER").flatMap((group) => group.items.map((item) => item.id))).toEqual(["b"]);
    expect(groupChatHistory(items, now, "salary")).toEqual([]);
  });

  it("filters, reports no matches and returns focus to History on Escape", async () => {
    vi.spyOn(api, "listAiConversations").mockResolvedValue(items);
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    const trigger = screen.getByRole("button", { name: "History" });
    fireEvent.click(trigger);
    const popover = screen.getByRole("dialog", { name: "Chat history" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await within(popover).findByRole("button", { name: /^Handover checks/ });
    const search = within(popover).getByRole("searchbox", { name: "Search chat titles" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "salary" } });
    expect(within(popover).getByText(/No chat titles match/)).toBeTruthy();
    fireEvent.click(within(popover).getByRole("button", { name: "Clear search" }));
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(popover).getByRole("button", { name: /^Remote equipment approval/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Chat history" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows an empty history and a retryable failure", async () => {
    const list = vi.spyOn(api, "listAiConversations").mockRejectedValueOnce(new api.ApiError(503, "History is unavailable."))
      .mockResolvedValueOnce([]);
    render(createElement(AskArdenPage, { platform: "web", organizationId: "org" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const popover = screen.getByRole("dialog", { name: "Chat history" });
    expect((await within(popover).findByRole("alert")).textContent).toContain("History is unavailable.");
    fireEvent.click(within(popover).getByRole("button", { name: "Try again" }));
    expect(await within(popover).findByText("No chats yet")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
