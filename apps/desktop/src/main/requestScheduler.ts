import type { DesktopApiRequest } from "./apiRequestPolicy.ts";

export type DesktopRequestLane = "bypass" | "ai" | "interactive";

export type SerialLock = <T>(work: () => Promise<T>) => Promise<T>;

export type DesktopRequestScheduler = {
  schedule<T>(request: DesktopApiRequest, work: () => Promise<T>): Promise<T>;
};

export function createSerialLock(): SerialLock {
  let tail: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

function requestPathname(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

export function canPassWaitingRequests(request: DesktopApiRequest): boolean {
  return request.method === "POST" && requestPathname(request.path).endsWith("/analysis-cancellation");
}

export function classifyDesktopRequestLane(request: DesktopApiRequest): DesktopRequestLane {
  if (canPassWaitingRequests(request)) return "bypass";
  const pathname = requestPathname(request.path);
  if (
    request.method === "POST"
    && (
      pathname.endsWith("/ai/answers")
      || pathname.endsWith("/questions")
      || pathname.endsWith("/summary")
      || pathname.endsWith("/writing-actions")
    )
  ) {
    return "ai";
  }
  return "interactive";
}

export function createDesktopRequestScheduler(): DesktopRequestScheduler {
  const interactiveLock = createSerialLock();
  const aiLock = createSerialLock();
  return {
    schedule<T>(request: DesktopApiRequest, work: () => Promise<T>): Promise<T> {
      const lane = classifyDesktopRequestLane(request);
      if (lane === "bypass") return work();
      return lane === "ai" ? aiLock(work) : interactiveLock(work);
    },
  };
}
