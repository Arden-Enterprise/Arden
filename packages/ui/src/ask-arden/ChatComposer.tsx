import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import type { ContextBasket } from "../graph/context-basket";
import { Icon } from "../shared/Icon";
import type { ArdenChat } from "./useArdenChat";

export function ChatComposer({ chat, placement, composerRef, basket }: {
  chat: ArdenChat;
  placement: "center" | "dock" | "panel";
  composerRef: RefObject<HTMLTextAreaElement | null>;
  basket?: ContextBasket;
}) {
  const promptId = useId();
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(() => new Set());
  const submit = (event?: FormEvent) => { event?.preventDefault(); void chat.submit(); };
  const toggleBranch = (entryId: string) => {
    setExpandedBranchIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };
  const expandedBranches = basket
    ? basket.entries.filter((entry) => entry.branchLabel && expandedBranchIds.has(entry.id))
    : [];

  return <form className={`ask-composer is-${placement}`} onSubmit={submit}>
    {basket && basket.documentIds.size > 0 && (
      <div className="ask-context-basket" role="region" aria-label="Scoped context">
        <div className="ask-context-header">
          <span className="ask-context-summary">
            <Icon name="layers" size={12} />
            <span>Scoped to {basket.documentIds.size} {basket.documentIds.size === 1 ? "document" : "documents"}</span>
          </span>
          <button type="button" className="ask-context-clear" onClick={basket.clear}>Clear scope</button>
        </div>
        <div className="ask-context-chips" role="list" aria-label="Pinned context">
          {basket.entries.map((entry) => entry.branchLabel ? (() => {
            const expanded = expandedBranchIds.has(entry.id);
            const panelId = `${promptId}-branch-${entry.id}`;
            const countLabel = `${entry.documents.length} ${entry.documents.length === 1 ? "doc" : "docs"}`;
            return (
              <div key={entry.id} role="listitem" className={`ask-context-chip is-branch${expanded ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="ask-context-chip-toggle"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  title={`${entry.branchLabel} · ${countLabel}`}
                  onClick={() => toggleBranch(entry.id)}
                >
                  <Icon name="chevron" size={10} />
                  <span className="ask-context-chip-label">{entry.branchLabel}</span>
                  <span className="ask-context-chip-count">· {countLabel}</span>
                </button>
                <button
                  type="button"
                  className="ask-context-chip-remove"
                  aria-label={`Remove ${entry.branchLabel}`}
                  title={`Remove ${entry.branchLabel}`}
                  onClick={() => basket.removeEntry(entry.id)}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            );
          })() : entry.documents.map((doc) => (
            <div key={`${entry.id}:${doc.documentId}`} role="listitem" className="ask-context-chip">
              <span className="ask-context-chip-label" title={`${doc.title} · ${doc.ownerDepartmentName}`}>
                {doc.title}
              </span>
              <button
                type="button"
                className="ask-context-chip-remove"
                aria-label={`Remove ${doc.title}`}
                title={`Remove ${doc.title}`}
                onClick={() => basket.removeDocument(doc.documentId)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          )))}
        </div>
        {expandedBranches.map((entry) => {
          const panelId = `${promptId}-branch-${entry.id}`;
          return (
            <div key={entry.id} id={panelId} className="ask-context-branch-list" role="region" aria-label={`${entry.branchLabel} documents`}>
              <div className="ask-context-branch-head">
                <span>{entry.branchLabel} · {entry.documents.length} {entry.documents.length === 1 ? "doc" : "docs"}</span>
                <button type="button" className="ask-context-clear" onClick={() => basket.removeEntry(entry.id)}>
                  Remove all
                </button>
              </div>
              <ul>
                {entry.documents.map((doc) => (
                  <li key={doc.documentId}>
                    <span className="ask-context-branch-doc" title={`${doc.title} · ${doc.ownerDepartmentName}`}>
                      <strong>{doc.title}</strong>
                      <small>{doc.ownerDepartmentName}</small>
                    </span>
                    <button
                      type="button"
                      className="ask-context-chip-remove"
                      aria-label={`Remove ${doc.title}`}
                      title={`Remove ${doc.title}`}
                      onClick={() => basket.removeDocument(doc.documentId)}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    )}
    {basket?.notice && (
      <div className="ask-context-notice" role="status">
        <span>{basket.notice}</span>
        <button
          type="button"
          className="ask-context-chip-remove"
          aria-label="Dismiss notice"
          title="Dismiss notice"
          onClick={basket.dismissNotice}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    )}
    <label className="sr-only" htmlFor={promptId}>Ask Arden</label>
    <textarea id={promptId} ref={composerRef} rows={2} value={chat.draft} onChange={(event) => chat.setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) submit();
      }}
      placeholder="Ask Arden…" />
    <div className="ask-composer-tools">
      <div className="ask-composer-actions">
        {chat.pending ? <button type="button" className="island-link-button" onClick={() => { chat.stopWaiting(); composerRef.current?.focus(); }}>Stop waiting</button>
          : chat.draft && <button type="button" className="island-link-button" onClick={() => { chat.setDraft(""); composerRef.current?.focus(); }}>Clear</button>}
        <button type="submit" className="ask-send" disabled={!chat.draft.trim() || chat.pending || !chat.canAsk} aria-label="Send message"><Icon name="arrow" size={15} /></button>
      </div>
    </div>
  </form>;
}
