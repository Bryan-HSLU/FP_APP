import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Im lokalen Netz erreichbar (Handy-Browser, POC-Bauumfang)
    host: true,
    proxy: {
      // Engines-API (FastAPI) – ein Origin, kein CORS-Gefummel im POC
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
