import { Icon } from "../shared/Icon";
import { CitedAnswer } from "./CitedAnswer";
import { ResponseActions } from "./ResponseActions";
import type { ArdenChat } from "./useArdenChat";

export function ChatMessages({ chat, sourcesId }: { chat: ArdenChat; sourcesId: string }) {
  return <section className="ask-conversation" aria-label="Conversation">
    {chat.error && <div className="ask-thread-notice" role="alert"><Icon name="warning" size={14} /><span>{chat.error}</span></div>}
    {chat.messages.map((message) => <article key={message.id} className={`ask-message is-${message.role}`}>
      <div className="ask-message-meta"><span>{message.role === "member" ? "You" : "Arden"}</span>{message.insufficientEvidence && <small>Not enough information</small>}{message.unavailable && <small>Unavailable</small>}{message.unsent && <small>Not sent</small>}</div>
      {message.role === "assistant" && message.noteCoverage === "PARTIAL" && <div className="ask-thread-notice">
        <Icon name="warning" size={14} /><span>Based on selected passages. Other parts of this note were not reviewed.</span>
      </div>}
      <div className="ask-message-body">{message.role === "assistant"
        ? <CitedAnswer body={message.body} citations={message.citations ?? []} onOpen={(citation, opener) => chat.showSources(message.id, opener, citation)} />
        : <p>{message.body}</p>}</div>
      {message.role === "assistant" && !message.unavailable && <ResponseActions message={message}
        onRate={(chat.privateNote ? message.privateFeedbackToken : message.savedTurn) ? (feedback) => chat.rateAnswer(message, feedback) : undefined}
        onOpenSources={message.citations?.length ? (opener) => chat.showSources(message.id, opener) : undefined}
        sourcesId={sourcesId} sourcesOpen={chat.sourcePanel?.messageId === message.id} />}
    </article>)}
    {chat.pending && <div className="ask-answer-pending" role="status"><span />{chat.privateNote ? "Reading this note…" : "Searching documents…"}</div>}
  </section>;
}
