// Web Push para la PWA (iOS 16.4+ instalada / Android). Activación desde un gesto del usuario.
import { api } from './api';

export function pushSoportado(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function esIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** En iOS, el push solo funciona con la PWA instalada (pantalla de inicio). */
export function esStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function permisoConcedido(): boolean {
  return pushSoportado() && Notification.permission === 'granted';
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/**
 * Pide permiso, se suscribe y registra el dispositivo. Lanza Error con mensaje claro si
 * no se puede. Envía un aviso de prueba al terminar para que el usuario lo vea.
 */
export async function activarAvisos(): Promise<void> {
  if (!pushSoportado()) throw new Error('Este dispositivo no soporta avisos.');
  if (esIOS() && !esStandalone()) {
    throw new Error('En iPhone/iPad: primero instala la app (Compartir → Agregar a inicio) y ábrela desde ahí.');
  }

  const { habilitado, clave } = await api<{ habilitado: boolean; clave: string }>('/push/clave', { auth: false });
  if (!habilitado || !clave) throw new Error('Los avisos no están configurados en el servidor.');

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error('No diste permiso de avisos. Puedes activarlo en los ajustes del navegador.');

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToArrayBuffer(clave) }));

  await api('/push/suscribir', { method: 'POST', body: sub.toJSON() });
  await api('/push/probar', { method: 'POST' }).catch(() => {});
}
