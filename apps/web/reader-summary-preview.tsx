/** Dev-only synthetic verification entry; Vite production input remains index.html. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeDocumentDetail } from "../../packages/ui/src/knowledge/KnowledgeDocumentDetail";
import { PdfDocument } from "../../packages/ui/src/knowledge/PdfDocument";
import type { KnowledgeCitationReference } from "../../packages/ui/src/knowledge/knowledgeCitation";
import { readerContext, readerSummaryFixture } from "../../packages/ui/tests/readerSummary.test-support";
import "@arden/ui/styles.css";

let scenario = "ready", sourceFormat = "text";
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname;
  const prefix = `/api/v1/organizations/${readerContext.organizationId}/knowledge/published/${readerContext.versionId}`;
  if (!(path.startsWith(`${prefix}/summary`) || path === `${prefix}/questions`)) return realFetch(input, init);
  await new Promise(resolve => setTimeout(resolve, 750));
  if (scenario === "denied") return Response.json({ error: { code: "RESOURCE_NOT_AVAILABLE" } }, { status: 404 });
  if (path.endsWith("/access")) return Response.json({ documentId: readerContext.documentId, versionId: readerContext.versionId, contentHash: readerContext.contentHash });
  if (scenario === "unsupported") return Response.json({ error: { code: "SUMMARY_UNSUPPORTED" } }, { status: 422 });
  if (scenario === "failure") return Response.json({ error: { code: "SUMMARY_UNAVAILABLE" } }, { status: 503 });
  const request: { requestId: string } = JSON.parse(String(init?.body));
  const result = readerSummaryFixture(request.requestId);
  result.points.push({ kind: "CONDITION", text: "Check that you are reading the version currently open. Publication and effective dates are different.", citations: result.points[0].citations },
    { kind: "EXCEPTION", text: "If access is revoked, the summary and its sources become unavailable.", citations: result.points[0].citations });
  if (sourceFormat === "text") result.points.forEach(point => point.citations.forEach(citation => { delete citation.page; }));
  if (path.endsWith("/questions")) return Response.json({ requestId: request.requestId,
    documentId: readerContext.documentId, versionId: readerContext.versionId,
    status: scenario === "insufficient" ? "INSUFFICIENT_EVIDENCE" : "ANSWERED",
    answer: scenario === "insufficient" ? "This document does not provide enough information to answer that question."
      : "Only approved readers can use this guidance.",
    citations: scenario === "insufficient" ? [] : result.points[0].citations });
  return Response.json(result);
};

function pdfFixture(): string {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>"];
  for (let page = 1; page <= 3; page++) {
    const content = `BT /F1 18 Tf 50 740 Td (Synthetic source - page ${page}) Tj 0 -40 Td (Only approved readers) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R >> >> /Contents ${page * 2 + 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let data = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(data.length); data += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = data.length;
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  data += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return btoa(`${data}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
const pdf = pdfFixture();
function Preview() {
  const [mode, setMode] = useState("ready"), [transport, setTransport] = useState<"web" | "desktop">("web");
  const [format, setFormat] = useState("text"), [open, setOpen] = useState(true), [focus, setFocus] = useState<KnowledgeCitationReference | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  return <div className="arden-app-shell reader-qa"><div className="reader-qa-inner">
    <div className="reader-qa-controls"><strong>Local verification · synthetic data · no model calls</strong>
      <label>Scenario <select value={mode} onChange={event => { scenario = event.target.value; setMode(scenario); }}>
        <option value="ready">Ready</option><option value="insufficient">Insufficient evidence</option><option value="unsupported">Unsupported</option><option value="failure">Failure</option><option value="denied">Access denied</option></select></label>
      <label>Transport <select value={transport} onChange={event => {
        const value = event.target.value === "desktop" ? "desktop" : "web";
        window.ardenDesktop = value === "desktop" ? { requestApi: async request => {
          const result = await window.fetch(request.path, { method: request.method, body: request.body });
          return { status: result.status, body: await result.text() };
        }, clearSession: async () => {}, startGoogleSignIn: async () => {} } : undefined;
        setTransport(value);
      }}><option value="web">Web</option><option value="desktop">Desktop bridge simulation</option></select></label>
      <label>Source <select value={format} onChange={event => { setFocus(null); sourceFormat = event.target.value; setFormat(sourceFormat); }}><option value="text">Text</option><option value="pdf">PDF</option></select></label>
      {!open && <button className="secondary-button" onClick={() => { setOpen(true); setUnavailable(false); }}>Open test document</button>}
    </div>
    {unavailable && <p role="alert">This document is unavailable.</p>}
    {open && <KnowledgeDocumentDetail key={format} metadata={{ title: "Working together", documentCode: "ARD-001", ownerDepartment: "HR", summary: "",
      activeVersionId: readerContext.versionId, versions: [{ id: readerContext.versionId, label: "1.0", status: "EFFECTIVE", effectiveDate: "2026-11-01" }] }}
      summaryOptions={{ platform: transport, active: true, context: readerContext, onCitation: setFocus,
        onAccessLost: () => { setOpen(false); setUnavailable(true); } }} focusTarget={focus} onBack={() => setOpen(false)}
      content={format === "pdf" ? <PdfDocument base64={pdf} title="Synthetic source" page={focus?.page} />
        : <div className="knowledge-reader-sample-page"><h2>Working together</h2><p>Published guidance · Version 1.0</p>
          <p data-source-block-id="source-rule">Only approved readers can use this guidance.</p>
          <h3>Use the right version</h3><p>Check the effective date before applying a rule. A published version may be readable before it takes effect.</p>
          <h3>Keep access current</h3><p>Use the original document when you need the full conditions and exceptions.</p></div>} />}
  </div></div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
