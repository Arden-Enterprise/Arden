import { useEffect, useRef, useState } from "react";
import { ApiError, loadCollectionPlacement, saveCollectionPlacement, type CollectionPlacement,
  type KnowledgeCollection, type PublishedKnowledge } from "../shared/api-client";
import type { Platform } from "../shared/types";

export function CollectionPlacementEditor({ platform, organizationId, publication, collections, onSaved, onClose, onBusy }: {
  platform: Platform; organizationId: string; publication: PublishedKnowledge; collections: KnowledgeCollection[];
  onSaved: () => Promise<void>; onClose: () => void; onBusy: (busy: boolean) => void;
}) {
  const [current, setCurrent] = useState<CollectionPlacement | null>(null), [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [blocked, setBlocked] = useState(false);
  const [mutating, setMutating] = useState(false);
  const live = useRef(true), requestId = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { live.current = true; heading.current?.focus(); return () => { live.current = false; requestId.current++; }; }, []);
  useEffect(() => {
    if (!mutating) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [mutating]);
  const load = async () => {
    const attempt = ++requestId.current;
    setBusy(true); onBusy(true); setCurrent(null); setError("");
    try {
      const next = await loadCollectionPlacement(platform, organizationId, publication.draftId);
      if (live.current && attempt === requestId.current) { setCurrent(next); setDestination(next.collectionId ?? ""); setBlocked(false); }
    } catch { if (live.current && attempt === requestId.current) { setBlocked(true); setError("Document location is unavailable. Reload to check."); } }
    finally { if (live.current && attempt === requestId.current) { setBusy(false); onBusy(false); } }
  };
  useEffect(() => { void load(); }, [platform, organizationId, publication.draftId]);
  const compatible = collections.filter(item => item.status === "ACTIVE" && publication.management?.type
    && item.allowedTypes?.includes(publication.management.type));
  const valid = !destination || compatible.some(item => item.id === destination);
  const save = async () => {
    if (!current || busy || blocked || !valid || destination === (current.collectionId ?? "")) return;
    setBusy(true); setMutating(true); onBusy(true); setError("");
    try {
      const next = await saveCollectionPlacement(platform, organizationId, current, destination || null);
      if (!live.current) return;
      setCurrent(next); setDestination(next.collectionId ?? ""); setBlocked(true);
    } catch (cause) {
      if (!live.current) return;
      setBlocked(true);
      setError(cause instanceof ApiError && cause.status === 412 ? "Document moved or changed. Reload before moving it."
        : cause instanceof ApiError && cause.status === 404 ? "Document or collection is no longer available. Reload to check."
        : "Couldn’t confirm the move. Reload to check.");
      setBusy(false); setMutating(false); onBusy(false); return;
    }
    try { await onSaved(); }
    catch { if (live.current) setError("Moved. Reload to update this view."); }
    finally { if (live.current) { setBusy(false); setMutating(false); onBusy(false); } }
  };
  return <section className="km-placement-editor" aria-labelledby="km-placement-title" aria-busy={busy}>
    <h3 id="km-placement-title" ref={heading} tabIndex={-1}>Move document</h3><p className="km-placement-document">{publication.title}</p>
    {error && <p className="knowledge-live-error" role="alert">{error}</p>}
    {!current && busy && <p role="status">Loading location…</p>}
    {current && <label className="island-field">Collection<select value={destination} disabled={busy || blocked} onChange={event => setDestination(event.target.value)}>
      <option value="">Unassigned</option>
      {current.collectionId && !compatible.some(item => item.id === current.collectionId) && <option disabled value={current.collectionId}>Unavailable collection</option>}
      {compatible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {current && !compatible.length && <p className="island-note">No collections allow this document type.</p>}
    <div className="knowledge-live-actions">
      {!blocked && current && <button type="button" className="primary-button" disabled={busy || !valid || destination === (current.collectionId ?? "")} onClick={() => void save()}>{busy ? "Moving…" : "Move"}</button>}
      {blocked && <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>Reload location</button>}
      <button type="button" className="secondary-button" disabled={mutating} onClick={onClose}>Cancel</button>
    </div>
  </section>;
}
