import { useEffect, useState, type FormEvent } from "react";
import { loadDirectSharing, saveDirectSharing, type DirectShareSettings } from "../shared/direct-share-api";
import type { Platform } from "../shared/types";

/**
 * Decision 0034 (spec F03-SHR): the Organization Admin decides whether members may share private items with
 * named colleagues without review, and with how many people per item. Turning it off also hides existing shares.
 */
export function DirectSharingSettings({ platform, organizationId }: { platform: Platform; organizationId: string }) {
  const [saved, setSaved] = useState<DirectShareSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let present = true;
    void loadDirectSharing(platform, organizationId).then((settings) => {
      if (!present) return;
      setSaved(settings); setEnabled(settings.enabled); setLimit(String(settings.recipientLimit));
    }).catch((cause: unknown) => { if (present) setError(cause instanceof Error ? cause.message : "Sharing settings couldn’t be loaded."); });
    return () => { present = false; };
  }, [platform, organizationId]);

  const parsedLimit = Number(limit);
  const validLimit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100;
  const changed = saved !== null && (saved.enabled !== enabled || String(saved.recipientLimit) !== limit);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validLimit || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await saveDirectSharing(platform, organizationId, { enabled, recipientLimit: parsedLimit });
      setSaved(result); setEnabled(result.enabled); setLimit(String(result.recipientLimit));
      setStatus("Sharing settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing settings couldn’t be saved.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="island admin-sharing" aria-labelledby="admin-sharing-title">
    <h3 id="admin-sharing-title">Sharing with people</h3>
    <p className="island-meta">Members can let named colleagues read a private note or PDF without review. Shared items are labelled
      as not reviewed and never become official documents. Sharing with a department or the whole organization always needs review.</p>
    {!saved && !error && <p className="island-meta" role="status">Loading…</p>}
    {saved && <form className="admin-sharing-form" onSubmit={(event) => void submit(event)}>
      <label className="admin-sharing-toggle"><input type="checkbox" checked={enabled} disabled={busy}
        onChange={(event) => setEnabled(event.target.checked)} />Allow sharing with people</label>
      <label>People per item
        <input type="number" min={1} max={100} step={1} inputMode="numeric" value={limit} disabled={busy || !enabled}
          aria-invalid={!validLimit || undefined} aria-describedby="admin-sharing-limit-help"
          onChange={(event) => setLimit(event.target.value)} /></label>
      <small id="admin-sharing-limit-help">{validLimit ? "Between 1 and 100. Shares already made stay until they are revoked."
        : "Enter a whole number from 1 to 100."}</small>
      {!enabled && saved.enabled && <p className="share-choice-reason" role="note">
        Turning this off hides every item already shared with people until it is turned on again.</p>}
      <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy || !changed || !validLimit}>
        {busy ? "Saving…" : "Save"}</button></div>
    </form>}
    {status && <p className="island-meta" role="status">{status}</p>}
    {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
  </section>;
}
