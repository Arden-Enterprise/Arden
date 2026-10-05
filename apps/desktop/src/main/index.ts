import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type DesktopApiRequest = { path: string; method: "GET" | "POST" | "PATCH"; body?: string; ifMatch?: string };
type DesktopApiResponse = { status: number; body: string; etag?: string; location?: string };
type CookieJar = Map<string, string>;

const outputDirectory = fileURLToPath(new URL(".", import.meta.url));
const sessionFile = () => join(app.getPath("userData"), "auth-session.enc");
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
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

function validateRequest(value: unknown): value is DesktopApiRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["path", "method", "body", "ifMatch"].includes(key))) return false;
  if (typeof request.path !== "string" || request.path.length > 2048 || !request.path.startsWith("/") || request.path.startsWith("//")) return false;
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PATCH") return false;
  if (request.body !== undefined && (typeof request.body !== "string" || Buffer.byteLength(request.body, "utf8") > 128 * 1024)) return false;
  if (request.ifMatch !== undefined && (typeof request.ifMatch !== "string" || request.ifMatch.length > 80)) return false;
  return isAllowedRequest(request as unknown as DesktopApiRequest);
}

function isAllowedRequest(request: DesktopApiRequest): boolean {
  let url: URL;
  try { url = new URL(request.path, "https://arden.invalid"); }
  catch { return false; }
  if (url.origin !== "https://arden.invalid" || url.hash) return false;
  const signIn = url.pathname === "/api/v1/auth/sign-in" && request.method === "POST";
  const signOut = url.pathname === "/api/v1/auth/sign-out" && request.method === "POST";
  const currentUser = url.pathname === "/api/v1/me" && request.method === "GET";
  const draftPath = new RegExp(`^/api/v1/organizations/${uuid}/private-workspace/drafts(?:/${uuid})?$`).test(url.pathname);
  const collection = /\/drafts$/.test(url.pathname);
  const permittedDraftMethod = draftPath && (
    (request.method === "GET" && !request.body && !request.ifMatch) ||
    (collection && request.method === "POST" && Boolean(request.body) && !request.ifMatch) ||
    (!collection && request.method === "PATCH" && Boolean(request.body) && Boolean(request.ifMatch))
  );
  const queryAllowed = collection && [...url.searchParams.keys()].every((key) => key === "limit" || key === "cursor");
  return (signIn || signOut || currentUser || permittedDraftMethod) && (!url.search || queryAllowed);
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
  if (!validateRequest(value)) throw new Error("Invalid desktop API request");
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
