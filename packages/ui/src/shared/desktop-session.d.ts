export {};

declare global {
  interface Window {
    ardenDesktop?: {
      requestApi(request: { path: string; method: "GET" | "POST" | "PATCH" | "PUT"; body?: string; ifMatch?: string; idempotencyKey?: string; timeoutMs?: number }): Promise<{
        status: number;
        body: string;
        etag?: string;
        location?: string;
      }>;
      clearSession(): Promise<void>;
      startGoogleSignIn(): Promise<void>;
      pasteIntoEditor?(): Promise<void>;
      startNotificationStream?(organizationId: string): Promise<void>;
      stopNotificationStream?(organizationId?: string): Promise<void>;
      subscribeNotificationEvents?(listener: (notificationId: string) => void): () => void;
      subscribeNotificationStatus?(listener: (status: "connected" | "reconnected" | "disconnected" | "session-ended") => void): () => void;
    };
  }
}
