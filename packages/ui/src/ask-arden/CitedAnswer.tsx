import { Fragment, useMemo, useState, type ReactNode } from "react";
import { CitationChip } from "./CitationChip";
import { layoutCitedAnswer, type AnswerCitation, type AnswerLine, type InlinePart } from "./askArdenModel";

function Inline({ parts }: { parts: InlinePart[] }) {
  return <>{parts.map((part, index) => {
    if (part.code) return <code key={index}>{part.text}</code>;
    let node: ReactNode = part.text;
    if (part.emphasis) node = <em>{node}</em>;
    if (part.strong) node = <strong>{node}</strong>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}

/**
 * An answer with its sources shown inline, after the sentence each passage supports. Headings, lists and
 * emphasis written in Markdown are rendered as such; without citations it is simply the formatted answer.
 */
export function CitedAnswer({ body, citations, onOpen }: {
  body: string;
  citations: readonly AnswerCitation[];
  onOpen?: (citation: AnswerCitation) => void;
}) {
  const blocks = useMemo(() => layoutCitedAnswer(body, citations), [body, citations]);
  const [active, setActive] = useState<string | null>(null);

  const line = (segments: AnswerLine, prefix: string) => segments.map((segment, s) => {
    const key = `${prefix}:${s}`;
    if (!segment.sources.length) return <span key={key}><Inline parts={segment.parts} />{segment.trailing}</span>;
    return <span key={key} className="ask-cited">
      <span className={`ask-cited-text${active === key ? " is-active" : ""}`}><Inline parts={segment.parts} /></span>
      {segment.text && " "}<CitationChip sources={segment.sources} onOpen={onOpen}
        onActiveChange={(open) => setActive((current) => open ? key : current === key ? null : current)} />
      {segment.trailing}
    </span>;
  });

  return <>{blocks.map((block, b) => {
    if (block.kind === "heading") return <p key={b} className="ask-answer-heading">{line(block.line, `${b}`)}</p>;
    if (block.kind === "list") {
      const items = block.items.map((item, i) => <li key={i}>{line(item, `${b}:${i}`)}</li>);
      return block.ordered
        ? <ol key={b} className="ask-answer-list" start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul key={b} className="ask-answer-list">{items}</ul>;
    }
    return <p key={b}>{block.lines.map((segments, i) => <Fragment key={i}>{i > 0 && "\n"}{line(segments, `${b}:${i}`)}</Fragment>)}</p>;
  })}</>;
}
