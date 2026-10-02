import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {},
  renderer: {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5181, strictPort: true }
  }
});
