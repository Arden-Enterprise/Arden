import { parseSemanticDocument, plainTextToSemanticDocument, semanticDocumentHasText, serializeSemanticDocument } from "@arden/domain";
import { isRichNoteBody, utf8Bytes } from "./noteDocument";
/**
 * Import a PDF into a private note (spec F03-PDF). The text is read in this browser with the bundled
 * pdf.js and becomes ordinary note text; the PDF file itself is never uploaded or stored.
 */

/** Matches the API's private-note body limit (UTF-8 bytes). */
export const NOTE_BODY_MAX_BYTES = 100_000;
/** Keeps a huge file from freezing the tab; it is only read locally. */
export const PDF_IMPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const TITLE_MAX = 200;

export class PdfImportError extends Error {
  constructor(message: string) { super(message); this.name = "PdfImportError"; }
}

export type ImportedNote = {
  title: string;
  body: string;
  /** Pages whose text fits in the note. */
  importedPages: number;
  totalPages: number;
  truncated: boolean;
};

/** One pdf.js text item: a run of text, optionally followed by a line break. */
export type PdfTextItem = { str: string; hasEOL?: boolean };

/** Rebuilds the lines of one page; runs on the same line are joined and spacing is tidied. */
export function pageText(items: PdfTextItem[]): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text.split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}


/** "Quarterly report.pdf" -> "Quarterly report"; the PDF's own title wins when it has one. */
export function importTitle(fileName: string, metadataTitle?: string | null): string {
  const fromFile = fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
  const title = (metadataTitle?.trim() || fromFile || "Imported PDF").replace(/\u0000/g, "");
  return Array.from(title).slice(0, TITLE_MAX).join("");
}

/**
 * Joins page texts (blank line between pages) and stops at the last whole page that fits the note
 * limit; when even the first page is too long it is cut at a line boundary. Never silent: `truncated`
 * and `importedPages` say what was kept.
 */
export function buildImportedNote(fileName: string, metadataTitle: string | null | undefined, pages: string[],
  maxBytes = NOTE_BODY_MAX_BYTES): ImportedNote {
  const title = importTitle(fileName, metadataTitle);
  const cleaned = pages.map((page) => page.replace(/\u0000/g, ""));
  if (!cleaned.some((page) => page.trim())) {
    throw new PdfImportError("This PDF has no selectable text, for example because it is a scan. Arden can’t read scanned pages yet.");
  }
  let body = "";
  let importedPages = 0;
  for (const page of cleaned) {
    const next = body && page ? `${body}\n\n${page}` : body || page;
    if (utf8Bytes(next) > maxBytes) break;
    body = next;
    importedPages += 1;
  }
  if (importedPages === 0) {
    const lines: string[] = [];
    for (const line of (cleaned[0] ?? "").split("\n")) {
      if (utf8Bytes([...lines, line].join("\n")) > maxBytes) break;
      lines.push(line);
    }
    body = lines.join("\n");
  }
  return { title, body, importedPages, totalPages: pages.length, truncated: importedPages < pages.length };
}

/** The text of one PDF, before it is fitted into a note. */
export type PdfText = { fileName: string; metadataTitle: string | null; pages: string[] };

/**
 * Adds a PDF's text to a note's current draft (spec F03-PDF revision 2). An empty note receives the text;
 * a note with text keeps it and gets the PDF after a blank line. A note still called "Untitled private note"
 * (or with no title) takes the PDF's title. The note limit counts the text already there.
 */
export function mergePdfIntoNote(current: { title: string; body: string }, pdf: PdfText, untitled: string,
  maxBytes = NOTE_BODY_MAX_BYTES): { title: string; body: string; imported: ImportedNote } {
  if (isRichNoteBody(current.body)) return mergePdfIntoRichNote(current, pdf, untitled, maxBytes);
  const existing = current.body.replace(/\s+$/, "");
  const separator = existing ? "\n\n" : "";
  const room = maxBytes - utf8Bytes(existing + separator);
  if (room <= 0) throw new PdfImportError("This note is full. Import the PDF into an empty note instead.");
  const imported = buildImportedNote(pdf.fileName, pdf.metadataTitle, pdf.pages, room);
  if (!imported.body) throw new PdfImportError("There isn’t enough room left in this note. Import the PDF into an empty note instead.");
  const keepTitle = current.title.trim() && current.title.trim() !== untitled;
  return { title: keepTitle ? current.title : imported.title, body: existing + separator + imported.body, imported };
}

/**
 * A rich note keeps its document and gains one plain paragraph per PDF line (a blank paragraph
 * between). The encoded document must fit the note limit, so the text budget shrinks until it does.
 */
function mergePdfIntoRichNote(current: { title: string; body: string }, pdf: PdfText, untitled: string,
  maxBytes: number): { title: string; body: string; imported: ImportedNote } {
  const parsed = parseSemanticDocument(current.body);
  if (!parsed.ok) throw new PdfImportError("This note can’t be opened, so the PDF wasn’t added.");
  const existing = [...parsed.document.blocks];
  while (existing.length && !semanticDocumentHasText({ ...parsed.document, blocks: existing.slice(-1) })
    && existing.at(-1)!.type === "paragraph" && !existing.at(-1)!.children.length) existing.pop();
  const encode = (text: string) => serializeSemanticDocument({ ...parsed.document, blocks: [...existing,
    ...plainTextToSemanticDocument(existing.length ? `\n${text}` : text, () => crypto.randomUUID()).blocks] });
  let room = maxBytes - utf8Bytes(current.body);
  for (let attempt = 0; attempt < 12 && room > 0; attempt += 1) {
    const imported = buildImportedNote(pdf.fileName, pdf.metadataTitle, pdf.pages, room);
    if (!imported.body) break;
    const body = encode(imported.body);
    const size = utf8Bytes(body);
    if (size <= maxBytes) {
      const keepTitle = current.title.trim() && current.title.trim() !== untitled;
      return { title: keepTitle ? current.title : imported.title, body, imported };
    }
    room -= Math.max(size - maxBytes, Math.ceil(room / 8));
  }
  throw new PdfImportError(room <= 0 ? "This note is full. Import the PDF into an empty note instead."
    : "There isn’t enough room left in this note. Import the PDF into an empty note instead.");
}

type PdfRuntime = typeof import("../knowledge/pdfRuntime");

/** Reads every page's text with pdf.js and fits it into a new note's limit. */
export async function readPdfFile(file: File, load: () => Promise<PdfRuntime> = () => import("../knowledge/pdfRuntime")): Promise<ImportedNote> {
  const pdf = await readPdfText(file, load);
  return buildImportedNote(pdf.fileName, pdf.metadataTitle, pdf.pages);
}

/** Reads every page's text with pdf.js; maps password and corrupt-file failures to clear messages. */
export async function readPdfText(file: File, load: () => Promise<PdfRuntime> = () => import("../knowledge/pdfRuntime")): Promise<PdfText> {
  const isPdfName = /\.pdf$/i.test(file.name);
  if (file.type !== "application/pdf" && !isPdfName) throw new PdfImportError("Choose a PDF file.");
  if (file.size === 0) throw new PdfImportError("This PDF is empty.");
  if (file.size > PDF_IMPORT_MAX_FILE_BYTES) throw new PdfImportError("This PDF is larger than 25 MB. Choose a smaller file.");
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") throw new PdfImportError("This file isn’t a valid PDF.");

  const runtime = await load();
  const task = runtime.getDocument({ data, isEvalSupported: false });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(pageText(content.items.flatMap((item) => "str" in item ? [{ str: item.str, hasEOL: item.hasEOL }] : [])));
    }
    let metadataTitle: string | null = null;
    try {
      const info = (await document.getMetadata()).info as { Title?: unknown } | undefined;
      metadataTitle = typeof info?.Title === "string" ? info.Title : null;
    } catch { metadataTitle = null; }
    if (!pages.some((page) => page.replace(/\u0000/g, "").trim())) {
      throw new PdfImportError("This PDF has no selectable text, for example because it is a scan. Arden can’t read scanned pages yet.");
    }
    return { fileName: file.name, metadataTitle, pages };
  } catch (cause) {
    if (cause instanceof PdfImportError) throw cause;
    const name = cause instanceof Error ? cause.name : "";
    if (name === "PasswordException") throw new PdfImportError("This PDF is password-protected. Remove the password, then import it again.");
    throw new PdfImportError("This PDF couldn’t be read. It may be damaged.");
  } finally {
    void task.destroy().catch(() => undefined);
  }
}

/** Decision 0034: an original PDF kept in Private has the same limit as a shared PDF draft. */
export const PRIVATE_PDF_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** A PDF ready to keep in Private: its bytes, a title and the text the private AI side panel can read. */
export type PdfUpload = { title: string; pdfBase64: string; text: string; textTruncated: boolean };

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Prepares a PDF to keep in Private (spec F03-FILE). Unlike import, a PDF without a text layer is accepted:
 * it is kept with empty text and the AI side panel is unavailable for it.
 */
export async function readPdfUpload(file: File, load: () => Promise<PdfRuntime> = () => import("../knowledge/pdfRuntime")): Promise<PdfUpload> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new PdfImportError("Choose a PDF file.");
  if (file.size === 0) throw new PdfImportError("This PDF is empty.");
  if (file.size > PRIVATE_PDF_MAX_FILE_BYTES) throw new PdfImportError("This PDF is larger than 5 MB. Choose a smaller file.");
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") throw new PdfImportError("This file isn’t a valid PDF.");
  const pdfBase64 = toBase64(data);
  try {
    const pdf = await readPdfText(file, load);
    const fitted = buildImportedNote(pdf.fileName, pdf.metadataTitle, pdf.pages);
    return { title: fitted.title, pdfBase64, text: fitted.body, textTruncated: fitted.truncated };
  } catch (cause) {
    if (cause instanceof PdfImportError && /no selectable text/.test(cause.message)) {
      return { title: importTitle(file.name), pdfBase64, text: "", textTruncated: false };
    }
    throw cause;
  }
}

/** Opens the system file picker for one PDF; resolves null when the user cancels. Call from a click handler. */
export function choosePdfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
