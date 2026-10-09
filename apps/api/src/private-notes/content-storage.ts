import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const objectUriPattern = /^arden-private-object:\/\/([0-9a-f-]{36})$/i;

export type StoredContent = { sourceUri: string; contentHash: string; mimeType: "text/plain" };

export interface PrivateContentStorage {
  write(body: string): Promise<StoredContent>;
  read(sourceUri: string, expectedHash: string): Promise<string>;
  remove(sourceUri: string): Promise<void>;
}

export class LocalPrivateContentStorage implements PrivateContentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(body: string): Promise<StoredContent> {
    const objectId = randomUUID();
    const destination = this.objectPath(objectId);
    const temporary = `${destination}.pending`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.root, 0o700);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    if (process.platform !== "win32") {
      const directory = await open(dirname(destination), "r");
      try { await directory.sync(); }
      finally { await directory.close(); }
    }
    return {
      sourceUri: `arden-private-object://${objectId}`,
      contentHash: createHash("sha256").update(body, "utf8").digest("hex"),
      mimeType: "text/plain",
    };
  }

  async read(sourceUri: string, expectedHash: string): Promise<string> {
    const body = await readFile(this.objectPathFromUri(sourceUri), "utf8");
    const actualHash = createHash("sha256").update(body, "utf8").digest("hex");
    if (actualHash !== expectedHash) throw new Error("Private content integrity check failed");
    return body;
  }

  async remove(sourceUri: string): Promise<void> {
    await rm(this.objectPathFromUri(sourceUri), { force: true });
  }

  private objectPathFromUri(sourceUri: string): string {
    const match = objectUriPattern.exec(sourceUri);
    if (!match) throw new Error("Invalid private content reference");
    return this.objectPath(match[1]);
  }

  private objectPath(objectId: string): string {
    const path = resolve(this.root, `${objectId}.txt`);
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error("Invalid private content path");
    return join(this.root, `${objectId}.txt`);
  }
}
