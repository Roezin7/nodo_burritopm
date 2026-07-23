import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiPort = Number(process.env.E2E_API_PORT ?? 3100);

// Single-service deploy: el build de la PWA se emite a server/public,
// y el servidor Node sirve estos archivos + la API bajo /api.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Conservamos el modo prompt para no recargar una captura activa. pwaUpdate.ts aplica
      // automáticamente la versión al abrir/volver a la app cuando no hay cambios sin guardar.
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'mask-icon.svg', 'apple-touch-icon.png', 'burrito-logo.png'],
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globIgnores: ['og-image.png'],
        // La instalación inicial conserva acceso, menú e inicio sin descargar de fondo todas
        // las áreas administrativas. Los chunks de cada operación se guardan al visitarlos.
        globPatterns: [
          '**/*.{html,webmanifest,css,woff2,png,svg}',
          'assets/index-*.js',
          'assets/Login-*.js',
          'assets/Shell-*.js',
          'assets/Home-*.js',
          'assets/BurritoLockup-*.js',
          'assets/offline-*.js',
          'assets/UpdateBanner-*.js',
          'assets/pwaUpdate-*.js',
          'assets/workbox-window*.js',
        ],
      },
      manifest: {
        id: '/',
        name: 'NODO · Burrito Parrilla',
        short_name: 'NODO',
        description: 'Abastecimiento centralizado: bodega, sucursales, conteos y distribución',
        lang: 'es-MX',
        dir: 'ltr',
        categories: ['business', 'productivity', 'food'],
        theme_color: '#151411',
        background_color: '#f7f6f2',
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
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
