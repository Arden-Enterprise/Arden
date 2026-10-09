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
});
