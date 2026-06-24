/// <reference lib="webworker" />
// Service worker personalizado (estrategia injectManifest): precache de la app + web push.
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

self.skipWaiting();
clientsClaim();

// Precache de los assets generados por el build.
precacheAndRoute(self.__WB_MANIFEST);

// App-shell: las navegaciones (no /api) responden con index.html (offline-first).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api/] }));

// ───────────────────────── Web Push ─────────────────────────
self.addEventListener('push', (event) => {
  let data: { titulo?: string; cuerpo?: string; url?: string } = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* payload no-JSON */ }
  const titulo = data.titulo || 'Burrito Parrilla';
  const opciones: NotificationOptions = {
    body: data.cuerpo || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const c of clientes) {
        if ('focus' in c) { (c as WindowClient).navigate(url); return (c as WindowClient).focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
