import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(projectRoot, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
    // Export local SVGs as files so the renderer's self-only CSP can load them.
    build: { assetsInlineLimit: 0 },
    server: { host: "127.0.0.1", port: 5181, strictPort: true }
  }
});
