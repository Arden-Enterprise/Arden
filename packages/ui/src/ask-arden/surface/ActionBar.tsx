import type { MouseEvent } from "react";
import type { HydratedDocumentSummary, SurfaceAction } from "@arden/domain";
import { Icon, type IconName } from "../../shared/Icon";
import { isWorkflowHandoffAllowed } from "./formatters";

function actionIcon(action: SurfaceAction): IconName {
  switch (action.kind) {
    case "graph_action":
      return "layers";
    case "open_reader":
      return "open-external";
    case "workflow_handoff":
      return action.handoff === "open_renewal" ? "refresh" : "flag";
    case "prompt_chip":
      return "chat";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function isSurfaceActionVisible(
  action: SurfaceAction,
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>,
): boolean {
  if (action.kind === "workflow_handoff") {
    return isWorkflowHandoffAllowed(action, hydratedDocuments);
  }
  return true;
}

export function SurfaceActionButton({
  action,
  hydratedDocuments,
  onAction,
  onPrefillPrompt,
}: {
  action: SurfaceAction;
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>;
  onAction?: (action: SurfaceAction, opener: HTMLElement) => void;
  onPrefillPrompt?: (prompt: string) => void;
}) {
  if (!isSurfaceActionVisible(action, hydratedDocuments)) {
    return null;
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const opener = event.currentTarget;
    if (action.kind === "prompt_chip") {
      if (onPrefillPrompt) {
        onPrefillPrompt(action.prompt);
      } else {
        onAction?.(action, opener);
      }
      return;
    }
    onAction?.(action, opener);
  };

  return (
    <button
      type="button"
      className="arden-surface-action"
      data-action-kind={action.kind}
      onClick={handleClick}
    >
      <Icon name={actionIcon(action)} size={13} />
      <span>{action.label}</span>
    </button>
  );
}

export function ActionBar({
  actions,
  hydratedDocuments,
  onAction,
  onPrefillPrompt,
}: {
  actions: readonly { id: string; action: SurfaceAction }[];
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>;
  onAction?: (action: SurfaceAction, opener: HTMLElement) => void;
  onPrefillPrompt?: (prompt: string) => void;
}) {
  const visible = actions.filter(({ action }) => isSurfaceActionVisible(action, hydratedDocuments));
  if (visible.length === 0) return null;

  return (
    <div className="arden-surface-action-bar" role="group" aria-label="Suggested actions">
      {visible.map(({ id, action }) => (
        <SurfaceActionButton
          key={id}
          action={action}
          hydratedDocuments={hydratedDocuments}
          onAction={onAction}
          onPrefillPrompt={onPrefillPrompt}
        />
      ))}
    </div>
  );
}
