import { createContext, useContext, type Dispatch, type SetStateAction } from "react";

/** A transient confirmation the workspace status island morphs to show. */
export type StatusIslandToast = { message: string; onDismiss: () => void; action?: { label: string; run: () => void } };

/** A destructive action awaiting confirmation; the island morphs into a compact alert dialog. */
export type StatusIslandConfirm = {
  title: string;
  description: string;
  actionLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export type StatusIslandState = {
  toast: StatusIslandToast | null;
  setToast: Dispatch<SetStateAction<StatusIslandToast | null>>;
  confirm: StatusIslandConfirm | null;
  setConfirm: Dispatch<SetStateAction<StatusIslandConfirm | null>>;
};

export const StatusIslandContext = createContext<StatusIslandState | null>(null);

export function useStatusIsland(): StatusIslandState | null {
  return useContext(StatusIslandContext);
}
