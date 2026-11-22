// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { AgentPanel } from "../src/app/AgentPanel";
import { AskArdenPage } from "../src/ask-arden/AskArdenPage";
import { installTestDialogs } from "./dialogTestSupport";

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = installTestDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const answer: api.AskArdenAnswer = { status: "ANSWERED", answer: "Use bin B.", citations: [], conversationId: "chat", revision: 1 };
const panelProps = { platform: "web" as const, organizationId: "org", onClose: () => undefined, onOpenAskArden: () => undefined };
const ask = (panel: HTMLElement, text: string) => {
  fireEvent.change(within(panel).getByRole("textbox", { name: "Ask Arden" }), { target: { value: text } });
  fireEvent.click(within(panel).getByRole("button", { name: "Send message" }));
};

describe("agent panel", () => {
  it("answers through Ask Arden and keeps the conversation while closed", async () => {
    const send = vi.spyOn(api, "askArden").mockResolvedValue(answer);
    const view = render(<AgentPanel open {...panelProps} />);
    ask(screen.getByRole("complementary", { name: "Ask Arden" }), "Which bin?");
    expect(await screen.findByText("Use bin B.")).toBeTruthy();
    expect(send.mock.calls[0]).toMatchObject(["web", "org", "Which bin?", { versionScope: "CURRENT" }]);
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
});
