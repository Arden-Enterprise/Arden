import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {},
  renderer: {
    plugins: [react()],
    // Export local SVGs as files so the renderer's self-only CSP can load them.
    build: { assetsInlineLimit: 0 },
    server: { host: "127.0.0.1", port: 5181, strictPort: true }
  }
});
