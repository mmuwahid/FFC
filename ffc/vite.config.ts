import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cache name bumps per commit so each deploy invalidates the old SW cache
// (CLAUDE.md Rule #19 — bump CACHE_NAME on every deploy).
const buildId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually in main.tsx via workbox-window
      strategies: 'generateSW',
      manifest: false, // we ship our own manifest.webmanifest
      workbox: {
        cacheId: `ffc-${buildId}`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
