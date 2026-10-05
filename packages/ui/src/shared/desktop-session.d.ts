export {};

declare global {
  interface Window {
    ardenDesktop?: {
      requestApi(request: { path: string; method: "GET" | "POST" | "PATCH"; body?: string; ifMatch?: string }): Promise<{
        status: number;
        body: string;
        etag?: string;
        location?: string;
      }>;
      clearSession(): Promise<void>;
    };
  }
}
