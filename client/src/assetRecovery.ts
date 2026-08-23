const RECOVERY_KEY = 'bpm-asset-recovery';
const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERY_ATTEMPTS = 2;

let recoveryStarted = false;

function mensajeDe(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message} ${error.stack ?? ''}`;
  return String(error);
}

/** Errores que indican que la pestaña está usando un app-shell/chunk de otro deploy. */
export function esFalloDeAsset(error: unknown) {
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module|Unable to preload CSS|CSS chunk|module script failed|Unexpected token '<'/i.test(mensajeDe(error));
}

function intentoPermitido() {
  const ahora = Date.now();
  try {
    const anterior = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null') as { desde?: number; intentos?: number } | null;
    const vigente = anterior && ahora - Number(anterior.desde) < RECOVERY_WINDOW_MS;
    const intentos = vigente ? Number(anterior.intentos ?? 0) : 0;
    if (intentos >= MAX_RECOVERY_ATTEMPTS) return false;
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ desde: vigente ? anterior?.desde : ahora, intentos: intentos + 1 }));
  } catch {
    // Si el almacenamiento está bloqueado, el guardado en memoria evita dobles llamadas
    // durante este render y todavía permite una recuperación puntual.
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch { /* almacenamiento bloqueado */ }
    if (recoveryStarted) return false;
  }
  return true;
}

/** Limpia la instalación vieja y vuelve a pedir el app-shell actual, sin loop infinito. */
export function limpiarAssetsYRecargar() {
  if (recoveryStarted || !intentoPermitido()) return false;
  recoveryStarted = true;

  void (async () => {
    try {
      const registros = await navigator.serviceWorker?.getRegistrations() ?? [];
      await Promise.all(registros.map((registro) => registro.unregister()));
      if ('caches' in window) {
        const nombres = await caches.keys();
        await Promise.all(nombres.map((nombre) => caches.delete(nombre)));
      }
    } catch {
      // La recarga normal aún puede recuperar el app-shell si el navegador no expone SW/cache.
    }
    window.location.reload();
  })();
  return true;
}
