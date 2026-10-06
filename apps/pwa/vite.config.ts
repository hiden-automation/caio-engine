import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Base relativa: funciona no GitHub Pages em /<repo>/ sem configuração extra.
export default defineConfig({
  base: "./",
  build: { emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "JARVIS — aprovação de conteúdo",
        short_name: "JARVIS",
        description: "Aprove o conteúdo antes de ir ao ar.",
        lang: "pt-BR",
        theme_color: "#0B0F17",
        background_color: "#0B0F17",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Android: "Compartilhar → JARVIS" joga o link na Caixa de ideias.
        share_target: {
          action: "./",
          method: "GET",
          params: { title: "share_title", text: "share_text", url: "share_url" },
        },
      },
      workbox: {
        navigateFallback: "index.html",
        // A API do GitHub leva o token: nunca entra em cache.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
