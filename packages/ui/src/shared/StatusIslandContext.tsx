import { createContext, useContext, type Dispatch, type SetStateAction } from "react";

/** A transient confirmation the workspace status island morphs to show. */
export type StatusIslandToast = { message: string; onDismiss: () => void };

export type StatusIslandState = {
  toast: StatusIslandToast | null;
  setToast: Dispatch<SetStateAction<StatusIslandToast | null>>;
};

export const StatusIslandContext = createContext<StatusIslandState | null>(null);

export function useStatusIsland(): StatusIslandState | null {
  return useContext(StatusIslandContext);
}
