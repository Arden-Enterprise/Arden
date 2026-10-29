# Semantic Document v1

Semantic Document is Arden's canonical editable shared-document contract. Its implementation lives in `packages/domain/src/semantic-document.ts`; clients and servers import that contract instead of defining separate JSON shapes.

## Envelope and identity

Stored text starts with `arden-document:application/vnd.arden.semantic-blocks+json;version=1`, followed by canonical JSON with `schemaVersion: 1` and a non-empty `blocks` array. Every block has a required, unique stable ID. IDs survive content/property edits and change only when a block is replaced as a different logical object.

Supported domain blocks are paragraph, heading levels 1–3, bullet/numbered list item, quote, code, table and immutable asset-version reference. Inline content is text with an allowlisted style set or a validated `http`, `https` or `mailto` link. Unknown properties, unsafe links, duplicate IDs, excessive nesting/count/text and invalid asset references fail validation.

## Canonical and derived formats

- Semantic Document JSON is the canonical authoring source.
- Plain text is ingestion input only and is normalized before shared-draft persistence.
- Markdown and source maps are deterministic derived artifacts produced from an immutable approved submission snapshot by the Python `Arden-AI` service. The TypeScript core does not maintain a second compiler implementation.
- Rendered HTML, BlockNote state, Markdown and embeddings are never competing canonical sources.

The cross-repository Semantic Document contract must be exported as versioned JSON Schema and
covered by parity fixtures. Python code may reject invalid documents more strictly, but it may not
silently reinterpret a document accepted by the canonical TypeScript contract.

The current BlockNote adapter authors paragraph, heading levels 2–3, list item and quote blocks. It preserves links and stable IDs. It fails closed when asked to edit a valid domain block that the UI does not yet support.

## Limits

V1 permits at most 2,000 blocks, nesting depth 8 and 131,072 text code points. Links are limited to 2,048 characters, asset labels/references to 512 characters, and tables to 32 columns. HTTP request byte limits remain an additional boundary.
