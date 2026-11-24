import { useId, useRef, useState, useEffect } from "react";
import { Icon } from "../shared/Icon";
import { useWorkspaceNavigation } from "../shared/WorkspaceNavigationContext";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import type { Platform } from "../shared/types";
import { starterPrompts } from "./askArdenModel";
import { ChatComposer } from "./ChatComposer";
import { ChatMessages } from "./ChatMessages";
import { ChatHistoryPopover } from "./ChatHistoryPopover";
import { CitationSourcesPanel } from "./CitationSourcesPanel";
import { NewChatDialog } from "./NewChatDialog";
import { useArdenChat } from "./useArdenChat";

const ardenOrbSource = new URL("./assets/arden-orb-source.png", import.meta.url).href;

type AskArdenPageProps = {
  active?: boolean;
  platform: Platform;
  organizationId: string | null;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
};

export function AskArdenPage({ platform, organizationId, onOpenCitation, active = true }: AskArdenPageProps) {
  const chat = useArdenChat({ platform, organizationId, source: { kind: "company" } });
  const [examplesVisible, setExamplesVisible] = useState(true);
  const [resetting, setResetting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyId = useId(), sourcesId = useId();
  const navigation = useWorkspaceNavigation();
  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus());

  const ask = (prompt: string) => {
    chat.setDraft(prompt);
    focusComposer();
  };

  const reset = () => {
    chat.reset();
    setResetting(false);
    focusComposer();
  };

  // The first send swaps the centered composer for the docked one; move focus with it.
  const composerFocused = useRef(false);
  const wasEmpty = useRef(chat.empty);
  useEffect(() => {
    if (wasEmpty.current && !chat.empty && composerFocused.current) composerRef.current?.focus();
    wasEmpty.current = chat.empty;
  }, [chat.empty]);

  return <main id={active ? "arden-main" : undefined} className="workspace-page ask-arden-page" aria-labelledby="ask-arden-title" tabIndex={-1}>
    <h1 id="ask-arden-title" className="sr-only">Ask Arden</h1>
    <div className={`ask-arden-stage${chat.empty ? " is-empty" : " is-thread"}${chat.sourcePanel ? " has-sources" : ""}`}
      onFocusCapture={(event) => { composerFocused.current = (event.target as Element) === composerRef.current; }}
      onBlurCapture={(event) => { if ((event.target as Element) === composerRef.current && event.relatedTarget) composerFocused.current = false; }}>
      <header className="ask-thread-header">
        {navigation && <button type="button" className="ask-menu-button" aria-label={navigation.open ? "Close navigation" : "Open navigation"}
          aria-controls="arden-primary-navigation" aria-expanded={navigation.open} onClick={() => navigation.setOpen((open) => !open)}>
          <Icon name={navigation.open ? "close" : "menu"} size={17} />
        </button>}
        <div className="ask-thread-title"><strong>{chat.empty ? "New chat" : chat.threadTitle}</strong></div>
        <span className="ask-history-anchor">
          <button ref={historyButton} type="button" className={`island-link-button ask-history-trigger${chat.historyOpen ? " is-open" : ""}`}
            aria-expanded={chat.historyOpen} aria-controls={chat.historyOpen ? historyId : undefined}
            disabled={chat.pending && !chat.historyOpen} onClick={chat.toggleHistory}>History <Icon name="arrow-down" size={11} /></button>
          {chat.historyOpen && <ChatHistoryPopover id={historyId} anchor={historyButton} items={chat.history}
            loading={chat.historyLoading} error={chat.historyError} currentId={chat.currentId} openingId={chat.openingId}
            onOpen={(id) => { void chat.openConversation(id, true).then((opened) => { if (opened) focusComposer(); }); }}
            onRetry={() => void chat.loadHistory()} onClose={chat.closeHistory} />}
        </span>
        {!chat.empty && <button type="button" className="island-link-button" disabled={chat.pending || chat.historyLoading}
          onClick={chat.reloadConversation}>Reload chat</button>}
        {!chat.empty && <button type="button" className="island-link-button" onClick={() => setResetting(true)}>New chat</button>}
      </header>

      <div className="ask-thread-scroll" aria-live="polite">
        {chat.empty ? <section className="ask-empty-state" aria-labelledby="ask-arden-title">
          <img className="ask-brand-watermark" src={ardenOrbSource} alt="" aria-hidden="true" />
          <ChatComposer chat={chat} placement="center" composerRef={composerRef} />

          {examplesVisible && <div className="ask-examples">
            <div className="ask-examples-heading"><span>Try asking</span><button type="button" aria-label="Hide examples" onClick={() => setExamplesVisible(false)}><Icon name="close" size={12} /></button></div>
            <div className="ask-starter-grid" aria-label="Starter prompts">
              {starterPrompts.map((prompt, index) => <button key={prompt} type="button" onClick={() => ask(prompt)}>
                <Icon name={index === 0 ? "review" : index === 1 ? "search" : "people"} size={14} />
                <strong>{index === 0 ? "Understand a workflow" : index === 1 ? "Summarize guidance" : "Find a policy"}</strong>
                <span>{prompt}</span>
              </button>)}
            </div>
          </div>}

        </section> : <ChatMessages chat={chat} sourcesId={sourcesId} />}
      </div>

      {!chat.empty && <ChatComposer chat={chat} placement="dock" composerRef={composerRef} />}
      {chat.sourcePanel && <CitationSourcesPanel key={chat.sourcePanel.messageId} id={sourcesId} citations={chat.sourcePanel.citations}
        selected={chat.sourcePanel.selected} onOpenDocument={onOpenCitation} onClose={chat.closeSources} />}
    </div>
    {resetting && <NewChatDialog hasDraft={Boolean(chat.draft.trim())} onCancel={() => setResetting(false)} onConfirm={reset} />}
  </main>;
}
