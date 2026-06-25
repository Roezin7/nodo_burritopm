import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Single-service deploy: el build de la PWA se emite a server/public,
// y el servidor Node sirve estos archivos + la API bajo /api.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'NODO · Burrito Parrilla',
        short_name: 'NODO',
        description: 'Abastecimiento centralizado: bodega, sucursales, conteos y distribución',
        lang: 'es-MX',
        theme_color: '#1e1e20',
        background_color: '#1e1e20',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3100',
    },
  },
});
