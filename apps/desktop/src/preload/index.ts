import { contextBridge, ipcRenderer } from "electron";

type DesktopApiRequest = { path: string; method: "GET" | "POST" | "PATCH"; body?: string; ifMatch?: string };
type DesktopApiResponse = { status: number; body: string; etag?: string; location?: string };

contextBridge.exposeInMainWorld("ardenDesktop", {
  requestApi: (request: DesktopApiRequest): Promise<DesktopApiResponse> => ipcRenderer.invoke("arden:api-request", request),
  clearSession: (): Promise<void> => ipcRenderer.invoke("arden:session:clear"),
});
