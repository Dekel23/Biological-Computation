import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'
// `npm run build:phone` output: the repository's docs/ folder, which GitHub Pages can serve as-is.
const PHONE_OUT_DIR = fileURLToPath(new URL('../../docs', import.meta.url))

const fontCaching = [
  {
    // Rubik from Google Fonts, kept for offline use after the first visit.
    urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
    handler: 'CacheFirst',
    options: {
      cacheName: 'google-fonts',
      expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
]

const apiCaching = [
  {
    // Live data: try the network, fall back to the last good response when offline.
    urlPattern: ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/whatsapp/webhook'),
    handler: 'NetworkFirst',
    method: 'GET',
    options: {
      cacheName: 'api-cache',
      networkTimeoutSeconds: 4,
      expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
]

export default defineConfig(({ mode }) => {
  const phone = mode === 'phone'
  return {
    // Relative asset paths let the phone build run from any folder, e.g. /<repo>/ on GitHub Pages.
    base: phone ? './' : '/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // The web app manifest is hand-written in public/manifest.json and linked from index.html.
        manifest: false,
        includeAssets: ['favicon.svg', 'icons/*.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: phone ? 'index.html' : '/index.html',
          navigateFallbackDenylist: phone ? [] : [/^\/api\//],
          runtimeCaching: phone ? fontCaching : [...fontCaching, ...apiCaching],
        },
        devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
      }),
    ],
    build: {
      outDir: phone ? PHONE_OUT_DIR : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          },
        },
      },
    },
    test: {
      include: ['src/**/*.test.js'],
    },
    server: {
      host: true,
      port: 5173,
      proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
    },
  }
})
