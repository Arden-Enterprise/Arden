import { useMemo, useState } from "react";
import { CitationChip } from "./CitationChip";
import { layoutCitedAnswer, type AnswerCitation } from "./askArdenModel";

/** An answer with its sources shown inline, after the sentence each passage supports. */
export function CitedAnswer({ body, citations, onOpen }: {
  body: string;
  citations: readonly AnswerCitation[];
  onOpen?: (citation: AnswerCitation) => void;
}) {
  const paragraphs = useMemo(() => layoutCitedAnswer(body, citations), [body, citations]);
  const [active, setActive] = useState<string | null>(null);
  return <>{paragraphs.map((paragraph, p) => <p key={p}>{paragraph.map((segment, s) => {
    const key = `${p}:${s}`;
    if (!segment.sources.length) return <span key={key}>{segment.text}{segment.trailing}</span>;
    return <span key={key} className="ask-cited">
      <span className={`ask-cited-text${active === key ? " is-active" : ""}`}>{segment.text}</span>
      {segment.text && " "}<CitationChip sources={segment.sources} onOpen={onOpen}
        onActiveChange={(open) => setActive((current) => open ? key : current === key ? null : current)} />
      {segment.trailing}
    </span>;
  })}</p>)}</>;
}
