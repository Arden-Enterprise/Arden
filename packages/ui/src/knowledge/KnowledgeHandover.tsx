import { useState } from "react";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow, KnowledgeSteps } from "./KnowledgePrimitives";
import { createSampleHandover, handoverReady, type HandoverOutcome, type SampleHandoverDocument } from "./knowledgePreviewModel";

const outcomes: { value: HandoverOutcome; title: string; description: string }[] = [
  { value: "retain", title: "Retain", description: "Keep responsibility with the organization." },
  { value: "transfer", title: "Transfer ownership", description: "Choose a receiving owner." },
  { value: "revise", title: "Revise before transfer", description: "Record revision work for a receiving owner." },
  { value: "archive", title: "Archive / retire", description: "Record an explicit retirement decision." },
];

function outcomeName(value: HandoverOutcome): string {
  return outcomes.find((outcome) => outcome.value === value)?.title || value;
}

export function KnowledgeHandover({ onReturn }: { onReturn: () => void }) {
  const [documents, setDocuments] = useState(createSampleHandover);
  const [selectedId, setSelectedId] = useState("sample-migration");
  const [stage, setStage] = useState<"outcomes" | "ownership" | "complete">("outcomes");
  const [receipt, setReceipt] = useState<SampleHandoverDocument[]>([]);
  const [dialog, setDialog] = useState<"confirm" | "receipt" | null>(null);
  const selected = documents.find((document) => document.id === selectedId) || documents[0];
  const updateDocument = (id: string, changes: Partial<Pick<SampleHandoverDocument, "owner" | "outcome">>) => setDocuments((previous) => previous.map((document) => document.id === id ? { ...document, ...changes } : document));
  const awaitingOwner = documents.filter((document) => (document.outcome === "transfer" || document.outcome === "revise") && !document.owner.trim()).length;
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE HANDOVER" title={stage === "complete" ? "Knowledge handover complete" : "Knowledge handover"} description={stage === "complete" ? "The sample handover plan is recorded for this preview session." : "Keep essential knowledge connected when people and departments change."} action={<button type="button" className="primary-button" disabled={receipt.length === 0} onClick={() => setDialog("receipt")}>View sample receipt</button>} />
    {stage === "complete" ? <>
      <KnowledgeNotice title="Sample handover plan completed" tone="jade">Mai Pham · Operations · No real ownership, access or audit records were changed.</KnowledgeNotice>
      <div className="knowledge-handover-metrics"><div><strong>{receipt.length.toString().padStart(2, "0")}</strong><span>Shared documents planned</span></div><div><strong>{receipt.filter((document) => document.outcome === "transfer").length.toString().padStart(2, "0")}</strong><span>Transfer decisions</span></div><div><strong>{receipt.filter((document) => document.outcome === "retain").length.toString().padStart(2, "0")}</strong><span>Retained</span></div><div><strong><Icon name="lock" size={30} /></strong><span>Private originals stay with their owner</span></div></div>
      <div className="knowledge-panel"><h2>Ownership changes</h2><p>Sample receiving owners and explicit outcomes. Revision work remains pending until completed.</p><div className="knowledge-table-scroll"><table className="knowledge-table"><thead><tr><th>Document</th><th>Outcome / ownership</th><th>Scope</th></tr></thead><tbody>{receipt.map((document) => <tr key={document.id}><td>{document.title}</td><td>{outcomeName(document.outcome)}{document.outcome === "transfer" || document.outcome === "revise" ? ` → ${document.owner}` : ""}</td><td>{document.scope}</td></tr>)}</tbody></table></div><p className="knowledge-preview-footnote"><Icon name="lock" size={16} /> Sample receipt · Session only · Audience unchanged</p></div>
      <div className="knowledge-inline-meta"><button type="button" className="secondary-button" onClick={() => setDialog("receipt")}>View sample receipt</button><button type="button" className="primary-button" onClick={onReturn}>Return to My Work</button><button type="button" className="knowledge-back-button" onClick={() => { setDocuments(createSampleHandover()); setStage("outcomes"); }}>Start another preview</button></div>
    </> : <>
      <KnowledgeSteps steps={["Trigger", "Documents", "Outcomes", "Ownership", "Confirm"]} active={stage === "outcomes" ? 2 : 3} />
      <div className="knowledge-inline-meta"><KnowledgeBadge>3 shared sample documents</KnowledgeBadge><KnowledgeBadge tone="amber">{awaitingOwner} receiving owner needed</KnowledgeBadge><KnowledgeBadge tone="jade">Private originals excluded</KnowledgeBadge></div>
      <div className="knowledge-two-column">
        <div className="knowledge-panel knowledge-handover-documents"><span className="meta-label knowledge-tone-blue">MAI PHAM · SAMPLE DEPARTURE</span><h2>{stage === "outcomes" ? "Choose each document’s future" : "Confirm receiving owners"}</h2>
          {documents.map((document) => stage === "outcomes" ? <KnowledgeRow key={document.id} title={document.title} details={`${document.scope} · ${document.owner || "Receiving owner needed"}`} status={document.id === selectedId ? "Selected" : outcomeName(document.outcome)} tone={document.id === selectedId ? "blue" : document.outcome === "revise" ? "amber" : "jade"} onClick={() => setSelectedId(document.id)} /> : <label className="knowledge-owner-field" key={document.id}><strong>{document.title}</strong><small>{outcomeName(document.outcome)} · {document.scope}</small>{document.outcome === "transfer" || document.outcome === "revise" ? <select value={document.owner} onChange={(event) => updateDocument(document.id, { owner: event.target.value })}><option value="">Choose a receiving owner</option><option>Tuan Le</option><option>Hoa Bui</option><option>Minh Tran</option></select> : <span>{document.outcome === "retain" ? "Organization owner" : "Explicit archive decision"}</span>}</label>)}
          <KnowledgeRow title="Private content excluded" details="No private titles or content are available in this review." status="Owner consent required" tone="muted" icon="lock" />
          <p className="knowledge-preview-footnote">This preview cannot transfer or archive another person’s private originals.</p>
        </div>
        <aside className="knowledge-panel knowledge-handover-outcome">
          {stage === "outcomes" ? <><span className="meta-label knowledge-tone-amber">SELECTED DOCUMENT OUTCOME</span><h2>{selected.title}</h2><p>Choose exactly one outcome.</p><fieldset className="knowledge-scope-options"><legend className="sr-only">Outcome for {selected.title}</legend>{outcomes.map((outcome) => <label key={outcome.value} className={selected.outcome === outcome.value ? "is-selected" : ""}><span><input type="radio" name="handover-outcome" checked={selected.outcome === outcome.value} onChange={() => updateDocument(selected.id, { outcome: outcome.value, owner: outcome.value === "retain" ? "Organization owner" : selected.owner === "Organization owner" ? "" : selected.owner })} />{outcome.title}</span><small>{outcome.description}</small></label>)}</fieldset><KnowledgeNotice title="Permission impact" tone="amber">Existing document audiences remain unchanged in this sample plan. Private originals stay private.</KnowledgeNotice><button type="button" className="primary-button" onClick={() => setStage("ownership")}>Continue to ownership</button></> : <><span className="meta-label knowledge-tone-amber">CONFIRM THE PLAN</span><h2>Every document needs an outcome</h2><p>Choose a receiving owner for transfers and revisions before confirming.</p><KnowledgeNotice title="Plan preview" tone="jade">3 shared sample documents. {awaitingOwner} receiving owner still needed. No private records are included.</KnowledgeNotice><button type="button" className="primary-button" disabled={!handoverReady(documents)} onClick={() => setDialog("confirm")}>Review sample handover</button><button type="button" className="knowledge-back-button" onClick={() => setStage("outcomes")}>← Back to outcomes</button></>}
        </aside>
      </div>
    </>}
    {dialog === "confirm" && <KnowledgeDialog title="Confirm this sample handover plan?" onClose={() => setDialog(null)}><ul className="knowledge-receipt-list">{documents.map((document) => <li key={document.id}><strong>{document.title}</strong><span>{outcomeName(document.outcome)}{document.outcome === "transfer" || document.outcome === "revise" ? ` → ${document.owner}` : ""}</span></li>)}</ul><p>Existing audiences stay unchanged. Private originals are excluded. This saves a plan in memory only.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="primary-button" onClick={() => { if (!handoverReady(documents)) return; setReceipt(documents.map((document) => ({ ...document }))); setStage("complete"); setDialog(null); }}>Confirm sample handover</button></div></KnowledgeDialog>}
    {dialog === "receipt" && <KnowledgeDialog title="Sample handover receipt" onClose={() => setDialog(null)}><p>These are the decisions confirmed during this preview. This is not an audit trail.</p><ul className="knowledge-receipt-list">{receipt.map((document) => <li key={document.id}><strong>{document.title}</strong><span>{outcomeName(document.outcome)} · {document.owner || "Explicit retirement"} · {document.scope}</span></li>)}</ul><KnowledgeNotice title="No external changes" tone="blue">No real ownership transfer, permission update, notification or archive action occurred.</KnowledgeNotice></KnowledgeDialog>}
  </>;
}
