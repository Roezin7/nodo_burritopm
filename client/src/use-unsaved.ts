import { useEffect } from 'react';

const capturasActivas = new Set<symbol>();
export const hayCambiosSinGuardar = () => capturasActivas.size > 0;

/** Protege capturas largas contra recargas o cierres accidentales del navegador. */
export function useUnsavedChanges(activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    const id = Symbol('captura');
    capturasActivas.add(id);
    const avisar = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => { capturasActivas.delete(id); window.removeEventListener('beforeunload', avisar); };
  }, [activo]);
}

export function guardarBorradorLocal<T>(clave: string, valor: T | null) {
  try {
    if (valor == null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify({ valor, guardado_at: new Date().toISOString() }));
  } catch { /* el navegador puede bloquear almacenamiento local */ }
}

export function leerBorradorLocal<T>(clave: string): { valor: T; guardado_at: string } | null {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) as { valor: T; guardado_at: string } : null;
  } catch { return null; }
}
