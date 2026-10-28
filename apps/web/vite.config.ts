import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * KrishiLoop web. Dev + preview proxy /api, /status and /.well-known to the FastAPI service
 * (override with KRISHILOOP_API). When the API is down the app falls back to bundled sample JSON.
 */
const API = process.env.KRISHILOOP_API ?? 'http://127.0.0.1:8000';
const proxy = {
  '/api': { target: API, changeOrigin: true },
  '/status': { target: API, changeOrigin: true },
  '/.well-known': { target: API, changeOrigin: true },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'KrishiLoop',
        short_name: 'KrishiLoop',
        description: 'Every piece of AI farm advice comes with a receipt anyone can check.',
        theme_color: '#f4f0e6',
        background_color: '#f4f0e6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Should I spray?', url: '/app', description: 'Open the farmer app' },
          { name: 'Verify a receipt', url: '/verify', description: 'Check a receipt' },
        ],
      },
      workbox: {
        // Precache the app shell; big or rarely needed chunks are cached on first use instead.
        globPatterns: ['**/*.{html,css,svg,png,webmanifest,woff2}', 'assets/*.js'],
        globIgnores: [
          '**/*{cyrillic,vietnamese,greek,devanagari,latin-ext}*.woff2',
          '**/*.wasm',
          'models/**',
          // the recorded fallback answers (only needed when the live server is unreachable) and the preview languages
          '**/assets/{plans,verify-before,verify-after,asks,area-trust-replay,snapshots,inbox,recall,stats,packs,demo,hi,sw}*.js',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Verification must never be answered from a cache: a recalled receipt could look authentic offline.
        navigateFallbackDenylist: [/^\/api\//, /^\/status\//, /^\/\.well-known\//],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/verify/') || url.pathname.startsWith('/status/'), handler: 'NetworkOnly' },
          { urlPattern: ({ url }) => url.pathname === '/api/demo', handler: 'StaleWhileRevalidate', options: { cacheName: 'kl-demo', expiration: { maxEntries: 4, maxAgeSeconds: 86400 } } },
          { urlPattern: ({ request, url }) => request.destination === 'script' && url.origin === self.location.origin, handler: 'CacheFirst', options: { cacheName: 'kl-chunks', expiration: { maxEntries: 40, maxAgeSeconds: 2592000 } } },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 4173, proxy },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
});
