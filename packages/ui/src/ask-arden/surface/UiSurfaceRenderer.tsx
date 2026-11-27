import { useMemo, type ReactNode } from "react";
import { validateStoredBoundSurface, type BoundUiSurface } from "@arden/domain";
import { CitedAnswer } from "../CitedAnswer";
import { SurfaceActionButton } from "./ActionBar";
import {
  CardBlock,
  RowBlock,
  SectionBlock,
  SplitBlock,
  StackBlock,
  TabsBlock,
} from "./containers";
import { safeGetOwn } from "./formatters";
import {
  CalloutBlock,
  ComparisonTableBlock,
  DocumentItemBlock,
  GovernanceKvBlock,
  LineageTreeBlock,
  MetricStripBlock,
  ProseBlock,
} from "./leaves";
import type { SurfaceRenderContext, UiSurfaceRendererProps } from "./types";

export type { UiSurfaceRendererProps } from "./types";

function renderValidatedNode(
  nodeId: string,
  visited: ReadonlySet<string>,
  ctx: SurfaceRenderContext,
): ReactNode {
  if (visited.has(nodeId)) return null;
  const node = safeGetOwn(ctx.surface.nodes, nodeId);
  if (!node) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  switch (node.kind) {
    case "stack":
      return <StackBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "row":
      return <RowBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "card":
      return <CardBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "section":
      return <SectionBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "tabs":
      return <TabsBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "split":
      return <SplitBlock node={node} visited={nextVisited} ctx={ctx} />;
    case "prose":
      return <ProseBlock node={node} ctx={ctx} />;
    case "document_item":
      return <DocumentItemBlock node={node} ctx={ctx} />;
    case "governance_kv":
      return <GovernanceKvBlock node={node} ctx={ctx} />;
    case "comparison_table":
      return <ComparisonTableBlock node={node} ctx={ctx} />;
    case "callout":
      return <CalloutBlock node={node} ctx={ctx} />;
    case "metric_strip":
      return <MetricStripBlock nodeId={nodeId} node={node} ctx={ctx} />;
    case "lineage_tree":
      return <LineageTreeBlock nodeId={nodeId} node={node} ctx={ctx} />;
    case "graph_action":
    case "open_reader":
    case "workflow_handoff":
    case "prompt_chip":
      return (
        <SurfaceActionButton
          action={node}
          hydratedDocuments={ctx.hydratedDocuments}
          onAction={ctx.onAction}
          onPrefillPrompt={ctx.onPrefillPrompt}
        />
      );
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

/**
 * Pure recursive renderer for Core-validated `BoundUiSurface` trees.
 * Degrades defensively to `<CitedAnswer />` on any validation failure or missing root.
 */
export function UiSurfaceRenderer({
  surface,
  hydratedDocuments,
  turnHydration,
  citations,
  fallbackAnswer,
  onAction,
  onOpenCitation,
  onPrefillPrompt,
}: UiSurfaceRendererProps) {
  const validatedSurface: BoundUiSurface | null = useMemo(() => {
    const result = validateStoredBoundSurface(surface, { citationCount: citations.length });
    if (!result.ok) return null;
    if (!safeGetOwn(result.surface.nodes, result.surface.rootId)) return null;
    return result.surface;
  }, [surface, citations.length]);

  if (!validatedSurface) {
    return (
      <CitedAnswer
        body={fallbackAnswer ?? ""}
        citations={citations}
        onOpen={onOpenCitation}
      />
    );
  }

  const ctx: SurfaceRenderContext = {
    surface: validatedSurface,
    hydratedDocuments,
    turnHydration,
    citations,
    onAction: onAction ? (action, opener) => {
      const documents = validatedSurface.bindings.documents.flatMap((binding) => {
        const doc = safeGetOwn(hydratedDocuments, binding.publishedVersionId);
        return doc?.documentId === binding.documentId && doc.publishedVersionId === binding.publishedVersionId ? [doc] : [];
      });
      onAction(action, opener, documents);
    } : undefined,
    onOpenCitation,
    onPrefillPrompt,
    renderNode: (nodeId, visited) => renderValidatedNode(nodeId, visited, ctx),
  };

  return (
    <div className="arden-ui-surface" data-surface-version={validatedSurface.schemaVersion}>
      {ctx.renderNode(validatedSurface.rootId, new Set())}
    </div>
  );
}
