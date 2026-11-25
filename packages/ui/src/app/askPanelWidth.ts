/**
 * Width of the docked Ask Arden panel (spec F13-RESIZE). The user drags or uses the keyboard on the panel's
 * left edge; the width is remembered per browser and always leaves the page its readable width.
 */

export const ASK_PANEL_MIN = 320;
export const ASK_PANEL_MAX = 720;
/** The page keeps at least this much width beside the docked panel (the same rule that decides docking). */
export const ASK_PANEL_PAGE_MIN = 520;
export const ASK_PANEL_STEP = 16;
const STORAGE_KEY = "arden.askPanelWidth";

/** The default width set by the stylesheet: 340px below 1200px of window width, 360px above. */
export function defaultAskPanelWidth(windowWidth: number): number {
  return windowWidth < 1200 ? 340 : 360;
}

/** The widest the panel may be beside a page of `pageWidth` (window minus sidebar). */
export function askPanelMaxFor(pageWidth: number): number {
  return Math.min(ASK_PANEL_MAX, Math.max(ASK_PANEL_MIN, Math.floor(pageWidth - ASK_PANEL_PAGE_MIN)));
}

export function clampAskPanelWidth(width: number, max: number): number {
  return Math.round(Math.min(Math.max(width, ASK_PANEL_MIN), Math.max(ASK_PANEL_MIN, max)));
}

/** The saved width, or null when none is saved or storage is unavailable. */
export function readAskPanelWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= ASK_PANEL_MIN && value <= ASK_PANEL_MAX ? value : null;
  } catch { return null; }
}

/** Saves the width, or forgets it (back to the default) when `width` is null. Storage failures are ignored. */
export function writeAskPanelWidth(width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch { /* the width is a convenience only */ }
}
