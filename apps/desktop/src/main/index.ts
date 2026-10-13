import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateDesktopApiRequest, type DesktopApiRequest } from "./apiRequestPolicy";

type DesktopApiResponse = { status: number; body: string; etag?: string; location?: string };
type CookieJar = Map<string, string>;

const outputDirectory = fileURLToPath(new URL(".", import.meta.url));
const sessionFile = () => join(app.getPath("userData"), "auth-session.enc");
let cookieJar: CookieJar | null = null;
let requestQueue: Promise<void> = Promise.resolve();

function isTrustedRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url;
  return process.env.ELECTRON_RENDERER_URL
    ? url.startsWith("http://127.0.0.1:5181/") || url === "http://127.0.0.1:5181"
    : url.startsWith("file://");
}

function trustedApiOrigin(): string {
  const configured = process.env.ARDEN_CORE_URL ?? (app.isPackaged ? "" : "http://127.0.0.1:3001");
  if (!configured) throw new Error("ARDEN_CORE_URL is required for the desktop client");
  const url = new URL(configured);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("ARDEN_CORE_URL must be a trusted HTTPS origin");
  }
  return url.origin;
}

async function readCookieJar(origin: string): Promise<CookieJar> {
  if (cookieJar) return cookieJar;
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
    const encoded = await readFile(sessionFile(), "utf8");
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(encoded, "base64"));
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("origin" in parsed) || !("cookies" in parsed) ||
      typeof parsed.origin !== "string" || !Array.isArray(parsed.cookies) ||
      parsed.cookies.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string")) {
      throw new Error("Invalid encrypted session data");
    }
    if (parsed.origin !== origin) {
      await rm(sessionFile(), { force: true });
      cookieJar = new Map();
    } else {
      cookieJar = new Map(parsed.cookies as Array<[string, string]>);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") cookieJar = new Map();
    else throw new Error("The secure desktop session could not be read");
  }
  return cookieJar;
}

async function persistCookieJar(jar: CookieJar, origin: string): Promise<void> {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ origin, cookies: [...jar] }));
  const destination = sessionFile();
  const temporary = `${destination}.pending`;
  await writeFile(temporary, encrypted.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "w" });
  await rename(temporary, destination);
}

function applySetCookies(jar: CookieJar, setCookies: string[]): void {
  for (const cookie of setCookies) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expiresText = cookie.match(/(?:^|;)\s*expires=([^;]+)/i)?.[1];
    const expiresAt = expiresText ? Date.parse(expiresText.trim()) : Number.NaN;
    const expired = /(?:^|;)\s*max-age=0\s*(?:;|$)/i.test(cookie) ||
      (Number.isFinite(expiresAt) && expiresAt <= Date.now());
    if (expired || value.length === 0) jar.delete(name);
    else if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) jar.set(name, value);
  }
}

async function doApiRequest(request: DesktopApiRequest): Promise<DesktopApiResponse> {
  const origin = trustedApiOrigin();
  const jar = await readCookieJar(origin);
  const headers = new Headers({ accept: "application/json", origin });
  if (request.body !== undefined) headers.set("content-type", "application/json");
  if (request.ifMatch) headers.set("if-match", request.ifMatch);
  if (request.idempotencyKey) headers.set("idempotency-key", request.idempotencyKey);
  if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
  const response = await fetch(`${origin}${request.path}`, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "error",
  });
  applySetCookies(jar, response.headers.getSetCookie());
  await persistCookieJar(jar, origin);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > 1024 * 1024) throw new Error("The Arden response exceeded the desktop limit");
  return {
    status: response.status,
    body,
    etag: response.headers.get("etag") ?? undefined,
    location: response.headers.get("location") ?? undefined,
  };
}

ipcMain.handle("arden:api-request", async (event, value: unknown) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  if (!validateDesktopApiRequest(value)) throw new Error("Invalid desktop API request");
  const request = value as DesktopApiRequest;
  const current = requestQueue.then(() => doApiRequest(request));
  requestQueue = current.then(() => undefined, () => undefined);
  return current;
});

ipcMain.handle("arden:session:clear", async (event) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  cookieJar = new Map();
  await rm(sessionFile(), { force: true });
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: "Arden",
    backgroundColor: "#242628",
    webPreferences: {
      preload: join(outputDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(outputDirectory, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
