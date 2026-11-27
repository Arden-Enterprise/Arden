import type { ReactNode } from "react";
import type {
  BoundUiSurface,
  HydratedDocumentSummary,
  SurfaceAction,
  TurnHydration,
} from "@arden/domain";
import type { AnswerCitation } from "../askArdenModel";

export type SurfaceActionHandler = (action: SurfaceAction, opener: HTMLElement,
  documents: readonly HydratedDocumentSummary[]) => void;

export interface UiSurfaceRendererProps {
  surface: BoundUiSurface;
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>;
  turnHydration?: TurnHydration | null;
  citations: readonly AnswerCitation[];
  fallbackAnswer?: string;
  onAction?: SurfaceActionHandler;
  onOpenCitation?: (citation: AnswerCitation, opener: HTMLElement) => void;
  onPrefillPrompt?: (prompt: string) => void;
}

export interface SurfaceRenderContext {
  surface: BoundUiSurface;
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>;
  turnHydration?: TurnHydration | null;
  citations: readonly AnswerCitation[];
  onAction?: (action: SurfaceAction, opener: HTMLElement) => void;
  onOpenCitation?: (citation: AnswerCitation, opener: HTMLElement) => void;
  onPrefillPrompt?: (prompt: string) => void;
  renderNode: (nodeId: string, visited: ReadonlySet<string>) => ReactNode;
}
