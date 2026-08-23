import { registerSW } from 'virtual:pwa-register';

type Escuchador = (disponible: boolean) => void;

let aplicar: ((reload?: boolean) => Promise<void>) | null = null;
let disponible = false;
const escuchadores = new Set<Escuchador>();

function publicar(valor: boolean) {
  disponible = valor;
  escuchadores.forEach((f) => f(valor));
}

/** Registra el service worker y avisa; la activación queda a cargo del usuario. */
export function iniciarActualizacionPWA() {
  aplicar = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Activar mientras se está navegando puede mezclar el app-shell nuevo con una
      // pantalla vieja. El banner deja que el usuario termine la captura y actualice
      // en un punto controlado.
      publicar(true);
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
