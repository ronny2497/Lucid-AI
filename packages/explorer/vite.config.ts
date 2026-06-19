import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the read-only Lucid explorer SPA.
 *
 * The dev server proxies `/api/*` to the local collector (default :3000) so the
 * SPA fetches from the same `/api` base it will use when the collector serves
 * the bundled build (PRD §11: the SPA is bundled into the local collector image
 * and served same-origin). `vite build` produces a static bundle in `dist/`.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.LUCID_COLLECTOR_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
