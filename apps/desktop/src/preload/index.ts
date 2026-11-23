import { contextBridge, ipcRenderer } from "electron";

type DesktopApiRequest = { path: string; method: "GET" | "POST" | "PATCH" | "PUT"; body?: string; ifMatch?: string; idempotencyKey?: string; timeoutMs?: number };
type DesktopApiResponse = { status: number; body: string; etag?: string; location?: string };

contextBridge.exposeInMainWorld("ardenDesktop", {
  requestApi: (request: DesktopApiRequest): Promise<DesktopApiResponse> => ipcRenderer.invoke("arden:api-request", request),
  clearSession: (): Promise<void> => ipcRenderer.invoke("arden:session:clear"),
  startGoogleSignIn: (): Promise<void> => ipcRenderer.invoke("arden:auth:google"),
  startNotificationStream: (organizationId: string): Promise<void> => ipcRenderer.invoke("arden:notifications:start", organizationId),
  stopNotificationStream: (organizationId?: string): Promise<void> => ipcRenderer.invoke("arden:notifications:stop", organizationId),
  subscribeNotificationEvents: (listener: (notificationId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value === "string") listener(value);
    };
    ipcRenderer.on("arden:notification-event", handler);
    return () => ipcRenderer.removeListener("arden:notification-event", handler);
  },
  subscribeNotificationStatus: (listener: (status: "connected" | "reconnected" | "disconnected" | "session-ended") => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (value === "connected" || value === "reconnected" || value === "disconnected" || value === "session-ended") listener(value);
    };
    ipcRenderer.on("arden:notification-status", handler);
    return () => ipcRenderer.removeListener("arden:notification-status", handler);
  },
});
