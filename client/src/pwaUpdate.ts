import { registerSW } from 'virtual:pwa-register';

type Escuchador = (disponible: boolean) => void;

let aplicar: ((reload?: boolean) => Promise<void>) | null = null;
let disponible = false;
const escuchadores = new Set<Escuchador>();

function publicar(valor: boolean) {
  disponible = valor;
  escuchadores.forEach((f) => f(valor));
}

/** Registra el service worker y avisa (sin recargar solo) cuando hay una versión nueva. */
export function iniciarActualizacionPWA() {
  aplicar = registerSW({
    immediate: true,
    onNeedRefresh() {
      publicar(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Una tablet dedicada puede quedar con la pestaña abierta horas sin recargar; el
      // navegador solo revisa el sw.js por su cuenta en la siguiente navegación, que puede
      // no llegar nunca. Forzamos la revisión periódica y al volver a primer plano.
      setInterval(() => { void registration.update(); }, 60 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
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
