import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "DebutDeploy",
        short_name: "DebutDeploy",
        description: "Render-style control panel for Coolify-hosted apps",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0a0c11",
        background_color: "#0a0c11",
        icons: [
          {
            src: "icon.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache app shell; never intercept API / auth / GitHub routes
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/github/],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [],
      },
    }),
  ],
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
