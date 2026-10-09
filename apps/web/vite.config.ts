import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const apiPort = Number(loadEnv(mode, ".", "ARDEN_DEV_API_PORT").ARDEN_DEV_API_PORT ?? 3001);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
    throw new Error("ARDEN_DEV_API_PORT must be an integer between 1024 and 65535");
  }
  return {
    plugins: [react()],
    server: {
      port: 5180,
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` }
    }
  };
});
