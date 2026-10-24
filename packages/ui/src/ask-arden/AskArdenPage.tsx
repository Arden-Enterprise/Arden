import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "../shared/Icon";
import { useWorkspaceNavigation } from "../shared/WorkspaceNavigationContext";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import { ApiError, askArden } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { answerMessage, starterPrompts, type AskArdenMessage } from "./askArdenModel";

const ardenOrbSource = new URL("./assets/arden-orb-source.png", import.meta.url).href;

type AskArdenPageProps = {
  platform: Platform;
  organizationId: string | null;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
};

export function AskArdenPage({ platform, organizationId, onOpenCitation }: AskArdenPageProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AskArdenMessage[]>([]);
  const [examplesVisible, setExamplesVisible] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const navigation = useWorkspaceNavigation();
  const empty = messages.length === 0;
  const threadTitle = messages.find((message) => message.role === "member")?.body ?? "New conversation";

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const query = draft.trim();
    if (!query || pending || !organizationId) return;
    const questionId = crypto.randomUUID();
    setMessages((current) => [...current, { id: questionId, role: "member", body: query }]);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const answer = await askArden(platform, organizationId, query);
      setMessages((current) => [...current, answerMessage(answer, crypto.randomUUID())]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Ask Arden could not prepare an answer.");
    } finally {
      setPending(false);
    }
  };

  const ask = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const reset = () => {
    setDraft("");
    setMessages([]);
    setError(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const composer = (placement: "center" | "dock") => <form className={`ask-composer is-${placement}`} onSubmit={submit}>
    <label className="sr-only" htmlFor="ask-arden-prompt">Ask Arden</label>
    <textarea id="ask-arden-prompt" ref={composerRef} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(); }}
      placeholder="Ask Arden…" />
    <div className="ask-composer-tools">
      <span className="ask-scope"><Icon name="knowledge" size={13} />Published knowledge<Icon name="chevron" size={10} /></span>
      <span className="ask-composer-boundary">{pending ? "Searching…" : "Permission-aware"}</span>
      <button type="button" className="ask-attach" disabled title="Attachments are not connected yet" aria-label="Attachments are not connected yet">
        <Icon name="plus" size={15} />
      </button>
      <button type="submit" className="ask-send" disabled={!draft.trim() || pending || !organizationId} aria-label="Send prompt"><Icon name="arrow" size={15} /></button>
    </div>
  </form>;

  return <main id="arden-main" className="workspace-page ask-arden-page" aria-labelledby="ask-arden-title" tabIndex={-1}>
    <div className={`ask-arden-stage${empty ? " is-empty" : " is-thread"}`}>
      <header className="ask-thread-header">
        {navigation && <button type="button" className="ask-menu-button" aria-label={navigation.open ? "Close navigation" : "Open navigation"}
          aria-controls="arden-primary-navigation" aria-expanded={navigation.open} onClick={() => navigation.setOpen((open) => !open)}>
          <Icon name={navigation.open ? "close" : "menu"} size={17} />
        </button>}
        <button type="button" className="ask-thread-title" onClick={reset} disabled={empty}>
          <strong>{empty ? "New chat" : threadTitle}</strong><Icon name="chevron" size={11} />
        </button>
      </header>

      <div className="ask-thread-scroll" aria-live="polite">
        {empty ? <section className="ask-empty-state" aria-labelledby="ask-arden-title">
          <h1 id="ask-arden-title" className="sr-only">Ask Arden</h1>
          <img className="ask-brand-watermark" src={ardenOrbSource} alt="" aria-hidden="true" />
          {composer("center")}
          <span className="ask-index-state"><Icon name="knowledge" size={12} />Indexed published knowledge</span>

          {examplesVisible && <div className="ask-examples">
            <div className="ask-examples-heading"><span>Get started with some examples</span><button type="button" aria-label="Hide examples" onClick={() => setExamplesVisible(false)}><Icon name="close" size={12} /></button></div>
            <div className="ask-starter-grid" aria-label="Starter prompts">
              {starterPrompts.map((prompt, index) => <button key={prompt} type="button" onClick={() => ask(prompt)}>
                <Icon name={index === 0 ? "review" : index === 1 ? "search" : "people"} size={14} />
                <strong>{index === 0 ? "Understand a workflow" : index === 1 ? "Summarize guidance" : "Find a policy"}</strong>
                <span>{prompt}</span>
              </button>)}
            </div>
          </div>}

        </section> : <section className="ask-conversation" aria-label="Conversation">
          {error && <div className="ask-thread-notice" role="alert"><Icon name="warning" size={14} /><span>{error}</span></div>}
          {messages.map((message) => <article key={message.id} className={`ask-message is-${message.role}`}>
            <div className="ask-message-meta"><span>{message.role === "member" ? "You" : "Arden"}</span>{message.insufficientEvidence && <small>Insufficient evidence</small>}</div>
            <div className="ask-message-body"><p>{message.body}</p></div>
            {message.citations && <div className="ask-citations" aria-label="Sources">
              <span className="ask-citation-label">Sources</span>
              {message.citations.map((citation, index) => <button type="button" className="ask-citation"
                key={`${citation.documentId}:${citation.versionId}:${citation.blockId ?? "source"}`}
                onClick={() => onOpenCitation?.(citation)} disabled={!onOpenCitation}
                aria-label={`Open source ${index + 1}: ${citation.title}, ${citation.version}`}>
                <span>{index + 1}</span><div><strong>{citation.title}</strong><small>{citation.version} · {citation.scope}</small></div>
                <Icon name="arrow" size={13} />
              </button>)}
            </div>}
          </article>)}
          {pending && <div className="ask-answer-pending" role="status"><span />Searching authorized knowledge…</div>}
        </section>}
      </div>

      {!empty && composer("dock")}
    </div>
  </main>;
}
