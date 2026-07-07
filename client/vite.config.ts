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
      includeAssets: ['favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'mask-icon.svg', 'apple-touch-icon.png', 'burrito-logo.png'],
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'NODO · Burrito Parrilla',
        short_name: 'NODO',
        description: 'Abastecimiento centralizado: bodega, sucursales, conteos y distribución',
        lang: 'es-MX',
        dir: 'ltr',
        categories: ['business', 'productivity', 'food'],
        theme_color: '#15120e',
        background_color: '#faf8f4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Pedido / inventario', short_name: 'Pedido', url: '/inventario', description: 'Capturar pedido de sucursal o inventario de bodega' },
          { name: 'Distribución', short_name: 'Pedidos', url: '/distribucion', description: 'Crear y aprobar pedidos' },
          { name: 'Recepción', short_name: 'Recepción', url: '/recepcion', description: 'Confirmar lo que llega' },
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
