import { useEffect, useId, useRef, useState } from "react";
import { ApiError, findKnowledgeReaders, type KnowledgeReaderMatch } from "../shared/api-client";
import { listItemShares, revokeItemShare, shareItem, type ItemShares } from "../shared/direct-share-api";
import { Icon } from "../shared/Icon";
import type { Platform } from "../shared/types";

/**
 * Decision 0034 (spec F03-SHR): give named members of this organization view-only access to a private item,
 * without review, and revoke it. Departments and the whole organization are reached by contributing a copy.
 */
export function SharePeoplePanel({ platform, organizationId, item, onBack, onContribute }: {
  platform: Platform;
  organizationId: string;
  item: { id: string; title: string };
  onBack: () => void;
  /** Switches to contributing a copy, suggested as the item reaches many people. */
  onContribute: () => void;
}) {
  const [shares, setShares] = useState<ItemShares | null>(null);
  const [selected, setSelected] = useState<KnowledgeReaderMatch[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<KnowledgeReaderMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    void listItemShares(platform, organizationId, item.id)
      .then((loaded) => { if (mounted.current) setShares(loaded); })
      .catch((cause: unknown) => { if (mounted.current) setError(message(cause, "Who has access couldn’t be loaded.")); });
    return () => { mounted.current = false; };
  }, [platform, organizationId, item.id]);

  useEffect(() => {
    if (query.trim().length < 2) { setMatches([]); return; }
    let present = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void findKnowledgeReaders(platform, organizationId, query).then((items) => { if (present) setMatches(items); })
        .catch((cause: unknown) => { if (present) setError(message(cause, "Couldn’t load members.")); })
        .finally(() => { if (present) setSearching(false); });
    }, 250);
    return () => { present = false; window.clearTimeout(timer); };
  }, [platform, organizationId, query]);

  const recipients = shares?.recipients ?? [];
  const limit = shares?.recipientLimit ?? 0;
  const remaining = Math.max(0, limit - recipients.length - selected.length);
  const taken = new Set([...recipients.map((recipient) => recipient.membershipId), ...selected.map((member) => member.id)]);
  const offered = matches.filter((member) => !taken.has(member.id));
  const nearLimit = Boolean(shares) && limit > 0 && recipients.length + selected.length >= Math.max(1, limit - 1);

  const run = async (work: () => Promise<ItemShares>, done: (result: ItemShares) => string) => {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await work();
      if (!mounted.current) return;
      setShares(result);
      setStatus(done(result));
    } catch (cause) {
      if (mounted.current) setError(message(cause, "This change couldn’t be saved."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const share = () => run(() => shareItem(platform, organizationId, item.id, selected.map((member) => member.id)), () => {
    const names = selected.map((member) => member.name).join(", ");
    setSelected([]);
    return `Shared with ${names}`;
  });
  const revoke = (shareId: string | null, name?: string) =>
    run(() => revokeItemShare(platform, organizationId, item.id, shareId), () => name ? `${name} no longer has access` : "Nobody else has access now");

  return <div className="contribute-island share-island" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onBack(); } }}>
    <div>
      <h2 id={titleId} ref={heading} tabIndex={-1}>Share with people</h2>
      <p className="island-meta">Not reviewed · view only · not an official document</p>
    </div>
    {!shares && !error && <p className="island-meta" role="status">Loading who has access…</p>}
    {shares && <section aria-label="People with access" className="share-people">
      {recipients.length === 0 ? <p className="island-meta">Only you can see “{item.title}”.</p>
        : <ul className="share-recipients">{recipients.map((recipient) => <li key={recipient.shareId}>
          <span className="km-member-identity"><strong>{recipient.name}</strong>
            <small>{recipient.active ? recipient.email ?? "" : "No longer an active member"}</small></span>
          <button type="button" className="secondary-button" disabled={busy}
            aria-label={`Revoke access for ${recipient.name}`} onClick={() => void revoke(recipient.shareId, recipient.name)}>Revoke</button>
        </li>)}</ul>}
      {recipients.length > 1 && <button type="button" className="pn-link-button" disabled={busy} onClick={() => void revoke(null)}>Revoke all</button>}
    </section>}
    {shares && <div className="km-readers share-add">
      {selected.length > 0 && <div className="km-selected-readers">{selected.map((member) => <button key={member.id} type="button" title={member.email}
        onClick={() => setSelected((current) => current.filter((entry) => entry.id !== member.id))}>
        {member.name}<Icon name="close" size={11} /><span className="sr-only">Remove {member.name}</span></button>)}</div>}
      <input type="search" maxLength={80} aria-label="Add people by name or email" placeholder="Add people by name or email"
        value={query} disabled={busy || remaining === 0} onChange={(event) => setQuery(event.target.value)} />
      {query.trim().length >= 2 && <ul className="km-member-results">{offered.map((member) => <li key={member.id}>
        <button type="button" disabled={remaining === 0} aria-label={`Add ${member.name}${member.email ? `, ${member.email}` : ""}`}
          onClick={() => { setSelected((current) => [...current, member]); setQuery(""); }}>
          <span className="km-member-identity"><strong>{member.name}</strong>
            {(member.email || member.department) && <small>{[member.email, member.department].filter(Boolean).join(" · ")}</small>}</span>
          <Icon name="plus" size={12} /></button></li>)}</ul>}
      <small role="status">{searching ? "Finding members…" : query.trim().length >= 2 && !offered.length
        ? "No other members found." : `${recipients.length + selected.length} of ${limit} people`}</small>
    </div>}
    {nearLimit && <p className="share-choice-reason" role="note">
      This item is reaching many people. To share it with a department or the whole organization, contribute a copy for review.{" "}
      <button type="button" className="pn-link-button" onClick={onContribute}>Contribute instead</button>
    </p>}
    {status && <p className="island-meta" role="status">{status}</p>}
    {error && <p role="alert" className="knowledge-form-error">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onBack}>Back</button>
      <button type="button" className="primary-button" disabled={busy || selected.length === 0} onClick={() => void share()}>
        {busy ? "Saving…" : "Share"}</button>
    </div>
  </div>;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof Error ? cause.message || fallback : fallback;
}
