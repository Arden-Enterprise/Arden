import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import type { AnswerCitation, CitedSource } from "./askArdenModel";

const openDelay = 120, closeDelay = 160, cardWidth = 340;

function citationMeta(citation: AnswerCitation): string {
  return [citation.version, citation.page ? `Page ${citation.page}` : null, citation.scope].filter(Boolean).join(" · ");
}

/**
 * Compact inline source chip. Hover or keyboard focus shows the cited passages; activating the chip,
 * or a passage in the card, opens the governed reader at that passage.
 */
export function CitationChip({ sources, onOpen, onActiveChange }: {
  sources: CitedSource[];
  onOpen?: (citation: AnswerCitation) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; width: number; upward: boolean } | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const returningFocus = useRef(false);
  const focusPassage = useRef(false);
  const cardId = useId();
  const first = sources[0]!;
  const others = sources.length - 1;
  const passages = sources.flatMap((source) => source.citations);

  const schedule = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? openDelay : closeDelay);
  };
  const closeToChip = () => { window.clearTimeout(timer.current); setOpen(false); returningFocus.current = true; chip.current?.focus(); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const activeChange = useRef(onActiveChange);
  activeChange.current = onActiveChange;
  useEffect(() => { activeChange.current?.(open); }, [open]);

  useLayoutEffect(() => {
    if (!open || !wrapper.current) { setPosition(null); return; }
    const place = () => {
      const anchor = wrapper.current!.getBoundingClientRect();
      // Keep the card inside the scrolling conversation so it is never clipped by its edges.
      const bounds = wrapper.current!.closest(".ask-thread-scroll")?.getBoundingClientRect()
        ?? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
      const width = Math.min(cardWidth, bounds.right - bounds.left - 24);
      const left = Math.min(Math.max(bounds.left + 12, anchor.left), bounds.right - width - 12) - anchor.left;
      const below = bounds.bottom - anchor.bottom, above = anchor.top - bounds.top;
      setPosition({ left, width, upward: below < 260 && above > below });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open || !position || !focusPassage.current) return;
    focusPassage.current = false;
    wrapper.current?.querySelector<HTMLButtonElement>(".ask-citation-passage")?.focus();
  }, [open, position]);

  const label = `Source: ${sources.map((source) => source.title).join(", ")}`;

  return <span ref={wrapper} className="ask-citation">
    <button ref={chip} type="button" className="ask-citation-chip" aria-label={label} aria-describedby={open ? cardId : undefined}
      disabled={!onOpen} onClick={() => { window.clearTimeout(timer.current); setOpen(false); onOpen?.(passages[0]!); }}
      onMouseEnter={() => schedule(true)} onMouseLeave={() => schedule(false)}
      onFocus={() => { window.clearTimeout(timer.current); if (!returningFocus.current) setOpen(true); returningFocus.current = false; }} onBlur={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget as Node | null)) schedule(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.stopPropagation(); window.clearTimeout(timer.current); setOpen(false); }
        if (event.key === "ArrowDown") { event.preventDefault(); window.clearTimeout(timer.current); focusPassage.current = true; setOpen(true); }
      }}>
      <span className="ask-citation-chip-label">{first.label}</span>
      {others > 0 && <span className="ask-citation-chip-more">+{others}</span>}
    </button>
    {open && <span id={cardId} data-citation-card={cardId} role="group" aria-label="Cited passages"
      className={`ask-citation-card${position?.upward ? " is-upward" : ""}`}
      style={position ? { left: position.left, width: position.width } : { visibility: "hidden" }}
      onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={() => schedule(false)}
      onBlur={(event) => { if (!wrapper.current?.contains(event.relatedTarget as Node | null)) schedule(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeToChip(); } }}>
      {passages.map((citation, index) => <button type="button" className="ask-citation-passage" disabled={!onOpen}
        key={`${citation.versionId}:${citation.blockId ?? ""}:${index}`} onClick={() => { setOpen(false); onOpen?.(citation); }}>
        <span className="ask-citation-passage-title">
          <Icon name="document" size={12} />
          <strong>{citation.documentCode ? `${citation.documentCode} · ` : ""}{citation.title}</strong>
          <Icon name="open-external" size={11} />
        </span>
        <small>{citationMeta(citation)}</small>
        <q>{citation.excerpt}</q>
      </button>)}
    </span>}
  </span>;
}
