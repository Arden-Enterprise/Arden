import { useId, useRef, useState, useEffect } from "react";
import type { ContextBasket } from "../graph/context-basket";
import { ToastContent } from "../shared/ActionToast";
import { Icon } from "../shared/Icon";
import { useStatusIsland } from "../shared/StatusIslandContext";
import { useWorkspaceNavigation } from "../shared/WorkspaceNavigationContext";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import type { Platform } from "../shared/types";
import { starterPrompts } from "./askArdenModel";
import { ChatComposer } from "./ChatComposer";
import { ChatMessages } from "./ChatMessages";
import { ChatHistoryPopover } from "./ChatHistoryPopover";
import { CitationSourcesPanel } from "./CitationSourcesPanel";
import { NewChatDialog } from "./NewChatDialog";
import { useArdenChat, type ArdenChat, type ChatSource } from "./useArdenChat";
import type { SurfaceActionHandler } from "./surface/types";

const ardenOrbSource = new URL("./assets/arden-orb-source.png", import.meta.url).href;
const companySource: ChatSource = { kind: "company" };

type AskArdenPageProps = {
  active?: boolean;
  platform: Platform;
  organizationId: string | null;
  /** Shared Company chat instance hoisted by ArdenShell; omitted in standalone tests/usage. */
  chat?: ArdenChat;
  basket?: ContextBasket;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
  /** Optional seam for dispatching UiSurface actions (e.g., SurfaceActionDispatcher). */
  onSurfaceAction?: SurfaceActionHandler;
  /** Opens a saved chat (or a new one for null) from the address bar, handled once per navigation. */
  routeRequest?: { conversationId: string | null; navigationId: string } | null;
  /** Reports the open saved chat; a first question turns the new chat into a saved one in place. */
  onConversationChange?: (conversationId: string | null, options: { replace: boolean }) => void;
  /** Called once a route request has been shown, refused or has failed. */
  onRouteSettled?: () => void;
};

export function AskArdenPage(props: AskArdenPageProps) {
  if (props.chat) return <AskArdenPageContent {...props} chat={props.chat} />;
  return <StandaloneAskArdenPage {...props} />;
}

function StandaloneAskArdenPage(props: Omit<AskArdenPageProps, "chat">) {
  const chat = useArdenChat({ platform: props.platform, organizationId: props.organizationId, source: companySource });
  return <AskArdenPageContent {...props} chat={chat} />;
}

function AskArdenPageContent({ chat, basket, onOpenCitation, onSurfaceAction, active = true, routeRequest, onConversationChange, onRouteSettled }: AskArdenPageProps & { chat: ArdenChat }) {
  const [examplesVisible, setExamplesVisible] = useState(true);
  const [resetting, setResetting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyId = useId(), sourcesId = useId();
  const navigation = useWorkspaceNavigation();
  const island = useStatusIsland();
  const toast = island?.toast ?? null;
  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus());

  const openingSaved = useRef(false);
  const reportedId = useRef<string | null>(null);
  useEffect(() => {
    // Asking the first question saves the new chat under its id: the address changes in place, not as a new page.
    const replace = reportedId.current === null && chat.currentId !== null && !openingSaved.current;
    openingSaved.current = false;
    reportedId.current = chat.currentId;
    onConversationChange?.(chat.currentId, { replace });
  }, [chat.currentId, onConversationChange]);
  const handledRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!routeRequest || handledRoute.current === routeRequest.navigationId) return;
    handledRoute.current = routeRequest.navigationId;
    const target = routeRequest.conversationId;
    // A waiting answer is never abandoned by Back; the address returns to this chat instead.
    if (target === chat.currentId || chat.pending) { onRouteSettled?.(); return; }
    if (!target) { chat.reset(); onRouteSettled?.(); return; }
    openingSaved.current = true;
    void chat.openConversation(target).finally(() => onRouteSettled?.());
  }, [routeRequest]);

  const ask = (prompt: string) => {
    chat.setDraft(prompt);
    if (composerRef.current) composerRef.current.focus();
    else focusComposer();
  };

  const handleSurfaceAction: SurfaceActionHandler = (action, opener, documents) => {
    if (onSurfaceAction) {
      onSurfaceAction(action, opener, documents);
      return;
    }
    if (action.kind === "open_reader" && onOpenCitation) {
      onOpenCitation({
        documentId: action.documentId,
        versionId: action.publishedVersionId,
        blockId: action.blockId,
        page: action.page,
        excerpt: "",
      });
    }
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

  if (!active) return null;

  return <main id="arden-main" className="workspace-page ask-arden-page" aria-labelledby="ask-arden-title" tabIndex={-1}>
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
            onOpen={(id) => { openingSaved.current = true; void chat.openConversation(id, true).then((opened) => { if (opened) focusComposer(); }); }}
            onRetry={() => void chat.loadHistory()} onClose={chat.closeHistory} />}
        </span>
        {!chat.empty && <button type="button" className="island-link-button" disabled={chat.pending || chat.historyLoading}
          onClick={chat.reloadConversation}>Reload chat</button>}
        {!chat.empty && <button type="button" className="island-link-button" onClick={() => setResetting(true)}>New chat</button>}
      </header>
      {toast && <div className="status-island is-toast ask-status-island" role="region" aria-label="Status island">
        <div className="status-island-live" role="status" aria-live="polite">
          <div className="status-island-content status-island-toast">
            <ToastContent message={toast.message} onDismiss={toast.onDismiss} action={toast.action} />
          </div>
        </div>
      </div>}

      <div className="ask-thread-scroll" aria-live="polite">
        {chat.empty ? <section className="ask-empty-state" aria-labelledby="ask-arden-title">
          <img className="ask-brand-watermark" src={ardenOrbSource} alt="" aria-hidden="true" />
          <ChatComposer chat={chat} basket={basket} placement="center" composerRef={composerRef} />

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

        </section> : <ChatMessages chat={chat} sourcesId={sourcesId} onSurfaceAction={handleSurfaceAction} onPrefillPrompt={ask} />}
      </div>

      {!chat.empty && <ChatComposer chat={chat} basket={basket} placement="dock" composerRef={composerRef} />}
      {chat.sourcePanel && <CitationSourcesPanel key={chat.sourcePanel.messageId} id={sourcesId} citations={chat.sourcePanel.citations}
        selected={chat.sourcePanel.selected} onOpenDocument={onOpenCitation} onClose={chat.closeSources} />}
    </div>
    {resetting && <NewChatDialog hasDraft={Boolean(chat.draft.trim())} onCancel={() => setResetting(false)} onConfirm={reset} />}
  </main>;
}
