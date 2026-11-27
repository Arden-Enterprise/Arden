import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopApiRequest } from "./apiRequestPolicy.ts";
import { createDesktopApi } from "./desktopApi.ts";
import {
  canPassWaitingRequests,
  classifyDesktopRequestLane,
  createDesktopRequestScheduler,
  createSerialLock,
} from "./requestScheduler.ts";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const docId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const caseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("desktop request lane classification", () => {
  it("routes long-running AI POST endpoints onto the AI lane", () => {
    const aiRequests: DesktopApiRequest[] = [
      { path: `/api/v1/organizations/${orgId}/ai/answers`, method: "POST", body: JSON.stringify({ query: "Hi" }) },
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}/questions`, method: "POST", body: "{}" },
      { path: `/api/v1/organizations/${orgId}/private-workspace/drafts/${docId}/questions`, method: "POST", body: "{}" },
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}/summary`, method: "POST", body: "{}" },
      { path: `/api/v1/organizations/${orgId}/ai/writing-actions`, method: "POST", body: "{}" },
    ];
    for (const request of aiRequests) {
      assert.equal(classifyDesktopRequestLane(request), "ai", `${request.method} ${request.path}`);
      assert.equal(canPassWaitingRequests(request), false);
    }
  });

  it("routes interactive GET reads and non-AI mutations onto the interactive lane", () => {
    const interactiveRequests: DesktopApiRequest[] = [
      { path: `/api/v1/organizations/${orgId}/knowledge/graph`, method: "GET" },
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}`, method: "GET" },
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}/summary/access`, method: "GET" },
      { path: `/api/v1/organizations/${orgId}/ai/conversations/${docId}?limit=20`, method: "GET" },
      { path: `/api/v1/organizations/${orgId}/knowledge/renewals`, method: "GET" },
      { path: `/api/v1/organizations/${orgId}/knowledge/documents/${docId}/renewal`, method: "POST", body: "{}" },
      { path: "/api/v1/me", method: "GET" },
    ];
    for (const request of interactiveRequests) {
      assert.equal(classifyDesktopRequestLane(request), "interactive", `${request.method} ${request.path}`);
      assert.equal(canPassWaitingRequests(request), false);
    }
  });

  it("preserves bypass classification for maintenance analysis cancellation", () => {
    const cancel: DesktopApiRequest = {
      path: `/api/v1/organizations/${orgId}/knowledge/maintenance/cases/${caseId}/analysis-cancellation`,
      method: "POST",
      body: "{}",
    };
    assert.equal(canPassWaitingRequests(cancel), true);
    assert.equal(classifyDesktopRequestLane(cancel), "bypass");
    assert.equal(canPassWaitingRequests({ ...cancel, method: "GET" }), false);
  });
});

describe("desktop request scheduler concurrency", () => {
  it("lets interactive GET reads and non-AI mutations finish while POST /ai/answers is in flight", async () => {
    const scheduler = createDesktopRequestScheduler();
    const aiGate = deferred<string>();
    const events: string[] = [];

    const aiPromise = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/ai/answers`, method: "POST", body: JSON.stringify({ query: "Explain policy" }) },
      async () => {
        events.push("ai:start");
        const result = await aiGate.promise;
        events.push("ai:end");
        return result;
      },
    );

    const graphPromise = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/graph`, method: "GET" },
      async () => {
        events.push("graph:run");
        return "graph-ok";
      },
    );

    const readerPromise = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}`, method: "GET" },
      async () => {
        events.push("reader:run");
        return "reader-ok";
      },
    );

    const renewalPromise = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/documents/${docId}/renewal`, method: "POST", body: "{}" },
      async () => {
        events.push("renewal:run");
        return "renewal-ok";
      },
    );

    assert.equal(await graphPromise, "graph-ok");
    assert.equal(await readerPromise, "reader-ok");
    assert.equal(await renewalPromise, "renewal-ok");
    assert.deepEqual(events, ["ai:start", "graph:run", "reader:run", "renewal:run"]);

    aiGate.resolve("ai-ok");
    assert.equal(await aiPromise, "ai-ok");
    assert.deepEqual(events, ["ai:start", "graph:run", "reader:run", "renewal:run", "ai:end"]);
  });

  it("serializes requests within each lane independently and recovers after errors", async () => {
    const scheduler = createDesktopRequestScheduler();
    const firstAiGate = deferred<void>();
    const firstInteractiveGate = deferred<void>();
    const events: string[] = [];

    const ai1 = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}/summary`, method: "POST", body: "{}" },
      async () => {
        events.push("ai1:start");
        await firstAiGate.promise;
        events.push("ai1:fail");
        throw new Error("ai failure");
      },
    );
    const ai2 = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/ai/writing-actions`, method: "POST", body: "{}" },
      async () => {
        events.push("ai2:run");
        return "ai2-ok";
      },
    );

    const read1 = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/graph`, method: "GET" },
      async () => {
        events.push("read1:start");
        await firstInteractiveGate.promise;
        events.push("read1:fail");
        throw new Error("read failure");
      },
    );
    const read2 = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/published/${docId}`, method: "GET" },
      async () => {
        events.push("read2:run");
        return "read2-ok";
      },
    );

    // Wait a tick so both lanes start their first task, while second tasks stay queued.
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["ai1:start", "read1:start"]);

    firstInteractiveGate.resolve();
    await assert.rejects(read1, /read failure/);
    assert.equal(await read2, "read2-ok");
    assert.equal(events.includes("ai2:run"), false);

    firstAiGate.resolve();
    await assert.rejects(ai1, /ai failure/);
    assert.equal(await ai2, "ai2-ok");
    assert.deepEqual(events, ["ai1:start", "read1:start", "read1:fail", "read2:run", "ai1:fail", "ai2:run"]);
  });

  it("allows analysis-cancellation to bypass both blocked interactive and AI lanes", async () => {
    const scheduler = createDesktopRequestScheduler();
    const interactiveGate = deferred<void>();
    const aiGate = deferred<void>();
    const events: string[] = [];

    const blockedInteractive = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/maintenance/cases/${caseId}/analysis`, method: "POST", body: "{}" },
      async () => {
        events.push("analysis:start");
        await interactiveGate.promise;
        events.push("analysis:end");
      },
    );

    const blockedAi = scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/ai/answers`, method: "POST", body: JSON.stringify({ query: "q" }) },
      async () => {
        events.push("ai:start");
        await aiGate.promise;
        events.push("ai:end");
      },
    );

    const cancelResult = await scheduler.schedule(
      { path: `/api/v1/organizations/${orgId}/knowledge/maintenance/cases/${caseId}/analysis-cancellation`, method: "POST", body: "{}" },
      async () => {
        events.push("cancel:run");
        return "cancelled";
      },
    );

    assert.equal(cancelResult, "cancelled");
    assert.equal(events.includes("cancel:run"), true);
    assert.equal(events.includes("analysis:end"), false);
    assert.equal(events.includes("ai:end"), false);

    interactiveGate.resolve();
    aiGate.resolve();
    await Promise.all([blockedInteractive, blockedAi]);
  });

  it("releases the serial lock cleanly even when a locked callback throws", async () => {
    const withJarLock = createSerialLock();
    await assert.rejects(
      withJarLock(async () => {
        throw new Error("disk error");
      }),
      /disk error/,
    );
    const recovered = await withJarLock(async () => "recovered");
    assert.equal(recovered, "recovered");
  });
});

function desktopApiFixture(fetchResponse: typeof fetch) {
  const savedSessions: Array<string | undefined> = [];
  const api = createDesktopApi({
    origin: () => "http://127.0.0.1:3001",
    read: async () => new Map([["arden_session", "original"]]),
    persist: async (jar) => { savedSessions.push(jar.get("arden_session")); },
    clear: async () => { savedSessions.push(undefined); },
  }, fetchResponse);
  return { api, savedSessions };
}

const aiRequest: DesktopApiRequest = { path: `/api/v1/organizations/${orgId}/ai/answers`, method: "POST", body: "{}" };
const meRequest: DesktopApiRequest = { path: "/api/v1/me", method: "GET" };

describe("desktop API session delivery", () => {
  it("discards pending and queued requests from the prior session after sign-out and sign-in", async () => {
    const firstFetch = deferred();
    const delayedResponse = deferred<Response>();
    const sentSessions: Array<string | null> = [];
    const { api, savedSessions } = desktopApiFixture(async (url, options) => {
      if (String(url).endsWith("/auth/sign-in")) {
        return Response.json({}, { headers: { "set-cookie": "arden_session=current" } });
      }
      sentSessions.push(new Headers(options?.headers).get("cookie"));
      if (sentSessions.length === 1) { firstFetch.resolve(); return delayedResponse.promise; }
      return Response.json({ result: "current" });
    });
    const inFlight = api.request(aiRequest);
    await firstFetch.promise;
    const queued = api.request(aiRequest);
    const discarded = Promise.all([
      assert.rejects(inFlight, /The desktop session changed/),
      assert.rejects(queued, /The desktop session changed/),
    ]);
    await api.clear();
    await api.request({ path: "/api/v1/auth/sign-in", method: "POST", body: "{}" });
    delayedResponse.resolve(Response.json({ result: "previous" }, { headers: { "set-cookie": "arden_session=previous" } }));
    await discarded;
    assert.deepEqual(sentSessions, ["arden_session=original"]);
    assert.deepEqual(savedSessions, [undefined, "current"]);
    assert.deepEqual(JSON.parse((await api.request(aiRequest)).body), { result: "current" });
    assert.equal(sentSessions.at(-1), "arden_session=current");
  });

  it("keeps the newer cookie revision when concurrent requests return credentials", async () => {
    const firstFetch = deferred();
    const delayedResponse = deferred<Response>();
    const { api, savedSessions } = desktopApiFixture(async (url, options) => {
      if (String(url).endsWith("/ai/answers")) {
        firstFetch.resolve();
        return delayedResponse.promise;
      }
      const cookie = new Headers(options?.headers).get("cookie");
      return Response.json({ cookie }, { headers: { "set-cookie": "arden_session=rotated" } });
    });
    const pending = api.request(aiRequest);
    await firstFetch.promise;
    await api.request(meRequest);
    delayedResponse.resolve(Response.json({}, { headers: { "set-cookie": "arden_session=original" } }));
    await pending;
    const after = await api.request(meRequest);
    assert.deepEqual(JSON.parse(after.body), { cookie: "arden_session=rotated" });
    assert.deepEqual(savedSessions, ["rotated"]);
  });

  it("keeps System Admin sign-in separate from a concurrent workspace refresh", async () => {
    const aiStarted = deferred();
    const systemStarted = deferred();
    const aiResponse = deferred<Response>();
    const systemResponse = deferred<Response>();
    const { api } = desktopApiFixture(async (url, options) => {
      if (String(url).endsWith("/ai/answers")) { aiStarted.resolve(); return aiResponse.promise; }
      if (String(url).endsWith("/system/auth/sign-in")) {
        assert.equal(new Headers(options?.headers).get("cookie"), null);
        systemStarted.resolve();
        return systemResponse.promise;
      }
      return Response.json({ cookie: new Headers(options?.headers).get("cookie") });
    });
    const ai = api.request(aiRequest);
    await aiStarted.promise;
    const system = api.request({ path: "/api/v1/system/auth/sign-in", method: "POST", body: "{}" });
    await systemStarted.promise;
    aiResponse.resolve(Response.json({}, { headers: { "set-cookie": "arden_session=workspace" } }));
    await ai;
    systemResponse.resolve(Response.json({}, { headers: { "set-cookie": "arden_system_session=isolated" } }));
    await system;

    assert.deepEqual(JSON.parse((await api.request(meRequest)).body), { cookie: "arden_session=workspace" });
    const systemMe = await api.request({ path: "/api/v1/system/auth/me", method: "GET" });
    assert.deepEqual(JSON.parse(systemMe.body), { cookie: "arden_system_session=isolated" });
  });

  it("stops reading an oversized UTF-8 response at the IPC limit", async () => {
    const chunk = new TextEncoder().encode("語".repeat(400_000));
    let cancelled = false;
    const { api, savedSessions } = desktopApiFixture(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    }), { headers: { "set-cookie": "arden_session=oversize" } }));

    await assert.rejects(api.request(meRequest), /response exceeded the desktop limit/);
    assert.equal(cancelled, true);
    assert.deepEqual(savedSessions, []);
  });

  it("aborts a stalled Session A AI request immediately on session change so Session B is not blocked on aiLock", async () => {
    const sessionAStarted = deferred();
    const fallbackUnblock = deferred<Response>();
    let sessionASignal: AbortSignal | undefined;
    let sessionAbortedImmediately = false;
    const { api } = desktopApiFixture(async (url, options) => {
      if (String(url).endsWith("/auth/sign-out")) {
        return Response.json({}, { headers: { "set-cookie": "arden_session=; Max-Age=0" } });
      }
      if (String(url).endsWith("/auth/sign-in")) {
        return Response.json({}, { headers: { "set-cookie": "arden_session=session-b" } });
      }
      const cookie = new Headers(options?.headers).get("cookie");
      if (cookie === "arden_session=original") {
        sessionASignal = options?.signal ?? undefined;
        sessionAStarted.resolve();
        // Simulate a stalled 120s/300s AI fetch that only resolves/rejects when aborted via AbortSignal.
        return await Promise.race([
          fallbackUnblock.promise,
          new Promise<Response>((_resolve, reject) => {
            const onAbort = () => {
              sessionAbortedImmediately = true;
              reject(options?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
            };
            if (options?.signal?.aborted) onAbort();
            else options?.signal?.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
      }
      return Response.json({ session: "B", cookie });
    });

    const stalledAi = api.request(aiRequest);
    try {
      await sessionAStarted.promise;
      assert.ok(sessionASignal, "Expected an AbortSignal to be attached to fetchResponse");
      assert.equal(sessionASignal.aborted, false);

      // Sign out Session A and sign in Session B while Session A's AI fetch is still stalled.
      await api.request({ path: "/api/v1/auth/sign-out", method: "POST", body: "{}" });
      assert.equal(sessionASignal.aborted, true, "Session change must immediately abort in-flight requests from prior epoch");
      assert.equal(sessionAbortedImmediately, true);
      await assert.rejects(stalledAi, /The desktop session changed/);

      await api.request({ path: "/api/v1/auth/sign-in", method: "POST", body: "{}" });

      // Session B's AI request must execute immediately without waiting for Session A's stalled fetch.
      const sessionBResponse = await Promise.race([
        api.request(aiRequest),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Session B AI request was blocked by prior session aiLock")), 500),
        ),
      ]);
      assert.deepEqual(JSON.parse(sessionBResponse.body), { session: "B", cookie: "arden_session=session-b" });
    } finally {
      fallbackUnblock.reject(new Error("test cleanup"));
      await stalledAi.catch(() => undefined);
    }
  });
});
