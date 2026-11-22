import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import type { Platform } from "../shared/types";
import { starterPrompts } from "../ask-arden/askArdenModel";
import { ChatComposer } from "../ask-arden/ChatComposer";
import { ChatMessages } from "../ask-arden/ChatMessages";
import { CitationSourcesPanel } from "../ask-arden/CitationSourcesPanel";
import { NewChatDialog } from "../ask-arden/NewChatDialog";
import { useArdenChat } from "../ask-arden/useArdenChat";

const ardenMark = new URL("../assets/arden-logo-white.png", import.meta.url).href;

export function AgentPanel({ open, platform, organizationId, onClose, onOpenAskArden, onOpenCitation }: {
  open: boolean;
  platform: Platform;
  organizationId: string | null;
  onClose: () => void;
  onOpenAskArden: () => void;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
}) {
  const chat = useArdenChat({ platform, organizationId });
  const [resetting, setResetting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourcesId = useId();
  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus());

  useEffect(() => {
    if (open) requestAnimationFrame(() => composerRef.current?.focus());
  }, [open]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [chat.messages.length, chat.pending]);

  const startNewChat = () => {
    chat.reset();
    setResetting(false);
    focusComposer();
  };
  const close = () => onClose();

  return <aside id="arden-agent-panel" className="agent-panel" aria-label="Ask Arden" data-state={open ? "open" : "closed"} inert={!open}>
    <header className="agent-panel-header">
      <img className="agent-panel-mark" src={ardenMark} alt="" />
      <div className="agent-panel-title">
        <strong>Ask Arden</strong>
        <span>{chat.empty ? "New chat" : chat.threadTitle}</span>
      </div>
      <button type="button" className="agent-panel-action" aria-label="New chat" title="New chat" disabled={chat.empty && !chat.draft}
        onClick={() => setResetting(true)}><Icon name="edit" size={15} /></button>
      <button type="button" className="agent-panel-action" aria-label="Open Ask Arden" title="Open Ask Arden" onClick={onOpenAskArden}>
        <Icon name="open-external" size={15} /></button>
      <button type="button" className="agent-panel-action" aria-label="Close Ask Arden" title="Close" onClick={close}>
        <Icon name="close" size={15} /></button>
    </header>
    <div ref={scrollRef} className="agent-panel-scroll" aria-live="polite">
      {chat.empty ? <div className="agent-panel-empty">
        <img className="agent-panel-empty-mark" src={ardenMark} alt="" />
        <h2>Ask about your knowledge</h2>
        <p>{chat.canAsk ? "Answers use only documents you can read, with sources." : "Open an organization to ask Arden."}</p>
        {chat.canAsk && <div className="agent-panel-starters" aria-label="Starter prompts">
          {starterPrompts.map((prompt, index) => <button key={prompt} type="button" style={{ "--i": index } as CSSProperties}
            onClick={() => { chat.setDraft(prompt); focusComposer(); }}>
            <Icon name={index === 0 ? "review" : index === 1 ? "search" : "people"} size={14} /><span>{prompt}</span>
          </button>)}
        </div>}
      </div> : <ChatMessages chat={chat} />}
    </div>
    <ChatComposer chat={chat} placement="panel" composerRef={composerRef} />
    {/* In the narrow panel the Sources view covers the chat; Close or Escape returns to the chip. */}
    {chat.sourcePanel && <CitationSourcesPanel id={sourcesId} citations={chat.sourcePanel.citations}
      selected={chat.sourcePanel.selected} onOpenDocument={onOpenCitation} onClose={chat.closeSources} />}
    {resetting && <NewChatDialog hasDraft={Boolean(chat.draft.trim())} onCancel={() => setResetting(false)} onConfirm={startNewChat} />}
  </aside>;
}
