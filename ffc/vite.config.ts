import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually in main.tsx via workbox-window
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: false, // we ship our own manifest.webmanifest
      injectManifest: {
        swSrc: 'src/sw.ts',
        swDest: 'dist/sw.js',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
