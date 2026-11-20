import { defineConfig, type Plugin } from 'vite';
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

/**
 * On the home page only, start fetching the home page's own chunk (and its imports) together with the entry script,
 * instead of after it (the route is lazy): one round trip less before the first screen can render. Other pages are
 * untouched.
 */
function preloadHome(): Plugin {
  return {
    name: 'kl-preload-home',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).flatMap((c) => (c.type === 'chunk' ? [c] : []));
        const home = chunks.find((c) => c.isDynamicEntry && c.name === 'HomePage');
        if (!home) return html;
        const files = [home.fileName, ...home.imports].filter((f) => !html.includes(f));
        const script = `<script>if(location.pathname==='/'){${JSON.stringify(files)}.forEach(function(f){var l=document.createElement('link');l.rel='modulepreload';l.href='/'+f;document.head.appendChild(l)})}</script>`;
        return html.replace('</head>', `${script}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadHome(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in main.tsx, which also reloads the page when a new version takes over
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // the phone app (/m, builder Mo): opening the manifest's start_url gives the phone app, not the website. Quiet on
        // purpose: nothing in the UI asks anyone to install it (the owner's rule). Cream like the site (the default theme): the
        // splash and the status bar are the page colour #faf6ee; the dark theme repaints the bar at run time (lib/theme.ts).
        id: '/m',
        name: 'KrishiLoop: farm advice with a receipt',
        short_name: 'KrishiLoop',
        description: 'Farm advice for this week, a leaf check on your phone, and a receipt for every answer.',
        theme_color: '#faf6ee',
        background_color: '#faf6ee',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: '/m',
        scope: '/',
        lang: 'en',
        dir: 'ltr',
        categories: ['productivity', 'education', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'This week', short_name: 'Home', url: '/m?tab=home', description: 'This week’s advice for my field' },
          { name: 'Check a leaf', short_name: 'Leaf', url: '/m?tab=leaf', description: 'Check a sick leaf with the camera' },
          { name: 'My receipts', short_name: 'Receipts', url: '/m?tab=receipts', description: 'Receipts saved on this phone' },
          { name: 'Check a receipt', short_name: 'Check', url: '/verify', description: 'Check any receipt' },
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
        // /design-system/ is a static page (public/design-system/index.html), not the app
        navigateFallbackDenylist: [/^\/api\//, /^\/status\//, /^\/\.well-known\//, /^\/design-system/, /^\/docs/],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/verify/') || url.pathname.startsWith('/status/'), handler: 'NetworkOnly' },
          // the leaf model (11.5 MB) and its runtime, once used, stay on the phone so the leaf check works with no internet
          // (builder Mo). NetworkFirst: a new model from the server wins when online (a cheap 304 when unchanged).
          { urlPattern: ({ url }) => url.pathname.startsWith('/models/agritriage/'), handler: 'NetworkFirst', options: { cacheName: 'kl-leaf-model', networkTimeoutSeconds: 4, expiration: { maxEntries: 16 } } },
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
