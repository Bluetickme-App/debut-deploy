import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: {
      // forward API calls to the Express proxy so the browser never sees the Coolify token
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/github": "http://localhost:8787",
    },
  },
});
