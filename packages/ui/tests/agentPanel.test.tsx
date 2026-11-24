// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import * as privateApi from "../src/shared/private-workspace-api";
import { AgentPanel } from "../src/app/AgentPanel";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { installTestDialogs } from "./dialogTestSupport";

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const answer: api.AskArdenAnswer = { status: "ANSWERED", answer: "Use bin B.", citations: [], conversationId: "chat", revision: 1 };
const panelProps = { platform: "web" as const, organizationId: "org", source: { kind: "company" } as const,
  onClose: () => undefined, onOpenAskArden: () => undefined };
const ask = (panel: HTMLElement, text: string) => {
  fireEvent.change(within(panel).getByRole("textbox", { name: "Ask Arden" }), { target: { value: text } });
  fireEvent.click(within(panel).getByRole("button", { name: "Send message" }));
};

describe("agent panel", () => {
  it("opens a source in the panel's Sources view and keeps Open in document for the reader", async () => {
    const citation = { documentId: "doc-1", versionId: "ver-1", blockId: "b1", page: 3, excerpt: "Sort paper into bin B.",
      title: "Synthetic Waste Guide", version: "2.0", scope: "Company-wide", classification: "INTERNAL" as const };
    vi.spyOn(api, "askArden").mockResolvedValue({ ...answer, answer: "**Paper** goes into bin B.", citations: [citation] });
    const onOpenCitation = vi.fn();
    render(<AgentPanel open {...panelProps} onOpenCitation={onOpenCitation} />);
    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    ask(panel, "Where does paper go?");
    expect((await within(panel).findByText("Paper")).tagName).toBe("STRONG");
    fireEvent.click(within(panel).getByRole("button", { name: /^Source:/ }));
    expect(onOpenCitation).not.toHaveBeenCalled();
    const sources = within(panel).getByRole("complementary", { name: "Sources" });
    fireEvent.click(within(sources).getByRole("button", { name: "Open Synthetic Waste Guide at this passage" }));
    expect(onOpenCitation).toHaveBeenCalledWith(citation);
    fireEvent.click(within(sources).getByRole("button", { name: "Close sources" }));
    expect(within(panel).queryByRole("complementary", { name: "Sources" })).toBeNull();
  });

  it("answers through Ask Arden and keeps the conversation while closed", async () => {
    const send = vi.spyOn(api, "askArden").mockResolvedValue(answer);
    const view = render(<AgentPanel open {...panelProps} />);
    ask(screen.getByRole("complementary", { name: "Ask Arden" }), "Which bin?");
    expect(await screen.findByText("Use bin B.")).toBeTruthy();
    expect(send.mock.calls[0]).toMatchObject(["web", "org", "Which bin?", { }]);
    view.rerender(<AgentPanel open={false} {...panelProps} />);
    expect(view.container.querySelector("#arden-agent-panel")?.getAttribute("data-state")).toBe("closed");
    view.rerender(<AgentPanel open {...panelProps} />);
    expect(screen.getByText("Use bin B.")).toBeTruthy();
    expect(screen.getByText("Which bin?", { selector: "p" })).toBeTruthy();
  });

  it("asks before starting a new chat and clears the thread once confirmed", async () => {
    vi.spyOn(api, "askArden").mockResolvedValue(answer);
    render(<AgentPanel open {...panelProps} />);
    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    expect(within(panel).getByRole("button", { name: "New chat" }).hasAttribute("disabled")).toBe(true);
    ask(panel, "Which bin?");
    await screen.findByText("Use bin B.");
    fireEvent.click(within(panel).getByRole("button", { name: "New chat" }));
    const dialog = screen.getByRole("alertdialog", { name: "Start a new chat?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("Use bin B.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Ask about your knowledge" })).toBeTruthy();
  });

  it("keeps the page and panel composers distinct", () => {
    render(<><AskArdenPage platform="web" organizationId="org" /><AgentPanel open {...panelProps} /></>);
    const prompts = screen.getAllByRole("textbox", { name: "Ask Arden" });
    expect(prompts).toHaveLength(2);
    expect(prompts[0].id).not.toBe(prompts[1].id);
  });

  it("explains that an organization is needed before asking", () => {
    render(<AgentPanel open {...panelProps} organizationId={null} />);
    expect(screen.getByText("Open an organization to ask Arden.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks only the selected saved private note and shows its cited passage", async () => {
    const company = vi.spyOn(api, "askArden");
    const source = { kind: "private-note" as const, id: "note-a", version: 2, title: "Handover notes" };
    const send = vi.spyOn(privateApi, "askPrivateNote").mockResolvedValue({
      status: "ANSWERED", answer: "Return it on Friday.", citations: [{ documentId: source.id, versionId: "version-a",
        title: source.title, version: "Version 2", scope: "Private note", classification: "INTERNAL",
        excerpt: "Return the badge on Friday." }],
    });
    render(<AgentPanel open {...panelProps} source={source} />);
    expect(screen.getByText(source.title)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Ask Arden" })).toBeNull();
    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    ask(panel, "When do I return the badge?");
    expect(await screen.findByText("Return it on Friday.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith("web", "org", source.id, 2, "When do I return the badge?", expect.any(String));
    expect(company).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: /^Source:/ }));
    expect(screen.getByText("Return the badge on Friday.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /at this passage/ })).toBeNull();
  });

  it("ignores late replies after switching notes and clears the transcript after a save", async () => {
    let finish!: (value: api.AskArdenAnswer) => void;
    const send = vi.spyOn(privateApi, "askPrivateNote")
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ status: "ANSWERED", answer: "Second note answer.", citations: [] });
    const first = { kind: "private-note" as const, id: "note-a", version: 1, title: "First note" };
    const second = { kind: "private-note" as const, id: "note-b", version: 1, title: "Second note" };
    const view = render(<AgentPanel open {...panelProps} source={first} />);
    ask(screen.getByRole("complementary", { name: "Ask Arden" }), "First question?");
    view.rerender(<AgentPanel open {...panelProps} source={second} />);
    await act(async () => { finish(answer); });
    expect(screen.queryByText("Use bin B.")).toBeNull();
    expect(screen.queryByText("First question?")).toBeNull();
    ask(screen.getByRole("complementary", { name: "Ask Arden" }), "Second question?");
    expect(await screen.findByText("Second note answer.")).toBeTruthy();
    expect(send.mock.lastCall?.slice(2, 4)).toEqual([second.id, 1]);
    view.rerender(<AgentPanel open {...panelProps} source={{ ...second, version: 2 }} />);
    expect(screen.queryByText("Second note answer.")).toBeNull();
  });

  it("has no question composer in Private when no saved note is selected", () => {
    const company = vi.spyOn(api, "askArden");
    render(<AgentPanel open {...panelProps} source={{ kind: "private-empty", hint: "Open a saved note in Private to ask Arden." }} />);
    expect(screen.getByText("Open a saved note in Private to ask Arden.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Ask Arden" })).toBeNull();
    expect(company).not.toHaveBeenCalled();
  });
});
