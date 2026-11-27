import { createContext, useContext } from "react";
import type { GraphIntent, GraphIntentBus } from "../graph/intent-bus";

/** Input for opening the shell-hosted Flow 4 Report an issue dialog from any workspace surface. */
export type ReportIssueTarget = {
  documentId: string;
  publishedVersionId: string;
  title?: string;
  versionLabel?: string;
};

export type DispatchGraphIntentOptions = {
  /** Opens the docked Ask Arden side panel alongside `/graph` (for example from AskArdenPage). */
  openAgentPanel?: boolean;
  /** Replaces the current browser history entry instead of pushing when syncing Web query state. */
  replace?: boolean;
};

export type ShellBridge = {
  /** Platform-agnostic in-memory bus for Knowledge Graph intents across Web and Electron. */
  graphIntentBus: GraphIntentBus;
  /** Dispatches a graph intent, syncs query state (and Web URL), and navigates to `/graph`. */
  dispatchGraphIntent: (intent: GraphIntent, options?: DispatchGraphIntentOptions) => void;
  /** Current normalized `/graph` query string (leading `?`, or `""` when empty). */
  graphSearch: string;
  /** Updates `/graph` query state in memory (Electron) and browser history (Web). */
  setGraphSearch: (search: string, options?: { replace?: boolean }) => void;
  /** Opens the shell-level human-confirmed Flow 4 Report an issue dialog pinned to a published version. */
  openReportIssue: (target: ReportIssueTarget) => void;
};

export const ShellBridgeContext = createContext<ShellBridge | null>(null);

export function useShellBridge(): ShellBridge | null {
  return useContext(ShellBridgeContext);
}
