import { useId, useState, type CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import { Expand } from "./Expand";
import type { VersionPair } from "./version-pair";

export type VersionRow = { kind: "added" | "removed" | "context" | "collapsed"; text: string; hidden?: string[] };
type Comparison = { unavailable: true } | { unavailable: false; rows: VersionRow[] } | null;
type Original = { unavailable: true; label: string } | { unavailable: false; label: string; text: string } | null;

const changeLabel = { added: "+ Added", removed: "− Removed" } as const;

function UnchangedLines({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <>
    <button type="button" className="maintenance-text-button" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen((value) => !value)}>
      {open ? "Hide unchanged lines" : "Show unchanged lines"}
    </button>
    <Expand id={panelId} open={open}>
      {lines.map((line, index) => <span key={`${index}-${line}`} className="maintenance-diff-text">{line}</span>)}
    </Expand>
  </>;
}

function VersionTag({ label, pair }: { label: string; pair: VersionPair }) {
  const tag = label === pair.reportedLabel ? "Reported" : label === pair.currentLabel ? "Current" : null;
  return tag && <small className={`maintenance-version-tag${tag === "Reported" ? " is-reported" : ""}`}>{tag}</small>;
}

function VersionPager({ pair, onVersionPair }: { pair: VersionPair; onVersionPair?: (action: "previous" | "next" | "current") => void }) {
  return <div className="maintenance-pager" role="group" aria-label="Version pair">
    <button type="button" className="maintenance-pager-step is-previous" aria-label="Previous versions" title="Previous versions"
      disabled={!pair.canPrevious} onClick={() => onVersionPair?.("previous")}><Icon name="chevron" size={12} /></button>
    <p className="maintenance-pager-label">
      {pair.earlierLabel}<VersionTag label={pair.earlierLabel} pair={pair} /> to {pair.laterLabel}<VersionTag label={pair.laterLabel} pair={pair} />
    </p>
    <button type="button" className="maintenance-pager-step" aria-label="Next versions" title="Next versions"
      disabled={!pair.canNext} onClick={() => onVersionPair?.("next")}><Icon name="chevron" size={12} /></button>
    <button type="button" className="maintenance-text-button maintenance-pager-current" disabled={!pair.canCompareCurrent}
      onClick={() => onVersionPair?.("current")}>Compare with current</button>
  </div>;
}

function DiffRow({ row, index, onOpenOriginal }: { row: VersionRow; index: number; onOpenOriginal?: (which: "earlier" | "later") => void }) {
  const order = { "--row": Math.min(index, 8) } as CSSProperties;
  if (row.kind === "added" || row.kind === "removed") {
    const later = row.kind === "added";
    return <li className={`maintenance-diff-row is-${row.kind}`} style={order}>
      <span className="maintenance-diff-label">{changeLabel[row.kind]}</span>
      <span className="maintenance-diff-text">{row.text}</span>
      {onOpenOriginal && <button type="button" className="maintenance-text-button maintenance-diff-source"
        aria-label={`Open ${later ? "later" : "earlier"} version: ${row.text}`} onClick={() => onOpenOriginal(later ? "later" : "earlier")}>
        {later ? "Later version" : "Earlier version"}
      </button>}
    </li>;
  }
  return <li className={`maintenance-diff-row is-${row.kind}`} style={order}>
    <span className="maintenance-diff-text">{row.text}</span>
    {row.kind === "collapsed" && row.hidden && row.hidden.length > 0 && <UnchangedLines lines={row.hidden} />}
  </li>;
}

export function VersionChanges({ comparison, original = null, onOpenOriginal, pair = null, onVersionPair, onOpenReported }: {
  comparison: Comparison;
  original?: Original;
  onOpenOriginal?: (which: "earlier" | "later") => void;
  pair?: VersionPair | null;
  onVersionPair?: (action: "previous" | "next" | "current") => void;
  /** Opens the exact reported version when there is no pair to compare. */
  onOpenReported?: () => void;
}) {
  const single = !comparison && !pair && Boolean(onOpenReported);
  if (!comparison && !original && !pair && !single) return null;
  const rows = comparison && !comparison.unavailable ? comparison.rows : null;
  return <section className="maintenance-card maintenance-version-changes" aria-labelledby="version-changes-title">
    <header className="maintenance-card-header">
      <h3 id="version-changes-title">Version changes</h3>
      {comparison && onOpenOriginal && <div className="maintenance-card-actions" role="group" aria-label="Original versions">
        <button type="button" className="maintenance-text-button" onClick={() => onOpenOriginal("earlier")}>Open earlier original</button>
        <button type="button" className="maintenance-text-button" onClick={() => onOpenOriginal("later")}>Open later original</button>
      </div>}
      {single && <div className="maintenance-card-actions">
        <button type="button" className="maintenance-text-button" onClick={onOpenReported}>Open reported version</button>
      </div>}
    </header>
    {single && !original && <p className="maintenance-card-note">This document has one published version, so there is nothing to compare yet.</p>}
    {pair && <VersionPager pair={pair} onVersionPair={onVersionPair} />}
    {original && <article className="maintenance-original" aria-label={`${original.label} original`}>
      <h4>{original.label}</h4>
      <p>{original.unavailable ? "This original is unavailable." : original.text}</p>
    </article>}
    {!comparison && pair && <p className="maintenance-card-note" role="status">Comparing {pair.earlierLabel} to {pair.laterLabel}…</p>}
    {comparison?.unavailable && <p className="maintenance-card-note is-warning">Comparison is unavailable. Open the original versions and review them manually.</p>}
    {rows && <>
      {rows.every((row) => row.kind !== "added" && row.kind !== "removed") && <p className="maintenance-card-note">These versions have the same lines.</p>}
      <ul className="maintenance-diff">
        {rows.map((row, index) => <DiffRow key={`${row.kind}-${index}`} row={row} index={index} onOpenOriginal={onOpenOriginal} />)}
      </ul>
    </>}
  </section>;
}
