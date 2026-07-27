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
      includeAssets: ["icon.svg", "favicon.svg", "favicon-32.png", "app-icon.svg", "app-icon-1024.png"],
      manifest: {
        name: "DebutDeploy",
        short_name: "DebutDeploy",
        description: "Render-style control panel for Coolify-hosted apps",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0a0c11",
        background_color: "#0a0c11",
        // app-icon, not icon.svg: the animated mark carries ~20% transparent
        // padding for the pulse rings, which a maskable icon's safe-zone crop
        // would eat into. app-icon is the full-bleed rounded tile. The PNG is
        // listed for platforms that still refuse SVG app icons.
        icons: [
          {
            src: "app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "app-icon-1024.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "app-icon-1024.png",
            sizes: "1024x1024",
            type: "image/png",
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
  // Ship source maps so a production stack trace (shown in the error card's Details)
  // can be resolved back to the real file/line. // ponytail: internal tool; the small
  // exposure is worth being able to debug crashes.
  build: { sourcemap: true },
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
