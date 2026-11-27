import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { PgMaintenanceStore } from "./case-store.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";

function storeWithSource(
  source: { document_id: string; content_uri: string; content_hash: string; mime_type: string } | null,
  content: { read: (uri: string, hash: string) => Promise<string>; readPdf?: (uri: string, hash: string) => Promise<Buffer> },
) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("maintenance_actor_is_admin")) return { rows: [{ ok: false }] };
      if (sql.includes("set_config")) return { rows: [] };
      if (sql.includes("maintenance_version_source")) return { rows: source ? [source] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as PoolClient;
  return new PgMaintenanceStore(async (_u, _o, work) => work(client), content);
}

describe("PgMaintenanceStore version originals", () => {
  it("reads an authorized PDF original as base64 while keeping readVersionText null for PDFs", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");
    const readPdf = vi.fn(async () => pdfBytes);
    const read = vi.fn(async () => "should-not-be-called");
    const store = storeWithSource(
      { document_id: documentId, content_uri: "arden-private-object://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf", content_hash: "ab".repeat(32), mime_type: "application/pdf" },
      { read, readPdf },
    );

    const textOnly = await store.transaction(user, org, (tx) => tx.readVersionText(versionId));
    expect(textOnly).toEqual({ documentId, text: null });
    expect(read).not.toHaveBeenCalled();

    const original = await store.transaction(user, org, (tx) => tx.readVersionOriginal!(versionId));
    expect(readPdf).toHaveBeenCalledWith("arden-private-object://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf", "ab".repeat(32));
    expect(original).toEqual({
      documentId,
      mimeType: "application/pdf",
      pdfBase64: pdfBytes.toString("base64"),
      text: null,
    });
  });

  it("returns unavailable when PDF storage fails integrity check, is oversized, or lacks a PDF header", async () => {
    const source = {
      document_id: documentId,
      content_uri: "arden-private-object://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf",
      content_hash: "ab".repeat(32),
      mime_type: "application/pdf",
    };

    const broken = storeWithSource(source, {
      read: vi.fn(async () => ""),
      readPdf: vi.fn(async () => { throw new Error("integrity mismatch"); }),
    });
    expect(await broken.transaction(user, org, (tx) => tx.readVersionOriginal!(versionId))).toEqual({ documentId, text: null });

    const notPdf = storeWithSource(source, {
      read: vi.fn(async () => ""),
      readPdf: vi.fn(async () => Buffer.from("<html>not a pdf</html>", "utf8")),
    });
    expect(await notPdf.transaction(user, org, (tx) => tx.readVersionOriginal!(versionId))).toEqual({ documentId, text: null });

    const oversized = storeWithSource(source, {
      read: vi.fn(async () => ""),
      readPdf: vi.fn(async () => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024)])),
    });
    expect(await oversized.transaction(user, org, (tx) => tx.readVersionOriginal!(versionId))).toEqual({ documentId, text: null });
  });
});
