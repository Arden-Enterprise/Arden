// Loaded on demand so pdf.js stays out of the main bundle and out of tests that never open a PDF.
import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export { getDocument, TextLayer };
export type { PDFDocumentProxy } from "pdfjs-dist";
