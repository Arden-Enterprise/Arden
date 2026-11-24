import { Fragment, useMemo, type ReactNode } from "react";
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
 * Formats Markdown and links explicit inline source numbers to the corresponding validated passage.
 */
export function CitedAnswer({ body, citations, onOpen }: {
  body: string;
  citations: readonly AnswerCitation[];
  onOpen?: (citation: AnswerCitation, opener: HTMLElement) => void;
}) {
  const blocks = useMemo(() => layoutCitedAnswer(body, citations), [body, citations]);
  const line = (segments: AnswerLine) => segments.map((segment, index) => <Fragment key={index}>
    <Inline parts={segment.parts} />
    {onOpen && segment.sourceNumbers.map(number => {
      const citation = citations[number - 1]!;
      return <button key={number} className="ask-citation-chip" type="button" title={citation.title}
        aria-label={`Source ${number}: ${citation.title}`}
        onClick={(event) => onOpen(citation, event.currentTarget)}>{number}</button>;
    })}
    {segment.trailing}
  </Fragment>);

  return <>{blocks.map((block, b) => {
    if (block.kind === "heading") return <p key={b} className="ask-answer-heading">{line(block.line)}</p>;
    if (block.kind === "list") {
      const items = block.items.map((item, i) => <li key={i}>{line(item)}</li>);
      return block.ordered
        ? <ol key={b} className="ask-answer-list" start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul key={b} className="ask-answer-list">{items}</ul>;
    }
    return <p key={b}>{block.lines.map((segments, i) => <Fragment key={i}>{i > 0 && "\n"}{line(segments)}</Fragment>)}</p>;
  })}</>;
}
