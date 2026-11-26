import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../shared/api-client";
import { listSharedWithMe, loadSharedItem, loadSharedPdf, type SharedItem, type SharedItemSummary } from "../shared/direct-share-api";
import { Icon } from "../shared/Icon";
import type { Platform } from "../shared/types";
import { PrivatePdfView } from "../personal-workspace/PrivatePdfView";

const shortDate = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const failure = (cause: unknown, fallback: string) => cause instanceof ApiError && cause.status === 404
  ? "You no longer have access to this item." : cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * Decision 0034 (spec F03-SHR): items colleagues shared with this member directly. They are listed apart from
 * approved publications and always labelled as not reviewed. Nothing shows while there are none.
 */
export function DirectSharesSection({ platform, organizationId, refreshKey, onOpen }: {
  platform: Platform; organizationId: string; refreshKey: number; onOpen: (itemId: string) => void;
}) {
  const [items, setItems] = useState<SharedItemSummary[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let present = true;
    setError("");
    void listSharedWithMe(platform, organizationId).then((loaded) => { if (present) setItems(loaded); })
      .catch((cause: unknown) => { if (present) setError(failure(cause, "Items shared with you couldn’t be loaded.")); });
    return () => { present = false; };
  }, [platform, organizationId, refreshKey, attempt]);

  if (error) return <p className="admin-feedback is-error" role="alert">{error}{" "}
    <button type="button" className="pn-link-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>;
  if (!items?.length) return null;
  return <section className="direct-shares" aria-labelledby="direct-shares-title">
    <div className="direct-shares-heading">
      <h2 id="direct-shares-title">Shared directly — not reviewed</h2>
      <p className="island-meta">Colleagues let you read these private items. They are not official documents.</p>
    </div>
    <ul className="direct-share-list">{items.map((item) => <li key={item.id}>
      <button type="button" className="direct-share-row" onClick={() => onOpen(item.id)}>
        <Icon name={item.kind === "pdf" ? "pdf" : "document"} size={16} />
        <span className="direct-share-copy"><strong>{item.title}</strong>
          <span>Shared by {item.ownerName} · {shortDate(item.sharedAt)}</span></span>
        <span className="island-chip">Not reviewed</span>
      </button>
    </li>)}</ul>
  </section>;
}

/**
 * A directly shared item, read only: the owner's current saved text, or their PDF without a Download action.
 * Hiding Download is a display rule; it does not stop someone saving what their browser shows.
 */
export function SharedItemReader({ platform, organizationId, itemId, renderText, onBack, onLost }: {
  platform: Platform; organizationId: string; itemId: string;
  renderText: (item: SharedItem) => ReactNode;
  onBack: () => void;
  /** Called when the item is no longer shared with this member. */
  onLost: () => void;
}) {
  const [item, setItem] = useState<SharedItem | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let present = true;
    setItem(null); setError("");
    void loadSharedItem(platform, organizationId, itemId).then((loaded) => { if (present) setItem(loaded); })
      .catch((cause: unknown) => {
        if (!present) return;
        setError(failure(cause, "This item couldn’t be opened."));
        if (cause instanceof ApiError && cause.status === 404) onLost();
      });
    return () => { present = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only for another item
  }, [platform, organizationId, itemId]);
  const loadPdf = useCallback((id: string) => loadSharedPdf(platform, organizationId, id), [platform, organizationId]);

  const label = item ? <p className="shared-item-label" role="note"><Icon name="people" size={13} />
    Shared by {item.ownerName} — not reviewed · view only</p> : null;
  const back = <button type="button" className="secondary-button" onClick={onBack}>Back to Home</button>;
  if (error) return <section className="shared-item-reader"><div className="pn-page-toolbar">{back}</div>
    <p className="admin-feedback is-error" role="alert">{error}</p></section>;
  if (!item) return <section className="shared-item-reader"><p className="island-meta" role="status">Opening the shared item…</p></section>;
  if (item.kind === "pdf") {
    return <PrivatePdfView itemId={item.id} title={item.title} revision={item.version} loadPdf={loadPdf} allowDownload={false}
      heading={<><span className="pn-page-icon" aria-hidden="true"><Icon name="pdf" size={22} /></span><h2>{item.title}</h2></>}
      notice={label} toolbar={<><span className="note-toolbar-spacer" />{back}</>} />;
  }
  return <section className="pn-page shared-item-reader" aria-label={item.title}>
    <div className="pn-page-toolbar"><span className="note-toolbar-spacer" />{back}</div>
    <div className="pn-page-body">
      <div className="pn-page-heading"><span className="pn-page-icon" aria-hidden="true"><Icon name="document" size={22} /></span><h2>{item.title}</h2></div>
      {label}
      <p className="pn-page-meta">Updated {shortDate(item.updatedAt)}</p>
      {renderText(item)}
    </div>
  </section>;
}
