import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = process.env.VITE_BACKEND || "http://localhost:8081";

/** Swallow "backend isn't up yet" noise instead of printing a stack trace every retry. */
const quiet = (label) => (proxy) => {
  proxy.on("error", (err) => {
    if (["ECONNREFUSED", "ECONNABORTED", "ECONNRESET", "EPIPE"].includes(err.code)) {
      console.log(`[proxy] backend not reachable on ${BACKEND} (${label}) — is "npm run backend" running?`);
    } else {
      console.log(`[proxy] ${label} error: ${err.message}`);
    }
  });
};

// Dev-server port. 5173 is Vite's default and often already taken, so this
// project uses 5115. Override with:  set VITE_PORT=xxxx && npm run dev
const DEV_PORT = parseInt(process.env.VITE_PORT || "5115", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    strictPort: true, // fail loudly instead of silently hopping to another port
    host: true,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true, configure: quiet("api") },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true, configure: quiet("ws") },
    },
  },
  preview: { port: DEV_PORT, host: true },
});
