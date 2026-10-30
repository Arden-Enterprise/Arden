import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";
import { useWorkspaceNavigation } from "../shared/WorkspaceNavigationContext";
import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import { ApiError, askArden } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { answerMessage, starterPrompts, type AskArdenMessage } from "./askArdenModel";

const ardenOrbSource = new URL("./assets/arden-orb-source.png", import.meta.url).href;

type AskArdenPageProps = {
  active?: boolean;
  platform: Platform;
  organizationId: string | null;
  onOpenCitation?: (citation: KnowledgeCitationReference) => void;
};

export function AskArdenPage({ platform, organizationId, onOpenCitation, active = true }: AskArdenPageProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AskArdenMessage[]>([]);
  const [examplesVisible, setExamplesVisible] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const pendingQuestion = useRef<{ id: string; query: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const requestGeneration = useRef(0);
  const navigation = useWorkspaceNavigation();
  const empty = messages.length === 0;
  const threadTitle = messages.find((message) => message.role === "member")?.body ?? "New conversation";

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const query = draft.trim();
    if (!query || pending || !organizationId) return;
    const generation = ++requestGeneration.current;
    const questionId = crypto.randomUUID();
    pendingQuestion.current = { id: questionId, query };
    setMessages((current) => [...current, { id: questionId, role: "member", body: query }]);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const answer = await askArden(platform, organizationId, query);
      if (generation !== requestGeneration.current) return;
      setMessages((current) => [...current, answerMessage(answer, crypto.randomUUID())]);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof ApiError ? cause.message : "Ask Arden could not prepare an answer.");
      }
    } finally {
      if (generation === requestGeneration.current) { setPending(false); pendingQuestion.current = null; }
    }
  };

  const ask = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const reset = () => {
    requestGeneration.current++;
    setPending(false);
    setDraft("");
    setMessages([]);
    setError(null);
    pendingQuestion.current = null;
    setResetting(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const stopWaiting = () => {
    // This dismisses the local wait, not the provider's already-started work or cost.
    const question = pendingQuestion.current;
    requestGeneration.current++; pendingQuestion.current = null;
    setPending(false); setError(null);
    if (question) {
      setMessages((current) => current.filter((message) => message.id !== question.id));
      setDraft((current) => current || question.query);
    }
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const composer = (placement: "center" | "dock") => <form className={`ask-composer is-${placement}`} onSubmit={submit}>
    <label className="sr-only" htmlFor="ask-arden-prompt">Ask Arden</label>
    <textarea id="ask-arden-prompt" ref={composerRef} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(); }}
      placeholder="Ask Arden…" />
    <div className="ask-composer-tools">
      <span className="ask-scope"><Icon name="knowledge" size={13} />Published documents<Icon name="chevron" size={10} /></span>
      <div className="ask-composer-actions">
      {pending ? <button type="button" className="island-link-button" onClick={stopWaiting}>Stop waiting</button>
        : draft && <button type="button" className="island-link-button" onClick={() => { setDraft(""); composerRef.current?.focus(); }}>Clear</button>}
      <button type="button" className="ask-attach" disabled title="Attachments aren’t available yet" aria-label="Attachments aren’t available yet">
        <Icon name="plus" size={15} />
      </button>
      <button type="submit" className="ask-send" disabled={!draft.trim() || pending || !organizationId} aria-label="Send message"><Icon name="arrow" size={15} /></button>
      </div>
    </div>
  </form>;

  return <main id={active ? "arden-main" : undefined} className="workspace-page ask-arden-page" aria-labelledby="ask-arden-title" tabIndex={-1}>
    <h1 id="ask-arden-title" className="sr-only">Ask Arden</h1>
    <div className={`ask-arden-stage${empty ? " is-empty" : " is-thread"}`}>
      <header className="ask-thread-header">
        {navigation && <button type="button" className="ask-menu-button" aria-label={navigation.open ? "Close navigation" : "Open navigation"}
          aria-controls="arden-primary-navigation" aria-expanded={navigation.open} onClick={() => navigation.setOpen((open) => !open)}>
          <Icon name={navigation.open ? "close" : "menu"} size={17} />
        </button>}
        <div className="ask-thread-title"><strong>{empty ? "New chat" : threadTitle}</strong></div>
        {!empty && <button type="button" className="island-link-button" onClick={() => setResetting(true)}>New chat</button>}
      </header>

      <div className="ask-thread-scroll" aria-live="polite">
        {empty ? <section className="ask-empty-state" aria-labelledby="ask-arden-title">
          <img className="ask-brand-watermark" src={ardenOrbSource} alt="" aria-hidden="true" />
          {composer("center")}

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

        </section> : <section className="ask-conversation" aria-label="Conversation">
          {error && <div className="ask-thread-notice" role="alert"><Icon name="warning" size={14} /><span>{error}</span></div>}
          {messages.map((message) => <article key={message.id} className={`ask-message is-${message.role}`}>
            <div className="ask-message-meta"><span>{message.role === "member" ? "You" : "Arden"}</span>{message.insufficientEvidence && <small>Not enough information</small>}</div>
            <div className="ask-message-body"><p>{message.body}</p></div>
            {message.citations && <div className="ask-citations" aria-label="Sources">
              <span className="ask-citation-label">Sources</span>
              {message.citations.map((citation, index) => <button type="button" className="ask-citation"
                key={`${citation.documentId}:${citation.versionId}:${citation.blockId ?? "source"}`}
                onClick={() => onOpenCitation?.(citation)} disabled={!onOpenCitation}
                aria-label={`Open source ${index + 1}: ${citation.title}, ${citation.version}`}>
                <span>{index + 1}</span><div><strong>{citation.title}</strong><small>{citation.version}{citation.page ? ` · Page ${citation.page}` : ""} · {citation.scope}</small></div>
                <Icon name="arrow" size={13} />
              </button>)}
            </div>}
          </article>)}
          {pending && <div className="ask-answer-pending" role="status"><span />Searching documents…</div>}
        </section>}
      </div>

      {!empty && composer("dock")}
    </div>
    {resetting && <KnowledgeDialog confirmation title="Start a new chat?" onClose={() => setResetting(false)}>
      <p>This clears the current conversation.</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setResetting(false)}>Cancel</button>
        <button type="button" className="primary-button" onClick={reset}>New chat</button></div>
    </KnowledgeDialog>}
  </main>;
}
