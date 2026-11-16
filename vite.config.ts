import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// La interfaz vive en web/ y se compila a web/dist (el servidor la sirve).
// En desarrollo (npm run dev) Vite redirige la API al servidor en :4747.
// "@/…" apunta a web/src (convención de shadcn/ui).
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "web/src") } },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4747", "/media": "http://localhost:4747", "/inspo": "http://localhost:4747", "/brands": "http://localhost:4747", "/styles-files": "http://localhost:4747" },
  },
});
