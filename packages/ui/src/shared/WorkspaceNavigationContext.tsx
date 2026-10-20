import { createContext, useContext, type Dispatch, type SetStateAction } from "react";

export type WorkspaceNavigationState = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

export const WorkspaceNavigationContext = createContext<WorkspaceNavigationState | null>(null);

export function useWorkspaceNavigation(): WorkspaceNavigationState | null {
  return useContext(WorkspaceNavigationContext);
}
