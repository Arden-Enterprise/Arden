import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "../shared/Icon";
import type { AiConversationSummary } from "../shared/api-client";
import { groupChatHistory } from "./chatHistory";

/**
 * Non-modal history popover under the History button: search titles, chats grouped by last update,
 * the open chat marked. Escape, Close or a click outside returns focus to History.
 */
export function ChatHistoryPopover({ id, anchor, items, loading, error, currentId, openingId, onOpen, onRetry, onClose }: {
  id: string;
  anchor: RefObject<HTMLButtonElement | null>;
  items: readonly AiConversationSummary[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  openingId: string | null;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLElement>(null), search = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupChatHistory(items, new Date(), query), [items, query]);
  const latestClose = useRef(onClose); latestClose.current = onClose;

  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !anchor.current?.contains(target)) latestClose.current();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [anchor]);

  const close = () => { onClose(); anchor.current?.focus(); };
  const rows = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".ask-history-row:not(:disabled)") ?? []);
  const move = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = rows();
    if (!list.length) return;
    event.preventDefault();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") list[index < 0 ? 0 : Math.min(index + 1, list.length - 1)]!.focus();
    else if (index <= 0) search.current?.focus();
    else list[index - 1]!.focus();
  };

  return <section ref={root} id={id} className="ask-history" role="dialog" aria-label="Chat history" onKeyDown={move}>
    <div className="ask-history-search">
      <Icon name="search" size={14} />
      <label className="sr-only" htmlFor={`${id}-search`}>Search chat titles</label>
      <input ref={search} id={`${id}-search`} type="search" value={query} placeholder="Search chat titles"
        onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className="island-icon-button ask-history-close" aria-label="Close history" title="Close history" onClick={close}>
        <Icon name="close" size={13} />
      </button>
    </div>

    <div className="ask-history-list">
      {loading && !items.length ? <div className="ask-history-skeleton" role="status" aria-label="Loading chats"><i /><i /><i /><i /></div>
        : error && !items.length ? <div className="ask-history-note is-error" role="alert"><p>{error}</p>
          <button type="button" className="secondary-button" onClick={onRetry}>Try again</button></div>
        : !items.length ? <div className="ask-history-note"><strong>No chats yet</strong>
          <p>Chats you start in Ask Arden are saved here.</p></div>
        : !groups.length ? <div className="ask-history-note" role="status"><p>No chat titles match “{query.trim()}”. Search looks at titles only.</p>
          <button type="button" className="secondary-button" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</button></div>
        : groups.map((group) => <div key={group.label} role="group" aria-labelledby={`${id}-${group.label}`}>
          <p id={`${id}-${group.label}`} className="ask-history-group">{group.label}</p>
          {group.items.map((item) => <button key={item.id} type="button" className="ask-history-row"
            aria-current={item.id === currentId ? "page" : undefined} aria-busy={item.id === openingId || undefined}
            disabled={Boolean(openingId) && item.id !== openingId} onClick={() => onOpen(item.id)}>
            <span className="ask-history-title">{item.title}</span>
            {item.id === openingId ? <span className="ask-history-spinner" aria-hidden="true" />
              : <span className="ask-history-when">{item.when}</span>}
          </button>)}
        </div>)}
      {error && items.length > 0 && <p className="ask-history-inline-error" role="alert">{error}</p>}
    </div>

    <p className="ask-history-footer"><Icon name="lock" size={11} />Only you can see your chats · latest 50</p>
  </section>;
}
