import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Sensible local defaults so the app runs with a plain `pnpm dev`.
const port = Number(process.env.PORT) || 5173;
const basePath = process.env.BASE_PATH || "/";

// Where the API server is reachable during local dev. Requests to `/api/*`
// from the frontend are proxied here so relative API calls "just work".
const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:8080";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
  },
});
