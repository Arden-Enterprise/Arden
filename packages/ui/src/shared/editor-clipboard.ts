import type {} from "./desktop-session";
import type { Platform } from "./types";

export type EditorClipboardAction = "cut" | "copy" | "paste";

export async function runEditorClipboard(
  action: EditorClipboardAction,
  platform: Platform,
  signal: AbortSignal,
  restoreTarget: () => boolean,
  pasteText: (text: string) => void,
): Promise<void> {
  if (action === "paste" && platform === "web") {
    const text = await navigator.clipboard.readText();
    if (text && !signal.aborted && restoreTarget()) pasteText(text);
    return;
  }
  if (signal.aborted || !restoreTarget()) return;
  if (action === "paste") {
    const bridge = window.ardenDesktop;
    if (!bridge?.pasteIntoEditor) throw new Error("Desktop paste unavailable");
    await bridge.pasteIntoEditor();
    return;
  }
  // Native cut/copy preserve the editor's clipboard format and undo history.
  if (!document.execCommand(action)) throw new Error("Clipboard command unavailable");
}
