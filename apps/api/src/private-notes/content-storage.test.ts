import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalPrivateContentStorage } from "./content-storage.js";

describe("private note content storage", () => {
  let root: string;
  let storage: LocalPrivateContentStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "arden-private-storage-"));
    storage = new LocalPrivateContentStorage(root);
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("writes opaque content references and verifies their content hash", async () => {
    const stored = await storage.write("private text\nwith Unicode: 你好");
    expect(stored.sourceUri).toMatch(/^arden-private-object:\/\/[0-9a-f-]{36}$/);
    expect(await storage.read(stored.sourceUri, stored.contentHash)).toBe("private text\nwith Unicode: 你好");
    await expect(storage.read(stored.sourceUri, "0".repeat(64))).rejects.toThrow("integrity check failed");
  });

  it("rejects client-controlled paths and removes objects by opaque URI", async () => {
    await expect(storage.read("arden-private-object://../outside", "0".repeat(64))).rejects.toThrow("Invalid private content reference");
    const stored = await storage.write("private text");
    await storage.remove(stored.sourceUri);
    await expect(storage.read(stored.sourceUri, stored.contentHash)).rejects.toThrow();
  });

  it("stores PDF bytes without UTF-8 conversion and verifies their hash", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0xfe]);
    const stored = await storage.writePdf(bytes);
    expect(stored).toMatchObject({ mimeType: "application/pdf" });
    expect(stored.sourceUri).toMatch(/^arden-private-object:\/\/[0-9a-f-]{36}\.pdf$/);
    expect(await storage.readPdf(stored.sourceUri, stored.contentHash)).toEqual(bytes);
    await expect(storage.read(stored.sourceUri, stored.contentHash)).rejects.toThrow("PDF cannot be read as text");
    await expect(storage.readPdf(stored.sourceUri, "0".repeat(64))).rejects.toThrow("integrity check failed");
    await storage.remove(stored.sourceUri);
    await expect(storage.readPdf(stored.sourceUri, stored.contentHash)).rejects.toThrow();
  });
});
