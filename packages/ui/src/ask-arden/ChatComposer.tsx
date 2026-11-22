import { useId, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "../shared/Icon";
import type { AiVersionScope } from "../shared/api-client";
import type { ArdenChat } from "./useArdenChat";

export function ChatComposer({ chat, placement, composerRef }: {
  chat: ArdenChat;
  placement: "center" | "dock" | "panel";
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const promptId = useId();
  const submit = (event?: FormEvent) => { event?.preventDefault(); void chat.submit(); };
  return <form className={`ask-composer is-${placement}`} onSubmit={submit}>
    <label className="sr-only" htmlFor={promptId}>Ask Arden</label>
    <textarea id={promptId} ref={composerRef} rows={2} value={chat.draft} onChange={(event) => chat.setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(); }}
      placeholder="Ask Arden…" />
    <div className="ask-composer-tools">
      <label className="ask-scope"><Icon name="knowledge" size={13} />
        <select aria-label="Knowledge version scope" value={chat.versionScope} disabled={chat.pending}
          onChange={(event) => chat.setVersionScope(event.target.value as AiVersionScope)}>
          <option value="CURRENT">Current guidance</option><option value="UPCOMING">Upcoming changes</option>
          <option value="COMPARE">Compare versions</option>
        </select>
      </label>
      <div className="ask-composer-actions">
        {chat.pending ? <button type="button" className="island-link-button" onClick={() => { chat.stopWaiting(); composerRef.current?.focus(); }}>Stop waiting</button>
          : chat.draft && <button type="button" className="island-link-button" onClick={() => { chat.setDraft(""); composerRef.current?.focus(); }}>Clear</button>}
        <button type="button" className="ask-attach" disabled title="Attachments aren’t available yet" aria-label="Attachments aren’t available yet">
          <Icon name="plus" size={15} />
        </button>
        <button type="submit" className="ask-send" disabled={!chat.draft.trim() || chat.pending || !chat.canAsk} aria-label="Send message"><Icon name="arrow" size={15} /></button>
      </div>
    </div>
  </form>;
}
