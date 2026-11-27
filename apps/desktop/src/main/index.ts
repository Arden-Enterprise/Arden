import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RealtimeClient, type RealtimeChannel } from "@supabase/realtime-js";
import { validateDesktopApiRequest, type DesktopApiRequest } from "./apiRequestPolicy";
import { createDesktopApi, type CookieJar } from "./desktopApi";

const outputDirectory = fileURLToPath(new URL(".", import.meta.url));
const sessionFile = () => join(app.getPath("userData"), "auth-session.enc");
const desktopApi = createDesktopApi({
  origin: trustedApiOrigin,
  read: readCookieJar,
  persist: persistCookieJar,
  clear: () => rm(sessionFile(), { force: true }),
});
let notificationLifecycle: Promise<void> = Promise.resolve();
let notificationClient: RealtimeClient | null = null;
let notificationChannel: RealtimeChannel | null = null;
let notificationWindow: BrowserWindow | null = null;
let notificationOrganizationId: string | null = null;
let notificationEpoch: number | null = null;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MainNotificationCredential = { endpoint: string; apiKey: string; accessToken: string; topic: string; expiresAt: string };

class NotificationCredentialError extends Error {
  constructor(readonly status: number) { super("Notification updates are unavailable"); }
}

function isTrustedRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url;
  return process.env.ELECTRON_RENDERER_URL
    ? url.startsWith("http://127.0.0.1:5181/") || url === "http://127.0.0.1:5181"
    : url.startsWith("file://");
}

ipcMain.handle("arden:editor:paste", (event) => {
  if (!isTrustedRenderer(event) || !BrowserWindow.fromWebContents(event.sender)?.isFocused()
    || event.sender.focusedFrame !== event.sender.mainFrame) {
    throw new Error("Desktop paste is unavailable");
  }
  event.sender.paste();
});

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
      return new Map();
    }
    return new Map(parsed.cookies as Array<[string, string]>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new Error("The secure desktop session could not be read");
  }
}

async function persistCookieJar(jar: CookieJar, origin: string): Promise<void> {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ origin, cookies: [...jar] }));
  const destination = sessionFile();
  const temporary = `${destination}.pending`;
  await writeFile(temporary, encrypted.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "w" });
  await rename(temporary, destination);
}

function enqueueNotificationLifecycle(work: () => Promise<void>): Promise<void> {
  const current = notificationLifecycle.then(work, work);
  notificationLifecycle = current.catch(() => undefined);
  return current;
}

async function requestNotificationCredential(organizationId: string, epoch: number): Promise<MainNotificationCredential> {
  const credentialRequest: DesktopApiRequest = {
    path: `/api/v1/organizations/${organizationId}/notifications/realtime-credential`,
    method: "GET",
  };
  const response = await desktopApi.request(credentialRequest, epoch);
  if (response.status !== 200) throw new NotificationCredentialError(response.status);
  let parsed: unknown;
  try { parsed = JSON.parse(response.body); }
  catch { throw new Error("Notification updates are unavailable"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Notification updates are unavailable");
  const value = parsed as Record<string, unknown>;
  if (typeof value.endpoint !== "string" || typeof value.apiKey !== "string" || typeof value.accessToken !== "string"
    || typeof value.topic !== "string" || typeof value.expiresAt !== "string") throw new Error("Notification updates are unavailable");
  let endpoint: URL;
  try { endpoint = new URL(value.endpoint); }
  catch { throw new Error("Notification updates are unavailable"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  const expiry = Date.parse(value.expiresAt);
  const topicParts = value.topic.split(":");
  if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback))
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname.replace(/\/$/, "") !== "/realtime/v1"
    || value.apiKey.length < 16 || value.apiKey.length > 4096
    || value.accessToken.length > 8192 || !/^[-A-Za-z0-9_.]+$/.test(value.accessToken)
    || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 150_000
    || topicParts.length !== 4 || topicParts[0] !== "arden-notifications"
    || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(topicParts[1] ?? "")
    || topicParts[2] !== organizationId || !uuidPattern.test(topicParts[3] ?? "")) {
    throw new Error("Notification updates are unavailable");
  }
  return { endpoint: endpoint.toString().replace(/\/$/, ""), apiKey: value.apiKey,
    accessToken: value.accessToken, topic: value.topic, expiresAt: value.expiresAt };
}

async function disposeNotificationStream(): Promise<void> {
  const currentClient = notificationClient;
  const currentChannel = notificationChannel;
  notificationClient = null;
  notificationChannel = null;
  notificationWindow = null;
  notificationOrganizationId = null;
  notificationEpoch = null;
  if (currentClient && currentChannel) await currentClient.removeChannel(currentChannel).catch(() => undefined);
  currentClient?.disconnect();
}

function startNotificationStream(parent: BrowserWindow, organizationId: string, epoch: number): Promise<void> {
  return enqueueNotificationLifecycle(async () => {
    desktopApi.assertCurrent(epoch);
    if (notificationClient && notificationOrganizationId === organizationId && notificationWindow === parent && notificationEpoch === epoch) return;
    await disposeNotificationStream();
    if (parent.isDestroyed()) return;
    let credential = await requestNotificationCredential(organizationId, epoch);
    desktopApi.assertCurrent(epoch);
    const canNotify = () => desktopApi.epoch() === epoch && !parent.isDestroyed() && notificationWindow === parent;
    let refreshPromise: Promise<MainNotificationCredential> | null = null;
    const refresh = async () => {
      desktopApi.assertCurrent(epoch);
      if (Date.parse(credential.expiresAt) > Date.now() + 45_000) return credential;
      refreshPromise ??= requestNotificationCredential(organizationId, epoch).finally(() => { refreshPromise = null; });
      try {
        const next = await refreshPromise;
        desktopApi.assertCurrent(epoch);
        if (next.endpoint !== credential.endpoint || next.topic !== credential.topic) {
          throw new Error("Notification channel scope changed");
        }
        credential = next;
        return credential;
      } catch (error) {
        if (error instanceof NotificationCredentialError && (error.status === 401 || error.status === 404)) {
          if (canNotify()) {
            parent.webContents.send("arden:notification-status", "session-ended");
            void stopNotificationStream(epoch);
          }
        }
        throw error;
      }
    };
    const wsEndpoint = new URL(credential.endpoint);
    wsEndpoint.protocol = wsEndpoint.protocol === "https:" ? "wss:" : "ws:";
    const client = new RealtimeClient(wsEndpoint.toString().replace(/\/$/, ""), {
      params: { apikey: credential.apiKey },
      accessToken: async () => (await refresh()).accessToken,
    });
    await client.setAuth();
    if (parent.isDestroyed() || desktopApi.epoch() !== epoch) {
      await client.disconnect();
      return;
    }
    const channel = client.channel(credential.topic, { config: { private: true } });
    let subscribed = false;
    channel.on("broadcast", { event: "notification" }, (message) => {
      const payload = typeof message === "object" && message !== null && "payload" in message
        ? (message as { payload?: unknown }).payload : null;
      const notificationId = typeof payload === "object" && payload !== null && "notificationId" in payload
        ? (payload as { notificationId?: unknown }).notificationId : null;
      if (typeof notificationId === "string" && uuidPattern.test(notificationId) && canNotify()) {
        parent.webContents.send("arden:notification-event", notificationId);
      }
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (canNotify()) {
          parent.webContents.send("arden:notification-status", subscribed ? "reconnected" : "connected");
        }
        subscribed = true;
      } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        && canNotify()) {
        parent.webContents.send("arden:notification-status", "disconnected");
      }
    });
    notificationClient = client;
    notificationChannel = channel;
    notificationWindow = parent;
    notificationOrganizationId = organizationId;
    notificationEpoch = epoch;
  });
}

function stopNotificationStream(epoch?: number): Promise<void> {
  return enqueueNotificationLifecycle(async () => {
    if (epoch === undefined || desktopApi.epoch() === epoch) await disposeNotificationStream();
  });
}

ipcMain.handle("arden:api-request", async (event, value: unknown) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  if (!validateDesktopApiRequest(value)) throw new Error("Invalid desktop API request");
  return desktopApi.request(value);
});

ipcMain.handle("arden:notifications:start", async (event, organizationId: unknown) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent || typeof organizationId !== "string" || !uuidPattern.test(organizationId)) {
    throw new Error("Invalid notification stream request");
  }
  const epoch = desktopApi.epoch();
  try { await startNotificationStream(parent, organizationId, epoch); }
  catch (error) {
    if (desktopApi.epoch() === epoch && error instanceof NotificationCredentialError
      && (error.status === 401 || error.status === 404) && !parent.isDestroyed()) {
      parent.webContents.send("arden:notification-status", "session-ended");
    }
    await stopNotificationStream(epoch);
    throw new Error("Notification updates are unavailable");
  }
});

ipcMain.handle("arden:notifications:stop", async (event, organizationId: unknown) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  if (organizationId !== undefined && (typeof organizationId !== "string" || !uuidPattern.test(organizationId))) {
    throw new Error("Invalid notification stream request");
  }
  if (typeof organizationId === "string" && notificationOrganizationId !== organizationId) return;
  await stopNotificationStream();
});

ipcMain.handle("arden:session:clear", async (event) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  await Promise.all([desktopApi.clear(), stopNotificationStream()]);
});

ipcMain.handle("arden:auth:google", async (event) => {
  if (!isTrustedRenderer(event)) throw new Error("Untrusted IPC sender");
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) throw new Error("Arden window is unavailable");
  await startDesktopGoogleSignIn(parent);
});

async function startDesktopGoogleSignIn(parent: BrowserWindow): Promise<void> {
  const origin = trustedApiOrigin();
  const epoch = desktopApi.epoch();
  const partition = `arden-oauth-${randomUUID()}`;
  const authSession = session.fromPartition(partition, { cache: false });
  authSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const authWindow = new BrowserWindow({
    parent,
    modal: true,
    show: true,
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 600,
    title: "Sign in to Arden",
    backgroundColor: "#17191b",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  authWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  authWindow.webContents.on("will-navigate", (event, target) => {
    try {
      const url = new URL(target);
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) event.preventDefault();
    } catch { event.preventDefault(); }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let completing = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!authWindow.isDestroyed()) authWindow.close();
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => finish(new Error("Google sign-in timed out")), 5 * 60 * 1000);
    authWindow.on("closed", () => {
      if (!settled) finish(new Error("Google sign-in was cancelled"));
    });
    authWindow.webContents.on("did-navigate", async (_event, target) => {
      try {
        const url = new URL(target);
        if (url.origin !== origin || url.pathname !== "/api/v1/auth/google/desktop-complete") return;
        if (settled || completing) return;
        completing = true;
        if (url.searchParams.get("status") !== "success") return finish(new Error("Google sign-in could not be completed"));
        const cookies = await authSession.cookies.get({ url: origin });
        if (settled) return;
        const validSession = await desktopApi.completeGoogleSignIn(epoch, cookies);
        if (!validSession) {
          return finish(new Error("Google sign-in did not return an Arden session"));
        }
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Google sign-in could not be completed"));
      }
    });
    void authWindow.loadURL(`${origin}/api/v1/auth/google/start?client=desktop`).catch((error) => finish(error));
  });
}

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
  window.once("closed", () => {
    if (notificationWindow === window) void stopNotificationStream();
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
