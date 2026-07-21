/// <reference lib="webworker" />
// Service worker personalizado (estrategia injectManifest): precache de la app + web push.
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

// No skipWaiting() automático: con registerType 'prompt', el nuevo service worker se queda
// esperando hasta que pwaUpdate.ts le mande SKIP_WAITING (el usuario aceptó el banner de
// actualización). Así una pestaña abierta todo el turno no se recarga bajo el usuario.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
clientsClaim();

// Precache de los assets generados por el build.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// App-shell: en línea siempre pedimos el HTML actual al servidor. El precache se usa solo
// como respaldo sin conexión; así un service worker activo no mantiene una versión anterior.
const appShellOffline = createHandlerBoundToURL('/index.html');
registerRoute(new NavigationRoute(async (options) => {
  try {
    const response = await fetch(options.request, { cache: 'no-store' });
    if (response.ok) return response;
  } catch { /* sin conexión: usar el app-shell precargado */ }
  return appShellOffline(options);
}, { denylist: [/^\/api/] }));

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
