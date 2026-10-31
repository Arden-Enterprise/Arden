import { useEffect, useState } from "react";

export function pdfFileName(title: string): string {
  return `${title.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
}

/** Object URL for a base64 PDF; revoked when the PDF changes or the caller unmounts. */
export function usePdfObjectUrl(base64: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!base64) return;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [base64]);
  return url;
}

/** The embedded browser PDF viewer only, for layouts that show the title and download elsewhere. */
export function PdfViewer({ url, title, page }: { url: string; title: string; page?: number }) {
  return <object key={`${url}:${page ?? 1}`} data={page ? `${url}#page=${page}` : url} type="application/pdf" aria-label={`PDF preview: ${title}${page ? `, page ${page}` : ""}`}>
    <p>PDF preview is unavailable here. Use Download PDF to open the original file.</p>
  </object>;
}

export function PdfDocument({ base64, title, page, showToolbar = true }: { base64: string; title: string; page?: number; showToolbar?: boolean }) {
  const url = usePdfObjectUrl(base64);
  const fileName = pdfFileName(title);
  if (!url) return <p role="status">Preparing PDF preview…</p>;
  return <div className="knowledge-pdf-document">
    {showToolbar && <div className="knowledge-live-actions">
      <strong className="knowledge-pdf-title">{fileName}</strong>
      <a className="secondary-button" href={url} download={fileName}>Download PDF</a>
    </div>}
    <PdfViewer url={url} title={title} page={page} />
  </div>;
}
