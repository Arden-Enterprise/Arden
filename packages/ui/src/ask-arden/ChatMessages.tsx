import { Icon } from "../shared/Icon";
import { CitedAnswer } from "./CitedAnswer";
import type { ArdenChat } from "./useArdenChat";

/** The conversation; a source chip opens that answer's Sources panel (see CitationSourcesPanel). */
export function ChatMessages({ chat }: { chat: ArdenChat }) {
  return <section className="ask-conversation" aria-label="Conversation">
    {chat.error && <div className="ask-thread-notice" role="alert"><Icon name="warning" size={14} /><span>{chat.error}</span></div>}
    {chat.messages.map((message) => <article key={message.id} className={`ask-message is-${message.role}`}>
      <div className="ask-message-meta"><span>{message.role === "member" ? "You" : "Arden"}</span>{message.insufficientEvidence && <small>Not enough information</small>}{message.unavailable && <small>Unavailable</small>}{message.unsent && <small>Not sent</small>}</div>
      <div className="ask-message-body">{message.role === "assistant" && message.citations?.length
        ? <CitedAnswer body={message.body} citations={message.citations} onOpen={(citation) => chat.showSources(message.id, citation)} />
        : <p>{message.body}</p>}</div>
    </article>)}
    {chat.pending && <div className="ask-answer-pending" role="status"><span />Searching documents…</div>}
  </section>;
}
