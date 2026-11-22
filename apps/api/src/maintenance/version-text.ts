import { ARDEN_DOCUMENT_PREFIX, parseSemanticDocument, type SemanticBlock, type SemanticInline } from "@arden/domain";

const inlineText = (items: SemanticInline[]) =>
  items.map((item) => item.type === "text" ? item.text : item.content.map((part) => part.text).join("")).join("");

function blockLines(block: SemanticBlock): string[] {
  const own = block.type === "table" ? block.content.map((row) => row.cells.map(inlineText).join(" | "))
    : block.type === "asset" ? [`[Asset: ${block.props.label ?? block.props.assetVersionId}]`]
      : block.type === "code" ? block.content.map((part) => part.text).join("").split("\n")
        : [inlineText(block.content)];
  return [...own, ...block.children.flatMap(blockLines)];
}

/** Comparable text for one version. Every Semantic Document block contributes a line; invalid content is unavailable. */
export function visibleVersionText(body: string, mimeType: string): string | null {
  if (mimeType === "application/pdf" || body.length > 200_000) return null;
  if (!body.startsWith(ARDEN_DOCUMENT_PREFIX)) return body;
  const parsed = parseSemanticDocument(body);
  return parsed.ok ? parsed.document.blocks.flatMap(blockLines).join("\n") : null;
}
