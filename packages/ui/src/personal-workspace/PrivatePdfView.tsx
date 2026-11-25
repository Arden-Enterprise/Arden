import { useEffect, useState, type ReactNode } from "react";
import { PdfDocument } from "../knowledge/PdfDocument";

type PdfLoad = { state: "loading" } | { state: "ready"; base64: string } | { state: "error"; message: string };

/**
 * Decision 0034 (spec F03-FILE): an original PDF kept in Private, opened in the PDF viewer. The file is read
 * only when the item opens, and again after it is replaced (`revision`).
 */
export function PrivatePdfView({ itemId, title, revision, heading, toolbar, loadPdf, allowDownload = true, notice }: {
  itemId: string;
  title: string;
  revision: number;
  /** The title area; the owner's view lets it be renamed in place. */
  heading: ReactNode;
  toolbar: ReactNode;
  loadPdf: (itemId: string) => Promise<string>;
  /** Recipients of a direct share get no Download action (decision 0034); this is a display rule, not protection. */
  allowDownload?: boolean;
  notice?: ReactNode;
}) {
  const [load, setLoad] = useState<PdfLoad>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoad({ state: "loading" });
    loadPdf(itemId).then(
      (base64) => { if (active) setLoad({ state: "ready", base64 }); },
      (cause: unknown) => {
        if (active) setLoad({ state: "error", message: cause instanceof Error && cause.message ? cause.message : "The PDF couldn’t be opened." });
      });
    return () => { active = false; };
  }, [itemId, revision, attempt, loadPdf]);

  return <section className="pn-page pn-pdf-page" aria-label={title}>
    <div className="pn-page-toolbar">{toolbar}</div>
    <div className="pn-page-body pn-pdf-body">
      <div className="pn-page-heading">{heading}</div>
      {notice}
      {load.state === "loading" && <p className="island-meta" role="status">Opening the PDF…</p>}
      {load.state === "error" && <p className="admin-feedback is-error" role="alert">{load.message}{" "}
        <button type="button" className="pn-link-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></p>}
      {load.state === "ready" && <PdfDocument base64={load.base64} title={title} showToolbar={allowDownload} />}
    </div>
  </section>;
}
