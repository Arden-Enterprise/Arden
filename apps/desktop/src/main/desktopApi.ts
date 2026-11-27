import { desktopApiResponseLimit, desktopApiTimeout, type DesktopApiRequest } from "./apiRequestPolicy.ts";
import { createDesktopRequestScheduler, createSerialLock } from "./requestScheduler.ts";

export type CookieJar = Map<string, string>;
export type DesktopApiResponse = { status: number; body: string; etag?: string; location?: string };

type DesktopSessionStorage = {
  origin: () => string;
  read: (origin: string) => Promise<CookieJar>;
  persist: (jar: CookieJar, origin: string) => Promise<void>;
  clear: () => Promise<void>;
};

const authCookieNames = new Set([
  "arden_access", "arden_refresh", "arden_session",
  "__Host-arden_access", "__Host-arden_refresh", "__Host-arden_session",
]);
const systemCookieNames = new Set(["arden_system_session", "__Host-arden_system_session"]);
type CookieScope = "workspace" | "system";

function cookieScope(name: string): CookieScope {
  return systemCookieNames.has(name) ? "system" : "workspace";
}

function applySetCookies(jar: CookieJar, setCookies: string[], scope: CookieScope): void {
  for (const cookie of setCookies) {
    const pair = cookie.split(";", 1)[0]!;
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    if (cookieScope(name) !== scope) continue;
    const value = pair.slice(separator + 1).trim();
    const expiresText = cookie.match(/(?:^|;)\s*expires=([^;]+)/i)?.[1];
    const expiresAt = expiresText ? Date.parse(expiresText.trim()) : Number.NaN;
    const expired = /(?:^|;)\s*max-age=0\s*(?:;|$)/i.test(cookie) ||
      (Number.isFinite(expiresAt) && expiresAt <= Date.now());
    if (expired || value.length === 0) jar.delete(name);
    else if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) jar.set(name, value);
  }
}

async function readResponseBody(response: Response, limit: number, signal?: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason ?? new Error("The desktop session changed");
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => undefined);
        throw new Error("The Arden response exceeded the desktop limit");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export function createDesktopApi(storage: DesktopSessionStorage, fetchResponse: typeof fetch = fetch) {
  const scheduler = createDesktopRequestScheduler();
  const withJarLock = createSerialLock();
  const activeControllers = new Map<AbortController, number>();
  let cookieJar: CookieJar | null = null;
  let sessionEpoch = 0;
  const credentialRevision = { workspace: 0, system: 0 };

  const assertCurrent = (epoch: number) => {
    if (epoch !== sessionEpoch) throw new Error("The desktop session changed");
  };
  const advanceSessionEpoch = () => {
    sessionEpoch += 1;
    const reason = new Error("The desktop session changed");
    for (const [controller, requestEpoch] of activeControllers) {
      if (requestEpoch !== sessionEpoch) {
        activeControllers.delete(controller);
        controller.abort(reason);
      }
    }
    return sessionEpoch;
  };
  const getJar = async (origin: string) => cookieJar ??= await storage.read(origin);

  async function requestApi(request: DesktopApiRequest, epoch = sessionEpoch): Promise<DesktopApiResponse> {
    const scope = request.path.startsWith("/api/v1/system/") ? "system" : "workspace";
    const result = await scheduler.schedule(request, async () => {
      assertCurrent(epoch);
      const origin = storage.origin();
      const { cookieHeader, revision } = await withJarLock(async () => {
        assertCurrent(epoch);
        const jar = await getJar(origin);
        assertCurrent(epoch);
        const cookieHeader = [...jar].filter(([name]) => cookieScope(name) === scope)
          .map(([name, value]) => `${name}=${value}`).join("; ");
        return { cookieHeader, revision: credentialRevision[scope] };
      });
      assertCurrent(epoch);
      const headers = new Headers({ accept: "application/json", origin });
      if (request.body !== undefined) headers.set("content-type", "application/json");
      if (request.ifMatch) headers.set("if-match", request.ifMatch);
      if (request.idempotencyKey) headers.set("idempotency-key", request.idempotencyKey);
      if (cookieHeader) headers.set("cookie", cookieHeader);
      const deadline = desktopApiTimeout(request);
      const controller = new AbortController();
      activeControllers.set(controller, epoch);
      const timeout = deadline === undefined ? undefined : setTimeout(() => controller.abort(), deadline);
      try {
        const response = await fetchResponse(`${origin}${request.path}`, {
          method: request.method, headers, body: request.body, redirect: "error",
          signal: controller.signal,
        });
        if (epoch !== sessionEpoch) {
          void response.body?.cancel().catch(() => undefined);
          assertCurrent(epoch);
        }
        const body = await readResponseBody(response, desktopApiResponseLimit(request), controller.signal);
        activeControllers.delete(controller);
        assertCurrent(epoch);
        const setCookies = response.headers.getSetCookie();
        const changesSession = request.method === "POST" && (
          (request.path === "/api/v1/auth/sign-in" && response.ok) || request.path === "/api/v1/auth/sign-out"
        );
        if (setCookies.length > 0 || changesSession) {
          epoch = await withJarLock(async () => {
            assertCurrent(epoch);
            const currentJar = await getJar(origin);
            assertCurrent(epoch);
            // Explicit sign-in/out owns the account transition. Ordinary refreshes must still match the credentials sent.
            if (changesSession || revision === credentialRevision[scope]) {
              const nextJar = new Map(currentJar);
              applySetCookies(nextJar, setCookies, scope);
              if (nextJar.size !== currentJar.size || [...nextJar].some(([name, value]) => currentJar.get(name) !== value)) {
                await storage.persist(nextJar, origin);
                assertCurrent(epoch);
                cookieJar = nextJar;
                credentialRevision[scope] += 1;
              }
              if (changesSession) advanceSessionEpoch();
            }
            return sessionEpoch;
          });
          assertCurrent(epoch);
        }
        return {
          status: response.status, body,
          etag: response.headers.get("etag") ?? undefined,
          location: response.headers.get("location") ?? undefined,
        };
      } catch (error) {
        assertCurrent(epoch);
        throw error;
      } finally {
        activeControllers.delete(controller);
        if (timeout !== undefined) clearTimeout(timeout);
      }
    });
    assertCurrent(epoch);
    return result;
  }

  return {
    request: requestApi,
    epoch: () => sessionEpoch,
    assertCurrent,
    clear: () => {
      advanceSessionEpoch();
      return withJarLock(async () => {
        cookieJar = new Map();
        credentialRevision.workspace += 1;
        credentialRevision.system += 1;
        await storage.clear();
      });
    },
    async completeGoogleSignIn(epoch: number, cookies: ReadonlyArray<{ name: string; value: string }>): Promise<boolean> {
      return withJarLock(async () => {
        assertCurrent(epoch);
        const origin = storage.origin();
        const jar = new Map(await getJar(origin));
        assertCurrent(epoch);
        for (const name of authCookieNames) jar.delete(name);
        for (const cookie of cookies) if (authCookieNames.has(cookie.name) && cookie.value) jar.set(cookie.name, cookie.value);
        if (!["arden_access", "arden_refresh", "arden_session"].every((name) => jar.has(name) || jar.has(`__Host-${name}`))) {
          return false;
        }
        await storage.persist(jar, origin);
        assertCurrent(epoch);
        cookieJar = jar;
        credentialRevision.workspace += 1;
        advanceSessionEpoch();
        return true;
      });
    },
  };
}
