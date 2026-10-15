import { useEffect, useState } from "react";

export function PdfDocument({ base64, title }: { base64: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [base64]);
  if (!url) return <p role="status">Preparing PDF preview…</p>;
  return <div className="knowledge-pdf-document">
    <div className="knowledge-live-actions">
      <a className="secondary-button" href={url} download={`${title.replace(/[\\/:*?"<>|]/g, "-")}.pdf`}>Download PDF</a>
    </div>
    <object data={url} type="application/pdf" aria-label={`PDF preview: ${title}`}>
      <p>PDF preview is unavailable here. Use Download PDF to open the original file.</p>
    </object>
  </div>;
}
