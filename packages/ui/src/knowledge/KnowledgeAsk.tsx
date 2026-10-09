import { useState } from "react";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow } from "./KnowledgePrimitives";
import { sampleQuestion } from "./knowledgePreviewModel";

const citations = [
  { title: "API Gateway Runbook", details: "Published · Department · v2.4", excerpt: "Confirm the impact, validate upstream dependencies and record the incident timeline before restarting." },
  { title: "On-call escalation guide", details: "Published · Company-wide · v3.1", excerpt: "Notify the service owner when impact persists beyond ten minutes. Follow the recorded escalation contacts." },
  { title: "Retry policy decision", details: "Published · Department · v1.3", excerpt: "Check retry saturation and upstream health before restarting a gateway. Avoid compounding the upstream failure." },
];

export function KnowledgeAsk() {
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCitation, setSelectedCitation] = useState<number | null>(null);
  const [boundaryOpen, setBoundaryOpen] = useState(false);
  const [answerVisible, setAnswerVisible] = useState(true);
  const ask = () => {
    if (question.trim().toLowerCase() === sampleQuestion.toLowerCase()) { setAnswerVisible(true); setMessage("Showing the prerecorded sample answer below. No AI request was sent."); }
    else { setMessage(question.trim() ? "Live AI is not connected. Load the sample question to inspect the prerecorded answer and citations." : "Enter the sample question or load it using the button below."); }
  };
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / ASK ARDEN" title="Ask Arden" description="Answers with evidence, within your access." action={<button type="button" className="secondary-button" onClick={() => setBoundaryOpen(true)}>Permission demo</button>} />
    <div className="knowledge-inline-meta"><KnowledgeBadge tone="blue">Product Engineering</KnowledgeBadge><KnowledgeBadge tone="jade">Company-wide published</KnowledgeBadge><span>Lan Nguyen · Sample employee</span></div>
    <div className="knowledge-ask-grid">
      <div className="knowledge-answer-column"><div className="knowledge-question"><span className="meta-label">PRERECORDED SAMPLE QUESTION</span><h2>{sampleQuestion}</h2></div>
        {answerVisible && <article className="knowledge-panel knowledge-answer"><span className="knowledge-answer-source"><Icon name="knowledge" />Grounded in 3 sample sources</span><h2>Follow the recovery procedure</h2>
          <div className="knowledge-answer-step"><span>01</span><div><h3>Confirm the impact</h3><p>Check error rate by route and region. Record the first observed timestamp.</p><button type="button" onClick={() => setSelectedCitation(0)}>[1]</button></div></div>
          <div className="knowledge-answer-step"><span>02</span><div><h3>Validate dependencies</h3><p>Verify authentication, rate limiting and upstream health before restarting.</p><button type="button" onClick={() => setSelectedCitation(0)}>[1]</button> <button type="button" onClick={() => setSelectedCitation(2)}>[3]</button></div></div>
          <div className="knowledge-answer-step"><span>03</span><div><h3>Escalate safely</h3><p>Notify the service owner when impact persists beyond ten minutes.</p><button type="button" onClick={() => setSelectedCitation(1)}>[2]</button></div></div>
        </article>}
        <form className="knowledge-question-composer" onSubmit={(event) => { event.preventDefault(); ask(); }}><Icon name="search" size={18} /><label><span className="sr-only">Ask a sample question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} placeholder="Ask a follow-up question…" /></label><button type="submit" className="primary-button">Ask Arden</button></form>
        <button type="button" className="knowledge-back-button" onClick={() => { setQuestion(sampleQuestion); setMessage("Sample question loaded. Submit it to display the prerecorded answer."); }}>Load sample question →</button>
        {message && <p className="knowledge-action-message" role="status">{message}</p>}
      </div>
      <aside className="knowledge-citations"><h2>The evidence behind it</h2>{citations.map((citation, index) => <button key={citation.title} type="button" className="knowledge-citation" onClick={() => setSelectedCitation(index)}><span>[{index + 1}]</span><strong>{citation.title}</strong><small>{citation.details}</small></button>)}<KnowledgeNotice title="Authorization before retrieval">The production assistant must retrieve only authorized evidence. This screen contains synthetic examples, with no live retrieval.</KnowledgeNotice></aside>
    </div>
    <p className="knowledge-preview-footnote">Sample answer and citations only. Live inference, source verification and permission enforcement require Arden Core.</p>
    {selectedCitation !== null && <KnowledgeDialog title={citations[selectedCitation].title} onClose={() => setSelectedCitation(null)}><p className="knowledge-tone-blue">{citations[selectedCitation].details}</p><p>{citations[selectedCitation].excerpt}</p><KnowledgeNotice title="Synthetic exact-version citation">This preview opens a sample excerpt. It does not fetch a real document or establish access to it.</KnowledgeNotice></KnowledgeDialog>}
    {boundaryOpen && <KnowledgeDialog title="Permission boundary demo" onClose={() => setBoundaryOpen(false)}><p>The same sample question has different evidence for each department.</p><div className="knowledge-boundary-grid"><div className="knowledge-panel"><span className="meta-label knowledge-tone-jade">EMPLOYEE · PRODUCT ENGINEERING</span><h3>Lan Nguyen</h3><KnowledgeBadge tone="jade">3 sample authorized sources</KnowledgeBadge><p>Use the gateway runbook, validate upstream health, then follow the department escalation policy.</p>{citations.map((citation, index) => <KnowledgeRow key={citation.title} title={citation.title} details={index === 1 ? "Company-wide" : "Department"} status={`Source ${index + 1}`} />)}</div><div className="knowledge-panel"><span className="meta-label knowledge-tone-blue">EMPLOYEE · OPERATIONS</span><h3>Hoa Bui</h3><KnowledgeBadge tone="blue">1 sample authorized source</KnowledgeBadge><p>Use the company-wide escalation guide. Department runbooks are outside this sample context.</p><KnowledgeRow title="On-call escalation guide" details="Company-wide" status="Source 1" tone="blue" /><p>✓ Restricted document titles are not listed.<br />✓ Restricted document counts are not exposed.</p></div></div><KnowledgeNotice title="Sample access boundary" tone="jade">Admins configure permissions without automatically reading private content. Real authorization must happen on the server before retrieval.</KnowledgeNotice></KnowledgeDialog>}
  </>;
}
