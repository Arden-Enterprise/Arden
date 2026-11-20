// Loaded on demand so pdf.js stays out of the main bundle and out of tests that never open a PDF.
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Earlier releases cached this asset as octet-stream for a year. Use a fresh
// stable URL so existing browser caches also receive the corrected module MIME.
const moduleWorkerUrl = new URL(workerUrl, import.meta.url);
moduleWorkerUrl.searchParams.set("module-worker", "1");
GlobalWorkerOptions.workerSrc = moduleWorkerUrl.href;

export { getDocument, TextLayer };
export type { PDFDocumentProxy } from "pdfjs-dist";
