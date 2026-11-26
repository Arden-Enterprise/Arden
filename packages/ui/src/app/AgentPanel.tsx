import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import type { Platform } from "../shared/types";
import { starterPrompts } from "../ask-arden/askArdenModel";
import { ChatComposer } from "../ask-arden/ChatComposer";
import { ChatMessages } from "../ask-arden/ChatMessages";
import { CitationSourcesPanel } from "../ask-arden/CitationSourcesPanel";
import { NewChatDialog } from "../ask-arden/NewChatDialog";
import { useArdenChat, type ChatSource } from "../ask-arden/useArdenChat";
import { AskPanelResizeHandle, type AskPanelResize } from "./AskPanelResizeHandle";

const ardenMark = new URL("../assets/arden-logo-white.png", import.meta.url).href;

type AgentPanelProps = {
  open: boolean;
  platform: Platform;
  organizationId: string | null;
  source: ChatSource;
  onClose: () => void;
  onOpenAskArden: () => void;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
  /** Present only while the panel is docked beside the page (spec F13-RESIZE). */
  resize?: AskPanelResize;
};

export function AgentPanel(props: AgentPanelProps) {
  const { source } = props;
  const sourceKey = source.kind === "private-note" ? `${source.id}:${source.version}` : source.kind;
  return <AgentPanelContent key={sourceKey} {...props} />;
}

function AgentPanelContent({ open, platform, organizationId, source, onClose, onOpenAskArden, onOpenCitation, resize }: AgentPanelProps) {
  const chat = useArdenChat({ platform, organizationId, source });
  const noteTitle = source.kind === "private-note" ? source.title : undefined;
  const prompts = chat.privateNote ? ["Summarize this note", "What are the key points?", "What action items are listed?"] : starterPrompts;
  const [resetting, setResetting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourcesId = useId();
  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus());

  useEffect(() => {
    if (open && !chat.privateNote) requestAnimationFrame(() => composerRef.current?.focus());
  }, [open, chat.privateNote]);
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
    {open && resize && <AskPanelResizeHandle {...resize} />}
    <header className="agent-panel-header">
      <img className="agent-panel-mark" src={ardenMark} alt="" />
      <div className="agent-panel-title">
        <strong>Ask Arden</strong>
        <span title={noteTitle}>{noteTitle ?? (chat.empty ? "New chat" : chat.threadTitle)}</span>
      </div>
      <button type="button" className="agent-panel-action" aria-label="New chat" title="New chat" disabled={chat.empty && !chat.draft}
        onClick={() => setResetting(true)}><Icon name="edit" size={15} /></button>
      {!chat.privateNote && <button type="button" className="agent-panel-action" aria-label="Open Ask Arden" title="Open Ask Arden" onClick={onOpenAskArden}>
        <Icon name="open-external" size={15} /></button>}
      <button type="button" className="agent-panel-action" aria-label="Close Ask Arden" title="Close" onClick={close}>
        <Icon name="close" size={15} /></button>
    </header>
    <div ref={scrollRef} className="agent-panel-scroll" aria-live="polite">
      {chat.empty ? <div className="agent-panel-empty">
        <img className="agent-panel-empty-mark" src={ardenMark} alt="" />
        <h2>{chat.privateNote ? "Ask this note" : "Ask about your knowledge"}</h2>
        <p>{source.kind === "private-note"
          ? "Arden sends your question and passages from this saved note to the configured AI service. Each question stands on its own."
          : source.kind === "private-empty" ? source.hint
          : chat.canAsk ? "Answers use only documents you can read, with sources." : "Open an organization to ask Arden."}</p>
        {chat.canAsk && <div className="agent-panel-starters" aria-label="Starter prompts">
          {prompts.map((prompt, index) => <button key={prompt} type="button" style={{ "--i": index } as CSSProperties}
            onClick={() => { chat.setDraft(prompt); focusComposer(); }}>
            <Icon name={index === 0 ? "review" : index === 1 ? "search" : "people"} size={14} /><span>{prompt}</span>
          </button>)}
        </div>}
      </div> : <ChatMessages chat={chat} sourcesId={sourcesId} />}
    </div>
    {source.kind !== "private-empty" && <ChatComposer chat={chat} placement="panel" composerRef={composerRef} />}
    {/* In the narrow panel, Close or Escape returns focus to the source control that opened the overlay. */}
    {chat.sourcePanel && <CitationSourcesPanel key={chat.sourcePanel.messageId} id={sourcesId} citations={chat.sourcePanel.citations}
      selected={chat.sourcePanel.selected} hideOpenDocument={chat.privateNote}
      onOpenDocument={chat.privateNote ? undefined : onOpenCitation} onClose={chat.closeSources} />}
    {resetting && <NewChatDialog hasDraft={Boolean(chat.draft.trim())} onCancel={() => setResetting(false)} onConfirm={startNewChat} />}
  </aside>;
}
