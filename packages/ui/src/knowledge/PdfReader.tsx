import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { clearMarks, markQuote } from "./citationHighlight";
import { findQuoteInSegments } from "./citationTextMatch";
import type { PDFDocumentProxy } from "./pdfRuntime";

type PdfRuntime = typeof import("./pdfRuntime");

/** A passage to show: the quote is highlighted on its page, which defaults to `page` when the quote is not found. */
export type PdfReaderFocus = { page?: number; excerpt: string; samePage?: boolean };

type PageSize = { width: number; height: number };
type Target = { page: number; excerpt: string; request: PdfReaderFocus };

const markClass = "pdf-citation-mark";
const zoomSteps = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const pagePadding = 16;

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function pageContainsQuote(document: PDFDocumentProxy, pageNumber: number, quote: string): Promise<boolean> {
  const content = await (await document.getPage(pageNumber)).getTextContent();
  return findQuoteInSegments(content.items.map((item) => "str" in item ? item.str : ""), quote) !== null;
}

/** The cited page when it holds the quote, otherwise the first page that does, otherwise the cited page. */
async function locateQuote(document: PDFDocumentProxy, focus: PdfReaderFocus): Promise<number | null> {
  const cited = focus.page && focus.page <= document.numPages ? focus.page : null;
  // Review citations come with the page from this exact submitted PDF. A repeated phrase elsewhere isn't the source.
  if (focus.samePage) return cited;
  if (cited && await pageContainsQuote(document, cited, focus.excerpt)) return cited;
  for (let page = 1; page <= Math.min(document.numPages, 300); page++) {
    if (page !== cited && await pageContainsQuote(document, page, focus.excerpt)) return page;
  }
  return cited;
}

/**
 * Renders a PDF with pdf.js so a cited passage can be highlighted in place. The browser's built-in viewer
 * cannot mark text, and reloading it for each citation briefly blanked the reader.
 */
export function PdfReader({ base64, title, focus }: { base64: string; title: string; focus?: PdfReaderFocus | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<PdfRuntime | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [target, setTarget] = useState<Target | null>(null);
  const [match, setMatch] = useState<{ request: PdfReaderFocus; found: boolean } | null>(null);
  const visibleTarget = target?.request === focus ? target : null;

  useEffect(() => {
    let present = true;
    let task: ReturnType<PdfRuntime["getDocument"]> | null = null;
    const destroy = () => { void task?.destroy().catch(() => undefined); };
    setDocument(null); setSizes([]); setFailed(false); setTarget(null);
    void (async () => {
      const pdf = await import("./pdfRuntime");
      if (!present) return;
      // pdf.js transfers the buffer to its worker, so each load gets its own copy.
      task = pdf.getDocument({ data: decode(base64), isEvalSupported: false });
      const loaded = await task.promise;
      if (!present) return;
      const pages: PageSize[] = [];
      for (let number = 1; number <= loaded.numPages; number++) {
        if (!present) return;
        const viewport = (await loaded.getPage(number)).getViewport({ scale: 1 });
        pages.push({ width: viewport.width, height: viewport.height });
      }
      if (!present) return;
      setRuntime(pdf); setSizes(pages); setDocument(loaded);
    })().catch(() => { if (present) setFailed(true); destroy(); });
    return () => { present = false; destroy(); };
  }, [base64]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [document]);

  useEffect(() => {
    if (!document || !focus?.excerpt) { setTarget(null); return; }
    let present = true;
    void locateQuote(document, focus).then((page) => {
      if (!present) return;
      setTarget(page ? { page, excerpt: focus.excerpt, request: focus } : null);
      if (!page && focus.samePage) setMatch({ request: focus, found: false });
    }).catch(() => { if (present) setTarget(null); });
    return () => { present = false; };
  }, [document, focus]);

  useEffect(() => {
    if (!visibleTarget || width === 0) return;
    const container = scroller.current;
    const page = container?.querySelector<HTMLElement>(`[data-page-number="${visibleTarget.page}"]`);
    if (container && page) {
      container.scrollTop += page.getBoundingClientRect().top - container.getBoundingClientRect().top - pagePadding;
    }
  }, [visibleTarget, width]);

  const widest = Math.max(1, ...sizes.map((size) => size.width));
  const fitScale = width > 0 ? Math.max(0.25, (width - pagePadding * 2) / widest) : 1;
  const scale = Math.round(fitScale * zoom * 100) / 100;
  const zoomIndex = zoomSteps.indexOf(zoom);

  const revealMark = (mark: HTMLElement | null, citation: Target) => {
    if (citation.request.samePage) setMatch({ request: citation.request, found: Boolean(mark) });
    if (!mark) return;
    const container = scroller.current;
    if (!container) return;
    const offset = mark.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo?.({ top: container.scrollTop + offset - container.clientHeight / 3, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  if (failed) return <p className="pdf-reader-unavailable" role="status">PDF preview is unavailable here. Use Download to open the original file.</p>;

  return <div className="pdf-reader">
    <div className="pdf-reader-toolbar">
      <span className="island-meta">{document ? `${sizes.length} ${sizes.length === 1 ? "page" : "pages"}` : "Loading PDF…"}
        {focus?.samePage && match?.request === focus && <span role="status" className={match.found ? "sr-only" : ""}>
          {match.found ? `Passage highlighted on page ${visibleTarget?.page}.`
            : visibleTarget ? ` · Opened page ${visibleTarget.page}. Passage not found.` : " · Cited page unavailable."}
        </span>}
      </span>
      <div className="pdf-reader-zoom" role="group" aria-label="Zoom">
        <button type="button" className="island-icon-button" aria-label="Zoom out" disabled={!document || zoomIndex <= 0}
          onClick={() => setZoom(zoomSteps[Math.max(0, zoomIndex - 1)]!)}><Icon name="minus" size={13} /></button>
        <button type="button" className="pdf-reader-zoom-value" aria-label="Fit to width" title="Fit to width" disabled={!document || zoom === 1}
          onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="island-icon-button" aria-label="Zoom in" disabled={!document || zoomIndex >= zoomSteps.length - 1}
          onClick={() => setZoom(zoomSteps[Math.min(zoomSteps.length - 1, zoomIndex + 1)]!)}><Icon name="plus" size={13} /></button>
      </div>
    </div>
    <div ref={scroller} className="pdf-reader-pages" tabIndex={0} role="document" aria-label={`PDF: ${title}`} aria-busy={!document}>
      {document && runtime && width > 0 && sizes.map((size, index) => <PdfPage key={index + 1} runtime={runtime} document={document}
        pageNumber={index + 1} size={size} scale={scale} root={scroller.current}
        highlight={visibleTarget?.page === index + 1 ? visibleTarget : null} onHighlight={revealMark} />)}
    </div>
  </div>;
}

function PdfPage({ runtime, document, pageNumber, size, scale, root, highlight, onHighlight }: {
  runtime: PdfRuntime;
  document: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  scale: number;
  root: HTMLElement | null;
  highlight: Target | null;
  onHighlight: (mark: HTMLElement | null, citation: Target) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [rendered, setRendered] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const page = element.current;
    if (!page || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setNear(true); }, { root, rootMargin: "800px 0px" });
    observer.observe(page);
    return () => observer.disconnect();
  }, [root]);

  const shouldRender = near || highlight !== null;
  useEffect(() => {
    if (!shouldRender || !canvas.current || !text.current) return;
    setFailed(false);
    let present = true;
    let renderTask: { cancel(): void; promise: Promise<void> } | null = null;
    let textLayer: { cancel(): void } | null = null;
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (!present || !canvas.current || !text.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      const context = target.getContext("2d");
      if (!context) throw new Error("PDF canvas unavailable");
      renderTask = page.render({ canvas: target, canvasContext: context, viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      text.current.replaceChildren();
      const layer = new runtime.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport });
      textLayer = layer;
      await Promise.all([renderTask.promise, layer.render()]);
      if (present) setRendered((count) => count + 1);
    })().catch(() => { if (present) setFailed(true); });
    return () => { present = false; renderTask?.cancel(); textLayer?.cancel(); };
  }, [document, pageNumber, runtime, scale, shouldRender]);

  useEffect(() => {
    const layer = text.current;
    if (!layer || rendered === 0) return;
    clearMarks(layer, markClass);
    if (!highlight) return;
    const { marks } = markQuote(layer, highlight.excerpt, markClass);
    onHighlight(marks[0] ?? null, highlight);
    // Re-run only for a finished render or a new citation request, not for a new callback identity.
  }, [rendered, highlight]);

  return <div ref={element} className="pdf-reader-page" data-page-number={pageNumber}
    style={{ width: size.width * scale, height: size.height * scale, ["--total-scale-factor" as string]: scale }}>
    <canvas ref={canvas} aria-hidden="true" style={{ width: size.width * scale, height: size.height * scale }} />
    <div ref={text} className="textLayer" />
    {failed && <p className="pdf-reader-unavailable" role="status">Page {pageNumber} could not be displayed. Use Download to open the original file.</p>}
  </div>;
}
