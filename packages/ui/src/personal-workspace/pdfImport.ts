/**
 * Import a PDF as a private note (spec F03-PDF). The text is read in this browser with the bundled
 * pdf.js and saved as an ordinary text note; the PDF file itself is never uploaded or stored.
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

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

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

type PdfRuntime = typeof import("../knowledge/pdfRuntime");

/** Reads every page's text with pdf.js; maps password and corrupt-file failures to clear messages. */
export async function readPdfFile(file: File, load: () => Promise<PdfRuntime> = () => import("../knowledge/pdfRuntime")): Promise<ImportedNote> {
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
    return buildImportedNote(file.name, metadataTitle, pages);
  } catch (cause) {
    if (cause instanceof PdfImportError) throw cause;
    const name = cause instanceof Error ? cause.name : "";
    if (name === "PasswordException") throw new PdfImportError("This PDF is password-protected. Remove the password, then import it again.");
    throw new PdfImportError("This PDF couldn’t be read. It may be damaged.");
  } finally {
    void task.destroy().catch(() => undefined);
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
