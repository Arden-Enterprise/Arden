import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ASK_PANEL_MIN, ASK_PANEL_STEP, clampAskPanelWidth } from "./askPanelWidth";

export type AskPanelResize = {
  /** The panel's current width in pixels. */
  width: number;
  max: number;
  /** Live width while dragging or on each key press. */
  onChange: (width: number) => void;
  /** The width to remember, at the end of a drag or after a key press. */
  onCommit: (width: number) => void;
  /** Double-click: back to the default width. */
  onReset: () => void;
};

/**
 * The docked Ask Arden panel's left edge (spec F13-RESIZE). Drag to resize; with the keyboard, Left widens and
 * Right narrows by 16px, Home and End go to the narrowest and widest. A window splitter in ARIA terms.
 */
export function AskPanelResizeHandle({ width, max, onChange, onCommit, onReset }: AskPanelResize) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // The panel is on the right: moving the edge left makes it wider.
    current.width = clampAskPanelWidth(current.startWidth + current.startX - event.clientX, max);
    onChange(current.width);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (current.width !== current.startWidth) onCommit(current.width);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowLeft" ? width + ASK_PANEL_STEP : event.key === "ArrowRight" ? width - ASK_PANEL_STEP
      : event.key === "Home" ? ASK_PANEL_MIN : event.key === "End" ? max : null;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampAskPanelWidth(next, max);
    onChange(clamped);
    onCommit(clamped);
  };

  return <div className={`agent-panel-resize${dragging ? " is-dragging" : ""}`} role="separator" tabIndex={0}
    aria-orientation="vertical" aria-label="Resize Ask Arden" aria-controls="arden-agent-panel"
    aria-valuemin={ASK_PANEL_MIN} aria-valuemax={Math.max(ASK_PANEL_MIN, max)} aria-valuenow={width}
    title="Drag to resize. Double-click to reset."
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish}
    onDoubleClick={onReset} onKeyDown={onKeyDown} />;
}
