import { registerSW } from 'virtual:pwa-register';
import { hayCambiosSinGuardar } from './use-unsaved';

type Escuchador = (disponible: boolean) => void;

let aplicar: ((reload?: boolean) => Promise<void>) | null = null;
let disponible = false;
const escuchadores = new Set<Escuchador>();

function publicar(valor: boolean) {
  disponible = valor;
  escuchadores.forEach((f) => f(valor));
}

function aplicarSiEsSeguro() {
  if (hayCambiosSinGuardar()) {
    publicar(true);
    return;
  }
  publicar(false);
  void aplicar?.(true);
}

/** Registra el service worker y activa de inmediato una versión nueva si no hay capturas abiertas. */
export function iniciarActualizacionPWA() {
  aplicar = registerSW({
    immediate: true,
    onNeedRefresh() {
      aplicarSiEsSeguro();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const revisar = () => { void registration.update().catch(() => { /* sin conexión */ }); };
      // Revisa al arrancar y periódicamente: una PC o tablet puede permanecer cerrada o con
      // la pestaña suspendida durante semanas y conservar un app-shell anterior.
      revisar();
      setInterval(revisar, 15 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') revisar();
      });
      window.addEventListener('focus', revisar);
      window.addEventListener('online', revisar);
    },
  });
}

/** Se llama desde el banner para saber si hay una actualización esperando. */
export function suscribirActualizacionPWA(f: Escuchador): () => void {
  escuchadores.add(f);
  f(disponible);
  return () => { escuchadores.delete(f); };
}

/** El usuario aceptó el banner: activa el service worker nuevo y recarga. */
export function aplicarActualizacionPWA() {
  publicar(false);
  void aplicar?.(true);
}
